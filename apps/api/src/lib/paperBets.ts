/**
 * Paper Betting — in-memory store + business logic.
 *
 * No wallet required. Users pick a nickname, wager fake ETH on an agent,
 * and the winner-takes-pool formula distributes the losers' stakes among winners.
 *
 * P/L formula (winner-takes-pool):
 *   totalPool   = sum of all bets for the battle
 *   winnersPool = sum of bets on the winning agent
 *   losersPool  = totalPool - winnersPool
 *   payout      = amountEth + (amountEth / winnersPool) * losersPool   (winners only)
 *   pnlEth      = payout - amountEth
 *   roiPct      = (pnlEth / amountEth) * 100
 */

import { v4 as uuidv4 } from "uuid";
import type { AgentId, PaperBet, PaperBetResult, PaperLeaderboardEntry } from "@agent-aqi/shared";
import { emitEvent } from "../store";

// ─── In-memory stores ─────────────────────────────────────────────────────────

export const paperBets:    PaperBet[]       = [];
export const paperResults: PaperBetResult[] = [];

// ─── Per-nickname stats ───────────────────────────────────────────────────────

interface NicknameStats {
  nickname:       string;
  totalPnl:       number;
  totalBets:      number;
  wins:           number;
  totalWagered:   number;
  biggestWin:     number;
  biggestLoss:    number;
  currentStreak:  number; // positive = win streak, negative = loss streak
}

const nicknameStats = new Map<string, NicknameStats>();

function getOrCreate(nickname: string): NicknameStats {
  if (!nicknameStats.has(nickname)) {
    nicknameStats.set(nickname, {
      nickname,
      totalPnl:      0,
      totalBets:     0,
      wins:          0,
      totalWagered:  0,
      biggestWin:    0,
      biggestLoss:   0,
      currentStreak: 0,
    });
  }
  return nicknameStats.get(nickname)!;
}

// ─── Place a bet ──────────────────────────────────────────────────────────────

export function placeBet(
  battleId:  string,
  nickname:  string,
  agentId:   AgentId,
  amountEth: number,
): PaperBet {
  const bet: PaperBet = {
    id:        uuidv4(),
    battleId,
    nickname,
    agentId,
    amountEth,
    placedAt:  Date.now(),
  };
  paperBets.push(bet);

  emitEvent("paperbet_placed", {
    betId:     bet.id,
    battleId,
    nickname,
    agentId,
    amountEth,
  });

  // Also broadcast as participation_update so the live lobby refreshes instantly
  emitEvent("participation_update", {
    battleId,
    participant: { nickname, agentId, amountEth, placedAt: bet.placedAt },
  });

  return bet;
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export function getBetsForBattle(battleId: string): PaperBet[] {
  return paperBets.filter((b) => b.battleId === battleId);
}

export function getResultsForBattle(battleId: string): PaperBetResult[] {
  return paperResults.filter((r) => r.battleId === battleId);
}

export function getPoolSummary(battleId: string): Record<string, { count: number; total: number }> {
  const bets  = getBetsForBattle(battleId);
  const pool: Record<string, { count: number; total: number }> = {};
  for (const bet of bets) {
    if (!pool[bet.agentId]) pool[bet.agentId] = { count: 0, total: 0 };
    pool[bet.agentId]!.count++;
    pool[bet.agentId]!.total = r3(pool[bet.agentId]!.total + bet.amountEth);
  }
  return pool;
}

// ─── Resolve ──────────────────────────────────────────────────────────────────

export function resolvePaperBets(
  battleId:      string,
  winnerAgentId: AgentId,
): PaperBetResult[] {
  // Idempotent — skip if already resolved
  const existing = getResultsForBattle(battleId);
  if (existing.length > 0) return existing;

  const bets = getBetsForBattle(battleId);
  if (bets.length === 0) return [];

  const totalPool   = bets.reduce((s, b) => s + b.amountEth, 0);
  const winnerBets  = bets.filter((b) => b.agentId === winnerAgentId);
  const winnersPool = winnerBets.reduce((s, b) => s + b.amountEth, 0);
  const losersPool  = totalPool - winnersPool;

  const results: PaperBetResult[] = bets.map((bet) => {
    const won    = bet.agentId === winnerAgentId;
    let pnlEth   = -bet.amountEth;   // default: lost entire stake

    if (won && winnersPool > 0) {
      const share = bet.amountEth / winnersPool;
      const gain  = share * losersPool;
      pnlEth      = r4(gain);
    }

    const roiPct = r1((pnlEth / bet.amountEth) * 100);

    return {
      betId:     bet.id,
      battleId,
      nickname:  bet.nickname,
      agentId:   bet.agentId,
      amountEth: bet.amountEth,
      pnlEth,
      roiPct,
      won,
    };
  });

  paperResults.push(...results);

  // Update per-nickname stats
  for (const res of results) {
    const stats = getOrCreate(res.nickname);
    stats.totalPnl    = r4(stats.totalPnl + res.pnlEth);
    stats.totalBets++;
    stats.totalWagered = r3(stats.totalWagered + res.amountEth);

    if (res.won) {
      stats.wins++;
      if (res.pnlEth > stats.biggestWin) stats.biggestWin = res.pnlEth;
      stats.currentStreak = stats.currentStreak >= 0 ? stats.currentStreak + 1 : 1;
    } else {
      const loss = Math.abs(res.pnlEth);
      if (loss > stats.biggestLoss) stats.biggestLoss = loss;
      stats.currentStreak = stats.currentStreak <= 0 ? stats.currentStreak - 1 : -1;
    }
  }

  emitEvent("paperbet_resolved", {
    battleId,
    winnerAgentId,
    totalPool,
    results: results.map((r) => ({
      nickname: r.nickname,
      agentId:  r.agentId,
      pnlEth:   r.pnlEth,
      roiPct:   r.roiPct,
      won:      r.won,
    })),
  });

  console.log(
    `[PaperBets] battle=${battleId} winner=${winnerAgentId} resolved=${results.length} bets pool=${r3(totalPool)}Ξ`,
  );

  return results;
}

// ─── Global leaderboard ───────────────────────────────────────────────────────

export function getLeaderboard(): PaperLeaderboardEntry[] {
  const entries: PaperLeaderboardEntry[] = [];

  for (const stats of nicknameStats.values()) {
    entries.push({
      nickname:    stats.nickname,
      totalPnl:    stats.totalPnl,
      totalBets:   stats.totalBets,
      winRate:     stats.totalBets > 0 ? r1((stats.wins / stats.totalBets) * 100) : 0,
      avgBet:      stats.totalBets > 0 ? r3(stats.totalWagered / stats.totalBets) : 0,
      biggestWin:  stats.biggestWin,
      biggestLoss: stats.biggestLoss,
      streak:      stats.currentStreak,
    });
  }

  // Sort by total P/L descending
  return entries.sort((a, b) => b.totalPnl - a.totalPnl);
}

// ─── Rounding helpers ─────────────────────────────────────────────────────────

function r1(n: number): number { return Math.round(n * 10)    / 10; }
function r3(n: number): number { return Math.round(n * 1000)  / 1000; }
function r4(n: number): number { return Math.round(n * 10000) / 10000; }
