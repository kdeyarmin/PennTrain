import assert from "node:assert/strict";
import test from "node:test";
import { createPlatformAdminHandler, readPlatformAdminConfig } from "./platform-admin.mjs";

const ID = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const [HUB, ACTOR, ORG, ACCOUNT, SUB, INVOICE] = [1, 2, 3, 4, 5, 6].map(ID);
const NOW = "2026-09-11T18:00:00.000Z";
const ENV = { CAREMETRIC_ADMIN_ENABLED: "true", HUB_SUPABASE_URL: "https://hub.fixture.test",
  HUB_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_URL: "https://native.fixture.test",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture", CAREMETRIC_ADMIN_IDENTITY_MAP_JSON: JSON.stringify({ [HUB]: ACTOR }), STRIPE_SECRET_KEY: "sk_test_fixture" };
const request = (body, headers = {}, signal) => new Request("https://cmcarebase.com/api/platform-admin/read", {
  method: "POST", headers: { authorization: "Bearer fixture.jwt", "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal,
});
const getInvoice = { operation: "billing.invoices.get", id: INVOICE };
const verify = { operation: "billing.subscriptions.verify", id: SUB };

function fixture(overrides = {}, env = {}) {
  const account = { id: ACCOUNT, organization_id: ORG, stripe_customer_id: "cus_fixture", billing_state: "comped",
    state_source: "manual_comp", comped_until: NOW, grace_ends_at: null, updated_at: NOW };
  const subscription = { id: SUB, organization_id: ORG, billing_account_id: ACCOUNT, package_id: null,
    stripe_subscription_id: "sub_fixture", provider_status: "active", billing_state: "active", is_provider_placeholder: false,
    current_period_end: null, updated_at: NOW, organization: { id: ORG, name: "Example SaaS" }, account, package: null };
  const state = { profileActive: true, account, subscription,
    invoice: { id: INVOICE, organization_id: ORG, subscription_id: SUB, stripe_subscription_id: "sub_fixture", stripe_invoice_id: "in_fixture",
      provider_status: "open", currency: "jpy", amount_due: "9223372036854775807", amount_paid: "0", amount_remaining: "9223372036854775807",
      issued_at: null, due_at: null, paid_at: null, updated_at: NOW, organization: { id: ORG, name: "Example SaaS" },
      subscription: { id: SUB, organization_id: ORG, billing_account_id: ACCOUNT, stripe_subscription_id: "sub_fixture" }, hosted_invoice_url: "sensitive-url", provider_event_id: "sensitive-event" },
    providerInvoice: { id: "in_fixture", object: "invoice", customer: "cus_fixture", parent: { type: "subscription_details", subscription_details: { subscription: "sub_fixture" } },
      status: "open", currency: "jpy", amount_due: 0, amount_paid: 0, amount_remaining: 0, created: 1789149600, due_date: null, status_transitions: { paid_at: null }, livemode: false,
      invoice_pdf: "sensitive-pdf", hosted_invoice_url: "sensitive-url", customer_email: "sensitive-email", lines: { data: [{ description: "sensitive-line" }] } },
    providerSubscription: { id: "sub_fixture", object: "subscription", customer: "cus_fixture", status: "active", cancel_at_period_end: false, canceled_at: null, livemode: true, metadata: { secret: "sensitive-metadata" } },
    ...overrides };
  const calls = [];
  const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
  const fetcher = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input), headers = new Headers(init.headers), method = init.method ?? "GET";
    calls.push({ url, method, headers, signal: init.signal });
    assert.equal(init.redirect, "error");
    if (url.origin === "https://api.stripe.com") {
      assert.equal(method, "GET");
      assert.equal(headers.get("authorization"), "Bearer sk_test_fixture");
      assert.equal(headers.get("stripe-version"), "2026-02-25.clover");
      assert.equal(headers.has("apikey"), false);
      assert.equal(headers.has("stripe-account"), false);
      assert.equal(url.search, "");
      if (state.timeout) return new Promise((resolve, reject) => {
        const keepAlive = setInterval(() => {}, 1000);
        init.signal.addEventListener("abort", () => { clearInterval(keepAlive); reject(init.signal.reason); }, { once: true });
      });
      if (state.providerThrow) throw new Error("sensitive-provider-error sk_test_fixture");
      if (state.providerStatus) return json({ error: { message: "sensitive-error" } }, state.providerStatus);
      if (state.providerRaw !== undefined) return new Response(state.providerRaw);
      assert.ok(["/v1/invoices/in_fixture", "/v1/subscriptions/sub_fixture"].includes(url.pathname));
      if (url.pathname.includes("/invoices/")) {
        // Real JSON numeric tokens above Number.MAX_SAFE_INTEGER; never construct a rounded JS number.
        return new Response(JSON.stringify(state.providerInvoice).replace('"amount_due":0', '"amount_due":9223372036854775807')
          .replace('"amount_remaining":0', '"amount_remaining":9223372036854775807'));
      }
      return json(state.providerSubscription);
    }
    if (url.origin === "https://support-hub-web-production.up.railway.app") {
      assert.equal(url.pathname, "/api/internal/admin/authorize");
      return json({ user_id: HUB, role: "platform_admin", method: "sms", operation: state.approvedOperation });
    }
    if (url.origin === ENV.HUB_SUPABASE_URL) {
      assert.equal(url.pathname, "/rest/v1/rpc/authorize_platform_admin");
      return state.hubRevoked ? json({ code: "42501" }, 403) : json({ user_id: HUB, role: "platform_admin", aal: "aal2" });
    }
    assert.equal(url.origin, ENV.SUPABASE_URL);
    assert.equal(headers.get("apikey"), "sb_secret_fixture");
    assert.equal(method, "GET");
    if (url.pathname === `/auth/v1/admin/users/${ACTOR}`) return json({ user: { id: ACTOR, is_anonymous: false, banned_until: null } });
    if (url.pathname === "/rest/v1/profiles") return json([{ id: ACTOR, role: "platform_admin", is_active: state.profileActive }]);
    if (state.databaseError) return json({ code: "bad_schema", message: "sensitive-database-error" }, 400);
    if (url.pathname === "/rest/v1/billing_accounts") {
      assert.equal(url.searchParams.get("organization_id"), `eq.${ORG}`);
      return json(state.account ? [state.account] : []);
    }
    if (url.pathname === "/rest/v1/billing_subscriptions") {
      if (url.searchParams.has("id")) {
        assert.equal(url.searchParams.get("id"), `eq.${SUB}`);
        assert.equal(url.searchParams.get("is_provider_placeholder"), "eq.false");
      } else {
        assert.equal(url.searchParams.get("stripe_subscription_id"), "eq.sub_fixture");
        assert.equal(url.searchParams.get("organization_id"), `eq.${ORG}`);
      }
      return json(state.subscription ? [state.subscription] : []);
    }
    assert.equal(url.pathname, "/rest/v1/billing_invoices");
    for (const field of ["amount_due", "amount_paid", "amount_remaining"]) assert.ok(url.searchParams.get("select").includes(`${field}::text`));
    if (url.searchParams.has("id")) assert.equal(url.searchParams.get("id"), `eq.${INVOICE}`);
    const rows = state.invoice ? [state.invoice] : [];
    return json(rows, 200, state.missingCount ? {} : { "Content-Range": `0-${rows.length - 1}/${rows.length}` });
  };
  const config = readPlatformAdminConfig(name => ({ ...ENV, ...env })[name]);
  return { state, calls, handler: createPlatformAdminHandler({ config, fetcher, now: () => new Date(NOW) }) };
}

