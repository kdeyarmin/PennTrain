import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { createProviderHandlers } from "./provider-handlers.mjs";
import { phase2StripeGet, phase2StripePost } from "../../../supabase/functions/_shared/phase2Billing.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const CHALLENGE = "33333333-3333-4333-8333-333333333333";
const PHONE = "+12025550123";
const ENV = {
  VITE_SUPABASE_URL: "https://database.example.test",
  VITE_SUPABASE_ANON_KEY: "test-public-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "test-twilio-token",
  TWILIO_VERIFY_SERVICE_SID: `VA${"b".repeat(32)}`,
  STRIPE_SECRET_KEY: "sk_test_fixture",
  STRIPE_BILLING_WEBHOOK_SECRET: "whsec_fixture",
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_fixture",
  CRON_SHARED_SECRET: "test-cron-secret",
};
const bearer = (claims = {}) => `Bearer header.${Buffer.from(JSON.stringify({
  sub: USER, session_id: SESSION, aal: "aal1", ...claims,
})).toString("base64url")}.test-signature`;
const request = (body, { authorization = bearer(), ...options } = {}) => new Request(
  "https://cmcarebase.com/api/providers/sms-mfa", {
    method: "POST", ...options,
    headers: { authorization, ...options.headers },
    body: JSON.stringify(body),
  },
);
const forbidden = () => assert.fail("unexpected client or provider operation");
function handlers(options = {}) {
  return createProviderHandlers({
    getEnv: (name) => ENV[name], createClient: forbidden, fetcher: forbidden,
    ...options,
  });
}
function assertServerClient(options) {
  assert.equal(options.auth.persistSession, false);
  assert.equal(options.auth.autoRefreshToken, false);
  assert.equal(options.auth.detectSessionInUrl, false);
  assert.equal(typeof options.global.fetch, "function");
}
function smsSetup({ env = ENV, rpcError, fetcher, authError = false } = {}) {
  const clients = [];
  const calls = [];
  const providerCalls = [];
  const map = handlers({
    getEnv: (name) => env[name],
    createClient: (url, key, options) => {
      clients.push({ url, key, options });
      return {
        auth: { getUser: async () => ({ data: { user: { id: USER } }, error: authError }) },
        rpc: async (name, args) => {
          calls.push({ name, args, key });
          if (rpcError) return { data: null, error: rpcError };
          const data = name === "get_my_mfa_status"
            ? { verified: false, smsFactors: [] }
            : { challengeId: CHALLENGE, phone: PHONE, expiresAt: "2026-09-09T01:10:00Z" };
          return { data, error: null };
        },
      };
    },
    fetcher: async (url, init) => {
      providerCalls.push({ url, init });
      if (fetcher) return fetcher(url, init);
      return new Response(JSON.stringify({
        sid: `VE${"c".repeat(32)}`, account_sid: env.TWILIO_ACCOUNT_SID,
        service_sid: env.TWILIO_VERIFY_SERVICE_SID,
        to: PHONE, channel: "sms", status: "pending",
      }));
    },
  });
  return { map, clients, calls, providerCalls };
}

test("Node loads all four shared handlers without a Deno global", async () => {
  assert.equal(typeof globalThis.Deno, "undefined");
  const map = handlers();
  assert.deepEqual([...map.keys()], [
    "sms-mfa", "create-billing-session", "stripe-billing-webhook", "sync-billing-quantities",
  ]);
  for (const handler of map.values()) {
    const response = await handler(new Request("https://cmcarebase.com", { method: "GET" }));
    assert.equal(response.status, 405);
  }
});

test("missing server configuration and missing auth fail closed before remote work", async () => {
  const empty = handlers({ getEnv: () => undefined });
  assert.equal((await empty.get("sms-mfa")(request({ action: "send" }))).status, 503);
  assert.equal((await empty.get("create-billing-session")(request({ action: "checkout" }))).status, 503);
  assert.equal((await empty.get("stripe-billing-webhook")(request({}))).status, 400);
  assert.equal((await empty.get("sync-billing-quantities")(request({}))).status, 500);
  const configured = handlers();
  assert.equal((await configured.get("sms-mfa")(request({}, { authorization: "" }))).status, 401);
  assert.equal((await configured.get("create-billing-session")(request({}, { authorization: "" }))).status, 401);
});

