import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createPlatformAdminBillingCommandHandler, parseBillingCommand, projectBillingCommandResult } from "./platform-admin-billing-commands.mjs";
import { readPlatformAdminConfig, createPlatformAdminRouter } from "./platform-admin.mjs";

const HUB = "11111111-1111-4111-8111-111111111111", NATIVE = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333", TARGET = "44444444-4444-4444-8444-444444444444";
const COMMAND = "55555555-5555-4555-8555-555555555555", REQUEST = "66666666-6666-4666-8666-666666666666";
const LEASE = "77777777-7777-4777-8777-777777777777", NOW = "2026-09-11T19:00:00.000Z", DIGEST = "a".repeat(64);
const env = { CAREMETRIC_ADMIN_ENABLED: "true", CAREMETRIC_ADMIN_COMMANDS_ENABLED: "true", CAREMETRIC_ADMIN_BILLING_COMMANDS_ENABLED: "true",
  HUB_SUPABASE_URL: "https://hub.test", HUB_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
  SUPABASE_URL: "https://native.test", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture", STRIPE_SECRET_KEY: "sk_test_fixture",
  CAREMETRIC_ADMIN_IDENTITY_MAP_JSON: JSON.stringify({ [HUB]: NATIVE }), PUBLIC_APP_URL: "https://cmcarebase.com",
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_carebase" };
const preview = { operation: "preview", requestId: REQUEST, action: "billing.portal.create", targetId: TARGET, parameters: {}, reason: "Owner requested billing portal" };
const apply = { operation: "apply", commandId: COMMAND, expectedDigest: DIGEST };
const values = { customer: "cus_carebase", configuration: "bpc_carebase", return_url: "https://cmcarebase.com/admin/enterprise" };
const providerSession = { kind: "portal", id: "bps_fixture", url: "https://billing.stripe.com/p/session/test_fixture", expiresAt: null, livemode: false };
const request = (body = preview, headers = {}) => new Request("https://cmcarebase.com/api/platform-admin/billing/command", {
  method: "POST", headers: { authorization: "Bearer fixture.jwt.token", "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});

function fixture(overrides = {}) {
  const calls = [], posts = [];
  const state = { actor: { user_id: HUB, role: "platform_admin", aal: "aal2", session_id: SESSION,
    session_started_at: "2026-09-11T18:00:00Z", assurance_expires_at: "2026-09-12T02:00:00Z" },
  profile: { id: NATIVE, role: "platform_admin", is_active: true }, user: { id: NATIVE },
  previewResult: { commandId: COMMAND, action: preview.action, targetId: TARGET, reason: preview.reason,
    expiresAt: "2026-09-11T19:05:00Z", previewDigest: DIGEST, summary: { kind: "portal", organizationName: "Synthetic organization",
      providerCustomerId: values.customer, providerConfigurationId: values.configuration, returnPath: "/admin/enterprise" } },
  claim: { kind: "execute", commandId: COMMAND, targetId: TARGET, leaseId: LEASE,
    idempotencyKey: `carebase:portal:${COMMAND}`, values, replayed: false },
  provider: { ok: true, status: 200, data: { id: providerSession.id, url: providerSession.url,
    customer: values.customer, configuration: values.configuration, livemode: false } }, ...overrides };
  const getEnv = key => ({ ...env, ...state.env })[key];
  const fetcher = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input), headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, headers, body });
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.origin === "https://hub.test") {
      assert.equal(url.pathname, "/rest/v1/rpc/authorize_platform_command");
      return json(state.actor);
    }
    if (url.origin === "https://support-hub-web-production.up.railway.app") {
      assert.equal(url.pathname, "/api/internal/command/carebase/authorize");
      return json(state.sms);
    }
    assert.equal(url.origin, env.SUPABASE_URL);
    assert.equal(headers.get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
    if (url.pathname === `/auth/v1/admin/users/${NATIVE}`) return json({ user: state.user });
    if (url.pathname === "/rest/v1/profiles") return json(state.profile ? [state.profile] : []);
    if (url.pathname === "/rest/v1/billing_accounts") return state.accountError ? json({ code: "57014" }, 500)
      : json([{ id: REQUEST, stripe_customer_id: values.customer, billing_state: "active" }]);
    if (state.rpcError) return json({ code: state.rpcError, message: "Private provider detail" }, 400);
    if (url.pathname.endsWith("/platform_admin_preview_billing_portal")) return json(state.previewResult);
    if (url.pathname.endsWith("/platform_admin_claim_billing_portal")) return json(state.claim);
    if (url.pathname.endsWith("/platform_admin_finish_billing_portal")) {
      state.finish = body;
      if (state.failFinish) return json({ code: "57014" }, 500);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/platform_admin_read_billing_portal_result")) {
      if (state.revokeAfterProvider) return json({ code: "42501" }, 403);
      return json({ commandId: COMMAND, action: preview.action, targetId: TARGET,
        outcome: state.finish.p_outcome === "succeeded" ? "created" : state.finish.p_outcome === "failed" ? "failed" : "pending",
        replayed: body.p_replayed, completedAt: state.finish.p_outcome === "indeterminate" ? null : NOW,
        retryAfterSeconds: state.finish.p_outcome === "indeterminate" ? 30 : null, session: state.finish.p_session });
    }
    throw new Error("Unexpected synthetic request");
  };
  const stripePost = async (path, key, parameters, idempotency, fetch) => {
    posts.push({ path, parameters, idempotency });
    assert.equal(path, "/v1/billing_portal/sessions");
    assert.equal(key, env.STRIPE_SECRET_KEY);
    assert.equal(typeof fetch, "function");
    if (state.throwProvider) throw new TypeError("Private timeout detail");
    return state.provider;
  };
  const options = { config: readPlatformAdminConfig(getEnv), getEnv, fetcher, stripePost, now: () => new Date(NOW) };
  return { state, calls, posts, options, handler: createPlatformAdminBillingCommandHandler(options) };
}

