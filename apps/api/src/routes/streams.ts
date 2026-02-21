/**
 * GET  /streams          — last 100 stream events
 * POST /streams/dev/emit — dev-only fake event (NODE_ENV !== "production")
 *
 * The dev/emit endpoint bypasses signature verification and injects a
 * synthetic swap event through the same normalization + store pipeline used
 * by the real webhook.  This lets the UI be tested without a live QuickNode
 * stream.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import crypto from "crypto";
import type { StreamEvent } from "@agent-aqi/shared";
import {
  getStreamEvents,
  addStreamEvent,
  emitEvent,
  findReceiptByTxHash,
  applyStreamConfirmation,
  receipts,
} from "../store";

const router = Router();

// ─── GET /streams ─────────────────────────────────────────────────────────────

router.get("/", (_req: Request, res: Response) => {
  const events = getStreamEvents(100);
  const verifiedCount = receipts.slice(-50).filter((r) => r.onChain?.verifiedBy === "quicknode").length;
  res.json({ count: events.length, events, verifiedCount });
});

// ─── POST /streams/dev/emit ───────────────────────────────────────────────────

router.post("/dev/emit", (req: Request, res: Response): void => {
  // Guard: never active in production
  if (process.env["NODE_ENV"] === "production") {
    res.status(404).json({ error: "not found" });
    return;
  }

  // ── Build a fake swap entry ───────────────────────────────────────────────
  // Allow the caller to override txHash so a real receipt can be targeted.
  const body = (req.body ?? {}) as Record<string, unknown>;

  const txHash =
    typeof body["txHash"] === "string" && body["txHash"]
      ? body["txHash"]
      : "0x" + crypto.randomBytes(32).toString("hex");

  const logIndex    = typeof body["logIndex"] === "number" ? body["logIndex"] : 0;
  const blockNumber = typeof body["blockNumber"] === "number"
    ? body["blockNumber"]
    : 18_000_000 + Math.floor(Math.random() * 100_000);

  // Use actual gasUsed from a matched receipt if one exists, else random
  const matchedPreview = findReceiptByTxHash(txHash);
  const gasUsed =
    typeof body["gasUsed"] === "string"
      ? body["gasUsed"]
      : matchedPreview?.onChain?.gasUsed ?? String(100_000 + Math.floor(Math.random() * 200_000));

  const statusOptions = ["success", "reverted"] as const;
  const status =
    typeof body["status"] === "string"
      ? body["status"]
      : statusOptions[Math.random() < 0.85 ? 0 : 1];

  // Pick from/to/contract addresses: use last real receipt if one matches,
  // otherwise generate plausible-looking fake ones.
  const fakeAddr = () => "0x" + crypto.randomBytes(20).toString("hex");

  const from     = typeof body["from"]     === "string" ? body["from"]     : fakeAddr();
  const to       = typeof body["to"]       === "string" ? body["to"]       : fakeAddr();
  const contract = typeof body["contract"] === "string" ? body["contract"] : fakeAddr();

  // Uniswap V3 Swap event: keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)")
  const SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
  const topic      = typeof body["topic"] === "string" ? body["topic"] : SWAP_TOPIC;
  const timestamp  = Math.floor(Date.now() / 1000);

  // ── Match against existing receipts ──────────────────────────────────────
  // Optionally inject into a real receipt's txHash for end-to-end testing.
  // If no explicit txHash was given, pick a random real receipt that has
  // onChain data so you can see the confirmation flow.
  let effectiveTxHash = txHash;
  let targetReceipt   = findReceiptByTxHash(txHash);

  if (!targetReceipt && !body["txHash"]) {
    // Auto-pick a real receipt with onChain data for a more realistic demo
    const withOnChain = receipts.filter((r) => r.onChain?.txHash);
    if (withOnChain.length > 0) {
      const r = withOnChain[Math.floor(Math.random() * withOnChain.length)];
      effectiveTxHash = r.onChain!.txHash;
      targetReceipt   = r;
    }
  }

  if (targetReceipt) {
    applyStreamConfirmation(targetReceipt, gasUsed, status);
    console.log(
      `[Streams/dev] confirmed receipt jobId=${targetReceipt.jobId} ` +
      `evmStatus=${status} gasUsed=${gasUsed}`,
    );
  }

  const normalized: StreamEvent = {
    id:          `${effectiveTxHash}${logIndex}`,
    txHash:      effectiveTxHash,
    blockNumber,
    gasUsed,
    status,
    from,
    to,
    contract,
    topic,
    timestamp,
    source: "dev",
    ...(targetReceipt && { matchedJobId: targetReceipt.jobId }),
  };

  addStreamEvent(normalized);

  console.log(
    `[Streams/dev] emitted fake event tx=${effectiveTxHash.slice(0, 10)}… ` +
    `block=${blockNumber} status=${status}`,
  );

  emitEvent("stream_event", normalized as unknown as Record<string, unknown>);

  res.json({ ok: true, event: normalized });
});

export default router;
