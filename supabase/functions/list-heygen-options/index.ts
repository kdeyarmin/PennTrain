import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";


function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

const WRITER_ROLES = ["platform_admin"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "GET") return json(req, { error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const heygenApiKey = Deno.env.get("HEYGEN_API_KEY");
  if (!heygenApiKey) return json(req, { error: "HEYGEN_API_KEY is not configured" }, 500);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json(req, { error: "Invalid or expired session" }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("role, is_active")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || !callerProfile || !callerProfile.is_active) {
    return json(req, { error: "Caller profile not found or inactive" }, 403);
  }
  if (!WRITER_ROLES.includes(callerProfile.role as string)) {
    return json(req, { error: "not authorized to list HeyGen options" }, 403);
  }

  const [avatarsRes, voicesRes] = await Promise.all([
    fetch("https://api.heygen.com/v3/avatars/looks?limit=50", { headers: { "x-api-key": heygenApiKey } }),
    fetch("https://api.heygen.com/v3/voices?limit=50", { headers: { "x-api-key": heygenApiKey } }),
  ]);
  const [avatarsBody, voicesBody] = await Promise.all([
    avatarsRes.json().catch(() => null),
    voicesRes.json().catch(() => null),
  ]);
  if (!avatarsRes.ok) return json(req, { error: avatarsBody?.message ?? "failed to list HeyGen avatars" }, 502);
  if (!voicesRes.ok) return json(req, { error: voicesBody?.message ?? "failed to list HeyGen voices" }, 502);

  const avatars = (avatarsBody?.data ?? [])
    .map((a: Record<string, unknown>) => {
      const name = String(a.name ?? "");
      const avatarType = String(a.avatar_type ?? a.type ?? a.category ?? "");
      const groupName = String(a.group_name ?? a.avatar_group_name ?? "");
      const isAiTwin = /twin|instant|custom/i.test(`${name} ${avatarType} ${groupName}`);
      return {
        id: a.id,
        name: a.name,
        preview_image_url: a.preview_image_url,
        gender: a.gender,
        avatar_type: avatarType || null,
        group_name: groupName || null,
        is_ai_twin: isAiTwin,
      };
    })
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(b.is_ai_twin) - Number(a.is_ai_twin));
  const voices = (voicesBody?.data ?? []).map((v: Record<string, unknown>) => ({
    voice_id: v.voice_id,
    name: v.name,
    language: v.language,
    gender: v.gender,
    preview_audio_url: v.preview_audio_url,
  }));

  return json(req, { success: true, avatars, voices });
});
