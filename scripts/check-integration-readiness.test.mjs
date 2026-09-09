import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { collectIntegrationReadiness, renderReadinessMarkdown, runReadinessReport, SECRET_NAMES } from "./check-integration-readiness.mjs";

const projectRef = "xsqobvvreaovwibxwyvv";
const token = "test-access-token-DO-NOT-PRINT";
const sentinels = [token, "secret-value-DO-NOT-PRINT", "digest-DO-NOT-PRINT", "UNKNOWN_SECRET_NAME_DO_NOT_PRINT", "auth-private-DO-NOT-PRINT"];
const authFixture = () => ({
  site_url: "https://cmcarebase.com",
  uri_allow_list: "https://cmcarebase.com/reset-password, https://cmcarebase.com/**",
  hook_send_email_enabled: true,
  hook_send_email_uri: `https://${projectRef}.supabase.co/functions/v1/send-auth-email`,
  hook_send_email_secrets: sentinels[4],
  smtp_host: "smtp.private.example",
  smtp_pass: sentinels[1],
  password_hibp_enabled: true,
  mfa_phone_enroll_enabled: false,
  mfa_phone_verify_enabled: false,
  external_google_secret: sentinels[4],
  unknown_config: { sensitive: sentinels[4] },
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const secretFixture = () => [
  { name: "TWILIO_ACCOUNT_SID", value: sentinels[1], digest: sentinels[2] },
  { name: "TWILIO_AUTH_TOKEN", value: sentinels[1] },
  { name: "STRIPE_BILLING_PORTAL_CONFIGURATION_ID", value: sentinels[1] },
  { name: sentinels[3], value: sentinels[1] },
];
const fetchFixture = (secrets = secretFixture(), auth = authFixture()) => async (url) =>
  json(url.endsWith("/secrets") ? secrets : auth);

function assertPrivate(value) {
  const output = typeof value === "string" ? value : JSON.stringify(value);
  for (const sentinel of sentinels) assert.equal(output.includes(sentinel), false, "Sensitive sentinel escaped the projection");
  assert.equal(output.includes("smtp.private.example"), false);
}

test("projects only allowlisted presence and Auth booleans from realistic secret-bearing DTOs", async () => {
  const report = await collectIntegrationReadiness({ projectRef, token, fetcher: fetchFixture() });
  assert.equal(report.reportStatus, "complete");
  assert.deepEqual(Object.keys(report.secretPresence), SECRET_NAMES);
  assert.equal(report.secretPresence.TWILIO_ACCOUNT_SID, true);
  assert.equal(report.secretPresence.TWILIO_AUTH_TOKEN, true);
  assert.equal(report.secretPresence.TWILIO_VERIFY_SERVICE_SID, false);
  assert.equal(report.secretPresence.STRIPE_BILLING_PORTAL_CONFIGURATION_ID, true);
  assert.equal(report.authConfiguration.emailHookSigningSecretPresent, true);
  assert.equal(report.authConfiguration.nativePhoneMfaEnrollmentEnabled, false);
  assert.equal(report.authConfiguration.leakedPasswordProtectionEnabled, true);
  assert.equal(report.liveDeliveryVerified, false);
  assert.equal(Object.values(report.secretPresence).every((value) => typeof value === "boolean"), true);
  assertPrivate(report);
  assertPrivate(renderReadinessMarkdown(report));
});

test("never accesses secret values or digests while projecting names", async () => {
  // JSON.stringify normally reads these properties; use the actual wire fixture with sentinels,
  // and verify the only available outputs remain identical when all secret material changes.
  const first = await collectIntegrationReadiness({ projectRef, token, fetcher: fetchFixture() });
  const changed = secretFixture().map((entry) => ({ ...entry, value: "completely-different", digest: "different-digest" }));
  const second = await collectIntegrationReadiness({ projectRef, token, fetcher: fetchFixture(changed) });
  assert.deepEqual(first, second);
});

test("empty secret inventory is observed absence, not an observation failure", async () => {
  const report = await collectIntegrationReadiness({ projectRef, token, fetcher: fetchFixture([]) });
  assert.equal(report.reportStatus, "complete");
  assert.equal(Object.values(report.secretPresence).every((value) => value === false), true);
});

test("malformed inventories stay unknown rather than falsely reporting absent credentials", async () => {
  for (const malformed of [{ secrets: secretFixture() }, [null], [{ name: 123 }], null]) {
    const report = await collectIntegrationReadiness({ projectRef, token, fetcher: fetchFixture(malformed) });
    assert.equal(report.observations.secrets.reason, "invalid_response");
    assert.equal(Object.values(report.secretPresence).every((value) => value === null), true);
    assert.equal(report.authConfiguration.emailHookEnabled, true);
    assertPrivate(report);
  }
});

test("absent, null and incorrectly typed Auth fields remain unknown independently", async () => {
  const auth = { hook_send_email_enabled: false, mfa_phone_enroll_enabled: "false", smtp_host: null };
  const report = await collectIntegrationReadiness({ projectRef, token, fetcher: fetchFixture([], auth) });
  assert.equal(report.reportStatus, "incomplete");
  assert.equal(report.observations.auth.status, "partial");
  assert.equal(report.authConfiguration.emailHookEnabled, false);
  assert.equal(report.authConfiguration.nativePhoneMfaEnrollmentEnabled, null);
  assert.equal(report.authConfiguration.smtpHostConfigured, null);
  assert.equal(report.authConfiguration.emailHookSigningSecretPresent, null);
});

test("missing hook and SMTP values differ from unavailable fields", async () => {
  const auth = { ...authFixture(), hook_send_email_uri: "", hook_send_email_secrets: "  ", smtp_host: "" };
  const report = await collectIntegrationReadiness({ projectRef, token, fetcher: fetchFixture([], auth) });
  assert.equal(report.reportStatus, "complete");
  assert.equal(report.authConfiguration.emailHookExpectedUrl, false);
  assert.equal(report.authConfiguration.emailHookSigningSecretPresent, false);
  assert.equal(report.authConfiguration.smtpHostConfigured, false);
});

test("does not accept credential-bearing, suffix or wrong-project URLs as canonical", async () => {
  const hook = authFixture().hook_send_email_uri;
  for (const uri of [`${hook}?token=${sentinels[1]}`, `${hook}/`, hook.replace(projectRef, "a".repeat(20))]) {
    const auth = {
      ...authFixture(), hook_send_email_uri: uri,
      site_url: `https://user:${sentinels[1]}@cmcarebase.com`,
      uri_allow_list: `https://cmcarebase.com.attacker.example/**,https://cmcarebase.com/reset-password?token=${sentinels[1]}`,
    };
    const report = await collectIntegrationReadiness({ projectRef, token, fetcher: fetchFixture([], auth) });
    assert.equal(report.authConfiguration.emailHookExpectedUrl, false);
    assert.equal(report.authConfiguration.canonicalSiteUrl, false);
    assert.equal(report.authConfiguration.explicitPasswordResetRedirect, false);
    assert.equal(report.authConfiguration.canonicalOriginWildcardRedirect, false);
    assertPrivate(report);
    assertPrivate(renderReadinessMarkdown(report));
  }
});

test("only issues two fixed-origin GET requests with redirects disabled and bounded signals", async () => {
  const calls = [];
  await collectIntegrationReadiness({ projectRef, token, fetcher: async (url, options) => {
    calls.push(url);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.body, undefined);
    return json(url.endsWith("/secrets") ? [] : authFixture());
  } });
  assert.deepEqual(calls.sort(), [
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    `https://api.supabase.com/v1/projects/${projectRef}/secrets`,
  ]);
});

test("403 stays unknown, discards the response body and never retries or switches endpoints", async () => {
  const calls = [];
  const report = await collectIntegrationReadiness({ projectRef, token, fetcher: async (url) => {
    calls.push(url);
    return url.endsWith("/config/auth") ? json({ message: sentinels.join(" ") }, 403) : json([]);
  } });
  assert.equal(calls.length, 2);
  assert.equal(report.observations.auth.reason, "access_denied");
  assert.equal(Object.values(report.authConfiguration).every((value) => value === null), true);
  assert.equal(report.observations.secrets.status, "observed");
  assertPrivate(report);
});

test("auth failures, throttling and server failures use fixed categories without response details", async () => {
  for (const [status, reason] of [[401, "access_denied"], [429, "rate_limited"], [500, "http_error"]]) {
    const report = await collectIntegrationReadiness({ projectRef, token, fetcher: async () => json(sentinels, status) });
    assert.equal(report.observations.secrets.reason, reason);
    assert.equal(report.observations.auth.reason, reason);
    assertPrivate(report);
  }
});

test("network exceptions and malformed JSON never leak error messages", async () => {
  for (const fetcher of [
    async () => { throw new Error(sentinels.join(" ")); },
    async () => new Response(`not-json ${sentinels.join(" ")}`),
  ]) {
    const report = await collectIntegrationReadiness({ projectRef, token, fetcher });
    assert.equal(report.reportStatus, "incomplete");
    assert.equal(Object.values(report.secretPresence).every((value) => value === null), true);
    assertPrivate(report);
  }
});

test("abort deadline ends both requests without exposing timeout details", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const promise = collectIntegrationReadiness({ projectRef, token, fetcher: async (_url, { signal }) =>
    new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error(sentinels[0])), { once: true })) });
  t.mock.timers.tick(15_000);
  const report = await promise;
  assert.equal(report.observations.auth.reason, "request_timeout");
  assert.equal(report.observations.secrets.reason, "request_timeout");
  assertPrivate(report);
});

