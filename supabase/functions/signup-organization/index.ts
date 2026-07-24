// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";
import { clientIp } from "../_shared/clientIp.ts";

// Public, unauthenticated signup endpoint by design (see verify_jwt:false in
// supabase/config.toml). Abuse controls live here because there is no caller session yet:
// Cloudflare Turnstile proof, hashed IP/email rate limits, a daily org-creation cap, and an
// invite email flow so the new org_admin proves mailbox control before setting a password.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_APP_ORIGIN = "https://cmcarebase.com";
const REQUIRED_SERVICE_AGREEMENT_VERSION = "CareMetric-Facility-Admin-Service-Agreement-v2026-07-14";
const REQUIRED_BAA_VERSION = "CareMetric-HIPAA-BAA-v2026-07-14";
const DEFAULT_ALLOWED_APP_ORIGINS = new Set([
  "https://cmcarebase.com",
]);

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

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "org"
  );
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function allowedRedirectOrigins(): Set<string> {
  const configured = (Deno.env.get("SIGNUP_REDIRECT_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_APP_ORIGINS, ...configured]);
}

function resolveRedirectTo(candidate: string | undefined): string {
  const fallbackOrigin = (Deno.env.get("PUBLIC_APP_URL") ?? DEFAULT_APP_ORIGIN).replace(/\/+$/, "");
  const fallback = `${fallbackOrigin}/reset-password`;
  if (!candidate) return fallback;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new HttpError(400, "invalid_redirect", "Invalid signup redirect URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new HttpError(400, "invalid_redirect", "Invalid signup redirect URL");
  }
  if (!url.pathname.endsWith("/reset-password")) {
    throw new HttpError(400, "invalid_redirect", "Signup redirects must land on /reset-password");
  }
  const allowLocalhostRedirects = Deno.env.get("ALLOW_LOCALHOST_SIGNUP_REDIRECTS") === "true";
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    if (allowLocalhostRedirects) return url.toString();
    throw new HttpError(400, "invalid_redirect", "Localhost signup redirects are disabled");
  }
  if (!allowedRedirectOrigins().has(url.origin)) {
    throw new HttpError(400, "invalid_redirect", "Signup redirect origin is not allowed");
  }

  return url.toString();
}

async function verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? Deno.env.get("SIGNUP_TURNSTILE_SECRET_KEY");
  if (!secret) {
    throw new HttpError(500, "turnstile_not_configured", "Signup verification is not configured");
  }
  if (!token) {
    throw new HttpError(400, "turnstile_required", "Signup verification is required");
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
    throw new HttpError(400, "turnstile_failed", "Signup verification failed. Refresh and try again.");
  }
}

async function finalizeAttempt(
  adminClient: ReturnType<typeof createClient>,
  attemptId: string,
  success: boolean,
  errorCode: string | null,
) {
  const { error } = await adminClient.rpc("finalize_signup_attempt", {
    p_attempt_id: attemptId,
    p_success: success,
    p_error_code: errorCode,
  });
  if (error) console.error("Failed to finalize signup attempt:", error.message);
}

