/**
 * Arena Battle orchestration
 *
 * POST /arena/battle       — create + start a multi-agent battle
 * GET  /arena/battle/:id   — poll battle status + scoreboard
 *
 * Battle types:
 *   speed       – lowest latencyMs wins
 *   gas         – lowest gasUsedUsd wins
 *   reliability – best success rate in last 10 historical receipts wins
 *   slippage    – lowest slippageBps wins (meaningful when quoteResult present)
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import type { AgentId, BattleType, SwapParams } from "@agent-aqi/shared";
import {
  addBattle,
  getBattle,
  getRecentBattles,
  updateBattleScorecard,
  startBattle,
  finalizeBattle,
  getReceiptsByAgent,
  emitEvent,
  setCurrentBattleId,
  getCurrentBattleId,
} from "../store";
import { runJob } from "../lib/runJob";
import { parseSwapParams } from "./jobs";
import { canAutoResolve, resolvePredictionBattle } from "../lib/predictionPool";
import { resolvePaperBets } from "../lib/paperBets";

const router = Router();

const VALID_AGENTS: AgentId[]    = ["safe", "fast", "cheap"];
const VALID_TYPES:  BattleType[] = ["speed", "gas", "reliability", "slippage"];

// ─── Admin auth middleware ────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env["ADMIN_TOKEN"];
  if (!expected) {
    res.status(503).json({ error: "ADMIN_TOKEN not configured on server" });
    return;
  }
  const provided = req.headers["x-admin-token"] as string | undefined;
  if (!provided || provided !== expected) {
    res.status(403).json({ error: "Forbidden — invalid admin token" });
    return;
  }
  next();
}

// ─── Shared job runner (used by both POST /battle and POST /admin/run) ────────

async function runBattleJobs(battleId: string, agentIds: AgentId[]): Promise<void> {
  const mode = (process.env["EXECUTION_MODE"] ?? "sim") as "sim" | "quote" | "real";

  const jobPromises = agentIds.map(async (agentId) => {
    const jobId = uuidv4();
    updateBattleScorecard(battleId, agentId, { jobId, status: "running" });
    try {
      const receipt = await runJob({ jobId, agentId, jobType: "swap", mode, battleId });
      updateBattleScorecard(battleId, agentId, {
        jobId,
        status:      receipt.outcome.status,
        latencyMs:   receipt.outcome.latencyMs,
        gasUsedUsd:  receipt.outcome.gasUsedUsd,
        slippageBps: receipt.outcome.slippageBps,
        quotedOut:   receipt.quoteResult?.quotedOut,
      });
    } catch {
      updateBattleScorecard(battleId, agentId, { status: "failed" });
    }
  });

  await Promise.allSettled(jobPromises);
}

// ─── POST /arena/admin/open ────────────────────────────────────────────────────
// Admin-only: create a lobby battle (no jobs run yet). Audience can place bets.

router.post("/admin/open", requireAdmin, (req: Request, res: Response) => {
  const body       = req.body as Record<string, unknown>;
  const battleType = body["battleType"] as string | undefined;
  const rawIds     = (body["agentIds"] as string[] | undefined) ?? ["safe", "fast", "cheap"];

  if (!battleType || !VALID_TYPES.includes(battleType as BattleType)) {
    res.status(400).json({ error: `battleType must be one of: ${VALID_TYPES.join(", ")}` });
    return;
  }
  for (const id of rawIds) {
    if (!VALID_AGENTS.includes(id as AgentId)) {
      res.status(400).json({ error: `Unknown agentId "${id}"` });
      return;
    }
  }

  const battleId = uuidv4();
  const ids      = rawIds as AgentId[];
  const type     = battleType as BattleType;

  addBattle({
    battleId,
    createdAt:  Date.now(),
    battleType: type,
    agentIds:   ids,
    scorecards: ids.map((id) => ({ agentId: id, status: "pending" as const })),
    status:     "lobby",
  });

  setCurrentBattleId(battleId);

  emitEvent("battle_open", { battleId, battleType: type, agentIds: ids });

  console.log(`[Arena] lobby opened battle=${battleId} type=${type}`);
  res.status(201).json({ battleId, battleType: type, agentIds: ids, status: "lobby" });
});

// ─── POST /arena/admin/run ────────────────────────────────────────────────────
// Admin-only: fire the jobs for the current lobby battle.

router.post("/admin/run", requireAdmin, async (req: Request, res: Response) => {
  const battleId = getCurrentBattleId();
  if (!battleId) {
    res.status(404).json({ error: "No active lobby — open one first with POST /arena/admin/open" });
    return;
  }

  const battle = getBattle(battleId);
  if (!battle) {
    res.status(404).json({ error: "Battle record missing" });
    return;
  }
  if (battle.status !== "lobby") {
    res.status(409).json({ error: `Battle is already "${battle.status}" — open a new one` });
    return;
  }

  startBattle(battleId);

  // Respond immediately — jobs run async
  res.status(202).json({ battleId, battleType: battle.battleType, status: "running" });

  await runBattleJobs(battleId, battle.agentIds);

  const winner = determineWinner(battleId, battle.battleType);
  finalizeBattle(battleId, winner);

  emitEvent("battle_complete", {
    battleId,
    battleType:    battle.battleType,
    winnerAgentId: winner ?? null,
    scorecards:    getBattle(battleId)?.scorecards ?? [],
  });

  console.log(`[Arena] admin/run battle=${battleId} winner=${winner ?? "none"}`);

  if (winner) {
    try { resolvePaperBets(battleId, winner); } catch (e) {
      console.error(`[PaperBets] resolve failed:`, e);
    }
  }

  if (winner && canAutoResolve()) {
    resolvePredictionBattle(battleId, winner)
      .then((result) => {
        if (!result) return;
        const b = getBattle(battleId);
        if (b) b.resolveTxHash = result.txHash;
        emitEvent("prediction_resolved", { battleId, winnerAgentId: winner, resolveTxHash: result.txHash });
      })
      .catch((e: unknown) => console.error(`[Prediction] resolve failed:`, e));
  }
});

// ─── GET /arena/current ───────────────────────────────────────────────────────
// Returns the currently live battle (lobby / running / just-completed).

router.get("/current", (_req: Request, res: Response) => {
  const battleId = getCurrentBattleId();
  if (!battleId) { res.json({ battle: null }); return; }
  const battle = getBattle(battleId);
  res.json({ battle: battle ?? null });
});

// ─── x402 payment gate ────────────────────────────────────────────────────────
//
// Opt-in via env: X402_ENABLED=true
//   X402_DEMO_PROOF        – shared-secret proof (default: "letmein")
//   X402_RECEIVER_ADDRESS  – shown in the 402 JSON as the payment receiver
//   X402_AMOUNT            – human-readable amount displayed in the 402 body
//
// Clients satisfy the gate by sending either:
//   x402-proof: <secret>
//   authorization: Bearer <secret>

interface X402Body {
  error:        "payment_required";
  instructions: string;
  receiver:     string;
  amount:       string;
}

/**
 * Returns null when the request is allowed (gate disabled or proof valid).
 * Returns a 402 payload object when proof is missing / wrong.
 */
