// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";
import {
  classifyNotificationDispatchStatus,
  isRetryableProviderStatus,
  normalizeSmsRecipient,
  parseFromAddress,
  renderProviderMessage,
  renderVersionedNotificationTemplate,
  sanitizeProviderDetail,
  sha256Hex,
} from "../_shared/notificationDelivery.ts";

// Internal cron-only endpoint. The database claim RPC is concurrency-safe; each
// provider request now receives a durable attempt row before network I/O starts.
const CORS_HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const BATCH_SIZE = 100;
const PROCESSING_STALE_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 15_000;

interface PendingDelivery {
  id: string;
  channel: "email" | "sms";
  recipient: string;
  notification_id: string | null;
  notifications: {
    notification_type: string;
    title: string;
    body: string | null;
  } | null;
  notification_templates: {
    subject_template: string;
    body_template: string;
    allowed_variables: string[];
    version: number;
    template_key: string;
  } | null;
  organizations: { name: string } | null;
}

interface DeliveryAttempt {
  id: string;
  callback_token: string;
  attempt_number: number;
}

interface ProviderResult {
  ok: boolean;
  retryable: boolean;
  ambiguous?: boolean;
  providerId?: string;
  providerStatus?: string;
  httpStatus?: number;
  errorCode?: string;
  error?: string;
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
  attemptId: string,
): Promise<ProviderResult> {
  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) {
    return {
      ok: false,
      retryable: false,
      errorCode: "provider_not_configured",
      error: "SendGrid delivery is not configured for this deployment",
    };
  }

  const from = parseFromAddress(
    Deno.env.get("NOTIFICATION_FROM_EMAIL") ||
      "CareMetric Train <notifications@caremetrictrain.com>",
  );
  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: to }],
          // Opaque database UUID only; never put PII/PHI in SendGrid custom args.
          custom_args: { cm_attempt_id: attemptId },
        }],
        from,
        subject,
        content: [{ type: "text/plain", value: body }],
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });

    const providerId = response.headers.get("x-message-id") ?? undefined;
    if (response.ok) {
      return {
        ok: true,
        retryable: false,
        providerId,
        providerStatus: "accepted",
        httpStatus: response.status,
      };
    }

    const data = await response.json().catch(() => ({}));
    const detail =
      Array.isArray(data?.errors) && typeof data.errors[0]?.message === "string"
        ? data.errors[0].message
        : `SendGrid API returned ${response.status}`;
    return {
      ok: false,
      retryable: isRetryableProviderStatus(response.status),
      providerId,
      providerStatus: "rejected",
      httpStatus: response.status,
      errorCode: `http_${response.status}`,
      error: sanitizeProviderDetail(detail) ??
        `SendGrid API returned ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      retryable: false,
      ambiguous: true,
      providerStatus: "network_error",
      errorCode: "network_error",
      error: sanitizeProviderDetail(
        error instanceof Error ? error.message : String(error),
      ) ?? "Provider network error",
    };
  }
}

async function sendSms(
  to: string,
  body: string,
  statusCallbackUrl: string,
): Promise<ProviderResult> {
  const normalizedRecipient = normalizeSmsRecipient(to);
  if (!normalizedRecipient) {
    return {
      ok: false,
      retryable: false,
      errorCode: "invalid_recipient",
      error: "SMS recipient is not a valid E.164 phone number",
    };
  }
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
    return {
      ok: false,
      retryable: false,
      errorCode: "provider_not_configured",
      error: "Twilio delivery is not configured for this deployment",
    };
  }

  try {
    const form = new URLSearchParams({
      To: normalizedRecipient,
      Body: body.slice(0, 1500),
      StatusCallback: statusCallbackUrl,
    });
    if (messagingServiceSid) {
      form.set("MessagingServiceSid", messagingServiceSid);
    } else form.set("From", fromNumber!);

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      },
    );
    const data = await response.json().catch(() => ({}));
    const providerId = typeof data?.sid === "string" ? data.sid : undefined;
    const providerStatus = typeof data?.status === "string"
      ? data.status
      : undefined;
    if (response.ok) {
      return {
        ok: true,
        retryable: false,
        providerId,
        providerStatus: providerStatus ?? "accepted",
        httpStatus: response.status,
      };
    }

    return {
      ok: false,
      retryable: isRetryableProviderStatus(response.status),
      providerId,
      providerStatus: providerStatus ?? "rejected",
      httpStatus: response.status,
      errorCode: data?.code ? String(data.code) : `http_${response.status}`,
      error: sanitizeProviderDetail(data?.message) ??
        `Twilio API returned ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      retryable: false,
      ambiguous: true,
      providerStatus: "network_error",
      errorCode: "network_error",
      error: sanitizeProviderDetail(
        error instanceof Error ? error.message : String(error),
      ) ?? "Provider network error",
    };
  }
}

