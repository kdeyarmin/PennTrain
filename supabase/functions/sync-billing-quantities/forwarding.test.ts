import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { createBillingRuntimeHandler } from "./forwarding.ts";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CORRELATION_ID = "22222222-2222-4222-8222-222222222222";
const ENV: Record<string, string> = {
  BILLING_RUNTIME: "railway",
  SUPABASE_URL: "https://xsqobvvreaovwibxwyvv.supabase.co",
  CRON_SHARED_SECRET: "test-only-cron-secret",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function request(
  headers: Record<string, string> = {},
  body = '{ "batchSize": 50, "maxRuntimeMs": 110000 }',
): Request {
  const requestHeaders = new Headers({
    "x-caremetric-cron-secret": ENV.CRON_SHARED_SECRET,
    "x-correlation-id": CORRELATION_ID,
  });
  for (const [name, value] of Object.entries(headers)) {
    requestHeaders.set(name, value);
  }
  return new Request(
    "https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/sync-billing-quantities",
    {
      method: "POST",
      headers: requestHeaders,
      body,
    },
  );
}

function fixture({
  env = ENV,
  fetcher = () => Promise.resolve(response({ success: true, runId: RUN_ID })),
  timeoutMs,
}: {
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
} = {}) {
  const state = { delegated: 0, fetched: 0, envNames: [] as string[] };
  const handler = createBillingRuntimeHandler({
    supabaseHandler: () => {
      state.delegated++;
      return response({ source: "supabase" });
    },
    getEnv: (name) => {
      state.envNames.push(name);
      return env[name];
    },
    fetcher: (input, init) => {
      state.fetched++;
      return fetcher(input, init);
    },
    timeoutMs,
  });
  return { handler, state };
}

Deno.test("billing runtime remains Supabase until explicitly enabled", async () => {
  for (const runtime of [undefined, "supabase"]) {
    const { handler, state } = fixture({ env: { BILLING_RUNTIME: runtime } });
    assertEquals(await (await handler(request())).json(), {
      source: "supabase",
    });
    assertEquals(state.delegated, 1);
    assertEquals(state.fetched, 0);
    assertEquals(state.envNames, ["BILLING_RUNTIME"]);
  }
});

Deno.test("billing runtime invalid values fail closed without reading request bodies", async () => {
  for (
    const runtime of ["", "Railway", " railway ", "https://unexpected.test"]
  ) {
    const { handler, state } = fixture({
      env: { ...ENV, BILLING_RUNTIME: runtime },
    });
    const req = request();
    assertEquals((await handler(req)).status, 503);
    assertEquals(req.bodyUsed, false);
    assertEquals(state.delegated + state.fetched, 0);
  }
});

Deno.test("billing runtime cannot forward staging credentials to production", async () => {
  for (
    const url of [
      undefined,
      "https://staging.supabase.co",
      `${ENV.SUPABASE_URL}/`,
      `${ENV.SUPABASE_URL}.unexpected.test`,
    ]
  ) {
    const { handler, state } = fixture({ env: { ...ENV, SUPABASE_URL: url } });
    assertEquals((await handler(request())).status, 503);
    assertEquals(state.fetched + state.delegated, 0);
    assertEquals(state.envNames.includes("CRON_SHARED_SECRET"), false);
  }
});

Deno.test("billing runtime authenticates before consuming bodies or dispatching", async () => {
  const { handler, state } = fixture();
  for (const secret of ["", "incorrect"]) {
    const req = request({ "x-caremetric-cron-secret": secret });
    assertEquals((await handler(req)).status, 401);
    assertEquals(req.bodyUsed, false);
  }
  assertEquals(state.fetched + state.delegated, 0);
});

Deno.test("billing runtime missing cron configuration does not fall back to global environment", async () => {
  const { handler, state } = fixture({
    env: { ...ENV, CRON_SHARED_SECRET: undefined },
  });
  assertEquals((await handler(request())).status, 500);
  assertEquals(state.fetched + state.delegated, 0);
});

Deno.test("billing runtime refuses non-POST methods and advertises no browser CORS origin", async () => {
  const { handler, state } = fixture();
  for (const method of ["GET", "OPTIONS", "PUT"]) {
    const result = await handler(
      new Request("https://example.test", { method }),
    );
    assertEquals(result.status, 405);
    assertEquals(result.headers.get("access-control-allow-origin"), null);
  }
  assertEquals(state.fetched + state.delegated, 0);
});

Deno.test("billing runtime preserves cron and manual dispatch identity while dropping unrelated credentials", async () => {
  for (const manual of [false, true]) {
    const raw = '{ "batchSize": 50, "maxRuntimeMs": 110000 }';
    const req = request({
      "X-Correlation-Id": CORRELATION_ID,
      ...(manual ? { "X-Request-Id": `manual:${RUN_ID}` } : {}),
      Authorization: "Bearer test-user-session",
      apikey: "test-api-key",
      Cookie: "test-cookie",
      "X-Forwarded-Host": "unexpected.test",
    }, raw);
    const { handler, state } = fixture({
      fetcher: async (input, init) => {
        assertEquals(
          input,
          "https://cmcarebase.com/api/providers/sync-billing-quantities",
        );
        assertEquals(init?.method, "POST");
        assertEquals(init?.redirect, "error");
        assertEquals(new TextDecoder().decode(init?.body as Uint8Array), raw);
        const headers = new Headers(init?.headers);
        assertEquals(
          [...headers.keys()].sort(),
          [
            "content-type",
            "x-caremetric-cron-secret",
            "x-correlation-id",
            ...(manual ? ["x-request-id"] : []),
          ].sort(),
        );
        assertEquals(
          headers.get("x-caremetric-cron-secret"),
          ENV.CRON_SHARED_SECRET,
        );
        assertEquals(headers.get("x-correlation-id"), CORRELATION_ID);
        assertEquals(
          headers.get("x-request-id"),
          manual ? `manual:${RUN_ID}` : null,
        );
        return response({
          success: true,
          runId: RUN_ID,
          correlationId: CORRELATION_ID,
          updated: 2,
        });
      },
    });
    assertEquals(await (await handler(req)).json(), {
      success: true,
      runId: RUN_ID,
      correlationId: CORRELATION_ID,
      updated: 2,
    });
    assertEquals(state.fetched, 1);
    assertEquals(state.delegated, 0);
    assertEquals(
      state.envNames.sort(),
      ["BILLING_RUNTIME", "CRON_SHARED_SECRET", "SUPABASE_URL"].sort(),
    );
  }
});

Deno.test("billing runtime enforces both declared and streaming request limits", async () => {
  for (
    const req of [
      request({ "content-length": "16385" }),
      request({}, "x".repeat(16385)),
    ]
  ) {
    const { handler, state } = fixture();
    assertEquals((await handler(req)).status, 413);
    assertEquals(state.fetched + state.delegated, 0);
  }
});

Deno.test("billing runtime returns only reviewed success and failure fields", async () => {
  for (const status of [200, 502]) {
    const { handler } = fixture({
      fetcher: async () =>
        response({
          success: status === 200,
          runId: RUN_ID,
          correlationId: CORRELATION_ID,
          replayed: false,
          subscriptions: 2,
          items: 3,
          updated: 1,
          unchanged: -1,
          skipped: "1",
          outOfRange: 0,
          prorationBehavior: "none",
          debug: "test-only-provider-secret",
          headers: { token: "test-only-token" },
        }, status),
    });
    const result = await handler(request());
    assertEquals(result.status, status);
    assertEquals(await result.json(), {
      success: status === 200,
      runId: RUN_ID,
      correlationId: CORRELATION_ID,
      replayed: false,
      subscriptions: 2,
      items: 3,
      updated: 1,
      outOfRange: 0,
      prorationBehavior: "none",
    });
  }
});

Deno.test("billing runtime projects known error codes and removes raw upstream diagnostics", async () => {
  for (
    const error of [
      "billing_sync_not_configured",
      "test-only-private-provider-diagnostic",
    ]
  ) {
    const { handler, state } = fixture({
      fetcher: async () =>
        response({ error, details: "test-only-secret" }, 503),
    });
    const result = await handler(request());
    assertEquals(result.status, 503);
    assertEquals(await result.json(), {
      error: error === "billing_sync_not_configured"
        ? error
        : "billing_runtime_worker_failed",
    });
    assertEquals(state.fetched, 1);
    assertEquals(state.delegated, 0);
  }
});

Deno.test("billing runtime rejects redirects, SPA HTML, invalid JSON, and false success", async () => {
  for (
    const upstream of [
      new Response(null, {
        status: 302,
        headers: { location: "https://unexpected.test" },
      }),
      new Response("<html>app</html>", {
        headers: { "content-type": "text/html" },
      }),
      new Response("invalid", {
        headers: { "content-type": "application/json" },
      }),
      response(null),
      response([]),
      response({ error: "wrong-endpoint" }),
      response({ success: false }),
      response({ success: true }),
    ]
  ) {
    const { handler, state } = fixture({
      fetcher: () => Promise.resolve(upstream),
    });
    const result = await handler(request());
    assertEquals(result.status, 502);
    assertEquals(await result.json(), {
      error: "billing_runtime_invalid_response",
      dispatchOutcome: "unknown",
      correlationId: CORRELATION_ID,
    });
    assertEquals(result.headers.get("location"), null);
    assertEquals(state.fetched, 1);
    assertEquals(state.delegated, 0);
  }
});

Deno.test("billing runtime bounds upstream responses before projecting results", async () => {
  for (
    const upstream of [
      new Response("{}", {
        headers: {
          "content-length": "65537",
          "content-type": "application/json",
        },
      }),
      response({ success: true, debug: "x".repeat(65537) }),
    ]
  ) {
    const { handler, state } = fixture({
      fetcher: () => Promise.resolve(upstream),
    });
    assertEquals((await handler(request())).status, 502);
    assertEquals(state.fetched, 1);
    assertEquals(state.delegated, 0);
  }
});

Deno.test("billing runtime transport failures never retry, fall back, or expose thrown values", async () => {
  const { handler, state } = fixture({
    fetcher: () =>
      Promise.reject(new Error("test-only-private-transport-data")),
  });
  assertEquals(await (await handler(request())).json(), {
    error: "billing_runtime_unavailable",
    dispatchOutcome: "unknown",
    correlationId: CORRELATION_ID,
  });
  assertEquals(state.fetched, 1);
  assertEquals(state.delegated, 0);
});

Deno.test("billing runtime aborts a timed-out dispatch without a second attempt", async () => {
  let aborted = false;
  const { handler, state } = fixture({
    timeoutMs: 5,
    fetcher: (_input, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("timeout"));
        }, { once: true });
      }),
  });
  assertEquals(await (await handler(request())).json(), {
    error: "billing_runtime_timeout",
    dispatchOutcome: "unknown",
    correlationId: CORRELATION_ID,
  });
  assertEquals(aborted, true);
  assertEquals(state.fetched, 1);
  assertEquals(state.delegated, 0);
});

Deno.test("billing runtime also bounds a stalled request-body stream", async () => {
  let cancelled = false;
  const req = new Request("https://example.test", {
    method: "POST",
    headers: {
      "x-caremetric-cron-secret": ENV.CRON_SHARED_SECRET,
      "x-correlation-id": CORRELATION_ID,
    },
    body: new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  });
  const { handler, state } = fixture({ timeoutMs: 5 });
  assertEquals(await (await handler(req)).json(), {
    error: "billing_runtime_timeout",
    dispatchOutcome: "not_started",
    correlationId: CORRELATION_ID,
  });
  assertEquals(cancelled, true);
  assertEquals(state.fetched + state.delegated, 0);
});

Deno.test("billing runtime honors caller cancellation before starting provider work", async () => {
  const controller = new AbortController();
  controller.abort();
  const req = new Request(request(), { signal: controller.signal });
  const { handler, state } = fixture();
  assertEquals(await (await handler(req)).json(), {
    error: "billing_runtime_timeout",
    dispatchOutcome: "not_started",
    correlationId: CORRELATION_ID,
  });
  assertEquals(state.fetched + state.delegated, 0);
});
