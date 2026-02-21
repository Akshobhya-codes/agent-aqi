/**
 * POST /webhooks/quicknode
 *
 * Ingests QuickNode Streams swap-receipt events for Base Sepolia.
 *
 * Security:
 *   - HMAC-SHA256 of the raw body is verified against x-quicknode-signature.
 *   - Constant-time comparison via crypto.timingSafeEqual.
 *   - 401 on any mismatch; 400 on malformed JSON.
 *
 * Required env vars:
 *   QUICKNODE_STREAMS_WEBHOOK_SECRET  – signing secret from the QN dashboard
 *
 * Optional env vars:
 *   QUICKNODE_STREAM_ID – if set, incoming streamId is validated against it
 *
 * Expected payload shape (one webhook call = one block's worth of swaps):
 * {
 *   streamId?: string,
 *   network?:  string,
 *   swaps: Array<{
 *     txHash:      string,
 *     blockNumber: number,
 *     gasUsed:     string,
 *     status:      string,   // "success" | "reverted"
 *     from:        string,
 *     to:          string,
 *     contract:    string,
 *     topic:       string,
 *     logIndex:    number,
 *     timestamp:   number,
 *   }>
 * }
 */

import { Router } from "express";
import express from "express";
import type { Request, Response } from "express";
import crypto from "crypto";
import type { StreamEvent } from "@agent-aqi/shared";
import {
  addStreamEvent,
  emitEvent,
  findReceiptByTxHash,
  applyStreamConfirmation,
} from "../store";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireSecret(): string {
  const s = process.env["QUICKNODE_STREAMS_WEBHOOK_SECRET"];
  if (!s) throw new Error("QUICKNODE_STREAMS_WEBHOOK_SECRET is not set");
  return s;
}

/**
 * Constant-time HMAC-SHA256 comparison.
 * Returns false if lengths differ (prevents length-oracle attacks).
 */
function verifySignature(rawBody: Buffer, incomingSig: string, secret: string): boolean {
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed,    "hex"),
      Buffer.from(incomingSig, "hex"),
    );
  } catch {
    // timingSafeEqual throws when buffer lengths differ
    return false;
  }
}

// ─── Raw-body type guard ──────────────────────────────────────────────────────

function isRawBody(body: unknown): body is Buffer {
  return Buffer.isBuffer(body);
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * express.raw() is applied here so the raw bytes are available for HMAC
 * verification. This middleware must run before any JSON parsing for this route.
 */
router.post(
  "/quicknode",
  express.raw({ type: "application/json" }),
  (req: Request, res: Response): void => {
    // ── 1. Reject if secret not configured ─────────────────────────────────
    let secret: string;
    try {
      secret = requireSecret();
    } catch {
      console.error("[Streams] QUICKNODE_STREAMS_WEBHOOK_SECRET is not set");
      res.status(500).json({ error: "webhook secret not configured" });
      return;
    }

    // ── 2. Ensure we received raw bytes ────────────────────────────────────
    if (!isRawBody(req.body)) {
      res.status(400).json({ error: "expected raw body" });
      return;
    }

    const rawBody = req.body;

    // ── 3. Verify HMAC signature ───────────────────────────────────────────
    const incomingSig = (req.headers["x-quicknode-signature"] ?? "") as string;

    if (!incomingSig) {
      console.warn("[Streams] missing x-quicknode-signature header");
      res.status(401).json({ error: "missing signature" });
      return;
    }

    if (!verifySignature(rawBody, incomingSig, secret)) {
      console.warn("[Streams] invalid signature — possible replay or misconfiguration");
      res.status(401).json({ error: "invalid signature" });
      return;
    }

    // ── 4. Parse JSON ──────────────────────────────────────────────────────
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: "invalid JSON body" });
      return;
    }

    // ── 5. Validate stream ID (optional) ──────────────────────────────────
    const expectedStreamId = process.env["QUICKNODE_STREAM_ID"];
    const incomingStreamId = payload["streamId"];

    if (
      expectedStreamId &&
      incomingStreamId &&
      typeof incomingStreamId === "string" &&
      incomingStreamId !== expectedStreamId
    ) {
      console.warn(
        `[Streams] streamId mismatch: expected="${expectedStreamId}" got="${incomingStreamId}" — continuing`,
      );
    }

    // ── 6. Extract and normalise swap events ──────────────────────────────
    const rawSwaps = payload["swaps"];
    if (!Array.isArray(rawSwaps) || rawSwaps.length === 0) {
      // Not an error — streams send heartbeat / empty blocks
      res.status(200).json({ accepted: 0 });
      return;
    }

    let accepted = 0;

    for (const raw of rawSwaps) {
      if (typeof raw !== "object" || raw === null) continue;

      const s = raw as Record<string, unknown>;
      const txHash     = String(s["txHash"]     ?? "");
      const logIndex   = Number(s["logIndex"]   ?? 0);
      const blockNumber = Number(s["blockNumber"] ?? 0);
      const gasUsed    = String(s["gasUsed"]    ?? "0");
      const status     = String(s["status"]     ?? "unknown");
      const from       = String(s["from"]       ?? "");
      const to         = String(s["to"]         ?? "");
      const contract   = String(s["contract"]   ?? "");
      const topic      = String(s["topic"]      ?? "");
      const timestamp  = Number(s["timestamp"]  ?? 0);

      if (!txHash) continue; // skip malformed entries

      // ── 8. Match against existing receipts and update ──────────────────
      const receipt = findReceiptByTxHash(txHash);
      if (receipt) {
        applyStreamConfirmation(receipt, gasUsed, status);
        console.log(
          `[Streams] confirmed receipt jobId=${receipt.jobId} ` +
          `agentId=${receipt.agentId} evmStatus=${status} gasUsed=${gasUsed}`,
        );
      }

      const normalized: StreamEvent = {
        id: `${txHash}${logIndex}`,
        txHash,
        blockNumber,
        gasUsed,
        status,
        from,
        to,
        contract,
        topic,
        timestamp,
        source: "quicknode",
        ...(receipt && { matchedJobId: receipt.jobId }),
      };

      // ── 7. Store in ring-buffer ─────────────────────────────────────────
      addStreamEvent(normalized);

      console.log(
        `[Streams] verified event tx=${txHash.slice(0, 10)}… block=${blockNumber} ` +
        `status=${status} logIndex=${logIndex}`,
      );

      // ── 9. Broadcast to SSE clients ─────────────────────────────────────
      emitEvent("stream_event", {
        id:          normalized.id,
        txHash,
        blockNumber,
        gasUsed,
        status,
        from,
        to,
        contract,
        topic,
        timestamp,
        matchedJobId: receipt?.jobId,
      });

      accepted++;
    }

    res.status(200).json({ accepted });
  },
);

export default router;
