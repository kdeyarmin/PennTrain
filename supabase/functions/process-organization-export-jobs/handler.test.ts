import { assertEquals } from "jsr:@std/assert@1.0.14";
import { requireCronRequest } from "../_shared/cronAuth.ts";
import { createProcessOrganizationExportJobsHandler } from "./handler.ts";

// These suites are about the system-job ledger this worker gained in 20260904090000, not about
// archive building. Every case below leaves the export queue empty or fails before a claim, so
// buildExport -- streaming zip, Storage reads, checksums -- is never entered; its behaviour is
// covered by the database-side export tests. What is asserted here is the part the watchdog
// reads: that a run is claimed before any work, that it is finished on every exit path, and with
// what outcome. Before this instrumentation `organization-data-export` had no run rows at all,
// so the watchdog fell back to pg_cron's exit status for a `net.http_post` command -- a signal
// that only ever proves the request was enqueued. See BACKLOG G270.

const configuredEnvironment = (name: string) => ({
  SUPABASE_URL: "https://project.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
})[name];

type RpcCall = { name: string; args: Record<string, unknown> };

function harness(options: {
  shouldExecute?: boolean;
  queue?: { data: unknown; error: { message: string } | null };
  throwOnQueueClaim?: boolean;
  finishError?: { message: string } | null;
} = {}) {
  const calls: RpcCall[] = [];
  const {
    shouldExecute = true,
    queue = { data: [], error: null },
    throwOnQueueClaim = false,
    finishError = null,
  } = options;

  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "claim_system_job_execution") {
        return Promise.resolve({
          data: [{
            run_id: "run-1",
            should_execute: shouldExecute,
            existing_status: shouldExecute ? null : "running",
          }],
          error: null,
        });
      }
      if (name === "claim_organization_export_jobs") {
        if (throwOnQueueClaim) throw new Error("connection reset by peer");
        return Promise.resolve(queue);
      }
      if (name === "finish_system_job") return Promise.resolve({ data: null, error: finishError });
      throw new Error(`unexpected rpc ${name}`);
    },
  };

  const handler = createProcessOrganizationExportJobsHandler({
    createClient: () => admin as never,
    getEnv: configuredEnvironment,
    authorizeRequest: () => null,
    newCorrelationId: () => "generated-correlation-id",
  });
  return { calls, handler };
}

function post(headers: Record<string, string> = {}) {
  return new Request("https://example.test", { method: "POST", headers });
}

function only(calls: RpcCall[], name: string) {
  return calls.filter((call) => call.name === name);
}

Deno.test("process-organization-export-jobs enforces the cron request contract", async () => {
  const handler = createProcessOrganizationExportJobsHandler({
    createClient: () => {
      throw new Error("client should not be created for an unauthorized request");
    },
    getEnv: configuredEnvironment,
    authorizeRequest: (request, headers) =>
      requireCronRequest(request, headers, "runtime-test-secret"),
  });
  assertEquals((await handler(new Request("https://example.test", { method: "POST" }))).status, 401);
});

Deno.test("process-organization-export-jobs claims a run before touching the queue", async () => {
  const { calls, handler } = harness();
  await handler(post());

  assertEquals(calls[0].name, "claim_system_job_execution");
  assertEquals(calls[0].args, {
    p_job_key: "organization-data-export",
    p_correlation_id: "generated-correlation-id",
    p_trigger_type: "scheduled",
    p_provider_request_id: null,
  });
  // The queue is only touched after the claim: a run that dies mid-export must leave a claimed
  // row the abandoned-run reconciler can close, not an untraceable invocation.
  assertEquals(calls[1].name, "claim_organization_export_jobs");
});

Deno.test("process-organization-export-jobs records an idle sweep as a successful run", async () => {
  const { calls, handler } = harness();
  const response = await handler(post());
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { claimed: 0, results: [] });

  // An empty queue is a successful run with nothing attempted. Staying silent on a quiet day
  // would make "no exports requested" and "worker is dead" look identical to the watchdog.
  const [finish] = only(calls, "finish_system_job");
  assertEquals(finish.args.p_run_id, "run-1");
  assertEquals(finish.args.p_status, "succeeded");
  assertEquals(finish.args.p_attempted_count, 0);
  assertEquals(finish.args.p_succeeded_count, 0);
  assertEquals(finish.args.p_failed_count, 0);
  assertEquals(finish.args.p_error_code, null);
});

Deno.test("process-organization-export-jobs adopts the caller's correlation id", async () => {
  const { calls, handler } = harness();
  // run-system-job forwards the correlation id of the queued row an operator's "Run now"
  // created. Minting a fresh one instead would open an unrelated run beside it and leave the
  // operator's row queued until the reconciler rewrote it as a crash that never happened.
  await handler(post({ "x-correlation-id": "operator-rerun-42" }));
  assertEquals(only(calls, "claim_system_job_execution")[0].args.p_correlation_id, "operator-rerun-42");
});

Deno.test("process-organization-export-jobs truncates an over-long correlation id", async () => {
  const { calls, handler } = harness();
  await handler(post({ "x-correlation-id": "x".repeat(500) }));
  assertEquals(
    (only(calls, "claim_system_job_execution")[0].args.p_correlation_id as string).length,
    200,
  );
});

Deno.test("process-organization-export-jobs does no work when the ledger refuses the claim", async () => {
  const { calls, handler } = harness({ shouldExecute: false });
  const response = await handler(post());
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { skipped: true, status: "running" });

  // A refused claim means another invocation already owns this run. Draining the queue anyway
  // would double-process, and finishing a run this invocation does not own would close theirs.
  assertEquals(only(calls, "claim_organization_export_jobs").length, 0);
  assertEquals(only(calls, "finish_system_job").length, 0);
});

Deno.test("process-organization-export-jobs closes the run when the queue is unavailable", async () => {
  const { calls, handler } = harness({
    queue: { data: null, error: { message: "lease table is gone" } },
  });
  const response = await handler(post());
  assertEquals(response.status, 500);

  // The early 500 returns from inside the try, so the finally still runs: an exit path that
  // skipped it would leave the run 'running' until the reconciler mislabelled it a crash.
  const [finish] = only(calls, "finish_system_job");
  assertEquals(finish.args.p_status, "failed");
  assertEquals(finish.args.p_error_code, "queue_unavailable");
  assertEquals(finish.args.p_error_message, "lease table is gone");
});

Deno.test("process-organization-export-jobs closes the run as failed when the drain throws", async () => {
  const { calls, handler } = harness({ throwOnQueueClaim: true });
  let threw = false;
  try {
    await handler(post());
  } catch {
    threw = true;
  }
  assertEquals(threw, true);

  // The outcome defaults to the failure shape, so a throw records a failure rather than
  // inheriting a success default -- the false green this instrumentation exists to remove.
  const [finish] = only(calls, "finish_system_job");
  assertEquals(finish.args.p_status, "failed");
  assertEquals(finish.args.p_error_code, "unhandled_error");
});

Deno.test("process-organization-export-jobs logs a finalize that itself fails", async () => {
  const { handler } = harness({ finishError: { message: "ledger unreachable" } });
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  try {
    await handler(post());
  } finally {
    console.error = originalError;
  }

  // Silence here is what leaves a run 'running' with nobody able to say why.
  assertEquals(logged.length, 1);
  const entry = JSON.parse(logged[0]);
  assertEquals(entry.event, "organization_export.finish_system_job_failed");
  assertEquals(entry.runId, "run-1");
  assertEquals(entry.correlationId, "generated-correlation-id");
  assertEquals(entry.error, "ledger unreachable");
});
