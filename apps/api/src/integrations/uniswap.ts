/**
 * Uniswap Trading API integration (Phase 2.1 + 2.2)
 *
 * Phase 2.1 — getSwapQuote
 *   POST https://trade-api.gateway.uniswap.org/v1/quote
 *   Returns price, route summary, and the full raw API response.
 *
 * Phase 2.2 — buildSwapTx
 *   POST https://trade-api.gateway.uniswap.org/v1/swap
 *   Reuses the raw quote response from Phase 2.1.
 *   Returns an unsigned transaction request ready to sign + broadcast.
 *   Does NOT broadcast — that is Phase 2.3.
 *
 * Docs: https://api-docs.uniswap.org/api-reference/swapping/quote
 *       https://api-docs.uniswap.org/guides/swapping_end_to_end
 *
 * Required env vars:
 *   UNISWAP_API_KEY      – from Uniswap Labs (request at https://hub.uniswap.org)
 *
 * Optional env vars:
 *   SWAP_SENDER_ADDRESS  – wallet address for gas estimation (quote request).
 *                          Defaults to a placeholder; any valid address works
 *                          for price-quoting purposes.
 */

import type { SwapParams, SwapQuote, SwapTxRequest } from "@agent-aqi/shared";

/** Extends SwapQuote with raw routing data for policy scoring. */
export interface SwapQuoteWithMeta extends SwapQuote {
  /** Number of pools traversed in the selected route */
  hopCount: number;
}

// ─── API endpoints ────────────────────────────────────────────────────────────

const BASE_URL   = "https://trade-api.gateway.uniswap.org/v1" as const;
const QUOTE_URL  = `${BASE_URL}/quote`  as const;
const SWAP_URL   = `${BASE_URL}/swap`   as const;

/**
 * Default slippage tolerance (0.5 %) used when no per-agent policy is provided.
 * The API requires either slippageTolerance or autoSlippage.
 * We use an explicit value because autoSlippage is not supported for UniswapX.
 */
const DEFAULT_SLIPPAGE_PCT = 0.5;

// ─── Shared helpers ───────────────────────────────────────────────────────────

function requireApiKey(): string {
  const key = process.env["UNISWAP_API_KEY"];
  if (!key) throw new Error("UNISWAP_API_KEY not set");
  return key;
}

