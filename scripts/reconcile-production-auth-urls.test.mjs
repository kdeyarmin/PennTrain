import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { APP_ORIGIN, PROJECT_REF, REQUIRED_REDIRECTS, reconcileProductionAuthUrls, runProductionAuthUrlRepair } from "./reconcile-production-auth-urls.mjs";

const token = "access-token-DO-NOT-LOG";
const secret = "private-auth-secret-DO-NOT-LOG";
const base = { projectRef: PROJECT_REF, token };
const fixture = () => ({
  site_url: "http://localhost:3000", uri_allow_list: "https://existing.example/callback,carebase://callback",
  hook_send_email_enabled: true, hook_send_email_secrets: secret, smtp_pass: secret,
  mfa_phone_enroll_enabled: false, mfa_phone_verify_enabled: false, password_hibp_enabled: false,
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function harness(initial = fixture()) {
  let state = structuredClone(initial);
  const calls = [];
  return {
    calls, state: () => state,
    fetcher: async (url, options) => {
      calls.push({ url, ...options });
      if (options.method === "PATCH") state = { ...state, ...JSON.parse(options.body) };
      return json(state);
    },
  };
}
function noSecrets(value) {
  const output = JSON.stringify(value);
  for (const sentinel of [token, secret, "https://existing.example/callback", "carebase://callback"]) {
    assert.equal(output.includes(sentinel), false, "Private value escaped output");
  }
}

test("default mode reports drift with one GET and never mutates", async () => {
  const h = harness();
  const report = await reconcileProductionAuthUrls({ ...base, fetcher: h.fetcher });
  assert.equal(report.status, "changes_needed");
  assert.equal(report.mutationAttempted, false);
  assert.deepEqual(report.fields, ["site_url", "uri_allow_list"]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, "GET");
  noSecrets(report);
});

test("apply patches only two URL keys and independently verifies, preserving all other settings", async () => {
  const initial = fixture();
  const h = harness(initial);
  const report = await reconcileProductionAuthUrls({ ...base, apply: true, fetcher: h.fetcher });
  assert.equal(report.status, "updated");
  assert.equal(report.verified, true);
  assert.deepEqual(h.calls.map((call) => call.method), ["GET", "GET", "PATCH", "GET"]);
  const patch = JSON.parse(h.calls[2].body);
  assert.deepEqual(patch, { site_url: APP_ORIGIN, uri_allow_list: `${initial.uri_allow_list},${REQUIRED_REDIRECTS.join(",")}` });
  for (const [key, value] of Object.entries(initial)) {
    if (!Object.hasOwn(patch, key)) assert.deepEqual(h.state()[key], value);
  }
  for (const call of h.calls) {
    assert.equal(call.url, `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`);
    assert.equal(call.redirect, "error");
    assert.equal(call.headers.Authorization, `Bearer ${token}`);
    assert.ok(call.signal instanceof AbortSignal);
    if (call.method === "GET") assert.equal(call.body, undefined);
  }
  noSecrets(report);
});

test("repeat execution is idempotent and accepts a canonical trailing slash", async () => {
  for (const site_url of [APP_ORIGIN, `${APP_ORIGIN}/`]) {
    const h = harness({ ...fixture(), site_url, uri_allow_list: REQUIRED_REDIRECTS.join(", ") });
    const report = await reconcileProductionAuthUrls({ ...base, apply: true, fetcher: h.fetcher });
    assert.equal(report.status, "already_correct");
    assert.equal(h.calls.length, 1);
    assert.equal(report.mutationAttempted, false);
  }
});

test("preserves raw redirect bytes, order, wildcards, duplicates and native schemes", async () => {
  for (const raw of ["", "  ", "carebase://callback,", " https://existing.example/** , carebase://callback, carebase://callback ", APP_ORIGIN]) {
    const h = harness({ ...fixture(), uri_allow_list: raw });
    const report = await reconcileProductionAuthUrls({ ...base, apply: true, fetcher: h.fetcher });
    assert.equal(report.status, "updated");
    assert.ok(h.state().uri_allow_list.startsWith(raw));
    const expectedMissing = REQUIRED_REDIRECTS.filter((url) => !raw.split(",").map((s) => s.trim()).includes(url));
    assert.equal(h.state().uri_allow_list, `${raw}${raw.trim() ? "," : ""}${expectedMissing.join(",")}`);
    assert.equal(h.state().uri_allow_list.replace(raw, "").includes("*"), false);
  }
});

test("a correct site or redirect list is omitted from PATCH", async () => {
  for (const initial of [
    { ...fixture(), site_url: APP_ORIGIN },
    { ...fixture(), uri_allow_list: REQUIRED_REDIRECTS.join(",") },
  ]) {
    const h = harness(initial);
    await reconcileProductionAuthUrls({ ...base, apply: true, fetcher: h.fetcher });
    assert.deepEqual(Object.keys(JSON.parse(h.calls[2].body)), initial.site_url === APP_ORIGIN ? ["uri_allow_list"] : ["site_url"]);
  }
});

test("wrong project, missing token, invalid mode and dry-run apply refuse before network", async () => {
  for (const override of [
    { projectRef: "a".repeat(20) }, { projectRef: undefined }, { token: " " },
    { apply: "true" }, { dryRun: "false" }, { apply: true, dryRun: true },
  ]) {
    const report = await reconcileProductionAuthUrls({ ...base, ...override, fetcher: () => assert.fail("must not request") });
    assert.equal(report.status, "blocked");
    assert.equal(report.mutationAttempted, false);
    noSecrets(report);
  }
});

test("unknown or malformed URL settings fail closed with no PATCH", async () => {
  for (const body of [null, [], {}, { site_url: null, uri_allow_list: "" }, { site_url: APP_ORIGIN, uri_allow_list: [] }, { site_url: APP_ORIGIN, uri_allow_list: null }]) {
    let count = 0;
    const report = await reconcileProductionAuthUrls({ ...base, apply: true, fetcher: async () => { count++; return json(body); } });
    assert.equal(report.reason, "invalid_response");
    assert.equal(count, 1);
    assert.equal(report.mutationAttempted, false);
  }
});

test("a concurrent URL edit between the two GETs aborts without overwriting it", async () => {
  for (const changed of [{ site_url: "https://changed.example" }, { uri_allow_list: "carebase://new-callback" }]) {
    let count = 0;
    const report = await reconcileProductionAuthUrls({ ...base, apply: true, fetcher: async (_url, options) => {
      assert.equal(options.method, "GET");
      return json(++count === 1 ? fixture() : { ...fixture(), ...changed });
    } });
    assert.equal(report.reason, "concurrent_change");
    assert.equal(report.mutationAttempted, false);
    assert.equal(count, 2);
  }
});

test("non-URL concurrent settings are not sent back in PATCH", async () => {
  const h = harness();
  let count = 0;
  const report = await reconcileProductionAuthUrls({ ...base, apply: true, fetcher: async (url, options) => {
    const response = await h.fetcher(url, options);
    if (++count === 2) return json({ ...h.state(), smtp_pass: "new-private-value" });
    return response;
  } });
  assert.equal(report.status, "updated");
  assert.deepEqual(Object.keys(JSON.parse(h.calls[2].body)), ["site_url", "uri_allow_list"]);
});

test("HTTP failures use fixed reasons and do not leak provider error bodies", async () => {
  for (const status of [401, 403, 429, 500, 302]) {
    const report = await reconcileProductionAuthUrls({ ...base, apply: true, fetcher: async () => json({ error: secret }, status) });
    assert.equal(report.reason, [401, 403].includes(status) ? "access_denied" : status === 429 ? "rate_limited" : "http_error");
    assert.equal(report.mutationAttempted, false);
    noSecrets(report);
  }
});

test("malformed JSON, oversized streams and raw thrown errors remain private", async () => {
  for (const [fetcher, reason] of [
    [async () => new Response(secret), "invalid_response"],
    [async () => new Response("x".repeat(2 * 1024 * 1024 + 1)), "response_too_large"],
    [async () => { throw new Error(secret); }, "network_error"],
  ]) {
    const report = await reconcileProductionAuthUrls({ ...base, apply: true, fetcher });
    assert.equal(report.reason, reason);
    noSecrets(report);
  }
});

test("an ambiguous PATCH failure is never retried or falsely marked verified", async () => {
  for (const failedPatch of [async () => { throw new Error(secret); }, async () => json({ error: secret }, 500)]) {
    let count = 0;
    const report = await reconcileProductionAuthUrls({ ...base, apply: true, fetcher: async (_url, options) => {
      count++;
      return options.method === "PATCH" ? failedPatch() : json(fixture());
    } });
    assert.equal(count, 3);
    assert.equal(report.status, "verification_failed");
    assert.equal(report.mutationAttempted, true);
    assert.equal(report.verified, false);
    noSecrets(report);
  }
});

test("the request deadline aborts stalled headers without leaking the raw error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = reconcileProductionAuthUrls({ ...base, apply: true, fetcher: async (_url, { signal }) =>
    new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error(secret)), { once: true })) });
  t.mock.timers.tick(15_000);
  const report = await pending;
  assert.equal(report.reason, "request_timeout");
  assert.equal(report.mutationAttempted, false);
  noSecrets(report);
});

