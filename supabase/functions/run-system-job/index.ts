import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

const EDGE_JOBS: Record<
  string,
  { functionName: string; body: Record<string, unknown> }
> = {
  "notification-dispatch": { functionName: "dispatch-notifications", body: {} },
  "heygen-status-polling": {
    functionName: "poll-heygen-video-statuses",
    body: {},
  },
  "certificate-pdf-generation": {
    functionName: "generate-certificate-pdf",
    body: { batchSize: 50 },
  },
  "integration-webhook-dispatch": {
    functionName: "dispatch-integration-webhooks",
    body: { batchSize: 50 },
  },
  "organization-data-export": {
    functionName: "process-organization-export-jobs",
    body: {},
  },
  "billing-quantity-sync": {
    functionName: "sync-billing-quantities",
    body: { batchSize: 50, maxRuntimeMs: 110000 },
  },
  "regulatory-digest-send": {
    functionName: "send-regulatory-digest",
    body: { recipientCap: 500 },
  },
  "durable-data-import-worker": {
    functionName: "process-data-import-jobs",
    body: { limit: 3 },
  },
  "fhir-writeback-drain": {
    functionName: "fhir-writeback",
    body: {},
  },
  // Required by 20260904090000, which corrects this definition's execution_kind from `sql_cron`
  // to `edge_cron`. Without an entry here "Run now" falls through to execute_registered_sql_job,
  // whose case list has no `data-lifecycle` arm, so it raises 22023 and its own handler records a
  // durable FAILED run. That was harmless while the kind was `sql_cron` -- finish_system_job only
  // opens a circuit for `edge_cron` and `external` -- but after the relabel three such clicks
  // reach failure_alert_threshold, open the circuit for 15 minutes, and
  // claim_system_job_execution then rejects the SCHEDULED nightly sweep. An operator trying to
  // recover the job would be the thing that stops it running.
  "data-lifecycle": {
    functionName: "run-data-lifecycle",
    body: {},
  },
  // The five that were missing (BACKLOG.md I17 residual). Each has a cron entry that posts to an
  // Edge Function, so "Run now" for them fell through to execute_registered_sql_job, whose case
  // list has no arm for any of them: it raised 22023 and its own handler recorded a durable FAILED
  // run against a job that had not been asked to do anything. For the two CRITICAL ones
  // (binder-export-generation, document-analyzer-extraction) that is the trap described above --
  // three clicks reach failure_alert_threshold, the circuit opens for fifteen minutes, and
  // claim_system_job_execution then refuses the SCHEDULED sweep. An operator trying to recover the
  // job was the thing stopping it.
  "binder-export-generation": {
    functionName: "generate-compliance-binder",
    body: {},
  },
  "document-analyzer-extraction": {
    functionName: "analyze-state-form",
    body: {},
  },
  "process-credential-renewals": {
    functionName: "process-credential-renewals",
    body: {},
  },
  "regulatory-update-polling": {
    functionName: "poll-regulatory-updates",
    body: {},
  },
};

// The registered arms of `public.execute_registered_sql_job`
// (20260905240000_nineteen_jobs_the_control_plane_could_not_reach.sql).
//
// A key that is in neither map reaches the wrapper's `else` arm, which raises
// `Job is not a registered SQL worker` (22023) -- and the wrapper's own exception handler then
// finalizes the run it was given as FAILED. So the click manufactures the very evidence that the
// job is broken. That is how "Run now" on the System job watchdog behaved on every press
// (BACKLOG.md J82); 20260906170000 fixed that definition at the source by registering it
// `retry_mode = 'none'`, which `request_system_job_rerun` refuses before any run exists. This map
// closes the general case for whatever is registered next: a key with no dispatch path is a
// control-plane registration gap, not a job failure, and it is refused before a run is queued.
//
// Kept in sync with the migration by `src/lib/systemJobDispatch.test.ts`, which re-derives the
// case list from that file.
const SQL_WRAPPER_JOBS: ReadonlySet<string> = new Set([
  "alert-escalation",
  "audit-integrity-reconciliation",
  "billing-trial-expiry",
  "carebase-report-subscriptions",
  "change-followup-escalation",
  "compliance-recalculation",
  "compliance-requirement-maintenance",
  "course-assignment-due-reminders",
  "course-continuation-reminders",
  "course-status-recalculation",
  "fhir-integration-freshness",
  "incident-notifications",
  "integration-command-inbox-drain",
  "manager-weekly-digest",
  "medication-integration-freshness",
  "monday-digest",
  "phase1-synthetic-health",
  "plan-of-correction-escalation",
  "policy-campaign-recurrence",
  "policy-campaign-targeting",
  "policy-reminders",
  "public-demo-baseline-restore",
  "resident-compliance-recalculation",
  "resident-compliance-reminders",
  "resident-service-task-generation",
  "shift-handoff-escalation",
  "support-plan-activation",
  "survey-day-session-expiry",
  "work-item-escalation",
  "work-item-registration",
]);

