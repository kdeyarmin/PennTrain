import { assertEquals } from "jsr:@std/assert@1.0.14";
import { createCreateBillingSessionHandler as createHandler, type CreateBillingSessionDependencies } from "./handler.ts";

const ENV = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  STRIPE_SECRET_KEY: "sk_test_fixture",
  STRIPE_BILLING_WEBHOOK_SECRET: "whsec_test",
  BILLING_RETURN_URL_ORIGINS: "https://app.caremetric.test",
};

// Existing handler scenarios retain their query/provider assertions. This
// synthetic RPC fixture supplies the newly durable reservation boundary; its
// actual SQL authorization/lease behavior is covered by the native pgTAP suite.
function createCreateBillingSessionHandler(deps: CreateBillingSessionDependencies) {
  const commandId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reservationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let values: Record<string,unknown>={}, provider: Record<string,unknown>={}, receipt: Record<string,unknown>={};
  return createHandler({...deps,
    createClient:(url,key,options)=>{
      const client=deps.createClient(url,key,options), original=client.rpc;
      client.rpc=async(name:string,args:Record<string,unknown>)=>{
        if(name==="authorize_native_checkout") {
          assertEquals(key,"anon");
          return {data:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",error:null};
        }
        if(name==="claim_native_checkout") {
          assertEquals(key,"service");values=args.p_provider_parameters as Record<string,unknown>;
          return {data:{kind:"create",commandId,targetId:values.client_reference_id,reservationId,leaseId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            idempotencyKey:`carebase:checkout:${reservationId}`,values,priorSession:null,replayed:false,firstDispatch:true,
            priceConfiguration:{currency:"usd",interval_count:1}},error:null};
        }
        if(name==="finish_checkout_reservation") {receipt=args;return {data:null,error:null};}
        if(name==="read_native_checkout_result") {
          const s=receipt.p_session as Record<string,unknown>;
          return {data:{commandId,action:"billing.checkout.create",targetId:values.client_reference_id,outcome:receipt.p_outcome,
            replayed:false,checkedAt:new Date().toISOString(),providerStatus:s.status,availability:"available",canStartNewCheckout:false,
            retryAfterSeconds:null,session:{kind:s.kind,id:s.id,url:s.url,expiresAt:s.expiresAt,livemode:s.livemode}},error:null};
        }
        return original.call(client,name,args);
      };
      return client;
    },
    stripePost:async(path,key,params,idempotency)=>{
      const result=await deps.stripePost(path,key,params,idempotency);
      if(path!=="/v1/checkout/sessions" || !result.ok) return result;
      const rawId=String(result.data.id),id=rawId.startsWith("cs_test_")?rawId:`cs_test_${rawId.replace(/[^A-Za-z0-9]/g,"")}`;
      provider={...result.data,id,url:`https://checkout.stripe.com/c/pay/${id}`,mode:"subscription",client_reference_id:params.client_reference_id,
        customer:params.customer??null,subscription:null,status:"open",metadata:params.metadata,livemode:false,expires_at:Math.floor(Date.now()/1000)+3600};
      return {...result,data:provider};
    },
    stripeGet:async()=>({ok:true,status:200,data:{...provider,line_items:{has_more:false,data:(values.line_items as Array<{price:string;quantity:number}>).map(item=>({
      quantity:item.quantity,price:{active:true,livemode:false,type:"recurring",id:item.price,currency:"usd",recurring:{interval:(values.metadata as Record<string,unknown>).billing_interval,interval_count:1}}}))}}}),
  });
}

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

Deno.test("create-billing-session stops checkout and portal when customer lookup fails", async () => {
  for (const action of ["checkout", "portal"] as const) {
    let stripeCalls = 0;
    const handler = createCreateBillingSessionHandler({
      createClient: () => ({
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
        rpc: async () => ({ data: true, error: null }),
        from: (table: string) => {
          if (table === "profiles") return chain({
            data: {
              id: "user-1",
              email: "admin@example.test",
              role: "org_admin",
              organization_id: "22222222-2222-4222-8222-222222222222",
              is_active: true,
            },
            error: null,
          });
          if (table === "billing_accounts") return chain({
            data: null,
            error: { code: "57014", message: "statement timeout" },
          });
          if (table === "package_billing_prices") return chain({
            data: {
              stripe_price_id: "price_flat_carebase",
              billing_metric: "flat",
              pricing_model: "flat",
              packages: { trial_days: 0 },
            },
            error: null,
          });
          if (table === "organizations") return chain({ data: { trial_ends_at: null }, error: null });
          return chain({ data: null, error: null });
        },
      }),
      stripePost: async () => {
        stripeCalls += 1;
        return { ok: true, status: 200, data: { id: "cs_1", url: "https://checkout.stripe.test/session" } };
      },
      getEnv: (name) => ENV[name as keyof typeof ENV],
    });
    const response = await handler(baseRequest({
      action,
      packageId: "33333333-3333-4333-8333-333333333333",
      successUrl: "https://app.caremetric.test/app/billing?billing=success",
      cancelUrl: "https://app.caremetric.test/app/billing?billing=cancelled",
      returnUrl: "https://app.caremetric.test/app/billing",
    }));
    assertEquals(response.status, 503, action);
    assertEquals((await response.json()).error.code, "billing_state_unavailable", action);
    assertEquals(stripeCalls, 0, action);
  }
});

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

Deno.test("create-billing-session requires its own server-configured Stripe portal", async () => {
  for (const configuration of [undefined, "", "invalid", " bpc_penntrainconfigured "]) {
    const stripeCalls: Array<Record<string, unknown>> = [];
    const handler = createCreateBillingSessionHandler({
      createClient: () => ({
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
        rpc: async () => ({ data: true, error: null }),
        from: (table: string) => table === "profiles"
          ? chain({ data: {
            id: "user-1", role: "org_admin", is_active: true,
            organization_id: "22222222-2222-4222-8222-222222222222",
          }, error: null })
          : table === "billing_accounts"
          ? chain({ data: { id: "ba-1", stripe_customer_id: "cus_existing" }, error: null })
          : chain({ data: null, error: null }),
      }),
      stripePost: async (_path, _secret, values) => {
        stripeCalls.push(values);
        return { ok: true, status: 200, data: { id: "bps_1", url: "https://billing.stripe.test/session" } };
      },
      getEnv: (name) => name === "STRIPE_BILLING_PORTAL_CONFIGURATION_ID"
        ? configuration
        : name === "STRIPE_BILLING_WEBHOOK_SECRET"
        ? undefined // Existing customers can manage billing during webhook setup repair.
        : ENV[name as keyof typeof ENV],
    });
    const response = await handler(baseRequest({
      action: "portal",
      returnUrl: "https://app.caremetric.test/app/billing",
      // Browser input must not select another application's portal settings.
      configuration: "bpc_otherapp",
    }));
    if (configuration?.trim() === "bpc_penntrainconfigured") {
      assertEquals(response.status, 200);
      assertEquals(stripeCalls, [{
        customer: "cus_existing",
        return_url: "https://app.caremetric.test/app/billing",
        configuration: "bpc_penntrainconfigured",
      }]);
    } else {
      assertEquals(response.status, 503);
      assertEquals((await response.json()).error.code, "billing_not_configured");
      assertEquals(stripeCalls.length, 0);
    }
  }
});

Deno.test("create-billing-session refuses new checkout without webhook reconciliation configured", async () => {
  for (const webhookSecret of [undefined, "", "  ", "whsec_configured"]) {
    let stripeCalls = 0;
    const handler = createCreateBillingSessionHandler({
      createClient: () => ({
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
        rpc: async () => ({ data: true, error: null }),
        from: (table: string) => {
          if (table === "profiles") return chain({ data: {
            id: "user-1", role: "org_admin", is_active: true,
            organization_id: "22222222-2222-4222-8222-222222222222",
          }, error: null });
          if (table === "package_billing_prices") return chain({ data: {
            stripe_price_id: "price_flat_carebase", billing_metric: "flat",
            pricing_model: "flat", packages: { trial_days: 0 },
          }, error: null });
          if (table === "organizations") return chain({ data: { trial_ends_at: null }, error: null });
          return chain({ data: null, error: null });
        },
      }),
      stripePost: async () => {
        stripeCalls += 1;
        return { ok: true, status: 200, data: { id: "cs_new", url: "https://checkout.stripe.test/session" } };
      },
      getEnv: (name) => name === "STRIPE_BILLING_WEBHOOK_SECRET"
        ? webhookSecret
        : ENV[name as keyof typeof ENV],
    });
    const response = await handler(baseRequest({
      // The default action is checkout and must be protected too.
      packageId: "33333333-3333-4333-8333-333333333333",
      successUrl: "https://app.caremetric.test/app/billing?billing=success",
      cancelUrl: "https://app.caremetric.test/app/billing?billing=cancelled",
      webhookSecret: "whsec_browser_cannot_configure_server",
    }));
    assertEquals(response.status, webhookSecret?.trim() ? 200 : 503);
    assertEquals(stripeCalls, webhookSecret?.trim() ? 1 : 0);
    if (!webhookSecret?.trim()) assertEquals((await response.json()).error.code, "billing_not_configured");
  }
});

Deno.test("create-billing-session requires current identity assurance before checkout", async () => {
  const handler = createCreateBillingSessionHandler({
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: () => chain({ data: null, error: null }),
      rpc: async (name: string) => {
        if (name === "identity_assurance_is_current") return { data: false, error: null };
        return { data: null, error: null };
      },
    }),
    stripePost: async () => ({ ok: false, status: 500, data: {} }),
    getEnv: (name) => ENV[name as keyof typeof ENV],
  });
  const response = await handler(baseRequest({ action: "checkout", packageId: "11111111-1111-4111-8111-111111111111" }));
  assertEquals(response.status, 403);
  assertEquals((await response.json()).error.code, "fresh_aal2_required");
});

