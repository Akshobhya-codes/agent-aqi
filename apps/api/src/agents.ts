/**
 * Agent policy layer.
 *
 * Each agent receives a job and returns a Receipt.  In Phase 1 all execution
 * is simulated with randomised distributions that clearly differentiate the
 * three strategies on the leaderboard.
 *
 * Phase 2 hook: set EXECUTION_MODE=real and wire in the real executors at the
 * bottom of each handler.
 */

import { v4 as uuidv4 } from "uuid";
import type {
  AgentId,
  AgentPolicy,
  JobConstraints,
  Receipt,
  OutcomeMetrics,
} from "@agent-aqi/shared";

// ─── Simulation helpers ───────────────────────────────────────────────────────

/** Uniform random in [min, max] */
function rnd(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Weighted boolean: returns true with probability p */
function chance(p: number): boolean {
  return Math.random() < p;
}

// ─── Agent definitions ────────────────────────────────────────────────────────

export interface AgentMeta {
  agentId: AgentId;
  displayName: string;
  description: string;
}

export const AGENT_META: Record<AgentId, AgentMeta> = {
  safe: {
    agentId: "safe",
    displayName: "SafeGuard",
    description:
      "Strict slippage limits, simulation-first, low unsafe-approval rate. Slower but highly reliable.",
  },
  fast: {
    agentId: "fast",
    displayName: "SpeedRunner",
    description:
      "Minimal pre-checks, targets sub-second execution. Higher failure rate in adverse conditions.",
  },
  cheap: {
    agentId: "cheap",
    displayName: "GasOptimizer",
    description:
      "Batches & delays to hit lowest gas cost. Medium reliability, occasionally misses deadlines.",
  },
};

// ─── Simulation profiles ──────────────────────────────────────────────────────

interface SimProfile {
  successRate: number;          // probability of fulfillment
  latencyMs: [number, number];  // uniform range
  gasUsedUsd: [number, number]; // uniform range
  slippageBps: [number, number]; // uniform range
  flagProbability: number;      // probability of attaching a safety flag
  possibleFlags: string[];
}

const PROFILES: Record<AgentId, SimProfile> = {
  safe: {
    successRate:      0.96,
    latencyMs:        [800,  2400],
    gasUsedUsd:       [0.40,  0.80],
    slippageBps:      [5,    30],
    flagProbability:  0.05,
    possibleFlags:    ["price_impact_warning"],
  },
  fast: {
    successRate:      0.78,
    latencyMs:        [120,   600],
    gasUsedUsd:       [0.55,  1.10],
    slippageBps:      [20,   120],
    flagProbability:  0.30,
    possibleFlags:    ["high_slippage", "unaudited_contract", "mempool_race"],
  },
  cheap: {
    successRate:      0.85,
    latencyMs:        [1200, 4000],
    gasUsedUsd:       [0.12,  0.38],
    slippageBps:      [8,    60],
    flagProbability:  0.15,
    possibleFlags:    ["deadline_risk", "price_impact_warning"],
  },
};

// ─── Per-agent Uniswap routing policies ──────────────────────────────────────
//
// These policies are applied in quote/real mode to send distinct parameters
// to the Uniswap Trading API, producing genuinely different outcomes per agent.
//
//   SafeGuard  – tight 0.5 % slippage; prefer routes with ≤2 hops to reduce risk
//   SpeedRunner – loose 1.5 % slippage; no hop limit; optimises for fastest path
//   GasOptimizer– very tight 0.3 % slippage; prefers gas-efficient multi-hop routes

export const AGENT_POLICY: Record<AgentId, AgentPolicy> = {
  safe: {
    slippageBps: 50,   // 0.5 %
    maxHops:     2,
    preference:  "safest",
  },
  fast: {
    slippageBps: 150,  // 1.5 %
    preference:  "fastest",
  },
  cheap: {
    slippageBps: 30,   // 0.3 %
    maxHops:     4,
    preference:  "cheapest",
  },
};

// ─── Default constraints per objective ───────────────────────────────────────

export function defaultConstraints(
  jobType: JobConstraints["jobType"],
  agentId: AgentId,
): JobConstraints {
  const map: Record<AgentId, Omit<JobConstraints, "jobType">> = {
    safe:  { objective: "safest",   maxSlippageBps: 50,  maxGasUsd: 1.00, deadlineMs: 3000 },
    fast:  { objective: "fastest",  maxSlippageBps: 150, maxGasUsd: 2.00, deadlineMs: 800  },
    cheap: { objective: "cheapest", maxSlippageBps: 80,  maxGasUsd: 0.50, deadlineMs: 5000 },
  };
  return { jobType, ...map[agentId] };
}

// ─── Core executor ───────────────────────────────────────────────────────────

export async function runAgent(
  agentId: AgentId,
  jobType: JobConstraints["jobType"],
): Promise<Receipt> {
  const profile = PROFILES[agentId];
  const constraints = defaultConstraints(jobType, agentId);

  // Simulate network / execution delay
  const latencyMs = Math.round(rnd(...profile.latencyMs));
  await sleep(Math.min(latencyMs, 400)); // cap demo wait at 400 ms

  const status = chance(profile.successRate) ? "fulfilled" : "failed";

  const safetyFlags: string[] = [];
  if (chance(profile.flagProbability)) {
    const flag =
      profile.possibleFlags[
        Math.floor(Math.random() * profile.possibleFlags.length)
      ];
    safetyFlags.push(flag);
  }

  const outcome: OutcomeMetrics = {
    status,
    latencyMs,
    gasUsedUsd: Math.round(rnd(...profile.gasUsedUsd) * 1000) / 1000,
    slippageBps: Math.round(rnd(...profile.slippageBps)),
    safetyFlags,
  };

  const now = Date.now();

  return {
    jobId:       uuidv4(),
    agentId,
    submittedAt: now - latencyMs,
    completedAt: now,
    constraints,
    outcome,
    // onChain: undefined  ← Phase 2: populate with real tx data
  };
}

// ─── Phase 2 stub: real execution ────────────────────────────────────────────
// TODO(phase2): when EXECUTION_MODE=real:
//   1. Call Uniswap API to build swap calldata
//   2. Submit tx via viem on Base (chainId 8453)
//   3. Subscribe to QuickNode Streams webhook for tx confirmation
//   4. Wrap behind x402 paywall if X402_ENABLED=true

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
