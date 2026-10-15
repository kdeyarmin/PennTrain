#!/usr/bin/env node
/**
 * Switch off every native Supabase MFA method on the pinned production project: authenticator
 * apps (TOTP), Supabase's own phone factor and passkeys (WebAuthn), for enrollment and
 * verification alike. CareBase verifies sessions by text message through its own sms-mfa Edge
 * Function and Twilio Verify, so no native method is needed, and the owner's rule is that no
 * authenticator app is offered anywhere.
 * https://supabase.com/docs/reference/api/v1-update-auth-service-config
 *
 * Turning verification off would lock out anyone who already relies on a native factor, so the
 * apply path first counts verified native factors through the read-only query endpoint and refuses
 * while any exist, then counts again after the write and reports any factor verified in between.
 * No user is enrolled, unenrolled, or reset here, and no other Auth setting moves.
 * The Management API is not atomic: operators must avoid concurrent edits during this step.
 */
import { pathToFileURL } from "node:url";

export const PROJECT_REF = "xsqobvvreaovwibxwyvv";
const AUTH_ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;
const QUERY_ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const NATIVE_MFA_SWITCHES = Object.freeze([
  "mfa_totp_enroll_enabled", "mfa_totp_verify_enabled",
  "mfa_phone_enroll_enabled", "mfa_phone_verify_enabled",
  "mfa_web_authn_enroll_enabled", "mfa_web_authn_verify_enabled",
]);
const DESIRED = Object.freeze(Object.fromEntries(NATIVE_MFA_SWITCHES.map((key) => [key, false])));
const VERIFIED_NATIVE_FACTORS_SQL = "select count(*)::int as verified from auth.mfa_factors where status = 'verified'";

class ObservationError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function readCapped(response) {
  if (!response.body) throw new ObservationError("invalid_response");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new ObservationError("response_too_large");
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks, length).toString("utf8")); }
    catch { throw new ObservationError("invalid_response"); }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function request({ token, fetcher, url, method, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetcher(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`, Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error", signal: controller.signal,
    });
    if (!response.ok) {
      throw new ObservationError(response.status === 401 || response.status === 403 ? "access_denied"
        : response.status === 429 ? "rate_limited"
        : response.status === 400 || response.status === 422 ? "setting_unavailable" : "http_error");
    }
    // The Auth PATCH returns a secret-bearing DTO. Discard it; verify with a separate GET.
    if (method === "PATCH") return undefined;
    return await readCapped(response);
  } catch (error) {
    if (error instanceof ObservationError) throw error;
    throw new ObservationError(controller.signal.aborted ? "request_timeout" : "network_error");
  } finally {
    clearTimeout(timer);
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}

/** Project only the six booleans. Never return, log or spread the provider and SMTP credentials. */
async function readSwitches({ token, fetcher }) {
  const payload = await request({ token, fetcher, url: AUTH_ENDPOINT, method: "GET" });
  if (!payload || Array.isArray(payload) || typeof payload !== "object") throw new ObservationError("invalid_response");
  const switches = {};
  for (const key of NATIVE_MFA_SWITCHES) {
    if (typeof payload[key] !== "boolean") throw new ObservationError("invalid_response");
    switches[key] = payload[key];
  }
  return switches;
}

async function countVerifiedNativeFactors({ token, fetcher }) {
  const rows = await request({ token, fetcher, url: QUERY_ENDPOINT, method: "POST",
    body: { query: VERIFIED_NATIVE_FACTORS_SQL, read_only: true } });
  const verified = Array.isArray(rows) && rows.length === 1 ? rows[0]?.verified : undefined;
  if (!Number.isInteger(verified) || verified < 0) throw new ObservationError("invalid_response");
  return verified;
}

const allOff = (switches) => NATIVE_MFA_SWITCHES.every((key) => switches[key] === false);
const same = (a, b) => NATIVE_MFA_SWITCHES.every((key) => a[key] === b[key]);

export async function reconcileProductionMfaMethods({ projectRef, token, apply = false, dryRun = false, fetcher = fetch }) {
  let mutationAttempted = false;
  const result = (status, reason = null) => ({
    status, reason, mutationAttempted, verified: ["updated", "already_correct"].includes(status),
  });
  if (projectRef !== PROJECT_REF) return result("blocked", "wrong_project");
  if (typeof token !== "string" || !token.trim()) return result("blocked", "missing_access_token");
  if (typeof apply !== "boolean" || typeof dryRun !== "boolean") return result("blocked", "invalid_mode");
  if (apply && dryRun) return result("blocked", "dry_run_refuses_apply");
  try {
    const before = await readSwitches({ token, fetcher });
    if (allOff(before)) return result("already_correct");
    if (!apply) return result("changes_needed");
    // Switching verification off would strand anyone who signs in with a native factor today.
    if (await countVerifiedNativeFactors({ token, fetcher }) > 0) return result("blocked", "verified_native_factors_present");
    const current = await readSwitches({ token, fetcher });
    if (!same(current, before)) return result("blocked", "concurrent_change");
    mutationAttempted = true;
    await request({ token, fetcher, url: AUTH_ENDPOINT, method: "PATCH", body: DESIRED });
    if (!allOff(await readSwitches({ token, fetcher }))) return result("verification_failed", "readback_mismatch");
    // Nothing can make the first count and the write atomic: a pending native factor could be
    // verified between them, and stopping verification first would strand that person anyway.
    // So count again once verification is off and report it, rather than claim a clean cutover.
    // That account is recovered by a platform administrator's MFA reset.
    if (await countVerifiedNativeFactors({ token, fetcher }) > 0) return result("verification_failed", "verified_native_factors_present");
    return result("updated");
  } catch (error) {
    return result(mutationAttempted ? "verification_failed" : "blocked",
      error instanceof ObservationError ? error.code : "unexpected_error");
  }
}

export async function runProductionMfaMethodsRepair({ env = process.env, args = [], fetcher = fetch, log = console.log } = {}) {
  if (args.some((arg) => arg !== "--apply") || args.length > 1) {
    log("Production MFA methods repair refused: invalid_arguments.");
    return 1;
  }
  const report = await reconcileProductionMfaMethods({
    projectRef: env.SUPABASE_PROJECT_ID, token: env.SUPABASE_ACCESS_TOKEN,
    apply: args.includes("--apply"), dryRun: env.DRY_RUN === "true" || env.GITHUB_EVENT_NAME === "schedule", fetcher,
  });
  log(`Production MFA methods repair: ${JSON.stringify(report)}`);
  if (report.mutationAttempted && !report.verified) {
    log("An MFA settings update was attempted but not verified. Inspect the current settings before retrying; no automatic rollback or retry was performed.");
  }
  return report.verified ? 0 : report.status === "changes_needed" ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runProductionMfaMethodsRepair({ args: process.argv.slice(2) });
}
