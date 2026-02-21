# Agent AQI — Agent Quality Index

> **ETHDenver 2026** · Rank autonomous agents by reliability, safety, economics & user feedback.

## Quick start (Phase 1 — fully simulated, no keys required)

```bash
# 1. Install all workspace dependencies
npm install

# 2. Run API + Web in one terminal
npm run dev
```

- API: http://localhost:4000
- Web: http://localhost:3000

Or run separately:

```bash
npm run dev:api   # port 4000  (builds shared first automatically)
npm run dev:web   # port 3000
```

---

## Phase 2.1 + 2.2 — Quote mode (real price + unsigned tx payload)

Quote mode calls the **Uniswap Trading API** twice per swap job:

1. `POST /v1/quote` — fetches a real on-chain price and routing path.
2. `POST /v1/swap`  — builds an unsigned transaction payload (calldata, `to`,
   `value`, `gas`).  **No transaction is broadcast.**

The unsigned tx is stored on the receipt as `swapTxRequest` — it is ready to
sign with a private key and submit to Base Sepolia (Phase 2.3).

### 1. Get a Uniswap API key

Request access via https://hub.uniswap.org (Uniswap Trading API).
A key is required for both `/v1/quote` and `/v1/swap`.

### 2. Create `apps/api/.env`

```env
# Required for quote mode
EXECUTION_MODE=quote
UNISWAP_API_KEY=your_key_here

# Optional — wallet address sent to the Uniswap API for gas estimation.
# Any valid Ethereum address works in quote-only mode.
# Use a real sender address for more accurate gas figures.
SWAP_SENDER_ADDRESS=0x0000000000000000000000000000000000000001
```

> `ts-node-dev` doesn't auto-load `.env`.  Either `export` the vars in your
> shell or prefix the start command: `UNISWAP_API_KEY=... npm run dev:api`.

### 3. Start the server

```bash
npm run dev:api
```

Confirm the mode:

```bash
curl http://localhost:4000/health
# { "status":"ok", "executionMode":"quote", "uniswapApiKeySet":true, … }
```

### 4. Submit a swap job

`inputToken`, `outputToken`, and `amountIn` are **required** for `jobType: "swap"`
in quote mode; they are ignored in `sim` mode.

```bash
curl -X POST http://localhost:4000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "jobType":     "swap",
    "objective":   "safest",
    "inputToken":  "0x4200000000000000000000000000000000000006",
    "outputToken": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amountIn":    "1000000000000000000",
    "chainId":     84532
  }'
```

> Example: 1 WETH → USDC on **Base Sepolia** (chainId 84532).
> Use `chainId: 8453` for Base mainnet tokens.

### 5. Inspect the receipt

```bash
curl http://localhost:4000/agents/safe
```

The receipt now contains three new fields:

```jsonc
{
  "swapParams": {
    "inputToken":  "0x4200000000000000000000000000000000000006",
    "outputToken": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amountIn":    "1000000000000000000",
    "chainId":     84532
  },
  "quoteResult": {
    "quotedOut":    "1823456789",              // output amount, smallest unit
    "routeSummary": "[CLASSIC] 0x4200… → 0x8335… via 2 pools",
    "rawQuote":     { "requestId": "…", … }   // full Uniswap /quote response
  },
  "swapTxRequest": {
    "to":      "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",  // Universal Router
    "data":    "0x3593564c…",   // ABI-encoded calldata (⚠ has placeholder sig)
    "value":   "0",             // native ETH to attach, decimal integer string
    "chainId": 84532,
    "gas":     "179302"         // gasLimit from Uniswap API
  },
  "outcome": { "slippageBps": 50, … }   // real tolerance (0.5%), not simulated
}
```

> ⚠️  **Signature placeholder** — `data` encodes `"0x"` as the Permit2 EIP-712
> signature.  This is intentional: the tx cannot be broadcast without a real
> signature.  Phase 2.3 will add `SWAP_PRIVATE_KEY` support and viem signing.

### 6. SSE events in quote mode

The live event feed now surfaces `txTo` and `txGas` on `fulfilled` events:

```
FULFILLED  agent=safe  latency=320ms  gas=$0.52  txTo=0x66a9…  txGas=179302
```

### Error scenarios

