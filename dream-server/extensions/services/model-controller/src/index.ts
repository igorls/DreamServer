/**
 * Dream Server — Model Controller Sidecar
 *
 * A minimal service that manages LLM backend container restarts.
 * This is the ONLY container with Docker socket + .env write access.
 *
 * API:
 *   GET  /health  — liveness probe
 *   GET  /status  — container state + loaded model
 *   POST /switch  — update .env + restart llama-server
 */

import { readFileSync, writeFileSync, existsSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";

// --- Configuration ---

const PORT = parseInt(process.env.CONTROLLER_PORT || "3003", 10);
const SECRET = process.env.MODEL_CONTROLLER_SECRET || "";
const ENV_PATH = process.env.ENV_FILE_PATH || "/dream-server/.env";
const MODELS_DIR = process.env.MODELS_DIR || "/models";
const HF_CACHE_DIR = process.env.HF_CACHE_DIR || "/hf-cache";
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
const CONTAINER_NAME = "dream-llama-server"; // hardcoded allowlist
const ALLOWED_ENV_KEYS = new Set(["GGUF_FILE", "VLLM_MODEL", "CTX_SIZE"]);

// --- Docker Engine API (HTTP over Unix socket) ---

async function dockerGet(path: string): Promise<Response> {
  return fetch(`http://localhost${path}`, {
    // @ts-expect-error — Bun supports unix socket option
    unix: DOCKER_SOCKET,
  });
}

async function dockerPost(path: string, body?: unknown): Promise<Response> {
  return fetch(`http://localhost${path}`, {
    method: "POST",
    // @ts-expect-error — Bun supports unix socket option
    unix: DOCKER_SOCKET,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// --- .env File Helpers ---

function readEnvFile(): Map<string, string> {
  const env = new Map<string, string>();
  if (!existsSync(ENV_PATH)) return env;
  const content = readFileSync(ENV_PATH, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    env.set(key, val);
  }
  return env;
}

function writeEnvFile(env: Map<string, string>): void {
  // Preserve original file structure — only mutate known keys
  if (!existsSync(ENV_PATH)) {
    const lines = [...env.entries()].map(([k, v]) => `${k}=${v}`);
    const tmpPath = `${ENV_PATH}.tmp`;
    writeFileSync(tmpPath, lines.join("\n") + "\n");
    renameSync(tmpPath, ENV_PATH);
    return;
  }

  const original = readFileSync(ENV_PATH, "utf-8");
  const lines = original.split("\n");
  const written = new Set<string>();

  const result = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (env.has(key)) {
      written.add(key);
      return `${key}=${env.get(key)}`;
    }
    return line;
  });

  // Append new keys that weren't in the original
  for (const [key, val] of env) {
    if (!written.has(key)) {
      result.push(`${key}=${val}`);
    }
  }

  const tmpPath = `${ENV_PATH}.tmp`;
  writeFileSync(tmpPath, result.join("\n"));
  renameSync(tmpPath, ENV_PATH);
}

// --- Validation ---

function verifyModelExists(modelFile: string, backend: string): { ok: boolean; error?: string } {
  if (backend === "vllm") {
    // For vLLM, modelFile is a HuggingFace model ID like "Qwen/Qwen3-14B"
    // Check if the model is in the HF cache
    if (!existsSync(HF_CACHE_DIR)) {
      return { ok: false, error: `HF cache directory not found: ${HF_CACHE_DIR}` };
    }
    // HF cache structure: models--org--modelname/
    const cacheDirName = `models--${modelFile.replace("/", "--")}`;
    const cacheModelPath = join(HF_CACHE_DIR, "hub", cacheDirName);
    if (!existsSync(cacheModelPath)) {
      return { ok: false, error: `Model not pre-downloaded. Expected cache at: ${cacheDirName}` };
    }
    return { ok: true };
  }

  // For llama-server, modelFile is a .gguf filename
  const modelPath = join(MODELS_DIR, modelFile);
  if (!existsSync(modelPath)) {
    return { ok: false, error: `Model file not found: ${modelFile}` };
  }
  return { ok: true };
}

// --- Auth Middleware ---

function checkAuth(req: Request): Response | null {
  if (!SECRET) return null; // no secret configured = skip auth
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// --- Request Handlers ---

async function handleHealth(): Promise<Response> {
  return Response.json({ status: "ok" });
}

async function handleStatus(req: Request): Promise<Response> {
  const authError = checkAuth(req);
  if (authError) return authError;

  try {
    // Query container state
    const containerRes = await dockerGet(`/containers/${CONTAINER_NAME}/json`);
    if (!containerRes.ok) {
      return Response.json({
        backend: "unknown",
        container: "not_found",
        healthy: false,
        model: null,
      });
    }

    const container = (await containerRes.json()) as {
      State: { Status: string; Running: boolean; Health?: { Status: string } };
      Config: { Env: string[]; Image: string };
    };

    const isVllm =
      container.Config.Image?.includes("vllm") ||
      container.Config.Env?.some((e) => e.startsWith("VLLM_"));
    const backend = isVllm ? "vllm" : "llama-server";

    // Read current model from .env
    const env = readEnvFile();
    const model = isVllm ? env.get("VLLM_MODEL") || null : env.get("GGUF_FILE") || null;

    const healthStatus = container.State.Health?.Status;

    return Response.json({
      backend,
      container: container.State.Status,
      healthy: healthStatus === "healthy",
      starting: container.State.Running && healthStatus !== "healthy",
      model,
    });
  } catch (err) {
    return Response.json(
      { backend: "unknown", container: "error", healthy: false, model: null, error: String(err) },
      { status: 502 },
    );
  }
}

async function handleSwitch(req: Request): Promise<Response> {
  const authError = checkAuth(req);
  if (authError) return authError;

  let body: { model_file?: string; backend?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { model_file, backend = "llama-server" } = body;
  if (!model_file) {
    return Response.json({ error: "model_file is required" }, { status: 400 });
  }

  // Security: only allow known backends
  if (backend !== "llama-server" && backend !== "vllm") {
    return Response.json({ error: `Unknown backend: ${backend}` }, { status: 400 });
  }

  // Validate model exists on disk
  const check = verifyModelExists(model_file, backend);
  if (!check.ok) {
    return Response.json({ error: check.error, code: "MODEL_NOT_FOUND" }, { status: 400 });
  }

  // Read current .env
  const env = readEnvFile();
  const envKey = backend === "vllm" ? "VLLM_MODEL" : "GGUF_FILE";

  // Security: only allow known env keys
  if (!ALLOWED_ENV_KEYS.has(envKey)) {
    return Response.json({ error: `Blocked env key: ${envKey}` }, { status: 403 });
  }

  const previousModel = env.get(envKey) || null;
  env.set(envKey, model_file);

  // Atomic write
  try {
    writeEnvFile(env);
  } catch (err) {
    return Response.json({ error: `Failed to update .env: ${err}` }, { status: 500 });
  }

  // Restart the container
  try {
    const restartRes = await dockerPost(`/containers/${CONTAINER_NAME}/restart?t=30`);
    if (!restartRes.ok) {
      const errText = await restartRes.text();
      return Response.json({ error: `Docker restart failed: ${errText}` }, { status: 502 });
    }
  } catch (err) {
    return Response.json({ error: `Docker restart error: ${err}` }, { status: 502 });
  }

  return Response.json({
    status: "restarting",
    previous: previousModel,
    next: model_file,
    backend,
    message: `Switching to ${model_file}. Container restarting...`,
  });
}

// --- HTTP Server ---

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "GET" && path === "/health") return handleHealth();
    if (req.method === "GET" && path === "/status") return handleStatus(req);
    if (req.method === "POST" && path === "/switch") return handleSwitch(req);

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`[model-controller] listening on :${server.port}`);
