/**
 * Prediction Pool routes
 *
 * GET  /prediction/:battleId              — pot sizes + resolution status
 *                                           ?address=0x…  includes user prediction
 * POST /prediction/resolve                — admin: resolve battle on-chain
 *                                           requires header: x-admin-token: <ADMIN_TOKEN>
 *
 * All routes return { enabled: false } (200) when PREDICTION_ENABLED !== "true"
 * so the frontend can hide the prediction UI without a configuration error.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import type { AgentId } from "@agent-aqi/shared";
import {
  isPredictionEnabled,
  canAutoResolve,
  battleUuidToOnChainId,
  fetchBattleTotals,
  fetchBattleInfo,
  fetchUserPrediction,
  resolvePredictionBattle,
} from "../lib/predictionPool";
import { emitEvent, getBattle } from "../store";

const router = Router();

const VALID_AGENTS: AgentId[] = ["safe", "fast", "cheap"];

// ─── Auth helper ──────────────────────────────────────────────────────────────

function checkAdminToken(req: Request): boolean {
  const expected = process.env["ADMIN_TOKEN"];
  if (!expected) return false;
  const provided = req.headers["x-admin-token"] as string | undefined;
  return Boolean(provided) && provided === expected;
}

// ─── GET /prediction/:battleId ────────────────────────────────────────────────

router.get("/:battleId", async (req: Request, res: Response): Promise<void> => {
  if (!isPredictionEnabled()) {
    res.json({ enabled: false });
    return;
  }

  const battleId    = req.params["battleId"] ?? "";
  const userAddress = req.query["address"] as string | undefined;

  try {
    // Fan-out reads — totals + battle info in parallel, user prediction if requested
    const [totals, battleInfo, userPrediction] = await Promise.all([
      fetchBattleTotals(battleId),
      fetchBattleInfo(battleId),
      userAddress ? fetchUserPrediction(battleId, userAddress) : Promise.resolve(null),
    ]);

    // Pull cached resolveTxHash from in-memory battle record
    const offChainBattle = getBattle(battleId);

    const response = {
      enabled:         true,
      battleId,
      contractAddress: process.env["PREDICTION_CONTRACT_ADDRESS"] ?? null,
      onChainId:       battleUuidToOnChainId(battleId).toString(),

      totals: totals
        ? {
            safe:  totals.safe.toString(),
            fast:  totals.fast.toString(),
            cheap: totals.cheap.toString(),
          }
        : null,
      totalWei: totals
        ? (totals.safe + totals.fast + totals.cheap).toString()
        : null,

      resolved:      battleInfo?.resolved      ?? false,
      winnerAgentId: battleInfo?.winnerAgentId ?? null,
      resolveTxHash: offChainBattle?.resolveTxHash ?? null,

      userPrediction: userPrediction
        ? {
            agentId:   userPrediction.agentId,
            agentName: userPrediction.agentName,
            amountWei: userPrediction.amountWei.toString(),
            withdrawn: userPrediction.withdrawn,
          }
        : null,
    };

    // Broadcast current totals to all SSE clients (best-effort, non-blocking)
    if (totals) {
      emitEvent("prediction_update", {
        battleId,
        totals: {
          safe:  totals.safe.toString(),
          fast:  totals.fast.toString(),
          cheap: totals.cheap.toString(),
        },
      });
    }

    res.json(response);
  } catch (err) {
    console.error("[Prediction] GET error:", err);
    res.status(500).json({ error: "Failed to read contract state" });
  }
});

// ─── POST /prediction/resolve ─────────────────────────────────────────────────

router.post("/resolve", async (req: Request, res: Response): Promise<void> => {
  if (!isPredictionEnabled()) {
    res.status(403).json({ error: "Prediction feature not enabled" });
    return;
  }

  if (!checkAdminToken(req)) {
    res.status(401).json({ error: "Invalid or missing x-admin-token header" });
    return;
  }

  if (!canAutoResolve()) {
    res.status(503).json({ error: "ADMIN_PRIVATE_KEY not configured" });
    return;
  }

  const body         = req.body as Record<string, unknown>;
  const battleId     = body["battleId"]     as string | undefined;
  const winnerInput  = body["winnerAgentId"] as string | undefined;

  if (!battleId) {
    res.status(400).json({ error: "battleId is required" });
    return;
  }
  if (!winnerInput || !VALID_AGENTS.includes(winnerInput as AgentId)) {
    res.status(400).json({
      error: `winnerAgentId must be one of: ${VALID_AGENTS.join(", ")}`,
    });
    return;
  }

  const winner = winnerInput as AgentId;

  try {
    const result = await resolvePredictionBattle(battleId, winner);

    if (!result) {
      res.status(500).json({ error: "Resolution returned null — check server logs" });
      return;
    }

    // Persist txHash on the in-memory battle record so GET returns it immediately
    const offChainBattle = getBattle(battleId);
    if (offChainBattle) offChainBattle.resolveTxHash = result.txHash;

    // Broadcast to all SSE clients
    emitEvent("prediction_resolved", {
      battleId,
      winnerAgentId:  winner,
      resolveTxHash:  result.txHash,
    });

    res.json({
      txHash:        result.txHash,
      battleId,
      winnerAgentId: winner,
    });
  } catch (err) {
    console.error("[Prediction] resolve error:", err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
