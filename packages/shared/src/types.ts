// ─── Core domain types ────────────────────────────────────────────────────────

export type JobType = "swap" | "paid_call";
export type Objective = "safest" | "fastest" | "cheapest";
export type AgentId = "safe" | "fast" | "cheap";
export type JobStatus = "fulfilled" | "failed";

/**
 * Controls how the server executes jobs.
 *   sim   – fully simulated, no external keys needed (default)
 *   quote – calls Uniswap API for a real price quote; no tx submitted
 *   real  – builds + submits tx on-chain (Phase 2, not yet implemented)
 */
export type ExecutionMode = "sim" | "quote" | "real";

// ─── Swap-specific input ──────────────────────────────────────────────────────

/** Base Sepolia testnet – default chain for Phase 2 testing */
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/**
 * Parameters for a token-swap job.
 * Required when jobType === "swap" and EXECUTION_MODE !== "sim".
 */
export interface SwapParams {
  /** ERC-20 token address to sell */
  inputToken: string;
  /** ERC-20 token address to buy */
  outputToken: string;
  /** Amount to sell, in the token's smallest unit (e.g. wei for ETH-like tokens) */
  amountIn: string;
  /** Chain ID – defaults to BASE_SEPOLIA_CHAIN_ID (84532) if omitted */
  chainId: number;
}

/**
 * A price quote returned by the Uniswap Trading API (quote mode only).
 * No transaction has been submitted at this point.
 */
export interface SwapQuote {
  /** Output amount in the output token's smallest unit (from classicQuote.output.amount) */
  quotedOut: string;
  /** Human-readable description of the routing path taken */
  routeSummary: string;
  /** Full raw API response — kept for debugging / future use */
  rawQuote: Record<string, unknown>;
}

/**
 * An unsigned transaction request produced by the Uniswap /v1/swap endpoint.
 *
 * Phase 2.2: built and stored on the receipt, but NOT broadcast.
 * Phase 2.3: sign with wallet private key and submit via viem on Base.
 *
 * IMPORTANT: the `data` field encodes a Permit2 EIP-712 signature placeholder.
 * Before broadcasting, replace the signature bytes with a real EIP-712 sig
 * over `quoteResult.rawQuote.permitData` using the swapper's private key.
 */
export interface SwapTxRequest {
  /** Target contract — Uniswap Universal Router address */
  to: string;
  /** ABI-encoded calldata for the swap (0x-prefixed hex) */
  data: string;
  /** Native token value to send with the tx, as a decimal integer string (usually "0") */
  value: string;
  /** Chain ID this transaction is scoped to */
  chainId: number;
  /** Gas limit recommended by the Uniswap API */
  gas?: string;
}

// ─── Constraints + Metrics ────────────────────────────────────────────────────

/** Constraints provided by the caller when submitting a job */
export interface JobConstraints {
  jobType: JobType;
  objective: Objective;
  maxSlippageBps: number; // basis points, e.g. 50 = 0.5 %
  maxGasUsd: number;
  deadlineMs: number; // max execution time in ms
}

/** Outcome metrics captured after execution */
export interface OutcomeMetrics {
  status: JobStatus;
  latencyMs: number;
  gasUsedUsd: number;
  slippageBps: number;
  safetyFlags: string[]; // e.g. ["high_slippage", "unaudited_contract"]
}

/** Optional on-chain evidence (Phase 2.3 – real mode) */
export interface OnChainEvidence {
  txHash: string;
  blockNumber: number;
  chainId: number; // 8453 = Base mainnet, 84532 = Base Sepolia
  /** Gas actually consumed by the transaction (from viem receipt.gasUsed) */
  gasUsed: string;
  /** Transaction execution result from the EVM */
  status: "success" | "reverted";
  /** Set to "quicknode" once a matching QuickNode Streams webhook confirms this tx */
  verifiedBy?: "quicknode";
  /** Unix ms timestamp when the stream confirmation was applied */
  confirmedAt?: number;
}

/** What a user submitted after a job completes */
export interface UserFeedback {
  rating: 1 | 2 | 3 | 4 | 5;
  comment?: string;
}

/**
 * The execution policy an agent applies when requesting a Uniswap quote.
 * Each agent has a fixed policy that drives distinct real-world behavior.
 */
export interface AgentPolicy {
  /** Maximum slippage the agent accepts, in basis points (e.g. 50 = 0.5 %) */
  slippageBps: number;
  /** Maximum number of hops the agent prefers (undefined = no limit) */
  maxHops?: number;
  /** Human-readable routing preference label */
  preference: "safest" | "fastest" | "cheapest";
}

/**
 * Economic metrics extracted from the Uniswap quote/swap response.
 * Complements OutcomeMetrics with raw Uniswap data points.
 */
export interface AgentEconomics {
  /** Output amount as returned by Uniswap (smallest token unit) */
  quotedOut?: string;
  /** Gas limit string from the /swap response */
  gasEstimate?: string;
  /** Number of pools traversed in the route */
  hopCount?: number;
}

/**
 * A Receipt records everything about a single job execution.
 * It is the atomic unit that feeds into AQI scoring.
 */
