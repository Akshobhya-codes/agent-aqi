"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import type { AgentSummary } from "@agent-aqi/shared";

const API    = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const LS_KEY = "arena-home-active-agent";

// ─── Types ────────────────────────────────────────────────────────────────────

type SkyboxStatus = "idle" | "pending" | "complete" | "error";

interface SkyboxEntry {
  agentId:        string;
  status:         SkyboxStatus;
  url?:           string;
  thumbUrl?:      string;
  prompt:         string;
  error?:         string;
  startedAt?:     number;
  completedAt?:   number;
  queuePosition?: number;
  pollStatus?:    string;
}

// ─── Agent metadata ───────────────────────────────────────────────────────────

const AGENTS: { id: string; name: string; emoji: string; accent: string; tagline: string }[] = [
  { id: "safe",  name: "SafeGuard",    emoji: "🛡️", accent: "#58a6ff", tagline: "Fortified sanctuary · tight slippage · minimal risk" },
  { id: "fast",  name: "SpeedRunner",  emoji: "⚡",  accent: "#f0c040", tagline: "High-speed highway · blazing velocity · no limits"    },
  { id: "cheap", name: "GasOptimizer", emoji: "♻️",  accent: "#3fb950", tagline: "Eco-tech garden · green efficiency · minimal cost"    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(s: SkyboxStatus, pollStatus?: string): string {
  if (s === "pending") {
    if (pollStatus === "complete") return "Finalizing…";
    return "Generating…";
  }
  switch (s) {
    case "idle":     return "Not generated";
    case "complete": return "Ready";
    case "error":    return "Error";
  }
}

function statusColor(s: SkyboxStatus): string {
  switch (s) {
    case "idle":     return "var(--muted)";
    case "pending":  return "var(--yellow)";
    case "complete": return "var(--green)";
    case "error":    return "var(--red)";
  }
}

// ─── Count-up animation hook ──────────────────────────────────────────────────

function useCountUp(target: number, duration = 700): number {
  const [current, setCurrent] = useState(target);
  const from = useRef(target);
  const raf  = useRef<number | null>(null);

  useEffect(() => {
    if (from.current === target) return;
    const start = from.current;
    from.current  = target;
    const t0 = performance.now();
    if (raf.current) cancelAnimationFrame(raf.current);

    function tick(now: number) {
      const p    = Math.min((now - t0) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setCurrent(Math.round(start + (target - start) * ease));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration]);

  return current;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ size = 28, color = "var(--accent)" }: { size?: number; color?: string }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: `${Math.max(2, size / 10)}px solid rgba(255,255,255,0.12)`,
      borderTopColor: color,
      animation: "ah-spin 0.8s linear infinite",
      flexShrink: 0,
    }} />
  );
}

// ─── AQI bar with count-up ────────────────────────────────────────────────────

function AQIBar({ label, value, color }: { label: string; value: number; color: string }) {
  const animated = useCountUp(value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", width: 62, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${Math.max(2, value)}%`,
          background: color, borderRadius: 99,
          transition: "width 0.7s ease",
        }} />
      </div>
      <span style={{ fontSize: 9, color: "#fff", fontWeight: 700, width: 26, textAlign: "right", flexShrink: 0 }}>
        {animated}
      </span>
    </div>
  );
}

// ─── Agent Environment Card ───────────────────────────────────────────────────

