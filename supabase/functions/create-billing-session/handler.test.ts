import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createCreateBillingSessionHandler } from "./handler.ts";

const ENV = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  STRIPE_SECRET_KEY: "sk_test",
  BILLING_RETURN_URL_ORIGINS: "https://app.caremetric.test",
};

function baseRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("https://example.test/create-billing-session", {
    method: "POST",
    headers: {
      Authorization: "Bearer user-token",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function chain(result: unknown) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  for (const method of [
    "select", "eq", "in", "not", "lte", "or", "order", "limit", "maybeSingle", "single", "insert",
  ]) {
    api[method] = self;
  }
  api.maybeSingle = async () => result;
  api.single = async () => result;
  return api;
}

Deno.test("create-billing-session rejects unauthenticated and non-POST traffic", async () => {
  const handler = createCreateBillingSessionHandler({
    createClient: () => {
      throw new Error("should not construct client");
    },
    stripePost: async () => ({ ok: false, status: 500, data: {} }),
    getEnv: (name) => ENV[name as keyof typeof ENV],
  });
  assertEquals((await handler(new Request("https://example.test", { method: "GET" }))).status, 405);
  assertEquals(
    (await handler(new Request("https://example.test", { method: "POST", body: "{}" }))).status,
    401,
  );
});

Deno.test("create-billing-session requires aal2 before checkout", async () => {
  const handler = createCreateBillingSessionHandler({
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
        mfa: {
          getAuthenticatorAssuranceLevel: async () => ({
            data: { currentLevel: "aal1" },
            error: null,
          }),
        },
      },
      from: () => chain({ data: null, error: null }),
      rpc: async () => ({ data: true, error: null }),
    }),
    stripePost: async () => ({ ok: false, status: 500, data: {} }),
    getEnv: (name) => ENV[name as keyof typeof ENV],
  });
  const response = await handler(baseRequest({ action: "checkout", packageId: "11111111-1111-4111-8111-111111111111" }));
  assertEquals(response.status, 403);
  assertEquals((await response.json()).error.code, "aal2_required");
});