function twilioStatusCallbackUrl(
  supabaseUrl: string,
  callbackToken: string,
): string {
  const configured = Deno.env.get("TWILIO_NOTIFICATION_STATUS_CALLBACK_URL") ||
    `${supabaseUrl}/functions/v1/twilio-notification-webhook`;
  const url = new URL(configured);
  url.searchParams.set("kind", "status");
  url.searchParams.set("token", callbackToken);
  return url.toString();
}

async function finishDispatchJob(
  adminClient: any,
  runId: string,
  status: "succeeded" | "partial" | "failed" | "cancelled",
  attempted: number,
  accepted: number,
  failed: number,
  result: Record<string, unknown>,
  errorCode?: string,
  errorMessage?: string,
): Promise<boolean> {
  const { error } = await adminClient.rpc("finish_system_job", {
    p_run_id: runId,
    p_status: status,
    p_attempted_count: attempted,
    p_succeeded_count: accepted,
    p_failed_count: failed,
    p_result: result,
    p_error_code: errorCode ?? null,
    p_error_message: errorMessage ?? null,
  });
  if (error) {
    console.error("notification dispatch job finalization failed", { runId });
  }
  return !error;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  const cronAuthError = requireCronRequest(req, CORS_HEADERS);
  if (cronAuthError) return cronAuthError;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey);

  const correlationId =
    (req.headers.get("x-correlation-id") || crypto.randomUUID()).slice(0, 200);
  const providerRequestId = req.headers.get("x-request-id")?.slice(0, 200) ??
    null;
  const { data: jobClaims, error: beginJobError } = await adminClient.rpc(
    "claim_system_job_execution",
    {
      p_job_key: "notification-dispatch",
      p_correlation_id: correlationId,
      p_trigger_type: "scheduled",
      p_provider_request_id: providerRequestId,
    },
  );
  const jobClaim = Array.isArray(jobClaims) ? jobClaims[0] : jobClaims;
  if (beginJobError || !jobClaim?.run_id) {
    return json({ error: "Notification job tracking failed" }, 500);
  }
  if (!jobClaim.should_execute) {
    return json({
      success: true,
      replayed: true,
      correlationId,
      runId: jobClaim.run_id,
    });
  }
  const runId = jobClaim.run_id as string;

  const { data: claimed, error: claimError } = await adminClient.rpc(
    "claim_pending_notification_deliveries",
    {
      p_batch_size: BATCH_SIZE,
      p_stale_after_seconds: Math.round(PROCESSING_STALE_MS / 1000),
    },
  );
  if (claimError) {
    await finishDispatchJob(
      adminClient,
      runId,
      "failed",
      0,
      0,
      1,
      { correlationId },
      "claim_failed",
      "Notification claim failed",
    );
    return json({ error: "Notification claim failed", correlationId }, 500);
  }
  if (!claimed?.length) {
    const result = {
      processed: 0,
      accepted: 0,
      retryScheduled: 0,
      failed: 0,
      notSent: 0,
    };
    const finished = await finishDispatchJob(
      adminClient,
      runId,
      "succeeded",
      0,
      0,
      0,
      result,
    );
    return json({ ...result, correlationId }, finished ? 200 : 500);
  }

  const { data: rows, error: fetchError } = await adminClient
    .from("notification_deliveries")
    .select(
      "id, channel, recipient, notification_id, notifications(notification_type, title, body), notification_templates(subject_template, body_template, allowed_variables, version, template_key), organizations(name)",
    )
    .in("id", claimed.map((row: { id: string }) => row.id));
  if (fetchError) {
    await finishDispatchJob(
      adminClient,
      runId,
      "failed",
      0,
      0,
      1,
      { claimed: claimed.length, correlationId },
      "fetch_failed",
      "Notification fetch failed after claim",
    );
    return json({ error: "Notification fetch failed", correlationId }, 500);
  }

  let accepted = 0;
  let retryScheduled = 0;
  let failed = 0;
  let unknown = 0;
  let notSent = 0;
  let persistenceErrors = 0;
  let attemptsStarted = 0;
  let processed = 0;
  let cancelled = false;

  for (const rawRow of rows ?? []) {
    if (processed % 10 === 0) {
      const { data: cancellationRequested, error: cancellationError } =
        await adminClient.rpc(
          "is_system_job_cancellation_requested",
          { p_run_id: runId },
        );
      if (cancellationError) {
        console.error("notification cancellation check failed", { runId });
      } else if (cancellationRequested) {
        cancelled = true;
        break;
      }
    }

    const row = rawRow as unknown as PendingDelivery;
    const safeFallback = renderProviderMessage(
      row.notifications?.notification_type ?? null,
      row.notifications?.title ?? null,
      row.notifications?.body ?? null,
    );
    let rendered = safeFallback;
    if (row.notification_templates) {
      try {
        rendered = renderVersionedNotificationTemplate(
          row.notification_templates,
          {
            title: safeFallback.subject,
            body: safeFallback.body,
            organization_name: row.organizations?.name ?? "Your organization",
            action_url: "/",
          },
        );
      } catch (_error) {
        // A malformed template must not strand a delivery. Database validation
        // prevents this for new versions; this fallback also protects workers
        // during rolling deploys or manual recovery.
        rendered = safeFallback;
      }
    }
    const provider = row.channel === "email" ? "sendgrid" : "twilio";
    const outboundBody = row.channel === "sms"
      ? `${rendered.subject}: ${rendered.body} Reply STOP to opt out.`
      : rendered.body;
    const contentSha256 = await sha256Hex(
      `${row.channel}\n${rendered.subject}\n${outboundBody}`,
    );

    const { data: attempts, error: attemptError } = await adminClient.rpc(
      "begin_notification_delivery_attempt",
      {
        p_delivery_id: row.id,
        p_provider: provider,
        p_content_sha256: contentSha256,
      },
    );
    if (attemptError) {
      console.error("notification attempt creation failed", {
        deliveryId: row.id,
      });
      persistenceErrors++;
      continue;
    }
    if (!attempts?.length) {
      // Consent/preferences/quiet hours can safely defer or skip after claim.
      notSent++;
      continue;
    }

    const attempt = attempts[0] as DeliveryAttempt;
    attemptsStarted++;
    const result = row.channel === "email"
      ? await sendEmail(
        row.recipient,
        rendered.subject,
        outboundBody,
        attempt.id,
      )
      : await sendSms(
        row.recipient,
        outboundBody,
        twilioStatusCallbackUrl(supabaseUrl, attempt.callback_token),
      );

    const completion = result.ok
      ? "accepted"
      : result.ambiguous
      ? "unknown"
      : result.retryable
      ? "retryable"
      : "failed";
    const { error: completionError } = await adminClient.rpc(
      "complete_notification_delivery_attempt",
      {
        p_attempt_id: attempt.id,
        p_result: completion,
        p_provider_message_id: result.providerId ?? null,
        p_provider_status: result.providerStatus ?? null,
        p_http_status: result.httpStatus ?? null,
        p_error_code: result.errorCode ?? null,
        p_error_detail: result.error ?? null,
      },
    );
    if (completionError) {
      console.error("notification attempt finalization failed", {
        deliveryId: row.id,
        attemptId: attempt.id,
      });
      persistenceErrors++;
      continue;
    }

    if (completion === "accepted") accepted++;
    else if (completion === "retryable") retryScheduled++;
    else {
      failed++;
      if (completion === "unknown") unknown++;
    }

    processed++;
    if (processed % 25 === 0) {
      const { error: heartbeatError } = await adminClient.rpc(
        "heartbeat_system_job",
        {
          p_run_id: runId,
          p_attempted_count: attemptsStarted,
          p_succeeded_count: accepted,
          p_failed_count: failed + retryScheduled + persistenceErrors,
          p_cursor: { processed, lastDeliveryId: row.id },
        },
      );
      if (heartbeatError) {
        console.error("notification dispatch job heartbeat failed", { runId });
      }
    }
  }

  const result = {
    processed: rows?.length ?? 0,
    attempted: attemptsStarted,
    accepted,
    // Backward-compatible counter name: this means provider-accepted, not delivered.
    sent: accepted,
    retryScheduled,
    failed,
    unknown,
    notSent,
    persistenceErrors,
  };
  const terminalStatus = classifyNotificationDispatchStatus({
    cancelled,
    attempted: attemptsStarted,
    accepted,
    failed,
    retryScheduled,
    persistenceErrors,
  });
  const jobFinished = await finishDispatchJob(
    adminClient,
    runId,
    terminalStatus,
    attemptsStarted,
    accepted,
    failed + retryScheduled + persistenceErrors,
    { ...result, correlationId, cancelled },
    persistenceErrors > 0
      ? "persistence_error"
      : unknown > 0
      ? "ambiguous_provider_result"
      : failed > 0
      ? "provider_failure"
      : retryScheduled > 0
      ? "provider_retry_scheduled"
      : undefined,
    persistenceErrors > 0
      ? "One or more notification attempt state updates failed"
      : unknown > 0
      ? "One or more provider requests had an ambiguous transport outcome and were not replayed"
      : failed > 0
      ? "One or more provider attempts failed permanently"
      : retryScheduled > 0
      ? "One or more provider attempts were rate-limited and scheduled for bounded retry"
      : undefined,
  );
  return json(
    { ...result, correlationId, cancelled },
    persistenceErrors > 0 || !jobFinished ? 500 : 200,
  );
});
