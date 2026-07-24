// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { parseFromAddress } from "../_shared/notificationDelivery.ts";
import { buildSubscribeWelcomeEmail } from "../_shared/marketingEmails.ts";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";

// Public, unauthenticated newsletter/regulatory-update signup (requires verify_jwt:false for
// [functions.subscribe-updates] in supabase/config.toml, the same registration as request-demo).
// This is the email-capture surface for the marketing site's "get regulatory updates by email"
// form: subscribing feeds a list we can send regulatory-update drips to. Abuse controls live here
// because there is no caller session -- a Cloudflare Turnstile proof plus a hashed-IP submission
// cap, both enforced before the service-role write into public.newsletter_subscribers. Clients
// never write the table directly (it has no anon/authenticated INSERT policy or grant).

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_TOPICS = new Set(["regulatory_updates", "product_news"]);
const DEFAULT_SITE_URL = "https://cmcarebase.com";

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

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) {
    throw new HttpError(500, "turnstile_not_configured", "Subscription verification is not configured");
  }
  if (!token) {
    throw new HttpError(400, "turnstile_required", "Subscription verification is required");
  }

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (ip !== "unknown") form.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const data = (await response.json().catch(() => null)) as
    | { success?: boolean; "error-codes"?: string[] }
    | null;
  if (!response.ok || !data?.success) {
    console.warn("Turnstile verification failed", data?.["error-codes"] ?? response.status);
    throw new HttpError(400, "turnstile_failed", "Verification failed. Refresh and try again.");
  }
}

// Same lightweight approach as request-demo: cap flooding by counting recent rows from one hashed
// IP rather than a dedicated ledger.
async function enforceIpRateLimit(adminClient: ReturnType<typeof createClient>, ipHash: string): Promise<void> {
  const maxPerHour = parsePositiveInteger(Deno.env.get("NEWSLETTER_MAX_IP_REQUESTS_PER_HOUR"), 5);
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await adminClient
    .from("newsletter_subscribers")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", windowStart);
  if (error) {
    throw new HttpError(500, "rate_limit_unavailable", "Subscriptions are temporarily unavailable. Please try again later.", error.message);
  }
  if ((count ?? 0) >= maxPerHour) {
    throw new HttpError(429, "rate_limited", "Too many requests. Please try again later.");
  }
}

