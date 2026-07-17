import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";
import {
  phase2IntegrationSha256,
  phase2PinnedWebhookRequest,
  phase2RetryableWebhookStatus,
  phase2RoundRobinByTenant,
  sanitizePhase2IntegrationError,
  signPhase2IntegrationWebhook,
  validatePhase2WebhookDestination,
} from "../_shared/phase2Integration.ts";

const CORS_HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-correlation-id, x-request-id",
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

interface ClaimedDelivery {
  delivery_id: string;
  organization_id: string;
  endpoint_id: string;
  destination_url: string;
  event_id: string;
  request_body: Record<string, unknown>;
  plaintext_signing_secret: string;
  attempt_number: number;
  max_attempts: number;
  timeout_ms: number;
  correlation_id: string;
  event_schema_version: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const authError = requireCronRequest(req, CORS_HEADERS);
  if (authError) return authError;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "service_not_configured" }, 503);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  let body: {
    limit?: number;
    batchSize?: number;
    endpointId?: string;
    deliveryId?: string;
    mode?: "dispatch" | "replay" | "test";
    reason?: string;
    payload?: Record<string, unknown>;
  } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const mode = body.mode ?? "dispatch";
  if (mode === "replay") {
    if (!body.deliveryId) return json({ error: "delivery_id_required" }, 400);
    const { data, error } = await admin.rpc("replay_integration_webhook_delivery", {
      p_delivery_id: body.deliveryId,
      p_reason: body.reason ?? "Operator replay through trusted dispatcher",
    });
    return error ? json({ error: "replay_failed" }, 409) : json({ replayedDeliveryId: data });
  }
  if (mode === "test") {
    if (!body.endpointId) return json({ error: "endpoint_id_required" }, 400);
    const { data, error } = await admin.rpc("enqueue_integration_test_delivery", {
      p_endpoint_id: body.endpointId,
      p_payload: body.payload ?? {},
    });
    if (error) return json({ error: "test_delivery_failed" }, 409);
    body.deliveryId = data as string;
  }

  const correlationId = (req.headers.get("x-correlation-id") || crypto.randomUUID()).slice(0, 200);
  const { data: jobRows, error: jobError } = await admin.rpc("claim_system_job_execution", {
    p_job_key: "integration-webhook-dispatch",
    p_correlation_id: correlationId,
    p_trigger_type: mode === "dispatch" ? "scheduled" : "manual",
    p_provider_request_id: req.headers.get("x-request-id")?.slice(0, 200) ?? null,
  });
  const job = Array.isArray(jobRows) ? jobRows[0] : jobRows;
  if (jobError || !job?.run_id) return json({ error: "job_tracking_failed", correlationId }, 500);
  if (!job.should_execute) return json({ success: true, replayed: true, runId: job.run_id, correlationId });

  const limit = Math.min(Math.max(Math.trunc(body.limit ?? body.batchSize ?? 50), 1), 100);
  const { data: claimRows, error: claimError } = await admin.rpc("claim_integration_webhook_deliveries", {
    p_batch_size: limit,
    p_endpoint_id: body.endpointId ?? null,
    p_delivery_id: body.deliveryId ?? null,
    p_stale_after_seconds: 300,
  });
  if (claimError) {
    await admin.rpc("finish_system_job", {
      p_run_id: job.run_id, p_status: "failed", p_attempted_count: 0,
      p_succeeded_count: 0, p_failed_count: 1, p_result: { correlationId },
      p_error_code: "claim_failed", p_error_message: "Integration delivery claim failed",
    });
    return json({ error: "claim_failed", correlationId }, 500);
  }

  const claimed = (claimRows ?? []) as ClaimedDelivery[];
  let delivered = 0;
  let retried = 0;
  let deadLettered = 0;
  let persistenceErrors = 0;
  const orderedClaims = phase2RoundRobinByTenant(claimed);
  const concurrency = 5;
  for (let offset = 0; offset < orderedClaims.length; offset += concurrency) {
    await Promise.all(orderedClaims.slice(offset, offset + concurrency).map(async (delivery) => {
    const rawBody = JSON.stringify(delivery.request_body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signPhase2IntegrationWebhook(
      delivery.plaintext_signing_secret,
      delivery.event_id,
      timestamp,
      rawBody,
    );
    const startedAt = performance.now();
    let success = false;
    let retryable = true;
    let httpStatus: number | null = null;
    let responseSha: string | null = null;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    try {
      const { data: access, error: accessError } = await admin.rpc("evaluate_feature_access", {
        p_organization_id: delivery.organization_id,
        p_feature_key: "integrations.webhooks",
        p_required_quantity: 1,
        p_as_of: new Date().toISOString(),
      });
      if (accessError) throw new Error("Webhook kill-switch evaluation failed");
      if (access?.allowed !== true) throw new TypeError(
        access?.killed === true ? "Webhook kill switch is active" : "Webhook feature access is disabled",
      );
      const destination = await validatePhase2WebhookDestination(delivery.destination_url);
      if (!destination.valid) {
        throw new TypeError(`Unsafe webhook destination: ${destination.reason ?? "rejected"}`);
      }
      const outbound = await phase2PinnedWebhookRequest(delivery.destination_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "CareMetric-CareBase-Integration-Webhooks/1.0",
          "Webhook-Id": delivery.event_id,
          "Webhook-Timestamp": String(timestamp),
          "Webhook-Signature": `v1=${signature}`,
          "X-Correlation-Id": delivery.correlation_id,
          "X-Event-Schema-Version": delivery.event_schema_version,
        },
        body: rawBody,
        timeoutMs: delivery.timeout_ms,
      }, destination.addresses);
      httpStatus = outbound.status;
      const responseText = (await outbound.text()).slice(0, 64 * 1024);
      responseSha = await phase2IntegrationSha256(responseText);
      success = outbound.ok;
      retryable = !success && phase2RetryableWebhookStatus(outbound.status);
      if (!success) {
        errorCode = `http_${outbound.status}`;
        errorMessage = `Webhook endpoint returned HTTP ${outbound.status}`;
      }
    } catch (error) {
      const unsafeDestination = error instanceof TypeError && error.message.startsWith("Unsafe webhook destination:");
      const killed = error instanceof TypeError && error.message === "Webhook kill switch is active";
      const disabled = error instanceof TypeError && error.message === "Webhook feature access is disabled";
      retryable = !unsafeDestination;
      errorCode = killed
        ? "kill_switch_active"
        : disabled
        ? "feature_access_disabled"
        : unsafeDestination
        ? "unsafe_destination"
        : error instanceof DOMException && error.name === "TimeoutError"
        ? "timeout"
        : "network_error";
      errorMessage = sanitizePhase2IntegrationError(error);
    }
    const { data: outcome, error: completionError } = await admin.rpc(
      "complete_integration_webhook_delivery",
      {
        p_delivery_id: delivery.delivery_id,
        p_attempt_number: delivery.attempt_number,
        p_success: success,
        p_http_status: httpStatus,
        p_response_sha256: responseSha,
        p_error_code: errorCode,
        p_error_message: errorMessage,
        p_retryable: retryable,
        p_duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        p_request_timestamp: timestamp,
      },
    );
    if (completionError) {
      persistenceErrors++;
      return;
    }
    if (outcome === "delivered") delivered++;
    else if (outcome === "retry") retried++;
    else deadLettered++;
    }));
  }

  const failed = retried + deadLettered + persistenceErrors;
  const terminalStatus = persistenceErrors > 0 && delivered === 0
    ? "failed"
    : failed > 0
    ? "partial"
    : "succeeded";
  const result = {
    claimed: claimed.length,
    delivered,
    retried,
    deadLettered,
    persistenceErrors,
    correlationId,
  };
  const { error: finishError } = await admin.rpc("finish_system_job", {
    p_run_id: job.run_id,
    p_status: terminalStatus,
    p_attempted_count: claimed.length,
    p_succeeded_count: delivered,
    p_failed_count: failed,
    p_result: result,
    p_error_code: failed > 0 ? "integration_delivery_failures" : null,
    p_error_message: failed > 0 ? "One or more integration deliveries require retry or review" : null,
  });
  return json({ ...result, runId: job.run_id }, finishError || persistenceErrors > 0 ? 500 : 200);
});
