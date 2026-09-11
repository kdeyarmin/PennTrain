import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createPlatformAdminCommandHandler } from "./platform-admin-commands.mjs";
import { readPlatformAdminConfig, createPlatformAdminRouter, createPlatformAdminHandler } from "./platform-admin.mjs";

const HUB = "11111111-1111-4111-8111-111111111111";
const NATIVE = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const TARGET = "44444444-4444-4444-8444-444444444444";
const COMMAND = "55555555-5555-4555-8555-555555555555";
const REQUEST = "66666666-6666-4666-8666-666666666666";
const NOW = "2026-09-11T15:00:00.000Z";
const DIGEST = "a".repeat(64);
const env = { CAREMETRIC_ADMIN_ENABLED: "true", CAREMETRIC_ADMIN_COMMANDS_ENABLED: "true", HUB_SUPABASE_URL: "https://hub.example.test",
  HUB_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_URL: "https://native.example.test", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture",
  CAREMETRIC_ADMIN_IDENTITY_MAP_JSON: JSON.stringify({ [HUB]: NATIVE }) };
const config = (override = {}) => readPlatformAdminConfig((key) => ({ ...env, ...override })[key]);
const preview = (extra = {}) => ({ operation: "preview", requestId: REQUEST, action: "users.setActive", targetId: TARGET,
  parameters: { active: false }, reason: "Owner requested access removal", ...extra });
