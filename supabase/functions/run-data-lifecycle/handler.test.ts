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
        if (name === "list_expired_organization_exports") return { data: [], error: null };
        return { data: { policyKey: args.p_policy_key, rowsAffected: 12 }, error: null };
      },
      storage: {
        from: () => {
          throw new Error("storage should not be touched when nothing has expired");
        },
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
      { policyKey: "lifecycle.organization_export_archives", expired: 0, purged: 0 },
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
      name: "list_expired_organization_exports",
      args: { p_limit: 200 },
    },
    {
      name: "refresh_benchmark_snapshots",
      args: { p_period_end: "2026-07-17", p_k_threshold: 10 },
    },
  ]);
});

Deno.test("run-data-lifecycle purges expired export archives objects-first", async () => {
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const purgeCalls: Array<Record<string, unknown>> = [];
  const policyQuery: any = {
    select: () => policyQuery,
    eq: () => policyQuery,
    order: async () => ({ data: [], error: null }),
  };
  const handler = createRunDataLifecycleHandler({
    createClient: () => ({
      from: () => policyQuery,
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "list_expired_organization_exports") {
          return {
            data: [
              { job_id: "job-1", storage_bucket: "organization-exports", storage_path: "org-a/job-1.zip" },
              { job_id: "job-2", storage_bucket: "organization-exports", storage_path: "org-b/job-2.zip" },
            ],
            error: null,
          };
        }
        if (name === "purge_expired_organization_exports") {
          purgeCalls.push(args);
          return { data: (args.p_job_ids as string[]).length, error: null };
        }
        return { data: 0, error: null };
      },
      storage: {
        from: (bucket: string) => ({
          remove: async (paths: string[]) => {
            removed.push({ bucket, paths });
            return { data: paths.map((path) => ({ name: path })), error: null };
          },
        }),
      },
    }),
    getEnv: configuredEnvironment,
    now: () => new Date("2026-07-17T04:30:00.000Z"),
    authorizeRequest: () => null,
  });

  const response = await handler(new Request("https://example.test", { method: "POST" }));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.lifecycle, [
    { policyKey: "lifecycle.organization_export_archives", expired: 2, purged: 2 },
  ]);
  assertEquals(removed, [
    { bucket: "organization-exports", paths: ["org-a/job-1.zip", "org-b/job-2.zip"] },
  ]);
  assertEquals(purgeCalls, [{ p_job_ids: ["job-1", "job-2"] }]);
});

Deno.test("run-data-lifecycle keeps export rows when archive removal fails", async () => {
  let purgeCalled = false;
  const policyQuery: any = {
    select: () => policyQuery,
    eq: () => policyQuery,
    order: async () => ({ data: [], error: null }),
  };
  const handler = createRunDataLifecycleHandler({
    createClient: () => ({
      from: () => policyQuery,
      rpc: async (name: string) => {
        if (name === "list_expired_organization_exports") {
          return {
            data: [{ job_id: "job-1", storage_bucket: "organization-exports", storage_path: "org-a/job-1.zip" }],
            error: null,
          };
        }
        if (name === "purge_expired_organization_exports") {
          purgeCalled = true;
          return { data: 1, error: null };
        }
        return { data: 0, error: null };
      },
      storage: {
        from: () => ({
          remove: async () => ({ data: null, error: { message: "bucket unavailable" } }),
        }),
      },
    }),
    getEnv: configuredEnvironment,
    now: () => new Date("2026-07-17T04:30:00.000Z"),
    authorizeRequest: () => null,
  });

  const response = await handler(new Request("https://example.test", { method: "POST" }));
  assertEquals(response.status, 207);
  const body = await response.json();
  assertEquals(purgeCalled, false);
  assertEquals(body.lifecycle, [
    {
      policyKey: "lifecycle.organization_export_archives",
      expired: 1,
      purged: 0,
      error: "archive removal failed: organization-exports: bucket unavailable",
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
      rpc: async (name: string) => {
        if (name === "run_data_lifecycle_policy") return { data: null, error: { message: "retention lock" } };
        if (name === "list_expired_organization_exports") return { data: null, error: { message: "exports offline" } };
        return { data: null, error: { message: "benchmark timeout" } };
      },
    }),
    getEnv: configuredEnvironment,
    now: () => new Date("2026-07-17T04:30:00.000Z"),
    authorizeRequest: () => null,
  });

  const response = await handler(new Request("https://example.test", { method: "POST" }));
  assertEquals(response.status, 207);
  assertEquals(await response.json(), {
    lifecycle: [
      { policyKey: "audit-log", error: "retention lock" },
      { policyKey: "lifecycle.organization_export_archives", expired: 0, purged: 0, error: "exports offline" },
    ],
    benchmarks: { error: "benchmark timeout" },
  });
});