| Event `phase` | Meaning | Fix |
|--------------|---------|-----|
| `uniswap_quote` | `/v1/quote` returned non-2xx | Check `UNISWAP_API_KEY`, token addresses, chainId |
| `uniswap_tx_build` | `/v1/swap` returned non-2xx or bad payload | Inspect `error` in the event payload; may need real signature |

---

## Project structure

```
ethdenver-agent-aqi/
├── packages/
│   └── shared/                       # Shared types + AQI scoring (no runtime deps)
│       └── src/
│           ├── types.ts              # Receipt, SwapParams, SwapQuote, SwapTxRequest, …
│           ├── scoring.ts            # computeAQI(receipts) → 0-100
│           └── index.ts
├── apps/
│   ├── api/                          # Express server (port 4000)
│   │   └── src/
│   │       ├── agents.ts             # 3 agent policies: safe / fast / cheap
│   │       ├── store.ts              # In-memory receipts + SSE broadcast
│   │       ├── integrations/
│   │       │   └── uniswap.ts        # getSwapQuote() + buildSwapTx()  ← Phase 2.1 + 2.2
│   │       ├── routes/
│   │       │   ├── jobs.ts           # POST /jobs  (sim + quote mode)
│   │       │   └── agents.ts         # GET /agents, GET /agents/:id
│   │       └── index.ts              # Express app + GET /events (SSE)
│   └── web/                          # Next.js 14 dashboard (port 3000)
│       └── src/app/
│           ├── page.tsx              # / — Run Job form + live event feed
│           ├── agents/
│           │   ├── page.tsx          # /agents — leaderboard
│           │   └── [id]/page.tsx     # /agents/:id — receipt history
│           └── components/
│               ├── Nav.tsx, JobForm.tsx, EventFeed.tsx, ScoreBar.tsx
└── package.json                      # npm workspaces root
```

---

## API reference

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| GET  | `/health`      | —                       | Server status + mode + key presence |
| GET  | `/events`      | —                       | SSE stream of job lifecycle events |
| POST | `/jobs`        | see below               | Submit a job → `{ jobId, agentId, mode }` |
| GET  | `/agents`      | —                       | Leaderboard sorted by AQI descending |
| GET  | `/agents/:id`  | `id = safe\|fast\|cheap` | Agent detail + last 50 receipts |

### POST /jobs — request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobType` | `"swap" \| "paid_call"` | yes | Type of job |
| `objective` | `"safest" \| "fastest" \| "cheapest"` | yes | Routes to matching agent |
| `inputToken` | `string` (0x address) | quote mode swap | Token to sell |
| `outputToken` | `string` (0x address) | quote mode swap | Token to buy |
| `amountIn` | `string` (integer) | quote mode swap | Amount in smallest unit (e.g. wei) |
| `chainId` | `number` | no | Defaults to 84532 (Base Sepolia) |

Returns `202 Accepted` immediately; job events are streamed via SSE.

### Execution modes

| `EXECUTION_MODE` | Uniswap API | Tx submitted | Notes |
|-----------------|-------------|-------------|-------|
| `sim` (default) | no | no | Fully randomised, no keys needed |
| `quote` | **yes** | no | Real price quote + unsigned tx payload; agent simulated |
| `real` | yes | yes | Not yet implemented (Phase 2.3) |

---

## AQI scoring

`computeAQI(receipts)` in [packages/shared/src/scoring.ts](packages/shared/src/scoring.ts):

| Component | Weight | What it measures |
|-----------|--------|-----------------|
| Reliability | 30% | Fraction of fulfilled jobs |
| Safety | 25% | Slippage vs constraint + safety flag penalties |
| Speed | 20% | Latency as fraction of deadline |
| Economics | 15% | Gas used vs budget |
| Feedback | 10% | User ratings (1-5 → 20-100) |

---

## Agent profiles (simulation distributions)

| Agent | Success rate | Latency | Gas | Slippage | Flag prob |
|-------|-------------|---------|-----|----------|-----------|
| **SafeGuard** (`safe`) | 96% | 800–2400 ms | $0.40–0.80 | 5–30 bps | 5% |
| **SpeedRunner** (`fast`) | 78% | 120–600 ms | $0.55–1.10 | 20–120 bps | 30% |
| **GasOptimizer** (`cheap`) | 85% | 1200–4000 ms | $0.12–0.38 | 8–60 bps | 15% |

