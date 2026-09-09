import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { createBillingRuntimeHandler } from "../sync-billing-quantities/forwarding.ts";
import { createSyncBillingQuantitiesHandler } from "../sync-billing-quantities/handler.ts";
import { dispatchBillingSystemJob } from "./billingDispatch.ts";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CORRELATION_ID = "22222222-2222-4222-8222-222222222222";
const ENV: Record<string, string> = {
  BILLING_RUNTIME: "railway",
  SUPABASE_URL: "https://xsqobvvreaovwibxwyvv.supabase.co",
  CRON_SHARED_SECRET: "test-only-cron-secret",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role",
  STRIPE_SECRET_KEY: "test-only-stripe-secret",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

// This model enforces finish_system_job's actual queued/running -> terminal rule
// (20260711162509, lines 737-741). SQL failures arrive in Supabase's error envelope,
// not as thrown JavaScript errors. The real billing handler adopts and finishes it.
function lateWorker(
  finalization:
    | "normal"
    | "rpc_error"
    | "transport_before"
    | "transport_after" = "normal",
) {
  const state = { status: "queued", failedFinishes: 0, succeededFinishes: 0 };
  const finishAttempts: string[] = [];
  const claimed = deferred<void>();
  const release = deferred<void>();
  const finish = (status: string) => {
    if (!["queued", "running"].includes(state.status)) {
      if (state.status === status) return { data: null, error: null };
      return {
        data: null,
        error: {
          code: "55000",
          message: "System job already finished differently",
        },
      };
    }
    state.status = status;
    if (status === "failed") state.failedFinishes++;
    if (status === "succeeded") state.succeededFinishes++;
    return { data: null, error: null };
  };
  type EmptySubscriptionsQuery = {
    select: () => EmptySubscriptionsQuery;
    in: () => EmptySubscriptionsQuery;
    order: () => EmptySubscriptionsQuery;
    limit: () => Promise<{ data: never[]; error: null }>;
  };
  const query: EmptySubscriptionsQuery = {
    select: () => query,
    in: () => query,
    order: () => query,
    limit: async () => {
      await release.promise;
      return { data: [], error: null };
    },
  };
  const handler = createSyncBillingQuantitiesHandler({
    createClient: () => ({
      from: (table: string) => {
        assertEquals(table, "billing_subscriptions");
        return query;
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "claim_system_job_execution") {
          assertEquals(args.p_correlation_id, CORRELATION_ID);
          assertEquals(args.p_provider_request_id, `manual:${RUN_ID}`);
          assertEquals(args.p_trigger_type, "manual");
          state.status = "running";
          claimed.resolve();
          return {
            data: [{ run_id: RUN_ID, should_execute: true }],
            error: null,
          };
        }
        assertEquals(name, "finish_system_job");
        assertEquals(args.p_run_id, RUN_ID);
        finishAttempts.push(String(args.p_status));
        if (finalization === "rpc_error") {
          return {
            data: null,
            error: { code: "XX000", message: "test-private-database-error" },
          };
        }
        if (finalization === "transport_before") {
          throw new Error("test-private-transport-error");
        }
        const result = finish(String(args.p_status));
        if (finalization === "transport_after") {
          throw new Error("test-private-response-lost-after-commit");
        }
        return result;
      },
    }),
    getEnv: (name) => ENV[name],
    requireCron: () => null,
    stripeGet: () => {
      throw new Error("No subscriptions: no provider request is expected");
    },
    stripePost: () => {
      throw new Error("No subscriptions: no provider request is expected");
    },
  });
  return { handler, state, claimed, release, finish, finishAttempts };
}

function dispatch(
  fetcher: typeof fetch,
  timeoutMs?: number,
  options: {
    cronSecret?: string;
    finishRejectedNewRun?: () => Promise<{ error: unknown }>;
  } = {},
) {
  return dispatchBillingSystemJob({
    url: `${ENV.SUPABASE_URL}/functions/v1/sync-billing-quantities`,
    cronSecret: options.cronSecret ?? ENV.CRON_SHARED_SECRET,
    runId: RUN_ID,
    correlationId: CORRELATION_ID,
    body: { batchSize: 50, maxRuntimeMs: 110000 },
    signal: new AbortController().signal,
    fetcher,
    timeoutMs,
    finishRejectedNewRun: options.finishRejectedNewRun,
  });
}