test("SMS caller and session verification precede database or provider use", async () => {
  for (const options of [
    { authError: true },
    { claims: { sub: "another-user" } },
    { claims: { session_id: "invalid-session" } },
  ]) {
    const setup = smsSetup(options);
    const response = await setup.map.get("sms-mfa")(request({ action: "send" }, {
      authorization: bearer(options.claims),
    }));
    assert.equal(response.status, 401);
    assert.deepEqual(setup.calls, []);
    assert.deepEqual(setup.providerCalls, []);
  }
});

test("Railway public env aliases preserve verified identity and isolated server clients", async () => {
  const setup = smsSetup();
  const response = await setup.map.get("sms-mfa")(request({
    action: "send", profileId: "forged", sessionId: "forged", nativeAal2: true,
  }));
  assert.equal(response.status, 200);
  assert.equal(setup.clients.length, 2);
  assert.equal(setup.clients[0].url, ENV.VITE_SUPABASE_URL);
  assert.equal(setup.clients[0].key, ENV.VITE_SUPABASE_ANON_KEY);
  assert.equal(setup.clients[1].key, ENV.SUPABASE_SERVICE_ROLE_KEY);
  for (const { options } of setup.clients) assertServerClient(options);
  assert.equal(setup.clients[0].options.global.headers.Authorization, bearer());
  assert.equal(setup.clients[1].options.global.headers, undefined);
  assert.deepEqual(setup.calls[0].args, {
    p_profile_id: USER, p_session_id: SESSION, p_phone: null, p_native_aal2: false,
  });
  assert.equal(setup.providerCalls[0].url,
    `https://verify.twilio.com/v2/Services/${ENV.TWILIO_VERIFY_SERVICE_SID}/Verifications`);
  assert.deepEqual(Object.fromEntries(setup.providerCalls[0].init.body), { To: PHONE, Channel: "sms" });
  assert.equal(setup.calls[1].name, "activate_sms_mfa_challenge");
});

test("explicit server env wins over public aliases and missing private keys never use public keys", async () => {
  const setup = smsSetup({ env: { ...ENV, SUPABASE_URL: "https://explicit.example.test", SUPABASE_ANON_KEY: "explicit-public" } });
  assert.equal((await setup.map.get("sms-mfa")(request({ action: "status" }))).status, 200);
  assert.equal(setup.clients[0].url, "https://explicit.example.test");
  assert.equal(setup.clients[0].key, "explicit-public");
  const missingPrivate = smsSetup({ env: { ...ENV, SUPABASE_SERVICE_ROLE_KEY: undefined } });
  assert.equal((await missingPrivate.map.get("sms-mfa")(request({ action: "send" }))).status, 503);
  assert.deepEqual(missingPrivate.clients, []);
});

test("both browser handlers use only their injected CORS environment for preflight and errors", async () => {
  const a = handlers({ getEnv: (name) => name === "ALLOWED_CORS_ORIGINS" ? "https://a.example.test" : undefined });
  const b = handlers({ getEnv: (name) => name === "ALLOWED_CORS_ORIGINS" ? "https://b.example.test" : undefined });
  for (const name of ["sms-mfa", "create-billing-session"]) {
    for (const method of ["OPTIONS", "POST"]) {
      const makeRequest = () => new Request("https://cmcarebase.com", {
        method, headers: { origin: "https://a.example.test" },
      });
      assert.equal((await a.get(name)(makeRequest())).headers.get("access-control-allow-origin"), "https://a.example.test");
      assert.equal((await b.get(name)(makeRequest())).headers.get("access-control-allow-origin"), null);
    }
  }
});

