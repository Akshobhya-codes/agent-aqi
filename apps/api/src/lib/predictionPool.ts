/**
 * predictionPool.ts
 *
 * Viem helpers for the EscrowPredictionPool contract on Base Sepolia.
 *
 * All functions are no-ops (return null) when PREDICTION_ENABLED !== "true"
 * or the contract address / RPC URL are missing — the feature degrades
 * gracefully without throwing.
 *
 * Environment variables consumed:
 *   PREDICTION_ENABLED          "true" | "false" (default: "false")
 *   PREDICTION_CONTRACT_ADDRESS 0x-prefixed contract address
 *   BASE_RPC_URL                HTTP RPC endpoint
 *   CHAIN_ID                    Numeric chain id (default: 84532 = Base Sepolia)
 *   ADMIN_PRIVATE_KEY           0x-prefixed or raw hex key for resolveBattle txs
 *
 * Agent ↔ index mapping (mirrors the contract):
 *   safe  → 0 (SafeGuard)
 *   fast  → 1 (SpeedRunner)
 *   cheap → 2 (GasOptimizer)
 *
 * Battle ID mapping:
 *   off-chain UUID string  →  keccak256(utf8Bytes(uuid))  →  BigInt
 *   Matches: uint256(keccak256(abi.encodePacked(battleIdString))) in Solidity
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import type { AgentId } from "@agent-aqi/shared";

// ─── Agent ↔ index ────────────────────────────────────────────────────────────

export const AGENT_INDEX: Record<AgentId, number> = {
  safe:  0,
  fast:  1,
  cheap: 2,
};

export const INDEX_AGENT: Record<number, AgentId> = {
  0: "safe",
  1: "fast",
  2: "cheap",
};

// ─── Minimal contract ABI ─────────────────────────────────────────────────────

const POOL_ABI = [
  {
    name: "resolveBattle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "battleId",      type: "uint256" },
      { name: "winnerAgentId", type: "uint8"   },
    ],
    outputs: [],
  },
  {
    name: "getBattleTotals",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "battleId", type: "uint256" }],
    outputs: [
      { name: "total0", type: "uint256" },
      { name: "total1", type: "uint256" },
      { name: "total2", type: "uint256" },
    ],
  },
  {
    name: "getUserPrediction",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "battleId", type: "uint256" },
      { name: "user",     type: "address" },
    ],
    outputs: [
      { name: "agentId",   type: "uint8"   },
      { name: "amount",    type: "uint256" },
      { name: "withdrawn", type: "bool"    },
    ],
  },
  {
    name: "getBattle",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "battleId", type: "uint256" }],
    outputs: [
      { name: "exists",        type: "bool"  },
      { name: "resolved",      type: "bool"  },
      { name: "winnerAgentId", type: "uint8" },
    ],
  },
] as const;

// ─── Config helpers ───────────────────────────────────────────────────────────

/** True when the feature is enabled AND the contract address + RPC are set. */
export function isPredictionEnabled(): boolean {
  return (
    process.env["PREDICTION_ENABLED"] === "true" &&
    Boolean(process.env["PREDICTION_CONTRACT_ADDRESS"]) &&
    Boolean(process.env["BASE_RPC_URL"])
  );
}

/** True when auto-resolve is possible (feature enabled + admin key present). */
export function canAutoResolve(): boolean {
  return isPredictionEnabled() && Boolean(process.env["ADMIN_PRIVATE_KEY"]);
}

// ─── ID conversion ────────────────────────────────────────────────────────────

/**
 * Convert an Arena UUID string to the uint256 used as battleId on-chain.
 * Matches: uint256(keccak256(abi.encodePacked(battleIdString))) in Solidity.
 */
export function battleUuidToOnChainId(uuid: string): bigint {
  return BigInt(keccak256(toBytes(uuid)));
}

// ─── Client factories ─────────────────────────────────────────────────────────

function getChain() {
  const id = parseInt(process.env["CHAIN_ID"] ?? "84532", 10);
  return id === 8453 ? base : baseSepolia;
}

function getPublicClient() {
  return createPublicClient({
    chain:     getChain(),
    transport: http(process.env["BASE_RPC_URL"]!),
  });
}