Deno.test("lost Railway responses leave the real adopted billing run completable", async () => {
  for (
    const failure of [
      "throw",
      "malformed",
      "oversized",
      "wrong-run",
      "false-success",
      "timeout",
    ]
  ) {
    const worker = lateWorker();
    let workerResponse!: Promise<Response>;
    let railwayAttempts = 0;
    const forwarding = createBillingRuntimeHandler({
      supabaseHandler: () => {
        throw new Error("No fallback permitted");
      },
      getEnv: (name) => ENV[name],
      timeoutMs: failure === "timeout" ? 5 : 1000,
      fetcher: async (input, init) => {
        railwayAttempts++;
        workerResponse = worker.handler(new Request(input, init));
        await worker.claimed.promise;
        if (failure === "throw") {
          throw new Error("Response lost after worker adopted run");
        }
        if (failure === "malformed") {
          return new Response('{"success":', {
            headers: { "content-type": "application/json" },
          });
        }
        if (failure === "oversized") {
          return json({ success: true, detail: "x".repeat(65537) });
        }
        if (failure === "wrong-run") {
          return json({
            success: true,
            runId: CORRELATION_ID,
            correlationId: RUN_ID,
          });
        }
        if (failure === "false-success") {
          return json({
            success: false,
            runId: RUN_ID,
            correlationId: CORRELATION_ID,
          });
        }
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("Response timed out")),
            { once: true },
          );
        });
      },
    });
    const result = await dispatch(
      (input, init) => Promise.resolve(forwarding(new Request(input, init))),
      undefined,
      { finishRejectedNewRun: async () => worker.finish("failed") },
    );
    assertEquals(result.status, 502);
    assertEquals(result.body.dispatchOutcome, "unknown");
    assertEquals(result.body.runId, RUN_ID);
    assertEquals(result.body.correlationId, CORRELATION_ID);
    assertEquals(result.body.success, undefined);
    assertEquals(worker.state.status, "running");
    worker.release.resolve();
    assertEquals((await workerResponse).status, 200);
    assertEquals(worker.state, {
      status: "succeeded",
      failedFinishes: 0,
      succeededFinishes: 1,
    });
    assertEquals(railwayAttempts, 1);
  }
});

Deno.test("a conflicting terminal row returns an RPC error envelope and never false worker success", async () => {
  const worker = lateWorker();
  const running = worker.handler(
    new Request("https://example.test", {
      method: "POST",
      headers: {
        "x-correlation-id": CORRELATION_ID,
        "x-request-id": `manual:${RUN_ID}`,
      },
      body: "{}",
    }),
  );
  await worker.claimed.promise;
  // This is the removed fallback: HTTP 502 -> finish_system_job(..., 'failed').
  assertEquals(worker.finish("failed").error, null);
  worker.release.resolve();
  const response = await running;
  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error: "job_finalization_unconfirmed",
    dispatchOutcome: "unknown",
    runId: RUN_ID,
    correlationId: CORRELATION_ID,
  });
  assertEquals(worker.state.failedFinishes, 1);
  assertEquals(worker.state.succeededFinishes, 0);
  assertEquals(worker.finishAttempts, ["succeeded"]);
});

