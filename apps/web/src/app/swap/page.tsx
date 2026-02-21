"use client";

/**
 * Swap Simulator — Uniswap Trading API
 *
 * Real price quotes from the Uniswap Trading API, surfacing per-agent policy
 * differences (slippage tolerance, hop count).
 *
 * Supports Base Mainnet (8453) and Base Sepolia (84532).
 * Defaults to Mainnet for demo — much deeper liquidity and live quotes.
 */

import { useState } from "react";
import Nav from "@/components/Nav";
import Link from "next/link";

const API = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000";

// ─── Network config ───────────────────────────────────────────────────────────

interface NetworkConfig {
  chainId:  number;
  label:    string;
  shortLabel: string;
  pillClass: string;
  explorerBase: string;
  presets: { label: string; tokenIn: string; tokenOut: string; amountIn: string }[];
}

const NETWORKS: Record<string, NetworkConfig> = {
  mainnet: {
    chainId:     8453,
    label:       "Base Mainnet",
    shortLabel:  "Base 8453",
    pillClass:   "mainnet",
    explorerBase:"https://basescan.org",
    presets: [
      {
        label:    "WETH → USDC  (0.001 WETH)",
        tokenIn:  "0x4200000000000000000000000000000000000006",
        tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amountIn: "1000000000000000",
      },
      {
        label:    "USDC → WETH  (1 USDC)",
        tokenIn:  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        tokenOut: "0x4200000000000000000000000000000000000006",
        amountIn: "1000000",
      },
    ],
  },
  sepolia: {
    chainId:     84532,
    label:       "Base Sepolia",
    shortLabel:  "Sepolia 84532",
    pillClass:   "testnet",
    explorerBase:"https://sepolia.basescan.org",
    presets: [
      {
        label:    "WETH → USDC  (0.001 WETH)",
        tokenIn:  "0x4200000000000000000000000000000000000006",
        tokenOut: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        amountIn: "1000000000000000",
      },
      {
        label:    "USDC → WETH  (1 USDC)",
        tokenIn:  "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        tokenOut: "0x4200000000000000000000000000000000000006",
        amountIn: "1000000",
      },
    ],
  },
};

// ─── Agent policy table (for the comparison panel) ────────────────────────────

