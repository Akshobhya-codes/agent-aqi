"use client";

import { useState } from "react";
import type { JobType, Objective } from "@agent-aqi/shared";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface Props {
  onJobSubmitted?: (jobId: string, agentId: string) => void;
}

export default function JobForm({ onJobSubmitted }: Props) {
  const [jobType,   setJobType]   = useState<JobType>("swap");
  const [objective, setObjective] = useState<Objective>("safest");
  const [loading,   setLoading]   = useState(false);
  const [last,      setLast]      = useState<{ jobId: string; agentId: string } | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/jobs`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ jobType, objective }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { jobId: string; agentId: string };
      setLast(data);
      onJobSubmitted?.(data.jobId, data.agentId);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ maxWidth: 480 }}>
      <h2>Submit a Job</h2>

      <div className="flex flex-col gap-1 mb-2">
        <label className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
          JOB TYPE
        </label>
        <select value={jobType} onChange={(e) => setJobType(e.target.value as JobType)}>
          <option value="swap">swap — token exchange</option>
          <option value="paid_call">paid_call — x402 API call</option>
        </select>
      </div>

      <div className="flex flex-col gap-1 mb-2">
        <label className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
          OBJECTIVE
        </label>
        <select
          value={objective}
          onChange={(e) => setObjective(e.target.value as Objective)}
        >
          <option value="safest">safest — routes to SafeGuard agent</option>
          <option value="fastest">fastest — routes to SpeedRunner agent</option>
          <option value="cheapest">cheapest — routes to GasOptimizer agent</option>
        </select>
      </div>

      {error && (
        <p style={{ color: "var(--red)", fontSize: 12, marginBottom: "0.75rem" }}>
          {error}
        </p>
      )}

      {last && (
        <p style={{ fontSize: 12, color: "var(--green)", marginBottom: "0.75rem" }}>
          Job queued: <strong>{last.jobId.slice(0, 8)}…</strong> → agent{" "}
          <strong>{last.agentId}</strong>
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? "Submitting…" : "Run Job →"}
      </button>
    </form>
  );
}
