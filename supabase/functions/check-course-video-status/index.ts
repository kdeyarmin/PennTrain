import { createClient } from "jsr:@supabase/supabase-js@2";

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

const WRITER_ROLES = ["platform_admin", "org_admin", "trainer"];

interface HeygenJobState {
  video_id: string;
  status: string;
  avatar_id?: string;
  voice_id?: string;
  requested_at?: string;
  completed_at?: string;
  error?: string;
}

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

  if (job.status === "completed") {
    return json({ success: true, status: "completed" });
  }

  const statusRes = await fetch(`https://api.heygen.com/v3/videos/${job.video_id}`, {
    headers: { "x-api-key": heygenApiKey },
  });
  const statusBody = await statusRes.json().catch(() => null);
  if (!statusRes.ok || !statusBody?.data) {
    return json({ error: statusBody?.message ?? "failed to check HeyGen video status" }, 502);
  }

  const heygenStatus = statusBody.data.status as string;

  if (heygenStatus === "failed") {
    const failureMessage = statusBody.data.failure_message ?? "video generation failed";
    await callerClient
      .from("course_blocks")
      .update({ body: { heygen: { ...job, status: "failed", error: failureMessage } } })
      .eq("id", body.course_block_id);
    return json({ success: true, status: "failed", error: failureMessage });
  }

  if (heygenStatus !== "completed") {
    await callerClient
      .from("course_blocks")
      .update({ body: { heygen: { ...job, status: heygenStatus } } })
      .eq("id", body.course_block_id);
    return json({ success: true, status: heygenStatus });
  }

  const videoRes = await fetch(statusBody.data.video_url);
  if (!videoRes.ok || !videoRes.body) {
    return json({ error: "failed to download completed video from HeyGen" }, 502);
  }
  const videoBytes = new Uint8Array(await videoRes.arrayBuffer());

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const storagePath = `${block.organization_id ?? "system"}/${block.id}.mp4`;
  const { error: uploadError } = await adminClient.storage.from("course-videos").upload(storagePath, videoBytes, {
    contentType: "video/mp4",
    upsert: true,
  });
  if (uploadError) return json({ error: uploadError.message }, 500);

  const { data: publicUrlData } = adminClient.storage.from("course-videos").getPublicUrl(storagePath);

  const { error: updateError } = await callerClient
    .from("course_blocks")
    .update({
      video_url: publicUrlData.publicUrl,
      body: { heygen: { ...job, status: "completed", completed_at: new Date().toISOString() } },
    })
    .eq("id", body.course_block_id);
  if (updateError) return json({ error: updateError.message }, 500);

  return json({ success: true, status: "completed", video_url: publicUrlData.publicUrl });
});