async function data(f, body) {
  const response = await f.handler(request(body));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const raw = await response.text();
  assert.doesNotMatch(raw, /sensitive-|sk_test_|sb_secret_/);
  return JSON.parse(raw).data;
}

test("invoice inventory keeps exact bigint text, legacy nulls and bounded stable literal search without provider calls", async () => {
  const f = fixture();
  const result = await data(f, { operation: "billing.invoices.list", limit: 50, offset: 10000, search: "  100%_x\\,id.eq.secret  " });
  assert.equal(result.source, "application_database");
  assert.equal(result.total, 1);
  assert.equal(result.items[0].amountDueMinor, "9223372036854775807");
  assert.equal(result.items[0].currency, "jpy");
  assert.equal(result.items[0].dueAt, null);
  const query = f.calls.find(call => call.url.pathname.endsWith("/billing_invoices")).url.searchParams;
  assert.equal(query.get("order"), "updated_at.desc,id.asc");
  assert.equal(query.get("limit"), "50");
  assert.equal(query.get("offset"), "10000");
  assert.equal(query.get("stripe_invoice_id"), "ilike.%100\\%\\_x\\\\,id.eq.secret%");
  assert.equal(f.calls.some(call => call.url.hostname === "api.stripe.com"), false);
});

test("provider invoice check preserves raw high integer tokens and exact association before projecting", async () => {
  const result = await data(fixture(), getInvoice);
  assert.equal(result.provider.availability, "available");
  assert.equal(result.provider.apiVersion, "2026-02-25.clover");
  assert.equal(result.provider.data.amountDueMinor, "9223372036854775807");
  assert.equal(result.provider.data.livemode, false);
  assert.deepEqual(result.comparison, { status: "matches", fields: [] });
  assert.deepEqual(Object.keys(result.provider.data), ["id", "customerId", "subscriptionId", "status", "currency", "amountDueMinor", "amountPaidMinor", "amountRemainingMinor", "createdAt", "dueAt", "paidAt", "livemode"]);
});