test("oversized responses are cancelled with a fixed observation failure", async () => {
  const report = await collectIntegrationReadiness({ projectRef, token, fetcher: async () =>
    new Response("x".repeat(2 * 1024 * 1024 + 1)) });
  assert.equal(report.observations.auth.reason, "response_too_large");
  assert.equal(report.observations.secrets.reason, "response_too_large");
});

test("invalid project refs and absent access tokens never reach the network", async () => {
  const fetcher = () => { assert.fail("Unexpected network call"); };
  for (const badProject of ["", `${projectRef}/../secrets`, `https://example.com/${projectRef}`, sentinels[1]]) {
    const report = await collectIntegrationReadiness({ projectRef: badProject, token, fetcher });
    assert.equal(report.observations.auth.reason, "invalid_project_ref");
    assertPrivate(report);
  }
  const report = await collectIntegrationReadiness({ projectRef, token: "", fetcher });
  assert.equal(report.observations.auth.reason, "missing_access_token");
});

test("CLI artifacts, summary and console output never include private sentinels", async () => {
  const writes = [];
  const logs = [];
  const code = await runReadinessReport({
    env: { SUPABASE_PROJECT_ID: projectRef, SUPABASE_ACCESS_TOKEN: token, GITHUB_STEP_SUMMARY: "test-summary", SUPABASE_API_URL: "https://ignored.example" },
    fetcher: fetchFixture(), write: async (path, content) => writes.push([path, content]),
    append: async (path, content) => writes.push([path, content]), log: (line) => logs.push(line),
  });
  assert.equal(code, 0);
  assert.deepEqual(writes.map(([path]) => path), ["integration-readiness.json", "integration-readiness.md", "test-summary"]);
  assertPrivate(writes);
  assertPrivate(logs);
  assert.equal(JSON.parse(writes[0][1]).liveDeliveryVerified, false);
  assert.equal(logs[0], writes[1][1], "Job logs must contain exactly the sanitized Markdown artifact");
  assert.match(logs[0], /\| TWILIO_ACCOUNT_SID \| Yes \|/);
  assert.match(logs[0], /\| TWILIO_VERIFY_SERVICE_SID \| No \|/);
  assert.match(logs[0], /\| STRIPE_BILLING_PORTAL_CONFIGURATION_ID \| Yes \|/);
  assert.match(logs[0], /\| Send Email hook is enabled \| Yes \|/);
  assert.match(logs[0], /\| Supabase native phone MFA enrollment is enabled \| No \|/);
});