test("portable SMS errors preserve state denial and provider throttling", async () => {
  const denied = smsSetup({ rpcError: { code: "42501", message: "private database error" } });
  const deniedResponse = await denied.map.get("sms-mfa")(request({ action: "send" }));
  assert.equal(deniedResponse.status, 403);
  assert.equal((await deniedResponse.text()).includes("private database"), false);
  assert.deepEqual(denied.providerCalls, []);
  const throttled = smsSetup({ fetcher: async () => new Response("private provider error", { status: 429 }) });
  const throttledResponse = await throttled.map.get("sms-mfa")(request({ action: "send" }));
  assert.equal(throttledResponse.status, 429);
  assert.equal((await throttledResponse.json()).code, "sms_rate_limited");
  assert.equal(throttled.calls.some(({ name }) => name === "activate_sms_mfa_challenge"), false);
});

test("billing still requires fresh server-verified MFA before reading profile or calling Stripe", async () => {
  const calls = [];
  const map = handlers({ createClient: (_url, _key, options) => {
    assertServerClient(options);
    return {
      auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
      rpc: async (name, args) => { calls.push({ name, args }); return { data: false, error: null }; },
      from: forbidden,
    };
  } });
  const response = await map.get("create-billing-session")(request({ action: "checkout" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: { code: "fresh_aal2_required" } });
  assert.deepEqual(calls, [{ name: "identity_assurance_is_current", args: { p_operation: "billing_admin" } }]);
});

test("cron uses the injected secret and retains durable duplicate-run behavior", async () => {
  const calls = [];
  const map = handlers({ createClient: (_url, key, options) => {
    assert.equal(key, ENV.SUPABASE_SERVICE_ROLE_KEY);
    assertServerClient(options);
    return { rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { run_id: "run-1", should_execute: false }, error: null };
    } };
  } });
  const handler = map.get("sync-billing-quantities");
  assert.equal((await handler(request({}, { headers: { "x-caremetric-cron-secret": "wrong" } }))).status, 401);
  assert.deepEqual(calls, []);
  const response = await handler(request({}, { headers: {
    "x-caremetric-cron-secret": ENV.CRON_SHARED_SECRET,
    "x-correlation-id": "same-run", origin: "https://cmcarebase.com",
  } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).replayed, true);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "claim_system_job_execution");
  assert.equal(calls[0].args.p_correlation_id, "same-run");
});

test("real Stripe signature and hash cover the exact streamed UTF-8 bytes", async () => {
  const now = Math.floor(Date.now() / 1000);
  const raw = `{\r\n  "id": "evt_node_test", "type": "customer.subscription.updated",\r\n  "created": ${now}, "data": { "object": { "name": "Café" } }\r\n}\n`;
  const signature = createHmac("sha256", ENV.STRIPE_BILLING_WEBHOOK_SECRET).update(`${now}.${raw}`).digest("hex");
  const calls = [];
  const map = handlers({ createClient: (url, key, options) => {
    assert.equal(url, ENV.VITE_SUPABASE_URL);
    assert.equal(key, ENV.SUPABASE_SERVICE_ROLE_KEY);
    assertServerClient(options);
    return { rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { was_duplicate: true, was_applied: false }, error: null };
    } };
  } });
  const bytes = Buffer.from(raw);
  const split = bytes.indexOf(Buffer.from("é")) + 1;
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(bytes.subarray(0, split));
    controller.enqueue(bytes.subarray(split));
    controller.close();
  } });
  const headers = { "stripe-signature": `t=${now},v1=${signature}` };
  const response = await map.get("stripe-billing-webhook")(new Request("https://cmcarebase.com", {
    method: "POST", headers, body, duplex: "half",
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).duplicate, true);
  assert.equal(calls[0].name, "process_stripe_billing_event");
  assert.equal(calls[0].args.p_payload_sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(calls[0].args.p_payload, JSON.parse(raw));
  const changed = await map.get("stripe-billing-webhook")(new Request("https://cmcarebase.com", {
    method: "POST", headers, body: JSON.stringify(JSON.parse(raw)),
  }));
  assert.equal(changed.status, 400);
  assert.equal(calls.length, 1);
});

