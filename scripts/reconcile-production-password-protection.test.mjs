import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROJECT_REF, reconcileProductionPasswordProtection, runProductionPasswordProtectionRepair } from "./reconcile-production-password-protection.mjs";

const token = "access-token-DO-NOT-LOG";
const secret = "provider-secret-DO-NOT-LOG";
const base = { projectRef: PROJECT_REF, token };
const fixture = () => ({ password_hibp_enabled: false, smtp_pass: secret,
  hook_send_email_secrets: secret, site_url: "https://cmcarebase.com", uri_allow_list: "carebase://callback",
  mfa_phone_enroll_enabled: false, mfa_phone_verify_enabled: false, password_min_length: 8 });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function harness(initial = fixture()) {
  let state = structuredClone(initial);
  const calls = [];
  return { calls, state: () => state, fetcher: async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === "PATCH") state = { ...state, ...JSON.parse(options.body) };
    return json(state);
  } };
}
function noSecrets(value) {
  for (const sentinel of [token, secret, "carebase://callback"]) assert.equal(JSON.stringify(value).includes(sentinel), false);
}

test("observation reports disabled protection without a write", async () => {
  const h = harness();
  const report = await reconcileProductionPasswordProtection({ ...base, fetcher: h.fetcher });
  assert.equal(report.status, "changes_needed");
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(h.calls.map((c) => c.method), ["GET"]);
  noSecrets(report);
});

test("apply enables only leaked-password protection, independently reads back, and is idempotent", async () => {
  const h = harness();
  const report = await reconcileProductionPasswordProtection({ ...base, apply: true, fetcher: h.fetcher });
  assert.equal(report.status, "updated");
  assert.equal(report.verified, true);
  assert.deepEqual(h.calls.map((c) => c.method), ["GET", "GET", "PATCH", "GET"]);
  assert.deepEqual(JSON.parse(h.calls[2].body), { password_hibp_enabled: true });
  assert.deepEqual(h.state(), { ...fixture(), password_hibp_enabled: true });
  for (const call of h.calls) {
    assert.equal(call.url, `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`);
    assert.equal(call.redirect, "error");
    assert.ok(call.signal instanceof AbortSignal);
  }
  const repeated = await reconcileProductionPasswordProtection({ ...base, apply: true, fetcher: h.fetcher });
  assert.equal(repeated.status, "already_correct");
  assert.equal(h.calls.length, 5);
  noSecrets([report, repeated]);
});

test("incorrect project, absent token, invalid modes and dry-run writes refuse before network", async () => {
  for (const override of [{ projectRef: "other" }, { token: " " }, { apply: "true" }, { dryRun: "false" }, { dryRun: true, apply: true }]) {
    const report = await reconcileProductionPasswordProtection({ ...base, ...override, fetcher: () => assert.fail("must not request") });
    assert.equal(report.status, "blocked");
    assert.equal(report.mutationAttempted, false);
  }
});

test("unknown and malformed settings fail closed", async () => {
  for (const body of [null, [], {}, { password_hibp_enabled: null }, { password_hibp_enabled: "false" }]) {
    let count = 0;
    const report = await reconcileProductionPasswordProtection({ ...base, apply: true, fetcher: async () => { count++; return json(body); } });
    assert.equal(report.reason, "invalid_response");
    assert.equal(count, 1);
    assert.equal(report.mutationAttempted, false);
  }
});

test("concurrent protection changes abort without an overwrite", async () => {
  let count = 0;
  const report = await reconcileProductionPasswordProtection({ ...base, apply: true, fetcher: async (_url, options) => {
    assert.equal(options.method, "GET");
    return json({ ...fixture(), password_hibp_enabled: ++count > 1 });
  } });
  assert.equal(report.reason, "concurrent_change");
  assert.equal(count, 2);
  assert.equal(report.mutationAttempted, false);
});

test("readback mismatch cannot be counted as deployed or automatically retried", async () => {
  const calls = [];
  const report = await reconcileProductionPasswordProtection({ ...base, apply: true, fetcher: async (_url, options) => {
    calls.push(options.method);
    return json(fixture());
  } });
  assert.equal(report.status, "verification_failed");
  assert.equal(report.reason, "readback_mismatch");
  assert.equal(report.verified, false);
  assert.deepEqual(calls, ["GET", "GET", "PATCH", "GET"]);
});

test("HTTP errors and provider secrets never escape logs, with no fallback or plan upgrade", async () => {
  for (const [status, reason] of [[401, "access_denied"], [403, "access_denied"], [429, "rate_limited"], [422, "setting_unavailable"], [503, "http_error"]]) {
    const logs = [];
    let calls = 0;
    const exit = await runProductionPasswordProtectionRepair({ args: ["--apply"],
      env: { SUPABASE_PROJECT_ID: PROJECT_REF, SUPABASE_ACCESS_TOKEN: token }, log: (message) => logs.push(message),
      fetcher: async () => { calls++; return json({ error: secret }, status); },
    });
    assert.equal(exit, 1);
    assert.equal(calls, 1);
    assert.match(logs[0], new RegExp(reason));
    noSecrets(logs);
  }
});

test("oversized or invalid bodies are rejected without a PATCH", async () => {
  for (const response of [new Response("not JSON"), new Response("x".repeat(2 * 1024 * 1024 + 1)), new Response(null)]) {
    const report = await reconcileProductionPasswordProtection({ ...base, apply: true, fetcher: async () => response });
    assert.ok(["invalid_response", "response_too_large"].includes(report.reason));
    assert.equal(report.mutationAttempted, false);
  }
});

test("CLI refuses scheduled or dry-run apply and unknown arguments", async () => {
  for (const override of [{ DRY_RUN: "true" }, { GITHUB_EVENT_NAME: "schedule" }]) {
    assert.equal(await runProductionPasswordProtectionRepair({ args: ["--apply"],
      env: { SUPABASE_PROJECT_ID: PROJECT_REF, SUPABASE_ACCESS_TOKEN: token, ...override }, log: () => {},
      fetcher: () => assert.fail("must not request"),
    }), 1);
  }
  assert.equal(await runProductionPasswordProtectionRepair({ args: ["--force"], log: () => {}, fetcher: () => assert.fail("must not request") }), 1);
});

test("trusted deploy runs protection repair before recording success and CI covers it", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-migrations.yml", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(workflow, /name: Reconcile production leaked-password protection\s+if: env\.DRY_RUN != 'true' && github\.event_name == 'workflow_run'/);
  assert.ok(workflow.indexOf("run: node scripts/reconcile-production-password-protection.mjs --apply") < workflow.indexOf("- name: Stamp deployed function content digests"));
  assert.match(packageJson.scripts["check:all"], /reconcile-production-password-protection\.test\.mjs/);
});
