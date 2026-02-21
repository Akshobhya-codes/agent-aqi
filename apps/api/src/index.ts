/**
 * Agent AQI — API server
 * Port: 4000
 *
 * Feature flags (set in apps/api/.env or via shell exports):
 *   EXECUTION_MODE=sim|quote|real  (default: sim)
 *
 *   sim   – fully simulated, no external keys required
 *   quote – real Uniswap price quote + unsigned tx payload; no broadcast
 *   real  – sign + broadcast on Base via viem (Phase 2.3)
 *
 *   UNISWAP_API_KEY                  required for quote/real mode
 *   SWAP_SENDER_ADDRESS              wallet address for gas estimation (quote mode)
 *   BASE_RPC_URL                     HTTP RPC endpoint (real mode)
 *   AGENT_PRIVATE_KEY                0x-prefixed private key for signing (real mode)
 *   QUICKNODE_STREAMS_WEBHOOK_SECRET required for POST /webhooks/quicknode
 *   QUICKNODE_STREAM_ID              optional — validates incoming streamId
 *   QUICKNODE_NETWORK                informational (e.g. "base-sepolia")
 */

// Load .env from apps/api/.env (ignored when vars are already set via shell)
import "dotenv/config";

import express from "express";
import cors from "cors";
import type { Request, Response } from "express";

import jobsRouter          from "./routes/jobs";
import agentsRouter        from "./routes/agents";
import webhooksRouter      from "./routes/webhooks";
import streamsRouter       from "./routes/streams";
import arenaRouter         from "./routes/arena";
import skyboxRouter        from "./routes/skybox";
import predictionRouter    from "./routes/prediction";
import authRouter          from "./routes/auth";
import meRouter            from "./routes/me";
import participationRouter from "./routes/participation";
import quoteRouter         from "./routes/quote";
import paperbetsRouter     from "./routes/paperbets";
import {
  addSSEClient,
  removeSSEClient,
  events,
} from "./store";

const PORT       = process.env["PORT"] ?? 4000;
const APP_ORIGIN = process.env["APP_ORIGIN"] ?? "http://localhost:3000";
const app        = express();

app.use(cors({ origin: [APP_ORIGIN, "http://localhost:3000"], credentials: true }));

// ─── Webhook route — must be mounted BEFORE express.json() ───────────────────
// The webhook handler applies express.raw() internally to preserve the raw
// body bytes needed for HMAC-SHA256 signature verification.  If express.json()
// runs first it consumes the body stream and express.raw() gets nothing.
app.use("/webhooks", webhooksRouter);

// JSON body parser for all other routes
app.use(express.json());

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  const mode = process.env["EXECUTION_MODE"] ?? "sim";
  res.json({
    status: "ok",
    executionMode: mode,
    ...(mode !== "sim" && {
      uniswapApiKeySet: Boolean(process.env["UNISWAP_API_KEY"]),
    }),
    ...(mode === "real" && {
      baseRpcUrlSet:      Boolean(process.env["BASE_RPC_URL"]),
      agentPrivateKeySet: Boolean(process.env["AGENT_PRIVATE_KEY"]),
    }),
    quicknodeStreamsConfigured: Boolean(process.env["QUICKNODE_STREAMS_WEBHOOK_SECRET"]),
    blockadeLabsKeySet:         Boolean(process.env["BLOCKADE_LABS_API_KEY"]),
    x402Enabled:                process.env["X402_ENABLED"] === "true",
    predictionEnabled:          process.env["PREDICTION_ENABLED"] === "true",
    predictionContract:         process.env["PREDICTION_CONTRACT_ADDRESS"] ?? null,
    ts: Date.now(),
  });
});

// ─── SSE event stream ─────────────────────────────────────────────────────────

app.get("/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // Replay last 20 events so the client catches up
  const replay = events.slice(-20);
  for (const ev of replay) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }

  // Send a heartbeat every 15 s to keep the connection alive
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15_000);

  addSSEClient(res);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeSSEClient(res);
  });
});

// ─── REST routes ──────────────────────────────────────────────────────────────

app.use("/jobs",          jobsRouter);
app.use("/agents",        agentsRouter);
app.use("/streams",       streamsRouter);
app.use("/arena",         arenaRouter);
app.use("/skybox",        skyboxRouter);
app.use("/prediction",    predictionRouter);
app.use("/auth",          authRouter);
app.use("/me",            meRouter);
app.use("/participation", participationRouter);
app.use("/quote",         quoteRouter);
app.use("/paperbets",    paperbetsRouter);

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const mode    = process.env["EXECUTION_MODE"] ?? "sim";
  const qnSet   = Boolean(process.env["QUICKNODE_STREAMS_WEBHOOK_SECRET"]);
  const blSet   = Boolean(process.env["BLOCKADE_LABS_API_KEY"]);
  const x402    = process.env["X402_ENABLED"]    === "true";
  const predict = process.env["PREDICTION_ENABLED"] === "true";
  const jwtSet  = Boolean(process.env["JWT_SECRET"]);
  console.log(`
╔══════════════════════════════════════════╗
║   Agent AQI  —  API server               ║
║   http://localhost:${PORT}                   ║
║   Mode:       ${mode.padEnd(5)}                     ║
║   Streams:    ${qnSet    ? "configured " : "not set    "}                 ║
║   Skybox:     ${blSet    ? "configured " : "not set    "}                 ║
║   x402:       ${x402     ? "enabled    " : "disabled   "}                 ║
║   Prediction: ${predict  ? "enabled    " : "disabled   "}                 ║
║   Auth (JWT): ${jwtSet   ? "configured " : "⚠ not set  "}                 ║
╚══════════════════════════════════════════╝
  `.trim());
});