/** Minimal Ethereum address check reused for response validation */
function isEthAddress(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

// ─── Phase 2.1: price quote ───────────────────────────────────────────────────

/**
 * Fetch a price quote from the Uniswap Trading API.
 *
 * @param params             - Token pair, amount, and chain.
 * @param slippageTolerancePct - Agent-specific slippage tolerance in percent
 *                              (e.g. 0.5 for 0.5 %). Defaults to DEFAULT_SLIPPAGE_PCT.
 *
 * @throws "UNISWAP_API_KEY not set" — set the env var and retry.
 * @throws Error with HTTP status + body on non-2xx responses.
 */
export async function getSwapQuote(
  params: SwapParams,
  slippageTolerancePct?: number,
): Promise<SwapQuoteWithMeta> {
  const apiKey  = requireApiKey();
  const swapper =
    process.env["SWAP_SENDER_ADDRESS"] ??
    "0x0000000000000000000000000000000000000001";

  const slippage = slippageTolerancePct ?? DEFAULT_SLIPPAGE_PCT;

  const requestBody = {
    tokenIn:          params.inputToken,
    tokenOut:         params.outputToken,
    tokenInChainId:   params.chainId,
    tokenOutChainId:  params.chainId,
    amount:           params.amountIn,
    type:             "EXACT_INPUT",
    swapper,
    slippageTolerance: slippage,
  };

  const startMs = Date.now();
  const response = await fetch(QUOTE_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body:    JSON.stringify(requestBody),
  });
  const latencyMs = Date.now() - startMs;

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Uniswap /quote responded ${response.status} after ${latencyMs}ms: ${text}`,
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  return parseQuoteResponse(raw, params);
}

// ─── Phase 2.2: unsigned transaction request ──────────────────────────────────

/**
 * Build an unsigned swap transaction by calling the Uniswap /v1/swap endpoint.
 *
 * Reuses `rawQuoteResponse` (from SwapQuote.rawQuote) to avoid a second
 * /quote round-trip.
 *
 * ⚠️  SIGNATURE NOTE
 * The Uniswap /swap endpoint requires an EIP-712 signature over
 * `permitData` (Permit2 authorisation) when `permitData` is present in the
 * quote response.  In Phase 2.2 we pass `"0x"` as a placeholder so the API
 * encodes the calldata structure without verifying execution.
 * Before broadcasting (Phase 2.3), replace the signature with a real one:
 *   import { privateKeyToAccount } from "viem/accounts";
 *   const sig = await account.signTypedData(permitData);
 *
 * @param params          - Original swap parameters (for error context).
 * @param rawQuoteResponse - The full raw object from a previous /quote call
 *                           (i.e. SwapQuote.rawQuote).
 *
 * @throws "UNISWAP_API_KEY not set"
 * @throws Error on non-2xx API response.
 * @throws Error if the response is missing the expected `swap` field.
 * @throws Error if `to` or `data` in the response fail basic validation.
 */
export async function buildSwapTx(
  params: SwapParams,
  rawQuoteResponse: Record<string, unknown>,
): Promise<SwapTxRequest> {
  const apiKey = requireApiKey();

  // Build the /swap request body.
  // The `quote` field is the complete /quote response object.
  // `permitData` is extracted separately (may be absent for some routes).
  // `signature` is a placeholder — a real EIP-712 sig is required to broadcast.
  // `simulateTransaction: false` tells the API to encode calldata without
  // simulating on-chain execution, so an invalid sig does not cause a 422.
  const requestBody: Record<string, unknown> = {
    quote:               rawQuoteResponse,
    signature:           "0x",
    simulateTransaction: false,
  };

  // Include permitData only when the quote response contains it.
  const permitData = rawQuoteResponse["permitData"];
  if (permitData != null) {
    requestBody["permitData"] = permitData;
  }

  const startMs = Date.now();
  const response = await fetch(SWAP_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body:    JSON.stringify(requestBody),
  });
  const latencyMs = Date.now() - startMs;

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Uniswap /swap responded ${response.status} after ${latencyMs}ms: ${text}`,
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  return parseSwapTxResponse(raw, params);
}

// ─── Response parsers ─────────────────────────────────────────────────────────

/**
 * Parse the /quote response into a SwapQuote.
 *
 * Relevant response shape:
 *   {
 *     requestId: string,
 *     routing: "CLASSIC" | "DUTCH_LIMIT" | …,
 *     classicQuote?: {
 *       output: { token: string, amount: string },
 *       route:  Array<Array<{ …pool fields… }>>,
 *     },
 *     permitData?: { … }   ← forwarded to /swap as-is
 *   }
 *
 * Source: https://api-docs.uniswap.org/api-reference/swapping/quote
 */
function parseQuoteResponse(
  raw: Record<string, unknown>,
  params: SwapParams,
): SwapQuoteWithMeta {
  const classicQuote =
    raw["classicQuote"] as Record<string, unknown> | undefined;

  const output =
    classicQuote?.["output"] as Record<string, unknown> | undefined;
  const quotedOut = (output?.["amount"] as string | undefined) ?? "0";

  const routing = (raw["routing"] as string | undefined) ?? "UNKNOWN";

  // Count pools traversed — each inner array element = one pool hop
  const route = classicQuote?.["route"] as unknown[][] | undefined;
  const hopCount = route && route.length > 0 ? route.flat().length : 0;

  const routeSummary = buildRouteSummary(routing, params, hopCount);

  return { quotedOut, routeSummary, rawQuote: raw, hopCount };
}

