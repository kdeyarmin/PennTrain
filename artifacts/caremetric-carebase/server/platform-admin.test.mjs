import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createPlatformAdminHandler, createPlatformAdminRouter, readPlatformAdminConfig } from "./platform-admin.mjs";

const HUB_ID = "11111111-1111-4111-8111-111111111111";
const NATIVE_ID = "22222222-2222-4222-8222-222222222222";
const COURSE_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const ORGANIZATION_ID = "55555555-5555-4555-8555-555555555555";
const ACCOUNT_ID = "66666666-6666-4666-8666-666666666666";
const PACKAGE_ID = "77777777-7777-4777-8777-777777777777";
const SUBSCRIPTION_ID = "88888888-8888-4888-8888-888888888888";
const READS = ["capabilities", "overview", "courses.list", "courses.get", "organizations.list", "users.list", "billing.overview", "billing.subscriptions.list", "billing.invoices.list", "billing.invoices.get", "billing.subscriptions.verify"];
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
const organization = (overrides = {}) => ({ id: ORGANIZATION_ID, name: "Care Example", slug: "care-example", subscription_status: "active", created_at: NOW, contact_phone: "private-phone", ...overrides });
const accountProfile = (overrides = {}) => ({ id: COURSE_ID, first_name: "Pat", last_name: "Account", email: "pat@example.test", role: "org_admin", is_active: false, created_at: NOW, phone: "private-phone", ...overrides });
const subscription = (overrides = {}) => ({
  id: SUBSCRIPTION_ID, organization_id: ORGANIZATION_ID, billing_account_id: ACCOUNT_ID, package_id: PACKAGE_ID,
  billing_state: "canceled", provider_status: "canceled", stripe_subscription_id: "sub_fixture", current_period_end: NOW,
  updated_at: NOW, is_provider_placeholder: false, organization: { id: ORGANIZATION_ID, name: "Care Example" },
  account: { id: ACCOUNT_ID, organization_id: ORGANIZATION_ID, stripe_customer_id: "cus_fixture" }, package: { id: PACKAGE_ID, name: "Team" },
  provider_event_id: "private-event", hosted_invoice_url: "https://private.example.test/invoice", ...overrides,
});

