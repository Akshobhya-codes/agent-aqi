import { Router } from "express";
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import type { AgentId, JobType, Objective, SwapParams } from "@agent-aqi/shared";
import { BASE_SEPOLIA_CHAIN_ID } from "@agent-aqi/shared";
import { AGENT_META } from "../agents";
import { runJob } from "../lib/runJob";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OBJECTIVE_TO_AGENT: Record<Objective, AgentId> = {
  safest:   "safe",
  fastest:  "fast",
  cheapest: "cheap",
};

/** Minimal Ethereum address check: 0x-prefixed 42-char hex string */
export function isAddress(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

/**
 * Validate and normalise swap params from a request body object.
 * Exported so the arena route can reuse the same validation.
 */
export function parseSwapParams(
  body: Record<string, unknown>,
): { params: SwapParams } | { error: string } {
  const { inputToken, outputToken, amountIn, chainId } = body;

  if (!isAddress(inputToken)) {
    return { error: "inputToken must be a 0x-prefixed Ethereum address (42 hex chars)" };
  }
  if (!isAddress(outputToken)) {
    return { error: "outputToken must be a 0x-prefixed Ethereum address (42 hex chars)" };
  }
  if (typeof amountIn !== "string" || !/^\d+$/.test((amountIn as string).trim())) {
    return { error: "amountIn must be a positive integer string (token's smallest unit, e.g. wei)" };
  }
  if ((inputToken as string).toLowerCase() === (outputToken as string).toLowerCase()) {
    return { error: "inputToken and outputToken must differ" };
  }

  return {
    params: {
      inputToken:  inputToken as string,
      outputToken: outputToken as string,
      amountIn:    (amountIn as string).trim(),
      chainId:     typeof chainId === "number" && chainId > 0 ? chainId : BASE_SEPOLIA_CHAIN_ID,
    },
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const jobType  = body["jobType"]  as JobType | undefined;
  const objective = body["objective"] as Objective | undefined;

  // ── Validate base fields ────────────────────────────────────────────────────
  if (!jobType || !["swap", "paid_call"].includes(jobType)) {
    res.status(400).json({ error: "jobType must be 'swap' or 'paid_call'" });
    return;
  }
  if (!objective || !["safest", "fastest", "cheapest"].includes(objective)) {
    res.status(400).json({ error: "objective must be 'safest' | 'fastest' | 'cheapest'" });
    return;
  }

  const mode = (process.env["EXECUTION_MODE"] ?? "sim") as "sim" | "quote" | "real";
  const agentId = OBJECTIVE_TO_AGENT[objective];

  // ── Validate swap params when needed ───────────────────────────────────────
  let swapParams: SwapParams | undefined;
  if (jobType === "swap" && mode !== "sim") {
    const parsed = parseSwapParams(body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    swapParams = parsed.params;
  }

  // ── Pre-generate jobId and respond immediately ─────────────────────────────
  const jobId = uuidv4();
  res.status(202).json({ jobId, agentId, mode });

  // ── Execute job asynchronously (fire-and-forget from HTTP perspective) ──────
  runJob({ jobId, agentId, jobType, swapParams, mode }).catch((_err) => {
    // Errors are already surfaced as SSE "failed" events inside runJob
    console.error(`[jobs] unhandled error for ${agentId} job ${jobId}:`, _err);
  });
});

export default router;
