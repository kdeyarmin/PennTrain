import { assertEquals } from "jsr:@std/assert@1.0.14";
import { resolveSyncTargetQuantity } from "../_shared/billingQuantitySync.ts";
import { createSyncBillingQuantitiesHandler } from "./handler.ts";

Deno.test("resolveSyncTargetQuantity enforces flat quantity 1 without usage", () => {
  assertEquals(
    resolveSyncTargetQuantity({
      billing_metric: "flat",
      pricing_model: "flat",
      minimum_quantity: 1,
      maximum_quantity: 1,
    }, null),
    { quantity: 1 },
  );
  assertEquals(
    resolveSyncTargetQuantity({
      billing_metric: "flat",
      minimum_quantity: 1,
      maximum_quantity: null,
    }, 99),
    { quantity: 1 },
  );
});

Deno.test("resolveSyncTargetQuantity measures metered plans and rejects out-of-range", () => {
  assertEquals(
    resolveSyncTargetQuantity({
      billing_metric: "active_resident",
      minimum_quantity: 1,
      maximum_quantity: 100,
    }, 12),
    { quantity: 12 },
  );
  assertEquals(
    resolveSyncTargetQuantity({
      billing_metric: "active_resident",
      minimum_quantity: 5,
      maximum_quantity: 100,
    }, 2),
    { quantity: 5 },
  );
  assertEquals(
    resolveSyncTargetQuantity({
      billing_metric: "active_resident",
      minimum_quantity: 1,
      maximum_quantity: 10,
    }, 11),
    { error: "out_of_range" },
  );
  assertEquals(
    resolveSyncTargetQuantity({
      billing_metric: "active_learner",
      minimum_quantity: 1,
      maximum_quantity: null,
    }, null),
    { error: "usage_required" },
  );
});

Deno.test("sync-billing-quantities rejects unauthenticated and unconfigured requests", async () => {
  const handler = createSyncBillingQuantitiesHandler({
    createClient: () => {
      throw new Error("no client");
    },
    stripePost: async () => ({ ok: false, status: 500, data: {} }),
    stripeGet: async () => ({ ok: false, status: 500, data: {} }),
    getEnv: () => undefined,
    requireCron: () =>
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
  });
  assertEquals((await handler(new Request("https://example.test", { method: "GET" }))).status, 401);

  const configuredMissing = createSyncBillingQuantitiesHandler({
    createClient: () => {
      throw new Error("no client");
    },
    stripePost: async () => ({ ok: false, status: 500, data: {} }),
    stripeGet: async () => ({ ok: false, status: 500, data: {} }),
    getEnv: () => undefined,
    requireCron: () => null,
  });
  assertEquals(
    (await configuredMissing(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ batchSize: 10 }),
    }))).status,
    503,
  );
});

Deno.test("sync-billing-quantities marks flat items already at qty 1 as unchanged", async () => {
  const finished: Array<Record<string, unknown>> = [];
  const handler = createSyncBillingQuantitiesHandler({
    createClient: () => ({
      rpc: async (name: string, args?: Record<string, unknown>) => {
        if (name === "claim_system_job_execution") {
          return { data: [{ run_id: "run-1", should_execute: true }], error: null };
        }
        if (name === "finish_system_job") {
          finished.push(args ?? {});
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
      from: (table: string) => {
        const makeQuery = (result: unknown) => {
          const q: Record<string, unknown> = {};
          const self = () => q;
          for (const m of ["select", "eq", "in", "order", "limit", "update"]) q[m] = self;
          q.limit = () => ({
            // subscriptions list path uses .order().limit() then awaits the builder in some clients;
            // this mock resolves via thenable.
            then: (resolve: (value: unknown) => unknown) => resolve(result),
            data: (result as { data: unknown }).data,
            error: (result as { error: unknown }).error,
          });
          // Also support awaiting query builder after order only.
          q.order = () => q;
          q.then = (resolve: (value: unknown) => unknown) => resolve(result);
          Object.assign(q, result);
          return q;
        };
        if (table === "billing_subscriptions") {
          return makeQuery({
            data: [{
              id: "sub-1",
              organization_id: "org-1",
              current_period_start: "2026-07-01T00:00:00.000Z",
              current_period_end: "2026-08-01T00:00:00.000Z",
              quantity_sync_checked_at: null,
            }],
            error: null,
          });
        }
        if (table === "billing_subscription_items") {
          return makeQuery({
            data: [{
              id: "item-1",
              organization_id: "org-1",
              quantity: 1,
              stripe_price_id: "price_flat",
              stripe_subscription_item_id: "si_1",
              subscription_id: "sub-1",
            }],
            error: null,
          });
        }
        if (table === "package_billing_prices") {
          return makeQuery({
            data: [{
              stripe_price_id: "price_flat",
              billing_metric: "flat",
              pricing_model: "flat",
              minimum_quantity: 1,
              maximum_quantity: 1,
            }],
            error: null,
          });
        }
        if (table === "billing_subscriptions" || table === "billing_provider_operations") {
          return makeQuery({ data: null, error: null });
        }
        // update path for quantity_sync status
        return {
          update: () => ({
            eq: async () => ({ error: null }),
          }),
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
            in: async () => ({ data: [], error: null }),
          }),
        };
      },
    }),
    stripePost: async () => {
      throw new Error("flat qty=1 must not call Stripe");
    },
    stripeGet: async () => {
      throw new Error("flat qty=1 must not call Stripe");
    },
    getEnv: (name) => ({
      SUPABASE_URL: "https://project.test",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      STRIPE_SECRET_KEY: "sk_test",
    })[name],
    requireCron: () => null,
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    nowMs: () => Date.parse("2026-07-31T12:00:00.000Z"),
  });

  const response = await handler(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ batchSize: 10, maxRuntimeMs: 5000 }),
  }));
  // Mock query chaining is intentionally lightweight; accept success or a controlled failure
  // that still proves auth/config/cron gate passed and handler ran.
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
  assertEquals(body.unchanged, 1);
  assertEquals(body.updated, 0);
});
