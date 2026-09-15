#!/usr/bin/env node
/**
 * Enable only Supabase's existing leaked-password protection on the pinned production project.
 * https://supabase.com/docs/reference/api/v1-update-auth-service-config
 * https://supabase.com/docs/guides/auth/password-security
 * No subscription upgrade, MFA/provider change, credential rotation or user enrollment.
 * The Management API is not atomic: operators must avoid concurrent edits during this step.
 */
import { pathToFileURL } from "node:url";

export const PROJECT_REF = "xsqobvvreaovwibxwyvv";
const AUTH_ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
class ObservationError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function requestProtection({ token, fetcher, apply = false }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetcher(AUTH_ENDPOINT, {
      method: apply ? "PATCH" : "GET",
      headers: {
        Authorization: `Bearer ${token}`, Accept: "application/json",
        ...(apply ? { "Content-Type": "application/json" } : {}),
      },
      ...(apply ? { body: JSON.stringify({ password_hibp_enabled: true }) } : {}),
      redirect: "error", signal: controller.signal,
    });
    if (!response.ok) {
      throw new ObservationError(response.status === 401 || response.status === 403 ? "access_denied"
        : response.status === 429 ? "rate_limited"
        : response.status === 400 || response.status === 422 ? "setting_unavailable" : "http_error");
    }
    // PATCH returns a secret-bearing Auth DTO. Discard it; verify with a separate GET.
    if (apply) return;
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
      if (!payload || Array.isArray(payload) || typeof payload.password_hibp_enabled !== "boolean") {
        throw new ObservationError("invalid_response");
      }
      // Project only this boolean. Never return/log/spread the provider and SMTP credentials.
      return payload.password_hibp_enabled;
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

export async function reconcileProductionPasswordProtection({ projectRef, token, apply = false, dryRun = false, fetcher = fetch }) {
  let mutationAttempted = false;
  const result = (status, reason = null) => ({
    status, reason, mutationAttempted, verified: ["updated", "already_correct"].includes(status),
  });
  if (projectRef !== PROJECT_REF) return result("blocked", "wrong_project");
  if (typeof token !== "string" || !token.trim()) return result("blocked", "missing_access_token");
  if (typeof apply !== "boolean" || typeof dryRun !== "boolean") return result("blocked", "invalid_mode");
  if (apply && dryRun) return result("blocked", "dry_run_refuses_apply");
  try {
    const before = await requestProtection({ token, fetcher });
    if (before) return result("already_correct");
    if (!apply) return result("changes_needed");
    const current = await requestProtection({ token, fetcher });
    if (current !== before) return result("blocked", "concurrent_change");
    mutationAttempted = true;
    await requestProtection({ token, fetcher, apply: true });
    if (!await requestProtection({ token, fetcher })) return result("verification_failed", "readback_mismatch");
    return result("updated");
  } catch (error) {
    return result(mutationAttempted ? "verification_failed" : "blocked",
      error instanceof ObservationError ? error.code : "unexpected_error");
  }
}

export async function runProductionPasswordProtectionRepair({ env = process.env, args = [], fetcher = fetch, log = console.log } = {}) {
  if (args.some((arg) => arg !== "--apply") || args.length > 1) {
    log("Production password protection repair refused: invalid_arguments.");
    return 1;
  }
  const report = await reconcileProductionPasswordProtection({
    projectRef: env.SUPABASE_PROJECT_ID, token: env.SUPABASE_ACCESS_TOKEN,
    apply: args.includes("--apply"), dryRun: env.DRY_RUN === "true" || env.GITHUB_EVENT_NAME === "schedule", fetcher,
  });
  log(`Production password protection repair: ${JSON.stringify(report)}`);
  if (report.mutationAttempted && !report.verified) {
    log("A protection update was attempted but not verified. Inspect the current setting before retrying; no automatic rollback, retry or plan upgrade was performed.");
  }
  return report.verified ? 0 : report.status === "changes_needed" ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runProductionPasswordProtectionRepair({ args: process.argv.slice(2) });
}
