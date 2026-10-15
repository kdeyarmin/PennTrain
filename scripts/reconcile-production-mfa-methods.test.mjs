import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_MFA_SWITCHES, PROJECT_REF, reconcileProductionMfaMethods, runProductionMfaMethodsRepair } from "./reconcile-production-mfa-methods.mjs";

const token = "access-token-DO-NOT-LOG";
const secret = "provider-secret-DO-NOT-LOG";
const base = { projectRef: PROJECT_REF, token };
const AUTH = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;
const QUERY = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const fixture = () => ({
  smtp_pass: secret, sms_twilio_auth_token: secret, site_url: "https://cmcarebase.com", password_hibp_enabled: true,
  mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true,
  mfa_phone_enroll_enabled: false, mfa_phone_verify_enabled: false,
  mfa_web_authn_enroll_enabled: false, mfa_web_authn_verify_enabled: false, mfa_max_enrolled_factors: 10,
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function harness(initial = fixture(), verified = 0) {
  let state = structuredClone(initial);
  const calls = [];
  return { calls, state: () => state, fetcher: async (url, options) => {
    calls.push({ url, ...options });
    if (url === QUERY) return json([{ verified }]);
    if (options.method === "PATCH") state = { ...state, ...JSON.parse(options.body) };
    return json(state);
  } };
}
function noSecrets(value) {
  for (const sentinel of [token, secret]) assert.equal(JSON.stringify(value).includes(sentinel), false);
}

test("observation reports enabled native methods without a write", async () => {
  const h = harness();
  const report = await reconcileProductionMfaMethods({ ...base, fetcher: h.fetcher });
  assert.equal(report.status, "changes_needed");
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(h.calls.map((c) => c.method), ["GET"]);
  noSecrets(report);
});

test("apply switches off exactly the six native MFA switches, reads back, and is idempotent", async () => {
  const h = harness();
  const report = await reconcileProductionMfaMethods({ ...base, apply: true, fetcher: h.fetcher });
  assert.equal(report.status, "updated");
  assert.equal(report.verified, true);
  assert.deepEqual(h.calls.map((c) => [c.url === QUERY ? "QUERY" : "AUTH", c.method]),
    [["AUTH", "GET"], ["QUERY", "POST"], ["AUTH", "GET"], ["AUTH", "PATCH"], ["AUTH", "GET"], ["QUERY", "POST"]]);
  const patch = JSON.parse(h.calls[3].body);
  assert.deepEqual(Object.keys(patch).sort(), [...NATIVE_MFA_SWITCHES].sort());
  assert.ok(Object.values(patch).every((value) => value === false));
  // Every other Auth setting, secrets included, is left exactly as it was.
  assert.deepEqual(h.state(), { ...fixture(), mfa_totp_enroll_enabled: false, mfa_totp_verify_enabled: false });
  const query = JSON.parse(h.calls[1].body);
  assert.equal(query.read_only, true);
  assert.match(query.query, /^select count\(\*\)::int as verified from auth\.mfa_factors where status = 'verified'$/);
  for (const call of h.calls) {
    assert.ok([AUTH, QUERY].includes(call.url));
    assert.equal(call.redirect, "error");
    assert.ok(call.signal instanceof AbortSignal);
  }
  const repeated = await reconcileProductionMfaMethods({ ...base, apply: true, fetcher: h.fetcher });
  assert.equal(repeated.status, "already_correct");
  assert.equal(h.calls.length, 7);
  noSecrets([report, repeated]);
});

test("refuses while anyone has a verified native factor, so nobody is locked out", async () => {
  const h = harness(fixture(), 1);
  const report = await reconcileProductionMfaMethods({ ...base, apply: true, fetcher: h.fetcher });
  assert.deepEqual([report.status, report.reason, report.mutationAttempted], ["blocked", "verified_native_factors_present", false]);
  assert.equal(h.calls.some((c) => c.method === "PATCH"), false);
  assert.equal(h.state().mfa_totp_verify_enabled, true);
});

test("incorrect project, absent token, invalid modes and dry-run writes refuse before network", async () => {
  for (const override of [{ projectRef: "other" }, { token: " " }, { apply: "true" }, { dryRun: "false" }, { dryRun: true, apply: true }]) {
    const report = await reconcileProductionMfaMethods({ ...base, ...override, fetcher: () => assert.fail("must not request") });
    assert.equal(report.status, "blocked");
    assert.equal(report.mutationAttempted, false);
  }
});

test("unknown and malformed settings or factor counts fail closed", async () => {
  for (const body of [null, [], {}, { ...fixture(), mfa_totp_verify_enabled: "false" }, { ...fixture(), mfa_web_authn_enroll_enabled: undefined }]) {
    let count = 0;
    const report = await reconcileProductionMfaMethods({ ...base, apply: true, fetcher: async () => { count++; return json(body); } });
    assert.equal(report.reason, "invalid_response");
    assert.equal(count, 1);
    assert.equal(report.mutationAttempted, false);
  }
  for (const rows of [[], [{ verified: "0" }], [{ verified: -1 }], [{}, {}], { verified: 0 }]) {
    const report = await reconcileProductionMfaMethods({ ...base, apply: true,
      fetcher: async (url) => json(url === QUERY ? rows : fixture()) });
    assert.deepEqual([report.status, report.reason, report.mutationAttempted], ["blocked", "invalid_response", false]);
  }
});

test("a native factor verified between the count and the write fails verification instead of reporting updated", async () => {
  let counts = 0;
  const h = harness();
  const report = await reconcileProductionMfaMethods({ ...base, apply: true, fetcher: async (url, options) => {
    if (url === QUERY) return json([{ verified: counts++ === 0 ? 0 : 1 }]);
    return h.fetcher(url, options);
  } });
  assert.deepEqual([report.status, report.reason, report.mutationAttempted, report.verified],
    ["verification_failed", "verified_native_factors_present", true, false]);
  assert.equal(counts, 2);
});

test("concurrent setting changes abort without an overwrite", async () => {
  let reads = 0;
  const report = await reconcileProductionMfaMethods({ ...base, apply: true, fetcher: async (url, options) => {
    assert.notEqual(options.method, "PATCH");
    if (url === QUERY) return json([{ verified: 0 }]);
    return json({ ...fixture(), mfa_phone_enroll_enabled: ++reads > 1 });
  } });
  assert.equal(report.reason, "concurrent_change");
  assert.equal(report.mutationAttempted, false);
});

test("a readback that still shows a native method enabled is a failed verification", async () => {
  const report = await reconcileProductionMfaMethods({ ...base, apply: true, fetcher: async (url, options) => {
    if (url === QUERY) return json([{ verified: 0 }]);
    if (options.method === "PATCH") return json({});
    return json(fixture());
  } });
  assert.deepEqual([report.status, report.reason, report.mutationAttempted, report.verified],
    ["verification_failed", "readback_mismatch", true, false]);
});

test("transport failures and refusals are reported without secrets", async () => {
  for (const [response, reason] of [[401, "access_denied"], [403, "access_denied"], [429, "rate_limited"], [422, "setting_unavailable"], [500, "http_error"]]) {
    const report = await reconcileProductionMfaMethods({ ...base, fetcher: async () => new Response(secret, { status: response }) });
    assert.deepEqual([report.status, report.reason], ["blocked", reason]);
    noSecrets(report);
  }
  const report = await reconcileProductionMfaMethods({ ...base, fetcher: async () => { throw new Error(secret); } });
  assert.deepEqual([report.status, report.reason], ["blocked", "network_error"]);
  noSecrets(report);
});

test("the CLI exits 0 only when verified, 2 when changes are needed, and never logs secrets", async () => {
  const lines = [];
  const log = (line) => lines.push(line);
  const env = { SUPABASE_PROJECT_ID: PROJECT_REF, SUPABASE_ACCESS_TOKEN: token };
  assert.equal(await runProductionMfaMethodsRepair({ env, args: [], fetcher: harness().fetcher, log }), 2);
  assert.equal(await runProductionMfaMethodsRepair({ env, args: ["--apply"], fetcher: harness().fetcher, log }), 0);
  assert.equal(await runProductionMfaMethodsRepair({ env: { ...env, DRY_RUN: "true" }, args: ["--apply"], fetcher: harness().fetcher, log }), 1);
  assert.equal(await runProductionMfaMethodsRepair({ env, args: ["--force"], fetcher: harness().fetcher, log }), 1);
  noSecrets(lines);
});
