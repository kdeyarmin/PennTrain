import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";
import { parseFromAddress } from "../_shared/notificationDelivery.ts";
import { buildRegulatoryDigestEmail, buildUnsubscribeUrl } from "../_shared/marketingEmails.ts";
import {
  advanceDigestRunState,
  buildDigestSendGridRequest,
  defaultDigestWatermark,
  DIGEST_MAX_UPDATES_PER_EMAIL,
  DIGEST_RECIPIENT_CAP,
  type DigestRecipientRow,
  digestUpdatesFromRows,
  parseDigestRunState,
  planDigestWindow,
  planRecipientBatch,
  type RegulatoryUpdateRow,
} from "../_shared/regulatoryDigestSend.ts";

// Weekly regulatory-update digest sender (PT-064, remaining slice). Internal cron-only
// endpoint: pg_cron fires it Monday 14:00 UTC (see the send-regulatory-digest-weekly
// job) and it rejects anything without the shared X-CareMetric-Cron-Secret -- the same
// fail-closed boundary as dispatch-notifications. Requires verify_jwt=false in
// supabase/config.toml because pg_net sends no user JWT.
//
// Each run:
//   1. Claims the 'regulatory-digest-send' system job (durable, replay-safe tracking).
//   2. Loads the durable watermark -- the digestState recorded in the last successful
//      run's result, via the get_regulatory_digest_state() RPC -- and plans the send
//      window against the newest published regulatory_updates row (all pure logic in
//      _shared/regulatoryDigestSend.ts).
//   3. No update published since the watermark -> records the run and exits quietly.
//   4. Otherwise renders one digest for the window and sends it via the SendGrid JSON
//      API to subscribed newsletter recipients, each with their own token unsubscribe
//      link plus RFC 8058 List-Unsubscribe headers, bounded to a per-run recipient cap;
//      remaining recipients resume from a durable cursor on the next run.

const CORS_HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-correlation-id, x-request-id",
});

