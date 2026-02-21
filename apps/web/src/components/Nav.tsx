"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import { useAuth } from "@/hooks/useAuth";
import NicknameModal from "./NicknameModal";

export default function Nav() {
  const path   = usePathname();
  const wallet = useWallet();
  const auth   = useAuth();

  const [showNickModal, setShowNickModal] = useState(false);
  const [showDropdown,  setShowDropdown]  = useState(false);

  // After sign-in, prompt for nickname if not set
  const needsNickname = auth.isSignedIn && auth.profile && !auth.profile.nickname;

  async function handleAuthClick() {
    if (!wallet.address) {
      // Not connected: connect wallet first
      await wallet.connect();
      return;
    }
    if (!auth.isSignedIn) {
      // Connected but not signed in: do SIWE
      await auth.signIn();
      // After successful sign-in, prompt for nickname if first time
      if (auth.profile && !auth.profile.nickname) {
        setShowNickModal(true);
      }
      return;
    }
    // Already signed in: toggle dropdown
    setShowDropdown((v) => !v);
  }

  // When signIn resolves and profile is fresh, open nickname modal
  const prevIsSignedIn = auth.isSignedIn;
  if (!prevIsSignedIn && auth.isSignedIn && needsNickname && !showNickModal) {
    setShowNickModal(true);
  }

  // Derive the button label
  function authButtonLabel() {
    if (wallet.connecting || auth.loading) return "…";
    if (!wallet.address)   return "Connect";
    if (!auth.isSignedIn)  return "Sign In";
    return auth.profile?.nickname ?? `${wallet.address.slice(0, 6)}…`;
  }

  return (
    <>
      {/* Nickname prompt modal */}
      {showNickModal && (
        <NicknameModal
          onSave={async (nickname) => {
            await auth.updateProfile({ nickname });
            setShowNickModal(false);
          }}
          onSkip={() => setShowNickModal(false)}
        />
      )}

      <nav>
        <Link href="/" className="brand">
          Agent <span>AQI</span>
        </Link>

        {/* Nav links */}
        <Link
          href="/arena"
          style={{ color: (path === "/arena" || (path.startsWith("/arena") && !path.startsWith("/arena/home"))) ? "var(--text-hi)" : undefined }}
        >
          Arena
        </Link>
        <Link href="/" style={{ color: path === "/" ? "var(--text-hi)" : undefined }}>
          Run Job
        </Link>
        <Link
          href="/agents"
          style={{ color: path.startsWith("/agents") ? "var(--text-hi)" : undefined }}
        >
          Leaderboard
        </Link>
        <Link
          href="/streams"
          style={{ color: path.startsWith("/streams") ? "var(--text-hi)" : undefined }}
        >
          Streams
        </Link>
        <Link
          href="/swap"
          style={{ color: path.startsWith("/swap") ? "var(--text-hi)" : undefined }}
        >
          Swap Sim
        </Link>
        <Link
          href="/arena/home"
          style={{ color: path.startsWith("/arena/home") ? "var(--text-hi)" : undefined }}
        >
          Agent Home
        </Link>

        {/* ── Wallet / Sign-in (pushed to right) ───────────────────────── */}
        <div style={{ marginLeft: "auto", position: "relative" }}>
          <button
            onClick={() => void handleAuthClick()}
            style={{
              padding:      "0.35rem 0.85rem",
              borderRadius: "var(--radius)",
              border:       auth.isSignedIn
                ? "1px solid var(--green)"
                : "1px solid var(--border)",
              background:   auth.isSignedIn
                ? "rgba(63,185,80,.1)"
                : "transparent",
              color:        auth.isSignedIn ? "var(--green)" : "var(--text)",
              fontSize:     12,
              fontWeight:   600,
              cursor:       "pointer",
              whiteSpace:   "nowrap",
            }}
          >
            {auth.isSignedIn && <span style={{ marginRight: 4 }}>✓</span>}
            {authButtonLabel()}
          </button>

          {/* Signed-in dropdown */}
          {showDropdown && auth.isSignedIn && (
            <div
              style={{
                position:     "absolute",
                top:          "calc(100% + 6px)",
                right:        0,
                background:   "var(--surface)",
                border:       "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding:      "0.5rem 0",
                minWidth:     180,
                zIndex:       1000,
                boxShadow:    "0 4px 16px rgba(0,0,0,0.3)",
              }}
              onMouseLeave={() => setShowDropdown(false)}
            >
              <div style={{ padding: "0.4rem 1rem 0.5rem", borderBottom: "1px solid var(--border)", marginBottom: "0.35rem" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-hi)" }}>
                  {auth.profile?.nickname ?? "Anon"}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace", marginTop: 2 }}>
                  {auth.profile?.address.slice(0, 10)}…
                </div>
              </div>
              <button
                onClick={() => { setShowNickModal(true); setShowDropdown(false); }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "0.4rem 1rem", background: "none", border: "none",
                  color: "var(--text)", fontSize: 12, cursor: "pointer",
                }}
              >
                ✏️ Change nickname
              </button>
              <button
                onClick={() => { auth.signOut(); setShowDropdown(false); }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "0.4rem 1rem", background: "none", border: "none",
                  color: "var(--red)", fontSize: 12, cursor: "pointer",
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>

        {/* Wallet error inline hint */}
        {(wallet.error || auth.error) && (
          <span style={{ fontSize: 10, color: "var(--red)", maxWidth: 140, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {wallet.error ?? auth.error}
          </span>
        )}
      </nav>
    </>
  );
}