// Best-effort welcome email. Never throws into the request path: a missing SendGrid key or a
// transient send failure must not fail the subscription (the row is already saved).
async function sendWelcomeEmail(params: { email: string; name: string | null; siteUrl: string }): Promise<void> {
  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) return;
  try {
    const from = parseFromAddress(
      Deno.env.get("NOTIFICATION_FROM_EMAIL") || "CareMetric CareBase <notifications@cmcarebase.com>",
    );
    const message = buildSubscribeWelcomeEmail({
      email: params.email,
      name: params.name,
      siteUrl: params.siteUrl,
      unsubscribeUrl: `mailto:hello@caremetric.ai?subject=${encodeURIComponent(`Unsubscribe: ${params.email}`)}`,
    });
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: params.email }] }],
        from,
        subject: message.subject,
        content: [
          { type: "text/plain", value: message.text },
          { type: "text/html", value: message.html },
        ],
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      console.warn("subscribe-updates welcome email failed", resp.status, detail.slice(0, 300));
    }
  } catch (error) {
    console.warn("subscribe-updates welcome email error", error instanceof Error ? error.message : error);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: {
    name?: string;
    email?: string;
    organization?: string;
    source_path?: string;
    topics?: unknown;
    turnstile_token?: string;
  };
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    return json({ error: "Invalid JSON body" }, 400);
  }

  const name = body.name?.trim() || null;
  const email = body.email?.trim().toLowerCase();
  const organization = body.organization?.trim() || null;
  const sourcePathRaw = body.source_path?.trim() ?? "";

  if (!email) return json({ error: "email is required" }, 400);
  if (email.length < 3 || email.length > 320 || !EMAIL_RE.test(email)) {
    return json({ error: "Enter a valid email address" }, 400);
  }
  if (name && name.length > 200) {
    return json({ error: "name must be 200 characters or fewer" }, 400);
  }
  if (organization && organization.length > 200) {
    return json({ error: "organization must be 200 characters or fewer" }, 400);
  }
  if (sourcePathRaw.length > 300) {
    return json({ error: "source_path must be 300 characters or fewer" }, 400);
  }
  // Only same-site paths are worth recording; full URLs or junk are dropped, not rejected.
  const sourcePath = sourcePathRaw.startsWith("/") ? sourcePathRaw : null;

  // Validate opt-in topics against the allowlist; default to the regulatory-updates list.
  let topics = ["regulatory_updates"];
  if (Array.isArray(body.topics)) {
    const requested = body.topics
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter((t) => ALLOWED_TOPICS.has(t));
    if (requested.length > 0) topics = Array.from(new Set(requested));
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  const siteUrl = (Deno.env.get("SITE_URL") || DEFAULT_SITE_URL).replace(/\/$/, "");
  const ip = clientIp(req);
  const hashPepper = Deno.env.get("NEWSLETTER_RATE_LIMIT_PEPPER") ?? Deno.env.get("DEMO_RATE_LIMIT_PEPPER") ?? serviceRoleKey;
  const ipHash = await sha256Hex(`ip:${ip}:${hashPepper}`);

  try {
    await verifyTurnstile(body.turnstile_token, ip);

    // Idempotent by email: an existing subscriber is reactivated and their topics merged, rather
    // than erroring on the unique constraint. Only cap NEW inserts by IP so a returning subscriber
    // updating their preferences isn't blocked by the flood cap.
    const { data: existing, error: lookupError } = await adminClient
      .from("newsletter_subscribers")
      .select("id, status, topics")
      .eq("email", email)
      .maybeSingle();
    if (lookupError) {
      throw new HttpError(500, "subscribe_failed", "We could not process your subscription. Please try again later.", lookupError.message);
    }

    let sendWelcome = false;
    let alreadySubscribed = false;

    if (existing) {
      const mergedTopics = Array.from(new Set([...(existing.topics ?? []), ...topics]));
      const update: Record<string, unknown> = { status: "subscribed", topics: mergedTopics };
      if (name) update.name = name;
      if (organization) update.organization = organization;
      if (sourcePath) update.source_path = sourcePath;
      const { error: updateError } = await adminClient
        .from("newsletter_subscribers")
        .update(update)
        .eq("id", existing.id);
      if (updateError) {
        throw new HttpError(500, "subscribe_failed", "We could not process your subscription. Please try again later.", updateError.message);
      }
      alreadySubscribed = existing.status === "subscribed";
      // Re-welcome someone who had previously unsubscribed/bounced; stay silent for a duplicate submit.
      sendWelcome = existing.status !== "subscribed";
    } else {
      await enforceIpRateLimit(adminClient, ipHash);
      const { error: insertError } = await adminClient.from("newsletter_subscribers").insert({
        email,
        name,
        organization,
        source_path: sourcePath,
        topics,
        ip_hash: ipHash,
      });
      if (insertError) {
        throw new HttpError(500, "subscribe_failed", "We could not process your subscription. Please try again later.", insertError.message);
      }
      sendWelcome = true;
    }

    if (sendWelcome) {
      await sendWelcomeEmail({ email, name, siteUrl });
    }

    return json({ ok: true, alreadySubscribed });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const isHttpError = error instanceof HttpError;
    const message = isHttpError ? (error as HttpError).message : "An unexpected error occurred. Please try again.";
    const internalDetail = isHttpError ? (error as HttpError).internalDetail : undefined;
    if (!isHttpError || status >= 500 || internalDetail) {
      console.error(isHttpError ? "Subscribe HttpError:" : "Unexpected subscribe error:", error, internalDetail ?? "");
    }
    return json({ ok: false, error: message }, status);
  }
});