test("SDK fetch cancellation is scoped to each concurrent request and preserves SDK signals", async () => {
  const controllers = [new AbortController(), new AbortController()];
  const sdkControllers = [];
  const outboundSignals = [];
  const clients = [];
  const map = handlers({
    createClient: (_url, _key, options) => {
      clients.push(options);
      return {
        auth: { getUser: async () => {
          const controller = new AbortController();
          sdkControllers.push(controller);
          await options.global.fetch("https://database.example.test/auth/v1/user", { signal: controller.signal });
          return { data: { user: { id: USER } }, error: null };
        } },
        rpc: async () => ({ data: { verified: false }, error: null }),
      };
    },
    fetcher: async (_url, init) => { outboundSignals.push(init.signal); return new Response("{}"); },
  });
  const results = await Promise.all(controllers.map((controller) => map.get("sms-mfa")(
    request({ action: "status" }, { signal: controller.signal }),
  )));
  assert.deepEqual(results.map(({ status }) => status), [200, 200]);
  assert.notEqual(clients[0].global.fetch, clients[1].global.fetch);
  controllers[0].abort();
  assert.equal(outboundSignals[0].aborted, true);
  assert.equal(outboundSignals[1].aborted, false);
  sdkControllers[1].abort();
  assert.equal(outboundSignals[1].aborted, true);
});

test("disconnect aborts Twilio work and prevents challenge activation", async () => {
  const controller = new AbortController();
  const setup = smsSetup({ fetcher: async (_url, init) => {
    controller.abort();
    assert.equal(init.signal.aborted, true);
    init.signal.throwIfAborted();
  } });
  const response = await setup.map.get("sms-mfa")(request({ action: "send" }, { signal: controller.signal }));
  assert.equal(response.status, 503);
  assert.equal(setup.calls.some(({ name }) => name === "activate_sms_mfa_challenge"), false);
  await assert.rejects(setup.map.get("sms-mfa")(request({ action: "send" }, { signal: controller.signal })), { name: "AbortError" });
  assert.equal(setup.providerCalls.length, 1);
});

test("shared Stripe transports accept scoped fetch without changing auth or idempotency", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "provider-fixture" }));
  };
  assert.equal((await phase2StripePost("/v1/test", "sk_test_fixture", { nested: { value: "test" } }, "same-operation", fetcher)).ok, true);
  assert.equal((await phase2StripeGet("/v1/test", "sk_test_fixture", fetcher)).ok, true);
  assert.deepEqual(calls.map(({ url }) => url), ["https://api.stripe.com/v1/test", "https://api.stripe.com/v1/test"]);
  assert.equal(calls[0].init.headers["Idempotency-Key"], "same-operation");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk_test_fixture");
  assert.equal(calls[0].init.body.get("nested[value]"), "test");
  assert.equal(calls.every(({ init }) => init.signal instanceof AbortSignal), true);
});

test("the billing handler forwards request cancellation into the real Stripe transport", async () => {
  const controller = new AbortController();
  const operations = [];
  const map = handlers({
    createClient: (_url, _key, options) => {
      assertServerClient(options);
      return {
        auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
        rpc: async (name) => {
          assert.equal(name, "identity_assurance_is_current");
          return { data: true, error: null };
        },
        from: (table) => {
          const builder = {
            select: () => builder,
            eq: () => builder,
            single: async () => {
              assert.equal(table, "profiles");
              return { data: { id: USER, role: "platform_admin", is_active: true }, error: null };
            },
            maybeSingle: async () => {
              assert.equal(table, "billing_accounts");
              return { data: { stripe_customer_id: "cus_fixture" }, error: null };
            },
          };
          return builder;
        },
      };
    },
    fetcher: async (url, init) => {
      operations.push(url);
      assert.equal(url, "https://api.stripe.com/v1/billing_portal/sessions");
      assert.equal(init.headers["Idempotency-Key"], "same-portal-request");
      assert.equal(init.body.get("configuration"), ENV.STRIPE_BILLING_PORTAL_CONFIGURATION_ID);
      controller.abort();
      init.signal.throwIfAborted();
    },
  });
  await assert.rejects(map.get("create-billing-session")(request({
    action: "portal", organizationId: USER, returnUrl: "https://cmcarebase.com/billing",
  }, {
    signal: controller.signal, headers: { "idempotency-key": "same-portal-request" },
  })), { name: "AbortError" });
  assert.equal(operations.length, 1);
});
