/**
 * Profile routes
 *
 * GET  /me   → current profile (requires Bearer JWT)
 * POST /me   { nickname?, color? } → updated profile (requires Bearer JWT)
 */

import { Router } from "express";
import type { Response } from "express";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { getOrCreateProfile, updateProfile } from "../lib/profiles";

const router = Router();

// ─── GET /me ──────────────────────────────────────────────────────────────────

router.get("/", requireAuth, (req: AuthRequest, res: Response): void => {
  const profile = getOrCreateProfile(req.walletAddress!);
  res.json(profile);
});

// ─── POST /me ─────────────────────────────────────────────────────────────────

router.post("/", requireAuth, (req: AuthRequest, res: Response): void => {
  const { nickname, color } = req.body as {
    nickname?: string;
    color?:    string;
  };
  const profile = updateProfile(req.walletAddress!, { nickname, color });
  res.json(profile);
});

export default router;
