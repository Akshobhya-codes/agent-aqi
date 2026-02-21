"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import PaperBetPanel from "@/components/PaperBetPanel";
import BattleLobby from "@/components/BattleLobby";
import type { BattleRecord, BattleType, SSEEvent } from "@agent-aqi/shared";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// ─── Static metadata ──────────────────────────────────────────────────────────

const AGENT_ICONS: Record<string, string> = { safe: "🛡️", fast: "⚡", cheap: "♻️" };
const AGENT_NAMES: Record<string, string> = { safe: "SafeGuard", fast: "SpeedRunner", cheap: "GasOptimizer" };

const BATTLE_META: Record<BattleType, { emoji: string; label: string }> = {
  speed:       { emoji: "⚡", label: "Speed Race"        },
  gas:         { emoji: "💰", label: "Gas Saver"          },
  slippage:    { emoji: "💧", label: "Slippage Duel"      },
  reliability: { emoji: "✅", label: "Reliability Sprint" },
};

const CONFETTI_COLORS = ["#58a6ff","#3fb950","#f0c040","#f85149","#d29922","#bc8cff","#ff7b72"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function barClass(status: string): string {
  switch (status) {
    case "running":   return "lane-bar s-running";
    case "fulfilled": return "lane-bar s-fulfilled";
    case "failed":    return "lane-bar s-failed";
    default:          return "lane-bar s-pending";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "fulfilled": return "var(--green)";
    case "failed":    return "var(--red)";
    case "running":   return "var(--yellow)";
    default:          return "var(--muted)";
  }
}

function eventRowClass(type: string): string {
  if (type === "fulfilled" || type === "battle_complete") return "event-row fulfilled";
  if (type === "failed")  return "event-row failed";
  if (type === "running") return "event-row running";
  return "event-row queued";
}

// ─── Confetti ─────────────────────────────────────────────────────────────────

function Confetti() {
  const pieces = useMemo(() =>
    Array.from({ length: 52 }, (_, i) => ({
      id:    i,
      left:  Math.random() * 100,
      delay: Math.random() * 1.4,
      dur:   1.6 + Math.random() * 1.4,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size:  6 + Math.random() * 8,
    })), []);

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }}>
      {pieces.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute", left: `${p.left}%`, top: -20,
            width: p.size, height: p.size, background: p.color,
            borderRadius: "50%",
            animation: `confetti-fall ${p.dur}s ease-in ${p.delay}s forwards`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Lane card (per agent) ────────────────────────────────────────────────────

type Scorecard = BattleRecord["scorecards"][number];

function LaneCard({
  card, isWinner, battleType,
}: {
  card: Scorecard; isWinner: boolean; battleType: BattleType;
}) {
  const icon   = AGENT_ICONS[card.agentId]  ?? "🤖";
  const name   = AGENT_NAMES[card.agentId]  ?? card.agentId;
  const sColor = statusColor(card.status);
  const meta   = BATTLE_META[battleType];

  // Which metric is highlighted for this battle type
  const highlight: string | undefined =
    battleType === "speed"       ? (card.latencyMs  !== undefined ? `${card.latencyMs} ms`                  : undefined) :
    battleType === "gas"         ? (card.gasUsedUsd !== undefined ? `$${card.gasUsedUsd.toFixed(3)}`         : undefined) :
    battleType === "slippage"    ? (card.slippageBps !== undefined ? `${card.slippageBps} bps`               : undefined) :
    /* reliability */              (card.status === "fulfilled"    ? "✓ success"                             : undefined);

  return (
    <div
      style={{
        background:   "var(--surface)",
        border:       `2px solid ${isWinner ? "var(--green)" : "var(--border)"}`,
        borderRadius: "var(--radius)",
        padding:      "1.25rem",
        position:     "relative",
        overflow:     "hidden",
        transition:   "border-color 0.3s",
      }}
    >
      {/* Winner ribbon */}
      {isWinner && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          background: "var(--green)", color: "#000",
          fontSize: 10, fontWeight: 700, textAlign: "center",
          padding: "2px 0", letterSpacing: "0.06em",
        }}>
          🏆 WINNER · {meta.label.toUpperCase()}
        </div>
      )}

      <div style={{ marginTop: isWinner ? 20 : 0 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: "2rem" }}>{icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-hi)" }}>{name}</div>
            <div style={{ fontSize: 11, color: sColor, fontWeight: 600 }}>
              {card.status.toUpperCase()}
            </div>
          </div>
          {card.status === "fulfilled" && <span style={{ marginLeft: "auto", fontSize: "1.2rem" }}>✅</span>}
          {card.status === "failed"    && <span style={{ marginLeft: "auto", fontSize: "1.2rem" }}>❌</span>}
        </div>

        {/* Progress bar */}
        <div className="lane-track">
          <div className={barClass(card.status)} />
        </div>

        {/* Highlighted metric (battle type specific) */}
        {highlight && (
          <div style={{
            fontSize: 18, fontWeight: 800, color: isWinner ? "var(--green)" : "var(--text-hi)",
            marginBottom: 8, letterSpacing: "-0.02em",
          }}>
            {highlight}
          </div>
        )}

        {/* All metrics */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 8px", fontSize: 11, color: "var(--muted)" }}>
          {card.latencyMs  !== undefined && <div>⏱ {card.latencyMs} ms</div>}
          {card.gasUsedUsd !== undefined && <div>⛽ ${card.gasUsedUsd.toFixed(3)}</div>}
          {card.slippageBps !== undefined && <div>〰 {card.slippageBps} bps</div>}
          {card.quotedOut  !== undefined && (
            <div style={{ gridColumn: "1 / -1", wordBreak: "break-all", fontSize: 10 }}>
              out: {card.quotedOut.slice(0, 12)}…
            </div>
          )}
          {card.status === "pending" && <div style={{ gridColumn: "1 / -1" }}>Waiting…</div>}
          {card.status === "running" && <div style={{ gridColumn: "1 / -1" }}>Running job…</div>}
        </div>

        {/* Stream verification badge */}
        {card.verifiedByStream && (
          <div style={{ marginTop: 8 }}>
            <span
              className="badge badge-green"
              style={{ fontSize: 9, letterSpacing: "0.04em" }}
            >
              ✓ Verified by Streams
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BattlePage({ params }: { params: { battleId: string } }) {
  const { battleId } = params;

  const [battle,       setBattle]       = useState<BattleRecord | null>(null);
  const [events,       setEvents]       = useState<SSEEvent[]>([]);
  const [showConfetti, setShowConfetti] = useState(false);
  const [copied,       setCopied]       = useState(false);
  const [loading,      setLoading]      = useState(true);

  const logRef = useRef<HTMLDivElement>(null);
  const esRef  = useRef<EventSource | null>(null);

  // ── Poll battle state ─────────────────────────────────────────────────────

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`${API}/arena/battle/${battleId}`);
        if (res.ok) {
          setBattle((await res.json()) as BattleRecord);
        }
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    }

    poll();
    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, [battleId]);

  // ── SSE subscription ──────────────────────────────────────────────────────

  useEffect(() => {
    esRef.current?.close();
    const es = new EventSource(`${API}/events`);
    esRef.current = es;

    es.onmessage = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data as string) as SSEEvent;
        const bid = ev.payload["battleId"] as string | undefined;
        if (!bid || bid !== battleId) return;
        setEvents((prev) => [...prev.slice(-79), ev]);
        if (ev.type === "battle_complete") {
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 4500);
        }
      } catch { /* ignore */ }
    };

    return () => { es.close(); esRef.current = null; };
  }, [battleId]);

  // Auto-scroll log
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  // ── Derived values ────────────────────────────────────────────────────────

  const isComplete = battle?.status === "complete";
  const winner     = battle?.winnerAgentId;
  const meta       = battle ? BATTLE_META[battle.battleType] : null;

  function copyShareLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Nav />
        <main><p className="muted">Loading battle…</p></main>
      </>
    );
  }

  if (!battle) {
    return (
      <>
        <Nav />
        <main>
          <p style={{ color: "var(--red)" }}>Battle not found.</p>
          <Link href="/arena">← Back to Arena</Link>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav />
      {showConfetti && <Confetti />}

      <main style={{ maxWidth: 900 }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.25rem", flexWrap: "wrap" }}>
          <Link href="/arena" className="muted" style={{ fontSize: 13 }}>← Arena</Link>
          <div style={{ flex: 1 }}>
            <h1 style={{ marginBottom: 2, fontSize: "1.4rem" }}>
              {meta?.emoji} {meta?.label ?? battle.battleType}
            </h1>
            <div className="muted" style={{ fontSize: 11 }}>
              {battle.agentIds.map((id) => `${AGENT_ICONS[id] ?? ""} ${AGENT_NAMES[id] ?? id}`).join("  vs  ")}
              <span style={{ marginLeft: 8, opacity: 0.6 }}>{battleId.slice(0, 8)}…</span>
            </div>
          </div>
          {isComplete ? (
            <span className="badge badge-green">Complete</span>
          ) : (
            <span className="badge badge-yellow" style={{ animation: "pulse-slow 2s ease-in-out infinite" }}>Live ●</span>
          )}
        </div>

        {/* ── Agent lanes ────────────────────────────────────────────────── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(${battle.scorecards.length}, 1fr)`,
          gap: 12,
          marginBottom: "1rem",
        }}>
          {battle.scorecards.map((card) => (
            <LaneCard
              key={card.agentId}
              card={card}
              isWinner={card.agentId === winner}
              battleType={battle.battleType}
            />
          ))}
        </div>

        {/* ── Paper bet panel ─────────────────────────────────────────────── */}
        <PaperBetPanel battleId={battleId} />

        {/* ── Battle lobby (participants) ──────────────────────────────────── */}
        <BattleLobby battleId={battleId} />

        {/* ── Winner banner ───────────────────────────────────────────────── */}
        {isComplete && (
          <div className="winner-banner" style={{ marginBottom: "1rem" }}>
            {winner ? (
              <>
                <div style={{ fontSize: "2.2rem", marginBottom: 4 }}>🏆</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)", marginBottom: 4 }}>
                  {AGENT_ICONS[winner]} {AGENT_NAMES[winner] ?? winner} wins!
                </div>
                <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  {meta?.label} battle · {battle.agentIds.length}-agent match
                </div>
              </>
            ) : (
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--muted)", marginBottom: 12 }}>
                Battle complete — no winner determined
              </div>
            )}
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
              onClick={copyShareLink}
            >
              {copied ? "✓ Copied!" : "🔗 Share result"}
            </button>
          </div>
        )}

        {/* ── Event timeline ─────────────────────────────────────────────── */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <h3 style={{ marginBottom: 0 }}>Event Timeline</h3>
            <span className="muted" style={{ fontSize: 11 }}>{events.length} events</span>
          </div>
          <div ref={logRef} className="event-feed" style={{ maxHeight: 280 }}>
            {events.length === 0 ? (
              <span className="muted" style={{ fontSize: 12 }}>
                {isComplete ? "No events captured." : "Waiting for battle events…"}
              </span>
            ) : (
              events.map((ev) => {
                const agentId = ev.payload["agentId"] as string | undefined;
                const lat     = ev.payload["latencyMs"] as number | undefined;
                const gas     = ev.payload["gasUsedUsd"] as number | undefined;
                const slip    = ev.payload["slippageBps"] as number | undefined;
                const winId   = ev.payload["winnerAgentId"] as string | undefined;
                return (
                  <div key={ev.id} className={eventRowClass(ev.type)}>
                    <span className="event-time">
                      {new Date(ev.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span className="event-type" style={{
                      width: 120,
                      color: ev.type === "fulfilled" || ev.type === "battle_complete" ? "var(--green)" :
                             ev.type === "failed"  ? "var(--red)"    :
                             ev.type === "running" ? "var(--yellow)" : "var(--muted)",
                    }}>
                      {ev.type.toUpperCase().replace(/_/g, " ")}
                    </span>
                    <span className="muted" style={{ fontSize: 11, flex: 1 }}>
                      {[
                        agentId && `${AGENT_ICONS[agentId] ?? ""} ${agentId}`,
                        lat     && `${lat}ms`,
                        gas     && `$${gas.toFixed(3)}`,
                        slip    && `${slip}bps`,
                        winId   && `winner=${AGENT_ICONS[winId] ?? winId}`,
                      ].filter(Boolean).join("  ·  ")}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Quick actions ───────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 8, marginTop: "0.75rem", flexWrap: "wrap" }}>
          <Link href="/arena" className="btn btn-primary btn-glow" style={{ fontSize: 12 }}>
            🥊 New Battle
          </Link>
          <Link href="/agents" className="btn btn-ghost" style={{ fontSize: 12 }}>
            📊 Leaderboard
          </Link>
          <Link href="/swap" className="btn btn-ghost" style={{ fontSize: 12 }}>
            🦄 Swap Sim
          </Link>
          <Link href="/streams" className="btn btn-ghost" style={{ fontSize: 12 }}>
            📡 Streams
          </Link>
          {!isComplete && (
            <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
              Battle in progress…
            </span>
          )}
        </div>

        {/* ── Post-battle narrative (complete only) ────────────────────── */}
        {isComplete && (
          <div
            className="card"
            style={{
              marginTop: "0.75rem",
              background: "rgba(88,166,255,.04)",
              border: "1px solid rgba(88,166,255,.2)",
              animation: "fadeIn 0.5s ease",
            }}
          >
            <div style={{ fontSize: "1.2rem", marginBottom: 6 }}>🎯</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-hi)", marginBottom: 4 }}>
              You just watched agents compete — without trusting anyone
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Every score comes from execution metrics. See the Uniswap quote each agent
              gets with its slippage policy, or verify the result on-chain via QuickNode Streams.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/agents"  className="btn btn-primary" style={{ fontSize: 12 }}>📊 Full Leaderboard</Link>
              <Link href="/swap"    className="btn btn-ghost"   style={{ fontSize: 12 }}>🦄 Swap Simulator</Link>
              <Link href="/streams" className="btn btn-ghost"   style={{ fontSize: 12 }}>📡 Streams Proof</Link>
            </div>
          </div>
        )}

      </main>
    </>
  );
}