Deno.test("direct dispatcher fetch, timeout and response-read failures never finalize the adopted run", async () => {
  for (const failure of ["throw", "timeout", "read", "malformed", "html"]) {
    const worker = lateWorker();
    let running!: Promise<Response>;
    const result = await dispatch(
      async (input, init) => {
        running = worker.handler(new Request(input, init));
        await worker.claimed.promise;
        if (failure === "throw") {
          throw new Error("Connection closed after dispatch");
        }
        if (failure === "timeout") {
          return await new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("Timeout")),
              { once: true },
            );
          });
        }
        if (failure === "read") {
          return new Response(
            new ReadableStream({
              start(c) {
                c.error(new Error("Truncated stream"));
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (failure === "html") {
          return new Response("<html>upstream error</html>");
        }
        return new Response("{", {
          headers: { "content-type": "application/json" },
        });
      },
      failure === "timeout" ? 5 : 1000,
      {
        finishRejectedNewRun: async () => worker.finish("failed"),
      },
    );
    assertEquals(result.status, 502);
    assertEquals(result.body.dispatchOutcome, "unknown");
    assertEquals(worker.state.status, "running");
    worker.release.resolve();
    await running;
    assertEquals(worker.state, {
      status: "succeeded",
      failedFinishes: 0,
      succeededFinishes: 1,
    });
  }
});

Deno.test("verified pre-forward rejection leaves an already-running canonical replay completable", async () => {
  const worker = lateWorker();
  const running = worker.handler(
    new Request("https://example.test", {
      method: "POST",
      headers: {
        "x-correlation-id": CORRELATION_ID,
        "x-request-id": `manual:${RUN_ID}`,
      },
      body: "{}",
    }),
  );
  await worker.claimed.promise;
  let attempted = 0;
  const forwarding = createBillingRuntimeHandler({
    supabaseHandler: () => {
      throw new Error("No fallback");
    },
    getEnv: (name) => name === "BILLING_RUNTIME" ? "invalid" : ENV[name],
    fetcher: () => {
      attempted++;
      throw new Error("Must not dispatch");
    },
  });
  const result = await dispatch(
    (input, init) => Promise.resolve(forwarding(new Request(input, init))),
  );
  assertEquals(result.status, 502);
  assertEquals(result.body.dispatchOutcome, "not_started");
  assertEquals(attempted, 0);
  assertEquals(worker.state.status, "running");
  worker.release.resolve();
  assertEquals((await running).status, 200);
  assertEquals(worker.state, {
    status: "succeeded",
    failedFinishes: 0,
    succeededFinishes: 1,
  });
});

Deno.test("arbitrary not-started markers cannot terminalize a run", async () => {
  for (
    const value of [
      {
        error: "provider_diagnostic",
        dispatchOutcome: "not_started",
        runId: RUN_ID,
        correlationId: CORRELATION_ID,
      },
      {
        error: "billing_runtime_invalid",
        dispatchOutcome: "not_started",
        runId: CORRELATION_ID,
        correlationId: CORRELATION_ID,
      },
      {
        error: "billing_runtime_invalid",
        dispatchOutcome: "not_started",
        runId: RUN_ID,
        correlationId: RUN_ID,
      },
      {
        error: "billing_runtime_invalid",
        dispatchOutcome: "not_started",
        runId: RUN_ID,
        correlationId: CORRELATION_ID,
      },
    ]
  ) {
    let cleanupAttempts = 0;
    const result = await dispatch(async () => json(value, 502), undefined, {
      finishRejectedNewRun: async () => {
        cleanupAttempts++;
        return { error: null };
      },
    });
    assertEquals(result.body.dispatchOutcome, "unknown");
    assertEquals(cleanupAttempts, 0);
  }
});

Deno.test("only matching confirmed worker success is reported as successful dispatch", async () => {
  for (const success of [true, false]) {
    const result = await dispatch(
      async () =>
        json(
          { success, runId: RUN_ID, correlationId: CORRELATION_ID },
          success ? 200 : 502,
        ),
    );
    assertEquals(result.status, success ? 200 : 502);
    assertEquals(result.body.success, success ? true : undefined);
  }
});

Deno.test("billing worker finalization errors remain unconfirmed without leaking diagnostics or retrying", async () => {
  for (
    const failure of [
      "rpc_error",
      "transport_before",
      "transport_after",
    ] as const
  ) {
    const worker = lateWorker(failure);
    const running = worker.handler(
      new Request("https://example.test", {
        method: "POST",
        headers: {
          "x-correlation-id": CORRELATION_ID,
          "x-request-id": `manual:${RUN_ID}`,
        },
        body: "{}",
      }),
    );
    await worker.claimed.promise;
    worker.release.resolve();
    const response = await running;
    assertEquals(response.status, 502);
    assertEquals(await response.clone().json(), {
      error: "job_finalization_unconfirmed",
      dispatchOutcome: "unknown",
      runId: RUN_ID,
      correlationId: CORRELATION_ID,
    });
    assertEquals(worker.finishAttempts, ["succeeded"]);
    assertEquals(worker.state.failedFinishes, 0);
    assertEquals(
      worker.state.status,
      failure === "transport_after" ? "succeeded" : "running",
    );
    const result = await dispatch(async () => response);
    assertEquals(result.status, 502);
    assertEquals(result.body.dispatchOutcome, "unknown");
    assertEquals(result.body.success, undefined);
  }
});

Deno.test("verified rejection and missing cron close only fresh owned queued runs", async () => {
  for (const missingCron of [false, true]) {
    const ledger = lateWorker();
    let dispatchAttempts = 0;
    let cleanupAttempts = 0;
    const result = await dispatch(
      async () => {
        dispatchAttempts++;
        return json({
          error: "billing_runtime_invalid",
          dispatchOutcome: "not_started",
          runId: RUN_ID,
          correlationId: CORRELATION_ID,
        }, 503);
      },
      undefined,
      {
        cronSecret: missingCron ? "" : ENV.CRON_SHARED_SECRET,
        finishRejectedNewRun: async () => {
          cleanupAttempts++;
          return ledger.finish("failed");
        },
      },
    );
    assertEquals(result.status, missingCron ? 503 : 502);
    assertEquals(result.body.dispatchOutcome, "not_started");
    assertEquals(result.body.success, undefined);
    assertEquals(dispatchAttempts, missingCron ? 0 : 1);
    assertEquals(cleanupAttempts, 1);
    assertEquals(ledger.state, {
      status: "failed",
      failedFinishes: 1,
      succeededFinishes: 0,
    });
  }
});

Deno.test("rejected canonical replays stay unchanged for queued running and succeeded rows", async () => {
  for (const status of ["queued", "running", "succeeded"]) {
    for (const missingCron of [false, true]) {
      const ledger = lateWorker();
      ledger.state.status = status;
      const before = { ...ledger.state };
      let dispatchAttempts = 0;
      const result = await dispatch(
        async () => {
          dispatchAttempts++;
          return json({
            error: "billing_runtime_invalid",
            dispatchOutcome: "not_started",
            runId: RUN_ID,
            correlationId: CORRELATION_ID,
          }, 503);
        },
        undefined,
        { cronSecret: missingCron ? "" : ENV.CRON_SHARED_SECRET },
      );
      assertEquals(result.body.dispatchOutcome, "not_started");
      assertEquals(result.body.success, undefined);
      assertEquals(dispatchAttempts, missingCron ? 0 : 1);
      assertEquals(ledger.state, before);
      assertEquals(ledger.finishAttempts, []);
    }
  }
});

Deno.test("fresh rejection cleanup RPC errors and lost responses remain unknown without retry", async () => {
  for (const missingCron of [false, true]) {
    for (
      const failure of ["rpc_error", "transport_before", "transport_after"]
    ) {
      const ledger = lateWorker();
      let cleanupAttempts = 0;
      const result = await dispatch(
        async () =>
          json({
            error: "billing_runtime_invalid",
            dispatchOutcome: "not_started",
            runId: RUN_ID,
            correlationId: CORRELATION_ID,
          }, 503),
        undefined,
        {
          cronSecret: missingCron ? "" : ENV.CRON_SHARED_SECRET,
          finishRejectedNewRun: async () => {
            cleanupAttempts++;
            if (failure === "rpc_error") {
              return {
                data: null,
                error: { code: "XX000", message: "private cleanup diagnostic" },
              };
            }
            if (failure === "transport_after") ledger.finish("failed");
            throw new Error("private cleanup transport diagnostic");
          },
        },
      );
      assertEquals(result.status, 502);
      assertEquals(result.body.dispatchOutcome, "unknown");
      assertEquals(result.body.runId, RUN_ID);
      assertEquals(result.body.correlationId, CORRELATION_ID);
      assertEquals(result.body.success, undefined);
      assertEquals(JSON.stringify(result.body).includes("private"), false);
      assertEquals(cleanupAttempts, 1);
      assertEquals(
        ledger.state.status,
        failure === "transport_after" ? "failed" : "queued",
      );
    }
  }
});