test("portal command requires its own explicit enable flag", async () => {
  const f = fixture({ env: { CAREMETRIC_ADMIN_BILLING_COMMANDS_ENABLED: undefined } });
  assert.equal((await f.handler(request())).status, 503);
  assert.equal(f.calls.length, 0);
  assert.throws(() => fixture({ env: { CAREMETRIC_ADMIN_BILLING_COMMANDS_ENABLED: "yes" } }));
});

test("portal preview shares native planner, fixed configuration and fresh delegated identity without provider writes", async () => {
  const f = fixture(), response = await f.handler(request());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.summary.providerCustomerId, values.customer);
  assert.equal(f.posts.length, 0);
  assert.deepEqual(f.calls.at(-1).body.p_provider_parameters, values);
  assert.equal(f.calls.at(-1).body.p_authentication_method, "jwt_aal2");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(JSON.stringify(result).includes("stripeKey"), false);
});

test("portal creates only after durable claim and returns only after receipt persistence plus current authority", async () => {
  const f = fixture(), response = await f.handler(request(apply));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.session, providerSession);
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].idempotency, `carebase:portal:${COMMAND}`);
  assert.deepEqual(f.state.finish, { p_command_id: COMMAND, p_lease_id: LEASE, p_outcome: "succeeded", p_session: providerSession });
  assert.equal(f.calls.at(-1).url.pathname, "/rest/v1/rpc/platform_admin_read_billing_portal_result");
});

test("portal accepts both documented Stripe capability formats", async () => {
  for (const url of ["https://billing.stripe.com/p/session/test_legacy", "https://billing.stripe.com/p/session?secret=test_current"]) {
    const f = fixture(); f.state.provider.data.url = url;
    const response = await f.handler(request(apply));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.session.url, url);
    assert.equal(f.state.finish.p_session.url, url);
  }
});

test("uncertain provider results remain pending without a fabricated failed outcome or session URL", async () => {
  for (const override of [{ throwProvider: true }, { provider: { ok: false, status: 500, data: {} } },
    { provider: { ok: false, status: 429, data: {} } }, { provider: { ok: false, status: 409, data: {} } },
    { provider: { ok: true, status: 200, data: { customer: "cus_wrong" } } }]) {
    const f = fixture(override), response = await f.handler(request(apply));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.data.outcome, "pending");
    assert.equal(result.data.session, null);
    assert.equal(f.state.finish.p_outcome, "indeterminate");
  }
});

test("definitive provider rejection is recorded as failed without raw errors", async () => {
  const f = fixture({ provider: { ok: false, status: 400, data: { error: "PRIVATE" } } });
  const response = await f.handler(request(apply));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(JSON.parse(text).data.outcome, "failed");
  assert.equal(text.includes("PRIVATE"), false);
});

test("stored replay and an in-flight reservation never dispatch a new provider request", async () => {
  for (const outcome of ["created", "pending", "failed"]) {
    const result = { commandId: COMMAND, action: preview.action, targetId: TARGET, outcome, replayed: true,
      completedAt: outcome === "pending" ? null : NOW, retryAfterSeconds: outcome === "pending" ? 30 : null,
      session: outcome === "created" ? providerSession : null };
    const f = fixture({ claim: { kind: "result", data: result } });
    assert.deepEqual((await (await f.handler(request(apply))).json()).data, result);
    assert.equal(f.posts.length, 0);
  }
});