const AGENTS = [
  { id: "safe",  icon: "🛡️", name: "SafeGuard",    slippageBps: 50,  maxHops: "≤ 2",    color: "#3fb950", pct: "0.5%"  },
  { id: "fast",  icon: "⚡",  name: "SpeedRunner",  slippageBps: 150, maxHops: "∞",      color: "#d29922", pct: "1.5%"  },
  { id: "cheap", icon: "♻️",  name: "GasOptimizer", slippageBps: 30,  maxHops: "≤ 4",    color: "#58a6ff", pct: "0.3%"  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortAddr(a: string) {
  return a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

function isNoLiquidityError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("no quotes") ||
    lower.includes("no route") ||
    lower.includes("insufficient liquidity") ||
    lower.includes("no valid route") ||
    lower.includes("bad gateway") ||
    lower.includes("502")
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuoteResult {
  mode:         string;
  quotedOut:    string;
  routeSummary: string;
  hopCount:     number;
  rawQuote:     Record<string, unknown>;
  params:       { inputToken: string; outputToken: string; amountIn: string; chainId: number };
}

interface QuoteError { error: string; hint?: string; }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SwapSimulatorPage() {
  const [networkKey, setNetworkKey] = useState<"mainnet" | "sepolia">("mainnet");
  const [tokenIn,    setTokenIn]    = useState(NETWORKS["mainnet"]!.presets[0]!.tokenIn);
  const [tokenOut,   setTokenOut]   = useState(NETWORKS["mainnet"]!.presets[0]!.tokenOut);
  const [amountIn,   setAmountIn]   = useState(NETWORKS["mainnet"]!.presets[0]!.amountIn);
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState<QuoteResult | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [showRaw,    setShowRaw]    = useState(false);

  const net = NETWORKS[networkKey]!;

  function switchNetwork(key: "mainnet" | "sepolia") {
    setNetworkKey(key);
    const p = NETWORKS[key]!.presets[0]!;
    setTokenIn(p.tokenIn);
    setTokenOut(p.tokenOut);
    setAmountIn(p.amountIn);
    setResult(null);
    setError(null);
  }

  function applyPreset(idx: number) {
    const p = net.presets[idx];
    if (!p) return;
    setTokenIn(p.tokenIn);
    setTokenOut(p.tokenOut);
    setAmountIn(p.amountIn);
    setResult(null);
    setError(null);
  }

  async function getQuote() {
    setLoading(true);
    setResult(null);
    setError(null);
    setShowRaw(false);

    try {
      const res = await fetch(`${API}/quote`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          inputToken:  tokenIn,
          outputToken: tokenOut,
          amountIn,
          chainId: net.chainId,
        }),
      });

      const body = (await res.json()) as QuoteResult | QuoteError;

      if (!res.ok) {
        const errMsg = (body as QuoteError).error + ((body as QuoteError).hint ? `\n\n${(body as QuoteError).hint!}` : "");
        setError(errMsg);
      } else {
        setResult(body as QuoteResult);
      }
    } catch (e) {
      setError(`Network error: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  const inputValid =
    /^0x[0-9a-fA-F]{40}$/.test(tokenIn) &&
    /^0x[0-9a-fA-F]{40}$/.test(tokenOut) &&
    /^\d+$/.test(amountIn.trim()) &&
    tokenIn.toLowerCase() !== tokenOut.toLowerCase();

  const showLiquidityHint = error && isNoLiquidityError(error);

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 820 }}>

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
            <h1 style={{ marginBottom: 0 }}>Swap Simulator</h1>
            <span className={`network-pill ${net.pillClass}`}>
              ● {net.label}
            </span>
            <span className="bounty-badge bounty-uniswap">🦄 Uniswap</span>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Real Uniswap Trading API quotes — no transaction submitted.
            Shows how each agent's slippage policy changes the outcome.
          </p>
        </div>

        {/* ── Network selector ──────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "1rem", padding: "0.9rem 1.1rem" }}>
          <div className="section-label" style={{ marginBottom: 10 }}>Quote Network</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {(["mainnet", "sepolia"] as const).map((key) => {
              const n = NETWORKS[key]!;
              return (
                <button
                  key={key}
                  onClick={() => switchNetwork(key)}
                  style={{
                    padding: "0.4rem 1rem",
                    borderRadius: "var(--radius)",
                    border: `1px solid ${networkKey === key ? (key === "mainnet" ? "var(--green)" : "var(--yellow)") : "var(--border)"}`,
                    background: networkKey === key
                      ? (key === "mainnet" ? "rgba(63,185,80,.1)" : "rgba(210,153,34,.1)")
                      : "transparent",
                    color: networkKey === key
                      ? (key === "mainnet" ? "var(--green)" : "var(--yellow)")
                      : "var(--text)",
                    cursor: "pointer", fontSize: 12, fontWeight: 600,
                  }}
                >
                  {key === "mainnet" ? "🟢" : "🟡"} {n.label}
                  <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7, fontFamily: "monospace" }}>
                    ({n.chainId})
                  </span>
                </button>
              );
            })}
            <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>
              {networkKey === "mainnet"
                ? "Recommended — deep liquidity for live demo"
                : "Testnet — low liquidity, quotes may fail"}
            </span>
          </div>
        </div>

        {/* ── Input form ────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="section-label">Quick Presets · {net.label}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "1rem" }}>
            {net.presets.map((p, i) => (
              <button
                key={i}
                className="btn btn-ghost"
                style={{ fontSize: 11 }}
                onClick={() => applyPreset(i)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Token In <span className="muted">(ERC-20 address)</span></span>
              <input
                type="text"
                value={tokenIn}
                onChange={(e) => setTokenIn(e.target.value)}
                placeholder="0x420000…"
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Token Out <span className="muted">(ERC-20 address)</span></span>
              <input
                type="text"
                value={tokenOut}
                onChange={(e) => setTokenOut(e.target.value)}
                placeholder="0x833589…"
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Amount In <span className="muted">(smallest unit / wei)</span></span>
              <input
                type="text"
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                placeholder="1000000000000000"
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </label>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="btn btn-primary btn-glow"
                style={{ fontSize: 13 }}
                onClick={() => void getQuote()}
                disabled={!inputValid || loading}
              >
                {loading ? "Fetching quote…" : "🦄 Get Uniswap Quote"}
              </button>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                chainId: {net.chainId}
              </span>
            </div>

            {!inputValid && (tokenIn || tokenOut) && (
              <p style={{ fontSize: 11, color: "var(--red)", margin: 0 }}>
                Both tokens must be valid 0x-prefixed Ethereum addresses and must differ.
              </p>
            )}
          </div>
        </div>

        {/* ── Error ─────────────────────────────────────────────────────── */}
        {error && (
          <div style={{ marginBottom: "1rem" }}>
            <div className="error-box">
              <strong>Error:</strong>{" "}{error}
            </div>

            {/* Liquidity hint */}
            {showLiquidityHint && (
              <div className="hint-box" style={{ marginTop: 8 }}>
                <strong>💡 Tip:</strong>{" "}
                {networkKey === "sepolia"
                  ? <>Base Sepolia has very thin liquidity. Try switching to <strong>Base Mainnet (8453)</strong> above for live quotes.</>
                  : <>Try the WETH → USDC preset — it's the most liquid pair on Base.</>}
              </div>
            )}
          </div>
        )}

        {/* ── Result ────────────────────────────────────────────────────── */}
        {result && (
          <div className="card" style={{ marginBottom: "1rem", animation: "fadeIn 0.3s ease" }}>
            <div className="section-label" style={{ marginBottom: 12 }}>
              Quote Result · mode={result.mode} · chainId={result.params.chainId}
            </div>

            <div className="quote-grid">
              <div className="quote-cell">
                <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Quoted Out</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--green)", fontFamily: "monospace", wordBreak: "break-all" }}>
                  {result.quotedOut}
                </div>
                <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2 }}>
                  {shortAddr(result.params.outputToken)} · smallest unit
                </div>
              </div>

              <div className="quote-cell">
                <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Route</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)", lineHeight: 1.4 }}>
                  {result.routeSummary}
                </div>
              </div>

              <div className="quote-cell" style={{ textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Pool Hops</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: "var(--accent)" }}>
                  {result.hopCount}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12, fontFamily: "monospace" }}>
              {result.params.inputToken} → {result.params.outputToken}
              <br />
              amountIn: {result.params.amountIn} · chainId: {result.params.chainId}
            </div>

            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, marginBottom: showRaw ? 10 : 0 }}
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? "▲ Hide" : "▼ Show"} raw Uniswap response
            </button>

            {showRaw && (
              <pre style={{
                fontSize: 10, color: "var(--muted)",
                background: "var(--bg)", borderRadius: "var(--radius)",
                padding: "0.75rem", overflowX: "auto",
                maxHeight: 380, overflowY: "auto",
                border: "1px solid var(--border)",
              }}>
                {JSON.stringify(result.rawQuote, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* ── Agent policy comparison ────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="section-label">Agent Policy Comparison</div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Each agent uses the same Uniswap endpoint but with different slippage tolerances.
            The winning agent is determined by the battle type (speed / gas / slippage).
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {/* Header */}
            <div className="policy-row policy-row-header">
              <span>Agent</span>
              <span style={{ textAlign: "center" }}>Slippage</span>
              <span style={{ textAlign: "center" }}>Max Hops</span>
              <span style={{ textAlign: "center" }}>Priority</span>
            </div>
            {AGENTS.map((a) => (
              <div key={a.id} className="policy-row">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: "1.1rem" }}>{a.icon}</span>
                  <span style={{ fontWeight: 600, color: "var(--text-hi)" }}>{a.name}</span>
                </div>
                <div style={{ textAlign: "center" }}>
                  <span style={{
                    background: `${a.color}18`, border: `1px solid ${a.color}44`,
                    color: a.color, borderRadius: 99, fontSize: 10, fontWeight: 700,
                    padding: "1px 8px",
                  }}>
                    {a.pct}
                  </span>
                </div>
                <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)" }}>{a.maxHops}</div>
                <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)" }}>
                  {a.id === "safe"  ? "Safety first"   : ""}
                  {a.id === "fast"  ? "Speed first"    : ""}
                  {a.id === "cheap" ? "Gas efficiency" : ""}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14, padding: "0.65rem 0.85rem", background: "var(--bg)", borderRadius: "var(--radius)", border: "1px solid var(--border)", fontSize: 11, color: "var(--muted)" }}>
            All three agents quote the <em>same token pair</em> but with different slippage tolerances.
            In a Speed Race, the fastest response time wins.
            In a Slippage Duel, the tightest execution wins.
            Run a battle in the{" "}
            <Link href="/arena" style={{ color: "var(--accent)" }}>Arena</Link> to see live results.
          </div>
        </div>

        {/* ── How it works ──────────────────────────────────────────────── */}
        <div className="card">
          <div className="section-label">How it works</div>
          <ol style={{ margin: 0, paddingLeft: "1.2em", fontSize: 12, lineHeight: 2, color: "var(--text)" }}>
            <li>Browser <code style={{ fontSize: 10 }}>POST /quote</code> → API server with chainId</li>
            <li>Server calls <code style={{ fontSize: 10 }}>POST trade-api.gateway.uniswap.org/v1/quote</code> with <code style={{ fontSize: 10 }}>x-api-key</code></li>
            <li>Response: <code style={{ fontSize: 10 }}>quotedOut</code>, route hops, full raw object</li>
            <li>Each agent applies its own slippage tolerance (above)</li>
          </ol>
          <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
            No transaction is submitted. The unsigned tx calldata is built separately
            via <code style={{ fontSize: 10 }}>POST /v1/swap</code> and stored on the job receipt
            for Phase 2.3 broadcasting.
          </p>

          {/* Post-quote CTA */}
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <Link href="/arena" className="btn btn-primary" style={{ fontSize: 12 }}>⚔️ Run a Battle</Link>
            <Link href="/agents" className="btn btn-ghost" style={{ fontSize: 12 }}>📊 Leaderboard</Link>
            <Link href="/streams" className="btn btn-ghost" style={{ fontSize: 12 }}>📡 Streams</Link>
          </div>
        </div>

      </main>
    </>
  );
}
