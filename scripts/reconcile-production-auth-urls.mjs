#!/usr/bin/env node
/**
 * Reconcile the two nonsecret production Auth URL fields, never provider credentials.
 * API: https://supabase.com/docs/reference/api/v1-update-auth-service-config
 * URL policy: https://supabase.com/docs/guides/auth/redirect-urls
 *
 * The existing production deploy runs this only after trusted push CI succeeds.
 * Exact project/origin, opt-in writes, no redirect removal or wildcard addition,
 * no API-origin override, and no raw response/error output. A second read catches
 * concurrent edits before PATCH; the Management API has no documented atomic CAS,
 * so operators must not edit Auth URLs during this deployment step. Never roll
 * back automatically: that could overwrite an operator's subsequent changes.
 */
import { pathToFileURL } from "node:url";

export const PROJECT_REF = "xsqobvvreaovwibxwyvv";
export const APP_ORIGIN = "https://cmcarebase.com";
export const REQUIRED_REDIRECTS = Object.freeze([APP_ORIGIN, `${APP_ORIGIN}/reset-password`]);
const AUTH_ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

class ObservationError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Drop every other field before anything can reach a result or log. The full DTO
// includes provider, SMTP and hook secrets; it must never be spread into a PATCH.
function projectUrls(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)
      || typeof payload.site_url !== "string" || typeof payload.uri_allow_list !== "string") {
    throw new ObservationError("invalid_response");
  }
  return { siteUrl: payload.site_url, redirects: payload.uri_allow_list };
}

async function requestUrls({ token, fetcher, patch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetcher(AUTH_ENDPOINT, {
      method: patch ? "PATCH" : "GET",
      headers: {
        Authorization: `Bearer ${token}`, Accept: "application/json",
        ...(patch ? { "Content-Type": "application/json" } : {}),
      },
      ...(patch ? { body: JSON.stringify(patch) } : {}),
      redirect: "error", signal: controller.signal,
    });
    if (!response.ok) {
      throw new ObservationError(response.status === 401 || response.status === 403 ? "access_denied"
        : response.status === 429 ? "rate_limited" : "http_error");
    }
    // PATCH responses can themselves contain the full secret-bearing Auth DTO.
    // Discard it; an independent bounded GET is the only verification evidence.
    if (patch) return;
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
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks, length).toString("utf8")); }
      catch { throw new ObservationError("invalid_response"); }
      return projectUrls(payload);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof ObservationError) throw error;
    throw new ObservationError(controller.signal.aborted ? "request_timeout" : "network_error");
  } finally {
    clearTimeout(timer);
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}

function desiredPatch(urls) {
  const patch = {};
  if (![APP_ORIGIN, `${APP_ORIGIN}/`].includes(urls.siteUrl)) patch.site_url = APP_ORIGIN;
  const entries = urls.redirects.split(",").map((entry) => entry.trim());
  const missing = REQUIRED_REDIRECTS.filter((url) => !entries.includes(url));
  if (missing.length) {
    // Preserve the existing allowlist byte-for-byte; append only two exact URLs.
    patch.uri_allow_list = `${urls.redirects}${urls.redirects.trim() ? "," : ""}${missing.join(",")}`;
  }
  return patch;
}

export async function reconcileProductionAuthUrls({ projectRef, token, apply = false, dryRun = false, fetcher = fetch }) {
  let mutationAttempted = false;
  let fields = [];
  const result = (status, reason = null) => ({ status, reason, fields, mutationAttempted, verified: ["updated", "already_correct"].includes(status) });
  if (projectRef !== PROJECT_REF) return result("blocked", "wrong_project");
  if (typeof token !== "string" || !token.trim()) return result("blocked", "missing_access_token");
  if (typeof apply !== "boolean" || typeof dryRun !== "boolean") return result("blocked", "invalid_mode");
  if (apply && dryRun) return result("blocked", "dry_run_refuses_apply");
  try {
    const before = await requestUrls({ token, fetcher });
    const patch = desiredPatch(before);
    fields = Object.keys(patch);
    if (!fields.length) return result("already_correct");
    if (!apply) return result("changes_needed");
    const current = await requestUrls({ token, fetcher });
    if (current.siteUrl !== before.siteUrl || current.redirects !== before.redirects) {
      return result("blocked", "concurrent_change");
    }
    mutationAttempted = true;
    await requestUrls({ token, fetcher, patch });
    const after = await requestUrls({ token, fetcher });
    if (after.siteUrl !== (patch.site_url ?? before.siteUrl)
        || after.redirects !== (patch.uri_allow_list ?? before.redirects)) {
      return result("verification_failed", "readback_mismatch");
    }
    return result("updated");
  } catch (error) {
    // No raw exception text, URLs, arbitrary DTO fields or secret values escape.
    return result(mutationAttempted ? "verification_failed" : "blocked",
      error instanceof ObservationError ? error.code : "unexpected_error");
  }
}

export async function runProductionAuthUrlRepair({ env = process.env, args = [], fetcher = fetch, log = console.log } = {}) {
  if (args.some((arg) => arg !== "--apply") || args.length > 1) {
    log("Production Auth URL repair refused: invalid_arguments.");
    return 1;
  }
  const report = await reconcileProductionAuthUrls({
    projectRef: env.SUPABASE_PROJECT_ID, token: env.SUPABASE_ACCESS_TOKEN,
    apply: args.includes("--apply"), dryRun: env.DRY_RUN === "true" || env.GITHUB_EVENT_NAME === "schedule", fetcher,
  });
  log(`Production Auth URL repair: ${JSON.stringify(report)}`);
  if (report.mutationAttempted && !report.verified) {
    log("A URL update was attempted but not verified. Inspect current Auth URL settings before retrying; no automatic rollback or retry was performed.");
  }
  return report.verified ? 0 : report.status === "changes_needed" ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runProductionAuthUrlRepair({ args: process.argv.slice(2) });
}
