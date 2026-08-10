import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { clientIp } from "../_shared/clientIp.ts";

const ALLOWED_SOURCES = new Set([
  "react-boundary",
  "window-error",
  "unhandled-rejection",
  "deployment-asset",
  "query-error",
]);

const HOURLY_LIMIT = 30;

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

export function sanitizeClientReportValue(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/\+?[1-9]\d{7,14}/g, "[redacted-number]")
    .replace(/https?:\/\/[^\s?#]+[^\s]*/gi, (url) => url.split(/[?#]/, 1)[0])
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// In-memory fallback when service role is unavailable (local tests / misconfig).
// Edge isolates are single-process; durable limit is the RPC path.
const memoryHits = new Map<string, number[]>();

export function memoryAllowClientError(ip: string, limit = HOURLY_LIMIT, now = Date.now()): boolean {
  const windowMs = 3_600_000;
  const prior = (memoryHits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (prior.length >= limit) {
    memoryHits.set(ip, prior);
    return false;
  }
  prior.push(now);
  memoryHits.set(ip, prior);
  return true;
}

export function resetClientErrorMemoryLimiter(): void {
  memoryHits.clear();
}

// Deno.env.get throws NotCapable when the process was started without
// --allow-env, which is how `deno test` runs these handlers in CI. Treating a
// denied read as "unset" routes the request down the in-memory fallback below,
// exactly as a missing service-role key would.
function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

async function reserveRateLimit(ip: string): Promise<"allow" | "deny" | "unavailable"> {
  const supabaseUrl = readEnv("SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  const pepper = readEnv("CLIENT_ERROR_RATE_LIMIT_SALT")
    ?? readEnv("CRON_SHARED_SECRET")
    ?? "client-error-rate-limit";
  const ipHash = await sha256Hex(`${pepper}:${ip}`);

  if (!supabaseUrl || !serviceRoleKey) {
    return memoryAllowClientError(ip) ? "allow" : "deny";
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.rpc("reserve_client_error_report", {
      p_ip_hash: ipHash,
      p_limit: HOURLY_LIMIT,
    });
    if (!error) return "allow";
    if (error.message?.includes("client_error_rate_limited")) return "deny";
    console.error("client_error_rate_limit_unavailable", error.message);
    // Fail open to memory so telemetry is not dropped on transient DB issues.
    return memoryAllowClientError(ip) ? "allow" : "deny";
  } catch (e) {
    console.error("client_error_rate_limit_exception", e instanceof Error ? e.message : String(e));
    return memoryAllowClientError(ip) ? "allow" : "deny";
  }
}

export async function handleReportClientErrorRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const ip = clientIp(req);
  const rate = await reserveRateLimit(ip);
  if (rate === "deny") {
    return json(req, { error: "rate_limited" }, 429);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await readJsonBody(req, 8_192);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return json(req, { error: error.status === 413 ? "Payload too large" : "Invalid JSON" }, error.status);
    }
    return json(req, { error: "Invalid JSON" }, 400);
  }

  const source = sanitizeClientReportValue(payload.source, 40);
  const route = sanitizeClientReportValue(payload.route, 200);
  if (!ALLOWED_SOURCES.has(source) || !route.startsWith("/") || route.includes("?")) {
    return json(req, { error: "Invalid report" }, 400);
  }

  const event = {
    event: "client_application_error",
    source,
    severity: source === "deployment-asset" ? "warning" : "error",
    name: sanitizeClientReportValue(payload.name, 80),
    message: sanitizeClientReportValue(payload.message, 500),
    route,
    release: sanitizeClientReportValue(payload.release, 120),
    component: payload.component ? sanitizeClientReportValue(payload.component, 240) : null,
    online: payload.online === true,
    visibility: sanitizeClientReportValue(payload.visibility, 20),
    // The correlation id is a caller-minted random UUID, not PII -- the sanitizer's UUID
    // redaction would rewrite it to "[redacted-id]" on every report, destroying the only
    // handle that ties a client report to a server-side trace. Strict whole-string UUID
    // validation keeps free text out of the log line; anything else gets a server id.
    correlation_id: typeof payload.correlationId === "string" && UUID_SHAPE.test(payload.correlationId)
      ? payload.correlationId.toLowerCase()
      : crypto.randomUUID(),
    observed_at: new Date().toISOString(),
  };

  // Structured, PHI-scrubbed telemetry remains in the existing Supabase logging boundary.
  // Operators can alert on event=client_application_error without introducing a new processor.
  console.error(JSON.stringify(event));
  return json(req, { accepted: true }, 202);
}
