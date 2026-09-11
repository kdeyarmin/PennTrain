import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createPlatformAdminHandler, createPlatformAdminRouter, readPlatformAdminConfig } from "./platform-admin.mjs";

const HUB_ID = "11111111-1111-4111-8111-111111111111";
const NATIVE_ID = "22222222-2222-4222-8222-222222222222";
const COURSE_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-09-11T13:00:00.000Z";
const ENV = {
  CAREMETRIC_ADMIN_ENABLED: "true", HUB_SUPABASE_URL: "https://hub.example.test",
  HUB_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_URL: "https://carebase.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture",
  CAREMETRIC_ADMIN_IDENTITY_MAP_JSON: JSON.stringify({ [HUB_ID]: NATIVE_ID }),
};
const config = (overrides = {}) => readPlatformAdminConfig((name) => ({ ...ENV, ...overrides })[name]);
const course = (overrides = {}) => ({
  id: COURSE_ID, title: "Safe course", description: "Shared training", category: "Compliance", status: "published",
  estimated_duration_minutes: 30, updated_at: NOW, organization_id: null, current_version_id: VERSION_ID, ...overrides,
});

/** Exercise real supabase-js HTTP query construction, not a mock chain mirroring the implementation. */
function fixture(overrides = {}) {
  const calls = [];
  const state = {
    actor: { user_id: HUB_ID, role: "platform_admin", aal: "aal2" },
    profile: { id: NATIVE_ID, role: "platform_admin", is_active: true },
    user: { id: NATIVE_ID, is_anonymous: false, banned_until: null },
    courses: [course()], version: { id: VERSION_ID },
    blocks: [{ id: COURSE_ID, title: "Lesson", block_type: "video", sort_order: 1, organization_id: null,
      video_url: "secret-media", body: { clinical: "never project this" }, document_id: "private" }],
    ...overrides,
  };
  const fetcher = async (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = new Headers(init.headers);
    const method = init.method ?? "GET";
    calls.push({ url, headers, method, body: init.body, signal: init.signal, redirect: init.redirect });
    if (state.networkError) throw new Error("sensitive upstream error sb_secret_fixture");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    if (state.rawResponse) return state.rawResponse();
    const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...extra } });
    if (url.origin === 'https://support-hub-web-production.up.railway.app') {
      assert.equal(url.pathname, '/api/internal/admin/authorize');
      assert.equal(method, 'POST');
      assert.equal(headers.get('origin'), null);
      assert.equal(headers.get('apikey'), null);
      assert.match(headers.get('authorization'), /^Bearer cmh_[A-Za-z0-9_-]{43}$/);
      return state.appError ? json({error:'Unauthorized'},state.appError) : json(state.appActor);
    }
    if (url.origin === ENV.HUB_SUPABASE_URL) {
      assert.equal(url.pathname, "/rest/v1/rpc/authorize_platform_admin");
      assert.equal(method, "POST");
      assert.equal(headers.get("content-profile"), "hub");
      assert.equal(headers.get("apikey"), ENV.HUB_SUPABASE_PUBLISHABLE_KEY);
      assert.equal(headers.get("authorization"), "Bearer fixture.jwt.token");
      return state.actorError ? json({ code: state.actorError }, state.actorStatus ?? 403) : json(state.actor);
    }
    assert.equal(url.origin, ENV.SUPABASE_URL);
    assert.equal(headers.get("apikey"), ENV.SUPABASE_SERVICE_ROLE_KEY);
    assert.notEqual(headers.get("authorization"), "Bearer fixture.jwt.token");
    if (url.pathname === `/auth/v1/admin/users/${NATIVE_ID}`) return state.userError
      ? json({ msg: "Native identity unavailable" }, state.userError) : json({ user: state.user });
    const table = url.pathname.slice("/rest/v1/".length);
    if (method === "HEAD") {
      if (table === "profiles") assert.equal(url.searchParams.get("is_active"), "eq.true");
      if (table === "courses") assert.equal(url.searchParams.get("organization_id"), "is.null");
      assert.equal(url.searchParams.get("select"), "id");
      return new Response(null, { status: state.countError ? 500 : 200, headers: { "Content-Range": `0-0/${{ organizations: 3, profiles: 7, courses: 80 }[table]}` } });
    }
    if (table === "profiles") {
      assert.equal(url.searchParams.get("id"), `eq.${NATIVE_ID}`);
      assert.equal(url.searchParams.get("select"), "id,role,is_active");
      return state.profileError ? json({ code: "PGRST002" }, 503) : json(state.profile ? [state.profile] : []);
    }
    if (table === "courses") {
      assert.equal(url.searchParams.get("organization_id"), "is.null");
      assert.equal(url.searchParams.get("select"), "id,title,description,category,status,estimated_duration_minutes,updated_at,organization_id,current_version_id");
      return json(state.courses, 200, { "Content-Range": `0-${state.courses.length - 1}/${state.courses.length}` });
    }
    if (table === "course_versions") {
      assert.equal(url.searchParams.get("id"), `eq.${VERSION_ID}`);
      assert.equal(url.searchParams.get("course_id"), `eq.${COURSE_ID}`);
      assert.equal(url.searchParams.get("organization_id"), "is.null");
      assert.equal(url.searchParams.get("select"), "id");
      return json(state.version ? [state.version] : []);
    }
    if (table === "course_blocks") {
      assert.equal(url.searchParams.get("course_version_id"), `eq.${VERSION_ID}`);
      assert.equal(url.searchParams.get("organization_id"), "is.null");
      assert.equal(url.searchParams.get("select"), "id,title,block_type,sort_order,organization_id");
      assert.equal(url.searchParams.get("limit"), "201");
      assert.equal(url.searchParams.get("order"), "sort_order.asc,id.asc");
      return json(state.blocks);
    }
    throw new Error(`Unexpected fixture query ${url.pathname}`);
  };
  return { calls, state, fetcher, handler: createPlatformAdminHandler({ config: config(), fetcher, now: () => new Date(NOW) }) };
}

