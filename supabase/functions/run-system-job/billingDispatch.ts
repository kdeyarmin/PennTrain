import { readBoundedBody } from "../sync-billing-quantities/forwarding.ts";

// Only these responses can prove that the controlled forwarder never invoked Railway.
// A provider error, HTTP 502, or a missing response does not establish that fact.
const NOT_STARTED_STATUS: Readonly<Record<string, number>> = {
  billing_runtime_invalid: 503,
  billing_runtime_project_mismatch: 503,
  billing_runtime_cron_not_configured: 500,
  billing_runtime_unauthorized: 401,
  billing_runtime_method_not_allowed: 405,
  payload_too_large: 413,
  billing_runtime_timeout: 502,
  billing_runtime_unavailable: 502,
};

export interface BillingDispatchDependencies {
  url: string;
  cronSecret: string;
  runId: string;
  correlationId: string;
  body: Record<string, unknown>;
  finishNotStarted: () => Promise<void>;
  signal: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

type DispatchResponse = { status: number; body: Record<string, unknown> };

/** The worker owns the queued run as soon as dispatch might have reached it. */
export async function dispatchBillingSystemJob({
  url,
  cronSecret,
  runId,
  correlationId,
  body,
  finishNotStarted,
  signal: callerSignal,
  fetcher = fetch,
  timeoutMs = 185_000,
}: BillingDispatchDependencies): Promise<DispatchResponse> {
  const unknown = (): DispatchResponse => ({
    status: 502,
    body: {
      error:
        "Job dispatch outcome is unknown; check the existing run before retrying",
      dispatchOutcome: "unknown",
      runId,
      correlationId,
    },
  });
  const controller = new AbortController();
  const signal = AbortSignal.any([callerSignal, controller.signal]);
  const limit = Number.isFinite(timeoutMs)
    ? Math.min(Math.max(1, timeoutMs), 185_000)
    : 185_000;
  const timer = setTimeout(() => controller.abort(), limit);
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CareMetric-Cron-Secret": cronSecret,
        "X-Correlation-Id": correlationId,
        "X-Request-Id": `manual:${runId}`,
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal,
    });
    const bytes = await readBoundedBody(response, 65_536, signal);
    if (
      response.headers.get("content-type")?.split(";")[0].trim()
        .toLowerCase() !== "application/json"
    ) return unknown();
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return unknown();
    }
    const result = value as Record<string, unknown>;
    if (result.runId !== runId || result.correlationId !== correlationId) {
      return unknown();
    }
    if (result.dispatchOutcome === "not_started") {
      if (
        typeof result.error !== "string" ||
        NOT_STARTED_STATUS[result.error] !== response.status
      ) return unknown();
      await finishNotStarted();
      return {
        status: 502,
        body: {
          error: "Billing worker was not started",
          dispatchOutcome: "not_started",
          runId,
          correlationId,
        },
      };
    }
    if (result.dispatchOutcome === "unknown") return unknown();
    if (response.status === 200 && result.success === true) {
      return {
        status: 200,
        body: { success: true, runId, correlationId, result },
      };
    }
    if (response.status === 502 && result.success === false) {
      // The worker has returned its own result. Do not call finish_system_job a second time.
      return {
        status: 502,
        body: {
          error: "Billing worker reported failure; check its durable run",
          runId,
          correlationId,
        },
      };
    }
    return unknown();
  } catch {
    // Includes direct dispatch timeouts, invalid/truncated JSON and response-body read failure.
    // Finalizing here would race a Railway worker that already adopted this same run.
    return unknown();
  } finally {
    clearTimeout(timer);
  }
}