test("subscription check preserves manual application access independently of live provider status", async () => {
  const f = fixture();
  f.state.providerSubscription.status = "canceled";
  const result = await data(f, verify);
  assert.equal(result.recorded.status, "active");
  assert.equal(result.provider.data.status, "canceled");
  assert.equal(result.provider.data.livemode, true);
  assert.deepEqual(result.applicationAccess, { billingState: "comped", stateSource: "manual_comp", compedUntil: NOW, graceEndsAt: null, updatedAt: NOW });
  assert.deepEqual(result.comparison, { status: "differences", fields: ["providerStatus"] });
  assert.ok(f.calls.every(call => call.method === "GET" || call.url.pathname.endsWith("authorize_platform_admin")));
});

test("invoice differences report only allowlisted scalar fields, never amount totals across currencies", async () => {
  const f = fixture();
  Object.assign(f.state.providerInvoice, { currency: "usd", status: "paid", amount_paid: 500 });
  const result = await data(f, getInvoice);
  assert.deepEqual(result.comparison, { status: "differences", fields: ["status", "currency", "amountPaidMinor"] });
});

for (const [label, patch] of [
  ["invoice ID", { id: "in_other" }], ["customer", { customer: "cus_other" }],
  ["subscription", { parent: { type: "subscription_details", subscription_details: { subscription: "sub_other" } } }],
]) test(`provider invoice with wrong ${label} exposes no provider data`, async () => {
  const f = fixture(); Object.assign(f.state.providerInvoice, patch);
  const result = await data(f, getInvoice);
  assert.equal(result.provider.availability, "identity_mismatch");
  assert.equal(result.provider.data, null);
  assert.deepEqual(result.comparison, { status: "not_checked", fields: [] });
});

test("wrong subscription/customer and local account associations cannot cross products", async () => {
  for (const patch of [{ id: "sub_other" }, { customer: "cus_other" }]) {
    const f = fixture(); Object.assign(f.state.providerSubscription, patch);
    assert.equal((await data(f, verify)).provider.availability, "identity_mismatch");
  }
  const f = fixture(); f.state.invoice.subscription.billing_account_id = ID(90);
  assert.equal((await data(f, getInvoice)).provider.availability, "identity_mismatch");
  assert.equal(f.calls.some(call => call.url.hostname === "api.stripe.com"), false);
});

test("standalone legacy invoices and delayed native subscription links are explicit", async () => {
  const f = fixture();
  Object.assign(f.state.invoice, { subscription_id: null, stripe_subscription_id: null, subscription: null });
  f.state.providerInvoice.parent = null;
  let result = await data(f, getInvoice);
  assert.equal(result.recorded.subscriptionId, null);
  assert.equal(result.recorded.providerSubscriptionId, null);
  assert.equal(result.provider.data.subscriptionId, null);
  f.state.invoice.stripe_subscription_id = "sub_fixture";
  f.state.providerInvoice.parent = { type: "subscription_details", subscription_details: { subscription: "sub_fixture" } };
  result = await data(f, getInvoice);
  assert.equal(result.recorded.subscriptionId, null);
  assert.equal(result.provider.availability, "available");
});

