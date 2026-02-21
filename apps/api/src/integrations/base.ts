/**
 * Base broadcaster — Phase 2.3
 *
 * Signs and broadcasts a pre-built swap transaction on Base (or Base Sepolia)
 * using viem, then waits for the receipt.
 *
 * Required env vars:
 *   BASE_RPC_URL      – HTTP RPC endpoint (QuickNode, Alchemy, public, …)
 *   AGENT_PRIVATE_KEY – 0x-prefixed 32-byte private key for the signing wallet
 *
 * The wallet must:
 *   - Hold enough native ETH to cover gas.
 *   - Have approved the Uniswap Permit2 contract for the input token, OR the
 *     swapTxRequest must embed a valid Permit2 EIP-712 signature (Phase 2.3+).
 *
 * This module is imported only when EXECUTION_MODE=real.
 * EXECUTION_MODE=quote stays fully unchanged.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

// ─── Result type ──────────────────────────────────────────────────────────────

export interface SendTxResult {
  txHash:      string;
  blockNumber: string; // decimal string (bigint → string)
  chainId:     number;
  gasUsed:     string; // decimal string (bigint → string)
  status:      "success" | "reverted";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`${key} is not set — required for EXECUTION_MODE=real`);
  return val;
}

function chainForId(chainId: number) {
  if (chainId === 8453)  return base;
  if (chainId === 84532) return baseSepolia;
  // Fallback: try Base Sepolia (testnet) for unknown IDs
  console.warn(`[base] Unknown chainId ${chainId}, falling back to Base Sepolia`);
  return baseSepolia;
}

// ─── sendTx ───────────────────────────────────────────────────────────────────

/**
 * Sign and broadcast a swap transaction, then wait for confirmation.
 *
 * @param tx - Fields from a SwapTxRequest (value is a decimal integer string).
 * @returns On-chain receipt data once the tx is mined.
 * @throws If BASE_RPC_URL or AGENT_PRIVATE_KEY are missing, or if the tx fails.
 */
export async function sendTx(tx: {
  to:      string;   // 0x-prefixed Ethereum address
  data:    string;   // 0x-prefixed calldata
  value:   string;   // decimal integer string (e.g. "0" or "1000000000000000")
  chainId: number;
  gas?:    string;   // decimal integer string gas limit
}): Promise<SendTxResult> {
  const rpcUrl    = requireEnv("BASE_RPC_URL");
  const rawKey    = requireEnv("AGENT_PRIVATE_KEY");

  // Ensure private key is 0x-prefixed
  const privateKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;

  const chain   = chainForId(tx.chainId);
  const account = privateKeyToAccount(privateKey);

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // Convert string fields to the types viem expects
  const toAddr   = tx.to   as `0x${string}`;
  const dataHex  = tx.data as `0x${string}`;
  const valueWei = BigInt(tx.value);
  const gasLimit = tx.gas !== undefined ? BigInt(tx.gas) : undefined;

  // ── Broadcast ──────────────────────────────────────────────────────────────
  let txHash: Hash;
  try {
    txHash = await walletClient.sendTransaction({
      to:    toAddr,
      data:  dataHex,
      value: valueWei,
      ...(gasLimit !== undefined && { gas: gasLimit }),
    });
  } catch (err) {
    throw new Error(`sendTransaction failed: ${String(err)}`);
  }

  // ── Wait for receipt ───────────────────────────────────────────────────────
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  } catch (err) {
    throw new Error(
      `waitForTransactionReceipt failed for ${txHash}: ${String(err)}`,
    );
  }

  return {
    txHash:      txHash,
    blockNumber: receipt.blockNumber.toString(),
    chainId:     tx.chainId,
    gasUsed:     receipt.gasUsed.toString(),
    status:      receipt.status, // "success" | "reverted"
  };
}
