"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import JobForm from "@/components/JobForm";
import EventFeed from "@/components/EventFeed";
import type { AgentSummary } from "@agent-aqi/shared";

const API = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000";

// ─── Demo script config ───────────────────────────────────────────────────────

const DEMO_SEQUENCE: Array<"safest" | "fastest" | "cheapest"> = [
  "safest", "fastest", "cheapest",
  "fastest", "safest", "cheapest",
  "safest", "cheapest", "fastest",
  "cheapest",
];

// ─── Agent display config ─────────────────────────────────────────────────────

const AGENT_META: Record<string, { icon: string; color: string; border: string; bg: string; label: string }> = {
  safe:  { icon: "🛡️", color: "#3fb950", border: "rgba(63,185,80,.35)",   bg: "rgba(63,185,80,.06)",  label: "SafeGuard"    },
  fast:  { icon: "⚡",  color: "#d29922", border: "rgba(210,153,34,.35)",  bg: "rgba(210,153,34,.06)", label: "SpeedRunner"  },
  cheap: { icon: "♻️",  color: "#58a6ff", border: "rgba(88,166,255,.35)",  bg: "rgba(88,166,255,.06)", label: "GasOptimizer" },
};

// ─── Tiny helper ──────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

// ─── Agent mini-card ──────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: AgentSummary }) {
  const meta  = AGENT_META[agent.agentId] ?? AGENT_META["safe"]!;
  const score = agent.aqi.score;
  const ring  = score >= 75 ? "#3fb950" : score >= 45 ? "#d29922" : "#f85149";

  return (
    <div style={{
      background: meta.bg,
      border: `1px solid ${meta.border}`,
      borderRadius: "var(--radius)",
      padding: "1rem",
      textAlign: "center",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
      transition: "transform 0.15s",
    }}>
      <span style={{ fontSize: "1.8rem" }}>{meta.icon}</span>
      <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-hi)" }}>{meta.label}</div>

      {/* AQI ring */}
      <div style={{
        width: 52, height: 52, borderRadius: "50%",
        border: `3px solid ${ring}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, fontSize: 15, color: "var(--text-hi)",
        boxShadow: `0 0 12px ${ring}44`,
      }}>
        {score.toFixed(0)}
      </div>

      {/* Mini stats */}
      <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.6 }}>
        <div>{agent.totalJobs} jobs</div>
        <div style={{ color: agent.successRate >= 80 ? "#3fb950" : "var(--muted)" }}>
          {agent.successRate.toFixed(0)}% ok
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [agents,      setAgents]      = useState<AgentSummary[]>([]);
  const [running,     setRunning]     = useState(false);
  const [progress,    setProgress]    = useState(0);
  const [done,        setDone]        = useState(false);

  const TOTAL = DEMO_SEQUENCE.length;

  // ── Load agent stats ──────────────────────────────────────────────────────

  useEffect(() => {
    function load() {
      fetch(`${API}/agents`)
        .then((r) => r.json())
        .then((d) => setAgents(d as AgentSummary[]))
        .catch(() => {});
    }
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  // ── Demo Script ───────────────────────────────────────────────────────────

  async function runDemo() {
    if (running) return;
    setRunning(true);
    setProgress(0);
    setDone(false);

    for (let i = 0; i < DEMO_SEQUENCE.length; i++) {
      try {
        await fetch(`${API}/jobs`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ jobType: "swap", objective: DEMO_SEQUENCE[i] }),
        });
      } catch { /* ignore — job may still fire */ }
      setProgress(i + 1);
      if (i < DEMO_SEQUENCE.length - 1) await sleep(280);
    }

    setRunning(false);
    setDone(true);
  }

  const pct        = (progress / TOTAL) * 100;
  const totalJobs  = agents.reduce((s, a) => s + a.totalJobs, 0);
  const topAgent   = [...agents].sort((a, b) => b.aqi.score - a.aqi.score)[0];

  return (
    <>
      <Nav />

      <main style={{ maxWidth: 980 }}>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <div style={{ textAlign: "center", padding: "2rem 1rem 1.75rem" }}>

          {/* Bounty pills */}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: "1.25rem" }}>
            <span className="bounty-badge bounty-uniswap">🦄 Uniswap</span>
            <span className="bounty-badge bounty-quicknode">🔗 QuickNode</span>
            <span className="bounty-badge bounty-blockade">🌐 Blockade</span>
          </div>

          <h1 className="gradient-text" style={{ fontSize: "2.2rem", marginBottom: 10, letterSpacing: "-0.03em" }}>
            Agent Quality Index
          </h1>
          <p className="muted" style={{ fontSize: 15, marginBottom: "1.75rem", maxWidth: 520, margin: "0 auto 1.75rem" }}>
            Three autonomous AI agents compete on real Uniswap swaps.
            Fastest response. Lowest gas. Tightest slippage. One winner.
          </p>

          {/* Live stats row */}
          {totalJobs > 0 && (
            <div style={{
              display: "flex", gap: 10, justifyContent: "center",
              marginBottom: "1.5rem", flexWrap: "wrap",
            }}>
              <div className="stat-chip">
                <span style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text-hi)" }}>{totalJobs}</span>
                <span className="muted" style={{ fontSize: 9 }}>JOBS RUN</span>
              </div>
              <div className="stat-chip">
                <span style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--accent)" }}>3</span>
                <span className="muted" style={{ fontSize: 9 }}>AGENTS</span>
              </div>
              {topAgent && (
                <div className="stat-chip">
                  <span style={{ fontSize: "1.3rem", fontWeight: 800, color: "#3fb950" }}>
                    {topAgent.aqi.score.toFixed(0)}
                  </span>
                  <span className="muted" style={{ fontSize: 9 }}>TOP AQI</span>
                </div>
              )}
            </div>
          )}

          {/* Primary CTA row */}
          <div className="hero-cta-row" style={{ marginBottom: 14 }}>
            <button
              className="btn btn-primary btn-glow"
              style={{ fontSize: 15, padding: "0.75rem 2.2rem", letterSpacing: "0.01em" }}
              onClick={() => void runDemo()}
              disabled={running}
            >
              {running
                ? `⏳  Running… ${progress} / ${TOTAL}`
                : done
                  ? "▶ Run Again"
                  : "▶  Demo Script  (10 jobs)"}
            </button>
            <Link href="/arena" className="btn btn-ghost" style={{ fontSize: 14, padding: "0.75rem 1.5rem" }}>
              ⚔️  Arena Battle
            </Link>
          </div>

          {/* Progress bar */}
          {(running || done) && (
            <div style={{ maxWidth: 380, margin: "0 auto 14px" }}>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>
                {progress} / {TOTAL} jobs submitted
              </div>
            </div>
          )}

          {/* Done CTA */}
          {done && (
            <div className="demo-done-banner" style={{ maxWidth: 520, margin: "0 auto 0" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#3fb950", marginBottom: 12 }}>
                ✓  {TOTAL} jobs complete — watch the agents race
              </div>
              <div className="hero-cta-row">
                <Link href="/agents"  className="btn btn-primary" style={{ fontSize: 13 }}>📊 Leaderboard</Link>
                <Link href="/swap"    className="btn btn-ghost"   style={{ fontSize: 13 }}>🦄 Swap Sim</Link>
                <Link href="/streams" className="btn btn-ghost"   style={{ fontSize: 13 }}>📡 Streams</Link>
                <Link href="/arena"   className="btn btn-ghost"   style={{ fontSize: 13 }}>⚔️ Arena</Link>
              </div>
            </div>
          )}
        </div>

        {/* ── Agent showcase ──────────────────────────────────────────────── */}
        {agents.length > 0 && (
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <h3 style={{ marginBottom: 0, fontSize: 13 }}>
                <span style={{ color: "var(--muted)" }}>●</span>
                {" "}Live Agent Status
              </h3>
              <Link href="/agents" style={{ fontSize: 11, color: "var(--muted)" }}>
                Full leaderboard →
              </Link>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {agents.map((a) => <AgentCard key={a.agentId} agent={a} />)}
            </div>
          </div>
        )}

        {/* ── Main content: Job form + Event feed ─────────────────────────── */}
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>

          {/* Single job form */}
          <div style={{ flex: "0 0 auto" }}>
            <JobForm />
          </div>

          {/* Live SSE feed */}
          <div className="card" style={{ flex: 1, minWidth: 300 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <h3 style={{ marginBottom: 0 }}>Live Event Feed</h3>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "var(--green)",
                animation: "pulse-slow 2s ease-in-out infinite",
                flexShrink: 0,
              }} />
            </div>
            <EventFeed />
          </div>
        </div>

        {/* ── Explore more ────────────────────────────────────────────────── */}
        <div className="card" style={{ marginTop: "1rem", background: "rgba(88,166,255,.04)", borderColor: "rgba(88,166,255,.2)" }}>
          <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 12 }}>
            Explore the stack
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>

            <Link href="/arena" style={{ display: "block", textDecoration: "none" }}>
              <div className="card card-interactive" style={{ margin: 0, padding: "0.85rem 1rem" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-hi)", marginBottom: 4 }}>
                  ⚔️ Arena Battle
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  Run speed / gas / slippage duels between agents.
                </div>
              </div>
            </Link>

            <Link href="/swap" style={{ display: "block", textDecoration: "none" }}>
              <div className="card card-interactive" style={{ margin: 0, padding: "0.85rem 1rem" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-hi)", marginBottom: 4 }}>
                  🦄 Swap Simulator
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  Real Uniswap quotes — see how slippage policy changes the outcome.
                </div>
              </div>
            </Link>

            <Link href="/streams" style={{ display: "block", textDecoration: "none" }}>
              <div className="card card-interactive" style={{ margin: 0, padding: "0.85rem 1rem" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-hi)", marginBottom: 4 }}>
                  📡 QuickNode Streams
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  HMAC-verified on-chain swap receipts piped in real-time.
                </div>
              </div>
            </Link>

            <Link href="/agents" style={{ display: "block", textDecoration: "none" }}>
              <div className="card card-interactive" style={{ margin: 0, padding: "0.85rem 1rem" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-hi)", marginBottom: 4 }}>
                  📊 Leaderboard
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  Composite AQI score — reliability, safety, speed, economics.
                </div>
              </div>
            </Link>

          </div>
        </div>

      </main>
    </>
  );
}
