/**
 * Agent Skybox — Blockade Labs AI 360° environment generation
 *
 * Generates a unique equirectangular 360° skybox image for each agent
 * using the Blockade Labs API.  Results are cached in memory for the
 * server lifetime.
 *
 * Required env var:
 *   BLOCKADE_LABS_API_KEY   – from https://skybox.blockadelabs.com/
 *
 * Optional env vars:
 *   BLOCKADE_LABS_STYLE_ID  – integer style ID.  If the value is not a
 *                             valid integer it is silently ignored (no
 *                             style_id is sent, letting Blockade Labs
 *                             choose the default).
 *
 * Routes:
 *   GET  /skybox          – list status of all three agent skyboxes
 *   GET  /skybox/:agentId – status + URL for one agent's skybox
 *   POST /skybox/:agentId – trigger generation (idempotent if already running/done)
 *   GET  /skybox/styles   – proxy Blockade Labs style list (discovery helper)
 */

import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

// ─── Agent prompts ────────────────────────────────────────────────────────────

// Prompts must be plain scene descriptions — do NOT add "360°", "equirectangular",
// or other format terms; the Blockade Labs model handles projection natively.
const AGENT_PROMPTS: Record<string, string> = {
  safe:  "Protective sci-fi fortress interior, glowing blue energy shields, golden ambient light, floating defensive crystals, serene sanctuary, cinematic",
  fast:  "Neon cyberpunk highway at night, electric speed light trails, purple and gold storm sky, lightning, high velocity energy, cinematic",
  cheap: "Futuristic eco greenhouse interior, lush green garden, solar technology panels, warm sunlight through glass, clean sustainable architecture, cinematic",
};

// ─── In-memory cache ──────────────────────────────────────────────────────────

export type SkyboxStatus = "idle" | "pending" | "complete" | "error";

export interface SkyboxEntry {
  agentId:        string;
  status:         SkyboxStatus;
  blockadeId?:    number;
  url?:           string;
  thumbUrl?:      string;
  prompt:         string;
  error?:         string;
  startedAt?:     number;
  completedAt?:   number;
  queuePosition?: number;
  pollStatus?:    string;
}

/** One entry per agentId — initialised idle. */
const cache: Record<string, SkyboxEntry> = {
  safe:  { agentId: "safe",  status: "idle", prompt: AGENT_PROMPTS["safe"]!  },
  fast:  { agentId: "fast",  status: "idle", prompt: AGENT_PROMPTS["fast"]!  },
  cheap: { agentId: "cheap", status: "idle", prompt: AGENT_PROMPTS["cheap"]! },
};

const VALID_AGENTS = ["safe", "fast", "cheap"] as const;
type ValidAgent = typeof VALID_AGENTS[number];

function isValidAgent(id: string): id is ValidAgent {
  return (VALID_AGENTS as readonly string[]).includes(id);
}

// ─── Blockade Labs API helpers ────────────────────────────────────────────────

const BL_BASE = "https://backend.blockadelabs.com/api/v1";

function requireApiKey(): string {
  const key = process.env["BLOCKADE_LABS_API_KEY"];
  if (!key) throw new Error("BLOCKADE_LABS_API_KEY not set");
  return key;
}

/**
 * Returns the style ID to use for generation.
 * skybox_style_id is REQUIRED by the Blockade Labs API.
 * Reads from BLOCKADE_LABS_STYLE_ID env var; falls back to 67 (M3 Photoreal).
 */
function resolveStyleId(): number {
  const raw = process.env["BLOCKADE_LABS_STYLE_ID"];
  if (raw) {
    const n = parseInt(raw, 10);
    if (!isNaN(n)) return n;
  }
  return 67; // M3 Photoreal — current default Model 3 style
}

/**
 * Strip emojis and non-printable/non-ASCII characters, collapse whitespace,
 * and truncate to 700 characters (Blockade Labs prompt limit).
 */
