import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSyncBillingQuantitiesHandler } from "./handler.ts";

Deno.test("sync-billing-quantities rejects unauthenticated and unconfigured requests", async () => {
  const handler = createSyncBillingQuantitiesHandler({
    createClient: () => ({
      rpc: async () => ({ data: null, error: null }),
    }),
    stripePost: async () => ({ ok: false, status: 500, data: {} }),
    stripeGet: async () => ({ ok: false, status: 500, data: {} }),
    getEnv: () => undefined,
    requireCron: () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  });

  const unauthorized = await handler(new Request("https://example.test", { method: "POST" }));
  assertEquals(unauthorized.status, 401);

  const unconfigured = createSyncBillingQuantitiesHandler({
    createClient: () => ({
      rpc: async () => ({ data: null, error: null }),
    }),
    stripePost: async () => ({ ok: false, status: 500, data: {} }),
    stripeGet: async () => ({ ok: false, status: 500, data: {} }),
    getEnv: (name) => (name === "STRIPE_SECRET_KEY" ? undefined : `value-for-${name}`),
    requireCron: () => null,
  });
  const response = await unconfigured(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ batchSize: 10 }),
  }));
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: "billing_sync_not_configured" });
});

Deno.test("sync-billing-quantities records a failed run when STRIPE_SECRET_KEY is missing", async () => {
  // The production shape of this outage: Supabase always injects SUPABASE_URL and
  // SUPABASE_SERVICE_ROLE_KEY, so an unconfigured project is one missing only the Stripe
  // key. Answering 503 without a system_job_runs row made an hourly failure indistinguishable
  // from an idle schedule on /admin/system-jobs and invisible to the watchdog.
  const finished: Array<Record<string, unknown>> = [];
  let claims = 0;
  const handler = createSyncBillingQuantitiesHandler({
    createClient: () => ({
      rpc: async (name: string, args?: Record<string, unknown>) => {
        if (name === "claim_system_job_execution") {
          claims++;
          return { data: [{ run_id: "run-unconfigured", should_execute: true }], error: null };
        }
        if (name === "finish_system_job") {
          finished.push(args ?? {});
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
    }),
    stripePost: async () => ({ ok: false, status: 500, data: {} }),
    stripeGet: async () => ({ ok: false, status: 500, data: {} }),
    getEnv: (name) =>
      name === "STRIPE_SECRET_KEY" ? undefined : `value-for-${name}`,
    requireCron: () => null,
  });

  const response = await handler(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ batchSize: 10 }),
  }));

  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: "billing_sync_not_configured" });
  assertEquals(claims, 1);
  assertEquals(finished.length, 1);
  assertEquals(finished[0].p_run_id, "run-unconfigured");
  assertEquals(finished[0].p_status, "failed");
  assertEquals(finished[0].p_error_code, "billing_sync_not_configured");
  assertEquals(finished[0].p_failed_count, 1);
});

Deno.test("sync-billing-quantities still answers 503 when its own run tracking fails", async () => {
  // Tracking is best effort: a tracker that throws must not turn missing configuration into
  // a 500, which operators would read as a transient provider error rather than missing setup.
  const handler = createSyncBillingQuantitiesHandler({
    createClient: () => {
      throw new Error("no client");
    },
    stripePost: async () => ({ ok: false, status: 500, data: {} }),
    stripeGet: async () => ({ ok: false, status: 500, data: {} }),
    getEnv: (name) => (name === "STRIPE_SECRET_KEY" ? undefined : `value-for-${name}`),
    requireCron: () => null,
  });

  const response = await handler(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ batchSize: 10 }),
  }));
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: "billing_sync_not_configured" });
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
      from: () => ({
        select: () => ({
          in: () => ({
            not: () => ({
              limit: async () => ({
                data: [{
                  id: "sub-1",
                  organization_id: "org-1",
                  stripe_subscription_id: "sub_x",
                  stripe_subscription_item_id: "si_x",
                  package_id: "pkg-1",
                  status: "active",
                }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
    stripePost: async () => ({ ok: true, status: 200, data: {} }),
    stripeGet: async () => ({ ok: true, status: 200, data: { quantity: 1 } }),
    getEnv: (name) => `value-for-${name}`,
    requireCron: () => null,
  });

  const response = await handler(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ batchSize: 10 }),
  }));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
  assertEquals(body.succeeded, 1);
  assertEquals(body.failed, 0);
  assertEquals(finished.length, 1);
  assertEquals(finished[0].p_status, "succeeded");
});
