<<<<<<< HEAD
import { createClient } from "jsr:@supabase/supabase-js@2";
=======
// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
>>>>>>> origin/main

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

<<<<<<< HEAD
const WRITER_ROLES = ["platform_admin", "org_admin", "trainer"];
=======
// Narrowed from the historical ["platform_admin", "org_admin", "trainer"]: course_blocks write
// RLS is now platform_admin-only (see the restrict_course_authoring_to_platform_admin migration).
// Leaving org_admin/trainer in this allowlist let them kick off a real, billed HeyGen job and only
// then discover (via a 403 on the DB write below) that they could never have persisted its result
// -- an orphaned external job for no benefit. Reject before calling HeyGen at all instead.
const WRITER_ROLES = ["platform_admin"];
>>>>>>> origin/main

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const heygenApiKey = Deno.env.get("HEYGEN_API_KEY");
  if (!heygenApiKey) return json({ error: "HEYGEN_API_KEY is not configured" }, 500);

<<<<<<< HEAD
  const callerClient = createClient(supabaseUrl, anonKey, {
=======
  const callerClient = createClient<any>(supabaseUrl, anonKey, {
>>>>>>> origin/main
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
    return json({ error: "not authorized to generate course videos" }, 403);
  }

<<<<<<< HEAD
=======
  const { data: aiVideoSetting } = await callerClient
    .from("platform_settings")
    .select("value")
    .eq("key", "ai_video_generation_enabled")
    .maybeSingle();
  const aiVideoGenerationEnabled = aiVideoSetting?.value !== false;
  if (!aiVideoGenerationEnabled) {
    return json({ error: "AI video generation is currently disabled by the platform administrator." }, 403);
  }

>>>>>>> origin/main
  let body: { course_block_id?: string; avatar_id?: string; voice_id?: string; script?: string; title?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { course_block_id, avatar_id, voice_id, script, title } = body;
  if (!course_block_id || !avatar_id || !voice_id || !script) {
    return json({ error: "course_block_id, avatar_id, voice_id, and script are required" }, 400);
  }

  const { data: block, error: blockError } = await callerClient
    .from("course_blocks")
<<<<<<< HEAD
    .select("id, block_type")
=======
    .select("id, block_type, body")
>>>>>>> origin/main
    .eq("id", course_block_id)
    .single();
  if (blockError || !block) return json({ error: "course block not found" }, 404);
  if (block.block_type !== "video") return json({ error: "course block is not a video block" }, 400);

  const heygenRes = await fetch("https://api.heygen.com/v3/videos", {
    method: "POST",
    headers: { "x-api-key": heygenApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "avatar",
      avatar_id,
      voice_id,
      script,
      title: title ?? undefined,
    }),
  });
  const heygenBody = await heygenRes.json().catch(() => null);
  if (!heygenRes.ok || !heygenBody?.data?.video_id) {
    return json({ error: heygenBody?.message ?? heygenBody?.error?.message ?? "HeyGen video generation request failed" }, 502);
  }

  const heygenVideoId = heygenBody.data.video_id as string;

  const { data: updated, error: updateError } = await callerClient
    .from("course_blocks")
    .update({
      video_url: null,
<<<<<<< HEAD
      body: {
=======
      // Merge with the existing body (Copilot review finding): this block's body.script -- the
      // AI-authored narration used to build the `script` variable above -- would otherwise be
      // silently erased the moment a job starts, since `body: { heygen: {...} }` alone replaces
      // the whole jsonb column rather than patching one key of it.
      body: {
        ...(block.body as Record<string, unknown> | null),
>>>>>>> origin/main
        heygen: {
          video_id: heygenVideoId,
          status: "processing",
          avatar_id,
          voice_id,
          requested_at: new Date().toISOString(),
        },
      },
    })
    .eq("id", course_block_id)
    .select("id")
    .single();
  if (updateError || !updated) {
    return json({ error: updateError?.message ?? "not authorized to update this course block (locked or read-only)" }, 403);
  }

  return json({ success: true, video_id: heygenVideoId, status: "processing" });
});
