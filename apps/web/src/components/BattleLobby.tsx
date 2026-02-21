"use client";

/**
 * BattleLobby
 *
 * Two sections:
 *  1. Odds panel — Crowd Odds vs AQI Odds, stacked bars per agent.
 *     - Crowd Odds  = agent pot (ETH) / total pot        (GET /prediction/:battleId)
 *     - AQI Odds    = agent AQI score / sum of AQI scores (GET /agents)
 *     - Mispriced   = |CrowdOdds − AQIOdds| > 0.15 for any agent
 *
 *  2. Participant list — last 20 signed-in predictors (newest first, polled every 3 s).
 *
 * Copy rule: never say "bet" or "gamble" — always "prediction" / "refundable deposit".
 */

import { useEffect, useState } from "react";
import type { AgentSummary } from "@agent-aqi/shared";

const API = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000";

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENTS = ["safe", "fast", "cheap"] as const;
type AgentKey = typeof AGENTS[number];

const AGENT_ICONS: Record<AgentKey, string> = { safe: "🛡️", fast: "⚡", cheap: "♻️" };
const AGENT_NAMES: Record<AgentKey, string> = {
  safe:  "SafeGuard",
  fast:  "SpeedRunner",
  cheap: "GasOptimizer",
};
const AGENT_HEX: Record<AgentKey, string> = {
  safe:  "#3fb950",
  fast:  "#d29922",
  cheap: "#58a6ff",
};

const MISPRICE_THRESHOLD = 0.15; // 15 percentage points

// ─── Types ────────────────────────────────────────────────────────────────────

interface PredTotals { safe: string; fast: string; cheap: string }

interface Participant {
  address:   string;
  agentId:   string;
  txHash?:   string;
  timestamp: number;
  nickname?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ].join(",");
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/** Crowd odds (0–1 per agent) from wei totals. Returns null if pool is empty. */
function crowdOddsFrom(totals: PredTotals | null): Record<AgentKey, number> | null {
  if (!totals) return null;
  // Number(BigInt(…)) is safe for typical hackathon amounts (< 100 ETH)
  const s = Number(BigInt(totals.safe));
  const f = Number(BigInt(totals.fast));
  const c = Number(BigInt(totals.cheap));
  const total = s + f + c;
  if (total === 0) return null;
  return { safe: s / total, fast: f / total, cheap: c / total };
}

/** AQI odds (0–1 per agent) = score share. Returns null if no data. */
function aqiOddsFrom(agents: AgentSummary[]): Record<AgentKey, number> | null {
  const scores: Partial<Record<AgentKey, number>> = {};
  for (const a of agents) {
    if ((AGENTS as readonly string[]).includes(a.agentId)) {
      scores[a.agentId as AgentKey] = a.aqi.score;
    }
  }
  const sum = AGENTS.reduce((n, k) => n + (scores[k] ?? 0), 0);
  if (sum === 0) return null;
  return {
    safe:  (scores.safe  ?? 0) / sum,
    fast:  (scores.fast  ?? 0) / sum,
    cheap: (scores.cheap ?? 0) / sum,
  };
}

// ─── OddsBar ──────────────────────────────────────────────────────────────────

function OddsBar({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{
        fontSize: 9, color: "var(--muted)",
        width: 32, flexShrink: 0, letterSpacing: "0.02em",
      }}>
        {label}
      </span>
      <div style={{
        flex: 1, height: 5,
        background: "rgba(255,255,255,0.07)",
        borderRadius: 99, overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width:  `${Math.max(2, pct * 100)}%`,
          background: color,
          borderRadius: 99,
          transition: "width 0.5s ease",
        }} />
      </div>
      <span style={{
        fontSize: 10, fontWeight: 700, color: "var(--text-hi)",
        width: 28, textAlign: "right", flexShrink: 0,
      }}>
        {(pct * 100).toFixed(0)}%
      </span>
    </div>
  );
}

// ─── BattleLobby ─────────────────────────────────────────────────────────────

