import { createClient } from "jsr:@supabase/supabase-js@2";
import { pollAndResolveHeygenVideo, type HeygenJobState } from "../_shared/heygenPolling.ts";

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

// Narrowed alongside generate-course-video/index.ts: course_blocks write RLS is now
// platform_admin-only, so org_admin/trainer could never persist a status update here anyway.
const WRITER_ROLES = ["platform_admin"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const heygenApiKey = Deno.env.get("HEYGEN_API_KEY");
  if (!heygenApiKey) return json({ error: "HEYGEN_API_KEY is not configured" }, 500);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json({ error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json({ error: "Caller profile not found or inactive" }, 403);
  }
  if (!WRITER_ROLES.includes(callerProfile.role as string)) {
    return json({ error: "not authorized to check course video status" }, 403);
  }

  let body: { course_block_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.course_block_id) return json({ error: "course_block_id is required" }, 400);

  const { data: block, error: blockError } = await callerClient
    .from("course_blocks")
    .select("id, organization_id, body")
    .eq("id", body.course_block_id)
    .single();
  if (blockError || !block) return json({ error: "course block not found" }, 404);

  const job = (block.body as { heygen?: HeygenJobState } | null)?.heygen;
  if (!job?.video_id) return json({ error: "no pending video generation for this block" }, 400);

  // Only the storage upload step needs service-role privileges (writing into the course-videos
  // bucket); all course_blocks writes still go through the caller's own RLS-scoped client, same
  // as before this was extracted into the shared module.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const result = await pollAndResolveHeygenVideo(callerClient, adminClient, block, heygenApiKey);

  if (result.status === "error") {
    return json({ error: result.error ?? "failed to check HeyGen video status" }, 502);
  }
  if (result.status === "no_job") {
    return json({ error: result.error ?? "no pending video generation for this block" }, 400);
  }
  if (result.status === "completed") {
    return result.video_url
      ? json({ success: true, status: "completed", video_url: result.video_url })
      : json({ success: true, status: "completed" });
  }
  if (result.status === "failed") {
    return json({ success: true, status: "failed", error: result.error });
  }
  return json({ success: true, status: result.status });
});
