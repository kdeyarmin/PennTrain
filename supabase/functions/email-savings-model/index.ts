import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { parseFromAddress } from "../_shared/notificationDelivery.ts";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";
import { clientIp } from "../_shared/clientIp.ts";

// Public, unauthenticated "email me my savings model" intake for the /savings marketing
// calculator (requires verify_jwt:false for [functions.email-savings-model] in
// supabase/config.toml, the same registration as request-demo/signup-organization). There is no
// caller session, so abuse is gated the same way the rest of the public marketing intake is: a
// Cloudflare Turnstile proof (single-use, server-verified) plus a hashed-IP submission cap, both
// enforced before any mail is sent.
//
// The email body is generated entirely server-side from validated numeric inputs recomputed here
// -- no user-supplied free text is ever placed in the message and the recipient is the address the
// visitor entered -- so the endpoint cannot be used as an arbitrary-content relay. Each request is
// stored as a warm-lead row in public.savings_model_requests (service-role write only), which also
// backs the per-IP rate limit.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Base CareBase list price, included active-resident allotment, and per-resident overage rate
// shown on /savings (Savings.tsx CAREBASE_BASE_MONTHLY / CAREBASE_INCLUDED_RESIDENTS /
// CAREBASE_OVERAGE_MONTHLY). Kept in sync with the marketing page so the emailed numbers match
// exactly what the visitor saw. These are compile-time marketing constants, not DB-driven.
const CAREBASE_BASE_MONTHLY = 499;
const CAREBASE_INCLUDED_RESIDENTS = 25;
const CAREBASE_OVERAGE_MONTHLY = 4;

const SITE_URL = Deno.env.get("PUBLIC_SITE_URL") ?? "https://cmcarebase.com";

// Validation ranges mirror the /savings sliders (Savings.tsx SLIDERS). Inputs are clamped to these
// bounds rather than rejected, so a legitimate slider value can never fail while tampered payloads
// are still bounded before they reach the math.
const RANGES = {
  hours: { min: 1, max: 60 },
  rate: { min: 18, max: 80 },
  tools: { min: 0, max: 2000 },
  cut: { min: 5, max: 60 },
  residents: { min: 5, max: 200 },
} as const;

