/**
 * auth.ts
 *
 * SIWE (Sign-In with Ethereum) nonce store + JWT helpers + Express middleware.
 *
 * Required environment variable:
 *   JWT_SECRET              — HS256 signing secret (developer must set)
 *
 * Optional environment variable:
 *   AUTH_TOKEN_TTL_HOURS    — token lifetime in hours (default: 24)
 */

import { randomBytes }  from "crypto";
import jwt              from "jsonwebtoken";
import { verifyMessage } from "viem";
import type { Request, Response, NextFunction } from "express";

// ── Config ─────────────────────────────────────────────────────────────────────

const JWT_SECRET    = process.env["JWT_SECRET"] ?? "";
const JWT_TTL_HOURS = parseInt(process.env["AUTH_TOKEN_TTL_HOURS"] ?? "24", 10);
const NONCE_TTL_MS  = 5 * 60 * 1000; // 5 minutes

if (!JWT_SECRET) {
  console.warn(
    "[auth] WARNING: JWT_SECRET is not set. " +
    "Sign-in will fail. Set JWT_SECRET in apps/api/.env"
  );
}

// ── In-memory nonce store ─────────────────────────────────────────────────────

interface NonceEntry { nonce: string; expiresAt: number }
const nonceStore = new Map<string, NonceEntry>();

export function generateNonce(address: string): string {
  const nonce = randomBytes(16).toString("hex");
  nonceStore.set(address.toLowerCase(), {
    nonce,
    expiresAt: Date.now() + NONCE_TTL_MS,
  });
  return nonce;
}

function consumeNonce(address: string, nonce: string): boolean {
  const entry = nonceStore.get(address.toLowerCase());
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    nonceStore.delete(address.toLowerCase());
    return false;
  }
  if (entry.nonce !== nonce) return false;
  nonceStore.delete(address.toLowerCase()); // one-time use
  return true;
}

// ── Minimal SIWE message parser ────────────────────────────────────────────────

interface ParsedSiwe {
  address: string;
  nonce:   string;
  chainId: number;
  domain:  string;
}

function parseSiweMessage(raw: string): ParsedSiwe {
  const lines = raw.split("\n");
  // Line 0: "{domain} wants you to sign in with your Ethereum account:"
  const domainMatch = (lines[0] ?? "").match(/^(.+) wants you to sign in/);
  const domain      = domainMatch?.[1]?.trim() ?? "";
  // Line 1: Ethereum address
  const address     = (lines[1] ?? "").trim();
  // Key-value fields anywhere in the message body
  const nonce   = (raw.match(/Nonce: ([^\n]+)/)?.[1] ?? "").trim();
  const chainId = parseInt(
    (raw.match(/Chain ID: ([^\n]+)/)?.[1] ?? "0").trim(),
    10
  );
  return { address, nonce, chainId, domain };
}

// ── SIWE verification ──────────────────────────────────────────────────────────

/**
 * Verifies a SIWE message + EIP-191 signature.
 * Returns { address } on success, null on any failure.
 *
 * Validation:
 *  - Nonce matches stored nonce for the address (one-time, 5-min TTL)
 *  - ecrecover of (personal_sign prefix + rawMessage) matches address
 */
export async function verifySiweMessage(
  rawMessage: string,
  signature:  string,
): Promise<{ address: string } | null> {
  try {
    const { address, nonce } = parseSiweMessage(rawMessage);
    if (!address || !nonce) return null;

    // Consume nonce — must match what we issued for this address
    if (!consumeNonce(address, nonce)) {
      console.warn("[auth] Nonce mismatch or expired for", address);
      return null;
    }

    // Verify EIP-191 personal_sign signature via viem (pure ecrecover, no RPC)
    const valid = await verifyMessage({
      address:   address as `0x${string}`,
      message:   rawMessage,
      signature: signature as `0x${string}`,
    });
    if (!valid) {
      console.warn("[auth] Signature verification failed for", address);
      return null;
    }

    return { address: address.toLowerCase() };
  } catch (err) {
    console.error("[auth] verifySiweMessage error:", err);
    return null;
  }
}

// ── JWT helpers ────────────────────────────────────────────────────────────────

export function issueToken(address: string): string {
  if (!JWT_SECRET) throw new Error("JWT_SECRET is not configured on server");
  return jwt.sign(
    { sub: address.toLowerCase() },
    JWT_SECRET,
    { expiresIn: `${JWT_TTL_HOURS}h` }
  );
}

function verifyToken(token: string): string | null {
  if (!JWT_SECRET) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// ── Express request extension ──────────────────────────────────────────────────

export interface AuthRequest extends Request {
  walletAddress?: string;
}

// ── Middleware ─────────────────────────────────────────────────────────────────

/** Requires a valid Bearer JWT. Returns 401 otherwise. */
export function requireAuth(
  req:  AuthRequest,
  res:  Response,
  next: NextFunction
): void {
  const header  = (req.headers["authorization"] ?? "") as string;
  const token   = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const address = verifyToken(token);
  if (!address) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.walletAddress = address;
  next();
}

/** Attaches wallet address if a valid Bearer JWT is present; never blocks. */
export function optionalAuth(
  req:  AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  const header = (req.headers["authorization"] ?? "") as string;
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    const address = verifyToken(token);
    if (address) req.walletAddress = address;
  }
  next();
}
