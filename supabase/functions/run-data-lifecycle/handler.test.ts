import { assertEquals } from "jsr:@std/assert@1.0.14";
import { requireCronRequest } from "../_shared/cronAuth.ts";
import { createRunDataLifecycleHandler } from "./handler.ts";

const configuredEnvironment = (name: string) => ({
  SUPABASE_URL: "https://project.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
})[name];

// Every invocation now claims a system-job run before doing any work and finishes it on the way
// out, so `data-lifecycle` has a ledger the watchdog can read instead of falling back to
// pg_cron's exit status (G270 / 20260904090000). The suites below are about the sweep rather
// than the ledger, so this stub grants the claim and swallows the finish; the ledger itself is
// asserted by its own tests at the bottom of this file.
function withJobLedger(
  rpc: (name: string, args: Record<string, unknown>) => Promise<any>,
  ledger?: { claims: Array<Record<string, unknown>>; finishes: Array<Record<string, unknown>> },
  shouldExecute = true,
) {
  return async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_system_job_execution") {
      ledger?.claims.push(args);
      return {
        data: [{ run_id: "run-1", should_execute: shouldExecute, existing_status: shouldExecute ? null : "running" }],
        error: null,
      };
    }
    if (name === "finish_system_job") {
      ledger?.finishes.push(args);
      return { data: null, error: null };
    }
    return rpc(name, args);
  };
}

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
      rpc: withJobLedger(async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        if (name === "refresh_benchmark_snapshots") return { data: 4, error: null };
        if (name === "list_expired_organization_exports") return { data: [], error: null };
        return { data: { policyKey: args.p_policy_key, rowsAffected: 12 }, error: null };
      }),
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
      rpc: withJobLedger(async (name: string, args: Record<string, unknown>) => {
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
      }),
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
      rpc: withJobLedger(async (name: string) => {
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
      }),
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
      rpc: withJobLedger(async (name: string) => {
        if (name === "run_data_lifecycle_policy") return { data: null, error: { message: "retention lock" } };
        if (name === "list_expired_organization_exports") return { data: null, error: { message: "exports offline" } };
        return { data: null, error: { message: "benchmark timeout" } };
      }),
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

Deno.test("run-data-lifecycle records a system job run for the sweep", async () => {
  const ledger = { claims: [] as Array<Record<string, unknown>>, finishes: [] as Array<Record<string, unknown>> };
  const policyQuery: any = {
    select: () => policyQuery,
    eq: () => policyQuery,
    order: async () => ({ data: [{ policy_key: "audit-log" }], error: null }),
  };
  const handler = createRunDataLifecycleHandler({
    createClient: () => ({
      from: () => policyQuery,
      rpc: withJobLedger(async (name: string, args: Record<string, unknown>) => {
        if (name === "refresh_benchmark_snapshots") return { data: 1, error: null };
        if (name === "list_expired_organization_exports") return { data: [], error: null };
        return { data: { policyKey: args.p_policy_key, rowsAffected: 3 }, error: null };
      }, ledger),
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    }),
    getEnv: configuredEnvironment,
    now: () => new Date("2026-07-17T04:30:00.000Z"),
    authorizeRequest: () => null,
    newCorrelationId: () => "correlation-1",
  });

  assertEquals((await handler(new Request("https://example.test", { method: "POST" }))).status, 200);
  assertEquals(ledger.claims, [{
    p_job_key: "data-lifecycle",
    p_correlation_id: "correlation-1",
    p_trigger_type: "scheduled",
    p_provider_request_id: null,
  }]);
  // Three units: the one active policy, the export-archive sweep, and the benchmark refresh.
  // All succeeded, so the run closes 'succeeded' -- the signal the watchdog reads instead of
  // pg_cron's.
  assertEquals(ledger.finishes.length, 1);
  assertEquals(ledger.finishes[0].p_run_id, "run-1");
  assertEquals(ledger.finishes[0].p_status, "succeeded");
  assertEquals(ledger.finishes[0].p_attempted_count, 3);
  assertEquals(ledger.finishes[0].p_succeeded_count, 3);
  assertEquals(ledger.finishes[0].p_failed_count, 0);
});

Deno.test("run-data-lifecycle closes the run as partial when one policy fails", async () => {
  const ledger = { claims: [] as Array<Record<string, unknown>>, finishes: [] as Array<Record<string, unknown>> };
  const policyQuery: any = {
    select: () => policyQuery,
    eq: () => policyQuery,
    order: async () => ({ data: [{ policy_key: "audit-log" }], error: null }),
  };
  const handler = createRunDataLifecycleHandler({
    createClient: () => ({
      from: () => policyQuery,
      rpc: withJobLedger(async (name: string) => {
        if (name === "run_data_lifecycle_policy") return { data: null, error: { message: "retention lock" } };
        if (name === "list_expired_organization_exports") return { data: [], error: null };
        return { data: 1, error: null };
      }, ledger),
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    }),
    getEnv: configuredEnvironment,
    now: () => new Date("2026-07-17T04:30:00.000Z"),
    authorizeRequest: () => null,
  });

  assertEquals((await handler(new Request("https://example.test", { method: "POST" }))).status, 207);
  // One unit failed and two succeeded: 'partial', not 'failed'. A single stuck retention policy
  // must not read the same as the whole sweep never running.
  assertEquals(ledger.finishes[0].p_status, "partial");
  assertEquals(ledger.finishes[0].p_attempted_count, 3);
  assertEquals(ledger.finishes[0].p_succeeded_count, 2);
  assertEquals(ledger.finishes[0].p_failed_count, 1);
});

