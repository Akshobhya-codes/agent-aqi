/**
 * In-memory store for receipts, SSE events, and QuickNode stream events.
 */

import type { AgentId, BattleRecord, BattleScorecard, Receipt, SSEEvent, StreamEvent } from "@agent-aqi/shared";
import { v4 as uuidv4 } from "uuid";
import type { Response } from "express";

// ─── Data stores ──────────────────────────────────────────────────────────────

export const receipts: Receipt[] = [];

export const events: SSEEvent[] = [];

/** Capped ring-buffer of normalised QuickNode stream events (max 5000). */
export const streamEvents: StreamEvent[] = [];

const MAX_STREAM_EVENTS = 5_000;

// ─── SSE client registry ──────────────────────────────────────────────────────

const sseClients = new Set<Response>();

export function addSSEClient(res: Response): void {
  sseClients.add(res);
}

export function removeSSEClient(res: Response): void {
  sseClients.delete(res);
}

// ─── Event helpers ────────────────────────────────────────────────────────────

export function emitEvent(
  type: SSEEvent["type"],
  payload: Record<string, unknown>,
): SSEEvent {
  const event: SSEEvent = {
    id:      uuidv4(),
    ts:      Date.now(),
    type,
    payload,
  };
  events.push(event);

  // broadcast to all connected SSE clients
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    client.write(data);
  }

  return event;
}

export function addReceipt(receipt: Receipt): void {
  receipts.push(receipt);
}

export function getReceiptsByAgent(agentId: string): Receipt[] {
  return receipts.filter((r) => r.agentId === agentId);
}

// ─── Battle store ─────────────────────────────────────────────────────────────

export const battles: BattleRecord[] = [];

const MAX_BATTLES = 100;

// ─── Current battle (admin-controlled lobby) ──────────────────────────────────

/** The battleId that is currently "live" (lobby → running → complete). */
let _currentBattleId: string | null = null;

export function setCurrentBattleId(id: string | null): void {
  _currentBattleId = id;
}

export function getCurrentBattleId(): string | null {
  return _currentBattleId;
}

export function addBattle(battle: BattleRecord): void {
  battles.push(battle);
  if (battles.length > MAX_BATTLES) {
    battles.splice(0, battles.length - MAX_BATTLES);
  }
}

export function getBattle(battleId: string): BattleRecord | undefined {
  return battles.find((b) => b.battleId === battleId);
}

export function updateBattleScorecard(
  battleId: string,
  agentId: AgentId,
  patch: Partial<BattleScorecard>,
): void {
  const battle = getBattle(battleId);
  if (!battle) return;
  const card = battle.scorecards.find((s: BattleScorecard) => s.agentId === agentId);
  if (card) Object.assign(card, patch);
}

/** Transition a lobby battle to "running" (jobs about to execute). */
export function startBattle(battleId: string): void {
  const battle = getBattle(battleId);
  if (!battle) return;
  battle.status = "running";
}

export function finalizeBattle(battleId: string, winnerAgentId: AgentId | undefined): void {
  const battle = getBattle(battleId);
  if (!battle) return;
  battle.status         = "complete";
  battle.winnerAgentId  = winnerAgentId;
}

/** Return the `limit` most-recent battles, newest first. */
export function getRecentBattles(limit: number): BattleRecord[] {
  return [...battles].reverse().slice(0, Math.max(1, limit));
}

// ─── Stream event helpers ─────────────────────────────────────────────────────

/** Append a normalised stream event; evict oldest if over capacity. */
export function addStreamEvent(event: StreamEvent): void {
  streamEvents.push(event);
  if (streamEvents.length > MAX_STREAM_EVENTS) {
    streamEvents.splice(0, streamEvents.length - MAX_STREAM_EVENTS);
  }
}

/** Return the `limit` most recent stream events (newest last). */
export function getStreamEvents(limit: number): StreamEvent[] {
  return streamEvents.slice(-Math.max(1, limit));
}

/**
 * Find the first receipt whose on-chain tx hash matches.
 * Returns the receipt object directly (mutations are reflected in the store).
 */
export function findReceiptByTxHash(txHash: string): Receipt | undefined {
  const lower = txHash.toLowerCase();
  return receipts.find(
    (r) => r.onChain?.txHash?.toLowerCase() === lower,
  );
}

/**
 * Update an existing receipt's on-chain evidence and outcome status
 * based on confirmed stream data.
 *
 * @param receipt - Must be a direct reference from the `receipts` array.
 * @param gasUsed - Gas units consumed (decimal string from stream).
 * @param evmStatus - "success" | "reverted" from the EVM.
 */
export function applyStreamConfirmation(
  receipt: Receipt,
  gasUsed: string,
  evmStatus: string,
): void {
  if (receipt.onChain) {
    receipt.onChain.gasUsed     = gasUsed;
    receipt.onChain.status      = evmStatus === "success" ? "success" : "reverted";
    receipt.onChain.verifiedBy  = "quicknode";
    receipt.onChain.confirmedAt = Date.now();
  }
  // Map EVM status → job status so AQI scoring reflects confirmed outcome
  receipt.outcome.status = evmStatus === "success" ? "fulfilled" : "failed";

  // Propagate verification to the battle scorecard when this receipt is part of a battle
  if (receipt.battleId) {
    updateBattleScorecard(receipt.battleId, receipt.agentId, { verifiedByStream: true });
  }
}