function checkX402(req: Request): X402Body | null {
  if (process.env["X402_ENABLED"] !== "true") return null;

  const expected = process.env["X402_DEMO_PROOF"] ?? "letmein";

  // Accept proof from dedicated header or Authorization: Bearer <proof>
  const proof =
    (req.headers["x402-proof"] as string | undefined) ??
    (req.headers["authorization"]?.replace(/^Bearer\s+/i, "") ?? "");

  if (proof === expected) return null; // proof accepted ✓

  return {
    error:        "payment_required",
    instructions: "Provide x402-proof header (or Authorization: Bearer <proof>) to start a battle.",
    receiver:     process.env["X402_RECEIVER_ADDRESS"] ?? "0x0000000000000000000000000000000000000000",
    amount:       process.env["X402_AMOUNT"]           ?? "0.001 ETH",
  };
}

// ─── Winner determination ─────────────────────────────────────────────────────

function determineWinner(battleId: string, battleType: BattleType): AgentId | undefined {
  const battle = getBattle(battleId);
  if (!battle) return undefined;

  const cards = battle.scorecards;

  if (battleType === "reliability") {
    let best: { agentId: AgentId; rate: number } | null = null;
    for (const card of cards) {
      const hist  = getReceiptsByAgent(card.agentId).slice(-10);
      const rate  = hist.length
        ? hist.filter((r) => r.outcome.status === "fulfilled").length / hist.length
        : 0;
      if (!best || rate > best.rate) best = { agentId: card.agentId, rate };
    }
    return best?.agentId;
  }

  const fulfilled = cards.filter((c) => c.status === "fulfilled");
  const pool      = fulfilled.length > 0 ? fulfilled : cards; // fallback to all if none succeeded

  if (battleType === "speed") {
    return [...pool].sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity))[0]?.agentId;
  }
  if (battleType === "gas") {
    return [...pool].sort((a, b) => (a.gasUsedUsd ?? Infinity) - (b.gasUsedUsd ?? Infinity))[0]?.agentId;
  }
  if (battleType === "slippage") {
    const withSlip = pool.filter((c) => c.slippageBps !== undefined);
    const src      = withSlip.length > 0 ? withSlip : pool;
    return [...src].sort((a, b) => (a.slippageBps ?? Infinity) - (b.slippageBps ?? Infinity))[0]?.agentId;
  }

  return undefined;
}

