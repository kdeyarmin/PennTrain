import { createClient } from "jsr:@supabase/supabase-js@2.48.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EDGE_JOBS: Record<
  string,
  { functionName: string; body: Record<string, unknown> }
> = {
  "notification-dispatch": { functionName: "dispatch-notifications", body: {} },
  "exclusion-screening": { functionName: "screen-exclusions", body: {} },
  "heygen-status-polling": {
    functionName: "poll-heygen-video-statuses",
    body: {},
  },
  "certificate-pdf-generation": {
    functionName: "generate-certificate-pdf",
    body: { batchSize: 50 },
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

type QueuedRun = { run_id: string; correlation_id: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SHARED_SECRET");
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json({
      error: "Service is not configured or authorization is missing",
    }, 503);
  }

  let body: { jobKey?: string; reason?: string; replayRunId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const reason = body.reason?.trim() ?? "";
  if (!body.jobKey || reason.length < 8) {
    return json({ error: "jobKey and a meaningful reason are required" }, 400);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await callerClient.auth
    .getUser();
  if (userError || !user) {
    return json({ error: "Invalid or expired session" }, 401);
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
      return json({
        error:
          "The job failed; its durable run contains the operator-safe error",
        runId: queued.run_id,
      }, 500);
    }
    if (
      data && typeof data === "object" &&
      (data as Record<string, unknown>).status === "failed"
    ) {
      return json({
        error:
          "The job failed; its durable run contains the operator-safe error",
        runId: queued.run_id,
        result: data,
      }, 500);
    }
    return json({
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
    return json({
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
      return json({
        error: "Job worker failed",
        runId: queued.run_id,
        details: responseBody,
      }, 502);
    }
    return json({
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
    return json({
      error: "Job worker could not be reached",
      runId: queued.run_id,
    }, 502);
  }
});
