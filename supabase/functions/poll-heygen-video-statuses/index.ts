// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import {
  type HeygenJobState,
  pollAndResolveHeygenVideo,
} from "../_shared/heygenPolling.ts";
import { requireCronRequest, withCronCorsHeader } from "../_shared/cronAuth.ts";

// Internal cron-only endpoint: invoked exclusively by the poll-heygen-video-statuses pg_cron job
// every 5 minutes via net.http_post (see
// supabase/migrations/20260705203950_schedule_heygen_video_status_polling.sql). Deliberately
// verify_jwt:false because pg_net has no user JWT; authenticity is enforced here with
// CRON_SHARED_SECRET / x-caremetric-cron-secret.

const CORS_HEADERS = withCronCorsHeader({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-correlation-id",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const BATCH_SIZE = 50;

interface PollableCourseBlock {
  id: string;
  organization_id: string | null;
  body: (Record<string, unknown> & { heygen?: HeygenJobState }) | null;
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
  const correlationId = req.headers.get("x-correlation-id") ||
    crypto.randomUUID();
  const { data: jobClaims, error: runError } = await adminClient.rpc(
    "claim_system_job_execution",
    {
      p_job_key: "heygen-status-polling",
      p_correlation_id: correlationId,
      p_trigger_type: "scheduled",
      p_provider_request_id: req.headers.get("x-request-id"),
    },
  );
  const jobClaim = Array.isArray(jobClaims) ? jobClaims[0] : jobClaims;
  if (runError || !jobClaim?.run_id) {
    return json({ error: "Could not create the HeyGen polling job run" }, 500);
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

  const finishRun = async (
    status: "succeeded" | "partial" | "failed" | "cancelled",
    attempted: number,
    succeeded: number,
    failed: number,
    result: Record<string, unknown>,
    errorMessage: string | null = null,
  ) => {
    const { error } = await adminClient.rpc("finish_system_job", {
      p_run_id: runId,
      p_status: status,
      p_attempted_count: attempted,
      p_succeeded_count: succeeded,
      p_failed_count: failed,
      p_result: result,
      p_error_code: errorMessage ? "heygen_poll_failed" : null,
      p_error_message: errorMessage,
    });
    if (error) {
      console.error("Could not finalize HeyGen polling job", { correlationId });
    }
  };

  const heygenApiKey = Deno.env.get("HEYGEN_API_KEY");
  if (!heygenApiKey) {
    await finishRun("failed", 0, 0, 1, {}, "HEYGEN_API_KEY is not configured");
    return json(
      { error: "HEYGEN_API_KEY is not configured", correlationId },
      500,
    );
  }

  // Codex/Copilot review finding: pollAndResolveHeygenVideo persists whatever non-terminal status
  // HeyGen itself reports (status: heygenStatus for any status that isn't "completed"), not just
  // "processing" -- so filtering on exactly 'processing' would stop re-polling a block the moment
  // HeyGen reports some other in-flight status (e.g. "pending", "waiting"), leaving it stuck until
  // a human happens to load the page. Select anything with a job that hasn't reached a terminal
  // state instead. NULL status (no heygen job at all) is naturally excluded: NULL NOT IN (...) is
  // NULL, not true, so those rows never match.
  const { data: pending, error: fetchError } = await adminClient
    .from("course_blocks")
    .select("id, organization_id, body")
    .eq("block_type", "video")
    .not("body->heygen->>status", "in", "(completed,failed)")
    .limit(BATCH_SIZE);

  if (fetchError) {
    await finishRun("failed", 0, 0, 1, {}, fetchError.message);
    return json({ error: fetchError.message, correlationId }, 500);
  }
  if (!pending || pending.length === 0) {
    const result = {
      processed: 0,
      completed: 0,
      failed: 0,
      still_processing: 0,
    };
    await finishRun("succeeded", 0, 0, 0, result);
    return json({ ...result, correlationId });
  }

  let completed = 0, failed = 0, stillProcessing = 0, processed = 0;
  let cancelled = false;

  for (const rawBlock of pending) {
    const { data: shouldCancel, error: cancelError } = await adminClient.rpc(
      "is_system_job_cancellation_requested",
      { p_run_id: runId },
    );
    if (cancelError) {
      console.error("Could not check HeyGen polling cancellation", {
        correlationId,
      });
    }
    if (!cancelError && shouldCancel) {
      cancelled = true;
      break;
    }

    const block = rawBlock as unknown as PollableCourseBlock;
    try {
      const result = await pollAndResolveHeygenVideo(
        adminClient,
        adminClient,
        block,
        heygenApiKey,
        true,
      );
      if (result.status === "completed") completed++;
      else if (result.status === "failed" || result.status === "error") {
        failed++;
      } else stillProcessing++;
    } catch {
      failed++;
    }
    processed++;

    if (processed % 10 === 0) {
      const { error: heartbeatError } = await adminClient.rpc(
        "heartbeat_system_job",
        {
          p_run_id: runId,
          p_attempted_count: processed,
          p_succeeded_count: completed + stillProcessing,
          p_failed_count: failed,
          p_cursor: { processed, lastBlockId: block.id },
        },
      );
      if (heartbeatError) {
        console.error("Could not heartbeat HeyGen polling job", {
          correlationId,
        });
      }
    }
  }

  const result = {
    processed,
    completed,
    failed,
    still_processing: stillProcessing,
    cancelled,
  };
  await finishRun(
    cancelled ? "cancelled" : failed > 0 ? "partial" : "succeeded",
    processed,
    completed + stillProcessing,
    failed,
    result,
  );
  return json({ ...result, correlationId });
});
