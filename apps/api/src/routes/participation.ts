/**
 * Participation routes
 *
 * POST /participation           { battleId, agentId, txHash? } → 201
 *   Requires Bearer JWT. Address is read from the decoded token — never trusted from body.
 *   Rate-limited: max 5 requests per minute per authenticated address.
 *
 * GET  /participation/:battleId ?last=N → { battleId, participants, total }
 *   Public, no auth required.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { recordParticipant, getParticipants } from "../lib/participation";
import { getOrCreateProfile } from "../lib/profiles";
import { getCurrentBattleId } from "../store";

const router = Router();

// ─── Rate limiter (5 POST /participation per minute per address) ──────────────

const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX       = 5;

interface RateBucket { count: number; windowStart: number }
const rateLimitStore = new Map<string, RateBucket>();

function isRateLimited(address: string): boolean {
  const now   = Date.now();
  const entry = rateLimitStore.get(address);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    // Start a fresh window
    rateLimitStore.set(address, { count: 1, windowStart: now });
    return false; // allowed
  }
  if (entry.count >= RATE_MAX) return true; // blocked
  entry.count++;
  return false; // allowed
}

// ─── POST /participation ──────────────────────────────────────────────────────

router.post("/", requireAuth, (req: AuthRequest, res: Response): void => {
  // Address comes exclusively from the verified JWT — never from the request body
  const address = req.walletAddress!;

  const { battleId, agentId, txHash } = req.body as {
    battleId?: string;
    agentId?:  string;
    txHash?:   string;
  };

  if (!battleId || !agentId) {
    res.status(400).json({ error: "battleId and agentId are required" });
    return;
  }

  // Rate limit check
  if (isRateLimited(address)) {
    res.status(429).json({ error: "Too many requests — max 5 participations per minute" });
    return;
  }

  // Touch profile (updates lastSeenAt)
  getOrCreateProfile(address);

  recordParticipant(battleId, {
    address,
    agentId,
    txHash,
    timestamp: Date.now(),
  });

  res.status(201).json({ ok: true });
});

// ─── GET /participation/current ───────────────────────────────────────────────
// Returns participants for the current live battle (must be before /:battleId).

router.get("/current", (req: Request, res: Response): void => {
  const battleId = getCurrentBattleId();
  if (!battleId) {
    res.json({ battleId: null, participants: [], total: 0 });
    return;
  }
  const last = Math.min(
    parseInt((req.query["last"] as string | undefined) ?? "50", 10),
    200
  );
  const all = getParticipants(battleId);
  res.json({ battleId, participants: all.slice(-last), total: all.length });
});

// ─── GET /participation/:battleId ─────────────────────────────────────────────

router.get("/:battleId", (req: Request, res: Response): void => {
  const { battleId } = req.params;
  const last = Math.min(
    parseInt((req.query["last"] as string | undefined) ?? "20", 10),
    200
  );

  const all = getParticipants(battleId ?? "");
  res.json({
    battleId,
    participants: all.slice(-last),
    total: all.length,
  });
});

export default router;
