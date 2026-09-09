#!/usr/bin/env node
/**
 * Read-only production configuration evidence. This is not a delivery test or a release gate.
 * Run only from the trusted main deployment workflow with its existing access token.
 *
 * Management API DTOs, checked 2026-09-09:
 * https://supabase.com/docs/reference/api/v1-list-all-secrets
 * https://supabase.com/docs/reference/api/v1-get-auth-service-config
 * https://supabase.com/docs/guides/auth/redirect-urls
 *
 * Secret names are projected directly to this closed allowlist; values, digests, unknown
 * names, Auth config, response bodies, headers and exception messages never leave the reader.
 * In particular, an authorization failure remains unknown: no credential or endpoint fallback.
 */
import { appendFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const SECRET_NAMES = Object.freeze([
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID",
  "TWILIO_MESSAGING_SERVICE_SID", "TWILIO_FROM_NUMBER",
  "TWILIO_NOTIFICATION_STATUS_CALLBACK_URL", "TWILIO_NOTIFICATION_CONSENT_CALLBACK_URL",
  "SENDGRID_API_KEY", "NOTIFICATION_FROM_EMAIL", "SEND_EMAIL_HOOK_SECRET",
  "SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY", "NOTIFICATION_RECIPIENT_HASH_SECRET",
  "WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_SUBJECT",
  "STRIPE_SECRET_KEY", "STRIPE_BILLING_WEBHOOK_SECRET", "STRIPE_BILLING_PORTAL_CONFIGURATION_ID", "HEYGEN_API_KEY",
  "ANTHROPIC_API_KEY", "ANTHROPIC_BAA_CONFIRMED", "TURNSTILE_SECRET_KEY",
  "SIGNUP_TURNSTILE_SECRET_KEY", "CRON_SHARED_SECRET", "PUBLIC_APP_URL",
  "PUBLIC_SITE_URL", "SITE_URL", "SIGNUP_REDIRECT_ORIGINS", "BILLING_RETURN_URL_ORIGINS",
  "ALLOWED_CORS_ORIGINS",
]);

const AUTH_LABELS = Object.freeze({
  canonicalSiteUrl: "Site URL is the canonical production origin",
  explicitPasswordResetRedirect: "Explicit canonical password-reset redirect is listed",
  canonicalOriginWildcardRedirect: "Canonical origin wildcard redirect is listed",
  emailHookEnabled: "Send Email hook is enabled",
  emailHookExpectedUrl: "Send Email hook points exactly to this project's send-auth-email function",
  emailHookSigningSecretPresent: "Send Email hook signing secret is present in the Auth configuration",
  smtpHostConfigured: "Custom SMTP host is configured (DTO has no SMTP enabled field)",
  leakedPasswordProtectionEnabled: "Leaked-password protection is enabled",
  nativePhoneMfaEnrollmentEnabled: "Supabase native phone MFA enrollment is enabled",
  nativePhoneMfaVerificationEnabled: "Supabase native phone MFA verification is enabled",
});
const API_ORIGIN = "https://api.supabase.com";
const APP_ORIGIN = "https://cmcarebase.com";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const blankPresence = () => Object.fromEntries(SECRET_NAMES.map((name) => [name, null]));
const blankAuth = () => Object.fromEntries(Object.keys(AUTH_LABELS).map((name) => [name, null]));
const booleanField = (value) => typeof value === "boolean" ? value : null;
const stringPresent = (value) => typeof value === "string" ? value.trim().length > 0 : null;
const unknown = (reason) => ({ status: "unknown", reason });

function projectSecretPresence(payload) {
  if (!Array.isArray(payload) || payload.some((entry) => !isRecord(entry) || typeof entry.name !== "string")) {
    return { observation: unknown("invalid_response"), values: blankPresence() };
  }
  // Access only .name. A listed name proves presence, not a nonempty/valid secret value.
  const names = new Set(payload.map((entry) => entry.name));
  return {
    observation: { status: "observed", reason: null },
    values: Object.fromEntries(SECRET_NAMES.map((name) => [name, names.has(name)])),
  };
}

function projectAuthConfig(payload, projectRef) {
  if (!isRecord(payload)) return { observation: unknown("invalid_response"), values: blankAuth() };
  // Do not interpret arbitrary glob patterns: report known explicit/wildcard forms separately.
  // Auth may allow other forms; a false explicit match is not a claim that login is broken.
  const redirects = typeof payload.uri_allow_list === "string"
    ? payload.uri_allow_list.split(",").map((entry) => entry.trim()) : null;
  const values = {
    canonicalSiteUrl: typeof payload.site_url === "string"
      ? [APP_ORIGIN, `${APP_ORIGIN}/`].includes(payload.site_url) : null,
    explicitPasswordResetRedirect: redirects?.includes(`${APP_ORIGIN}/reset-password`) ?? null,
    canonicalOriginWildcardRedirect: redirects
      ? [`${APP_ORIGIN}/*`, `${APP_ORIGIN}/**`].some((url) => redirects.includes(url)) : null,
    emailHookEnabled: booleanField(payload.hook_send_email_enabled),
    emailHookExpectedUrl: typeof payload.hook_send_email_uri === "string"
      ? payload.hook_send_email_uri === `https://${projectRef}.supabase.co/functions/v1/send-auth-email` : null,
    emailHookSigningSecretPresent: stringPresent(payload.hook_send_email_secrets),
    smtpHostConfigured: stringPresent(payload.smtp_host),
    leakedPasswordProtectionEnabled: booleanField(payload.password_hibp_enabled),
    nativePhoneMfaEnrollmentEnabled: booleanField(payload.mfa_phone_enroll_enabled),
    nativePhoneMfaVerificationEnabled: booleanField(payload.mfa_phone_verify_enabled),
  };
  return {
    observation: Object.values(values).some((value) => value === null)
      ? { status: "partial", reason: "fields_unavailable" } : { status: "observed", reason: null },
    values,
  };
}

async function readProjectedEndpoint({ projectRef, token, endpoint, project, fetcher }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    // No API-base override, redirects, pagination links or user-selected paths are followed.
    response = await fetcher(`${API_ORIGIN}/v1/projects/${projectRef}/${endpoint}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      const reason = response.status === 401 || response.status === 403 ? "access_denied"
        : response.status === 429 ? "rate_limited" : "http_error";
      return { observation: unknown(reason) };
    }
    if (!response.body) return { observation: unknown("invalid_response") };
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) return { observation: unknown("response_too_large") };
        chunks.push(value);
      }
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
      } catch {
        return { observation: unknown("invalid_response") };
      }
      // Never return the original payload to the caller, even in partial/error cases.
      return project(payload, projectRef);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch {
    return { observation: unknown(controller.signal.aborted ? "request_timeout" : "network_error") };
  } finally {
    clearTimeout(timeout);
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}

export async function collectIntegrationReadiness({ projectRef, token, fetcher = fetch }) {
  const invalidReason = typeof projectRef !== "string" || !/^[a-z]{20}$/.test(projectRef)
    ? "invalid_project_ref" : typeof token !== "string" || !token.trim() ? "missing_access_token" : null;
  const [secrets, auth] = invalidReason ? [
    { observation: unknown(invalidReason) }, { observation: unknown(invalidReason) },
  ] : await Promise.all([
    readProjectedEndpoint({ projectRef, token, endpoint: "secrets", project: projectSecretPresence, fetcher }),
    readProjectedEndpoint({ projectRef, token, endpoint: "config/auth", project: projectAuthConfig, fetcher }),
  ]);
  const observations = { secrets: secrets.observation, auth: auth.observation };
  return {
    schemaVersion: 1,
    scope: "supabase_edge_functions_and_auth",
    reportStatus: Object.values(observations).every((entry) => entry.status === "observed") ? "complete" : "incomplete",
    observations,
    secretPresence: secrets.values ?? blankPresence(),
    authConfiguration: auth.values ?? blankAuth(),
    liveDeliveryVerified: false,
  };
}

export function renderReadinessMarkdown(report) {
  const display = (value) => value === null ? "Unknown" : value ? "Yes" : "No";
  return [
    "## Production Supabase Edge Functions and Auth configuration evidence", "",
    `Report: **${report.reportStatus}**. This read-only report does not send messages, create resources, change configuration or verify live delivery.`, "",
    "A listed secret proves only that its name exists. Optional overrides can be absent; credentials, webhook registration, matching signing keys and provider account readiness still require separate verification.", "",
    "This scope excludes Railway provider/server, frontend and voice-gateway environment variables, tenant-managed integration credentials and provider dashboards. In Railway provider mode, absent Supabase Stripe/SMS names do not establish missing Railway credentials.", "",
    "| Observation | Status | Reason |", "| --- | --- | --- |",
    ...["secrets", "auth"].map((name) => `| ${name} | ${report.observations[name].status} | ${report.observations[name].reason ?? "—"} |`), "",
    "| App environment name (allowlist only) | Present |", "| --- | --- |",
    ...SECRET_NAMES.map((name) => `| ${name} | ${display(report.secretPresence[name])} |`), "",
    "| Auth configuration check | Observed |", "| --- | --- |",
    ...Object.entries(AUTH_LABELS).map(([name, label]) => `| ${label} | ${display(report.authConfiguration[name])} |`), "",
    "Redirect rows describe only the listed forms; other patterns and the Auth Site URL policy may also permit redirects. An unavailable field remains unknown, never disabled by assumption. Native phone MFA is reported for visibility; PennTrain's Twilio SMS MFA does not require enabling it.", "",
  ].join("\n");
}

export async function runReadinessReport({ env = process.env, fetcher = fetch, write = writeFile, append = appendFile, log = console.log } = {}) {
  try {
    const report = await collectIntegrationReadiness({
      projectRef: env.SUPABASE_PROJECT_ID, token: env.SUPABASE_ACCESS_TOKEN, fetcher,
    });
    const markdown = renderReadinessMarkdown(report);
    await write("integration-readiness.json", `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await write("integration-readiness.md", markdown, { mode: 0o600 });
    if (env.GITHUB_STEP_SUMMARY) await append(env.GITHUB_STEP_SUMMARY, markdown);
    // Emit the same closed projection in job logs so operators can read the report
    // even when their artifact download client cannot materialize the ZIP.
    log(markdown);
    log(`Integration configuration report: ${report.reportStatus}. See integration-readiness artifact; live delivery remains unverified.`);
    // Observation failures are distinct from observed missing/disabled configuration. The
    // workflow tolerates this exit status so an optional report cannot stop a deployment.
    return report.reportStatus === "complete" ? 0 : 2;
  } catch {
    // This includes filesystem failures: their messages can contain sensitive paths/content.
    log("Integration configuration report could not be produced. No response or error details were logged.");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runReadinessReport();
}
