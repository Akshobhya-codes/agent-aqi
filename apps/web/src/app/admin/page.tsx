"use client";

/**
 * /admin — Stage control panel (admin only).
 *
 * Flow:
 *   1. Enter ADMIN_TOKEN → stored in localStorage.
 *   2. Choose battle type + matchup.
 *   3. "Open Lobby" → audience can start placing bets.
 *   4. "Run Battle" → jobs fire, winner determined.
 *   5. Navigate to /agents (leaderboard) or battle detail to demo results.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BattleRecord, BattleType } from "@agent-aqi/shared";

const API = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000";

const BATTLE_TYPES: { id: BattleType; emoji: string; label: string; desc: string }[] = [
  { id: "speed",       emoji: "⚡", label: "Speed Race",        desc: "Lowest latency wins" },
  { id: "gas",         emoji: "💰", label: "Gas Saver",          desc: "Lowest gas wins" },
  { id: "slippage",    emoji: "💧", label: "Slippage Duel",      desc: "Tightest slip wins" },
  { id: "reliability", emoji: "✅", label: "Reliability Sprint", desc: "Best success rate wins" },
];

const MATCHUPS: { ids: string[]; label: string }[] = [
  { ids: ["safe", "fast", "cheap"], label: "All Three 🔥" },
  { ids: ["safe", "fast"],          label: "🛡️ vs ⚡" },
  { ids: ["safe", "cheap"],         label: "🛡️ vs ♻️" },
  { ids: ["fast", "cheap"],         label: "⚡ vs ♻️" },
];

const AGENT_ICONS: Record<string, string> = { safe: "🛡️", fast: "⚡", cheap: "♻️" };
const AGENT_NAMES: Record<string, string> = { safe: "SafeGuard", fast: "SpeedRunner", cheap: "GasOptimizer" };

export default function AdminPage() {
  const [token,       setToken]       = useState("");
  const [savedToken,  setSavedToken]  = useState<string | null>(null);
  const [battleType,  setBattleType]  = useState<BattleType>("speed");
  const [matchupIdx,  setMatchupIdx]  = useState(0);
  const [current,     setCurrent]     = useState<BattleRecord | null>(null);
  const [opening,     setOpening]     = useState(false);
  const [running,     setRunning]     = useState(false);
  const [msg,         setMsg]         = useState<{ text: string; ok: boolean } | null>(null);

  // Load token from localStorage on mount
  useEffect(() => {
    const t = localStorage.getItem("adminToken");
    if (t) setSavedToken(t);
  }, []);

  // Poll current battle
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`${API}/arena/current`);
        if (res.ok) {
          const d = (await res.json()) as { battle: BattleRecord | null };
          setCurrent(d.battle);
        }
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  function saveToken() {
    const t = token.trim();
    if (!t) return;
    localStorage.setItem("adminToken", t);
    setSavedToken(t);
    setToken("");
    setMsg({ text: "Token saved.", ok: true });
  }

  function clearToken() {
    localStorage.removeItem("adminToken");
    setSavedToken(null);
    setMsg(null);
  }

  async function openLobby() {
    if (!savedToken) return;
    setOpening(true);
    setMsg(null);
    try {
      const agentIds = MATCHUPS[matchupIdx]?.ids ?? ["safe", "fast", "cheap"];
      const res = await fetch(`${API}/arena/admin/open`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": savedToken },
        body:    JSON.stringify({ battleType, agentIds }),
      });
      if (res.ok) {
        const d = (await res.json()) as { battleId: string };
        setMsg({ text: `Lobby open! Battle ID: ${d.battleId.slice(0, 8)}…`, ok: true });
      } else {
        const e = (await res.json()) as { error: string };
        setMsg({ text: e.error ?? "Failed to open lobby", ok: false });
      }
    } catch {
      setMsg({ text: "Network error", ok: false });
    } finally {
      setOpening(false);
    }
  }

  async function runBattle() {
    if (!savedToken) return;
    if (!current || current.status !== "lobby") return;
    setRunning(true);
    setMsg(null);
    try {
      const res = await fetch(`${API}/arena/admin/run`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": savedToken },
      });
      if (res.ok) {
        setMsg({ text: "Battle started! Agents are running…", ok: true });
      } else {
        const e = (await res.json()) as { error: string };
        setMsg({ text: e.error ?? "Failed to run battle", ok: false });
      }
    } catch {
      setMsg({ text: "Network error", ok: false });
    } finally {
      setRunning(false);
    }
  }

  const statusColor =
    current?.status === "lobby"    ? "var(--yellow)" :
    current?.status === "running"  ? "var(--accent)"  :
    current?.status === "complete" ? "var(--green)"   : "var(--muted)";

  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg)", padding: "2rem",
      maxWidth: 560, margin: "0 auto",
    }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <span style={{ fontSize: "1.8rem" }}>🎛️</span>
          <h1 style={{ marginBottom: 0, fontSize: "1.4rem" }}>Stage Control</h1>
          <span style={{
            marginLeft: "auto", fontSize: 10, fontWeight: 700,
            background: "rgba(248,81,73,.15)", color: "var(--red)",
            padding: "2px 8px", borderRadius: 99, letterSpacing: "0.06em",
          }}>
            ADMIN ONLY
          </span>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Open a lobby → audience bets → run battle → show leaderboard.
        </p>
      </div>

      {/* Token gate */}
      {!savedToken ? (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ marginBottom: 10, fontSize: 13 }}>🔑 Admin Token</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password"
              placeholder="Paste ADMIN_TOKEN…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveToken(); }}
              style={{ flex: 1, fontSize: 13, padding: "0.45rem 0.7rem" }}
              autoFocus
            />
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={saveToken}>
              Unlock
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem",
          background: "rgba(63,185,80,.07)", border: "1px solid rgba(63,185,80,.3)",
          borderRadius: "var(--radius)", padding: "0.6rem 1rem",
        }}>
          <span style={{ color: "var(--green)", fontSize: 13, fontWeight: 600 }}>
            ✓ Admin unlocked
          </span>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 10, marginLeft: "auto", padding: "2px 8px" }}
            onClick={clearToken}
          >
            Lock
          </button>
        </div>
      )}

      {/* Current battle status */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: current ? 12 : 0 }}>
          <h3 style={{ marginBottom: 0, fontSize: 13 }}>Current Battle</h3>
          {current && (
            <span style={{
              marginLeft: "auto", fontSize: 10, fontWeight: 700,
              color: statusColor, textTransform: "uppercase", letterSpacing: "0.05em",
            }}>
              ● {current.status}
            </span>
          )}
        </div>

        {!current ? (
          <p className="muted" style={{ fontSize: 12 }}>No active battle — open a lobby below.</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {current.agentIds.map((id) => (
                <span key={id} style={{
                  fontSize: 11, fontWeight: 600,
                  background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius)", padding: "3px 10px",
                }}>
                  {AGENT_ICONS[id] ?? "🤖"} {AGENT_NAMES[id] ?? id}
                </span>
              ))}
            </div>

            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
              Type: <strong style={{ color: "var(--text)" }}>{current.battleType}</strong>
              {" · "}ID: <code style={{ color: "var(--accent)" }}>{current.battleId.slice(0, 8)}…</code>
              {current.winnerAgentId && (
                <span style={{ color: "var(--green)", marginLeft: 8 }}>
                  🏆 {AGENT_ICONS[current.winnerAgentId]} wins
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {/* Run Battle — only when in lobby */}
              {current.status === "lobby" && (
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 13, padding: "0.6rem 1.5rem" }}
                  onClick={() => void runBattle()}
                  disabled={running || !savedToken}
                >
                  {running ? "Starting…" : "▶ Run Battle"}
                </button>
              )}

              {current.status === "running" && (
                <span style={{ fontSize: 12, color: "var(--yellow)", alignSelf: "center" }}>
                  ⏳ Agents executing…
                </span>
              )}

              <Link
                href={`/arena/battle/${current.battleId}`}
                className="btn btn-ghost"
                style={{ fontSize: 12 }}
                target="_blank"
              >
                👁 View Battle →
              </Link>

              {current.status === "complete" && (
                <Link href="/agents" className="btn btn-ghost" style={{ fontSize: 12 }}>
                  📊 Show Leaderboard →
                </Link>
              )}
            </div>
          </>
        )}
      </div>

      {/* Lobby builder — only show when no active lobby/running battle */}
      {(!current || current.status === "complete") && savedToken && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ marginBottom: 14, fontSize: 13 }}>Open New Lobby</h3>

          {/* Battle type */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Battle type
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {BATTLE_TYPES.map((bt) => (
                <button
                  key={bt.id}
                  onClick={() => setBattleType(bt.id)}
                  style={{
                    padding: "0.45rem 0.85rem",
                    borderRadius: "var(--radius)",
                    border: `1px solid ${battleType === bt.id ? "var(--accent)" : "var(--border)"}`,
                    background: battleType === bt.id ? "rgba(88,166,255,.12)" : "transparent",
                    color: battleType === bt.id ? "var(--accent)" : "var(--text)",
                    cursor: "pointer", fontSize: 12, fontWeight: 600,
                  }}
                >
                  {bt.emoji} {bt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Matchup */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Agents
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {MATCHUPS.map((m, i) => (
                <button
                  key={i}
                  onClick={() => setMatchupIdx(i)}
                  style={{
                    padding: "0.4rem 0.85rem",
                    borderRadius: "var(--radius)",
                    border: `1px solid ${matchupIdx === i ? "var(--accent)" : "var(--border)"}`,
                    background: matchupIdx === i ? "rgba(88,166,255,.12)" : "transparent",
                    color: matchupIdx === i ? "var(--accent)" : "var(--text)",
                    cursor: "pointer", fontSize: 12,
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <button
            className="btn btn-primary"
            style={{ fontSize: 14, padding: "0.7rem 2rem", width: "100%" }}
            onClick={() => void openLobby()}
            disabled={opening}
          >
            {opening ? "Opening…" : "🎰 Open Lobby"}
          </button>
          <p className="muted" style={{ fontSize: 11, marginTop: 8, textAlign: "center" }}>
            Audience can bet as soon as the lobby is open. Run the battle when you're ready.
          </p>
        </div>
      )}

      {/* Feedback */}
      {msg && (
        <div style={{
          padding: "0.75rem 1rem",
          borderRadius: "var(--radius)",
          border: `1px solid ${msg.ok ? "rgba(63,185,80,.4)" : "rgba(248,81,73,.4)"}`,
          background: msg.ok ? "rgba(63,185,80,.07)" : "rgba(248,81,73,.07)",
          fontSize: 12,
          color: msg.ok ? "var(--green)" : "var(--red)",
          marginBottom: "1rem",
        }}>
          {msg.text}
        </div>
      )}

      {/* Nav links */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: "1rem" }}>
        <Link href="/" className="btn btn-ghost" style={{ fontSize: 11 }}>← Home</Link>
        <Link href="/arena" className="btn btn-ghost" style={{ fontSize: 11 }}>Arena</Link>
        <Link href="/agents" className="btn btn-ghost" style={{ fontSize: 11 }}>Leaderboard</Link>
      </div>
    </div>
  );
}