function EnvCard({
  agent, entry, isActive, onSelect, onGenerate, aqi,
}: {
  agent:      typeof AGENTS[number];
  entry:      SkyboxEntry | undefined;
  isActive:   boolean;
  onSelect:   () => void;
  onGenerate: () => void;
  aqi?:       AgentSummary;
}) {
  const status = entry?.status ?? "idle";
  const url    = entry?.url;

  // ── 3D tilt on hover ──────────────────────────────────────────────────────
  const cardRef                 = useRef<HTMLDivElement>(null);
  const [tilt, setTilt]         = useState({ x: 0, y: 0 });
  const [hovered, setHovered]   = useState(false);

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const r = cardRef.current?.getBoundingClientRect();
    if (!r) return;
    setTilt({
      x: ((e.clientY - r.top  - r.height / 2) / (r.height / 2)) * -5,
      y: ((e.clientX - r.left - r.width  / 2) / (r.width  / 2)) *  5,
    });
  }

  // ── Status transition micro-interactions ──────────────────────────────────
  const prevStatus              = useRef<SkyboxStatus | undefined>(entry?.status);
  const [justSucceeded, setJustSucceeded] = useState(false);
  const [justFailed,    setJustFailed]    = useState(false);

  useEffect(() => {
    const prev = prevStatus.current;
    const curr = entry?.status;
    prevStatus.current = curr;
    let tid: ReturnType<typeof setTimeout> | null = null;
    if (prev === "pending" && curr === "complete") {
      setJustSucceeded(true);
      tid = setTimeout(() => setJustSucceeded(false), 2200);
    } else if (prev === "pending" && curr === "error") {
      setJustFailed(true);
      tid = setTimeout(() => setJustFailed(false), 700);
    }
    return () => { if (tid) clearTimeout(tid); };
  }, [entry?.status]);

  // ── Dynamic border / shadow ───────────────────────────────────────────────
  const borderColor = isActive
    ? agent.accent
    : status === "pending"
      ? `${agent.accent}88`
      : hovered ? "rgba(255,255,255,0.18)" : "var(--border)";

  const liftShadow = hovered
    ? `0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px ${agent.accent}22`
    : "0 2px 8px rgba(0,0,0,0.3)";

  const activeShadow = isActive
    ? `0 0 0 2px ${agent.accent}, 0 0 30px ${agent.accent}44, 0 16px 48px rgba(0,0,0,0.5)`
    : liftShadow;

  const resting     = tilt.x === 0 && tilt.y === 0;

  return (
    <div
      ref={cardRef}
      onClick={status === "complete" ? onSelect : undefined}
      onMouseMove={onMouseMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setTilt({ x: 0, y: 0 }); setHovered(false); }}
      style={{
        flex: 1, minWidth: 220,
        borderRadius: "var(--radius)",
        border: `2px solid ${borderColor}`,
        cursor: status === "complete" ? "pointer" : "default",
        position: "relative",
        background: "var(--surface)",
        boxShadow: activeShadow,
        transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateY(${hovered ? "-6px" : "0"})`,
        transformStyle: "preserve-3d",
        transition: resting
          ? "transform 0.45s ease, box-shadow 0.3s ease, border-color 0.3s ease"
          : "box-shadow 0.3s ease, border-color 0.3s ease",
      }}
    >
      {/* Pulsing glow ring while generating */}
      {status === "pending" && (
        <div className="ah-glow-ring" style={{
          position: "absolute", inset: -3,
          borderRadius: "calc(var(--radius) + 3px)",
          border: `2px solid ${agent.accent}`,
          pointerEvents: "none", zIndex: 3,
        }} />
      )}

      {/* 360° image preview / skeleton placeholder */}
      <div className="ah-card-img" style={{ width: "100%", aspectRatio: "2/1", position: "relative", overflow: "hidden" }}>
        {url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url}
            alt={`${agent.name} environment`}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div
            className={status === "pending" ? "ah-skeleton" : undefined}
            style={{
              width: "100%", height: "100%",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              background: status !== "pending"
                ? `radial-gradient(ellipse at 50% 40%, ${agent.accent}0d 0%, transparent 70%)`
                : undefined,
              gap: 10,
            }}
          >
            {status === "pending" ? (
              <>
                <Spinner size={32} color={agent.accent} />
                <span className="ah-pulse-text" style={{ fontSize: 11, color: agent.accent }}>
                  {statusLabel(status, entry?.pollStatus)}
                </span>
                {entry?.queuePosition != null && (
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>
                    Queue position: {entry.queuePosition}
                  </span>
                )}
              </>
            ) : (
              <>
                <span style={{ fontSize: "2.5rem", opacity: 0.25 }}>{agent.emoji}</span>
                <span style={{ fontSize: 11, color: statusColor(status) }}>
                  {statusLabel(status)}
                </span>
              </>
            )}
          </div>
        )}

        {/* ACTIVE badge */}
        {isActive && (
          <div style={{
            position: "absolute", top: 8, right: 8,
            background: agent.accent, color: "#000",
            fontSize: 9, fontWeight: 800, padding: "2px 8px",
            borderRadius: 99, letterSpacing: "0.07em",
            boxShadow: `0 0 12px ${agent.accent}`,
          }}>
            ✓ ACTIVE
          </div>
        )}

        {/* Success flash overlay */}
        {justSucceeded && (
          <div className="ah-success-flash" style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: `rgba(63,185,80,0.18)`,
          }}>
            <span style={{ fontSize: "2.5rem" }}>✓</span>
          </div>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: "0.75rem 1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: "1.2rem" }}>{agent.emoji}</span>
          <strong style={{ fontSize: 14, color: "var(--text-hi)" }}>{agent.name}</strong>
          {aqi && (
            <span style={{
              marginLeft: "auto", fontSize: 11, fontWeight: 800,
              color: agent.accent,
              background: `${agent.accent}15`,
              border: `1px solid ${agent.accent}44`,
              borderRadius: 99, padding: "1px 8px",
            }}>
              AQI {Math.round(aqi.aqi.score)}
            </span>
          )}
        </div>
        <p className="muted" style={{ fontSize: 11, marginBottom: 10 }}>{agent.tagline}</p>

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {status !== "complete" && (
            <button
              className={`btn btn-primary${justFailed ? " ah-btn-shake" : ""}`}
              style={{ fontSize: 11, padding: "4px 12px" }}
              onClick={(e) => { e.stopPropagation(); onGenerate(); }}
              disabled={status === "pending"}
            >
              {status === "pending"
                ? (entry?.queuePosition != null ? `#${entry.queuePosition} in queue…` : "Generating…")
                : status === "error" ? "↺ Retry" : "Generate"}
            </button>
          )}
          {status === "complete" && (
            <button
              className={isActive ? "btn btn-ghost" : "btn btn-primary"}
              style={{ fontSize: 11, padding: "4px 12px" }}
              onClick={(e) => { e.stopPropagation(); onSelect(); }}
            >
              {isActive ? "✓ Active" : "Set Active"}
            </button>
          )}
          <span style={{ fontSize: 10, color: justSucceeded ? "var(--green)" : statusColor(status) }}>
            {justSucceeded ? "✓ Complete!" : statusLabel(status, entry?.pollStatus)}
          </span>
        </div>

        {entry?.error && (
          <p style={{ fontSize: 10, color: "var(--red)", marginTop: 6, wordBreak: "break-word" }}>
            {entry.error}
          </p>
        )}

        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 10, color: "var(--muted)", cursor: "pointer" }}>View prompt</summary>
          <p style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>{entry?.prompt ?? "—"}</p>
        </details>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ArenaHomePage() {
  const [entries,     setEntries]     = useState<Record<string, SkyboxEntry>>({});
  const [activeAgent, setActiveAgent] = useState<string>("safe");
  const [apiKeySet,   setApiKeySet]   = useState<boolean | null>(null);
  const [agentData,   setAgentData]   = useState<Record<string, AgentSummary>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved && ["safe", "fast", "cheap"].includes(saved)) setActiveAgent(saved);
    } catch { /* ignore */ }
  }, []);

  function activateAgent(id: string) {
    setActiveAgent(id);
    try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
  }

  const fetchAll = useCallback(async () => {
    try {
      const [skyRes, agentRes] = await Promise.all([
        fetch(`${API}/skybox`),
        fetch(`${API}/agents`),
      ]);
      if (skyRes.ok) {
        const data = (await skyRes.json()) as SkyboxEntry[];
        const map: Record<string, SkyboxEntry> = {};
        for (const e of data) map[e.agentId] = e;
        setEntries(map);
      }
      if (agentRes.ok) {
        const list = (await agentRes.json()) as AgentSummary[];
        const map: Record<string, AgentSummary> = {};
        for (const a of list) map[a.agentId] = a;
        setAgentData(map);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.ok ? r.json() : null)
      .then((h) => {
        if (h && typeof h === "object")
          setApiKeySet(Boolean((h as Record<string, unknown>)["blockadeLabsKeySet"]));
      })
      .catch(() => { /* ignore */ });
  }, []);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    const hasPending = Object.values(entries).some((e) => e.status === "pending");
    if (hasPending && !pollRef.current) {
      pollRef.current = setInterval(fetchAll, 4000);
    } else if (!hasPending && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [entries, fetchAll]);

  async function generate(agentId: string) {
    try {
      await fetch(`${API}/skybox/${agentId}`, { method: "POST" });
      setEntries((prev) => ({ ...prev, [agentId]: { ...prev[agentId]!, status: "pending" } }));
      if (!pollRef.current) pollRef.current = setInterval(fetchAll, 4000);
    } catch { /* ignore */ }
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const completeCount    = AGENTS.filter((a) => entries[a.id]?.status === "complete").length;
  const pendingCount     = AGENTS.filter((a) => entries[a.id]?.status === "pending").length;
  const progressPct      = (completeCount / AGENTS.length) * 100;
  const allDoneOrRunning = AGENTS.every((a) => ["pending", "complete"].includes(entries[a.id]?.status ?? ""));

  const activeEntry   = entries[activeAgent];
  const activeMeta    = AGENTS.find((a) => a.id === activeAgent)!;
  const backgroundUrl = activeEntry?.url;
  const activeAQI     = agentData[activeAgent];
  const aqiScore      = useCountUp(Math.round(activeAQI?.aqi.score ?? 0));

  return (
    <>
      <Nav />

      {/* ── Aurora background ─────────────────────────────────────────────── */}
      <div className="ah-aurora" aria-hidden="true">
        <div className="ah-blob ah-blob-1" />
        <div className="ah-blob ah-blob-2" />
        <div className="ah-blob ah-blob-3" />
      </div>
      <div className="ah-noise" aria-hidden="true" />

      {/* ── Hero banner ───────────────────────────────────────────────────── */}
      <div style={{
        width: "100%", aspectRatio: "3/1",
        position: "relative", overflow: "hidden",
        marginBottom: "1.75rem",
      }}>
        {backgroundUrl ? (
          <div
            className="ah-hero-bg"
            role="img"
            aria-label={`${activeMeta.name} 360° environment`}
            style={{
              position: "absolute", inset: 0,
              backgroundImage: `url(${backgroundUrl})`,
              backgroundSize: "130% auto",
            }}
          />
        ) : (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 14,
            background: `radial-gradient(ellipse at 50% 40%, ${activeMeta.accent}18 0%, transparent 70%)`,
          }}>
            <span style={{ fontSize: "4rem", filter: `drop-shadow(0 0 24px ${activeMeta.accent})`, lineHeight: 1 }}>
              {activeMeta.emoji}
            </span>
            <span className="muted" style={{ fontSize: 14, letterSpacing: "0.03em" }}>
              {activeEntry?.status === "pending"
                ? "Generating 360° environment…"
                : "Generate a skybox to unlock the immersive backdrop"}
            </span>
            {activeEntry?.status === "pending" && (
              <>
                <Spinner size={36} color={activeMeta.accent} />
                {activeEntry.queuePosition != null && (
                  <span className="ah-pulse-text" style={{ fontSize: 12, color: "var(--muted)" }}>
                    Queue position: {activeEntry.queuePosition}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/* Bottom gradient overlay */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          padding: "1rem 1.5rem",
          background: "linear-gradient(transparent, rgba(0,0,0,0.90))",
          display: "flex", alignItems: "flex-end", gap: 14,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
            <span style={{ fontSize: "2rem" }}>{activeMeta.emoji}</span>
            <div>
              <div style={{ fontWeight: 800, color: "#fff", fontSize: 17, letterSpacing: "-0.01em" }}>
                {activeMeta.name} Environment
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                {activeMeta.tagline}
              </div>
            </div>
          </div>

          {/* AQI memory panel with count-up */}
          {activeAQI && (
            <div style={{
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(10px)",
              border: `1px solid ${activeMeta.accent}33`,
              borderRadius: 10, padding: "0.6rem 0.9rem",
              minWidth: 205, flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                  Agent Memory · AQI
                </span>
                <span style={{
                  fontSize: 18, fontWeight: 900, color: activeMeta.accent,
                  marginLeft: "auto",
                  textShadow: `0 0 16px ${activeMeta.accent}`,
                  transition: "color 0.4s ease",
                }}>
                  {aqiScore}
                </span>
              </div>
              <AQIBar label="Reliability" value={activeAQI.aqi.components.reliability} color="#3fb950" />
              <div style={{ height: 4 }} />
              <AQIBar label="Safety"      value={activeAQI.aqi.components.safety}      color="#58a6ff" />
              <div style={{ height: 4 }} />
              <AQIBar label="Speed"       value={activeAQI.aqi.components.speed}       color="#f0c040" />
              <div style={{ height: 4 }} />
              <AQIBar label="Economics"   value={activeAQI.aqi.components.economics}   color="#bc8cff" />
              <div style={{ marginTop: 6, fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                {activeAQI.totalJobs} job{activeAQI.totalJobs !== 1 ? "s" : ""} · {activeAQI.successRate.toFixed(0)}% success
              </div>
            </div>
          )}

          {backgroundUrl && (
            <a
              href={backgroundUrl} target="_blank" rel="noopener noreferrer"
              className="btn btn-ghost"
              style={{ fontSize: 11, flexShrink: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              Full-res ↗
            </a>
          )}
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main style={{ maxWidth: 920 }}>

        <div style={{ marginBottom: "1rem" }}>
          <Link href="/arena" className="muted" style={{ fontSize: 13 }}>← Arena</Link>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <h1 style={{ marginBottom: 0 }}>Agent Home</h1>
          <span className="bounty-badge bounty-blockade" style={{ fontSize: 10 }}>🌐 Blockade Labs</span>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: "1.5rem" }}>
          AI-generated 360° environments — one per agent, powered by Blockade Labs Skybox AI.
          Click a completed card to set it as the active backdrop.
        </p>

        {/* Bounty alignment callout */}
        <div style={{
          background: "linear-gradient(135deg, rgba(188,140,255,.07) 0%, rgba(88,166,255,.06) 100%)",
          border: "1px solid rgba(188,140,255,.22)",
          borderRadius: "var(--radius)",
          padding: "0.9rem 1.1rem",
          marginBottom: "1.5rem",
          display: "flex", gap: 12, alignItems: "flex-start",
        }}>
          <span style={{ fontSize: "1.4rem", flexShrink: 0, lineHeight: 1.2 }}>🌐</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-hi)", marginBottom: 3 }}>
              Blockade Labs Skybox — persistent spatial memory
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Each agent gets a persistent 360° home generated by Blockade Labs Skybox AI,
              tying spatial context to the agent's on-chain trust record.
              The environment reflects the agent's personality — safe, fast, or efficient.
            </p>
          </div>
        </div>

        {/* API key warning */}
        {apiKeySet === false && (
          <div style={{
            background: "rgba(240,192,64,0.08)",
            border: "1px solid var(--yellow)",
            borderRadius: "var(--radius)",
            padding: "0.75rem 1rem",
            fontSize: 12, marginBottom: "1.25rem",
          }}>
            ⚠ <strong>BLOCKADE_LABS_API_KEY</strong> is not set on the server.
            Add it to <code>apps/api/.env</code> and restart to enable generation.
          </div>
        )}

        {/* ── Environment cards ────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: "1.5rem" }}>
          {AGENTS.map((agent) => (
            <EnvCard
              key={agent.id}
              agent={agent}
              entry={entries[agent.id]}
              isActive={activeAgent === agent.id}
              onSelect={() => activateAgent(agent.id)}
              onGenerate={() => void generate(agent.id)}
              aqi={agentData[agent.id]}
            />
          ))}
        </div>

        {/* ── Generate All + progress bar ──────────────────────────────────── */}
        <div className="card" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <strong>Generate All Environments</strong>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {completeCount} / {AGENTS.length} ready
              </span>
              {pendingCount > 0 && (
                <span style={{ fontSize: 10, color: "var(--yellow)", display: "flex", alignItems: "center", gap: 5 }}>
                  <Spinner size={10} color="var(--yellow)" />
                  {pendingCount} generating
                </span>
              )}
            </div>
            {/* Progress bar */}
            <div style={{ height: 5, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden", marginBottom: 8 }}>
              <div style={{
                height: "100%", width: `${progressPct}%`,
                background: "linear-gradient(90deg, var(--accent), var(--green))",
                borderRadius: 99, transition: "width 0.7s ease",
              }} />
            </div>
            <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
              Queue all three agents in one click. Each takes ~1–3 min. The page polls automatically.
            </p>
          </div>
          <button
            className="btn btn-primary btn-glow"
            disabled={allDoneOrRunning}
            onClick={() => {
              for (const a of AGENTS) {
                const e = entries[a.id];
                if (!e || (e.status !== "pending" && e.status !== "complete")) {
                  void generate(a.id);
                }
              }
            }}
          >
            {completeCount === AGENTS.length
              ? "✓ All Ready"
              : pendingCount > 0
                ? `⏳ ${pendingCount} Generating…`
                : "🌐 Generate All"}
          </button>
        </div>

        <p className="muted" style={{ fontSize: 11, marginTop: "1rem", textAlign: "center" }}>
          Style ID is optionally set via <code>BLOCKADE_LABS_STYLE_ID</code> env var (must be a valid integer).
          Results are cached for the server lifetime.
        </p>

      </main>

      {/* ── All CSS animations ────────────────────────────────────────────── */}
      <style>{`
        /* ── Aurora background ─────────────────────────────────────── */
        .ah-aurora {
          position: fixed; inset: 0; z-index: -2;
          overflow: hidden; pointer-events: none;
        }
        .ah-blob {
          position: absolute; border-radius: 50%;
          filter: blur(90px); opacity: 0.13;
        }
        .ah-blob-1 {
          width: 65vw; height: 65vw; top: -25%; left: -20%;
          background: radial-gradient(circle, #58a6ff 0%, transparent 70%);
          animation: ah-blob1 22s ease-in-out infinite;
        }
        .ah-blob-2 {
          width: 55vw; height: 55vw; bottom: -15%; right: -15%;
          background: radial-gradient(circle, #bc8cff 0%, transparent 70%);
          animation: ah-blob2 28s ease-in-out infinite;
        }
        .ah-blob-3 {
          width: 48vw; height: 48vw; top: 30%; left: 36%;
          background: radial-gradient(circle, #3fb950 0%, transparent 70%);
          animation: ah-blob3 36s ease-in-out infinite;
        }
        @keyframes ah-blob1 {
          0%,100% { transform: translate(0,0) scale(1);    filter: hue-rotate(0deg)   blur(90px); }
          33%      { transform: translate(12%,18%) scale(1.12); filter: hue-rotate(35deg)  blur(100px); }
          66%      { transform: translate(-8%,8%) scale(0.91); filter: hue-rotate(-15deg) blur(75px); }
        }
        @keyframes ah-blob2 {
          0%,100% { transform: translate(0,0) scale(1);       filter: hue-rotate(0deg)  blur(90px); }
          50%      { transform: translate(-18%,-12%) scale(1.2); filter: hue-rotate(55deg) blur(110px); }
        }
        @keyframes ah-blob3 {
          0%,100% { transform: translate(0,0) scale(1);      filter: hue-rotate(0deg)   blur(90px); }
          40%      { transform: translate(8%,-18%) scale(0.88); filter: hue-rotate(-25deg) blur(65px); }
          80%      { transform: translate(-12%,8%) scale(1.1); filter: hue-rotate(45deg)  blur(95px); }
        }
        /* Noise overlay */
        .ah-noise {
          position: fixed; inset: 0; z-index: -1;
          opacity: 0.028; pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          background-size: 200px;
        }

        /* ── Hero parallax pan ─────────────────────────────────────── */
        @keyframes ah-hero-pan {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .ah-hero-bg {
          background-repeat: no-repeat;
          animation: ah-hero-pan 38s ease-in-out infinite;
        }

        /* ── Card image shimmer sweep on hover ─────────────────────── */
        .ah-card-img { position: relative; overflow: hidden; }
        .ah-card-img::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.07) 50%, transparent 70%);
          transform: translateX(-110%); pointer-events: none;
        }
        .ah-card-img:hover::after {
          animation: ah-shimmer 0.75s ease forwards;
        }
        @keyframes ah-shimmer { to { transform: translateX(120%); } }

        /* ── Skeleton shimmer (generating state) ───────────────────── */
        .ah-skeleton {
          background: linear-gradient(
            90deg,
            rgba(255,255,255,0.02) 25%,
            rgba(255,255,255,0.07) 50%,
            rgba(255,255,255,0.02) 75%
          );
          background-size: 200% 100%;
          animation: ah-skel 2s linear infinite;
        }
        @keyframes ah-skel {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        /* ── Generating text pulse ─────────────────────────────────── */
        .ah-pulse-text { animation: ah-pulse 2.2s ease-in-out infinite; }
        @keyframes ah-pulse {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.4; }
        }

        /* ── Glow ring pulse (generating border) ───────────────────── */
        .ah-glow-ring { animation: ah-ring 2.8s ease-in-out infinite; }
        @keyframes ah-ring {
          0%,100% { opacity: 0.35; box-shadow: 0 0 12px currentColor; }
          50%      { opacity: 0.9;  box-shadow: 0 0 28px currentColor; }
        }

        /* ── Success flash ─────────────────────────────────────────── */
        .ah-success-flash { animation: ah-flash 2s ease forwards; }
        @keyframes ah-flash {
          0%   { opacity: 1; }
          80%  { opacity: 1; }
          100% { opacity: 0; }
        }

        /* ── Error shake ───────────────────────────────────────────── */
        .ah-btn-shake { animation: ah-shake 0.45s ease; }
        @keyframes ah-shake {
          0%,100% { transform: translateX(0); }
          20%      { transform: translateX(-5px); }
          40%      { transform: translateX(5px); }
          60%      { transform: translateX(-4px); }
          80%      { transform: translateX(3px); }
        }

        /* ── Spinner ───────────────────────────────────────────────── */
        @keyframes ah-spin { to { transform: rotate(360deg); } }

        /* ── Respect prefers-reduced-motion ────────────────────────── */
        @media (prefers-reduced-motion: reduce) {
          .ah-blob, .ah-hero-bg, .ah-skeleton,
          .ah-pulse-text, .ah-glow-ring,
          .ah-success-flash, .ah-btn-shake { animation: none !important; }
        }
      `}</style>
    </>
  );
}