Deno.test("create-billing-session flat checkout uses quantity 1 without usage RPC", async () => {
  const stripeCalls: Array<{ path: string; values: Record<string, unknown> }> = [];
  let usageRpcCalls = 0;
  const orgId = "22222222-2222-4222-8222-222222222222";
  const packageId = "33333333-3333-4333-8333-333333333333";

  const handler = createCreateBillingSessionHandler({
    createClient: (_url, key) => {
      const isService = key === "service";
      return {
        auth: {
          getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
          mfa: {
            getAuthenticatorAssuranceLevel: async () => ({
              data: { currentLevel: "aal2" },
              error: null,
            }),
          },
        },
        rpc: async (name: string) => {
          if (name === "identity_assurance_is_current") return { data: true, error: null };
          if (name === "has_effective_permission") return { data: true, error: null };
          if (name === "get_organization_billing_usage") {
            usageRpcCalls += 1;
            return { data: [], error: { message: "should not run for flat" } };
          }
          return { data: null, error: null };
        },
        from: (table: string) => {
          if (!isService && table === "profiles") {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: "user-1",
                      email: "admin@example.test",
                      role: "org_admin",
                      organization_id: orgId,
                      is_active: true,
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "billing_accounts") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: "ba-1", stripe_customer_id: null, billing_state: "trial" }, error: null }),
                }),
              }),
            };
          }
          if (table === "billing_subscriptions") {
            const q: Record<string, unknown> = {};
            const self = () => q;
            q.select = self;
            q.eq = self;
            q.in = self;
            q.order = self;
            q.limit = self;
            q.maybeSingle = async () => ({ data: null, error: null });
            return q;
          }
          if (table === "package_billing_prices") {
            const q: Record<string, unknown> = {};
            const self = () => q;
            for (const m of ["select", "eq", "not", "lte", "or", "order", "limit"]) q[m] = self;
            q.maybeSingle = async () => ({
              data: {
                stripe_price_id: "price_flat_carebase",
                billing_metric: "flat",
                pricing_model: "flat",
                minimum_quantity: 1,
                maximum_quantity: 1,
                packages: { is_active: true, trial_days: 30 },
              },
              error: null,
            });
            return q;
          }
          if (table === "organizations") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { trial_ends_at: "2099-01-01T00:00:00.000Z" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "audit_logs") {
            return {
              insert: async () => ({ error: null }),
            };
          }
          return chain({ data: null, error: null });
        },
      };
    },
    stripePost: async (path, _key, values) => {
      stripeCalls.push({ path, values });
      return {
        ok: true,
        status: 200,
        data: {
          id: "cs_test_1",
          url: "https://checkout.stripe.test/session",
          expires_at: 1_900_000_000,
        },
      };
    },
    getEnv: (name) => ENV[name as keyof typeof ENV],
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    nowIso: () => "2026-07-31T12:00:00.000Z",
  });

  const response = await handler(baseRequest({
    action: "checkout",
    packageId,
    billingInterval: "month",
    successUrl: "https://app.caremetric.test/app/billing?billing=success",
    cancelUrl: "https://app.caremetric.test/app/billing?billing=cancelled",
  }));
  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.data.kind, "checkout");
  assertEquals(payload.data.checkoutConfiguration.quantity, 1);
  assertEquals(payload.data.checkoutConfiguration.billingMetric, "flat");
  assertEquals(usageRpcCalls, 0);
  assertEquals(stripeCalls.length, 1);
  assertEquals(stripeCalls[0].path, "/v1/checkout/sessions");
  const lineItems = stripeCalls[0].values.line_items as Array<{ price: string; quantity: number }>;
  assertEquals(lineItems[0].quantity, 1);
  assertEquals(lineItems[0].price, "price_flat_carebase");
});

Deno.test("create-billing-session routes existing subscriptions to the portal", async () => {
  const orgId = "22222222-2222-4222-8222-222222222222";
  const packageId = "33333333-3333-4333-8333-333333333333";
  const handler = createCreateBillingSessionHandler({
    createClient: (_url, key) => {
      const isService = key === "service";
      return {
        auth: {
          getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
          mfa: {
            getAuthenticatorAssuranceLevel: async () => ({
              data: { currentLevel: "aal2" },
              error: null,
            }),
          },
        },
        rpc: async (name: string) => {
          if (name === "identity_assurance_is_current") return { data: true, error: null };
          if (name === "has_effective_permission") return { data: true, error: null };
          return { data: null, error: null };
        },
        from: (table: string) => {
          if (!isService && table === "profiles") {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: "user-1",
                      email: "admin@example.test",
                      role: "org_admin",
                      organization_id: orgId,
                      is_active: true,
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "billing_accounts") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: "ba-1", stripe_customer_id: "cus_1", billing_state: "active" }, error: null }),
                }),
              }),
            };
          }
          if (table === "billing_subscriptions") {
            const q: Record<string, unknown> = {};
            const self = () => q;
            q.select = self;
            q.eq = self;
            q.in = self;
            q.order = self;
            q.limit = self;
            q.maybeSingle = async () => ({ data: { id: "sub_local" }, error: null });
            return q;
          }
          return chain({ data: null, error: null });
        },
      };
    },
    stripePost: async () => ({ ok: false, status: 500, data: {} }),
    getEnv: (name) => ENV[name as keyof typeof ENV],
  });
  const response = await handler(baseRequest({
    action: "checkout",
    packageId,
    billingInterval: "month",
    successUrl: "https://app.caremetric.test/app/billing?billing=success",
    cancelUrl: "https://app.caremetric.test/app/billing?billing=cancelled",
  }));
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error.code, "existing_subscription_requires_portal");
});
