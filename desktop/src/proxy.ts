import { serve } from "bun";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * DreamServer embed proxy — strips iframe-blocking headers, handles CORS,
 * and auto-provisions / auto-logs-in to services like n8n.
 *
 * Usage: PROXY_ROUTES='5679=http://localhost:5678' bun run proxy.ts
 */

const STRIP_HEADERS = [
  "x-frame-options",
  "content-security-policy",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-methods",
  "access-control-allow-headers",
];

const DREAMSERVER_DIR = join(homedir(), ".local", "share", "dreamserver");
const CREDENTIALS_PATH = join(DREAMSERVER_DIR, "n8n-credentials.json");

// Default credentials for the local-only n8n instance
function getN8nOwner() {
  let firstName = "Dream";
  let lastName = "Server";
  try {
    const configPath = join(homedir(), ".local", "share", "ai.dreamserver.desktop", "config.json");
    if (existsSync(configPath)) {
      const data = JSON.parse(readFileSync(configPath, "utf-8"));
      if (data?.setup?.userName) {
        const parts = data.setup.userName.trim().split(" ");
        if (parts.length > 1) {
          firstName = parts[0];
          lastName = parts.slice(1).join(" ");
        } else {
          firstName = data.setup.userName;
          lastName = "";
        }
      }
    }
  } catch {
    // ignore
  }
  return {
    email: "local@dreamserver.local",
    firstName,
    lastName,
    password: "DreamServer-Local-2026!",
  };
}

interface ProxyRoute {
  port: number;
  upstream: string;
  name: string;
}

interface N8nSession {
  cookie: string;
  provisioned: boolean;
  personalized: boolean;
}

const n8nSessions = new Map<string, N8nSession>();

function parseRoutes(): ProxyRoute[] {
  const raw = process.env.PROXY_ROUTES ?? "5679=http://localhost:5678";
  return raw.split(",").map((entry: string) => {
    const [portStr, upstream] = entry.trim().split("=");
    const port = parseInt(portStr, 10);
    const name = new URL(upstream).hostname;
    return { port, upstream, name };
  });
}

function loadCredentials(): { provisioned: boolean } {
  try {
    if (existsSync(CREDENTIALS_PATH)) {
      const data = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
      return { provisioned: data.provisioned === true };
    }
  } catch {
    // ignore
  }
  return { provisioned: false };
}

function saveCredentials(provisioned: boolean) {
  mkdirSync(DREAMSERVER_DIR, { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify({ provisioned, email: getN8nOwner().email }, null, 2));
}

/** Create the n8n owner account via REST API */
async function provisionN8n(upstream: string): Promise<boolean> {
  try {
    const res = await fetch(`${upstream}/rest/owner/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getN8nOwner()),
    });
    if (res.ok || res.status === 400) {
      saveCredentials(true);
      console.log("[n8n] Owner account provisioned");
      return true;
    }
    console.error("[n8n] Provision failed:", res.status, await res.text());
    return false;
  } catch (e) {
    console.error("[n8n] Provision error:", e);
    return false;
  }
}

/** Login to n8n and return the session cookie */
async function loginN8n(upstream: string): Promise<string | null> {
  try {
    const res = await fetch(`${upstream}/rest/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emailOrLdapLoginId: getN8nOwner().email,
        password: getN8nOwner().password,
      }),
      redirect: "manual",
    });

    if (res.ok) {
      const setCookie = res.headers.getSetCookie?.() ?? [];
      const sessionCookie = setCookie.find((c: string) => c.startsWith("n8n-auth="));
      if (sessionCookie) {
        const cookieValue = sessionCookie.split(";")[0];
        console.log("[n8n] Auto-login successful");
        return cookieValue;
      }
    }
    console.error("[n8n] Login failed:", res.status);
    return null;
  } catch (e) {
    console.error("[n8n] Login error:", e);
    return null;
  }
}

/** Skip the personalization survey via API */
async function skipPersonalization(upstream: string, cookie: string): Promise<void> {
  try {
    await fetch(`${upstream}/rest/me/survey`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        companySize: null,
        codingSkill: null,
        workArea: null,
        otherWorkArea: null,
        companyType: null,
      }),
    });
    console.log("[n8n] Personalization survey dismissed");
  } catch {
    // Non-critical — ignore
  }
}

