/**
 * Auth routes (SIWE)
 *
 * POST /auth/nonce   { address }            → { nonce }
 * POST /auth/verify  { message, signature } → { token, address }
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { generateNonce, verifySiweMessage, issueToken } from "../lib/auth";
import { getOrCreateProfile } from "../lib/profiles";

const router = Router();

// ─── POST /auth/nonce ─────────────────────────────────────────────────────────

router.post("/nonce", (req: Request, res: Response): void => {
  const { address } = req.body as { address?: string };
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    res.status(400).json({ error: "address must be a valid 0x-prefixed Ethereum address" });
    return;
  }
  const nonce = generateNonce(address);
  res.json({ nonce });
});

// ─── POST /auth/verify ────────────────────────────────────────────────────────

router.post("/verify", async (req: Request, res: Response): Promise<void> => {
  const { message, signature } = req.body as {
    message?:   string;
    signature?: string;
  };

  if (!message || !signature) {
    res.status(400).json({ error: "message and signature are required" });
    return;
  }

  const result = await verifySiweMessage(message, signature);
  if (!result) {
    res.status(401).json({ error: "Signature invalid or nonce expired" });
    return;
  }

  let token: string;
  try {
    token = issueToken(result.address);
  } catch {
    res.status(500).json({ error: "JWT_SECRET not configured on this server" });
    return;
  }

  // Touch / create profile on first sign-in
  getOrCreateProfile(result.address);

  res.json({ token, address: result.address });
});

export default router;