test("the request deadline also covers a stalled response body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = reconcileProductionAuthUrls({ ...base, apply: true, fetcher: async (_url, { signal }) =>
    new Response(new ReadableStream({ start(controller) {
      signal.addEventListener("abort", () => controller.error(new Error(secret)), { once: true });
    } })) });
  // Let fetch resolve and enter reader.read(), then expire that same request timer.
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(15_000);
  const report = await pending;
  assert.equal(report.reason, "request_timeout");
  assert.equal(report.mutationAttempted, false);
  noSecrets(report);
});

test("post-PATCH stale state or lost original redirects fail readback verification", async () => {
  for (const after of [fixture(), { ...fixture(), site_url: APP_ORIGIN, uri_allow_list: REQUIRED_REDIRECTS.join(",") }]) {
    let count = 0;
    const report = await reconcileProductionAuthUrls({ ...base, apply: true, fetcher: async () => json(++count === 4 ? after : fixture()) });
    assert.equal(report.reason, "readback_mismatch");
    assert.equal(report.verified, false);
    assert.equal(count, 4);
  }
});

test("PATCH response DTO is not interpreted as verification", async () => {
  const h = harness();
  const report = await reconcileProductionAuthUrls({ ...base, apply: true, fetcher: async (url, options) => {
    const response = await h.fetcher(url, options);
    return options.method === "PATCH" ? new Response(null, { status: 204 }) : response;
  } });
  assert.equal(report.status, "updated");
  assert.equal(h.calls.length, 4);
});

