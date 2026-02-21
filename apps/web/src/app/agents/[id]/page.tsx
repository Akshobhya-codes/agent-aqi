"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import ScoreBar from "@/components/ScoreBar";
import type { AgentSummary, Receipt } from "@agent-aqi/shared";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type AgentDetail = AgentSummary & { receipts: Receipt[] };

// ─── Utility helpers ─────────────────────────────────────────────────────────

function addrShort(addr: string): string {
  if (addr.length < 14) return addr;
  return addr.slice(0, 8) + "…" + addr.slice(-6);
}

/**
 * Preview: show first 32 bytes (64 hex chars) + last 16 bytes (32 hex chars).
 * The gap is labelled with the total byte count.
 */
function calldataPreview(data: string): string {
  if (!data.startsWith("0x")) return data;
  const hex        = data.slice(2);
  const totalBytes = Math.floor(hex.length / 2);
  if (hex.length <= 96) return data; // short enough to show in full
  return (
    "0x" +
    hex.slice(0, 64) +
    `…[${totalBytes} bytes]…` +
    hex.slice(-32)
  );
}

function statusBadge(status: "fulfilled" | "failed") {
  return status === "fulfilled"
    ? <span className="badge badge-green">fulfilled</span>
    : <span className="badge badge-red">failed</span>;
}

// ─── Key-value row (used inside SwapDetailsPanel) ─────────────────────────────

