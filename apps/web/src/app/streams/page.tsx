"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";
import type { StreamEvent } from "@agent-aqi/shared";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addrShort(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return addr.slice(0, 8) + "…" + addr.slice(-6);
}

function txShort(hash: string): string {
  if (!hash || hash.length < 12) return hash;
  return hash.slice(0, 10) + "…" + hash.slice(-6);
}

function fmtTime(unixSecs: number): string {
  if (!unixSecs) return "—";
  return new Date(unixSecs * 1000).toLocaleTimeString();
}

function statusColor(status: string): string {
  if (status === "success")  return "var(--green)";
  if (status === "reverted") return "var(--red)";
  return "var(--muted)";
}

function statusLabel(status: string): string {
  if (status === "success")  return "success";
  if (status === "reverted") return "reverted";
  return status || "—";
}

// ─── Copy button ─────────────────────────────────────────────────────────────

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }
  return (
    <button
      className="btn btn-ghost"
      onClick={copy}
      style={{ fontSize: 10, padding: "1px 7px", whiteSpace: "nowrap" }}
    >
      {copied ? "✓" : label}
    </button>
  );
}

// ─── Counter chip ─────────────────────────────────────────────────────────────

function Chip({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div
      className="card"
      style={{
        padding:    "0.6rem 1rem",
        display:    "flex",
        flexDirection: "column",
        gap:        2,
        minWidth:   110,
      }}
    >
      <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      <span style={{ fontSize: "1.3rem", fontWeight: 700, color: color ?? "var(--text-hi)" }}>
        {value}
      </span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StreamsPage() {
  const [events,        setEvents]        = useState<StreamEvent[]>([]);
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [emitting,      setEmitting]      = useState(false);
  const [emitError,     setEmitError]     = useState<string | null>(null);
  const [lastFetch,     setLastFetch]     = useState(0);
  const tableRef = useRef<HTMLDivElement>(null);
  const prevLen  = useRef(0);

  // ── Fetch loop ─────────────────────────────────────────────────────────────

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`${API}/streams`);
      if (!res.ok) return;
      const data = (await res.json()) as { events: StreamEvent[]; verifiedCount?: number };
      setEvents(data.events ?? []);
      setVerifiedCount(data.verifiedCount ?? 0);
      setLastFetch(Date.now());
    } catch { /* network error — silent */ }
  }, []);

  useEffect(() => {
    fetchEvents();
    const id = setInterval(fetchEvents, 2000);
    return () => clearInterval(id);
  }, [fetchEvents]);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (events.length > prevLen.current) {
      tableRef.current?.scrollTo({ top: tableRef.current.scrollHeight, behavior: "smooth" });
    }
    prevLen.current = events.length;
  }, [events.length]);

  // ── Counters ───────────────────────────────────────────────────────────────

  const total     = events.length;
  const matched   = events.filter((e) => e.matchedJobId).length;
  const qnEvents  = events.filter((e) => e.source === "quicknode").length;
  const devEvents = events.filter((e) => e.source === "dev").length;

  // events/min: count events whose timestamp falls within the last 60 seconds
  const nowSecs  = Math.floor(Date.now() / 1000);
  const evPerMin = events.filter((e) => nowSecs - e.timestamp < 60).length;

  // ── Dev emit ───────────────────────────────────────────────────────────────

  async function emitTestEvent() {
    setEmitting(true);
    setEmitError(null);
    try {
      const res = await fetch(`${API}/streams/dev/emit`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Immediately refetch so the new event appears without waiting for the 2s poll
      await fetchEvents();
    } catch (e) {
      setEmitError(String(e));
    } finally {
      setEmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Nav />
      <main>
        {/* Header */}
        <div className="flex items-center gap-2 mb-2" style={{ flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <h1>QuickNode Stream Events</h1>
            <p className="muted" style={{ fontSize: 13 }}>
              Live Base Sepolia swap receipts ingested via{" "}
              <code style={{ fontSize: 11 }}>POST /webhooks/quicknode</code>.{" "}
              Refreshes every 2 s.{" "}
              {lastFetch > 0 && (
                <span>Last fetch: {new Date(lastFetch).toLocaleTimeString()}</span>
              )}
            </p>
          </div>

          {/* Dev test button */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
            <button
              className="btn btn-primary"
              onClick={emitTestEvent}
              disabled={emitting}
              style={{ fontSize: 12 }}
            >
              {emitting ? "Emitting…" : "⚡ Emit Test Stream Event"}
            </button>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>
              Dev-only · bypasses signature check
            </span>
            {emitError && (
              <span style={{ fontSize: 11, color: "var(--red)" }}>{emitError}</span>
            )}
          </div>
        </div>

        {/* ── QuickNode Verification panel ─────────────────────────────────── */}
        <div className="card" style={{
          marginBottom: "1rem",
          borderColor: "var(--green)",
          background: "rgba(63,185,80,.04)",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{
                  background: "rgba(63,185,80,.18)", color: "var(--green)",
                  fontSize: 9, fontWeight: 700, padding: "2px 8px",
                  borderRadius: 99, letterSpacing: "0.06em", textTransform: "uppercase",
                }}>
                  🔗 Primary Source of Truth
                </span>
              </div>
              <p style={{ fontSize: 12, marginBottom: 4 }}>
                <strong>QuickNode Streams</strong> is the authoritative on-chain data source.
                Every real webhook call is HMAC-SHA256 verified before it updates a receipt.
              </p>
              <p className="muted" style={{ fontSize: 11 }}>
                Webhook endpoint:{" "}
                <code style={{ fontSize: 10 }}>POST /webhooks/quicknode</code>
                {" "}· Header:{" "}
                <code style={{ fontSize: 10 }}>x-quicknode-signature</code>
                {" "}· Algorithm: <code style={{ fontSize: 10 }}>HMAC-SHA256</code>{" "}
                (constant-time compare via <code style={{ fontSize: 10 }}>crypto.timingSafeEqual</code>)
              </p>
            </div>
            <div style={{ fontSize: 11, minWidth: 180 }}>
              <div style={{ color: "var(--muted)", marginBottom: 4, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                QuickNode Setup
              </div>
              <ol style={{ margin: 0, paddingLeft: "1.1em", color: "var(--text)", lineHeight: 1.8 }}>
                <li>Create a Stream on Base Sepolia</li>
                <li>Filter: Uniswap V3 Swap topic</li>
                <li>Destination: <code style={{ fontSize: 10 }}>POST /webhooks/quicknode</code></li>
                <li>Copy signing secret → <code style={{ fontSize: 10 }}>QUICKNODE_STREAMS_WEBHOOK_SECRET</code></li>
                <li>Optionally set <code style={{ fontSize: 10 }}>QUICKNODE_STREAM_ID</code></li>
              </ol>
            </div>
          </div>
        </div>

        {/* Counter chips */}
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <Chip label="Total Events"      value={total} />
          <Chip
            label="Events / min"
            value={evPerMin}
            color={evPerMin > 0 ? "var(--accent)" : undefined}
          />
          <Chip
            label="Matched Receipts"
            value={matched}
            color={matched > 0 ? "var(--green)" : undefined}
          />
          <Chip
            label="✓ QN Verified"
            value={verifiedCount > 0 ? verifiedCount : "—"}
            color={verifiedCount > 0 ? "var(--green)" : undefined}
          />
          <Chip
            label="🔗 QuickNode"
            value={qnEvents}
            color={qnEvents > 0 ? "var(--green)" : undefined}
          />
          <Chip
            label="⚡ Dev injected"
            value={devEvents}
            color={devEvents > 0 ? "var(--yellow)" : undefined}
          />
        </div>

        {/* Events table */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            ref={tableRef}
            style={{ maxHeight: "60vh", overflowY: "auto" }}
          >
            {events.length === 0 ? (
              <p className="muted" style={{ padding: "1.25rem" }}>
                No events yet — emit one with the button above, or send a{" "}
                <code style={{ fontSize: 11 }}>POST /webhooks/quicknode</code> request.
              </p>
            ) : (
              <table>
                <thead style={{ position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
                  <tr>
                    <th>Source</th>
                    <th>Time</th>
                    <th>Tx Hash</th>
                    <th>Block</th>
                    <th>Status</th>
                    <th>Gas Used</th>
                    <th>Contract</th>
                    <th>Matched Job</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...events].reverse().map((ev) => (
                    <tr key={ev.id}>
                      {/* Source badge */}
                      <td style={{ whiteSpace: "nowrap" }}>
                        {ev.source === "quicknode" ? (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "2px 7px",
                            borderRadius: 99, background: "rgba(63,185,80,.15)",
                            color: "var(--green)", border: "1px solid var(--green)",
                            letterSpacing: "0.04em",
                          }}>
                            🔗 QN
                          </span>
                        ) : ev.source === "dev" ? (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "2px 7px",
                            borderRadius: 99, background: "rgba(240,192,64,.15)",
                            color: "var(--yellow)", border: "1px solid var(--yellow)",
                            letterSpacing: "0.04em",
                          }}>
                            ⚡ Dev
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: 9 }}>—</span>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                        {fmtTime(ev.timestamp)}
                      </td>

                      {/* Tx Hash + copy */}
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span className="font-mono" style={{ fontSize: 11 }}>
                            {txShort(ev.txHash)}
                          </span>
                          <CopyBtn text={ev.txHash} label="Copy txHash" />
                        </div>
                      </td>

                      <td className="font-mono" style={{ fontSize: 11 }}>
                        {ev.blockNumber.toLocaleString()}
                      </td>

                      {/* Status badge */}
                      <td>
                        <span
                          style={{
                            color:      statusColor(ev.status),
                            fontWeight: 600,
                            fontSize:   11,
                          }}
                        >
                          {statusLabel(ev.status)}
                        </span>
                      </td>

                      <td className="font-mono muted" style={{ fontSize: 11 }}>
                        {ev.gasUsed ? Number(ev.gasUsed).toLocaleString() : "—"}
                      </td>

                      <td className="font-mono" style={{ fontSize: 11 }}>
                        {ev.contract ? addrShort(ev.contract) : "—"}
                      </td>

                      {/* Matched job ID */}
                      <td style={{ fontSize: 11 }}>
                        {ev.matchedJobId ? (
                          <span className="badge badge-green" style={{ fontSize: 9 }}>
                            {ev.matchedJobId.slice(0, 8)}…
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>

                      {/* Row actions */}
                      <td style={{ textAlign: "right" }}>
                        {ev.txHash && (
                          <a
                            href={`https://sepolia.basescan.org/tx/${ev.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 11 }}
                          >
                            ↗ scan
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Bounty callout + CTA ─────────────────────────────────────── */}
        <div
          className="card"
          style={{
            marginTop: "1rem",
            background: "rgba(63,185,80,.04)",
            border: "1px solid rgba(63,185,80,.2)",
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="bounty-badge bounty-quicknode">🔗 QuickNode Streams</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--text)", marginBottom: 0 }}>
                Every swap receipt entering via{" "}
                <code style={{ fontSize: 10 }}>POST /webhooks/quicknode</code>{" "}
                is HMAC-SHA256 verified before it updates a job receipt or battle scorecard.
                No trust required — the on-chain truth is piped in real-time.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignSelf: "center" }}>
              <a href="/arena" className="btn btn-ghost" style={{ fontSize: 12 }}>⚔️ Run a Battle</a>
              <a href="/agents" className="btn btn-ghost" style={{ fontSize: 12 }}>📊 Leaderboard</a>
              <a href="/swap" className="btn btn-ghost" style={{ fontSize: 12 }}>🦄 Swap Sim</a>
            </div>
          </div>
        </div>

      </main>
    </>
  );
}