test("CLI never applies on schedule/dry run and rejects unknown arguments", async () => {
  for (const extra of [{ DRY_RUN: "true" }, { GITHUB_EVENT_NAME: "schedule" }]) {
    const logs = [];
    const code = await runProductionAuthUrlRepair({ env: { SUPABASE_PROJECT_ID: PROJECT_REF, SUPABASE_ACCESS_TOKEN: token, ...extra }, args: ["--apply"], fetcher: () => assert.fail("must not request"), log: (s) => logs.push(s) });
    assert.equal(code, 1);
    noSecrets(logs);
  }
  assert.equal(await runProductionAuthUrlRepair({ args: ["--unknown"], fetcher: () => assert.fail("must not request"), log: () => {} }), 1);
});

test("CLI output and exit status distinguish dry observations from verified mutations", async () => {
  for (const args of [[], ["--apply"]]) {
    const h = harness();
    const logs = [];
    const code = await runProductionAuthUrlRepair({ env: { SUPABASE_PROJECT_ID: PROJECT_REF, SUPABASE_ACCESS_TOKEN: token }, args, fetcher: h.fetcher, log: (s) => logs.push(s) });
    assert.equal(code, args.length ? 0 : 2);
    noSecrets(logs);
  }
});

test("workflow applies only after trusted CI and before publishing deployment success", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-migrations.yml", import.meta.url), "utf8");
  const step = workflow.split("      - name: Reconcile production Auth URL configuration\n")[1]?.split("\n      - name:")[0];
  assert.ok(step);
  assert.match(step, /if: env\.DRY_RUN != 'true' && github\.event_name == 'workflow_run'/);
  assert.doesNotMatch(step, /gate\.outputs\.skip/);
  assert.match(step, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(step, /run: node scripts\/reconcile-production-auth-urls\.mjs --apply/);
  assert.ok(workflow.indexOf("- name: Reconcile production Auth URL configuration") < workflow.indexOf("- name: Record that production was actually changed"));
  assert.match(workflow, /scripts\/reconcile-production-auth-urls\.mjs \\/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.scripts["check:all"].includes("scripts/reconcile-production-auth-urls.test.mjs"));
});