test("receipt persistence failure and subsequent actor revocation never disclose the created capability URL", async () => {
  for (const override of [{ failFinish: true }, { revokeAfterProvider: true }]) {
    const f = fixture(override), response = await f.handler(request(apply));
    assert.equal(response.status, override.failFinish ? 503 : 403);
    assert.equal((await response.text()).includes(providerSession.url), false);
    assert.equal(f.posts.length, 1);
  }
});

test("portal SMS authority uses the command audience and binds exact preview and apply", async () => {
  for (const operation of [preview, apply]) {
    const f = fixture();
    const { aal, ...actor } = f.state.actor;
    f.state.sms = { ...actor, method: "sms", operation };
    assert.equal((await f.handler(request(operation, { authorization: "Bearer cmh_" + "a".repeat(43) }))).status, 200);
    assert.equal(f.calls.find(c => c.url.pathname.includes("/platform_admin_")).body.p_authentication_method, "app_sms");
    f.state.sms.operation = { ...operation, targetId: NATIVE };
    assert.equal((await f.handler(request(operation, { authorization: "Bearer cmh_" + "a".repeat(43) }))).status, 403);
  }
});

test("closed portal parser rejects provider values, Checkout, action substitution and caller identity", async () => {
  for (const value of [{ ...preview, parameters: { returnUrl: "https://evil.test" } }, { ...preview, action: "billing.checkout.create" },
    { ...preview, parameters: { customer: "cus_other" } }, { ...preview, actorId: NATIVE }, { ...apply, expectedDigest: "no" },
    { ...preview, reason: "a\nlong enough reason" }, { ...preview, targetId: "bad" }]) assert.throws(() => parseBillingCommand(value));
  const f = fixture();
  for (const origin of ["null", "https://cmcarebase.com", "https://evil.test"]) assert.equal((await f.handler(request(preview, { origin }))).status, 403);
  assert.equal(f.calls.length, 0);
});

test("source or configuration failures block provider dispatch", async () => {
  for (const override of [{ accountError: true }, { env: { STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "" } },
    { profile: { id: NATIVE, role: "platform_admin", is_active: false } }, { user: { id: NATIVE, deleted_at: NOW } }]) {
    const f = fixture(override);
    assert.ok([403, 503].includes((await f.handler(request())).status));
    assert.equal(f.posts.length, 0);
  }
});

test("unsafe or mismatched provider capability responses remain indeterminate", async () => {
  for (const change of [{ url: "https://evil.test/p/session/foo" }, { configuration: "bpc_other" }, { customer: "cus_other" },
    { url: "https://billing.stripe.com/p/session/test#secret" }, { livemode: "false" }, { id: "cs_wrong" }]) {
    const f = fixture();
    Object.assign(f.state.provider.data, change);
    assert.equal((await (await f.handler(request(apply))).json()).data.outcome, "pending");
  }
  for (const url of ["https://billing.stripe.com:443/p/session?secret=test_1", "https://user@billing.stripe.com/p/session?secret=test_1",
    "https://billing.stripe.com/p/session?secret=test_1#fragment", "https://billing.stripe.com/p/session?secret=test_1&extra=1",
    "https://billing.stripe.com/p/session?secret=test_1&secret=test_2", "https://billing.stripe.com/p/session?secret=",
    "https://billing.stripe.com/p/session?secret=test%5f1", "https://billing.stripe.com/p/session?secret=test+1",
    "https://billing.stripe.com/p/session/test_1?extra=1", "https://billing.stripe.com/p/session/test_1/subpath",
    "https://billing.stripe.com/p/session?secret=" + "a".repeat(2049), "https://billing.stripe.com/p/session/" + "a".repeat(2049)]) {
    const f = fixture(); f.state.provider.data.url = url;
    const result = await (await f.handler(request(apply))).json();
    assert.equal(result.data.outcome, "pending");
    assert.equal(result.data.session, null);
  }
});

test("SQL projection refuses malformed outcome, excess fields and indefinite preview expiry", () => {
  const f = fixture();
  assert.throws(() => projectBillingCommandResult({ ...f.state.previewResult, expiresAt: "2099-01-01T00:00:00Z" }, preview, new Date(NOW)));
  assert.throws(() => projectBillingCommandResult({ ...f.state.previewResult, private: true }, preview, new Date(NOW)));
});

test("real Node router recognizes the fixed billing command path and rejects anonymous traffic before SPA fallback", async () => {
  const f = fixture(), router = createPlatformAdminRouter(f.options);
  const server = createServer((req, res) => { void router(req, res, new URL(req.url, "https://cmcarebase.com").pathname); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/platform-admin/billing/command`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(preview),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: "unauthenticated" } });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