function getContractAddress(): `0x${string}` {
  return process.env["PREDICTION_CONTRACT_ADDRESS"] as `0x${string}`;
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

export interface BattleTotals {
  safe:  bigint;
  fast:  bigint;
  cheap: bigint;
}

/**
 * Read the ETH pot totals for each agent from the contract.
 * Returns null when the feature is disabled or the call fails.
 */
export async function fetchBattleTotals(uuid: string): Promise<BattleTotals | null> {
  if (!isPredictionEnabled()) return null;
  try {
    const result = await getPublicClient().readContract({
      address:      getContractAddress(),
      abi:          POOL_ABI,
      functionName: "getBattleTotals",
      args:         [battleUuidToOnChainId(uuid)],
    });
    const [total0, total1, total2] = result as [bigint, bigint, bigint];
    return { safe: total0, fast: total1, cheap: total2 };
  } catch (err) {
    console.error("[Prediction] fetchBattleTotals error:", err);
    return null;
  }
}

export interface OnChainBattleInfo {
  exists:        boolean;
  resolved:      boolean;
  winnerAgentId: AgentId | null;
}

/**
 * Read battle metadata (exists / resolved / winner) from the contract.
 */
export async function fetchBattleInfo(uuid: string): Promise<OnChainBattleInfo | null> {
  if (!isPredictionEnabled()) return null;
  try {
    const result = await getPublicClient().readContract({
      address:      getContractAddress(),
      abi:          POOL_ABI,
      functionName: "getBattle",
      args:         [battleUuidToOnChainId(uuid)],
    });
    const [exists, resolved, winnerIdx] = result as [boolean, boolean, number];
    return {
      exists,
      resolved,
      winnerAgentId: resolved ? (INDEX_AGENT[winnerIdx] ?? null) : null,
    };
  } catch (err) {
    console.error("[Prediction] fetchBattleInfo error:", err);
    return null;
  }
}

export interface UserPrediction {
  agentId:   number;
  agentName: AgentId;
  amountWei: bigint;
  withdrawn: boolean;
}

/**
 * Read a user's prediction for a battle.
 * Returns null when no prediction exists or the feature is disabled.
 */
export async function fetchUserPrediction(
  uuid:        string,
  userAddress: string,
): Promise<UserPrediction | null> {
  if (!isPredictionEnabled()) return null;
  try {
    const result = await getPublicClient().readContract({
      address:      getContractAddress(),
      abi:          POOL_ABI,
      functionName: "getUserPrediction",
      args:         [battleUuidToOnChainId(uuid), userAddress as `0x${string}`],
    });
    const [agentId, amount, withdrawn] = result as [number, bigint, boolean];
    if (amount === 0n) return null; // no prediction placed
    return {
      agentId,
      agentName: INDEX_AGENT[agentId] ?? "safe",
      amountWei: amount,
      withdrawn,
    };
  } catch (err) {
    console.error("[Prediction] fetchUserPrediction error:", err);
    return null;
  }
}

// ─── Write helper ─────────────────────────────────────────────────────────────

export interface ResolveResult {
  txHash: string;
}

/**
 * Submit resolveBattle(battleId, winnerAgentId) to the contract.
 *
 * - Uses ADMIN_PRIVATE_KEY to sign the transaction.
 * - Returns the tx hash immediately after submission (does NOT wait for receipt).
 * - Confirmation is logged asynchronously (best-effort).
 * - Returns null when the feature is disabled or ADMIN_PRIVATE_KEY is missing.
 */
export async function resolvePredictionBattle(
  uuid:   string,
  winner: AgentId,
): Promise<ResolveResult | null> {
  if (!canAutoResolve()) return null;

  const adminKey = process.env["ADMIN_PRIVATE_KEY"]!;
  const keyHex: `0x${string}` = adminKey.startsWith("0x")
    ? (adminKey as `0x${string}`)
    : (`0x${adminKey}` as `0x${string}`);

  const account       = privateKeyToAccount(keyHex);
  const chain         = getChain();
  const rpcUrl        = process.env["BASE_RPC_URL"]!;
  const publicClient  = getPublicClient();
  const walletClient  = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  const onChainId  = battleUuidToOnChainId(uuid);
  const winnerIdx  = AGENT_INDEX[winner];

  const txHash = await walletClient.writeContract({
    address:      getContractAddress(),
    abi:          POOL_ABI,
    functionName: "resolveBattle",
    args:         [onChainId, winnerIdx],
  });

  console.log(
    `[Prediction] resolveBattle submitted tx=${txHash} ` +
    `battle=${uuid} winner=${winner}(${winnerIdx})`,
  );

  // Wait for confirmation in the background — doesn't block the caller
  publicClient
    .waitForTransactionReceipt({ hash: txHash, timeout: 60_000 })
    .then(() => console.log(`[Prediction] confirmed tx=${txHash}`))
    .catch((err: unknown) =>
      console.warn(`[Prediction] confirm timeout for tx=${txHash}:`, err),
    );

  return { txHash };
}