async function reserveAttempt(
  adminClient: ReturnType<typeof createClient>,
  emailHash: string,
  ipHash: string,
  legalAccepted: boolean,
  serviceAgreementVersion: string,
  baaVersion: string,
): Promise<string> {
  const maxIpAttemptsPerHour = parsePositiveInteger(Deno.env.get("SIGNUP_MAX_IP_ATTEMPTS_PER_HOUR"), 5);
  const maxEmailAttemptsPerDay = parsePositiveInteger(Deno.env.get("SIGNUP_MAX_EMAIL_ATTEMPTS_PER_DAY"), 3);
  const maxOrganizationsPerDay = parsePositiveInteger(Deno.env.get("SIGNUP_MAX_ORGANIZATIONS_PER_DAY"), 25);
  const { data, error } = await adminClient.rpc("reserve_signup_attempt", {
    p_email_hash: emailHash,
    p_ip_hash: ipHash,
    p_max_ip_per_hour: maxIpAttemptsPerHour,
    p_max_email_per_day: maxEmailAttemptsPerDay,
    p_max_orgs_per_day: maxOrganizationsPerDay,
    p_legal_accepted: legalAccepted,
    p_service_agreement_version: serviceAgreementVersion,
    p_baa_version: baaVersion,
  });
  if (!error && typeof data === "string") return data;
  if (error?.message.includes("signup_organization_quota_reached")) {
    throw new HttpError(429, "signup_quota_reached", "Self-service signup is temporarily unavailable.");
  }
  if (error?.message.includes("signup_ip_rate_limited") || error?.message.includes("signup_email_rate_limited")) {
    throw new HttpError(429, "rate_limited", "Too many signup attempts. Please try again later.");
  }
  throw new HttpError(500, "rate_limit_unavailable", "Signup is temporarily unavailable. Please try again later.", error?.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: {
    email?: string;
    first_name?: string;
    last_name?: string;
    organization_name?: string;
    legal_accepted?: boolean;
    turnstile_token?: string;
    redirect_to?: string;
    service_agreement_version?: string;
    baa_version?: string;
  };
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    return json({ error: "Invalid JSON body" }, 400);
  }

  const email = body.email?.trim().toLowerCase();
  const firstName = body.first_name?.trim();
  const lastName = body.last_name?.trim();
  const organizationName = body.organization_name?.trim();
  const legalAccepted = body.legal_accepted === true;
  const serviceAgreementVersion = body.service_agreement_version?.trim();
  const baaVersion = body.baa_version?.trim();

  if (!email || !firstName || !lastName || !organizationName) {
    return json({ error: "email, first_name, last_name, and organization_name are required" }, 400);
  }
  if (!legalAccepted) {
    return json({ error: "legal_accepted must be true" }, 400);
  }
  if (!serviceAgreementVersion || !baaVersion) {
    return json({ error: "service_agreement_version and baa_version are required" }, 400);
  }
  if (serviceAgreementVersion !== REQUIRED_SERVICE_AGREEMENT_VERSION || baaVersion !== REQUIRED_BAA_VERSION) {
    return json({ error: "Legal agreement versions must match the current signup terms" }, 400);
  }
  if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address" }, 400);
  if (organizationName.length < 2) return json({ error: "organization_name is too short" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);
  const ip = clientIp(req);
  const hashPepper = Deno.env.get("SIGNUP_RATE_LIMIT_PEPPER") ?? serviceRoleKey;
  const emailHash = await sha256Hex(`email:${email}:${hashPepper}`);
  const ipHash = await sha256Hex(`ip:${ip}:${hashPepper}`);

  let organizationId: string | null = null;
  let invitedUserId: string | null = null;
  let attemptId: string | null = null;

  try {
    await verifyTurnstile(body.turnstile_token, ip);
    attemptId = await reserveAttempt(
      adminClient, emailHash, ipHash, legalAccepted, serviceAgreementVersion, baaVersion,
    );

    const { data: signupSetting, error: signupSettingError } = await adminClient
      .from("platform_settings")
      .select("value")
      .eq("key", "signup_enabled")
      .maybeSingle();
    if (signupSettingError) throw new HttpError(500, "settings_unavailable", "Signup is temporarily unavailable. Please try again later.", signupSettingError.message);
    const signupEnabled = signupSetting?.value !== false;
    if (!signupEnabled) {
      throw new HttpError(403, "signup_disabled", "Self-service signup is currently disabled. Please contact us directly.");
    }

    const { data: trialDaysSetting, error: trialDaysError } = await adminClient
      .from("platform_settings")
      .select("value")
      .eq("key", "default_trial_days")
      .maybeSingle();
    if (trialDaysError) throw new HttpError(500, "settings_unavailable", "Signup is temporarily unavailable. Please try again later.", trialDaysError.message);
    const trialDays = typeof trialDaysSetting?.value === "number" ? trialDaysSetting.value : 30;
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

    const redirectTo = resolveRedirectTo(body.redirect_to);
    const baseSlug = slugify(organizationName);
    let organization: { id: string; name: string } | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? baseSlug : `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
      // PT-019: record_organization_signup creates the organization AND stamps the
      // accepted BAA version/timestamp onto it in one statement, so the per-org AI
      // gate (org_ai_allowed) passes for self-service signups from day one. A slug
      // collision surfaces as SQLSTATE 23505, preserving the retry loop.
      const { data: newOrgId, error } = await adminClient.rpc("record_organization_signup", {
        p_name: organizationName,
        p_slug: slug,
        p_trial_ends_at: trialEndsAt,
        p_baa_version: baaVersion,
      });
      if (!error && typeof newOrgId === "string") {
        organization = { id: newOrgId, name: organizationName };
        organizationId = newOrgId;
        break;
      }
      if (error?.code !== "23505") throw new HttpError(400, "organization_create_failed", "We could not create your organization. Please check your details and try again.", error?.message);
    }
    if (!organization) {
      throw new HttpError(500, "organization_slug_failed", "Could not allocate a unique organization slug -- try again");
    }

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { first_name: firstName, last_name: lastName },
      redirectTo,
    });
    if (inviteError) throw new HttpError(400, "invite_failed", "We could not send an invitation to that email address. If you already have an account, sign in or reset your password instead.", inviteError.message);
    invitedUserId = invited.user.id;

    const { error: rpcError } = await adminClient.rpc("admin_update_profile", {
      p_user_id: invited.user.id,
      p_first_name: firstName,
      p_last_name: lastName,
      p_role: "org_admin",
      p_organization_id: organization.id,
      p_is_active: true,
      p_email: email,
    });
    if (rpcError) throw new HttpError(500, "profile_update_failed", "Signup could not be completed. Please try again later.", rpcError.message);

    await finalizeAttempt(adminClient, attemptId, true, null);
    return json({
      success: true,
      requiresEmailVerification: true,
      user: { id: invited.user.id, email: invited.user.email },
      organization: { id: organization.id, name: organization.name },
    });
  } catch (error) {
    if (invitedUserId) {
      await adminClient.auth.admin.deleteUser(invitedUserId).catch((deleteError: unknown) => {
        console.error("Failed to clean up invited signup user:", deleteError);
      });
    }
    if (organizationId) {
      await adminClient.from("organizations").delete().eq("id", organizationId);
    }

    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : "unexpected_error";
    // For HttpError, the message is intentionally user-facing. For unexpected errors, return a
    // generic message to avoid leaking internal details or stack traces to the caller.
const isHttpError = error instanceof HttpError;
const message = isHttpError ? (error as HttpError).message : "An unexpected error occurred. Please try again.";
const internalDetail = isHttpError ? (error as HttpError).internalDetail : undefined;
if (!isHttpError || status >= 500 || internalDetail) console.error(isHttpError ? "Signup HttpError:" : "Unexpected signup error:", error, internalDetail ?? "");
    if (attemptId) await finalizeAttempt(adminClient, attemptId, false, code);
    return json({ success: false, error: message }, status);
  }
});
