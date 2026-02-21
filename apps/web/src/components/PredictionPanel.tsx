"use client";

/**
 * PredictionPanel
 *
 * "Predict the winner" UI for a single battle.
 * Renders nothing when NEXT_PUBLIC_PREDICTION_ENABLED !== "true".
 *
 * Features:
 *  - 3 agent selector buttons with live ETH pot bars (polled from API)
 *  - Stake amount input (default 0.0001 ETH, labeled "refundable deposit")
 *  - Lightweight wallet connect via EIP-1193 (no wagmi/RainbowKit)
 *  - Post-resolution: outcome message, Withdraw deposit, Claim points
 *  - Narration banner after placing a prediction → CTA to /agents
 *  - Base Sepolia testnet badge
 *  - POST /participation only when signed in (JWT auth); address taken from token server-side
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AgentId } from "@agent-aqi/shared";
import { useWallet } from "@/hooks/useWallet";
import { useAuth }   from "@/hooks/useAuth";
import {
  PREDICTION_ENABLED,
  callPlacePrediction,
  callWithdraw,
  callClaimPoints,
} from "@/lib/predictionContract";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// ─── Agent metadata ───────────────────────────────────────────────────────────

const AGENT_ICONS: Record<string, string> = { safe: "🛡️", fast: "⚡", cheap: "♻️" };
const AGENT_NAMES: Record<string, string> = { safe: "SafeGuard", fast: "SpeedRunner", cheap: "GasOptimizer" };

// RGB values for inline rgba() usage
const AGENT_RGB: Record<string, string> = {
  safe:  "63,185,80",
  fast:  "210,153,34",
  cheap: "88,166,255",
};
const AGENT_HEX: Record<string, string> = {
  safe:  "#3fb950",
  fast:  "#d29922",
  cheap: "#58a6ff",
};

const AGENTS: AgentId[] = ["safe", "fast", "cheap"];

// ─── API response shape ───────────────────────────────────────────────────────

interface PredictionData {
  enabled:       boolean;
  totals:        { safe: string; fast: string; cheap: string } | null;
  totalWei:      string | null;
  resolved:      boolean;
  winnerAgentId: AgentId | null;
  userPrediction: {
    agentId:   AgentId;
    agentName: AgentId;
    amountWei: string;
    withdrawn: boolean;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtEth(wei: string | bigint): string {
  const n = typeof wei === "bigint" ? wei : BigInt(wei);
  const eth = Number(n) / 1e18;
  if (eth === 0) return "0";
  if (eth < 0.00001) return eth.toExponential(1);
  return eth.toFixed(4);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PredictionPanel({ battleId }: { battleId: string }) {
  const wallet = useWallet();
  const auth   = useAuth();

  const [data,          setData]          = useState<PredictionData | null>(null);
  const [selected,      setSelected]      = useState<AgentId | null>(null);
  const [stakeEth,      setStakeEth]      = useState("0.0001");
  const [txStatus,      setTxStatus]      = useState<"idle" | "pending" | "success" | "error">("idle");
  const [txHash,        setTxHash]        = useState<string | null>(null);
  const [txError,       setTxError]       = useState<string | null>(null);
  const [showNarration, setShowNarration] = useState(false);

  // ── Data fetch ────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const qs  = wallet.address ? `?address=${wallet.address}` : "";
      const res = await fetch(`${API}/prediction/${battleId}${qs}`);
      if (!res.ok) return;
      const d = (await res.json()) as PredictionData;
      setData(d);
    } catch { /* ignore network errors */ }
  }, [battleId, wallet.address]);

  useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), 3000);
    return () => clearInterval(id);
  }, [fetchData]);

  // ── Feature guard ─────────────────────────────────────────────────────────

  if (!PREDICTION_ENABLED) return null;
  if (data && !data.enabled) return null;

  // Loading state
  if (!data) {
    return (
      <div className="card" style={{ marginBottom: "1rem" }}>
        <span className="muted" style={{ fontSize: 12 }}>Loading prediction pool…</span>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const totals     = data.totals;
  const totalWei   = BigInt(data.totalWei ?? "0");
  const isResolved = data.resolved;
  const winner     = data.winnerAgentId;
  const userPred   = data.userPrediction;
  const hasPlaced  = Boolean(userPred && BigInt(userPred.amountWei) > BigInt(0));

  const potWei: Record<AgentId, bigint> = {
    safe:  BigInt(totals?.safe  ?? "0"),
    fast:  BigInt(totals?.fast  ?? "0"),
    cheap: BigInt(totals?.cheap ?? "0"),
  };

  function pct(n: bigint): number {
    if (totalWei === BigInt(0)) return 0;
    return Math.max(2, Number((n * BigInt(100)) / totalWei));
  }

  // ── Tx handlers ───────────────────────────────────────────────────────────

  async function handlePredict() {
    if (!wallet.address) { await wallet.connect(); return; }
    if (wallet.chainId !== wallet.BASE_SEPOLIA_CHAIN_ID) {
      await wallet.switchToBaseSepolia(); return;
    }
    if (!selected) return;

    setTxStatus("pending");
    setTxError(null);
    try {
      const hash = await callPlacePrediction(battleId, selected, stakeEth, wallet.address);
      setTxHash(hash);
      setTxStatus("success");
      setShowNarration(true);
      // Record participation on backend — requires auth; skip silently if not signed in
      if (auth.token) {
        void fetch(`${API}/participation`, {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${auth.token}`,
          },
          // Address is NOT sent — the server reads it from the verified JWT
          body: JSON.stringify({ battleId, agentId: selected, txHash: hash }),
        }).catch(() => { /* best-effort */ });
      }
      setTimeout(() => void fetchData(), 2500);
    } catch (err) {
      setTxStatus("error");
      setTxError(String(err).replace(/Error: /g, ""));
    }
  }

  async function handleWithdraw() {
    if (!wallet.address) { await wallet.connect(); return; }
    setTxStatus("pending");
    setTxError(null);
    try {
      const hash = await callWithdraw(battleId, wallet.address);
      setTxHash(hash);
      setTxStatus("success");
      setTimeout(() => void fetchData(), 2500);
    } catch (err) {
      setTxStatus("error");
      setTxError(String(err).replace(/Error: /g, ""));
    }
  }

  async function handleClaimPoints() {
    if (!wallet.address) { await wallet.connect(); return; }
    setTxStatus("pending");
    setTxError(null);
    try {
      const hash = await callClaimPoints(battleId, wallet.address);
      setTxHash(hash);
      setTxStatus("success");
      setTimeout(() => void fetchData(), 2500);
    } catch (err) {
      setTxStatus("error");
      setTxError(String(err).replace(/Error: /g, ""));
    }
  }

  const canPredict = !hasPlaced && !isResolved && txStatus !== "pending";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <h3 style={{ marginBottom: 0, fontSize: 14 }}>🎯 Predict the Winner</h3>
            <span style={{
              background: "rgba(210,153,34,.15)", color: "#d29922",
              fontSize: 9, fontWeight: 700, padding: "2px 7px",
              borderRadius: 99, letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              Testnet
            </span>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            Stake a refundable deposit on the agent you think will win
          </div>
        </div>
        {wallet.address && (
          <span style={{
            fontSize: 10, color: "var(--muted)", fontFamily: "monospace",
            background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: 99, padding: "2px 8px", flexShrink: 0,
          }}>
            {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
          </span>
        )}
      </div>

      {/* ── Agent selector buttons ────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
        {AGENTS.map((agentId) => {
          const pot        = potWei[agentId];
          const isSelected = selected === agentId;
          const isUserPick = userPred?.agentId === agentId;
          const isWinner   = winner === agentId;
          const rgb        = AGENT_RGB[agentId]!;
          const hex        = AGENT_HEX[agentId]!;
          const widthPct   = pct(pot);
          const disabled   = !canPredict;

          return (
            <button
              key={agentId}
              onClick={() => canPredict && setSelected(agentId)}
              disabled={disabled}
              style={{
                background:   isSelected ? `rgba(${rgb},.14)` : "var(--bg)",
                border:       `2px solid ${isWinner || isSelected ? hex : isUserPick ? hex + "77" : "var(--border)"}`,
                borderRadius: "var(--radius)",
                padding:      "0.65rem 0.5rem",
                cursor:       disabled ? "default" : "pointer",
                textAlign:    "center",
                transition:   "border-color 0.15s, background 0.15s",
                position:     "relative",
                overflow:     "hidden",
              }}
            >
              {/* Winner ribbon */}
              {isWinner && (
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0,
                  background: hex, fontSize: 8, fontWeight: 700,
                  color: "#000", padding: "2px 0", letterSpacing: "0.06em",
                }}>
                  WINNER
                </div>
              )}

              <div style={{ marginTop: isWinner ? 14 : 0 }}>
                <div style={{ fontSize: "1.4rem", marginBottom: 2 }}>{AGENT_ICONS[agentId]}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-hi)", marginBottom: 5 }}>
                  {AGENT_NAMES[agentId]}
                </div>

                {/* Pot bar */}
                <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 99, height: 4, margin: "0 0 4px", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 99,
                    background: hex,
                    width: totalWei > BigInt(0) ? `${widthPct}%` : "0%",
                    transition: "width 0.5s ease",
                  }} />
                </div>

                <div style={{ fontSize: 10, color: "var(--muted)" }}>
                  {fmtEth(pot)} ETH
                </div>

                {isUserPick && (
                  <div style={{ fontSize: 9, color: hex, fontWeight: 700, marginTop: 3, letterSpacing: "0.04em" }}>
                    YOUR PICK
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Stake input + action button ──────────────────────────────────── */}
      {!hasPlaced && !isResolved && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
              Deposit (ETH)
            </label>
            <input
              type="number"
              min="0.00001"
              step="0.0001"
              value={stakeEth}
              onChange={(e) => setStakeEth(e.target.value)}
              style={{ width: 100, fontSize: 12, padding: "0.35rem 0.6rem" }}
            />
          </div>

          {!wallet.address ? (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: "0.42rem 1rem" }}
              onClick={() => void wallet.connect()}
              disabled={wallet.connecting}
            >
              {wallet.connecting ? "Connecting…" : "Connect Wallet"}
            </button>
          ) : wallet.chainId !== wallet.BASE_SEPOLIA_CHAIN_ID ? (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: "0.42rem 1rem" }}
              onClick={() => void wallet.switchToBaseSepolia()}
            >
              Switch to Base Sepolia
            </button>
          ) : (
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: "0.42rem 1rem" }}
              onClick={() => void handlePredict()}
              disabled={!selected || txStatus === "pending"}
            >
              {txStatus === "pending"
                ? "Signing…"
                : selected
                  ? `Predict ${AGENT_NAMES[selected] ?? selected}`
                  : "Select an agent ↑"}
            </button>
          )}
        </div>
      )}

      {/* ── Post-resolution outcome ──────────────────────────────────────── */}
      {isResolved && (
        <div style={{
          background:   userPred && winner && userPred.agentId === winner
            ? "rgba(63,185,80,.08)" : "rgba(139,148,158,.06)",
          border:       `1px solid ${userPred && winner && userPred.agentId === winner ? "var(--green)" : "var(--border)"}`,
          borderRadius: "var(--radius)",
          padding:      "0.85rem 1rem",
          marginBottom: 8,
          fontSize:     13,
        }}>
          {userPred ? (
            <>
              {winner && userPred.agentId === winner ? (
                <div style={{ color: "var(--green)", fontWeight: 700, marginBottom: 6 }}>
                  🎉 Correct! You picked {AGENT_ICONS[userPred.agentId]} {AGENT_NAMES[userPred.agentId]}
                </div>
              ) : (
                <div style={{ color: "var(--text)", fontWeight: 600, marginBottom: 6 }}>
                  You picked {AGENT_ICONS[userPred.agentId] ?? ""} {AGENT_NAMES[userPred.agentId] ?? userPred.agentId}
                  {winner && (
                    <span className="muted">
                      {" "}· Winner: {AGENT_ICONS[winner]} {AGENT_NAMES[winner]}
                    </span>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {!userPred.withdrawn && (
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: "0.35rem 0.85rem" }}
                    onClick={() => void handleWithdraw()}
                    disabled={txStatus === "pending"}
                  >
                    {txStatus === "pending" ? "…" : "↩ Withdraw Deposit"}
                  </button>
                )}
                {winner && userPred.agentId === winner && (
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: "0.35rem 0.85rem" }}
                    onClick={() => void handleClaimPoints()}
                    disabled={txStatus === "pending"}
                  >
                    ⭐ Claim Points
                  </button>
                )}
                {userPred.withdrawn && (
                  <span className="badge badge-green" style={{ fontSize: 10 }}>✓ Deposit returned</span>
                )}
              </div>
            </>
          ) : winner ? (
            <div className="muted" style={{ fontSize: 12 }}>
              Battle resolved · Winner: {AGENT_ICONS[winner]} {AGENT_NAMES[winner]}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>Battle resolved — no prediction placed.</div>
          )}
        </div>
      )}

      {/* ── Tx feedback ─────────────────────────────────────────────────── */}
      {txStatus === "success" && txHash && (
        <div style={{ fontSize: 11, color: "var(--green)", marginBottom: 6 }}>
          ✓ Tx submitted:{" "}
          <a
            href={`https://sepolia.basescan.org/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontFamily: "monospace", color: "var(--accent)" }}
          >
            {txHash.slice(0, 14)}…
          </a>
        </div>
      )}
      {txStatus === "error" && txError && (
        <div style={{ fontSize: 11, color: "var(--red)", marginBottom: 6 }}>✗ {txError}</div>
      )}
      {wallet.error && (
        <div style={{ fontSize: 11, color: "var(--yellow)" }}>{wallet.error}</div>
      )}

      {/* ── Narration banner ─────────────────────────────────────────────── */}
      {showNarration && (
        <div style={{
          marginTop:    10,
          background:   "rgba(88,166,255,.07)",
          border:       "1px solid rgba(88,166,255,.25)",
          borderRadius: "var(--radius)",
          padding:      "0.85rem 1rem",
          animation:    "fadeIn 0.4s ease",
          position:     "relative",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)", marginBottom: 5 }}>
            🤔 You just predicted an agent — without knowing if it was trustworthy.
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
            Every agent has an AI Quality Index (AQI) built from real performance data,
            on-chain receipts, and QuickNode Streams verification. See how your pick compares.
          </div>
          <Link
            href="/agents"
            style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}
          >
            View Agent Leaderboard → Verified by QuickNode Streams
          </Link>
          <button
            onClick={() => setShowNarration(false)}
            style={{
              position: "absolute", top: 8, right: 8,
              background: "none", border: "none",
              color: "var(--muted)", cursor: "pointer",
              fontSize: 14, padding: "2px 4px",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Total pool ───────────────────────────────────────────────────── */}
      {totalWei > BigInt(0) && (
        <div className="muted" style={{ fontSize: 10, marginTop: 10, textAlign: "right" }}>
          Total pool: {fmtEth(totalWei)} ETH · Base Sepolia
        </div>
      )}
    </div>
  );
}