const request = (body = { operation: "overview" }, headers = {}) => new Request("https://cmcarebase.com/api/platform-admin/read", {
  method: "POST", headers: { Authorization: "Bearer fixture.jwt.token", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});

test('SMS delegation uses a fixed app endpoint and retains native account checks', async () => {
  const f=fixture({appActor:{user_id:HUB_ID,role:'platform_admin',method:'sms',operation:{operation:'overview'}}});
  const headers={Authorization:'Bearer cmh_'+'a'.repeat(43)};
  assert.equal((await f.handler(request(undefined,headers))).status,200);
  assert.equal(f.calls.some(call=>call.url.origin===ENV.HUB_SUPABASE_URL),false);
  f.state.profile.role='employee';
  assert.equal((await f.handler(request(undefined,headers))).status,403);
});

test('SMS delegation rejects changed operation, method, role, unmapped identity and replay',async()=>{
  for(const override of [{method:'email'},{role:'org_admin'},{user_id:COURSE_ID},{operation:{operation:'courses.list'}},{operation:{operation:'overview',tenantId:COURSE_ID}}]) {
    const f=fixture({appActor:{user_id:HUB_ID,role:'platform_admin',method:'sms',operation:{operation:'overview'},...override}});
    assert.equal((await f.handler(request(undefined,{Authorization:'Bearer cmh_'+'a'.repeat(43)}))).status,403);
    assert.equal(f.calls.some(call=>call.method==='HEAD'),false);
  }
  const f=fixture({appError:401});
  assert.equal((await f.handler(request(undefined,{Authorization:'Bearer cmh_'+'a'.repeat(43)}))).status,401);
  assert.equal(f.calls.length,1);
});

test("default off needs no credentials; enabled config refuses unsafe mappings and origins", () => {
  assert.deepEqual(readPlatformAdminConfig(() => undefined), { enabled: false });
  for (const values of [
    { CAREMETRIC_ADMIN_ENABLED: "yes" }, { HUB_SUPABASE_URL: "http://hub.example.test" },
    { HUB_SUPABASE_URL: "https://hub.example.test/path" }, { HUB_SUPABASE_URL: "https://user:password@hub.example.test" },
    { HUB_SUPABASE_PUBLISHABLE_KEY: "sb_secret_bad" }, { SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_bad" },
    { VITE_SUPABASE_URL: "https://different.example.test" }, { CAREMETRIC_ADMIN_IDENTITY_MAP_JSON: "{}" },
    { CAREMETRIC_ADMIN_IDENTITY_MAP_JSON: JSON.stringify({ "admin@example.com": NATIVE_ID }) },
    { CAREMETRIC_ADMIN_IDENTITY_MAP_JSON: JSON.stringify({ [HUB_ID]: NATIVE_ID, [COURSE_ID]: NATIVE_ID }) },
  ]) assert.throws(() => config(values));
});

test("overview uses exact counts and fresh authorization, never returns user rows", async () => {
  const f = fixture();
  const response = await f.handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await response.json(), { contractVersion: 1, product: "carebase", operation: "overview", generatedAt: NOW,
    data: { organizationCount: 3, activeUserCount: 7, globalCourseCount: 80 } });
  assert.equal(f.calls.filter((call) => call.method === "HEAD").length, 3);
  f.state.profile.role = "employee";
  assert.equal((await f.handler(request())).status, 403);
  assert.equal(f.calls.filter((call) => call.url.origin === ENV.HUB_SUPABASE_URL).length, 2);
  assert.equal(f.calls.filter((call) => call.method === "HEAD").length, 3);
});

for (const [label, override, status] of [
  ["unmapped identity", { actor: { user_id: COURSE_ID, role: "platform_admin", aal: "aal2" } }, 403],
  ["tenant administrator", { actor: { user_id: HUB_ID, role: "org_admin", aal: "aal2" } }, 403],
  ["AAL1 session", { actor: { user_id: HUB_ID, role: "platform_admin", aal: "aal1" } }, 403],
  ["revoked Hub session", { actorError: "28000" }, 401],
  ["expired Hub token", { actorError: "PGRST301", actorStatus: 401 }, 401],
  ["revoked Hub role", { actorError: "42501" }, 403],
  ["Hub unavailable", { actorError: "PGRST202" }, 503],
  ["inactive native profile", { profile: { id: NATIVE_ID, role: "platform_admin", is_active: false } }, 403],
  ["demoted native profile", { profile: { id: NATIVE_ID, role: "org_admin", is_active: true } }, 403],
  ["missing native profile", { profile: null }, 403],
  ["missing native user", { user: null }, 403],
  ["native user no longer exists", { userError: 404 }, 403],
  ["unavailable native identity", { userError: 503 }, 503],
  ["unavailable native profile", { profileError: true }, 503],
  ["deleted native user", { user: { id: NATIVE_ID, deleted_at: NOW } }, 403],
  ["banned native user", { user: { id: NATIVE_ID, banned_until: "2100-01-01T00:00:00Z" } }, 403],
  ["malformed native ban", { user: { id: NATIVE_ID, banned_until: "invalid" } }, 403],
  ["anonymous native user", { user: { id: NATIVE_ID, is_anonymous: true } }, 403],
]) test(`denies ${label} before reading administration data`, async () => {
  const f = fixture(override);
  const response = await f.handler(request());
  assert.equal(response.status, status);
  assert.equal(f.calls.some((call) => call.method === "HEAD" || call.url.pathname.endsWith("/courses")), false);
});

test("tenant scope, mutations, unknown fields, pagination and malformed ids are rejected before auth", async () => {
  const f = fixture();
  for (const body of [
    { operation: "overview", organizationId: NATIVE_ID }, { operation: "users.list" }, { operation: "courses.create" },
    { operation: "courses.get", courseId: "not-uuid" }, { operation: "courses.get", courseId: COURSE_ID, tenantId: NATIVE_ID },
    { operation: "courses.list", limit: 51 }, { operation: "courses.list", offset: -1 }, { operation: "courses.list", offset: 10_001 },
    { operation: "courses.list", search: "x".repeat(101) }, { operation: "courses.list", search: "bad\nsearch" },
    { operation: "courses.list", search: "*" },
    { operation: "courses.list", limit: "25" }, [], null,
  ]) assert.equal((await f.handler(request(body))).status, 400);
  assert.equal(f.calls.length, 0);
});

test("browser origins, missing bearer, wrong media type and oversized input stop before auth", async () => {
  const f = fixture();
  assert.equal((await f.handler(request(undefined, { Origin: "https://hub.example.test" }))).status, 403);
  assert.equal((await f.handler(request(undefined, { Authorization: "" }))).status, 401);
  assert.equal((await f.handler(request(undefined, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal((await f.handler(request({ operation: "courses.list", search: "x".repeat(3000) }))).status, 400);
  assert.equal(f.calls.length, 0);
});

test("catalog title filtering and stable paging preserve global scope and bounded metadata", async () => {
  const f = fixture({ courses: [course({ title: "x".repeat(501), description: "d".repeat(4001), private: "never" })] });
  const response = await f.handler(request({ operation: "courses.list", limit: 10, offset: 20, search: "100%_care\\team" }));
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.items[0].title.length, 500);
  assert.equal(data.items[0].description.length, 4000);
  assert.equal(data.items[0].current_version_id, undefined);
  assert.equal(data.items[0].private, undefined);
  assert.deepEqual({ total: data.total, limit: data.limit, offset: data.offset }, { total: 1, limit: 10, offset: 20 });
  const call = f.calls.find((entry) => entry.url.pathname.endsWith("/courses"));
  assert.equal(call.url.searchParams.get("title"), "ilike.%100\\%\\_care\\\\team%");
  assert.equal(call.url.searchParams.get("order"), "title.asc,id.asc");
  assert.equal(call.url.searchParams.get("offset"), "20");
  assert.equal(call.url.searchParams.get("limit"), "10");
});

test("detail binds current version to the requested global course and projects lesson titles only", async () => {
  const f = fixture();
  const response = await f.handler(request({ operation: "courses.get", courseId: COURSE_ID }));
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.lessons, [{ id: COURSE_ID, title: "Lesson", type: "video", position: 1 }]);
  assert.equal(data.lessonsTruncated, false);
  assert.equal(JSON.stringify(data).includes("secret-media"), false);
  assert.equal(JSON.stringify(data).includes("clinical"), false);
});

test("tenant course, mismatched version and tenant block are never exposed even after an upstream contract failure", async () => {
  for (const override of [
    { courses: [course({ organization_id: NATIVE_ID })] }, { version: null },
    { blocks: [{ id: COURSE_ID, title: "private", block_type: "video", sort_order: 1, organization_id: NATIVE_ID }] },
  ]) {
    const f = fixture(override);
    const response = await f.handler(request({ operation: "courses.get", courseId: COURSE_ID }));
    assert.equal(response.status, 502);
    assert.equal(JSON.stringify(await response.json()).includes("private"), false);
  }
});

test("missing courses are 404 and a course with no version has an empty lesson list", async () => {
  assert.equal((await fixture({ courses: [] }).handler(request({ operation: "courses.get", courseId: COURSE_ID }))).status, 404);
  const f = fixture({ courses: [course({ current_version_id: null })] });
  const response = await f.handler(request({ operation: "courses.get", courseId: COURSE_ID }));
  assert.deepEqual((await response.json()).data.lessons, []);
  assert.equal(f.calls.some((call) => call.url.pathname.endsWith("/course_blocks")), false);
});

test("large lesson catalogs are explicitly marked truncated", async () => {
  const block = { id: COURSE_ID, title: null, block_type: "text", sort_order: 1, organization_id: null };
  const response = await fixture({ blocks: Array.from({ length: 201 }, () => block) }).handler(request({ operation: "courses.get", courseId: COURSE_ID }));
  const { data } = await response.json();
  assert.equal(data.lessons.length, 200);
  assert.equal(data.lessonsTruncated, true);
});

test("unavailable upstreams, bad counts and oversized responses return safe errors", async () => {
  for (const override of [
    { networkError: true }, { countError: true },
    { rawResponse: () => new Response("x".repeat(2 * 1024 * 1024 + 1)) },
  ]) {
    const response = await fixture(override).handler(request());
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.equal(body.includes("sb_secret"), false);
    assert.equal(body.includes("sensitive"), false);
  }
});

test("real HTTP route stays separate from provider routes and enforces ingress limits", async (t) => {
  const f = fixture();
  const router = createPlatformAdminRouter({ config: config(), fetcher: f.fetcher, now: () => new Date(NOW) });
  const server = createServer(async (req, res) => {
    if (!await router(req, res, new URL(req.url, "http://fixture").pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/platform-admin/read`;
  for (const [init, status] of [
    [{ method: "GET" }, 405], [{ method: "OPTIONS" }, 405],
    [{ method: "POST", body: "x".repeat(2049) }, 413],
    [{ method: "POST", headers: { "Content-Encoding": "gzip" }, body: "x" }, 415],
  ]) assert.equal((await fetch(url, init)).status, status);
  assert.equal(f.calls.length, 0);
  assert.equal((await fetch(url, { method: "POST", headers: { Authorization: "Bearer fixture.jwt.token", "Content-Type": "application/json" }, body: '{"operation":"overview"}' })).status, 200);
  assert.equal((await fetch(url.replace("/read", "/unknown"), { method: "POST" })).status, 404);
});