In quote mode, `slippageBps` is pinned to 50 (0.5% tolerance sent to Uniswap).

---

## Phase 2.3 — Sign + broadcast on Base Sepolia

`EXECUTION_MODE=real` signs the Uniswap swap tx with your wallet and broadcasts
it on Base Sepolia (or Base mainnet), then waits for the receipt.

### 1. Create `apps/api/.env`

The file is pre-populated with defaults — just fill in the secrets:

```env
EXECUTION_MODE=real

# Uniswap Trading API key (https://hub.uniswap.org)
UNISWAP_API_KEY=your_key_here

# RPC endpoint — free public endpoints work for testing:
#   Base Sepolia: https://sepolia.base.org
#   Base mainnet: https://mainnet.base.org
BASE_RPC_URL=https://sepolia.base.org

# 0x-prefixed private key of a wallet that holds ETH on the target chain.
# Use a dedicated test wallet — NEVER a funded production key.
AGENT_PRIVATE_KEY=0x...

# Optional: same wallet address (improves Uniswap gas estimates)
SWAP_SENDER_ADDRESS=0xYourWalletAddress
```

> **Safe fallback**: set `EXECUTION_MODE=quote` to get real price quotes +
> unsigned tx payloads without broadcasting anything. No `BASE_RPC_URL` or
> `AGENT_PRIVATE_KEY` required in quote mode.

### 2. Start the server

```bash
npm run dev:api
```

Confirm all keys are loaded:

```bash
curl http://localhost:4000/health
# {
#   "status": "ok",
#   "executionMode": "real",
#   "uniswapApiKeySet": true,
#   "baseRpcUrlSet": true,
#   "agentPrivateKeySet": true
# }
```

### 3. Submit a swap job

Same request body as quote mode — the server now broadcasts:

```bash
curl -X POST http://localhost:4000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "jobType":     "swap",
    "objective":   "safest",
    "inputToken":  "0x4200000000000000000000000000000000000006",
    "outputToken": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amountIn":    "1000000000000000000",
    "chainId":     84532
  }'
```

### 4. SSE events in real mode

Two new event types appear in the live feed:

```
TX_SUBMITTED  agent=safe  txHash=0x1234…  explorerUrl=https://sepolia.basescan.org/tx/0x1234…
TX_CONFIRMED  agent=safe  status=success   gasUsed=179302  blockNumber=18934521
```

The receipt stored at `GET /agents/safe` will include `onChain: { txHash, blockNumber, chainId, gasUsed, status }`.

### Error phases in real mode

| Event `phase`       | Meaning                                      | Fix |
|---------------------|----------------------------------------------|-----|
| `uniswap_quote`     | `/v1/quote` failed                           | Check `UNISWAP_API_KEY`, tokens, chainId |
| `uniswap_tx_build`  | `/v1/swap` failed                            | Inspect `error` in event payload |
| `base_send_tx`      | `sendTransaction` rejected by RPC            | Check `AGENT_PRIVATE_KEY`, ETH balance, `BASE_RPC_URL` |
| `base_confirm_tx`   | `waitForTransactionReceipt` timed out/failed | Check RPC connectivity |

---

## Phase 2 roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 2.1 | Uniswap price quotes (`/v1/quote`) | **done** |
| 2.2 | Unsigned tx payload (`/v1/swap`, no broadcast) | **done** |
| 2.3 | Sign + broadcast via viem on Base | **done** |
| 2.4 | QuickNode Streams async tx status | `QUICKNODE_STREAMS_WEBHOOK_SECRET` |
| 2.5 | x402 paid `/jobs` endpoint | `X402_ENABLED=true` |

---

## Tech stack

- TypeScript everywhere (strict mode)
- Express 4 + SSE (no WebSocket dependency)
- Next.js 14 App Router
- npm workspaces monorepo
- viem — EVM wallet client (signing + broadcasting)
- dotenv — loads `apps/api/.env` automatically
- Node 18+ (native `fetch` used in Uniswap integration)
- Zero blockchain keys required in `sim` mode
