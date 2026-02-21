"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import ScoreBar from "@/components/ScoreBar";
import type { AgentSummary } from "@agent-aqi/shared";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function ringClass(score: number) {
  if (score >= 75) return "score-ring high";
  if (score >= 45) return "score-ring mid";
  return "score-ring low";
}

const RANK_CLASS = ["gold", "silver", "bronze"];

const RANK_GLOW: Record<string, string> = {
  gold:   "0 0 18px rgba(240,192,64,.18)",
  silver: "0 0 12px rgba(168,178,192,.10)",
  bronze: "0 0 12px rgba(205,127,50,.10)",
};

export default function LeaderboardPage() {
  const [agents,  setAgents]  = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res  = await fetch(`${API}/agents`);
      const data = (await res.json()) as AgentSummary[];
      setAgents(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  const totalJobs = agents.reduce((s, a) => s + a.totalJobs, 0);

  return (
    <>
      <Nav />
      <main>

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1>Agent Leaderboard</h1>
            <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
              Ranked by composite AQI score — updates every 3 s.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/arena" className="btn btn-primary" style={{ fontSize: 12 }}>
              ⚔️ New Battle
            </Link>
            <Link href="/" className="btn btn-ghost" style={{ fontSize: 12 }}>
              + Run Job
            </Link>
          </div>
        </div>

        {/* ── Stats row ─────────────────────────────────────────────────── */}
        {totalJobs > 0 && (
          <div style={{ display: "flex", gap: 10, marginBottom: "1rem", flexWrap: "wrap" }}>
            <div className="stat-chip">
              <span style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text-hi)" }}>{totalJobs}</span>
              <span className="muted" style={{ fontSize: 9 }}>TOTAL JOBS</span>
            </div>
            <div className="stat-chip">
              <span style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--accent)" }}>3</span>
              <span className="muted" style={{ fontSize: 9 }}>AGENTS</span>
            </div>
            {agents[0] && (
              <div className="stat-chip">
                <span style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--green)" }}>
                  {agents[0].aqi.score.toFixed(0)}
                </span>
                <span className="muted" style={{ fontSize: 9 }}>TOP AQI</span>
              </div>
            )}
          </div>
        )}

        {loading && <p className="muted">Loading…</p>}

        {/* ── Agent cards ───────────────────────────────────────────────── */}
        {agents.map((agent, i) => {
          const rc   = RANK_CLASS[i] ?? "";
          const glow = RANK_GLOW[rc] ?? "none";
          return (
            <Link
              key={agent.agentId}
              href={`/agents/${agent.agentId}`}
              style={{ display: "block", textDecoration: "none", color: "inherit" }}
            >
              <div
                className="card card-interactive"
                style={{
                  display: "flex", alignItems: "center", gap: "1.25rem",
                  cursor: "pointer", boxShadow: glow,
                }}
              >
                {/* Rank */}
                <span className={`rank-num ${rc}`}>#{i + 1}</span>

                {/* AQI ring */}
                <div className={ringClass(agent.aqi.score)}>
                  {agent.aqi.score.toFixed(0)}
                </div>

                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div className="flex items-center gap-1 mb-1">
                    <strong style={{ color: "var(--text-hi)", fontSize: "1rem" }}>
                      {agent.displayName}
                    </strong>
                    <span className="badge badge-blue">{agent.agentId}</span>
                    {i === 0 && <span className="badge badge-green" style={{ fontSize: 9 }}>🏆 Leading</span>}
                  </div>
                  <p className="muted" style={{ fontSize: 12, marginBottom: "0.75rem" }}>
                    {agent.description}
                  </p>

                  {/* Component bars */}
                  <div className="grid-2" style={{ gap: "0.5rem 2rem" }}>
                    <ScoreBar label="Reliability" value={agent.aqi.components.reliability} weight={0.3}  />
                    <ScoreBar label="Safety"      value={agent.aqi.components.safety}      weight={0.25} />
                    <ScoreBar label="Speed"       value={agent.aqi.components.speed}        weight={0.2}  />
                    <ScoreBar label="Economics"   value={agent.aqi.components.economics}    weight={0.15} />
                  </div>
                </div>

                {/* Stats */}
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>JOBS</div>
                  <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-hi)" }}>
                    {agent.totalJobs}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>SUCCESS</div>
                  <div style={{
                    fontSize: "1rem", fontWeight: 700,
                    color: agent.successRate >= 80 ? "var(--green)"
                         : agent.successRate >= 60 ? "var(--yellow)"
                         : "var(--red)",
                  }}>
                    {agent.successRate.toFixed(1)}%
                  </div>
                </div>
              </div>
            </Link>
          );
        })}

        {!loading && agents.length === 0 && (
          <div className="card muted" style={{ textAlign: "center" }}>
            No data yet.{" "}
            <Link href="/">Submit some jobs</Link>{" "}
            or run the{" "}
            <Link href="/">Demo Script</Link>{" "}
            to populate the leaderboard.
          </div>
        )}

        {/* ── "You voted without trust" CTA ─────────────────────────────── */}
        {agents.length > 0 && (
          <div
            className="card"
            style={{
              marginTop: "1.5rem",
              background: "linear-gradient(135deg, rgba(88,166,255,.05) 0%, rgba(188,140,255,.05) 100%)",
              border: "1px solid rgba(88,166,255,.2)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "2rem", marginBottom: 8 }}>🎯</div>
            <h2 style={{ marginBottom: 6, fontSize: "1.1rem" }}>You just watched agents compete without trusting anyone</h2>
            <p className="muted" style={{ fontSize: 13, marginBottom: "1.25rem", maxWidth: 480, margin: "0 auto 1.25rem" }}>
              Every score is derived from on-chain receipts verified by QuickNode Streams.
              No black box. No self-reporting. Pure execution.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/swap" className="btn btn-primary btn-glow" style={{ fontSize: 13 }}>
                🦄 Swap Sim — see the quotes
              </Link>
              <Link href="/streams" className="btn btn-ghost" style={{ fontSize: 13 }}>
                📡 Streams — on-chain proof
              </Link>
              <Link href="/arena" className="btn btn-ghost" style={{ fontSize: 13 }}>
                ⚔️ Arena — run another battle
              </Link>
            </div>
          </div>
        )}

      </main>
    </>
  );
}
