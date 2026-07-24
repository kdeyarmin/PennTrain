// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { clientIp } from "../_shared/clientIp.ts";

// Public, unauthenticated demo-request intake by design (requires verify_jwt:false for
// [functions.request-demo] in supabase/config.toml, the same registration as
// signup-organization). Abuse controls live here because there is no caller session:
// a Cloudflare Turnstile proof plus a hashed-IP submission cap, both enforced before the
// service-role insert into public.demo_requests. Clients never write the table directly --
// it has no anon/authenticated INSERT policy or grant.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  // `message` is returned to the caller, so it must stay generic for anything derived from
  // backend errors; pass raw Supabase/DB details via `internalDetail` so they are only logged.
  constructor(public status: number, public code: string, message: string, public internalDetail?: string) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) {
    throw new HttpError(500, "turnstile_not_configured", "Demo request verification is not configured");
  }
  if (!token) {
    throw new HttpError(400, "turnstile_required", "Demo request verification is required");
  }

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (ip !== "unknown") form.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const data = await response.json().catch(() => null) as { success?: boolean; "error-codes"?: string[] } | null;
  if (!response.ok || !data?.success) {
    console.warn("Turnstile verification failed", data?.["error-codes"] ?? response.status);
    throw new HttpError(400, "turnstile_failed", "Demo request verification failed. Refresh and try again.");
  }
}

// Lighter sibling of signup-organization's reserve/finalize attempt ledger: demo requests only
// write a row on success, so counting recent rows by hashed IP is enough to cap table flooding
// without a dedicated RPC pair.
async function enforceIpRateLimit(adminClient: ReturnType<typeof createClient>, ipHash: string): Promise<void> {
  const maxPerHour = parsePositiveInteger(Deno.env.get("DEMO_MAX_IP_REQUESTS_PER_HOUR"), 5);
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await adminClient
    .from("demo_requests")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", windowStart);
  if (error) {
    throw new HttpError(500, "rate_limit_unavailable", "Demo requests are temporarily unavailable. Please try again later.", error.message);
  }
  if ((count ?? 0) >= maxPerHour) {
    throw new HttpError(429, "rate_limited", "Too many demo requests. Please try again later.");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: {
    name?: string;
    email?: string;
    organization?: string;
    facility_count?: number | string;
    message?: string;
    source_path?: string;
    turnstile_token?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const organization = body.organization?.trim() || null;
  const message = body.message?.trim() || null;
  const sourcePathRaw = body.source_path?.trim() ?? "";

  if (!name || !email) return json({ error: "name and email are required" }, 400);
  if (name.length > 200) return json({ error: "name must be 200 characters or fewer" }, 400);
  if (email.length < 3 || email.length > 320 || !EMAIL_RE.test(email)) {
    return json({ error: "Enter a valid email address" }, 400);
  }
  if (organization && organization.length > 200) {
    return json({ error: "organization must be 200 characters or fewer" }, 400);
  }
  if (message && message.length > 4000) {
    return json({ error: "message must be 4000 characters or fewer" }, 400);
  }
  if (sourcePathRaw.length > 300) {
    return json({ error: "source_path must be 300 characters or fewer" }, 400);
  }
  // Only same-site paths are worth recording; full URLs or junk are dropped, not rejected.
  const sourcePath = sourcePathRaw.startsWith("/") ? sourcePathRaw : null;

  let facilityCount: number | null = null;
  if (body.facility_count !== undefined && body.facility_count !== null && body.facility_count !== "") {
    const parsed = Number(body.facility_count);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
      return json({ error: "facility_count must be a whole number between 1 and 1000" }, 400);
    }
    facilityCount = parsed;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  const ip = clientIp(req);
  const hashPepper = Deno.env.get("DEMO_RATE_LIMIT_PEPPER") ?? serviceRoleKey;
  const ipHash = await sha256Hex(`ip:${ip}:${hashPepper}`);

  try {
    await verifyTurnstile(body.turnstile_token, ip);
    await enforceIpRateLimit(adminClient, ipHash);

    const { error } = await adminClient.from("demo_requests").insert({
      name,
      email,
      organization,
      facility_count: facilityCount,
      message,
      source_path: sourcePath,
      ip_hash: ipHash,
    });
    if (error) {
      throw new HttpError(500, "demo_request_failed", "We could not submit your demo request. Please try again later.", error.message);
    }

    // Notification dispatch (e.g. an email or Slack ping to the sales inbox) could hook in
    // here later; for now platform admins triage new rows from the demo_requests queue.
    return json({ ok: true });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    // For HttpError, the message is intentionally user-facing. For unexpected errors, return a
    // generic message to avoid leaking internal details or stack traces to the caller.
    const isHttpError = error instanceof HttpError;
    const message = isHttpError ? (error as HttpError).message : "An unexpected error occurred. Please try again.";
    const internalDetail = isHttpError ? (error as HttpError).internalDetail : undefined;
    if (!isHttpError || status >= 500 || internalDetail) {
      console.error(isHttpError ? "Demo request HttpError:" : "Unexpected demo request error:", error, internalDetail ?? "");
    }
    return json({ ok: false, error: message }, status);
  }
});
