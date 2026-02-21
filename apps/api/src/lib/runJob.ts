/**
 * Core job execution engine.
 *
 * Extracted so it can be called both from POST /jobs (HTTP handler)
 * and from POST /arena/battle (parallel multi-agent orchestration)
 * without duplicating logic.
 *
 * The caller pre-generates `jobId` so it can be returned to the HTTP client
 * before this async function resolves.
 */

import type {
  AgentId,
  AgentEconomics,
  AgentPolicy,
  JobType,
  Receipt,
  SwapParams,
  SwapQuote,
  SwapTxRequest,
  OnChainEvidence,
} from "@agent-aqi/shared";
import { runAgent, AGENT_META, AGENT_POLICY } from "../agents";
import { addReceipt, emitEvent } from "../store";
import { getSwapQuote, buildSwapTx } from "../integrations/uniswap";
import { sendTx } from "../integrations/base";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RunJobParams {
  /** Pre-generated UUID used as the canonical job identifier in all SSE events. */
  jobId:       string;
  agentId:     AgentId;
  jobType:     JobType;
  swapParams?: SwapParams;
  mode:        "sim" | "quote" | "real";
  /** When set, all emitted SSE events include this `battleId` in their payload. */
  battleId?:   string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function explorerUrl(txHash: string, chainId: number): string {
  const base = chainId === 8453 ? "https://basescan.org" : "https://sepolia.basescan.org";
  return `${base}/tx/${txHash}`;
}

// ─── Core executor ────────────────────────────────────────────────────────────

/**
 * Execute one job for one agent — full pipeline:
 *   queued → running → [uniswap quote] → [buildSwapTx] → [sendTx] → agent sim → fulfilled/failed
 *
 * All SSE events include `battleId` when provided.
 * Throws on unrecoverable error (caller should catch; failed SSE is also emitted).
 */
export async function runJob(params: RunJobParams): Promise<Receipt> {
  const { jobId, agentId, jobType, swapParams, mode, battleId } = params;

  // Extra fields included in every SSE payload for this job
  const bx = battleId ? { battleId } : {};

  // ── queued ─────────────────────────────────────────────────────────────────
  emitEvent("queued", {
    jobId,
    agentId,
    agentName: AGENT_META[agentId].displayName,
    jobType,
    mode,
    ...bx,
    ...(swapParams && {
      inputToken:  swapParams.inputToken,
      outputToken: swapParams.outputToken,
      amountIn:    swapParams.amountIn,
      chainId:     swapParams.chainId,
    }),
  });

  // ── running ────────────────────────────────────────────────────────────────
  emitEvent("running", { jobId, agentId, mode, ...bx });

  // Look up the per-agent routing policy (used in quote / real mode)
  const policy: AgentPolicy = AGENT_POLICY[agentId];
  // Convert basis points → percent for the Uniswap API (50 bps = 0.5 %)
  const slippagePct = policy.slippageBps / 100;

  let quoteResult:   SwapQuote      | undefined;
  let swapTxRequest: SwapTxRequest  | undefined;
  let onChain:       OnChainEvidence | undefined;
  let economics:     AgentEconomics | undefined;

  try {
    if ((mode === "quote" || mode === "real") && swapParams) {
      // ── Phase 2.1: price quote (with per-agent slippage tolerance) ────────
      try {
        const quoteWithMeta = await getSwapQuote(swapParams, slippagePct);
        quoteResult = quoteWithMeta; // SwapQuoteWithMeta is a superset of SwapQuote
        economics = {
          quotedOut:    quoteWithMeta.quotedOut,
          hopCount:     quoteWithMeta.hopCount,
        };
      } catch (quoteErr) {
        emitEvent("failed", { jobId, agentId, error: String(quoteErr), phase: "uniswap_quote", ...bx });
        throw quoteErr;
      }

      // ── Phase 2.2: build unsigned tx payload ──────────────────────────────
      try {
        swapTxRequest = await buildSwapTx(swapParams, quoteResult.rawQuote);
        // Enrich economics with the gas estimate from the /swap response
        if (economics && swapTxRequest.gas) {
          economics = { ...economics, gasEstimate: swapTxRequest.gas };
        }
      } catch (txErr) {
        emitEvent("failed", { jobId, agentId, error: String(txErr), phase: "uniswap_tx_build", ...bx });
        throw txErr;
      }

      // ── Phase 2.3: sign + broadcast (real mode only) ──────────────────────
      if (mode === "real") {
        try {
          const result = await sendTx(swapTxRequest);

          emitEvent("tx_submitted", {
            jobId,
            agentId,
            txHash:      result.txHash,
            explorerUrl: explorerUrl(result.txHash, swapTxRequest.chainId),
            ...bx,
          });

          onChain = {
            txHash:      result.txHash,
            blockNumber: Number(result.blockNumber),
            chainId:     result.chainId,
            gasUsed:     result.gasUsed,
            status:      result.status,
          };

          emitEvent("tx_confirmed", {
            jobId,
            agentId,
            txHash:      result.txHash,
            status:      result.status,
            gasUsed:     result.gasUsed,
            blockNumber: result.blockNumber,
            explorerUrl: explorerUrl(result.txHash, swapTxRequest.chainId),
            ...bx,
          });
        } catch (sendErr) {
          const phase = String(sendErr).includes("waitForTransactionReceipt")
            ? "base_confirm_tx"
            : "base_send_tx";
          emitEvent("failed", { jobId, agentId, error: String(sendErr), phase, ...bx });
          throw sendErr;
        }
      }
    }

    // ── Agent simulation (outcome metrics) ────────────────────────────────────
    const receipt = await runAgent(agentId, jobType);

    // Overwrite the UUID that runAgent generated with the pre-agreed jobId
    (receipt as { jobId: string }).jobId = jobId;

    // Attach optional fields
    if (battleId)    (receipt as { battleId?: string }).battleId = battleId;
    if (swapParams)    receipt.swapParams    = swapParams;
    if (quoteResult)   receipt.quoteResult   = quoteResult;
    if (swapTxRequest) receipt.swapTxRequest = swapTxRequest;
    if (onChain)       receipt.onChain       = onChain;

    // Always attach the routing policy so the UI can show "Policy Decisions"
    receipt.policy = policy;
    if (economics)   receipt.economics = economics;

    if (mode !== "sim") {
      // Use the agent's actual policy slippage (not a fixed 50 bps)
      receipt.outcome.slippageBps = policy.slippageBps;
    }

    addReceipt(receipt);

    // ── fulfilled / failed ────────────────────────────────────────────────────
    emitEvent(receipt.outcome.status, {
      jobId,
      agentId:     receipt.agentId,
      mode,
      latencyMs:   receipt.outcome.latencyMs,
      gasUsedUsd:  receipt.outcome.gasUsedUsd,
      slippageBps: receipt.outcome.slippageBps,
      safetyFlags: receipt.outcome.safetyFlags,
      // Policy decisions (always present)
      policy: receipt.policy,
      ...(receipt.quoteResult && {
        quotedOut:    receipt.quoteResult.quotedOut,
        routeSummary: receipt.quoteResult.routeSummary,
      }),
      ...(receipt.economics && {
        hopCount:     receipt.economics.hopCount,
        gasEstimate:  receipt.economics.gasEstimate,
      }),
      ...(receipt.swapTxRequest && {
        txTo:  receipt.swapTxRequest.to,
        txGas: receipt.swapTxRequest.gas,
      }),
      ...(receipt.onChain && {
        txHash:        receipt.onChain.txHash,
        onChainStatus: receipt.onChain.status,
      }),
      ...bx,
    });

    return receipt;
  } catch (err) {
    // Generic catch for unexpected errors not already emitted above
    emitEvent("failed", { jobId, agentId, error: String(err), ...bx });
    throw err;
  }
}