class HttpError extends Error {
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

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) {
    throw new HttpError(500, "turnstile_not_configured", "Email delivery verification is not configured");
  }
  if (!token) {
    throw new HttpError(400, "turnstile_required", "Please complete the verification first");
  }

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (ip !== "unknown") form.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const data = (await response.json().catch(() => null)) as { success?: boolean; "error-codes"?: string[] } | null;
  if (!response.ok || !data?.success) {
    console.warn("Turnstile verification failed", data?.["error-codes"] ?? response.status);
    throw new HttpError(400, "turnstile_failed", "Verification failed. Refresh and try again.");
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const money = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

interface SavingsModel {
  hours: number;
  rate: number;
  tools: number;
  cut: number;
  residents: number;
  laborPerYear: number;
  toolSpendPerYear: number;
  grossPerYear: number;
  carebasePerYear: number;
  netPerYear: number;
  paybackMonths: number | null;
  monthlyPrice: number;
}

// Single source of truth for the math the /savings results card renders (Savings.tsx). Recomputed
// server-side from the clamped inputs so the emailed worksheet is authoritative, never trusting
// client-sent totals.
function computeModel(raw: { hours?: unknown; rate?: unknown; tools?: unknown; cut?: unknown; residents?: unknown }): SavingsModel {
  const hours = clampInt(raw.hours, RANGES.hours.min, RANGES.hours.max, 10);
  const rate = clampInt(raw.rate, RANGES.rate.min, RANGES.rate.max, 35);
  const tools = clampInt(raw.tools, RANGES.tools.min, RANGES.tools.max, 400);
  const cut = clampInt(raw.cut, RANGES.cut.min, RANGES.cut.max, 25);
  const residents = clampInt(raw.residents, RANGES.residents.min, RANGES.residents.max, 40);

  const laborPerYear = hours * 52 * rate;
  const toolSpendPerYear = tools * 12;
  const grossPerYear = (laborPerYear * cut) / 100 + toolSpendPerYear;
  const monthlyPrice =
    CAREBASE_BASE_MONTHLY + Math.max(0, residents - CAREBASE_INCLUDED_RESIDENTS) * CAREBASE_OVERAGE_MONTHLY;
  const carebasePerYear = monthlyPrice * 12;
  const netPerYear = grossPerYear - carebasePerYear;
  const paybackMonths = grossPerYear > 0 ? Math.round((carebasePerYear / (grossPerYear / 12)) * 10) / 10 : null;

  return {
    hours,
    rate,
    tools,
    cut,
    residents,
    laborPerYear,
    toolSpendPerYear,
    grossPerYear,
    carebasePerYear,
    netPerYear,
    paybackMonths,
    monthlyPrice,
  };
}

function buildEmail(model: SavingsModel): { subject: string; text: string; html: string } {
  const subject = "Your CareBase savings model";
  const netLine = `${model.netPerYear < 0 ? "−" : ""}${money(Math.abs(model.netPerYear))} / yr`;
  const payback = model.paybackMonths === null ? "—" : `${model.paybackMonths} months`;

  const assumptions = [
    ["Weekly admin hours coordinating records", `${model.hours} hrs/wk`],
    ["Loaded hourly labor cost", `$${model.rate}/hr`],
    ["Monthly spend on tools you could retire", `$${model.tools}/mo`],
    ["Expected reduction in coordination time", `${model.cut}%`],
    ["Active residents", String(model.residents)],
  ] as const;

  const results = [
    ["Current coordination labor", `${money(model.laborPerYear)} / yr`],
    ["Replaceable tool spend", `${money(model.toolSpendPerYear)} / yr`],
    [`CareBase at your size (${money(model.monthlyPrice)}/mo)`, `${money(model.carebasePerYear)} / yr`],
    ["Gross opportunity before CareBase", `${money(model.grossPerYear)} / yr`],
    ["Net after CareBase", netLine],
    ["Modeled payback", payback],
  ] as const;

  const text = [
    "Here's the savings model you built on cmcarebase.com/savings.",
    "",
    "Your assumptions",
    ...assumptions.map(([label, value]) => `  • ${label}: ${value}`),
    "",
    "Modeled annual opportunity",
    ...results.map(([label, value]) => `  • ${label}: ${value}`),
    "",
    "This applies your chosen reduction to labor only and assumes the tool spend is fully removable.",
    "It's a planning estimate — not a quote or a guarantee — and it deliberately excludes risk",
    "avoidance (citations, penalties, turnover).",
    "",
    `Verify these numbers on your own facility during the free trial: ${SITE_URL}/signup`,
    `Revisit the calculator anytime: ${SITE_URL}/savings`,
    "",
    "— CareMetric CareBase",
  ].join("\n");

  const row = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:6px 0;color:#44566b;font-size:14px;">${label}</td>` +
    `<td style="padding:6px 0;text-align:right;font-weight:${strong ? 700 : 600};color:#0d2742;font-size:14px;white-space:nowrap;">${value}</td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f6f8fa;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dfe6ee;border-radius:14px;overflow:hidden;">
    <div style="background:#0d2742;padding:20px 24px;color:#ffffff;">
      <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8ec8ff;">CareMetric CareBase</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">Your savings model</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;color:#33465c;font-size:14px;line-height:1.6;">Here's the model you built on <a href="${SITE_URL}/savings" style="color:#1b6fc2;">cmcarebase.com/savings</a>.</p>
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1b6fc2;margin-bottom:6px;">Your assumptions</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">${assumptions.map(([l, v]) => row(l, v)).join("")}</table>
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1b6fc2;margin-bottom:6px;">Modeled annual opportunity</div>
      <table style="width:100%;border-collapse:collapse;">
        ${row("Current coordination labor", `${money(model.laborPerYear)} / yr`)}
        ${row("Replaceable tool spend", `${money(model.toolSpendPerYear)} / yr`)}
        ${row(`CareBase at your size (${money(model.monthlyPrice)}/mo)`, `${money(model.carebasePerYear)} / yr`)}
        <tr><td colspan="2" style="border-top:1px solid #eef2f6;padding-top:8px;"></td></tr>
        ${row("Gross opportunity before CareBase", `${money(model.grossPerYear)} / yr`, true)}
        ${row("Net after CareBase", netLine, true)}
        ${row("Modeled payback", payback, true)}
      </table>
      <p style="margin:20px 0 0;color:#5d7084;font-size:12px;line-height:1.6;">Applies your chosen reduction to labor only and assumes the tool spend is fully removable. A planning estimate — not a quote or a guarantee — with risk avoidance (citations, penalties, turnover) deliberately excluded.</p>
      <div style="margin-top:24px;">
        <a href="${SITE_URL}/signup" style="display:inline-block;background:#1b6fc2;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:9px;">Verify these numbers in your trial</a>
      </div>
    </div>
  </div>
</body></html>`;

  return { subject, text, html };
}

async function sendViaSendGrid(to: string, subject: string, text: string, html: string): Promise<void> {
  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) {
    throw new HttpError(500, "email_not_configured", "Email delivery is not configured for this deployment", "SENDGRID_API_KEY is not set");
  }

  const from = parseFromAddress(
    Deno.env.get("NOTIFICATION_FROM_EMAIL") || "CareMetric CareBase <notifications@cmcarebase.com>",
  );

  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from,
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
    }),
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const detail =
      Array.isArray(data?.errors) && typeof data.errors[0]?.message === "string"
        ? data.errors[0].message
        : `SendGrid API returned ${resp.status}`;
    throw new HttpError(502, "email_send_failed", "We couldn't send the email. Please try again later.", detail);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: {
    email?: string;
    hours?: number | string;
    rate?: number | string;
    tools?: number | string;
    cut?: number | string;
    residents?: number | string;
    turnstile_token?: string;
  };
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    return json({ error: "Invalid JSON body" }, 400);
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || email.length < 3 || email.length > 320 || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "Enter a valid email address" }, 400);
  }
  if (body.residents === undefined || body.residents === null) {
    // A payload with every other field but no `residents` is a stale cached client still sending
    // the pre-rename `fac` field (the PWA can cache the /savings route script for up to 7 days).
    // Reject rather than silently defaulting, so the emailed worksheet can never diverge from what
    // the visitor's on-screen calculator actually showed them.
    return json({ ok: false, error: "Your page is out of date. Refresh and try again." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);

  const ip = clientIp(req);
  // Pepper the IP hash with a secret so it can't be reversed by enumeration, falling back to the
  // service-role key (also secret) -- never a non-secret literal. Same pattern as request-demo.
  const pepper = Deno.env.get("DEMO_RATE_LIMIT_PEPPER") ?? serviceRoleKey;
  const ipHash = await sha256Hex(`ip:${ip}:${pepper}`);

  try {
    await verifyTurnstile(body.turnstile_token, ip);

    // Durable, cross-instance per-IP hourly cap -- counts recent rows by hashed IP, the same
    // approach request-demo uses for its public intake.
    const maxPerHour = parsePositiveInteger(Deno.env.get("SAVINGS_MAX_IP_REQUESTS_PER_HOUR"), 5);
    const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await adminClient
      .from("savings_model_requests")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", windowStart);
    if (countError) {
      throw new HttpError(500, "rate_limit_unavailable", "Email delivery is temporarily unavailable. Please try again later.", countError.message);
    }
    if ((count ?? 0) >= maxPerHour) {
      throw new HttpError(429, "rate_limited", "Too many requests. Please try again later.");
    }

    // Global hourly send ceiling (all callers combined, same rows/window as the per-IP cap but
    // with no IP filter). Per-IP caps alone are a weak backstop for an endpoint that emails
    // arbitrary addresses -- forged forwarding headers or a botnet turn "5/hour/IP" into
    // unbounded sends. This is the non-IP circuit breaker: past the ceiling, no more mail
    // leaves this function until the window rolls over.
    const globalMaxPerHour = parsePositiveInteger(Deno.env.get("SAVINGS_GLOBAL_MAX_SENDS_PER_HOUR"), 50);
    const { count: globalCount, error: globalCountError } = await adminClient
      .from("savings_model_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", windowStart);
    if (globalCountError) {
      throw new HttpError(500, "rate_limit_unavailable", "Email delivery is temporarily unavailable. Please try again later.", globalCountError.message);
    }
    if ((globalCount ?? 0) >= globalMaxPerHour) {
      console.warn(`email-savings-model global hourly send ceiling reached (${globalMaxPerHour}/hour)`);
      throw new HttpError(429, "rate_limited", "Too many requests. Please try again later.");
    }

    const model = computeModel(body);

    // Persist the lead (and rate-limit record) before sending, so a failed delivery still counts
    // against the cap and the sales team keeps the lead.
    const { error: insertError } = await adminClient.from("savings_model_requests").insert({
      email,
      weekly_admin_hours: model.hours,
      loaded_hourly_rate: model.rate,
      monthly_tool_spend: model.tools,
      expected_reduction_percent: model.cut,
      resident_count: model.residents,
      gross_opportunity: Math.round(model.grossPerYear),
      net_after_carebase: Math.round(model.netPerYear),
      ip_hash: ipHash,
    });
    if (insertError) {
      throw new HttpError(500, "lead_insert_failed", "We couldn't process your request. Please try again later.", insertError.message);
    }

    const { subject, text, html } = buildEmail(model);
    await sendViaSendGrid(email, subject, text, html);

    return json({ ok: true });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const isHttpError = error instanceof HttpError;
    const message = isHttpError ? (error as HttpError).message : "An unexpected error occurred. Please try again.";
    const internalDetail = isHttpError ? (error as HttpError).internalDetail : undefined;
    if (!isHttpError || status >= 500 || internalDetail) {
      console.error(isHttpError ? "email-savings-model HttpError:" : "Unexpected email-savings-model error:", error, internalDetail ?? "");
    }
    return json({ ok: false, error: message }, status);
  }
});
