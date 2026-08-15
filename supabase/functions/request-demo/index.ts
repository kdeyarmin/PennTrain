import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";
import { clientIp } from "../_shared/clientIp.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

// Public, unauthenticated demo-request intake by design (requires verify_jwt:false for
// [functions.request-demo] in supabase/config.toml, the same registration as
// signup-organization). Abuse controls live here because there is no caller session:
// a Cloudflare Turnstile proof plus a hashed-IP submission cap, both enforced before the
// service-role insert into public.demo_requests. Clients never write the table directly --
// it has no anon/authenticated INSERT policy or grant.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  // `message` is returned to the caller, so it must stay generic for anything derived from
  // backend errors; pass raw Supabase/DB details via `internalDetail` so they are only logged.
  constructor(public status: number, public code: string, message: string, public internalDetail?: string) {
    super(message);
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
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
    // Bound the vendor round-trip -- a Turnstile brownout must fail fast, not hold the request open.
    signal: AbortSignal.timeout(10_000),
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
async function enforceIpRateLimit(adminClient: { from: (table: string) => any }, ipHash: string): Promise<void> {
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

// Best-effort platform-admin notification (public.notifications, surfaced through the app's
// existing notification bell -- see supabase/migrations/20260804010000_demo_request_notifications.sql
// for the fan-out and why it is a service-role-only RPC rather than a trigger on demo_requests).
// Never throws into the request path: the demo_requests row is already committed by the time this
// runs, and a notification failure must not fail a submission that already succeeded. Same shape as
// subscribe-updates/index.ts's sendWelcomeEmail.
async function notifyPlatformAdmins(
  adminClient: { rpc: (fn: string, args?: Record<string, unknown>) => any },
  demoRequestId: string,
): Promise<void> {
  try {
    const { error } = await adminClient.rpc("notify_platform_admins_of_demo_request", {
      p_demo_request_id: demoRequestId,
    });
    if (error) {
      console.warn("request-demo platform admin notification failed", error.message);
    }
  } catch (error) {
    console.warn(
      "request-demo platform admin notification error",
      error instanceof Error ? error.message : error,
    );
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

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
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof RequestBodyError) return json(req, { error: error.message }, error.status);
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const organization = body.organization?.trim() || null;
  const message = body.message?.trim() || null;
  const sourcePathRaw = body.source_path?.trim() ?? "";

  if (!name || !email) return json(req, { error: "name and email are required" }, 400);
  if (name.length > 200) return json(req, { error: "name must be 200 characters or fewer" }, 400);
  if (email.length < 3 || email.length > 320 || !EMAIL_RE.test(email)) {
    return json(req, { error: "Enter a valid email address" }, 400);
  }
  if (organization && organization.length > 200) {
    return json(req, { error: "organization must be 200 characters or fewer" }, 400);
  }
  if (message && message.length > 4000) {
    return json(req, { error: "message must be 4000 characters or fewer" }, 400);
  }
  if (sourcePathRaw.length > 300) {
    return json(req, { error: "source_path must be 300 characters or fewer" }, 400);
  }
  // Only same-site paths are worth recording; full URLs or junk are dropped, not rejected.
  const sourcePath = sourcePathRaw.startsWith("/") ? sourcePathRaw : null;

  let facilityCount: number | null = null;
  if (body.facility_count !== undefined && body.facility_count !== null && body.facility_count !== "") {
    const parsed = Number(body.facility_count);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
      return json(req, { error: "facility_count must be a whole number between 1 and 1000" }, 400);
    }
    facilityCount = parsed;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { error: "Service is not configured" }, 503);
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const ip = clientIp(req);
  const hashPepper = Deno.env.get("DEMO_RATE_LIMIT_PEPPER") ?? serviceRoleKey;
  const ipHash = await sha256Hex(`ip:${ip}:${hashPepper}`);

  try {
    await verifyTurnstile(body.turnstile_token, ip);
    await enforceIpRateLimit(adminClient, ipHash);

    const { data: inserted, error } = await adminClient
      .from("demo_requests")
      .insert({
        name,
        email,
        organization,
        facility_count: facilityCount,
        message,
        source_path: sourcePath,
        ip_hash: ipHash,
      })
      .select("id")
      .single();
    if (error) {
      throw new HttpError(500, "demo_request_failed", "We could not submit your demo request. Please try again later.", error.message);
    }

    // Fan out an in-app notification to platform admins (public.notifications, existing
    // notification-bell plumbing -- no new external integration). Best-effort: the demo request
    // above already succeeded, so this cannot turn a successful submission into a failed response.
    if (inserted?.id) {
      await notifyPlatformAdmins(adminClient, inserted.id);
    }

    return json(req, { ok: true });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    // For HttpError, the message is intentionally user-facing. For unexpected errors, return a
    // generic message to avoid leaking internal details or stack traces to the caller.
    const isHttpError = error instanceof HttpError;
    const messageText = isHttpError ? (error as HttpError).message : "An unexpected error occurred. Please try again.";
    const internalDetail = isHttpError ? (error as HttpError).internalDetail : undefined;
    if (!isHttpError || status >= 500 || internalDetail) {
      console.error(isHttpError ? "Demo request HttpError:" : "Unexpected demo request error:", error, internalDetail ?? "");
    }
    return json(req, { ok: false, error: messageText }, status);
  }
});