function sanitizePrompt(prompt: string): string {
  return prompt
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")  // emoji surrogate pairs
    .replace(/[^\x20-\x7E]/g, "")             // non-printable / non-ASCII
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

/**
 * POST /api/v1/skybox — start generation.
 * Returns the numeric request id.
 */
async function blGenerate(apiKey: string, prompt: string): Promise<number> {
  const styleId = resolveStyleId();
  const body = {
    skybox_style_id: styleId,
    prompt:          sanitizePrompt(prompt),
  };

  console.log(`[Skybox] POST /skybox — style=${styleId} prompt="${body.prompt.slice(0, 80)}…"`);

  const res = await fetch(`${BL_BASE}/skybox`, {
    method:  "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error(`[Skybox] POST /skybox failed: HTTP ${res.status} — ${txt.slice(0, 500)}`);
    throw new Error(`Blockade Labs /skybox ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id?: number; obfuscated_id?: string };
  if (typeof data.id !== "number") {
    throw new Error(`Blockade Labs /skybox response missing id: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.id;
}

interface BlPollResult {
  status:          string;   // "pending" | "dispatched" | "processing" | "complete" | "error" | "abort"
  file_url?:       string;
  thumb_url?:      string;
  queue_position?: number;
  error_message?:  string;
}

/**
 * GET /api/v1/imagine/requests/:id — poll one request.
 *
 * IMPORTANT: The poll response wraps the data under a "response" key:
 *   { "response": { "status": "...", "file_url": "...", ... } }
 * This is different from the initial POST response which is top-level.
 */
async function blPoll(apiKey: string, id: number): Promise<BlPollResult> {
  const res = await fetch(`${BL_BASE}/imagine/requests/${id}?api_key=${apiKey}`);
  if (!res.ok) {
    throw new Error(`Blockade Labs poll ${res.status}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  // Unwrap the nested "response" key — Blockade Labs wraps poll data here
  const data = (raw["response"] ?? raw) as unknown;
  return data as BlPollResult;
}

// ─── Async generation + polling loop ─────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS  = 20 * 60_000; // 20 minutes

async function generateSkybox(agentId: string): Promise<void> {
  const entry = cache[agentId];
  if (!entry) return;

  const apiKey = requireApiKey(); // throws if not set
  entry.status        = "pending";
  entry.startedAt     = Date.now();
  entry.error         = undefined;
  entry.url           = undefined;
  entry.thumbUrl      = undefined;
  entry.queuePosition = undefined;
  entry.pollStatus    = undefined;

  let blockadeId: number;
  try {
    blockadeId       = await blGenerate(apiKey, entry.prompt);
    entry.blockadeId = blockadeId;
  } catch (err) {
    entry.status = "error";
    entry.error  = String(err);
    console.error(`[Skybox] ${agentId} generate failed:`, err);
    return;
  }

  console.log(`[Skybox] ${agentId} started → blockadeId=${blockadeId}`);

  const deadline        = Date.now() + POLL_TIMEOUT_MS;
  let   lastStatus      = "";

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    let result: BlPollResult;
    try {
      result = await blPoll(apiKey, blockadeId);
    } catch (err) {
      // transient poll error — keep trying
      console.warn(`[Skybox] ${agentId} poll error (retrying):`, err);
      continue;
    }

    // Track live state so GET /skybox/:id reflects current progress
    entry.pollStatus    = result.status;
    entry.queuePosition = result.queue_position;

    // Log status transitions
    if (result.status !== lastStatus) {
      console.log(
        `[Skybox] ${agentId} status: ${lastStatus || "(start)"} → ${result.status}` +
        (result.queue_position != null ? ` (queue: ${result.queue_position})` : ""),
      );
      lastStatus = result.status;
    }

    if (result.status === "complete") {
      entry.status        = "complete";
      entry.url           = result.file_url;
      entry.thumbUrl      = result.thumb_url;
      entry.completedAt   = Date.now();
      entry.queuePosition = undefined;
      entry.pollStatus    = undefined;
      console.log(`[Skybox] ${agentId} complete → ${result.file_url}`);
      return;
    }

    // Mark as error only when Blockade Labs explicitly says so
    if (result.status === "error" || result.status === "abort" || result.error_message) {
      entry.status = "error";
      entry.error  = result.error_message ?? `Blockade Labs status: ${result.status}`;
      console.error(`[Skybox] ${agentId} failed: ${entry.error}`);
      return;
    }

    // pending / dispatched / processing → keep polling
  }

  // Timed out after 20 minutes — leave as "pending" so the user can see it's
  // still in queue; do NOT mark as error.
  console.warn(`[Skybox] ${agentId} poll timed out after 20 minutes — leaving as pending`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /skybox/styles — proxy the Blockade Labs styles list.
 * Useful for discovering valid BLOCKADE_LABS_STYLE_ID values.
 * Returns 503 if BLOCKADE_LABS_API_KEY is not set.
 */
router.get("/styles", async (_req: Request, res: Response) => {
  const apiKey = process.env["BLOCKADE_LABS_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "BLOCKADE_LABS_API_KEY not configured on server" });
    return;
  }
  try {
    const r = await fetch(`${BL_BASE}/skybox/styles?api_key=${apiKey}`);
    if (!r.ok) {
      res.status(502).json({ error: `Blockade Labs /skybox/styles ${r.status}` });
      return;
    }
    res.json(await r.json());
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

/** GET /skybox — list all agent skybox entries */
router.get("/", (_req: Request, res: Response) => {
  res.json(Object.values(cache));
});

/** GET /skybox/:agentId — single agent entry */
router.get("/:agentId", (req: Request, res: Response) => {
  const { agentId } = req.params;
  if (!agentId || !isValidAgent(agentId)) {
    res.status(400).json({ error: `Unknown agentId. Valid: ${VALID_AGENTS.join(", ")}` });
    return;
  }
  res.json(cache[agentId]);
});

/**
 * POST /skybox/:agentId — trigger generation.
 * Idempotent: if status is pending or complete, returns current state immediately.
 * Returns 503 if BLOCKADE_LABS_API_KEY is not configured.
 */
router.post("/:agentId", (req: Request, res: Response) => {
  const { agentId } = req.params;
  if (!agentId || !isValidAgent(agentId)) {
    res.status(400).json({ error: `Unknown agentId. Valid: ${VALID_AGENTS.join(", ")}` });
    return;
  }

  if (!process.env["BLOCKADE_LABS_API_KEY"]) {
    res.status(503).json({ error: "BLOCKADE_LABS_API_KEY not configured on server" });
    return;
  }

  const entry = cache[agentId]!;

  if (entry.status === "pending") {
    res.status(202).json({ ...entry, message: "Generation already in progress" });
    return;
  }
  if (entry.status === "complete") {
    res.status(200).json(entry);
    return;
  }

  // Reset error state so user can retry after a failure
  entry.status = "pending";

  // Fire-and-forget — does not block the response
  generateSkybox(agentId).catch((err) => {
    console.error(`[Skybox] unhandled error for ${agentId}:`, err);
    entry.status = "error";
    entry.error  = String(err);
  });

  res.status(202).json({ ...entry, message: "Generation started" });
});

export default router;
