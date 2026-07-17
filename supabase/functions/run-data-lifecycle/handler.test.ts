import { assertEquals } from "jsr:@std/assert@1.0.14";
import { requireCronRequest } from "../_shared/cronAuth.ts";
import { createRunDataLifecycleHandler } from "./handler.ts";

const configuredEnvironment = (name: string) => ({
  SUPABASE_URL: "https://project.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
})[name];

Deno.test("run-data-lifecycle enforces the cron request contract", async () => {
  const handler = createRunDataLifecycleHandler({
    createClient: () => { throw new Error("client should not be created"); },
    getEnv: configuredEnvironment,
    authorizeRequest: (request, headers) =>
      requireCronRequest(request, headers, "runtime-test-secret"),
  });
  assertEquals((await handler(new Request("https://example.test", { method: "GET" }))).status, 405);
  assertEquals((await handler(new Request("https://example.test", { method: "POST" }))).status, 401);
});

Deno.test("run-data-lifecycle executes active policies and benchmark refresh", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const policyQuery: any = {
    select: () => policyQuery,
    eq: () => policyQuery,
    order: async () => ({
      data: [{ policy_key: "audit-log" }, { policy_key: "notifications" }],
      error: null,
    }),
  };
  const handler = createRunDataLifecycleHandler({
    createClient: () => ({
      from: (table: string) => {
        assertEquals(table, "data_lifecycle_policies");
        return policyQuery;
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        if (name === "refresh_benchmark_snapshots") return { data: 4, error: null };
        return { data: { policyKey: args.p_policy_key, rowsAffected: 12 }, error: null };
      },
    }),
    getEnv: configuredEnvironment,
    now: () => new Date("2026-07-17T04:30:00.000Z"),
    authorizeRequest: () => null,
  });

  const response = await handler(new Request("https://example.test", { method: "POST" }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    lifecycle: [
      { policyKey: "audit-log", rowsAffected: 12 },
      { policyKey: "notifications", rowsAffected: 12 },
    ],
    benchmarks: { cohortsRefreshed: 4 },
  });
  assertEquals(rpcCalls, [
    {
      name: "run_data_lifecycle_policy",
      args: {
        p_policy_key: "audit-log",
        p_limit: 5000,
        p_request_id: "2026-07-17:audit-log",
      },
    },
    {
      name: "run_data_lifecycle_policy",
      args: {
        p_policy_key: "notifications",
        p_limit: 5000,
        p_request_id: "2026-07-17:notifications",
      },
    },
    {
      name: "refresh_benchmark_snapshots",
      args: { p_period_end: "2026-07-17", p_k_threshold: 10 },
    },
  ]);
});

Deno.test("run-data-lifecycle returns multi-status when a policy fails", async () => {
  const policyQuery: any = {
    select: () => policyQuery,
    eq: () => policyQuery,
    order: async () => ({ data: [{ policy_key: "audit-log" }], error: null }),
  };
  const handler = createRunDataLifecycleHandler({
    createClient: () => ({
      from: () => policyQuery,
      rpc: async (name: string) => name === "run_data_lifecycle_policy"
        ? { data: null, error: { message: "retention lock" } }
        : { data: null, error: { message: "benchmark timeout" } },
    }),
    getEnv: configuredEnvironment,
    now: () => new Date("2026-07-17T04:30:00.000Z"),
    authorizeRequest: () => null,
  });

  const response = await handler(new Request("https://example.test", { method: "POST" }));
  assertEquals(response.status, 207);
  assertEquals(await response.json(), {
    lifecycle: [{ policyKey: "audit-log", error: "retention lock" }],
    benchmarks: { error: "benchmark timeout" },
  });
});