/** Exercise real supabase-js HTTP query construction, not a mock chain mirroring the implementation. */
function fixture(overrides = {}) {
  const calls = [];
  const state = {
    actor: { user_id: HUB_ID, role: "platform_admin", aal: "aal2" },
    profile: { id: NATIVE_ID, role: "platform_admin", is_active: true },
    user: { id: NATIVE_ID, is_anonymous: false, banned_until: null },
    courses: [course()], version: { id: VERSION_ID },
    organizations: [organization()], profiles: [accountProfile()], subscriptions: [subscription()],
    subscriptionCount: 1, billingCounts: { trial: 0, active: 0, grace: 0, past_due: 0, canceled: 1, comped: 0, suspended: 0 },
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
      if (table === "billing_subscriptions") {
        assert.equal(url.searchParams.get("is_provider_placeholder"), "eq.false");
        const stateFilter = url.searchParams.get("billing_state");
        const count = stateFilter ? state.billingCounts[stateFilter.slice(3)] : state.subscriptionCount;
        return new Response(null, { status: state.countError ? 500 : 200, headers: { "Content-Range": `*/${count}` } });
      }
      return new Response(null, { status: state.countError ? 500 : 200, headers: { "Content-Range": `0-0/${{ organizations: 3, profiles: 7, courses: 80 }[table]}` } });
    }
    if (table === "organizations" || table === "billing_subscriptions" || (table === "profiles" && !url.searchParams.has("id"))) {
      assert.equal(method, "GET");
      const rows = state[table === "billing_subscriptions" ? "subscriptions" : table];
      return state.directoryError ? json({ code: "private-upstream" }, 503)
        : json(rows, 200, state.missingCount ? {} : { "Content-Range": `0-${rows.length - 1}/${rows.length}` });
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

test("capabilities require the same authorization and report only an actual deployment revision", async () => {
  const f = fixture();
  const data = (await (await f.handler(request({ operation: "capabilities" }))).json()).data;
  assert.deepEqual(data, { apiVersion: 1, operations: READS, sourceRevision: null });
  assert.equal(f.calls.length, 3);
  assert.equal(config({ RAILWAY_GIT_COMMIT_SHA: "abcdef01".repeat(5) }).sourceRevision, "abcdef01".repeat(5));
  for (const revision of ["main", "abcdef0", "https://private.example.test", "f".repeat(41)]) {
    assert.equal(config({ RAILWAY_GIT_COMMIT_SHA: revision }).sourceRevision, null);
  }
  const withRevision = createPlatformAdminHandler({ config: config({ RAILWAY_GIT_COMMIT_SHA: "ABCDEF01".repeat(5) }), fetcher: f.fetcher });
  assert.equal((await (await withRevision(request({ operation: "capabilities" }))).json()).data.sourceRevision, "abcdef01".repeat(5));
});

test("organization and account directories project intentional account fields without clinical or Auth data", async () => {
  const f = fixture();
  const org = await f.handler(request({ operation: "organizations.list" }));
  assert.equal(org.status, 200);
  assert.deepEqual((await org.json()).data, { items: [{ id: ORGANIZATION_ID, name: "Care Example", slug: "care-example", status: "active", createdAt: NOW }], total: 1, limit: 25, offset: 0 });
  const users = await f.handler(request({ operation: "users.list" }));
  assert.equal(users.status, 200);
  assert.deepEqual((await users.json()).data, { items: [{ id: COURSE_ID, displayName: "Pat Account", email: "pat@example.test", role: "org_admin", status: "inactive", createdAt: NOW }], total: 1, limit: 25, offset: 0 });
  assert.equal(f.calls.find((call) => call.url.pathname.endsWith("/organizations")).url.searchParams.get("select"), "id,name,slug,subscription_status,created_at");
  assert.equal(f.calls.find((call) => call.url.pathname.endsWith("/profiles") && !call.url.searchParams.has("id")).url.searchParams.get("select"), "id,first_name,last_name,email,role,is_active,created_at");
  assert.equal(f.calls.filter((call) => call.url.pathname.includes("/auth/v1/")).length, 2); // mapped actor only, never an account scan
});

test("empty profile names and nullable metadata remain explicit; active status describes the profile flag", async () => {
  const f = fixture({ profiles: [accountProfile({ first_name: "", last_name: "", is_active: true, created_at: null })] });
  const result = (await (await f.handler(request({ operation: "users.list" }))).json()).data.items[0];
  assert.equal(result.displayName, null);
  assert.equal(result.createdAt, null);
  assert.equal(result.status, "active");
});

for (const [operation, table, column, order] of [
  ["organizations.list", "organizations", "name", "name.asc,id.asc"],
  ["users.list", "profiles", "email", "email.asc,id.asc"],
  ["billing.subscriptions.list", "billing_subscriptions", "stripe_subscription_id", "updated_at.desc,id.asc"],
]) test(`${operation} uses bounded stable paging and treats filter syntax as literal search text`, async () => {
  const f = fixture();
  const response = await f.handler(request({ operation, limit: 50, offset: 10_000, search: "  100%_x\\,id.eq.secret  " }));
  assert.equal(response.status, 200);
  const call = f.calls.find((entry) => entry.url.pathname === `/rest/v1/${table}` && !entry.url.searchParams.has("id"));
  assert.equal(call.url.searchParams.get(column), "ilike.%100\\%\\_x\\\\,id.eq.secret%");
  assert.equal(call.url.searchParams.has("or"), false);
  assert.equal(call.url.searchParams.get("order"), order);
  assert.equal(call.url.searchParams.get("limit"), "50");
  assert.equal(call.url.searchParams.get("offset"), "10000");
  assert.equal((await response.json()).data.offset, 10_000);
});

test("all directory request shapes refuse tenant selectors, mutations and unbounded pagination before any upstream call", async () => {
  const f = fixture();
  for (const operation of ["organizations.list", "users.list", "billing.subscriptions.list"]) {
    for (const extra of [{ organizationId: ORGANIZATION_ID }, { status: "active" }, { limit: 0 }, { offset: 10_001 },
      { limit: "25" }, { offset: -1 }, { search: "x".repeat(101) }, { search: "*" }, { search: "bad\nsearch" }, { action: "delete" }]) {
      assert.equal((await f.handler(request({ operation, ...extra }))).status, 400);
    }
  }
  for (const body of [{ operation: "billing.overview", search: "x" }, { operation: "capabilities", product: "carebase" },
    { operation: "billing.subscriptions.cancel" }, { operation: "organizations.update" }]) {
    assert.equal((await f.handler(request(body))).status, 400);
  }
  assert.equal(f.calls.length, 0);
});

test("billing lists historical application records with separate cached provider state and strict joined identity checks", async () => {
  const f = fixture();
  const response = await f.handler(request({ operation: "billing.subscriptions.list" }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { source: "application_database", items: [{
    id: SUBSCRIPTION_ID, organizationId: ORGANIZATION_ID, organizationName: "Care Example", planCode: null, planName: "Team",
    status: "canceled", providerStatus: "canceled", providerCustomerId: "cus_fixture", providerSubscriptionId: "sub_fixture",
    currentPeriodEnd: NOW, updatedAt: NOW,
  }], total: 1, limit: 25, offset: 0 });
  const call = f.calls.find((entry) => entry.url.pathname.endsWith("/billing_subscriptions"));
  assert.equal(call.url.searchParams.get("is_provider_placeholder"), "eq.false");
  assert.equal(call.url.searchParams.has("provider_status"), false); // historical canceled rows intentionally remain visible
  assert.equal(call.url.searchParams.get("select").includes("*"), false);
  // Two package foreign keys exist; an unqualified join is ambiguous in PostgREST.
  assert.ok(call.url.searchParams.get("select").includes("package:packages!billing_subscriptions_package_id_fkey(id,name)"));
  assert.equal(f.calls.every((entry) => entry.url.origin === ENV.SUPABASE_URL || entry.url.origin === ENV.HUB_SUPABASE_URL), true);
  assert.equal(f.calls.filter((entry) => entry.method !== "GET").length, 1); // Hub authorization RPC is the sole POST
});

test("subscriptions without a mapped package or provider customer retain nulls and never infer plan or revenue", async () => {
  const f = fixture({ subscriptions: [subscription({ package: null, package_id: null, account: { id: ACCOUNT_ID, organization_id: ORGANIZATION_ID, stripe_customer_id: null }, current_period_end: null })] });
  const response = await f.handler(request({ operation: "billing.subscriptions.list" }));
  assert.equal(response.status, 200);
  const row = (await response.json()).data.items[0];
  assert.equal(row.planCode, null);
  assert.equal(row.planName, null);
  assert.equal(row.providerCustomerId, null);
  assert.equal(row.currentPeriodEnd, null);
  assert.equal(row.amount, undefined);
});

test("billing overview counts the complete nonplaceholder inventory by recorded application state", async () => {
  const f = fixture({ subscriptionCount: 9, billingCounts: { trial: 1, active: 2, grace: 0, past_due: 1, canceled: 3, comped: 1, suspended: 1 } });
  const response = await f.handler(request({ operation: "billing.overview" }));
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.source, "application_database");
  assert.equal(data.subscriptionCount, 9);
  assert.equal(data.statusCounts.reduce((sum, state) => sum + state.count, 0), 9);
  assert.equal(data.statusCounts.find((state) => state.status === "canceled").count, 3);
  assert.equal(f.calls.filter((call) => call.method === "HEAD").length, 8);
  assert.equal(f.calls.some((call) => call.url.pathname.includes("billing_invoices")), false);
});

test("failed, malformed or racing billing counts never masquerade as an empty successful overview", async () => {
  for (const override of [{ countError: true }, { subscriptionCount: 2 }, { subscriptionCount: null },
    { billingCounts: { trial: 0, active: 0, grace: 0, past_due: 0, canceled: -1, comped: 0, suspended: 0 } }]) {
    const response = await fixture(override).handler(request({ operation: "billing.overview" }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: "upstream" } });
  }
  const empty = fixture({ subscriptionCount: 0, billingCounts: { trial: 0, active: 0, grace: 0, past_due: 0, canceled: 0, comped: 0, suspended: 0 } });
  assert.equal((await (await empty.handler(request({ operation: "billing.overview" }))).json()).data.subscriptionCount, 0);
});

test("directory errors, invalid source contracts and overlarge result pages return no account records", async () => {
  for (const [operation, override] of [
    ["organizations.list", { directoryError: true }], ["users.list", { missingCount: true }],
    ["organizations.list", { organizations: [organization({ id: "bad-id" })] }],
    ["users.list", { profiles: [accountProfile({ created_at: "not-a-date" })] }],
    ["users.list", { profiles: [accountProfile({ is_active: null })] }],
    ["users.list", { profiles: Array.from({ length: 26 }, () => accountProfile()) }],
    ["billing.subscriptions.list", { subscriptions: [subscription({ is_provider_placeholder: true })] }],
    ["billing.subscriptions.list", { subscriptions: [subscription({ account: { id: ACCOUNT_ID, organization_id: COURSE_ID, stripe_customer_id: "private-cross-org" } })] }],
    ["billing.subscriptions.list", { subscriptions: [subscription({ organization: { id: COURSE_ID, name: "private-cross-org" } })] }],
    ["billing.subscriptions.list", { subscriptions: [subscription({ package: { id: COURSE_ID, name: "private-plan" } })] }],
    ["billing.subscriptions.list", { subscriptions: [subscription({ billing_state: "new-unknown-state" })] }],
  ]) {
    const response = await fixture(override).handler(request({ operation }));
    assert.ok(response.status === 502 || response.status === 503, operation);
    assert.deepEqual(await response.json(), { error: { code: "upstream" } });
  }
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
  for (const operation of status === 503 ? ["overview"] : READS) {
    const response = await f.handler(request({ operation, ...(operation === "courses.get" ? { courseId: COURSE_ID }
      : ["billing.invoices.get", "billing.subscriptions.verify"].includes(operation) ? { id: SUBSCRIPTION_ID } : {}) }));
    assert.equal(response.status, status, operation);
  }
  assert.equal(f.calls.some((call) => call.url.origin === ENV.SUPABASE_URL
    && call.url.pathname !== `/auth/v1/admin/users/${NATIVE_ID}`
    && !(call.url.pathname === "/rest/v1/profiles" && call.url.searchParams.get("id") === `eq.${NATIVE_ID}`)), false);
});

test("tenant scope, mutations, unknown fields, pagination and malformed ids are rejected before auth", async () => {
  const f = fixture();
  for (const body of [
    { operation: "overview", organizationId: NATIVE_ID }, { operation: "users.delete" }, { operation: "courses.create" },
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
