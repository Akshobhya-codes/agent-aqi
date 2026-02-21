import type { Receipt, AQIResult, AQIComponents } from "./types";

// ─── Weights (must sum to 1.0) ────────────────────────────────────────────────
const WEIGHTS = {
  reliability: 0.30,
  safety:      0.25,
  speed:       0.20,
  economics:   0.15,
  feedback:    0.10,
} as const;

// ─── Component scorers ────────────────────────────────────────────────────────

/** 0-100: fraction of fulfilled receipts */
function scoreReliability(receipts: Receipt[]): number {
  if (receipts.length === 0) return 0;
  const fulfilled = receipts.filter((r) => r.outcome.status === "fulfilled").length;
  return (fulfilled / receipts.length) * 100;
}

/**
 * 0-100: penalise safety flags and excess slippage.
 * Each safety flag costs 10 pts (capped at 50).
 * Slippage over the constraint costs up to 30 pts.
 */
function scoreSafety(receipts: Receipt[]): number {
  if (receipts.length === 0) return 0;
  const scores = receipts.map((r) => {
    let score = 100;
    // Flag penalty
    score -= Math.min(r.outcome.safetyFlags.length * 10, 50);
    // Slippage over constraint penalty
    const excessBps = Math.max(
      0,
      r.outcome.slippageBps - r.constraints.maxSlippageBps,
    );
    score -= Math.min((excessBps / 100) * 15, 30);
    return Math.max(0, score);
  });
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * 0-100: latency as a fraction of the deadline.
 * latencyMs <= deadlineMs → 100 pts, scaled linearly down to 0 at 3× deadline.
 */
function scoreSpeed(receipts: Receipt[]): number {
  if (receipts.length === 0) return 0;
  const scores = receipts.map((r) => {
    const ratio = r.outcome.latencyMs / r.constraints.deadlineMs;
    if (ratio <= 1) return 100;
    if (ratio >= 3) return 0;
    return Math.max(0, 100 - ((ratio - 1) / 2) * 100);
  });
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * 0-100: gas used vs the constraint budget.
 * gasUsedUsd <= maxGasUsd → 100, scales down to 0 at 2× budget.
 */
function scoreEconomics(receipts: Receipt[]): number {
  if (receipts.length === 0) return 0;
  const scores = receipts.map((r) => {
    const ratio = r.outcome.gasUsedUsd / r.constraints.maxGasUsd;
    if (ratio <= 1) return 100;
    if (ratio >= 2) return 0;
    return Math.max(0, 100 - (ratio - 1) * 100);
  });
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * 0-100: average user rating × 20.
 * Receipts without feedback are ignored; if none, defaults to 70 (neutral).
 */
function scoreFeedback(receipts: Receipt[]): number {
  const rated = receipts.filter((r) => r.userFeedback != null);
  if (rated.length === 0) return 70;
  const avg =
    rated.reduce((a, r) => a + r.userFeedback!.rating, 0) / rated.length;
  return avg * 20;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function computeAQI(receipts: Receipt[]): AQIResult {
  const components: AQIComponents = {
    reliability: scoreReliability(receipts),
    safety:      scoreSafety(receipts),
    speed:       scoreSpeed(receipts),
    economics:   scoreEconomics(receipts),
    feedback:    scoreFeedback(receipts),
  };

  const score =
    components.reliability * WEIGHTS.reliability +
    components.safety      * WEIGHTS.safety +
    components.speed       * WEIGHTS.speed +
    components.economics   * WEIGHTS.economics +
    components.feedback    * WEIGHTS.feedback;

  return {
    score: Math.round(score * 10) / 10,
    components: {
      reliability: Math.round(components.reliability * 10) / 10,
      safety:      Math.round(components.safety      * 10) / 10,
      speed:       Math.round(components.speed       * 10) / 10,
      economics:   Math.round(components.economics   * 10) / 10,
      feedback:    Math.round(components.feedback    * 10) / 10,
    },
    sampleSize: receipts.length,
  };
}
