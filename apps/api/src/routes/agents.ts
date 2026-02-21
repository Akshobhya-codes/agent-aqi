import { Router } from "express";
import type { Request, Response } from "express";
import { computeAQI } from "@agent-aqi/shared";
import type { AgentId, AgentSummary } from "@agent-aqi/shared";
import { AGENT_META } from "../agents";
import { receipts, getReceiptsByAgent } from "../store";

const router = Router();

const ALL_AGENTS: AgentId[] = ["safe", "fast", "cheap"];

// GET /agents — leaderboard
router.get("/", (_req: Request, res: Response) => {
  const summaries: AgentSummary[] = ALL_AGENTS.map((agentId) => {
    const agentReceipts = getReceiptsByAgent(agentId);
    const aqi = computeAQI(agentReceipts);
    const meta = AGENT_META[agentId];
    const fulfilled = agentReceipts.filter(
      (r) => r.outcome.status === "fulfilled",
    ).length;
    return {
      agentId,
      displayName:  meta.displayName,
      description:  meta.description,
      aqi,
      totalJobs:    agentReceipts.length,
      successRate:  agentReceipts.length
        ? Math.round((fulfilled / agentReceipts.length) * 1000) / 10
        : 0,
    };
  });

  // Sort by AQI descending
  summaries.sort((a, b) => b.aqi.score - a.aqi.score);
  res.json(summaries);
});

// GET /agents/:id — detail
router.get("/:id", (req: Request, res: Response) => {
  const agentId = req.params["id"] as AgentId;
  if (!ALL_AGENTS.includes(agentId)) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const agentReceipts = getReceiptsByAgent(agentId);
  const aqi = computeAQI(agentReceipts);
  const meta = AGENT_META[agentId];
  const fulfilled = agentReceipts.filter(
    (r) => r.outcome.status === "fulfilled",
  ).length;

  res.json({
    agentId,
    displayName:  meta.displayName,
    description:  meta.description,
    aqi,
    totalJobs:    agentReceipts.length,
    successRate:  agentReceipts.length
      ? Math.round((fulfilled / agentReceipts.length) * 1000) / 10
      : 0,
    receipts: agentReceipts.slice(-50), // last 50
  });
});

export default router;
