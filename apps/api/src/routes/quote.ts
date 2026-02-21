/**
 * POST /quote — synchronous Uniswap Trading API price quote
 *
 * Designed for the Swap Simulator UI so judges can see real Uniswap quotes
 * without going through the async job pipeline.
 *
 * Requirements:
 *   EXECUTION_MODE=quote or real   (returns 503 in "sim" mode)
 *   UNISWAP_API_KEY                (set in apps/api/.env)
 *
 * Request body:
 *   { tokenIn, tokenOut, amountIn, chainId? }
 *     tokenIn / tokenOut : 0x-prefixed Ethereum addresses (ERC-20)
 *     amountIn           : positive integer string (token smallest unit, e.g. wei)
 *     chainId            : optional; defaults to 84532 (Base Sepolia)
 *
 * Response (200):
 *   {
 *     mode        : "quote" | "real",
 *     params      : SwapParams,
 *     quotedOut   : string,          // output amount (smallest unit)
 *     routeSummary: string,          // human-readable route description
 *     hopCount    : number,          // pool hops traversed
 *     rawQuote    : object,          // full Uniswap API response for inspection
 *   }
 *
 * Errors:
 *   400  invalid body params
 *   503  EXECUTION_MODE=sim — set UNISWAP_API_KEY and switch to quote mode
 *   502  Uniswap API error (forwarded)
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { parseSwapParams } from "./jobs";
import { getSwapQuote } from "../integrations/uniswap";

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const mode = (process.env["EXECUTION_MODE"] ?? "sim") as "sim" | "quote" | "real";

  if (mode === "sim") {
    res.status(503).json({
      error:  "Swap Simulator requires EXECUTION_MODE=quote (or real). " +
              "Set UNISWAP_API_KEY in apps/api/.env and change EXECUTION_MODE=quote.",
      hint:   "In sim mode the server uses synthetic data only — no real Uniswap calls are made.",
    });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const parsed = parseSwapParams(body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  try {
    const quote = await getSwapQuote(parsed.params);
    res.json({
      mode,
      params:       parsed.params,
      quotedOut:    quote.quotedOut,
      routeSummary: quote.routeSummary,
      hopCount:     quote.hopCount,
      rawQuote:     quote.rawQuote,
    });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

export default router;