// The review case: every retention policy purges correctly and only the benchmark refresh fails.
// Counting the benchmark as a run-level error rather than as one unit closed the whole nightly
// run as 'failed' -- which blocks last_known_good_at and pages the critical watchdog claiming
// retention has not run, on a night when retention ran perfectly.
Deno.test("run-data-lifecycle stays partial when only the benchmark refresh fails", async () => {
  const ledger = { claims: [] as Array<Record<string, unknown>>, finishes: [] as Array<Record<string, unknown>> };
  const policyQuery: any = {
    select: () => policyQuery,
    eq: () => policyQuery,
    order: async () => ({ data: [{ policy_key: "audit-log" }], error: null }),
  };
  const handler = createRunDataLifecycleHandler({
    createClient: () => ({
      from: () => policyQuery,
      rpc: withJobLedger(async (name: string, args: Record<string, unknown>) => {
        if (name === "refresh_benchmark_snapshots") return { data: null, error: { message: "benchmark timeout" } };
        if (name === "list_expired_organization_exports") return { data: [], error: null };
        return { data: { policyKey: args.p_policy_key, rowsAffected: 7 }, error: null };
      }, ledger),
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    }),
    getEnv: configuredEnvironment,
    now: () => new Date("2026-07-17T04:30:00.000Z"),
    authorizeRequest: () => null,
  });

  assertEquals((await handler(new Request("https://example.test", { method: "POST" }))).status, 200);
  assertEquals(ledger.finishes[0].p_status, "partial");
  assertEquals(ledger.finishes[0].p_succeeded_count, 2);
  assertEquals(ledger.finishes[0].p_failed_count, 1);
  assertEquals(ledger.finishes[0].p_error_code, "benchmark_refresh_failed");
});

// The correlation id is the join between the cron invocation, the Edge Function log line and the
// run ledger -- and, when run-system-job dispatches an operator's "Run now", it is the id of the
// queued row that must be adopted rather than a new one opened beside it.
Deno.test("run-data-lifecycle adopts the caller's correlation id", async () => {
  const ledger = { claims: [] as Array<Record<string, unknown>>, finishes: [] as Array<Record<string, unknown>> };
  const policyQuery: any = {
    select: () => policyQuery,
    eq: () => policyQuery,
    order: async () => ({ data: [], error: null }),
  };
  const handler = createRunDataLifecycleHandler({
    createClient: () => ({
      from: () => policyQuery,
      rpc: withJobLedger(async (name: string) => {
        if (name === "list_expired_organization_exports") return { data: [], error: null };
        return { data: 1, error: null };
      }, ledger),
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    }),
    getEnv: configuredEnvironment,
    now: () => new Date("2026-07-17T04:30:00.000Z"),
    authorizeRequest: () => null,
    newCorrelationId: () => "generated-not-used",
  });

  await handler(new Request("https://example.test", {
    method: "POST",
    headers: { "x-correlation-id": "operator-rerun-42" },
  }));
  assertEquals(ledger.claims[0].p_correlation_id, "operator-rerun-42");
});

// A throw anywhere in the sweep must close the run as failed. Inheriting a success default here
// would stamp last_known_good_at for a run that crashed -- the false green this instrumentation
// exists to remove.
Deno.test("run-data-lifecycle closes the run as failed when the sweep throws", async () => {
  const ledger = { claims: [] as Array<Record<string, unknown>>, finishes: [] as Array<Record<string, unknown>> };
  const policyQuery: any = {
    select: () => policyQuery,
    eq: () => policyQuery,
    order: async () => { throw new Error("connection reset"); },
  };
  const handler = createRunDataLifecycleHandler({
    createClient: () => ({
      from: () => policyQuery,
      rpc: withJobLedger(async () => ({ data: null, error: null }), ledger),
    }),
    getEnv: configuredEnvironment,
    now: () => new Date("2026-07-17T04:30:00.000Z"),
    authorizeRequest: () => null,
  });

  let threw = false;
  try {
    await handler(new Request("https://example.test", { method: "POST" }));
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  assertEquals(ledger.finishes.length, 1);
  assertEquals(ledger.finishes[0].p_status, "failed");
  assertEquals(ledger.finishes[0].p_error_code, "unhandled_error");
});

Deno.test("run-data-lifecycle does no work when the ledger refuses the claim", async () => {
  const ledger = { claims: [] as Array<Record<string, unknown>>, finishes: [] as Array<Record<string, unknown>> };
  const handler = createRunDataLifecycleHandler({
    createClient: () => ({
      from: () => { throw new Error("policies must not be read when the claim was refused"); },
      rpc: withJobLedger(async () => { throw new Error("no work may run"); }, ledger, false),
    }),
    getEnv: configuredEnvironment,
    now: () => new Date("2026-07-17T04:30:00.000Z"),
    authorizeRequest: () => null,
  });

  const response = await handler(new Request("https://example.test", { method: "POST" }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { skipped: true, status: "running" });
  // Nothing to finish: the run belongs to whoever holds it.
  assertEquals(ledger.finishes, []);
});