export default function BattleLobby({ battleId }: { battleId: string }) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [total,        setTotal]        = useState(0);
  const [predTotals,   setPredTotals]   = useState<PredTotals | null>(null);
  const [agents,       setAgents]       = useState<AgentSummary[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const [partRes, predRes, agentRes] = await Promise.all([
          fetch(`${API}/participation/${battleId}?last=20`),
          fetch(`${API}/prediction/${battleId}`),
          fetch(`${API}/agents`),
        ]);
        if (cancelled) return;

        if (partRes.ok) {
          const d = (await partRes.json()) as { participants: Participant[]; total: number };
          setParticipants(d.participants.slice().reverse());
          setTotal(d.total);
        }

        if (predRes.ok) {
          const d = (await predRes.json()) as {
            enabled?: boolean;
            totals?:  PredTotals | null;
          };
          if (d.enabled && d.totals) setPredTotals(d.totals);
        }

        if (agentRes.ok) {
          setAgents((await agentRes.json()) as AgentSummary[]);
        }
      } catch { /* ignore */ }
    }

    void poll();
    const id = setInterval(() => void poll(), 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [battleId]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const crowd = crowdOddsFrom(predTotals);
  const aqi   = aqiOddsFrom(agents);

  const mispriced = new Set<AgentKey>();
  if (crowd && aqi) {
    for (const a of AGENTS) {
      if (Math.abs(crowd[a] - aqi[a]) > MISPRICE_THRESHOLD) mispriced.add(a);
    }
  }

  const hasOdds = Boolean(crowd || aqi);

  if (!hasOdds && participants.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center",
        justifyContent: "space-between", marginBottom: 12,
        flexWrap: "wrap", gap: 8,
      }}>
        <h3 style={{ marginBottom: 0, fontSize: 13 }}>👥 Battle Lobby</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {mispriced.size > 0 && (
            <span style={{
              background: "rgba(210,153,34,.18)", color: "#d29922",
              fontSize: 9, fontWeight: 700, padding: "2px 8px",
              borderRadius: 99, letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              🔥 Mispriced
            </span>
          )}
          <span className="muted" style={{ fontSize: 11 }}>
            {total} participant{total !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Odds panel ─────────────────────────────────────────────────────── */}
      {hasOdds && (
        <div style={{ marginBottom: participants.length > 0 ? 14 : 0 }}>

          <div style={{
            fontSize: 9, color: "var(--muted)",
            textTransform: "uppercase", letterSpacing: "0.06em",
            fontWeight: 600, marginBottom: 8,
          }}>
            Odds · Crowd vs AQI
          </div>

          {/* Three-column agent grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {AGENTS.map((agentId) => {
              const isMispriced = mispriced.has(agentId);
              const hex         = AGENT_HEX[agentId];
              const rgb         = hexToRgb(hex);
              const crowdPct    = crowd?.[agentId] ?? 0;
              const aqiPct      = aqi?.[agentId]   ?? 0;

              // Human-readable direction hint
              const dirLabel =
                isMispriced && crowd && aqi
                  ? crowd[agentId] > aqi[agentId]
                    ? "crowd over ↑"
                    : "crowd under ↓"
                  : null;

              return (
                <div
                  key={agentId}
                  style={{
                    background:   isMispriced ? "rgba(210,153,34,.06)" : "var(--bg)",
                    border:       `1px solid ${isMispriced ? "#d29922" : "var(--border)"}`,
                    borderRadius: "var(--radius)",
                    padding:      "0.55rem 0.65rem",
                    transition:   "border-color 0.2s",
                  }}
                >
                  {/* Agent label + misprice badge */}
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 7 }}>
                    <span style={{ fontSize: "1rem", flexShrink: 0 }}>{AGENT_ICONS[agentId]}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: "var(--text-hi)",
                      flex: 1, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {AGENT_NAMES[agentId]}
                    </span>
                    {isMispriced && (
                      <span style={{
                        background: "rgba(210,153,34,.22)", color: "#d29922",
                        fontSize: 7, fontWeight: 800, padding: "1px 5px",
                        borderRadius: 99, letterSpacing: "0.04em",
                        flexShrink: 0, textTransform: "uppercase",
                      }}>
                        mis
                      </span>
                    )}
                  </div>

                  {/* Crowd bar row */}
                  {crowd ? (
                    <OddsBar pct={crowdPct} color={`rgba(${rgb},0.85)`} label="Crowd" />
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 9, color: "var(--muted)", width: 32 }}>Crowd</span>
                      <span style={{ fontSize: 9, color: "var(--muted)" }}>no pool</span>
                    </div>
                  )}

                  <div style={{ height: 4 }} />

                  {/* AQI bar row */}
                  {aqi ? (
                    <OddsBar pct={aqiPct} color={hex} label="AQI" />
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 9, color: "var(--muted)", width: 32 }}>AQI</span>
                      <span style={{ fontSize: 9, color: "var(--muted)" }}>loading…</span>
                    </div>
                  )}

                  {/* Direction hint */}
                  {dirLabel && (
                    <div style={{
                      fontSize: 8, color: "#d29922",
                      fontWeight: 700, marginTop: 5,
                      letterSpacing: "0.04em",
                    }}>
                      {dirLabel}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend / footnote */}
          <div className="muted" style={{ fontSize: 9, marginTop: 8, lineHeight: 1.6 }}>
            <strong style={{ color: "var(--text)" }}>Crowd</strong> = share of refundable deposit pool ·{" "}
            <strong style={{ color: "var(--text)" }}>AQI</strong> = agent quality score share ·{" "}
            {mispriced.size > 0 ? (
              <span style={{ color: "#d29922" }}>
                🔥 Gap &gt;15 pp — crowd prediction diverges from agent quality benchmark.
              </span>
            ) : (
              <span>Odds within 15 pp of quality benchmark.</span>
            )}
            {" "}Testnet only · Deposits 100% refundable.
          </div>
        </div>
      )}

      {/* ── Divider (only when both sections are present) ──────────────────── */}
      {hasOdds && participants.length > 0 && (
        <div style={{
          borderTop: "1px solid var(--border)",
          margin: "0 -1.25rem 12px",
        }} />
      )}

      {/* ── Participant list ─────────────────────────────────────────────────── */}
      {participants.length > 0 && (
        <>
          {hasOdds && (
            <div style={{
              fontSize: 9, color: "var(--muted)",
              textTransform: "uppercase", letterSpacing: "0.06em",
              fontWeight: 600, marginBottom: 6,
            }}>
              Predictions placed
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {participants.slice(0, 20).map((p, i) => {
              const aKey  = p.agentId as AgentKey;
              const color = AGENT_HEX[aKey] ?? "#8b949e";
              const icon  = AGENT_ICONS[aKey] ?? "🤖";
              const name  = AGENT_NAMES[aKey] ?? p.agentId;
              return (
                <div
                  key={`${p.address}-${i}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "0.35rem 0.6rem",
                    borderRadius: "var(--radius)",
                    background: "var(--bg)",
                    fontSize: 12,
                  }}
                >
                  <span style={{
                    background:   `rgba(${hexToRgb(color)},0.12)`,
                    color,
                    border:       `1px solid ${color}`,
                    borderRadius: 99,
                    fontSize:     10, padding: "1px 7px",
                    fontWeight:   700, flexShrink: 0,
                    whiteSpace:   "nowrap",
                  }}>
                    {icon} {name}
                  </span>

                  <span style={{
                    flex: 1, color: "var(--text-hi)",
                    fontFamily: "monospace", fontSize: 11,
                  }}>
                    {p.nickname ? (
                      <>
                        <span style={{ color: "var(--accent)", fontFamily: "inherit" }}>
                          {p.nickname}
                        </span>
                        <span className="muted"> · {shortAddr(p.address)}</span>
                      </>
                    ) : (
                      shortAddr(p.address)
                    )}
                  </span>

                  {p.txHash && (
                    <a
                      href={`https://sepolia.basescan.org/tx/${p.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 10, color: "var(--muted)", flexShrink: 0 }}
                      title={p.txHash}
                    >
                      ↗ tx
                    </a>
                  )}

                  <span className="muted" style={{ fontSize: 10, flexShrink: 0 }}>
                    {timeAgo(p.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
