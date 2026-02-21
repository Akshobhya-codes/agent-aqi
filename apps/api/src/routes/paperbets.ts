/**
 * Paper Betting routes
 *
 * POST /paperbets/place          — place a paper bet (no wallet required)
 * GET  /paperbets/leaderboard    — global leaderboard sorted by total P/L
 * GET  /paperbets/:battleId      — bets + results + pool summary for a battle
 * POST /paperbets/resolve        — manually trigger resolution (admin / testing)
 */

import { Router } from "express";
import type { Request, Response } from "express";
import type { AgentId } from "@agent-aqi/shared";
import {
  placeBet,
  getBetsForBattle,
  getResultsForBattle,
  getPoolSummary,
  resolvePaperBets,
  getLeaderboard,
} from "../lib/paperBets";

const router = Router();

const VALID_AGENTS: AgentId[] = ["safe", "fast", "cheap"];
const MIN_BET = 0.001;
const MAX_BET = 10.0;

// ─── POST /paperbets/place ────────────────────────────────────────────────────

router.post("/place", (req: Request, res: Response) => {
  const { battleId, nickname, agentId, amountEth } = req.body as Record<string, unknown>;

  if (typeof battleId !== "string" || !battleId) {
    res.status(400).json({ error: "battleId is required" });
    return;
  }
  if (typeof nickname !== "string" || !nickname.trim() || nickname.length > 40) {
    res.status(400).json({ error: "nickname is required (max 40 chars)" });
    return;
  }
  if (!VALID_AGENTS.includes(agentId as AgentId)) {
    res.status(400).json({ error: `agentId must be one of: ${VALID_AGENTS.join(", ")}` });
    return;
  }

  const amount = Number(amountEth);
  if (Number.isNaN(amount) || amount < MIN_BET || amount > MAX_BET) {
    res.status(400).json({ error: `amountEth must be between ${MIN_BET} and ${MAX_BET}` });
    return;
  }

  // Prevent duplicate bets from the same nickname on the same battle
  const existing = getBetsForBattle(battleId).find(
    (b) => b.nickname.toLowerCase() === nickname.trim().toLowerCase(),
  );
  if (existing) {
    res.status(409).json({ error: "You already placed a bet on this battle", bet: existing });
    return;
  }

  const bet = placeBet(battleId, nickname.trim(), agentId as AgentId, amount);
  res.status(201).json(bet);
});

// ─── GET /paperbets/leaderboard ───────────────────────────────────────────────
// MUST be registered before /:battleId to avoid route collision

router.get("/leaderboard", (_req: Request, res: Response) => {
  res.json(getLeaderboard());
});

// ─── GET /paperbets/:battleId ─────────────────────────────────────────────────

router.get("/:battleId", (req: Request, res: Response) => {
  const { battleId } = req.params;
  if (!battleId) { res.status(400).json({ error: "battleId required" }); return; }

  const bets     = getBetsForBattle(battleId);
  const results  = getResultsForBattle(battleId);
  const pool     = getPoolSummary(battleId);
  const resolved = results.length > 0;

  res.json({ bets, results, pool, resolved });
});

// ─── POST /paperbets/resolve ──────────────────────────────────────────────────
// Internal / admin: manually resolve a battle's paper bets.
// Arena auto-resolve calls resolvePaperBets() directly; this endpoint is for testing.

router.post("/resolve", (req: Request, res: Response) => {
  const { battleId, winnerAgentId } = req.body as Record<string, unknown>;

  if (typeof battleId !== "string" || !battleId) {
    res.status(400).json({ error: "battleId is required" });
    return;
  }
  if (!VALID_AGENTS.includes(winnerAgentId as AgentId)) {
    res.status(400).json({ error: `winnerAgentId must be one of: ${VALID_AGENTS.join(", ")}` });
    return;
  }

  const results = resolvePaperBets(battleId, winnerAgentId as AgentId);
  res.json({ resolved: results.length, results });
});

export default router;
