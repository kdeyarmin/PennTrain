import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";

const PRODUCTION_SUPABASE_URL = "https://xsqobvvreaovwibxwyvv.supabase.co";
const RAILWAY_SYNC_URL =
  "https://cmcarebase.com/api/providers/sync-billing-quantities";
const MAX_REQUEST_BYTES = 16_384;
const MAX_RESPONSE_BYTES = 65_536;
// Both registered callers request 110 seconds; the worker caps arbitrary requests at
// 150 seconds and Stripe calls at 15 seconds. Leave time for its final durable result.
const FORWARD_TIMEOUT_MS = 180_000;
const RESPONSE_HEADERS = withCronCorsHeader({
  "Content-Type": "application/json",
  "Access-Control-Allow-Headers":
    "content-type, x-correlation-id, x-request-id",
});
const ERROR_CODES = new Set([
  "billing_sync_not_configured",
  "invalid_json",
  "job_tracking_failed",
  "subscription_read_failed",
  "subscription_item_read_failed",
  "billing_price_read_failed",
]);
const COUNT_FIELDS = [
  "subscriptions",
  "items",
  "updated",
  "unchanged",
  "skipped",
  "syncedSubscriptions",
  "unmappedSubscriptions",
  "outOfRange",
  "failed",
  "deferredSubscriptions",
  "trackingFailures",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Handler = (req: Request) => Response | Promise<Response>;

export interface BillingRuntimeDependencies {
  supabaseHandler: Handler;
  getEnv?: (name: string) => string | undefined;
  fetcher?: typeof fetch;
  // Injectable only for deterministic timeout tests; configuration cannot increase the cap.
  timeoutMs?: number;
}

class BodyTooLarge extends Error {}

function projectResult(
  value: Record<string, unknown>,
  req: Request,
  status: number,
): Record<string, unknown> {
  if (typeof value.success !== "boolean") {
    return {
      error: typeof value.error === "string" && ERROR_CODES.has(value.error)
        ? value.error
        : "billing_runtime_worker_failed",
    };
  }
  const result: Record<string, unknown> = {
    success: value.success && status === 200,
  };
  if (typeof value.replayed === "boolean") result.replayed = value.replayed;
  if (typeof value.runId === "string" && UUID.test(value.runId)) {
    result.runId = value.runId;
  }
  if (
    typeof value.correlationId === "string" && (
      UUID.test(value.correlationId) ||
      value.correlationId === req.headers.get("x-correlation-id")?.slice(0, 200)
    )
  ) result.correlationId = value.correlationId;
  for (const key of COUNT_FIELDS) {
    const count = value[key];
    if (
      typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    ) result[key] = count;
  }
  if (value.prorationBehavior === "none") result.prorationBehavior = "none";
  return result;
}

export async function readBoundedBody(
  message: Request | Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted();
  if (Number(message.headers.get("content-length")) > maxBytes) {
    void message.body?.cancel().catch(() => {});
    throw new BodyTooLarge();
  }
  if (!message.body) return new Uint8Array();
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(new DOMException("Dispatch timed out", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) {
        complete = true;
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) throw new BodyTooLarge();
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * Keep the existing cron and operator-dispatch URLs while provider code runs on
 * Railway. This is an explicit, production-only switch, separate from the browser
 * build flag. It never copies provider credentials or falls back after dispatch.
 */
export function createBillingRuntimeHandler({
  supabaseHandler,
  getEnv = (name) => Deno.env.get(name),
  fetcher = fetch,
  timeoutMs = FORWARD_TIMEOUT_MS,
}: BillingRuntimeDependencies): Handler {
  return async (req: Request): Promise<Response> => {
    let correlationId = req.headers.get("x-correlation-id")?.slice(0, 200);
    const requestId = req.headers.get("x-request-id") ?? "";
    const manualRunId =
      requestId.startsWith("manual:") && UUID.test(requestId.slice(7))
        ? requestId.slice(7)
        : undefined;
    const fail = (
      error: string,
      status: number,
      dispatchOutcome: "not_started" | "unknown" = "not_started",
    ) =>
      new Response(
        JSON.stringify({
          error,
          dispatchOutcome,
          ...(correlationId ? { correlationId } : {}),
          ...(manualRunId ? { runId: manualRunId } : {}),
        }),
        { status, headers: RESPONSE_HEADERS },
      );
    const runtime = getEnv("BILLING_RUNTIME");
    if (runtime === undefined || runtime === "supabase") {
      return await supabaseHandler(req);
    }
    if (runtime !== "railway") return fail("billing_runtime_invalid", 503);

    // The fixed production destination must never receive staging cron credentials.
    if (getEnv("SUPABASE_URL") !== PRODUCTION_SUPABASE_URL) {
      return fail("billing_runtime_project_mismatch", 503);
    }
    // Explicit empty fallback avoids requireCronRequest reading a different/global env.
    const cronSecret = getEnv("CRON_SHARED_SECRET") ?? "";
    const authError = requireCronRequest(req, RESPONSE_HEADERS, cronSecret);
    if (authError) {
      const code = authError.status === 401
        ? "billing_runtime_unauthorized"
        : authError.status === 405
        ? "billing_runtime_method_not_allowed"
        : "billing_runtime_cron_not_configured";
      return fail(code, authError.status);
    }
    correlationId ||= crypto.randomUUID();

    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, req.signal]);
    const limit = Number.isFinite(timeoutMs)
      ? Math.max(1, Math.min(timeoutMs, FORWARD_TIMEOUT_MS))
      : FORWARD_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), limit);
    let dispatchAttempted = false;
    try {
      let body: Uint8Array<ArrayBuffer>;
      try {
        body = await readBoundedBody(req, MAX_REQUEST_BYTES, signal);
      } catch (error) {
        if (error instanceof BodyTooLarge) {
          return fail("payload_too_large", 413);
        }
        throw error;
      }

      const headers = new Headers({
        "Content-Type": "application/json",
        "X-CareMetric-Cron-Secret": cronSecret,
        "X-Correlation-Id": correlationId,
      });
      for (const name of ["X-Correlation-Id", "X-Request-Id"]) {
        const value = req.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      signal.throwIfAborted();
      dispatchAttempted = true;
      const response = await fetcher(RAILWAY_SYNC_URL, {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal,
      });
      // Also reject redirects from injected transports; never forward a Location header.
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {});
        return fail("billing_runtime_invalid_response", 502, "unknown");
      }
      const responseBody = await readBoundedBody(
        response,
        MAX_RESPONSE_BYTES,
        signal,
      );
      const contentType = response.headers.get("content-type")?.split(";")[0]
        .trim().toLowerCase();
      if (contentType !== "application/json") {
        return fail("billing_runtime_invalid_response", 502, "unknown");
      }
      let parsed: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(
          new TextDecoder().decode(responseBody),
        );
        if (
          value === null || typeof value !== "object" || Array.isArray(value)
        ) {
          return fail("billing_runtime_invalid_response", 502, "unknown");
        }
        parsed = value as Record<string, unknown>;
      } catch {
        return fail("billing_runtime_invalid_response", 502, "unknown");
      }
      if (
        response.status === 200 &&
        (parsed.success !== true || typeof parsed.runId !== "string" ||
          !UUID.test(parsed.runId))
      ) {
        return fail("billing_runtime_invalid_response", 502, "unknown");
      }
      const status =
        [200, 400, 401, 403, 405, 413, 429, 500, 502, 503, 504].includes(
            response.status,
          )
          ? response.status
          : 502;
      return new Response(JSON.stringify(projectResult(parsed, req, status)), {
        status,
        headers: RESPONSE_HEADERS,
      });
    } catch {
      // A transport timeout does not prove the worker made no changes. Preserve its
      // correlation ID and durable result; never retry or execute the Supabase handler.
      return fail(
        signal.aborted
          ? "billing_runtime_timeout"
          : "billing_runtime_unavailable",
        502,
        dispatchAttempted ? "unknown" : "not_started",
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