/** Enable the instance-level MCP server */
async function enableMcp(upstream: string, cookie: string): Promise<void> {
  try {
    const res = await fetch(`${upstream}/rest/mcp/settings`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ mcpAccessEnabled: true }),
    });
    if (res.ok) {
      console.log("[n8n] Instance-level MCP server enabled");
    } else {
      console.error("[n8n] MCP enable failed:", res.status);
    }
  } catch {
    // Non-critical
  }
}

const authPromises = new Map<string, Promise<string | null>>();

/** Ensure n8n is provisioned and logged in */
async function ensureN8nAuth(upstream: string): Promise<string | null> {
  const session = n8nSessions.get(upstream);
  if (session?.cookie) return session.cookie; // Fast path — already auth'd

  // If another request is currently running the auth flow, wait for it
  if (authPromises.has(upstream)) {
    return authPromises.get(upstream)!;
  }

  const promise = (async () => {
    try {
      let currentSession = n8nSessions.get(upstream);

      if (!currentSession?.provisioned) {
        const creds = loadCredentials();
        if (!creds.provisioned) {
          await provisionN8n(upstream);
        }
      }

      const cookie = await loginN8n(upstream);
      if (cookie) {
        currentSession = { cookie, provisioned: true, personalized: false };
        n8nSessions.set(upstream, currentSession);

        // Auto-dismiss the survey and enable MCP after first login
        if (!currentSession.personalized) {
          await skipPersonalization(upstream, cookie);
          await enableMcp(upstream, cookie);
          currentSession.personalized = true;
        }
      }

      return cookie ?? null;
    } finally {
      authPromises.delete(upstream);
    }
  })();

  authPromises.set(upstream, promise);
  return promise;
}

/** Allowed origins — only the Tauri webview and dev server */
const ALLOWED_ORIGINS = new Set([
  "tauri://localhost",
  "https://tauri.localhost",
  "http://localhost:1421",
  "http://localhost:1420",
  "http://127.0.0.1:1421",
  "http://127.0.0.1:1420",
]);

/** Build CORS headers for a verified origin */
function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie, X-Requested-With, browser-id, push-ref, sentry-trace, baggage",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

/** Validate the request origin — returns the origin if allowed, null otherwise */
function validateOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  // No origin header (same-origin requests, e.g. iframe src loads) — allow
  if (!origin) return "tauri://localhost";
  // Check allowlist
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
}

function startProxy(route: ProxyRoute) {
  const isN8n = route.upstream.includes("5678");

  serve({
    port: route.port,
    async fetch(req: Request) {
      const url = new URL(req.url);

      // Validate origin — reject unauthorized callers
      const validOrigin = validateOrigin(req);
      if (!validOrigin) {
        return new Response("Forbidden: unauthorized origin", { status: 403 });
      }

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(validOrigin) });
      }

      const target = `${route.upstream}${url.pathname}${url.search}`;

      try {
        const headers = new Headers(req.headers);
        if (isN8n) {
          const cookie = await ensureN8nAuth(route.upstream);
          if (cookie) {
            const existing = headers.get("cookie") ?? "";
            headers.set("cookie", existing ? `${existing}; ${cookie}` : cookie);
          }
        }

        const upstream = await fetch(target, {
          method: req.method,
          headers,
          body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
          redirect: "manual",
        });

        const respHeaders = new Headers(upstream.headers);

        // Strip restrictive headers
        for (const h of STRIP_HEADERS) {
          respHeaders.delete(h);
        }

        // Add CORS for the validated origin
        for (const [k, v] of Object.entries(corsHeaders(validOrigin))) {
          respHeaders.set(k, v);
        }

        // Rewrite redirects through the proxy
        const location = respHeaders.get("location");
        if (location) {
          const rewritten = location.replace(route.upstream, `http://localhost:${route.port}`);
          respHeaders.set("location", rewritten);
        }

        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: respHeaders,
        });
      } catch {
        return new Response("Service unavailable", { status: 502 });
      }
    },
  });

  console.log(`[proxy] :${route.port} → ${route.upstream}${isN8n ? " (n8n auto-auth)" : ""}`);
}

const routes = parseRoutes();
for (const route of routes) {
  startProxy(route);
}
console.log(`[proxy] ${routes.length} route(s) active`);