function KV({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "flex-start" }}>
      <span
        style={{
          color:      "var(--muted)",
          minWidth:   80,
          flexShrink: 0,
          fontSize:   11,
          paddingTop: 1,
        }}
      >
        {label}
      </span>
      <span
        className={mono ? "font-mono" : undefined}
        style={{ fontSize: 11, wordBreak: "break-all" }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Swap details panel ───────────────────────────────────────────────────────

function SwapDetailsPanel({ r }: { r: Receipt }) {
  const [copied, setCopied] = useState(false);

  function copyCalldata() {
    if (!r.swapTxRequest) return;
    navigator.clipboard.writeText(r.swapTxRequest.data).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const sectionTitle = (label: string) => (
    <div
      style={{
        color:          "var(--muted)",
        fontWeight:     600,
        fontSize:       10,
        textTransform:  "uppercase",
        letterSpacing:  "0.06em",
        marginBottom:   6,
        marginTop:      2,
      }}
    >
      {label}
    </div>
  );

  return (
    <div className="detail-panel">
      <div className="detail-grid">

        {/* ── Policy Decisions ─────────────────────────────────────────────── */}
        {r.policy && (
          <div>
            {sectionTitle("Policy Decisions")}
            <KV
              label="Preference"
              value={r.policy.preference}
            />
            <KV
              label="Max slippage"
              value={`${r.policy.slippageBps} bps (${(r.policy.slippageBps / 100).toFixed(2)}%)`}
            />
            {r.policy.maxHops !== undefined && (
              <KV label="Max hops" value={String(r.policy.maxHops)} />
            )}
          </div>
        )}

        {/* ── Economics ────────────────────────────────────────────────────── */}
        {r.economics && (
          <div>
            {sectionTitle("Economics")}
            {r.economics.quotedOut && (
              <KV label="Quoted out"    value={r.economics.quotedOut} mono />
            )}
            {r.economics.hopCount !== undefined && (
              <KV label="Route hops"   value={String(r.economics.hopCount)} />
            )}
            {r.economics.gasEstimate && (
              <KV label="Gas estimate" value={r.economics.gasEstimate} />
            )}
          </div>
        )}

        {/* ── Swap Params ──────────────────────────────────────────────────── */}
        {r.swapParams && (
          <div>
            {sectionTitle("Swap Params")}
            <KV label="Input"   value={addrShort(r.swapParams.inputToken)}  mono />
            <KV label="Output"  value={addrShort(r.swapParams.outputToken)} mono />
            <KV label="Amount"  value={r.swapParams.amountIn} />
            <KV label="Chain"   value={String(r.swapParams.chainId)} />
          </div>
        )}

        {/* ── Quote Result ─────────────────────────────────────────────────── */}
        {r.quoteResult && (
          <div>
            {sectionTitle("Uniswap Quote")}
            <KV label="Quoted Out" value={r.quoteResult.quotedOut} />
            <KV label="Route"      value={r.quoteResult.routeSummary} />
          </div>
        )}

        {/* ── On-chain evidence (real mode) ────────────────────────────────── */}
        {r.onChain && (
          <div>
            {sectionTitle("On-Chain")}
            {r.onChain.verifiedBy === "quicknode" && (
              <div style={{ marginBottom: 6 }}>
                <span
                  className="badge badge-green"
                  style={{ fontSize: 10, letterSpacing: "0.03em" }}
                >
                  ✓ Verified by QuickNode Streams
                </span>
              </div>
            )}
            <KV label="Tx Hash"  value={addrShort(r.onChain.txHash)} mono />
            <KV label="Block"    value={String(r.onChain.blockNumber)} />
            <KV label="Chain"    value={String(r.onChain.chainId)} />
            {r.onChain.gasUsed !== undefined && (
              <KV label="Gas Used" value={r.onChain.gasUsed} />
            )}
            {r.onChain.status !== undefined && (
              <KV label="Status" value={r.onChain.status} />
            )}
            {r.onChain.confirmedAt !== undefined && (
              <KV
                label="Confirmed"
                value={new Date(r.onChain.confirmedAt).toLocaleTimeString()}
              />
            )}
          </div>
        )}

        {/* ── Tx Request ───────────────────────────────────────────────────── */}
        {r.swapTxRequest && (
          <div style={{ gridColumn: "1 / -1" }}>
            {sectionTitle("Unsigned Tx Payload")}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 1rem" }}>
              <KV label="To"    value={addrShort(r.swapTxRequest.to)} mono />
              <KV label="Value" value={`${r.swapTxRequest.value} wei`} />
              {r.swapTxRequest.gas && (
                <KV label="Gas limit" value={r.swapTxRequest.gas} />
              )}
            </div>

            {/* Calldata preview */}
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  color:         "var(--muted)",
                  fontSize:      10,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom:  4,
                  fontWeight:    600,
                }}
              >
                Calldata
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <code className="calldata-preview">
                  {calldataPreview(r.swapTxRequest.data)}
                </code>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: "3px 10px", flexShrink: 0, whiteSpace: "nowrap" }}
                  onClick={copyCalldata}
                >
                  {copied ? "Copied ✓" : "Copy full calldata"}
                </button>
              </div>

              {/* Signature placeholder warning — only shown when not yet broadcast */}
              {!r.onChain && (
                <div
                  style={{
                    marginTop:  8,
                    display:    "flex",
                    alignItems: "center",
                    gap:        6,
                    fontSize:   11,
                    color:      "var(--yellow)",
                  }}
                >
                  <span>⚠</span>
                  <span>
                    signature placeholder — Phase 2.3 will sign + send
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Receipt row (with expand toggle) ────────────────────────────────────────

const COL_COUNT = 8; // Job ID | Status | Latency | Gas | Slip | Flags | Done | badge

function ReceiptRow({ r }: { r: Receipt }) {
  const [open, setOpen] = useState(false);
  const hasSwap = Boolean(r.swapParams);

  return (
    <>
      <tr
        onClick={() => hasSwap && setOpen((v) => !v)}
        style={{ cursor: hasSwap ? "pointer" : "default" }}
      >
        {/* Job ID + expand indicator */}
        <td className="font-mono muted" style={{ fontSize: 11 }}>
          {r.jobId.slice(0, 8)}…
          {hasSwap && (
            <span
              style={{
                marginLeft: 4,
                color:      "var(--accent)",
                fontSize:   10,
                verticalAlign: "middle",
              }}
            >
              {open ? "▾" : "▸"}
            </span>
          )}
        </td>
        <td>{statusBadge(r.outcome.status)}</td>
        <td>{r.outcome.latencyMs} ms</td>
        <td>${r.outcome.gasUsedUsd.toFixed(3)}</td>
        <td>{r.outcome.slippageBps} bps</td>
        <td>
          {r.outcome.safetyFlags.length === 0 ? (
            <span className="muted">—</span>
          ) : (
            r.outcome.safetyFlags.map((f) => (
              <span key={f} className="badge badge-yellow" style={{ marginRight: 4 }}>
                {f}
              </span>
            ))
          )}
        </td>
        <td className="muted" style={{ fontSize: 11 }}>
          {new Date(r.completedAt).toLocaleTimeString()}
        </td>
        {/* on-chain / verified / swap badge */}
        <td style={{ textAlign: "right", paddingRight: "0.5rem" }}>
          {r.onChain?.verifiedBy === "quicknode" ? (
            <span className="badge badge-green" style={{ fontSize: 9, letterSpacing: "0.04em" }}>
              ✓ Verified by Streams
            </span>
          ) : r.onChain ? (
            <span className="badge badge-green" style={{ fontSize: 9, letterSpacing: "0.04em" }}>
              on-chain
            </span>
          ) : hasSwap ? (
            <span className="badge badge-blue" style={{ fontSize: 9, letterSpacing: "0.04em" }}>
              swap
            </span>
          ) : null}
        </td>
      </tr>

      {/* Expandable swap details */}
      {open && hasSwap && (
        <tr>
          <td
            colSpan={COL_COUNT}
            style={{ padding: 0, borderBottom: "1px solid var(--border)" }}
          >
            <SwapDetailsPanel r={r} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const [data, setData]       = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`${API}/agents/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as AgentDetail);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading)
    return <><Nav /><main><p className="muted">Loading…</p></main></>;

  if (error || !data)
    return (
      <><Nav /><main>
        <p style={{ color: "var(--red)" }}>{error ?? "Agent not found"}</p>
        <Link href="/agents">← Back</Link>
      </main></>
    );

  const { aqi, receipts } = data;

  return (
    <>
      <Nav />
      <main>
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <Link href="/agents" className="muted" style={{ fontSize: 13 }}>
            ← Leaderboard
          </Link>
        </div>

        <div className="flex items-center gap-3 mb-2">
          <div
            className={
              aqi.score >= 75 ? "score-ring high" :
              aqi.score >= 45 ? "score-ring mid"  : "score-ring low"
            }
            style={{ width: 80, height: 80, fontSize: "1.6rem" }}
          >
            {aqi.score.toFixed(0)}
          </div>
          <div>
            <h1>{data.displayName}</h1>
            <span className="badge badge-blue">{data.agentId}</span>
            <p className="muted mt-1" style={{ fontSize: 13 }}>{data.description}</p>
          </div>
        </div>

        {/* Score breakdown */}
        <div className="card mb-2">
          <h2>AQI Score Breakdown</h2>
          <p className="muted mb-2" style={{ fontSize: 12 }}>
            Based on {aqi.sampleSize} job{aqi.sampleSize !== 1 ? "s" : ""}. Weights are fixed in{" "}
            <code>packages/shared/src/scoring.ts</code>.
          </p>
          <div className="grid-2" style={{ gap: "0.5rem 2rem" }}>
            <ScoreBar label="Reliability" value={aqi.components.reliability} weight={0.3} />
            <ScoreBar label="Safety"      value={aqi.components.safety}      weight={0.25} />
            <ScoreBar label="Speed"       value={aqi.components.speed}        weight={0.2} />
            <ScoreBar label="Economics"   value={aqi.components.economics}    weight={0.15} />
            <ScoreBar label="Feedback"    value={aqi.components.feedback}     weight={0.1} />
          </div>
          <div className="flex items-center gap-2 mt-2" style={{ flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 12 }}>Total jobs:</span>
            <strong>{data.totalJobs}</strong>
            <span className="muted" style={{ fontSize: 12, marginLeft: "0.5rem" }}>Success rate:</span>
            <strong
              style={{
                color: data.successRate >= 80 ? "var(--green)" :
                       data.successRate >= 60 ? "var(--yellow)" : "var(--red)",
              }}
            >
              {data.successRate.toFixed(1)}%
            </strong>
            {(() => {
              const verifiedCount = receipts.slice(-50).filter(
                (r) => r.onChain?.verifiedBy === "quicknode"
              ).length;
              return verifiedCount > 0 ? (
                <>
                  <span className="muted" style={{ fontSize: 12, marginLeft: "0.5rem" }}>
                    Verified receipts (last 50):
                  </span>
                  <span className="badge badge-green" style={{ fontSize: 11 }}>
                    ✓ {verifiedCount}
                  </span>
                </>
              ) : null;
            })()}
          </div>
        </div>

        {/* Receipt history */}
        <div className="card">
          <h2>Recent Receipts (last {receipts.length})</h2>
          {receipts.length === 0 ? (
            <p className="muted">No receipts yet.</p>
          ) : (
            <>
              <p className="muted mb-1" style={{ fontSize: 11 }}>
                Rows marked{" "}
                <span className="badge badge-blue" style={{ fontSize: 9 }}>swap</span>
                {" "}or{" "}
                <span className="badge badge-green" style={{ fontSize: 9 }}>on-chain</span>
                {" "}have Uniswap data — click to expand.{" "}
                <span className="badge badge-green" style={{ fontSize: 9 }}>✓ Verified by Streams</span>
                {" "}means QuickNode confirmed the tx on-chain.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Status</th>
                    <th>Latency</th>
                    <th>Gas (USD)</th>
                    <th>Slippage</th>
                    <th>Flags</th>
                    <th>Completed</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...receipts].reverse().map((r) => (
                    <ReceiptRow key={r.jobId} r={r} />
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </main>
    </>
  );
}
