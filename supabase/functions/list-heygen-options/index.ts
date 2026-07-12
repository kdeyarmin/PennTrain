// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const heygenApiKey = Deno.env.get("HEYGEN_API_KEY");
  if (!heygenApiKey) return json({ error: "HEYGEN_API_KEY is not configured" }, 500);

  const callerClient = createClient<any>(supabaseUrl, anonKey, {
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
    return json({ error: "not authorized to list HeyGen options" }, 403);
  }

  const [avatarsRes, voicesRes] = await Promise.all([
    fetch("https://api.heygen.com/v3/avatars/looks?limit=50", { headers: { "x-api-key": heygenApiKey } }),
    fetch("https://api.heygen.com/v3/voices?limit=50", { headers: { "x-api-key": heygenApiKey } }),
  ]);
  const [avatarsBody, voicesBody] = await Promise.all([
    avatarsRes.json().catch(() => null),
    voicesRes.json().catch(() => null),
  ]);
  if (!avatarsRes.ok) return json({ error: avatarsBody?.message ?? "failed to list HeyGen avatars" }, 502);
  if (!voicesRes.ok) return json({ error: voicesBody?.message ?? "failed to list HeyGen voices" }, 502);

  const avatars = (avatarsBody?.data ?? []).map((a: Record<string, unknown>) => ({
    id: a.id,
    name: a.name,
    preview_image_url: a.preview_image_url,
    gender: a.gender,
  }));
  const voices = (voicesBody?.data ?? []).map((v: Record<string, unknown>) => ({
    voice_id: v.voice_id,
    name: v.name,
    language: v.language,
    gender: v.gender,
    preview_audio_url: v.preview_audio_url,
  }));

  return json({ success: true, avatars, voices });
});
