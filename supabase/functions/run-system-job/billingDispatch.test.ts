import {
  deepStrictEqual as assertEquals,
  rejects as assertRejects,
} from "node:assert/strict";
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
// (20260711162509, lines 737-741). The real billing handler adopts and finishes it.
function lateWorker() {
  const state = { status: "queued", failedFinishes: 0, succeededFinishes: 0 };
  const claimed = deferred<void>();
  const release = deferred<void>();
  const finish = (status: string) => {
    if (!["queued", "running"].includes(state.status)) {
      if (state.status === status) return;
      throw new Error("System job already finished differently");
    }
    state.status = status;
    if (status === "failed") state.failedFinishes++;
    if (status === "succeeded") state.succeededFinishes++;
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
        finish(String(args.p_status));
        return { data: null, error: null };
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
  return { handler, state, claimed, release, finish };
}

function dispatch(
  fetcher: typeof fetch,
  finishNotStarted: () => Promise<void>,
  timeoutMs?: number,
) {
  return dispatchBillingSystemJob({
    url: `${ENV.SUPABASE_URL}/functions/v1/sync-billing-quantities`,
    cronSecret: ENV.CRON_SHARED_SECRET,
    runId: RUN_ID,
    correlationId: CORRELATION_ID,
    body: { batchSize: 50, maxRuntimeMs: 110000 },
    signal: new AbortController().signal,
    fetcher,
    finishNotStarted,
    timeoutMs,
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
    let dispatcherFinishes = 0;
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
      async () => {
        dispatcherFinishes++;
        worker.finish("failed");
      },
    );
    assertEquals(result.status, 502);
    assertEquals(result.body.dispatchOutcome, "unknown");
    assertEquals(result.body.runId, RUN_ID);
    assertEquals(result.body.correlationId, CORRELATION_ID);
    assertEquals(result.body.success, undefined);
    assertEquals(dispatcherFinishes, 0);
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

Deno.test("negative control reproduces the old dispatcher terminal conflict", async () => {
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
  worker.finish("failed");
  worker.release.resolve();
  await assertRejects(running, /System job already finished differently/);
  assertEquals(worker.state.failedFinishes, 1);
});

Deno.test("direct dispatcher fetch, timeout and response-read failures never finalize the adopted run", async () => {
  for (const failure of ["throw", "timeout", "read", "malformed", "html"]) {
    const worker = lateWorker();
    let running!: Promise<Response>;
    const result = await dispatch(async (input, init) => {
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
    }, async () => {
      worker.finish("failed");
    }, failure === "timeout" ? 5 : 1000);
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

Deno.test("verified pre-forward rejection still finalizes the queued run", async () => {
  let finalized = 0;
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
    async () => {
      finalized++;
    },
  );
  assertEquals(result.status, 502);
  assertEquals(result.body.dispatchOutcome, "not_started");
  assertEquals(finalized, 1);
  assertEquals(attempted, 0);
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
    let finalized = 0;
    const result = await dispatch(async () => json(value, 502), async () => {
      finalized++;
    });
    assertEquals(result.body.dispatchOutcome, "unknown");
    assertEquals(finalized, 0);
  }
});

Deno.test("only matching confirmed worker success is reported as successful dispatch", async () => {
  let finalized = 0;
  for (const success of [true, false]) {
    const result = await dispatch(
      async () =>
        json(
          { success, runId: RUN_ID, correlationId: CORRELATION_ID },
          success ? 200 : 502,
        ),
      async () => {
        finalized++;
      },
    );
    assertEquals(result.status, success ? 200 : 502);
    assertEquals(result.body.success, success ? true : undefined);
  }
  assertEquals(finalized, 0);
});