// ─── POST /arena/battle ───────────────────────────────────────────────────────

router.post("/battle", async (req: Request, res: Response) => {
  // ── x402 gate ──────────────────────────────────────────────────────────────
  const gate = checkX402(req);
  if (gate) {
    res.status(402).json(gate);
    return;
  }

  const body       = req.body as Record<string, unknown>;
  const battleType = body["battleType"] as string | undefined;
  const rawIds     = body["agentIds"];
  const rawSwap    = body["swapParams"] as Record<string, unknown> | undefined;

  // ── Validation ─────────────────────────────────────────────────────────────
  if (!battleType || !VALID_TYPES.includes(battleType as BattleType)) {
    res.status(400).json({ error: `battleType must be one of: ${VALID_TYPES.join(", ")}` });
    return;
  }
  if (!Array.isArray(rawIds) || rawIds.length < 2 || rawIds.length > 3) {
    res.status(400).json({ error: "agentIds must be an array of 2–3 agent ids" });
    return;
  }
  for (const id of rawIds as string[]) {
    if (!VALID_AGENTS.includes(id as AgentId)) {
      res.status(400).json({ error: `Unknown agentId "${id}". Valid: ${VALID_AGENTS.join(", ")}` });
      return;
    }
  }

  const mode = (process.env["EXECUTION_MODE"] ?? "sim") as "sim" | "quote" | "real"; // for response only
  const ids  = rawIds as AgentId[];
  const type = battleType as BattleType;

  // ── Parse swapParams (optional) ─────────────────────────────────────────────
  let swapParams: SwapParams | undefined;
  if (rawSwap) {
    const parsed = parseSwapParams(rawSwap);
    if ("error" in parsed) {
      res.status(400).json({ error: `swapParams: ${parsed.error}` });
      return;
    }
    swapParams = parsed.params;
  }

  // ── Create battle record ────────────────────────────────────────────────────
  const battleId = uuidv4();

  addBattle({
    battleId,
    createdAt:  Date.now(),
    battleType: type,
    agentIds:   ids,
    scorecards: ids.map((id) => ({ agentId: id, status: "pending" as const })),
    status:     "running",
  });

  // Respond immediately — battle runs async
  res.status(202).json({ battleId, agentIds: ids, battleType: type, mode });

  // ── Fire all agent jobs in parallel ────────────────────────────────────────
  await runBattleJobs(battleId, ids);

  // ── Determine winner + finalize ─────────────────────────────────────────────
  const winner = determineWinner(battleId, type);
  finalizeBattle(battleId, winner);

  emitEvent("battle_complete", {
    battleId,
    battleType: type,
    winnerAgentId: winner ?? null,
    scorecards:    getBattle(battleId)?.scorecards ?? [],
  });

  console.log(`[Arena] battle=${battleId} type=${type} winner=${winner ?? "none"}`);

  // ── Auto-resolve paper bets (synchronous, fire-and-forget style) ─────────────
  if (winner) {
    try {
      resolvePaperBets(battleId, winner);
    } catch (err: unknown) {
      console.error(`[PaperBets] auto-resolve failed battle=${battleId}:`, err);
    }
  }

  // ── Auto-resolve prediction pool (fire-and-forget) ──────────────────────────
  if (winner && canAutoResolve()) {
    resolvePredictionBattle(battleId, winner)
      .then((result) => {
        if (!result) return;
        const b = getBattle(battleId);
        if (b) b.resolveTxHash = result.txHash;
        emitEvent("prediction_resolved", {
          battleId,
          winnerAgentId: winner,
          resolveTxHash: result.txHash,
        });
      })
      .catch((err: unknown) => {
        console.error(`[Prediction] auto-resolve failed battle=${battleId}:`, err);
      });
  }
});

// ─── GET /arena/recent ────────────────────────────────────────────────────────

router.get("/recent", (_req: Request, res: Response) => {
  res.json(getRecentBattles(10));
});

// ─── GET /arena/latest ────────────────────────────────────────────────────────
// Returns the most recent running battle, or the most recent completed battle
// if none are running. Returns { battle: null } when no battles exist yet.
// Used by the landing page to auto-show the active prediction.

router.get("/latest", (_req: Request, res: Response) => {
  const recent = getRecentBattles(20);
  const running   = recent.find((b) => b.status === "running");
  const completed = recent.find((b) => b.status === "complete");
  res.json({ battle: running ?? completed ?? null });
});

// ─── GET /arena/battle/:battleId ──────────────────────────────────────────────

router.get("/battle/:battleId", (req: Request, res: Response) => {
  const battle = getBattle(req.params["battleId"] ?? "");
  if (!battle) {
    res.status(404).json({ error: "Battle not found" });
    return;
  }
  res.json(battle);
});

export default router;