for (const [label, override, env, expected] of [
  ["absent key", {}, { STRIPE_SECRET_KEY: undefined }, "unconfigured"],
  ["network failure", { providerThrow: true }, {}, "unavailable"],
  ["rate limit", { providerStatus: 429 }, {}, "unavailable"],
  ["provider authorization failure", { providerStatus: 401 }, {}, "unavailable"],
  ["provider not found", { providerStatus: 404 }, {}, "notfound"],
  ["bad JSON", { providerRaw: "invalid JSON" }, {}, "unavailable"],
  ["oversize response", { providerRaw: "x".repeat(2 * 1024 * 1024 + 1) }, {}, "unavailable"],
]) test(`${label} preserves recorded invoices and subscriptions without fabricated provider zeroes`, async () => {
  const f = fixture(override, env);
  for (const operation of [getInvoice, verify]) {
    const result = await data(f, operation);
    assert.equal(result.provider.availability, expected);
    assert.equal(result.provider.data, null);
    assert.deepEqual(result.comparison, { status: "not_checked", fields: [] });
  }
});

test("provider deadline returns recorded values and cancels the provider request", async () => {
  const f = fixture({ timeout: true }); const started = Date.now();
  const result = await data(f, getInvoice);
  assert.equal(result.provider.availability, "unavailable");
  assert.ok(Date.now() - started < 6500);
  assert.equal(f.calls.find(call => call.url.hostname === "api.stripe.com").signal.aborted, true);
});

test("provider malformed monetary values, dates and old API shape stay unavailable", async () => {
  for (const patch of [{ amount_paid: -1 }, { amount_paid: 1.5 }, { amount_paid: "00" }, { amount_paid: "9223372036854775808" },
    { created: null }, { livemode: null }, { parent: undefined, subscription: "sub_fixture" }]) {
    const f = fixture(); Object.assign(f.state.providerInvoice, patch);
    assert.equal((await data(f, getInvoice)).provider.availability, "unavailable");
  }
});

test("source failures and invalid joined scope cannot appear as empty success", async () => {
  for (const state of [{ databaseError: true }, { missingCount: true }]) {
    const f = fixture(state); assert.equal((await f.handler(request({ operation: "billing.invoices.list" }))).status, 503);
  }
  for (const patch of [{ amount_due: 9223372036854776000 }, { amount_paid: "-1" }, { organization: { id: ID(99), name: "wrong" } },
    { subscription: { id: SUB, organization_id: ID(99) } }]) {
    const f = fixture(); Object.assign(f.state.invoice, patch);
    assert.equal((await f.handler(request(getInvoice))).status, 502);
    assert.equal(f.calls.some(call => call.url.hostname === "api.stripe.com"), false);
  }
  assert.equal((await fixture({ invoice: null }).handler(request(getInvoice))).status, 404);
});

test("all billing reads recheck current actors; SMS intent cannot be switched to a different native ID", async () => {
  const f = fixture();
  await data(f, getInvoice);
  f.state.profileActive = false;
  assert.equal((await f.handler(request(getInvoice))).status, 403);
  f.state.profileActive = true; f.state.hubRevoked = true;
  assert.equal((await f.handler(request(verify))).status, 403);
  assert.equal(f.calls.filter(call => call.url.hostname === "api.stripe.com").length, 1);
  const sms = fixture({ approvedOperation: { ...getInvoice, id: ID(99) } });
  assert.equal((await sms.handler(request(getInvoice, { authorization: "Bearer cmh_" + "a".repeat(43) }))).status, 403);
  assert.equal(sms.calls.length, 1);
  sms.state.approvedOperation = getInvoice;
  assert.equal((await sms.handler(request(getInvoice, { authorization: "Bearer cmh_" + "a".repeat(43) }))).status, 200);
});

test("closed requests reject arbitrary provider IDs, URLs, mutation names and excess bounds before authorization", async () => {
  const f = fixture();
  for (const operation of [
    { ...getInvoice, id: "in_fixture" }, { ...verify, id: "sub_fixture" }, { ...getInvoice, url: "https://other.test" },
    { ...getInvoice, organizationId: ORG }, { operation: "billing.invoices.pay", id: INVOICE },
    ...[{ limit: 51 }, { offset: 10001 }, { search: "*" }, { search: "x\n" }, { search: "x".repeat(101) }].map(extra => ({ operation: "billing.invoices.list", ...extra })),
  ]) assert.equal((await f.handler(request(operation))).status, 400);
  assert.equal((await f.handler(request(getInvoice, { origin: "https://hub.example.test" }))).status, 403);
  assert.equal(f.calls.length, 0);
});
