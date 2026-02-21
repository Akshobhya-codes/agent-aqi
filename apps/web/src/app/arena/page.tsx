"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import type { AgentSummary, BattleRecord, BattleType } from "@agent-aqi/shared";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// ─── Static metadata ──────────────────────────────────────────────────────────

const AGENT_ICONS: Record<string, string> = { safe: "🛡️", fast: "⚡", cheap: "♻️" };

const AGENT_POLICIES = {
  safe:  { slippageBps: 50,  maxHops: 2,         preference: "safest"   },
  fast:  { slippageBps: 150, maxHops: undefined,  preference: "fastest"  },
  cheap: { slippageBps: 30,  maxHops: 4,          preference: "cheapest" },
} as const;

const PREF_COLORS: Record<string, { bg: string; border: string; color: string }> = {
  safest:   { bg: "rgba(63,185,80,.12)",  border: "#3fb950", color: "#3fb950" },
  fastest:  { bg: "rgba(210,153,34,.12)", border: "#d29922", color: "#d29922" },
  cheapest: { bg: "rgba(88,166,255,.12)", border: "#58a6ff", color: "#58a6ff" },
};

const BATTLE_TYPES: { id: BattleType; emoji: string; label: string; desc: string }[] = [
  { id: "speed",       emoji: "⚡", label: "Speed Race",        desc: "Lowest latency wins" },
  { id: "gas",         emoji: "💰", label: "Gas Saver",          desc: "Lowest gas cost wins" },
  { id: "slippage",    emoji: "💧", label: "Slippage Duel",      desc: "Tightest slippage wins" },
  { id: "reliability", emoji: "✅", label: "Reliability Sprint", desc: "Best success rate wins" },
];

const MATCHUPS: { ids: string[]; label: string }[] = [
  { ids: ["safe", "fast"],          label: "🛡️ vs ⚡" },
  { ids: ["safe", "cheap"],         label: "🛡️ vs ♻️" },
  { ids: ["fast", "cheap"],         label: "⚡ vs ♻️" },
  { ids: ["safe", "fast", "cheap"], label: "All Three 🔥" },
];

const INPUT_TOKEN  = "0x4200000000000000000000000000000000000006"; // WETH Base Sepolia
const OUTPUT_TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC Base Sepolia

function sliderToWei(v: number)  { return BigInt(Math.round(0.001 * Math.pow(1000, v / 100) * 1e18)).toString(); }
function sliderToEth(v: number)  { return (0.001 * Math.pow(1000, v / 100)).toFixed(4); }
function diffLabel(v: number)    { return v < 25 ? "Easy" : v < 50 ? "Medium" : v < 75 ? "Hard" : "Degen 🔥"; }
function timeAgo(ms: number)     {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ─── x402 modal ───────────────────────────────────────────────────────────────

interface X402Info { instructions: string; receiver: string; amount: string; }

function PaymentModal({
  info, proof, onProofChange, onSubmit, onDismiss, submitting,
}: {
  info: X402Info; proof: string; onProofChange: (v: string) => void;
  onSubmit: () => void; onDismiss: () => void; submitting: boolean;
}) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onDismiss}
    >
      <div className="card" style={{ maxWidth: 420, width: "100%", animation: "fadeIn 0.2s ease" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ marginBottom: 0 }}>⚡ x402 Payment Required</h2>
          <button className="btn btn-ghost" style={{ fontSize: 16, padding: "2px 8px" }} onClick={onDismiss}>✕</button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>{info.instructions}</p>
        <div style={{ background: "var(--bg)", borderRadius: "var(--radius)", padding: "0.75rem 1rem", marginBottom: 14, fontSize: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span className="muted">Receiver</span>
            <code style={{ color: "var(--accent)", fontSize: 11, wordBreak: "break-all", textAlign: "right", maxWidth: "65%" }}>{info.receiver}</code>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="muted">Amount</span>
            <strong style={{ color: "var(--text-hi)" }}>{info.amount}</strong>
          </div>
        </div>
        <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Paste proof token</label>
        <input
          type="text" placeholder="Enter x402 proof…" value={proof}
          onChange={(e) => onProofChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && proof.trim()) onSubmit(); }}
          style={{ width: "100%", boxSizing: "border-box", marginBottom: 12 }}
          autoFocus
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onDismiss}>Cancel</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={submitting || !proof.trim()}>
            {submitting ? "Verifying…" : "Submit Proof →"}
          </button>
        </div>
        <p style={{ fontSize: 10, color: "var(--muted)", marginTop: 10, textAlign: "center" }}>
          x402 demo — proof is a shared secret from the server env
        </p>
      </div>
    </div>
  );
}