export interface Receipt {
  jobId: string;
  agentId: AgentId;
  submittedAt: number; // unix ms
  completedAt: number; // unix ms
  constraints: JobConstraints;
  outcome: OutcomeMetrics;
  /** Set when jobType === "swap" and swap params were provided */
  swapParams?: SwapParams;
  /** Set when EXECUTION_MODE === "quote" — Uniswap price quote (no tx) */
  quoteResult?: SwapQuote;
  /**
   * Set when EXECUTION_MODE === "quote" — unsigned tx payload from Uniswap.
   * Ready to sign and broadcast; Phase 2.2 stores it, Phase 2.3 sends it.
   */
  swapTxRequest?: SwapTxRequest;
  /** Present only in real-execution mode (Phase 2.3+) */
  onChain?: OnChainEvidence;
  /** Added asynchronously by the user */
  userFeedback?: UserFeedback;
  /** Set when this job was triggered as part of an Arena battle */
  battleId?: string;
  /** The routing policy the agent applied when requesting the Uniswap quote */
  policy?: AgentPolicy;
  /** Economic data extracted from the Uniswap quote/swap response */
  economics?: AgentEconomics;
}

// ─── AQI scoring ──────────────────────────────────────────────────────────────

export interface AQIComponents {
  reliability: number; // 0-100  (success rate)
  safety: number;      // 0-100  (slippage + flag penalties)
  speed: number;       // 0-100  (latency vs deadline)
  economics: number;   // 0-100  (gas efficiency)
  feedback: number;    // 0-100  (user ratings → 20*rating)
}

export interface AQIResult {
  score: number;       // 0-100 weighted composite
  components: AQIComponents;
  sampleSize: number;
}

// ─── API shapes used by both frontend and backend ─────────────────────────────

export interface AgentSummary {
  agentId: AgentId;
  displayName: string;
  description: string;
  aqi: AQIResult;
  totalJobs: number;
  successRate: number;
}

export interface SSEEvent {
  id: string;
  ts: number;
  type:
    | "queued"
    | "running"
    | "fulfilled"
    | "failed"
    | "tx_submitted"
    | "tx_confirmed"
    | "stream_event"
    | "battle_complete"
    | "prediction_update"
    | "prediction_resolved"
    | "paperbet_placed"
    | "paperbet_resolved"
    | "battle_open"
    | "participation_update";
  payload: Record<string, unknown>;
}

// ─── Paper Betting (no wallet required) ───────────────────────────────────────

export interface PaperBet {
  id:        string;
  battleId:  string;
  nickname:  string;
  agentId:   AgentId;
  amountEth: number;
  placedAt:  number;
}

export interface PaperBetResult {
  betId:     string;
  battleId:  string;
  nickname:  string;
  agentId:   AgentId;
  amountEth: number;
  /** Profit/loss in fake ETH (negative = loss) */
  pnlEth:    number;
  /** Return on investment as a percentage */
  roiPct:    number;
  won:       boolean;
}

export interface PaperLeaderboardEntry {
  nickname:    string;
  totalPnl:    number;
  totalBets:   number;
  winRate:     number;
  avgBet:      number;
  biggestWin:  number;
  biggestLoss: number;
  /** Positive = win streak, negative = loss streak */
  streak:      number;
}

// ─── QuickNode Streams ────────────────────────────────────────────────────────

/**
 * A normalised swap event received from a QuickNode Streams webhook.
 * One webhook call may carry multiple StreamEvents (one per log / swap).
 */
export interface StreamEvent {
  /** Unique id: `${txHash}${logIndex}` */
  id: string;
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  /** EVM execution status: "success" or "reverted" */
  status: string;
  from: string;
  to: string;
  /** Address of the contract that emitted the event (log.address) */
  contract: string;
  /** First topic (event signature hash) */
  topic: string;
  /** Unix seconds timestamp of the block */
  timestamp: number;
  /** jobId of the receipt whose onChain.txHash matched this event, if any */
  matchedJobId?: string;
  /** Origin: "quicknode" = verified real webhook, "dev" = injected via /streams/dev/emit */
  source?: "quicknode" | "dev";
}

// ─── Arena Battle ─────────────────────────────────────────────────────────────

export type BattleType   = "speed" | "gas" | "reliability" | "slippage";
/** lobby = bets open, jobs not yet running; running = jobs executing; complete = done */
export type BattleStatus = "lobby" | "running" | "complete";

/** Per-agent metrics captured once the agent's job finishes. */
export interface BattleScorecard {
  agentId:          AgentId;
  jobId?:           string;
  status:           "pending" | "running" | "fulfilled" | "failed";
  latencyMs?:       number;
  gasUsedUsd?:      number;
  slippageBps?:     number;
  quotedOut?:       string;
  /** True once a QuickNode Streams event has confirmed this agent's battle tx */
  verifiedByStream?: boolean;
}

export interface BattleRecord {
  battleId:        string;
  createdAt:       number;
  battleType:      BattleType;
  agentIds:        AgentId[];
  scorecards:      BattleScorecard[];
  status:          BattleStatus;
  winnerAgentId?:  AgentId;
  /** Tx hash of the on-chain resolveBattle() call (set when PREDICTION_ENABLED) */
  resolveTxHash?:  string;
}