const JOB_KEY = "regulatory-digest-send";
const DEFAULT_SITE_URL = "https://cmcarebase.com";
const SEND_CONCURRENCY = 10;
const PROVIDER_TIMEOUT_MS = 15_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Same loose client typing as dispatch-notifications' finishDispatchJob: the RPC call
// shape is what matters, not the generated database generics.
async function finishJob(
  // deno-lint-ignore no-explicit-any
  admin: any,
  runId: string,
  status: "succeeded" | "partial" | "failed",
  attempted: number,
  succeeded: number,
  failed: number,
  result: Record<string, unknown>,
  errorCode?: string,
  errorMessage?: string,
): Promise<boolean> {
  const { error } = await admin.rpc("finish_system_job", {
    p_run_id: runId,
    p_status: status,
    p_attempted_count: attempted,
    p_succeeded_count: succeeded,
    p_failed_count: failed,
    p_result: result,
    p_error_code: errorCode ?? null,
    p_error_message: errorMessage ?? null,
  });
  if (error) console.error("regulatory digest job finalization failed", { runId });
  return !error;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const authError = requireCronRequest(req, CORS_HEADERS);
  if (authError) return authError;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase service credentials are missing" }, 500);
  }

  // Tolerate an empty body (manual operator kicks); the cron job posts JSON knobs.
  let body: { recipientCap?: number; maxRuntimeMs?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsedCap = Number(body.recipientCap ?? DIGEST_RECIPIENT_CAP);
  const recipientCap = Number.isFinite(parsedCap)
    ? Math.min(Math.max(Math.trunc(parsedCap), 1), DIGEST_RECIPIENT_CAP)
    : DIGEST_RECIPIENT_CAP;
  const parsedMaxRuntimeMs = Number(body.maxRuntimeMs ?? 110_000);
  const maxRuntimeMs = Number.isFinite(parsedMaxRuntimeMs)
    ? Math.min(Math.max(Math.trunc(parsedMaxRuntimeMs), 1_000), 140_000)
    : 110_000;
  const deadlineAt = Date.now() + maxRuntimeMs;

  const correlationId = (req.headers.get("x-correlation-id") || crypto.randomUUID()).slice(0, 200);
  const requestId = (req.headers.get("x-request-id") || crypto.randomUUID()).slice(0, 200);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: jobRows, error: jobError } = await admin.rpc("claim_system_job_execution", {
    p_job_key: JOB_KEY,
    p_correlation_id: correlationId,
    p_trigger_type: requestId.startsWith("manual:") ? "manual" : "scheduled",
    p_provider_request_id: requestId,
  });
  const job = Array.isArray(jobRows) ? jobRows[0] : jobRows;
  if (jobError || !job?.run_id) return json({ error: "job_tracking_failed", correlationId }, 500);
  if (!job.should_execute) {
    return json({ success: true, replayed: true, runId: job.run_id, correlationId });
  }
  const runId = job.run_id as string;

  // Durable watermark: what the last successful run recorded. Failing to read it must
  // fail the run -- guessing a watermark could re-mail or skip a window.
  const { data: rawState, error: stateError } = await admin.rpc("get_regulatory_digest_state");
  if (stateError) {
    await finishJob(admin, runId, "failed", 0, 0, 1, { correlationId }, "state_read_failed",
      "The stored digest watermark could not be read");
    return json({ error: "state_read_failed", correlationId }, 500);
  }
  const state = parseDigestRunState(rawState, defaultDigestWatermark(new Date()));

  const { data: latestRows, error: latestError } = await admin
    .from("regulatory_updates")
    .select("published_at")
    .eq("status", "published")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1);
  if (latestError) {
    await finishJob(admin, runId, "failed", 0, 0, 1, { correlationId }, "feed_read_failed",
      "The regulatory updates feed could not be read");
    return json({ error: "feed_read_failed", correlationId }, 500);
  }
  const latestPublishedAt = (latestRows?.[0]?.published_at as string | undefined) ?? null;

  const plan = planDigestWindow(state, latestPublishedAt);
  if (plan.kind === "idle") {
    // Nothing published since the last completed window: record the run, exit quietly.
    const result = { correlationId, updates: 0, recipients: 0, sent: 0, failed: 0, digestState: state };
    const finished = await finishJob(admin, runId, "succeeded", 0, 0, 0, result);
    return json({ success: true, idle: true, runId, correlationId }, finished ? 200 : 500);
  }

  const siteUrl = (Deno.env.get("SITE_URL") || DEFAULT_SITE_URL).replace(/\/$/, "");
  const { data: updateRows, error: updatesError } = await admin
    .from("regulatory_updates")
    .select("title,summary,citation,category,source_uri")
    .eq("status", "published")
    .gt("published_at", plan.windowStart)
    .lte("published_at", plan.windowEnd)
    .order("published_at", { ascending: false })
    .limit(DIGEST_MAX_UPDATES_PER_EMAIL);
  if (updatesError) {
    await finishJob(admin, runId, "failed", 0, 0, 1, { correlationId }, "updates_read_failed",
      "The digest window's regulatory updates could not be read");
    return json({ error: "updates_read_failed", correlationId }, 500);
  }
  const digestUpdates = digestUpdatesFromRows((updateRows ?? []) as RegulatoryUpdateRow[], siteUrl);
  if (digestUpdates.length === 0) {
    // The window's updates were unpublished/archived after it opened. Close the window
    // so the job cannot spin on it forever.
    const closedState = { watermark: plan.windowEnd, resume: null };
    const result = { correlationId, updates: 0, recipients: 0, sent: 0, failed: 0, digestState: closedState };
    const finished = await finishJob(admin, runId, "succeeded", 0, 0, 0, result);
    return json({ success: true, idle: true, runId, correlationId }, finished ? 200 : 500);
  }

  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) {
    // Fail loudly WITHOUT advancing the watermark: the whole window sends once the
    // secret is configured, instead of being silently swallowed.
    await finishJob(admin, runId, "failed", 0, 0, 1, { correlationId }, "provider_not_configured",
      "SendGrid delivery is not configured for this deployment");
    return json({ error: "provider_not_configured", correlationId }, 503);
  }

  // Stable id-ordered recipient pages; cap + 1 rows so the batch planner can tell
  // whether more recipients remain without a count query.
  let recipientQuery = admin
    .from("newsletter_subscribers")
    .select("id,email,unsubscribe_token")
    .eq("status", "subscribed")
    .contains("topics", ["regulatory_updates"])
    .order("id", { ascending: true })
    .limit(recipientCap + 1);
  if (plan.cursor) recipientQuery = recipientQuery.gt("id", plan.cursor);
  const { data: recipientRows, error: recipientError } = await recipientQuery;
  if (recipientError) {
    await finishJob(admin, runId, "failed", 0, 0, 1, { correlationId }, "recipient_read_failed",
      "Newsletter subscribers could not be read");
    return json({ error: "recipient_read_failed", correlationId }, 500);
  }
  const batchPlan = planRecipientBatch((recipientRows ?? []) as DigestRecipientRow[], recipientCap);

  const from = parseFromAddress(
    Deno.env.get("NOTIFICATION_FROM_EMAIL") || "CareMetric CareBase <notifications@cmcarebase.com>",
  );

  let processed = 0;
  let sent = 0;
  let failed = 0;
  for (let offset = 0; offset < batchPlan.batch.length; offset += SEND_CONCURRENCY) {
    if (Date.now() >= deadlineAt) break;
    const chunk = batchPlan.batch.slice(offset, offset + SEND_CONCURRENCY);
    await Promise.all(chunk.map(async (recipient) => {
      // The per-subscriber token is the one-click unsubscribe credential; the mailto is
      // a defensive fallback only (the column is NOT NULL in the schema).
      const unsubscribeUrl = recipient.unsubscribe_token
        ? buildUnsubscribeUrl(supabaseUrl, recipient.unsubscribe_token)
        : `mailto:hello@caremetric.ai?subject=${encodeURIComponent(`Unsubscribe: ${recipient.email}`)}`;
      const message = buildRegulatoryDigestEmail({ updates: digestUpdates, siteUrl, unsubscribeUrl });
      try {
        const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(buildDigestSendGridRequest({ toEmail: recipient.email, from, message, unsubscribeUrl })),
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        });
        if (response.ok) {
          sent++;
        } else {
          // Status code only -- the provider error body can echo recipient details.
          failed++;
          console.warn("regulatory digest send rejected", response.status);
        }
      } catch (error) {
        failed++;
        console.warn("regulatory digest send error", error instanceof Error ? error.name : "network_error");
      }
    }));
    processed += chunk.length;
    if (processed % 50 === 0) {
      const { error: heartbeatError } = await admin.rpc("heartbeat_system_job", {
        p_run_id: runId,
        p_attempted_count: processed,
        p_succeeded_count: sent,
        p_failed_count: failed,
        p_cursor: { processed, lastSubscriberId: chunk[chunk.length - 1]?.id ?? null },
      });
      if (heartbeatError) console.error("regulatory digest job heartbeat failed", { runId });
    }
  }

  // Recipients left unprocessed at the runtime deadline resume next run, exactly like
  // recipients beyond the cap.
  const truncated = processed < batchPlan.batch.length;
  const outcome = {
    attempted: processed,
    sent,
    failed,
    hasMore: batchPlan.hasMore || truncated,
    nextCursor: truncated
      ? (processed > 0 ? batchPlan.batch[processed - 1].id : plan.cursor)
      : batchPlan.nextCursor,
  };
  const advanced = advanceDigestRunState(state, { windowEnd: plan.windowEnd }, outcome);

  const result = {
    correlationId,
    windowStart: plan.windowStart,
    windowEnd: plan.windowEnd,
    updates: digestUpdates.length,
    recipients: batchPlan.batch.length,
    attempted: processed,
    sent,
    failed,
    hasMore: outcome.hasMore,
    digestState: advanced.state,
  };
  const finished = await finishJob(
    admin,
    runId,
    advanced.status,
    processed,
    sent,
    failed,
    result,
    advanced.status === "succeeded" ? undefined : advanced.status === "failed" ? "digest_send_failed" : "digest_send_incomplete",
    advanced.status === "succeeded"
      ? undefined
      : advanced.status === "failed"
      ? "Every digest send in this run failed; the window will be retried"
      : "One or more digest sends failed or remain for the next run",
  );
  return json(
    { success: advanced.status !== "failed", runId, ...result },
    advanced.status === "failed" || !finished ? 502 : 200,
  );
});
