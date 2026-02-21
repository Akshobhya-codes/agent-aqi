/**
 * predictionContract.ts
 *
 * Client-side helpers for calling EscrowPredictionPool on Base Sepolia.
 *
 * All transaction functions use window.ethereum (EIP-1193) directly.
 * ABI encoding is done with viem's pure utility functions (SSR-safe).
 *
 * Environment variables (must be prefixed NEXT_PUBLIC_ to reach the browser):
 *   NEXT_PUBLIC_PREDICTION_ENABLED           "true" | "false"
 *   NEXT_PUBLIC_PREDICTION_CONTRACT_ADDRESS  0x-prefixed contract address
 */

import { encodeFunctionData, keccak256, parseEther, toBytes } from "viem";
import type { AgentId } from "@agent-aqi/shared";

// ─── Config ───────────────────────────────────────────────────────────────────

export const PREDICTION_ENABLED =
  process.env["NEXT_PUBLIC_PREDICTION_ENABLED"] === "true";

export const PREDICTION_CONTRACT =
  (process.env["NEXT_PUBLIC_PREDICTION_CONTRACT_ADDRESS"] ?? "") as `0x${string}`;

// ─── Agent index (mirrors contract + API) ─────────────────────────────────────

export const AGENT_INDEX: Record<AgentId, number> = { safe: 0, fast: 1, cheap: 2 };

// ─── Minimal write ABI ────────────────────────────────────────────────────────

const POOL_WRITE_ABI = [
  {
    name: "placePrediction",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "battleId", type: "uint256" },
      { name: "agentId",  type: "uint8"   },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "battleId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "claimPoints",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "battleId", type: "uint256" }],
    outputs: [],
  },
] as const;

// ─── ID conversion ────────────────────────────────────────────────────────────

/**
 * Convert an Arena UUID string to the uint256 used as battleId on-chain.
 * Matches: uint256(keccak256(abi.encodePacked(battleIdString))) in Solidity.
 */
export function battleUuidToOnChainId(uuid: string): bigint {
  return BigInt(keccak256(toBytes(uuid)));
}

// ─── EIP-1193 provider accessor ───────────────────────────────────────────────

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getProvider(): Eip1193Provider {
  if (typeof window === "undefined") throw new Error("Not in browser");
  const p = ((window as unknown) as { ethereum?: Eip1193Provider }).ethereum;
  if (!p) throw new Error("No wallet detected. Please install MetaMask.");
  return p;
}

function requireContract(): `0x${string}` {
  if (!PREDICTION_CONTRACT) throw new Error("Prediction contract not configured.");
  return PREDICTION_CONTRACT;
}

// ─── Write calls ──────────────────────────────────────────────────────────────

/**
 * Call placePrediction — sends ETH equal to amountEth (e.g. "0.0001").
 * Returns the transaction hash immediately (before confirmation).
 */
export async function callPlacePrediction(
  uuid:        string,
  agentId:     AgentId,
  amountEth:   string,
  fromAddress: string,
): Promise<string> {
  const provider  = getProvider();
  const contract  = requireContract();
  const onChainId = battleUuidToOnChainId(uuid);

  const data  = encodeFunctionData({
    abi:          POOL_WRITE_ABI,
    functionName: "placePrediction",
    args:         [onChainId, AGENT_INDEX[agentId]],
  });
  const value = "0x" + parseEther(amountEth).toString(16);

  return (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: fromAddress, to: contract, data, value }],
  })) as string;
}

/**
 * Call withdraw — reclaim the refundable deposit after battle resolution.
 */
export async function callWithdraw(
  uuid:        string,
  fromAddress: string,
): Promise<string> {
  const provider  = getProvider();
  const contract  = requireContract();
  const onChainId = battleUuidToOnChainId(uuid);

  const data = encodeFunctionData({
    abi:          POOL_WRITE_ABI,
    functionName: "withdraw",
    args:         [onChainId],
  });

  return (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: fromAddress, to: contract, data }],
  })) as string;
}

/**
 * Call claimPoints — award on-chain points for a correct prediction.
 */
export async function callClaimPoints(
  uuid:        string,
  fromAddress: string,
): Promise<string> {
  const provider  = getProvider();
  const contract  = requireContract();
  const onChainId = battleUuidToOnChainId(uuid);

  const data = encodeFunctionData({
    abi:          POOL_WRITE_ABI,
    functionName: "claimPoints",
    args:         [onChainId],
  });

  return (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: fromAddress, to: contract, data }],
  })) as string;
}
