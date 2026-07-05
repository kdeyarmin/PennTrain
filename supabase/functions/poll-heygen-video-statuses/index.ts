import { createClient } from "jsr:@supabase/supabase-js@2";
import { pollAndResolveHeygenVideo, type HeygenJobState } from "../_shared/heygenPolling.ts";

// Internal cron-only endpoint: invoked exclusively by the poll-heygen-video-statuses pg_cron job
// every 5 minutes via net.http_post (see
// supabase/migrations/20260705211500_schedule_heygen_video_status_polling.sql). Deliberately
// verify_jwt:false (see supabase/config.toml) -- pg_net has no way to obtain a user JWT, and this
// function takes no caller-supplied parameters that could expose one org's data to another; it
// always processes the same system-wide non-terminal HeyGen job queue regardless of who/what
// calls it, the same way dispatch-notifications does for its own pending-delivery queue. All
// actual data access goes through this function's own service-role client.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  body: { heygen?: HeygenJobState } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const heygenApiKey = Deno.env.get("HEYGEN_API_KEY");
  if (!heygenApiKey) return json({ error: "HEYGEN_API_KEY is not configured" }, 500);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // "processing" is the only non-terminal status generate-course-video/check-course-video-status
  // ever write; "completed" and "failed" are terminal. Blocks with no heygen job at all (body ->
  // 'heygen' ->> 'status' is null) are naturally excluded since null never equals 'processing'.
  const { data: pending, error: fetchError } = await adminClient
    .from("course_blocks")
    .select("id, organization_id, body")
    .eq("block_type", "video")
    .eq("body->heygen->>status", "processing")
    .limit(BATCH_SIZE);

  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!pending || pending.length === 0) {
    return json({ processed: 0, completed: 0, failed: 0, still_processing: 0 });
  }

  let completed = 0, failed = 0, stillProcessing = 0;

  for (const rawBlock of pending) {
    const block = rawBlock as unknown as PollableCourseBlock;
    const result = await pollAndResolveHeygenVideo(adminClient, adminClient, block, heygenApiKey);
    if (result.status === "completed") completed++;
    else if (result.status === "failed" || result.status === "error") failed++;
    else stillProcessing++;
  }

  return json({ processed: pending.length, completed, failed, still_processing: stillProcessing });
});
