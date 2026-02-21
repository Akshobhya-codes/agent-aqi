"use client";

/**
 * useAuth — SIWE (Sign-In with Ethereum) login flow.
 *
 * Steps:
 *  1. POST /auth/nonce  { address } → { nonce }
 *  2. Build EIP-4361 SIWE message
 *  3. personal_sign via window.ethereum
 *  4. POST /auth/verify { message, signature } → { token }
 *  5. Store token in localStorage; fetch /me for profile
 *
 * Environment variables:
 *   NEXT_PUBLIC_APP_DOMAIN   — e.g. "localhost" or "yourdomain.com"
 *   NEXT_PUBLIC_APP_URL      — e.g. "http://localhost:3000"
 */

import { useCallback, useEffect, useState } from "react";
import { toHex }  from "viem";
import { useWallet } from "./useWallet";

const API        = process.env["NEXT_PUBLIC_API_URL"]    ?? "http://localhost:4000";
const APP_DOMAIN = process.env["NEXT_PUBLIC_APP_DOMAIN"] ?? "localhost";
const APP_URI    = process.env["NEXT_PUBLIC_APP_URL"]    ?? "http://localhost:3000";
const CHAIN_ID   = 84532; // Base Sepolia
const STORAGE_KEY = "agent-aqi-auth-token";

export interface AuthProfile {
  address:    string;
  nickname?:  string;
  color?:     string;
  createdAt:  number;
  lastSeenAt: number;
}

export function useAuth() {
  const wallet = useWallet();

  const [token,   setToken]   = useState<string | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // ── Bootstrap from localStorage ─────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setToken(stored);
  }, []);

  // ── Fetch profile whenever token changes ─────────────────────────────────────

  useEffect(() => {
    if (!token) { setProfile(null); return; }
    fetch(`${API}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? (r.json() as Promise<AuthProfile>) : null)
      .then((p) => {
        if (p) {
          setProfile(p);
        } else {
          // Token rejected — clear it
          localStorage.removeItem(STORAGE_KEY);
          setToken(null);
        }
      })
      .catch(() => {
        // Network error — keep token but show no profile yet
      });
  }, [token]);

  // ── Sign in ──────────────────────────────────────────────────────────────────

  const signIn = useCallback(async () => {
    if (!wallet.address) {
      await wallet.connect();
      return;
    }
    if (wallet.chainId !== wallet.BASE_SEPOLIA_CHAIN_ID) {
      await wallet.switchToBaseSepolia();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Fetch nonce
      const nonceRes = await fetch(`${API}/auth/nonce`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ address: wallet.address }),
      });
      if (!nonceRes.ok) throw new Error("Failed to fetch nonce");
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      // 2. Build SIWE message (EIP-4361)
      const issuedAt = new Date().toISOString();
      const message  = [
        `${APP_DOMAIN} wants you to sign in with your Ethereum account:`,
        wallet.address,
        "",
        "Sign in to Agent Arena",
        "",
        `URI: ${APP_URI}`,
        `Version: 1`,
        `Chain ID: ${CHAIN_ID}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join("\n");

      // 3. personal_sign — MetaMask expects hex-encoded message
      const provider = ((window as unknown) as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!provider) throw new Error("No wallet detected");

      const signature = (await provider.request({
        method: "personal_sign",
        params: [toHex(message), wallet.address],
      })) as string;

      // 4. Verify with backend
      const verifyRes = await fetch(`${API}/auth/verify`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message, signature }),
      });
      if (!verifyRes.ok) {
        const err = (await verifyRes.json()) as { error?: string };
        throw new Error(err.error ?? "Verification failed");
      }
      const { token: newToken } = (await verifyRes.json()) as { token: string };

      // 5. Persist
      localStorage.setItem(STORAGE_KEY, newToken);
      setToken(newToken);
    } catch (err) {
      setError(String(err).replace(/Error: /g, ""));
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  // ── Sign out ─────────────────────────────────────────────────────────────────

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setProfile(null);
  }, []);

  // ── Update profile ────────────────────────────────────────────────────────────

  const updateProfile = useCallback(async (
    updates: { nickname?: string; color?: string },
  ) => {
    if (!token) return;
    const res = await fetch(`${API}/me`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify(updates),
    });
    if (res.ok) setProfile((await res.json()) as AuthProfile);
  }, [token]);

  // ── Authenticated fetch helper ────────────────────────────────────────────────

  const authFetch = useCallback((url: string, opts: RequestInit = {}) => {
    return fetch(url, {
      ...opts,
      headers: {
        ...(opts.headers as Record<string, string>),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  }, [token]);

  return {
    token,
    profile,
    isSignedIn: Boolean(token && profile),
    loading,
    error,
    signIn,
    signOut,
    updateProfile,
    authFetch,
  };
}
