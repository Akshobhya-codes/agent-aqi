"use client";

/**
 * PaperBetPanel
 *
 * No wallet. No MetaMask. Just a nickname + fake ETH wager.
 *
 * State machine:
 *   "form"     – pick nickname / agent / amount → place bet
 *   "placed"   – waiting for battle to resolve; show live pool + lobby
 *   "resolved" – show P/L result, all results table, global mini-leaderboard
 *
 * Winner-takes-pool: losers' stakes are distributed proportionally among winners.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { PaperBet, PaperBetResult, PaperLeaderboardEntry } from "@agent-aqi/shared";

const API = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000";

// ─── Agent metadata ───────────────────────────────────────────────────────────

const AGENTS = ["safe", "fast", "cheap"] as const;
type AgentKey = typeof AGENTS[number];

const AGENT_ICONS:   Record<AgentKey, string> = { safe: "🛡️", fast: "⚡",     cheap: "♻️" };
const AGENT_NAMES:   Record<AgentKey, string> = { safe: "SafeGuard", fast: "SpeedRunner", cheap: "GasOptimizer" };
const AGENT_HEX:     Record<AgentKey, string> = { safe: "#3fb950",   fast: "#d29922",     cheap: "#58a6ff" };
const AGENT_RGB:     Record<AgentKey, string> = { safe: "63,185,80", fast: "210,153,34",  cheap: "88,166,255" };
const AGENT_TAGLINE: Record<AgentKey, string> = { safe: "Safest route", fast: "Fastest exec", cheap: "Lowest gas" };

const AMOUNTS = [0.01, 0.05, 0.1, 0.5];

// ─── Random nickname ──────────────────────────────────────────────────────────

const ADJ  = ["Bullish","Diamond","Degen","Wagmi","Lunar","Alpha","Based","Gigabrain","Stealthy","Rogue","Turbo","Neon"];
const NOUN = ["Whale","Chad","Anon","Hodler","Maxi","Moon","Bag","Hunter","Scout","Ape","Degen","Ghost"];

function randomNickname(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  const d = Math.floor(Math.random() * 99) + 1;
  return `${a}${n}${d}`;
}

// ─── Lightweight confetti (only when user wins) ───────────────────────────────

const CONFETTI_COLORS = ["#58a6ff","#3fb950","#f0c040","#f85149","#d29922","#bc8cff","#ff7b72"];

function WinConfetti() {
  const pieces = useMemo(() =>
    Array.from({ length: 44 }, (_, i) => ({
      id:    i,
      left:  Math.random() * 100,
      delay: Math.random() * 1.2,
      dur:   1.5 + Math.random() * 1.3,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
      size:  5 + Math.random() * 8,
    })), []);

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }}>
      {pieces.map((p) => (
        <div key={p.id} style={{
          position: "absolute", left: `${p.left}%`, top: -20,
          width: p.size, height: p.size, background: p.color,
          borderRadius: "50%",
          animation: `confetti-fall ${p.dur}s ease-in ${p.delay}s forwards`,
        }} />
      ))}
    </div>
  );
}

// ─── API types ────────────────────────────────────────────────────────────────

interface PoolEntry { count: number; total: number; }

interface BetData {
  bets:     PaperBet[];
  results:  PaperBetResult[];
  pool:     Record<string, PoolEntry>;
  resolved: boolean;
}

// ─── Pool bar ─────────────────────────────────────────────────────────────────

function PoolBar({ agentId, entry, totalPool }: {
  agentId:   AgentKey;
  entry:     PoolEntry;
  totalPool: number;
}) {
  const pct  = totalPool > 0 ? (entry.total / totalPool) * 100 : 0;
  const hex  = AGENT_HEX[agentId];
  const rgb  = AGENT_RGB[agentId];
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 2 }}>
        <span style={{ color: "var(--text-hi)", fontWeight: 600 }}>
          {AGENT_ICONS[agentId]} {AGENT_NAMES[agentId]}
        </span>
        <span style={{ color: "var(--muted)" }}>
          {entry.count} bet{entry.count !== 1 ? "s" : ""} · {entry.total.toFixed(3)} Ξ ({pct.toFixed(0)}%)
        </span>
      </div>
      <div style={{ height: 5, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${Math.max(2, pct)}%`,
          background: `rgba(${rgb},0.85)`,
          borderRadius: 99, transition: "width 0.5s ease",
        }} />
      </div>
    </div>
  );
}

// ─── PaperBetPanel ────────────────────────────────────────────────────────────

export default function PaperBetPanel({ battleId }: { battleId: string }) {
  const [data,       setData]       = useState<BetData | null>(null);
  const [board,      setBoard]      = useState<PaperLeaderboardEntry[]>([]);
  const [phase,      setPhase]      = useState<"form" | "placed" | "resolved">("form");
  const [nickname,   setNickname]   = useState(randomNickname);
  const [agentId,    setAgentId]    = useState<AgentKey>("safe");
  const [amount,     setAmount]     = useState<number>(0.05);
  const [myBetId,    setMyBetId]    = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [showConf,   setShowConf]   = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Poll bet data ─────────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch(`${API}/paperbets/${battleId}`);
        if (!res.ok || !mounted) return;
        const d = (await res.json()) as BetData;
        setData(d);

        if (d.resolved && phase === "placed" && mounted) {
          setPhase("resolved");
          if (myBetId) {
            const myResult = d.results.find((r) => r.betId === myBetId);
            if (myResult?.won) {
              setShowConf(true);
              setTimeout(() => setShowConf(false), 4500);
            }
          }
        }
      } catch { /* network error — ignore */ }
    }

    void load();
    pollRef.current = setInterval(() => void load(), 2500);
    return () => {
      mounted = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleId, phase, myBetId]);

  // ── Load global leaderboard once resolved ─────────────────────────────────

  useEffect(() => {
    if (phase !== "resolved") return;
    fetch(`${API}/paperbets/leaderboard`)
      .then((r) => r.json())
      .then((d) => setBoard(d as PaperLeaderboardEntry[]))
      .catch(() => { /* ignore */ });
  }, [phase]);

  // ── Place bet ─────────────────────────────────────────────────────────────

  async function handleBet() {
    if (!nickname.trim()) { setError("Please enter a nickname"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API}/paperbets/place`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ battleId, nickname: nickname.trim(), agentId, amountEth: amount }),
      });
      if (res.ok) {
        const bet = (await res.json()) as PaperBet;
        setMyBetId(bet.id);
        setPhase("placed");
      } else {
        const err = (await res.json()) as { error: string; bet?: PaperBet };
        if (err.bet) {
          // Already placed — re-attach
          setMyBetId(err.bet.id);
          setPhase("placed");
        } else {
          setError(err.error ?? "Failed to place bet");
        }
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const pool      = data?.pool ?? {};
  const bets      = data?.bets ?? [];
  const results   = data?.results ?? [];
  const totalPool = Object.values(pool).reduce((s, e) => s + e.total, 0);
  const myResult  = myBetId ? results.find((r) => r.betId === myBetId) : null;

  // ── Render: FORM phase ────────────────────────────────────────────────────

  if (phase === "form") {
    return (
      <div className="card" style={{ marginBottom: "1rem" }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <h3 style={{ marginBottom: 0, fontSize: 14 }}>🎰 Place a Paper Bet</h3>
            <span style={{
              background: "rgba(88,166,255,.12)", color: "#58a6ff",
              fontSize: 9, fontWeight: 700, padding: "2px 7px",
              borderRadius: 99, letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              Free to play
            </span>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            No wallet needed. Pick an agent, wager fake ETH, winner takes the pool.
          </div>
        </div>

        {/* Nickname */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
            Your nickname
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              maxLength={40}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Enter a nickname…"
              style={{ flex: 1, fontSize: 13, padding: "0.45rem 0.7rem" }}
            />
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: "0.45rem 0.7rem", flexShrink: 0 }}
              onClick={() => setNickname(randomNickname())}
              title="Random nickname"
            >
              🎲
            </button>
          </div>
        </div>

        {/* Agent selector */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6 }}>
            Pick an agent to win
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {AGENTS.map((a) => {
              const isSelected = agentId === a;
              const hex        = AGENT_HEX[a];
              const rgb        = AGENT_RGB[a];
              const poolEntry  = pool[a] ?? { count: 0, total: 0 };
              const crowdPct   = totalPool > 0 ? Math.round((poolEntry.total / totalPool) * 100) : 0;
              return (
                <button
                  key={a}
                  onClick={() => setAgentId(a)}
                  style={{
                    background:   isSelected ? `rgba(${rgb},.13)` : "var(--bg)",
                    border:       `2px solid ${isSelected ? hex : "var(--border)"}`,
                    borderRadius: "var(--radius)",
                    padding:      "0.7rem 0.5rem",
                    cursor:       "pointer",
                    textAlign:    "center",
                    transition:   "border-color 0.15s, background 0.15s",
                  }}
                >
                  <div style={{ fontSize: "1.5rem", marginBottom: 3 }}>{AGENT_ICONS[a]}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-hi)", marginBottom: 2 }}>
                    {AGENT_NAMES[a]}
                  </div>
                  <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 6 }}>
                    {AGENT_TAGLINE[a]}
                  </div>
                  {/* Crowd bar */}
                  <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden", marginBottom: 3 }}>
                    <div style={{
                      height: "100%", width: `${Math.max(totalPool > 0 ? 2 : 0, crowdPct)}%`,
                      background: hex, borderRadius: 99,
                    }} />
                  </div>
                  <div style={{ fontSize: 9, color: "var(--muted)" }}>
                    {totalPool > 0 ? `${crowdPct}% crowd` : "No bets yet"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Amount */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6 }}>
            Wager amount (fake Ξ)
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {AMOUNTS.map((a) => (
              <button
                key={a}
                className={amount === a ? "btn btn-primary" : "btn btn-ghost"}
                style={{ fontSize: 11, padding: "0.35rem 0.7rem" }}
                onClick={() => setAmount(a)}
              >
                {a} Ξ
              </button>
            ))}
            <input
              type="number"
              min={0.001}
              max={10}
              step={0.001}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              style={{ width: 72, fontSize: 12, padding: "0.35rem 0.6rem" }}
            />
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>
            If {AGENT_NAMES[agentId]} wins, you share the losers' pool proportionally.
          </div>
        </div>

        {/* Live pool bars (if bets exist) */}
        {totalPool > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Current pool · {totalPool.toFixed(3)} Ξ
            </div>
            {AGENTS.map((a) => pool[a] ? (
              <PoolBar key={a} agentId={a} entry={pool[a]!} totalPool={totalPool} />
            ) : null)}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ fontSize: 11, color: "var(--red)", marginBottom: 10 }}>✗ {error}</div>
        )}

        {/* CTA */}
        <button
          className="btn btn-primary"
          style={{ width: "100%", fontSize: 13 }}
          onClick={() => void handleBet()}
          disabled={submitting}
        >
          {submitting
            ? "Placing bet…"
            : `Bet ${amount} Ξ on ${AGENT_ICONS[agentId]} ${AGENT_NAMES[agentId]}`}
        </button>
      </div>
    );
  }

  // ── Render: PLACED phase ──────────────────────────────────────────────────

  if (phase === "placed") {
    const myBet = bets.find((b) => b.id === myBetId);
    return (
      <div className="card" style={{ marginBottom: "1rem" }}>
        {/* Bet confirmation */}
        <div style={{
          background:   "rgba(63,185,80,.07)",
          border:       "1px solid rgba(63,185,80,.35)",
          borderRadius: "var(--radius)",
          padding:      "0.85rem 1rem",
          marginBottom: 14,
        }}>
          <div style={{ fontWeight: 700, color: "var(--green)", fontSize: 14, marginBottom: 3 }}>
            ✅ Bet placed!
          </div>
          {myBet && (
            <div style={{ fontSize: 12, color: "var(--text)" }}>
              <strong style={{ color: "var(--text-hi)" }}>{myBet.nickname}</strong>
              {" "}wagered{" "}
              <strong style={{ color: "var(--text-hi)" }}>{myBet.amountEth} Ξ</strong>
              {" "}on{" "}
              <strong style={{ color: AGENT_HEX[myBet.agentId as AgentKey] ?? "inherit" }}>
                {AGENT_ICONS[myBet.agentId as AgentKey] ?? "🤖"} {AGENT_NAMES[myBet.agentId as AgentKey] ?? myBet.agentId}
              </strong>
            </div>
          )}
        </div>

        {/* Waiting indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%", background: "var(--yellow)",
            animation: "pulse-slow 1.8s infinite",
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Waiting for battle to finish…
          </span>
        </div>

        {/* Pool bars */}
        {totalPool > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Pool · {totalPool.toFixed(3)} Ξ
            </div>
            {AGENTS.map((a) => pool[a] ? (
              <PoolBar key={a} agentId={a} entry={pool[a]!} totalPool={totalPool} />
            ) : null)}
          </div>
        )}

        {/* Lobby */}
        {bets.length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {bets.length} bet{bets.length !== 1 ? "s" : ""} placed
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
              {[...bets].reverse().map((b) => {
                const aKey  = b.agentId as AgentKey;
                const hex   = AGENT_HEX[aKey] ?? "#8b949e";
                const isMe  = b.id === myBetId;
                return (
                  <div key={b.id} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "0.3rem 0.6rem",
                    background: isMe ? "rgba(88,166,255,.07)" : "var(--bg)",
                    borderRadius: "var(--radius)",
                    border: isMe ? "1px solid rgba(88,166,255,.3)" : "1px solid transparent",
                    fontSize: 11,
                  }}>
                    <span style={{
                      background: `${hex}18`, border: `1px solid ${hex}55`,
                      color: hex, borderRadius: 99,
                      fontSize: 9, padding: "1px 6px", fontWeight: 700, flexShrink: 0,
                    }}>
                      {AGENT_ICONS[aKey] ?? "🤖"} {AGENT_NAMES[aKey] ?? b.agentId}
                    </span>
                    <span style={{ color: "var(--text-hi)", fontWeight: isMe ? 700 : 400 }}>
                      {b.nickname}{isMe ? " (you)" : ""}
                    </span>
                    <span style={{ marginLeft: "auto", color: "var(--muted)", flexShrink: 0 }}>
                      {b.amountEth} Ξ
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Render: RESOLVED phase ────────────────────────────────────────────────

  const won  = myResult?.won ?? false;
  const pnl  = myResult?.pnlEth ?? 0;
  const roi  = myResult?.roiPct ?? 0;

  return (
    <>
      {showConf && <WinConfetti />}

      <div className="card" style={{ marginBottom: "1rem" }}>

        {/* My result banner */}
        {myResult ? (
          <div style={{
            background:   won ? "rgba(63,185,80,.08)" : "rgba(248,81,73,.07)",
            border:       `2px solid ${won ? "var(--green)" : "var(--red)"}`,
            borderRadius: "var(--radius)",
            padding:      "1rem 1.1rem",
            marginBottom: 16,
            textAlign:    "center",
          }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 4 }}>
              {won ? "🏆" : "💀"}
            </div>
            <div style={{
              fontSize: 18, fontWeight: 800,
              color: won ? "var(--green)" : "var(--red)",
              marginBottom: 4,
            }}>
              {won ? "You Won!" : "Rekt."}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
              {myResult.nickname} bet {myResult.amountEth} Ξ on{" "}
              {AGENT_ICONS[myResult.agentId as AgentKey] ?? "🤖"} {AGENT_NAMES[myResult.agentId as AgentKey] ?? myResult.agentId}
            </div>
            <div style={{
              fontSize: 22, fontWeight: 800,
              color: pnl >= 0 ? "var(--green)" : "var(--red)",
            }}>
              {pnl >= 0 ? "+" : ""}{pnl.toFixed(4)} Ξ
              <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 8, color: "var(--muted)" }}>
                ({roi >= 0 ? "+" : ""}{roi.toFixed(1)}% ROI)
              </span>
            </div>

            {/* Badge chips */}
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
              {won && <span style={{ background: "rgba(63,185,80,.15)", color: "var(--green)", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 99 }}>🏆 Winner</span>}
              {!won && <span style={{ background: "rgba(248,81,73,.12)", color: "var(--red)",   fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 99 }}>💀 Rekt</span>}
              {roi > 100 && <span style={{ background: "rgba(210,153,34,.15)", color: "#d29922", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 99 }}>🔥 Big Win</span>}
            </div>
          </div>
        ) : (
          <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
            Battle resolved — no bet placed by you.
          </div>
        )}

        {/* All results */}
        {results.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Results · {results.length} bet{results.length !== 1 ? "s" : ""}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
              {[...results]
                .sort((a, b) => b.pnlEth - a.pnlEth)
                .map((r) => {
                  const aKey  = r.agentId as AgentKey;
                  const hex   = AGENT_HEX[aKey] ?? "#8b949e";
                  const isMe  = r.betId === myBetId;
                  return (
                    <div key={r.betId} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "0.35rem 0.65rem",
                      background: isMe ? "rgba(88,166,255,.07)" : "var(--bg)",
                      border: `1px solid ${isMe ? "rgba(88,166,255,.3)" : "transparent"}`,
                      borderRadius: "var(--radius)",
                      fontSize: 11,
                    }}>
                      <span style={{ fontSize: "1rem", flexShrink: 0 }}>
                        {r.won ? "🏆" : "💀"}
                      </span>
                      <span style={{
                        background: `${hex}18`, border: `1px solid ${hex}55`,
                        color: hex, borderRadius: 99,
                        fontSize: 9, padding: "1px 6px", fontWeight: 700, flexShrink: 0,
                      }}>
                        {AGENT_ICONS[aKey] ?? "🤖"} {AGENT_NAMES[aKey] ?? r.agentId}
                      </span>
                      <span style={{ color: "var(--text-hi)", fontWeight: isMe ? 700 : 400, flex: 1 }}>
                        {r.nickname}{isMe ? " (you)" : ""}
                      </span>
                      <span style={{ color: "var(--muted)", flexShrink: 0, fontSize: 10 }}>
                        {r.amountEth} Ξ
                      </span>
                      <span style={{
                        fontWeight: 700, flexShrink: 0,
                        color: r.pnlEth >= 0 ? "var(--green)" : "var(--red)",
                      }}>
                        {r.pnlEth >= 0 ? "+" : ""}{r.pnlEth.toFixed(4)} Ξ
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Mini global leaderboard */}
        {board.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 10, color: "var(--muted)", marginBottom: 8,
              fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
              display: "flex", justifyContent: "space-between",
            }}>
              <span>Global Leaderboard</span>
              <span>total P/L</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {board.slice(0, 5).map((e, i) => {
                const isMe = e.nickname.toLowerCase() === myResult?.nickname.toLowerCase();
                return (
                  <div key={e.nickname} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "0.3rem 0.6rem",
                    background: isMe ? "rgba(88,166,255,.07)" : "var(--bg)",
                    border: `1px solid ${isMe ? "rgba(88,166,255,.3)" : "transparent"}`,
                    borderRadius: "var(--radius)",
                    fontSize: 11,
                  }}>
                    <span style={{
                      fontWeight: 700, fontSize: 10, width: 16, flexShrink: 0,
                      color: i === 0 ? "#f0c040" : i === 1 ? "#8b949e" : i === 2 ? "#ad8a56" : "var(--muted)",
                    }}>
                      #{i + 1}
                    </span>
                    <span style={{ flex: 1, color: "var(--text-hi)", fontWeight: isMe ? 700 : 400 }}>
                      {e.nickname}{isMe ? " (you)" : ""}
                    </span>
                    {e.streak > 1 && (
                      <span style={{ fontSize: 9, color: "#d29922" }}>🔥 {e.streak}W</span>
                    )}
                    <span style={{ fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>
                      {e.totalBets}B · {e.winRate.toFixed(0)}%
                    </span>
                    <span style={{
                      fontWeight: 700, flexShrink: 0,
                      color: e.totalPnl >= 0 ? "var(--green)" : "var(--red)",
                    }}>
                      {e.totalPnl >= 0 ? "+" : ""}{e.totalPnl.toFixed(4)} Ξ
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Narration: the product pitch */}
        <div style={{
          background:   "rgba(88,166,255,.05)",
          border:       "1px solid rgba(88,166,255,.2)",
          borderRadius: "var(--radius)",
          padding:      "0.85rem 1rem",
          marginBottom: 12,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)", marginBottom: 4 }}>
            🤔 Did you pick the right agent?
          </div>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>
            Each agent has a live <strong style={{ color: "var(--text)" }}>AI Quality Index (AQI)</strong> built
            from real swap data — reliability, safety flags, latency, and gas cost.
            Next time, check the leaderboard before betting.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/agents" className="btn btn-primary" style={{ fontSize: 11 }}>
              📊 See Leaderboard
            </Link>
            <Link href="/swap" className="btn btn-ghost" style={{ fontSize: 11 }}>
              🦄 Swap Simulator
            </Link>
          </div>
        </div>

        {/* Play again */}
        <button
          className="btn btn-ghost"
          style={{ width: "100%", fontSize: 12 }}
          onClick={() => {
            setPhase("form");
            setMyBetId(null);
            setNickname(randomNickname());
            setAgentId("safe");
            setAmount(0.05);
            setError(null);
          }}
        >
          🎲 Bet again on a new battle
        </button>
      </div>
    </>
  );
}