function hasDispatchPath(jobKey: string): boolean {
  return Boolean(EDGE_JOBS[jobKey]) || SQL_WRAPPER_JOBS.has(jobKey);
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

type QueuedRun = { run_id: string; correlation_id: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SHARED_SECRET");
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json(req, {
      error: "Service is not configured or authorization is missing",
    }, 503);
  }

  let body: { jobKey?: string; reason?: string; replayRunId?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const reason = body.reason?.trim() ?? "";
  if (!body.jobKey || reason.length < 8) {
    return json(req, { error: "jobKey and a meaningful reason are required" }, 400);
  }
  // Refuse BEFORE request_system_job_rerun, not after. Queueing first and discovering the job has
  // no dispatch path second is what wrote a durable failed run against the System job watchdog on
  // every click (BACKLOG.md J82): the wrapper's exception handler finalizes the run it was given,
  // so the evidence of "this job is broken" was manufactured by the operator trying to run it.
  if (!hasDispatchPath(body.jobKey)) {
    return json(req, {
      error:
        "This job has no manual dispatch path: it is neither an Edge worker nor a registered SQL " +
        "job. Register it in run-system-job or in execute_registered_sql_job before running it " +
        "from the console.",
      jobKey: body.jobKey,
    }, 400);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await callerClient.auth
    .getUser();
  if (userError || !user) {
    return json(req, { error: "Invalid or expired session" }, 401);
  }

  const { data: profile, error: profileError } = await callerClient
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();
  if (
    profileError || !profile?.is_active || profile.role !== "platform_admin"
  ) {
    return json(
      req,
      { error: "Only platform administrators may run system jobs" },
      403,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const queueCall = body.replayRunId
    ? callerClient.rpc("replay_system_job_dead_letter", {
      p_run_id: body.replayRunId,
      p_reason: reason,
    })
    : callerClient.rpc("request_system_job_rerun", {
      p_job_key: body.jobKey,
      p_reason: reason,
    });
  const { data: queuedData, error: queueError } = await queueCall;
  const queued = (Array.isArray(queuedData) ? queuedData[0] : queuedData) as
    | QueuedRun
    | null;
  if (queueError || !queued?.run_id || !queued.correlation_id) {
    return json(
      req,
      { error: queueError?.message ?? "Unable to queue system job" },
      409,
    );
  }

  const edgeTarget = EDGE_JOBS[body.jobKey];
  if (!edgeTarget) {
    const { data, error } = await adminClient.rpc(
      "execute_registered_sql_job",
      {
        p_job_key: body.jobKey,
        p_correlation_id: queued.correlation_id,
        p_trigger_type: body.replayRunId ? "retry" : "manual",
      },
    );
    if (error) {
      return json(req, {
        error:
          "The job failed; its durable run contains the operator-safe error",
        runId: queued.run_id,
      }, 500);
    }
    if (
      data && typeof data === "object" &&
      (data as Record<string, unknown>).status === "failed"
    ) {
      return json(req, {
        error:
          "The job failed; its durable run contains the operator-safe error",
        runId: queued.run_id,
        result: data,
      }, 500);
    }
    return json(req, {
      success: true,
      runId: queued.run_id,
      correlationId: queued.correlation_id,
      result: data,
    });
  }

  if (!cronSecret) {
    await adminClient.rpc("finish_system_job", {
      p_run_id: queued.run_id,
      p_status: "failed",
      p_attempted_count: 0,
      p_succeeded_count: 0,
      p_failed_count: 1,
      p_result: { dispatchConfigured: false },
      p_error_code: "cron_secret_missing",
      p_error_message: "Internal job authentication is not configured",
    });
    return json(req, {
      error: "Internal job authentication is not configured",
      runId: queued.run_id,
    }, 503);
  }

  try {
    const targetResponse = await fetch(
      `${supabaseUrl}/functions/v1/${edgeTarget.functionName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CareMetric-Cron-Secret": cronSecret,
          "X-Correlation-Id": queued.correlation_id,
          "X-Request-Id": `manual:${queued.run_id}`,
        },
        body: JSON.stringify(edgeTarget.body),
      },
    );
    const responseBody = await targetResponse.json().catch(() => ({}));
    if (!targetResponse.ok) {
      // The target normally finalizes its own run. This fallback only closes a
      // still-queued/running run; a conflicting terminal state is left intact.
      await adminClient.rpc("finish_system_job", {
        p_run_id: queued.run_id,
        p_status: "failed",
        p_attempted_count: 0,
        p_succeeded_count: 0,
        p_failed_count: 1,
        p_result: { targetStatus: targetResponse.status },
        p_error_code: "manual_dispatch_failed",
        p_error_message: "The target worker rejected the manual dispatch",
      });
      return json(req, {
        error: "Job worker failed",
        runId: queued.run_id,
        details: responseBody,
      }, 502);
    }
    return json(req, {
      success: true,
      runId: queued.run_id,
      correlationId: queued.correlation_id,
      result: responseBody,
    });
  } catch {
    await adminClient.rpc("finish_system_job", {
      p_run_id: queued.run_id,
      p_status: "failed",
      p_attempted_count: 0,
      p_succeeded_count: 0,
      p_failed_count: 1,
      p_result: { targetReached: false },
      p_error_code: "manual_dispatch_transport_error",
      p_error_message: "The target worker could not be reached",
    });
    return json(req, {
      error: "Job worker could not be reached",
      runId: queued.run_id,
    }, 502);
  }
});