const apply = (extra = {}) => ({ operation: "apply", commandId: COMMAND, expectedDigest: DIGEST, ...extra });
const request = (body = preview(), headers = {}) => new Request("https://cmcarebase.com/api/platform-admin/command", {
  method: "POST", headers: { Authorization: "Bearer fixture.jwt.token", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
const changes = [{ field: "active", before: "true", after: "false" }];

function fixture(overrides = {}) {
  const calls = [];
  const state = { actor: { user_id: HUB, role: "platform_admin", aal: "aal2", session_id: SESSION,
    session_started_at: "2026-09-11T14:00:00.000Z", assurance_expires_at: "2026-09-11T22:00:00.000Z" },
  profile: { id: NATIVE, role: "platform_admin", is_active: true }, user: { id: NATIVE },
  previewResult: { commandId: COMMAND, action: "users.setActive", targetId: TARGET, reason: preview().reason,
    expiresAt: "2026-09-11T15:05:00.000Z", previewDigest: DIGEST, changes },
  applyResult: { commandId: COMMAND, action: "users.setActive", targetId: TARGET, appliedAt: NOW, replayed: false, changes }, ...overrides };
  const fetcher = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = new Headers(init.headers);
    calls.push({ url, headers, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.origin === env.HUB_SUPABASE_URL) {
      assert.ok(["/rest/v1/rpc/authorize_platform_command", "/rest/v1/rpc/authorize_platform_admin"].includes(url.pathname));
      assert.equal(headers.get("apikey"), env.HUB_SUPABASE_PUBLISHABLE_KEY);
      assert.equal(headers.get("authorization"), "Bearer fixture.jwt.token");
      return state.actorError ? json({ code: state.actorError }, 403) : json(state.actor);
    }
    assert.equal(url.origin, env.SUPABASE_URL);
    assert.equal(headers.get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
    assert.notEqual(headers.get("authorization"), "Bearer fixture.jwt.token");
    if (url.pathname === `/auth/v1/admin/users/${NATIVE}`) return json({ user: state.user });
    if (url.pathname === "/rest/v1/profiles") {
      assert.equal(url.searchParams.get("id"), `eq.${NATIVE}`);
      assert.equal(url.searchParams.get("select"), "id,role,is_active");
      return json(state.profile ? [state.profile] : []);
    }
    if (url.pathname === "/rest/v1/rpc/platform_admin_preview_command") return state.rpcError ? json({ code: state.rpcError, message: "private account detail" }, 400) : json(state.previewResult);
    if (url.pathname === "/rest/v1/rpc/platform_admin_apply_command") return state.rpcError ? json({ code: state.rpcError, message: "private account detail" }, 400) : json(state.applyResult);
    throw new Error("Unexpected native API");
  };
  return { calls, state, fetcher, handler: createPlatformAdminCommandHandler({ config: config(), fetcher, now: () => new Date(NOW) }) };
}

test("commands require a separate explicit enable flag and advertise only when enabled", async () => {
  assert.equal(config({ CAREMETRIC_ADMIN_COMMANDS_ENABLED: undefined }).commandsEnabled, false);
  assert.throws(() => config({ CAREMETRIC_ADMIN_COMMANDS_ENABLED: "yes" }));
  const f = fixture();
  const disabled = createPlatformAdminCommandHandler({ config: config({ CAREMETRIC_ADMIN_COMMANDS_ENABLED: "false" }), fetcher: f.fetcher });
  assert.equal((await disabled(request())).status, 503);
  assert.equal(f.calls.length, 0);
  for (const enabled of ["true", "false"]) {
    const read = createPlatformAdminHandler({ config: config({ CAREMETRIC_ADMIN_COMMANDS_ENABLED: enabled }), fetcher: f.fetcher, now: () => new Date(NOW) });
    const result = await (await read(request({ operation: "capabilities" }))).json();
    assert.equal(result.data.operations.includes("commands.preview"), enabled === "true");
    assert.equal(result.data.operations.includes("commands.apply"), enabled === "true");
  }
});

test("preview sends only verified delegation identity and immutable intent to the native RPC", async () => {
  const f = fixture();
  const response = await f.handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const output = await response.json();
  assert.deepEqual(output.data, f.state.previewResult);
  assert.equal(output.operation, "preview");
  assert.equal(f.calls[0].url.pathname, "/rest/v1/rpc/authorize_platform_command");
  assert.deepEqual(f.calls.at(-1).body, { p_actor: NATIVE, p_hub_user: HUB, p_hub_session: SESSION,
    p_session_started_at: f.state.actor.session_started_at, p_assurance_expires_at: f.state.actor.assurance_expires_at,
    p_request_id: REQUEST, p_action: "users.setActive", p_target: TARGET, p_parameters: { active: false }, p_reason: preview().reason });
  assert.equal(JSON.stringify(output).includes("sb_secret"), false);
});

test("apply preserves the command UUID/digest and returns a safe replay result", async () => {
  const f = fixture();
  f.state.applyResult.replayed = true;
  const response = await f.handler(request(apply()));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.replayed, true);
  assert.equal(f.calls.at(-1).body.p_command_id, COMMAND);
  assert.equal(f.calls.at(-1).body.p_expected_digest, DIGEST);
  assert.equal(Object.hasOwn(f.calls.at(-1).body, "p_parameters"), false);
});

for (const [label, override] of [
  ["missing command assurance", { session_id: undefined }], ["wrong session identifier", { session_id: "bad" }],
  ["expired original session", { session_started_at: "2026-09-11T06:59:59.000Z" }],
  ["future session", { session_started_at: "2026-09-11T15:05:01.000Z" }],
  ["expired assurance", { assurance_expires_at: NOW }], ["extended freshness window", { assurance_expires_at: "2026-09-11T23:00:00.000Z" }],
  ["AAL1", { aal: "aal1" }], ["unmapped Hub user", { user_id: TARGET }],
]) test(`command refuses ${label} before a native command is issued`, async () => {
  const f = fixture(); Object.assign(f.state.actor, override);
  for (const body of [preview(), apply()]) assert.equal((await f.handler(request(body))).status, 403);
  assert.equal(f.calls.some((call) => call.url.pathname.includes("/rpc/platform_admin_")), false);
});

test("native revocation is rechecked on apply after a successful preview", async () => {
  const f = fixture();
  assert.equal((await f.handler(request())).status, 200);
  f.state.profile.is_active = false;
  assert.equal((await f.handler(request(apply()))).status, 403);
  assert.equal(f.calls.filter((call) => call.url.pathname.includes("/rpc/platform_admin_")).length, 1);
});

test("unknown actions, caller identities, scopes, credentials, invalid booleans and unbounded reasons cannot reach authorization", async () => {
  const f = fixture();
  for (const body of [preview({ action: "billing.cancel" }), preview({ actorId: NATIVE }), preview({ product: "carebase" }),
    preview({ reason: "short" }), preview({ reason: "x".repeat(501) }), preview({ reason: "invalid\nreason" }),
    preview({ parameters: { active: "false" } }), preview({ parameters: { active: false, role: "platform_admin" } }),
    preview({ targetId: "not-uuid" }), preview({ requestId: null }), apply({ expectedDigest: "wrong" }), apply({ parameters: { active: true } }),
    preview({ action: "billing.setAccessOverride", parameters: { state: "provider", expiresAt: "2027-01-01T00:00:00Z" } }),
    preview({ action: "billing.setAccessOverride", parameters: { state: "comped", expiresAt: "2027-01-01" } }),
    preview({ action: "organizations.setSuspension", parameters: { suspended: null } }), [], null]) {
    assert.equal((await f.handler(request(body))).status, 400);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await f.handler(request(preview(), { Origin: "https://hub.example.test" }))).status, 403);
  assert.equal((await f.handler(request(preview(), { Authorization: "" }))).status, 401);
  assert.equal((await f.handler(request(preview(), { "Content-Type": "text/plain" }))).status, 415);
  assert.equal(f.calls.length, 0);
});

test("both organization actions preserve null expiry and expose only state changes", async () => {
  for (const [action, parameters] of [["organizations.setSuspension", { suspended: true }],
    ["billing.setAccessOverride", { state: "comped", expiresAt: null }]]) {
    const f = fixture();
    f.state.previewResult.action = action;
    f.state.previewResult.changes = [{ field: "status", before: "active", after: "suspended" },
      { field: "billingState", before: "active", after: "suspended" }, { field: "stateSource", before: "stripe", after: "manual_suspension" },
      { field: "compedUntil", before: null, after: null }];
    const response = await f.handler(request(preview({ action, parameters })));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.changes.length, 4);
    assert.deepEqual(f.calls.at(-1).body.p_parameters, parameters);
  }
});

test("native conflicts and deliberate denials become safe stable error codes", async () => {
  for (const [rpcError, status, code] of [["40001", 409, "conflict"], ["42501", 403, "forbidden"], ["P0002", 404, "notfound"],
    ["22023", 400, "invalid_request"], ["22007", 400, "invalid_request"], ["XX000", 503, "upstream"]]) {
    const response = await fixture({ rpcError }).handler(request(apply()));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
  }
});

test("mismatched, unbounded or unexpected native result fields are never returned", async () => {
  for (const extra of [{ targetId: NATIVE }, { commandId: "bad" }, { previewDigest: "bad" }, { email: "private@example.test" },
    { changes: [{ field: "email", before: null, after: "private@example.test" }] }, { changes: [] },
    { changes: [...changes, ...changes] }, { expiresAt: "invalid" }]) {
    const f = fixture(); Object.assign(f.state.previewResult, extra);
    const response = await f.handler(request());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: { code: "upstream" } });
  }
});

test("real command route has separate input bounds and cannot become a browser or generic RPC endpoint", async (t) => {
  const f = fixture();
  const router = createPlatformAdminRouter({ config: config(), fetcher: f.fetcher, now: () => new Date(NOW) });
  const server = createServer(async (req, res) => { if (!await router(req, res, new URL(req.url, "http://fixture").pathname)) { res.writeHead(404); res.end(); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/platform-admin/command`;
  assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer fixture.jwt.token" }, body: JSON.stringify(preview()) })).status, 200);
  assert.equal((await fetch(url, { method: "POST", body: "x".repeat(4097) })).status, 413);
  assert.equal((await fetch(url, { method: "OPTIONS" })).status, 405);
  assert.equal((await fetch(url + "/arbitrary", { method: "POST" })).status, 404);
});