// ─── Agent showcase card ──────────────────────────────────────────────────────

function AgentShowcase({ summary }: { summary: AgentSummary }) {
  const pol   = AGENT_POLICIES[summary.agentId as keyof typeof AGENT_POLICIES];
  const cc    = pol ? PREF_COLORS[pol.preference] : PREF_COLORS["safest"]!;
  const score = summary.aqi.score;
  const ring  = score >= 75 ? "var(--green)" : score >= 45 ? "var(--yellow)" : "var(--red)";

  return (
    <div style={{
      flex: 1, minWidth: 175,
      background: "var(--bg)", border: "1px solid var(--border)",
      borderRadius: "var(--radius)", padding: "1rem",
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 8, textAlign: "center",
      transition: "border-color 0.2s",
    }}>
      <span style={{ fontSize: "2rem" }}>{AGENT_ICONS[summary.agentId] ?? "🤖"}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-hi)" }}>{summary.displayName}</div>
        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, lineHeight: 1.4 }}>
          {summary.description.split(".")[0]}.
        </div>
      </div>
      <div style={{
        width: 52, height: 52, borderRadius: "50%",
        border: `3px solid ${ring}`,
        boxShadow: `0 0 12px ${ring}44`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, fontSize: "1rem", color: "var(--text-hi)",
      }}>
        {score.toFixed(0)}
      </div>
      {pol && (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center" }}>
          <span className="policy-chip" style={{ background: cc.bg, border: `1px solid ${cc.border}`, color: cc.color }}>
            {pol.preference}
          </span>
          <span className="policy-chip" style={{ background: "rgba(255,255,255,.06)", border: "1px solid var(--border)", color: "var(--muted)" }}>
            {pol.slippageBps}bps
          </span>
          {pol.maxHops !== undefined && (
            <span className="policy-chip" style={{ background: "rgba(255,255,255,.06)", border: "1px solid var(--border)", color: "var(--muted)" }}>
              ≤{pol.maxHops} hops
            </span>
          )}
        </div>
      )}
      <div style={{ fontSize: 10, color: "var(--muted)" }}>
        {summary.totalJobs} jobs · {summary.successRate.toFixed(0)}% ok
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ArenaPage() {
  const router = useRouter();

  const [agents,        setAgents]        = useState<AgentSummary[]>([]);
  const [execMode,      setExecMode]      = useState("sim");
  const [recentBattles, setRecentBattles] = useState<BattleRecord[]>([]);

  const [battleType, setBattleType] = useState<BattleType>("speed");
  const [matchupIdx, setMatchupIdx] = useState(3);
  const [sliderVal,  setSliderVal]  = useState(30);
  const [demoMode,   setDemoMode]   = useState(true);

  const [starting,   setStarting]   = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [x402Info,  setX402Info]  = useState<X402Info | null>(null);
  const [x402Proof, setX402Proof] = useState("");

  // ── Load data ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const [aRes, hRes, rRes] = await Promise.all([
        fetch(`${API}/agents`),
        fetch(`${API}/health`),
        fetch(`${API}/arena/recent`),
      ]);
      if (aRes.ok) setAgents((await aRes.json()) as AgentSummary[]);
      if (hRes.ok) {
        const h = (await hRes.json()) as { executionMode?: string };
        setExecMode(h.executionMode ?? "sim");
      }
      if (rRes.ok) setRecentBattles((await rRes.json()) as BattleRecord[]);
    } catch { /* network error */ }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  // ── Start battle ─────────────────────────────────────────────────────────

  async function doStart(proof?: string) {
    setStarting(true);
    setStartError(null);

    const agentIds = MATCHUPS[matchupIdx]?.ids ?? ["safe", "fast", "cheap"];
    const swapP = !demoMode
      ? { inputToken: INPUT_TOKEN, outputToken: OUTPUT_TOKEN, amountIn: sliderToWei(sliderVal), chainId: 84532 }
      : undefined;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (proof) headers["x402-proof"] = proof;

    try {
      const res = await fetch(`${API}/arena/battle`, {
        method: "POST", headers,
        body: JSON.stringify({ battleType, agentIds, swapParams: swapP }),
      });
      if (res.status === 402) {
        const b = (await res.json()) as { instructions?: string; receiver?: string; amount?: string };
        setX402Info({ instructions: b.instructions ?? "Payment required.", receiver: b.receiver ?? "", amount: b.amount ?? "" });
        setX402Proof("");
        return;
      }
      if (!res.ok) {
        const b = (await res.json()) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { battleId: string };
      setX402Info(null);
      router.push(`/arena/battle/${data.battleId}`);
    } catch (e) {
      setStartError(String(e));
    } finally {
      setStarting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Nav />
      {x402Info && (
        <PaymentModal
          info={x402Info} proof={x402Proof} onProofChange={setX402Proof}
          onSubmit={() => void doStart(x402Proof.trim())}
          onDismiss={() => setX402Info(null)} submitting={starting}
        />
      )}

      <main style={{ maxWidth: 860 }}>

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <div style={{ textAlign: "center", padding: "2.5rem 0 1.5rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: 8 }}>🏆</div>
          <h1 className="gradient-text" style={{ fontSize: "2.4rem", letterSpacing: "-0.02em", marginBottom: 6 }}>
            Agent Arena
          </h1>
          <p className="muted" style={{ fontSize: 15, marginBottom: "1.25rem" }}>
            Three AIs. One swap. May the best algorithm win.
          </p>

          {/* Bounty alignment */}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: "1.25rem" }}>
            <span className="bounty-badge bounty-uniswap">🦄 Uniswap API</span>
            <span className="bounty-badge bounty-quicknode">🔗 QuickNode Streams</span>
            <span className="bounty-badge bounty-blockade">🌐 Blockade Environments</span>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/arena/home" className="btn btn-ghost" style={{ fontSize: 12 }}>🌐 Agent Home</Link>
            <Link href="/agents"     className="btn btn-ghost" style={{ fontSize: 12 }}>📊 Leaderboard</Link>
            <Link href="/streams"    className="btn btn-ghost" style={{ fontSize: 12 }}>📡 Streams</Link>
            <Link href="/swap"       className="btn btn-ghost" style={{ fontSize: 12 }}>🦄 Swap Sim</Link>
          </div>
        </div>

        {/* ── Agent showcase ──────────────────────────────────────────── */}
        <div className="card mb-2">
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
            Agents · Live AQI
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {agents.length === 0
              ? <p className="muted" style={{ fontSize: 12 }}>Connecting to API…</p>
              : agents.map((s) => <AgentShowcase key={s.agentId} summary={s} />)}
          </div>
        </div>

        {/* ── Battle Builder ──────────────────────────────────────────── */}
        <div className="card mb-2">
          <h2 style={{ marginBottom: 14 }}>⚔️ Battle Builder</h2>

          {/* Battle type */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Battle Type</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {BATTLE_TYPES.map((bt) => (
                <button
                  key={bt.id}
                  onClick={() => setBattleType(bt.id)}
                  className="battle-type-btn"
                  style={{
                    background: battleType === bt.id ? "rgba(88,166,255,.15)" : "transparent",
                    border:     `1px solid ${battleType === bt.id ? "var(--accent)" : "var(--border)"}`,
                    color:      battleType === bt.id ? "var(--accent)" : "var(--text)",
                    boxShadow:  battleType === bt.id ? "0 0 10px rgba(88,166,255,.15)" : "none",
                  }}
                >
                  <span style={{ fontSize: "1.1rem" }}>{bt.emoji}</span>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{bt.label}</span>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{bt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Matchup */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Matchup</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {MATCHUPS.map((m, i) => (
                <button key={i} onClick={() => setMatchupIdx(i)} className={`matchup-btn${matchupIdx === i ? " active" : ""}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Execution + difficulty */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, flexShrink: 0 }}>Execution</div>
              <button className={demoMode ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 11, padding: "3px 12px" }} onClick={() => setDemoMode(true)}>
                Demo (sim)
              </button>
              <button className={!demoMode ? "btn btn-primary" : "btn btn-ghost"} style={{ fontSize: 11, padding: "3px 12px" }} onClick={() => setDemoMode(false)}>
                Quote (real prices)
              </button>
              {execMode !== "sim" && (
                <span className="badge badge-green" style={{ fontSize: 10 }}>
                  {execMode === "real" ? "⛓ on-chain" : "🔢 quote active"}
                </span>
              )}
            </div>

            <div style={{ opacity: demoMode ? 0.4 : 1, pointerEvents: demoMode ? "none" : "auto" }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>
                Difficulty — {sliderToEth(sliderVal)} ETH{" "}
                <span style={{ color: "var(--accent)", fontWeight: 600 }}>{diffLabel(sliderVal)}</span>
              </label>
              <input type="range" min={0} max={100} value={sliderVal} onChange={(e) => setSliderVal(Number(e.target.value))} style={{ width: "100%", marginTop: 6 }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)" }}>
                <span>Easy · 0.001 ETH</span><span>Degen 🔥 · 1 ETH</span>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btn btn-primary btn-glow"
              style={{ fontSize: 15, padding: "0.7rem 2rem", letterSpacing: "0.02em" }}
              onClick={() => void doStart()}
              disabled={starting}
            >
              {starting ? "Launching…" : "🥊 START BATTLE"}
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              {MATCHUPS[matchupIdx]?.label ?? "All Three"} · {BATTLE_TYPES.find((b) => b.id === battleType)?.label}
              {!demoMode && ` · ${sliderToEth(sliderVal)} ETH`}
            </span>
          </div>
          {startError && <p style={{ color: "var(--red)", fontSize: 12, marginTop: 8 }}>{startError}</p>}
        </div>

        {/* ── Prediction teaser ──────────────────────────────────────── */}
        {process.env["NEXT_PUBLIC_PREDICTION_ENABLED"] === "true" && (
          <div className="card mb-2" style={{ background: "rgba(88,166,255,.05)", border: "1px solid rgba(88,166,255,.2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: "1.6rem" }}>🎯</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-hi)", marginBottom: 2 }}>
                  Predict the Winner — Base Sepolia
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Stake a refundable deposit on the agent you think will win.
                  Correct predictions earn on-chain points. 100% refundable regardless of outcome.
                </div>
              </div>
              <span style={{
                background: "rgba(210,153,34,.15)", color: "#d29922",
                fontSize: 9, fontWeight: 700, padding: "2px 8px",
                borderRadius: 99, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0,
              }}>
                Testnet only
              </span>
            </div>
          </div>
        )}

        {/* ── Spectate ──────────────────────────────────────────────────── */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <h2 style={{ marginBottom: 0 }}>👁 Recent Battles</h2>
            {recentBattles.length > 0 && (
              <span className="muted" style={{ fontSize: 11 }}>{recentBattles.length} battles</span>
            )}
          </div>
          {recentBattles.length === 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>No battles yet — fire one up above!</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {recentBattles.map((b) => {
                const bt = BATTLE_TYPES.find((t) => t.id === b.battleType);
                return (
                  <Link key={b.battleId} href={`/arena/battle/${b.battleId}`} className="spectate-row">
                    <span style={{ fontSize: "1.2rem", flexShrink: 0 }}>{bt?.emoji ?? "⚔️"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>
                        {b.agentIds.map((id) => AGENT_ICONS[id] ?? id).join(" vs ")}
                        <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>· {bt?.label}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>{timeAgo(b.createdAt)} · {b.battleId.slice(0, 8)}…</div>
                    </div>
                    {b.status === "complete" && b.winnerAgentId ? (
                      <span className="badge badge-green" style={{ fontSize: 10, flexShrink: 0 }}>🏆 {AGENT_ICONS[b.winnerAgentId]} wins</span>
                    ) : b.status === "complete" ? (
                      <span className="badge badge-yellow" style={{ fontSize: 10, flexShrink: 0 }}>done</span>
                    ) : (
                      <span className="badge badge-yellow" style={{ fontSize: 10, flexShrink: 0, animation: "pulse-slow 2s infinite" }}>live ●</span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

      </main>
    </>
  );
}
