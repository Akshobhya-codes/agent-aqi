"use client";

/**
 * NicknameModal
 *
 * Shown after first sign-in when the user has no nickname.
 * Lets them pick a display name (max 24 chars) saved to /me.
 */

import { useState } from "react";

interface Props {
  onSave:  (nickname: string) => Promise<void>;
  onSkip:  () => void;
}

export default function NicknameModal({ onSave, onSkip }: Props) {
  const [nickname, setNickname] = useState("");
  const [saving,   setSaving]   = useState(false);

  async function handleSave() {
    const trimmed = nickname.trim().slice(0, 24);
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
      onClick={onSkip}
    >
      <div
        className="card"
        style={{ maxWidth: 380, width: "100%", textAlign: "center" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: "2rem", marginBottom: 8 }}>👤</div>
        <h2 style={{ marginBottom: 4, fontSize: "1.1rem" }}>Pick a nickname</h2>
        <p className="muted" style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.5 }}>
          Show up in battle lobbies and leaderboards. You can change this anytime.
        </p>

        <input
          type="text"
          maxLength={24}
          placeholder="CryptoWatcher42"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && nickname.trim()) void handleSave(); }}
          style={{ width: "100%", boxSizing: "border-box", marginBottom: 12, fontSize: 14 }}
          autoFocus
        />

        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            onClick={onSkip}
          >
            Skip for now
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12 }}
            onClick={() => void handleSave()}
            disabled={!nickname.trim() || saving}
          >
            {saving ? "Saving…" : "Save nickname →"}
          </button>
        </div>

        <p style={{ fontSize: 10, color: "var(--muted)", marginTop: 10 }}>
          Stored server-side, linked to your wallet address. No email required.
        </p>
      </div>
    </div>
  );
}