Deno.test("create-billing-session honors identity_assurance_is_current without a raw AAL2 JWT", async () => {
  const orgId = "22222222-2222-4222-8222-222222222222";
  const packageId = "33333333-3333-4333-8333-333333333333";
  const handler = createCreateBillingSessionHandler({
    createClient: (_url, key) => {
      const isService = key === "service";
      return {
        auth: {
          getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
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
                  maybeSingle: async () => ({ data: { id: "ba-1", stripe_customer_id: "cus_1", billing_state: "trial" }, error: null }),
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
            q.or = self;
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
            return { insert: async () => ({ error: null }) };
          }
          return chain({ data: null, error: null });
        },
      };
    },
    stripePost: async () => ({
      ok: true,
      status: 200,
      data: { id: "cs_test_aal1", url: "https://checkout.stripe.test/session" },
    }),
    getEnv: (name) => ENV[name as keyof typeof ENV],
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
            q.or = self;
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
  assertEquals(stripeCalls[0].values.payment_method_collection, "always");
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
            q.or = self;
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

Deno.test("create-billing-session honors PUBLIC_APP_URL when billing origins are unset", async () => {
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
            q.or = self;
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
            return { insert: async () => ({ error: null }) };
          }
          return chain({ data: null, error: null });
        },
      };
    },
    stripePost: async () => ({
      ok: true,
      status: 200,
      data: { id: "cs_test_public", url: "https://checkout.stripe.test/session" },
    }),
    getEnv: (name) => {
      if (name === "BILLING_RETURN_URL_ORIGINS") return "";
      if (name === "PUBLIC_APP_URL") return "https://signup.caremetric.test";
      return ENV[name as keyof typeof ENV];
    },
    nowIso: () => "2026-07-31T12:00:00.000Z",
  });
  const response = await handler(baseRequest({
    action: "checkout",
    packageId,
    billingInterval: "month",
    successUrl: "https://signup.caremetric.test/app/billing?billing=success",
    cancelUrl: "https://signup.caremetric.test/app/billing?billing=cancelled",
  }));
  assertEquals(response.status, 200);
  assertEquals((await response.json()).data.sessionId, "cs_test_public");
});