function buildRouteSummary(
  routing: string,
  params: SwapParams,
  hopCount: number,
): string {
  const inShort  = params.inputToken.slice(0, 10) + "…";
  const outShort = params.outputToken.slice(0, 10) + "…";
  const base     = `[${routing}] ${inShort} → ${outShort}`;

  if (hopCount > 0) {
    return `${base} via ${hopCount} pool${hopCount !== 1 ? "s" : ""}`;
  }
  return base;
}

/**
 * Parse the /swap response into a SwapTxRequest.
 *
 * Expected response shape (from Uniswap docs end-to-end example):
 *   {
 *     swap: {
 *       to:                   "0x66a9893cc…",  ← Uniswap Universal Router
 *       from:                 "0xC9bebBA…",
 *       data:                 "0x3593564c…",   ← ABI-encoded calldata
 *       value:                "0x00",          ← hex; we convert to decimal
 *       maxFeePerGas:         "4794697230",
 *       maxPriorityFeePerGas: "2000000000",
 *       gasLimit:             "179302",
 *       chainId:              1,
 *     },
 *     gasFee: "859698802733460",
 *   }
 *
 * Source: https://api-docs.uniswap.org/guides/swapping_end_to_end
 */
function parseSwapTxResponse(
  raw: Record<string, unknown>,
  params: SwapParams,
): SwapTxRequest {
  const swapObj = raw["swap"] as Record<string, unknown> | undefined;
  if (!swapObj) {
    throw new Error(
      "Uniswap /swap response is missing the 'swap' field — " +
      `full response: ${JSON.stringify(raw).slice(0, 300)}`,
    );
  }

  const to       = swapObj["to"]       as string | undefined;
  const data     = swapObj["data"]     as string | undefined;
  const valueRaw = swapObj["value"]    as string | undefined;
  const gasLimit = swapObj["gasLimit"] as string | undefined;
  const chainId  = swapObj["chainId"]  as number | undefined;

  // ── Validate required fields ───────────────────────────────────────────────

  if (!isEthAddress(to)) {
    throw new Error(
      `Uniswap /swap 'to' is not a valid Ethereum address: "${String(to)}"`,
    );
  }
  if (typeof data !== "string" || !data.startsWith("0x")) {
    throw new Error(
      `Uniswap /swap 'data' must be a 0x-prefixed hex string, got: "${String(data).slice(0, 40)}"`,
    );
  }
  if (!valueRaw) {
    throw new Error("Uniswap /swap response missing 'value' field");
  }

  // ── Normalise value: hex string → decimal integer string ──────────────────
  // The API returns e.g. "0x00" or "0x16345785d8a0000"; we store as "0" or
  // "100000000000000000" so it's usable without a BigInt polyfill downstream.
  let value: string;
  try {
    value = BigInt(valueRaw).toString();
  } catch {
    throw new Error(
      `Uniswap /swap 'value' is not a valid hex integer: "${valueRaw}"`,
    );
  }

  return {
    to,
    data,
    value,
    chainId: typeof chainId === "number" ? chainId : params.chainId,
    ...(gasLimit !== undefined && { gas: gasLimit }),
  };
}

// ─── Phase 2.3 stub: sign + broadcast ────────────────────────────────────────
// TODO(phase2-real): to broadcast a SwapTxRequest on Base:
//   1. Import viem: `import { privateKeyToAccount } from "viem/accounts"`
//   2. Sign permitData:
//        const account = privateKeyToAccount(process.env.SWAP_PRIVATE_KEY)
//        const sig = await account.signTypedData(rawQuote.permitData)
//   3. Re-call buildSwapTx with the real sig (replace "0x" placeholder above)
//   4. Submit: `await walletClient.sendRawTransaction({ serializedTransaction: ... })`
//   5. Store txHash in receipt.onChain