test("CLI produces an incomplete artifact for unavailable observations and a distinct exit code", async () => {
  const writes = [];
  const logs = [];
  const code = await runReadinessReport({
    env: { SUPABASE_PROJECT_ID: projectRef, SUPABASE_ACCESS_TOKEN: token },
    fetcher: async () => json(sentinels, 403), write: async (_path, content) => writes.push(content),
    log: (line) => logs.push(line),
  });
  assert.equal(code, 2);
  assert.equal(JSON.parse(writes[0]).reportStatus, "incomplete");
  assertPrivate(writes);
  assertPrivate(logs);
});

test("CLI writer failures have a distinct fixed diagnostic without exception content", async () => {
  const logs = [];
  const code = await runReadinessReport({ env: {},
    write: async () => { throw new Error(sentinels.join(" ")); }, log: (line) => logs.push(line),
  });
  assert.equal(code, 1);
  assertPrivate(logs);
});

test("deploy workflow reports after backend success including no-op, without broadening token access or release gates", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-migrations.yml", import.meta.url), "utf8");
  const reportStep = workflow.split("      - name: Report integration configuration readiness\n")[1]?.split("\n      - name:")[0];
  assert.ok(reportStep, "Missing production report step");
  assert.match(reportStep, /if: success\(\)/);
  assert.match(reportStep, /continue-on-error: true/);
  assert.match(reportStep, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.doesNotMatch(reportStep, /SUPABASE_DB_PASSWORD/);
  assert.doesNotMatch(reportStep, /gate\.outputs\.skip/);
  assert.ok(workflow.indexOf("- name: Report integration configuration readiness") > workflow.indexOf("- name: Upload edge function deploy stamp"));
  assert.match(workflow, /steps\.integration_readiness\.outcome == 'failure'/);
  assert.match(workflow, /name: integration-readiness-\$\{\{ env\.DEPLOY_SHA \}\}/);
});
