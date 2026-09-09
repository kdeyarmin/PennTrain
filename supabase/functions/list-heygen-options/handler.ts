// @ts-nocheck -- HeyGen response shaping; CORS hardened
import type { createClient as SupabaseCreateClient } from "jsr:@supabase/supabase-js@2.48.1";
import { requireSmsMfaFloor } from "../_shared/smsMfaFloor.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

const WRITER_ROLES = ["platform_admin"];

async function listOptions(
  path: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  allPages = false,
) {
  const items: Record<string, unknown>[] = [];
  const seenTokens = new Set<string>();
  const url = new URL(`https://api.heygen.com/v3/${path}`);
  for (let page = 0; page < 20; page++) {
    const response = await fetchImpl(url.toString(), {
      headers: { "x-api-key": apiKey }, signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error("HeyGen options are temporarily unavailable. Check the account connection and try again.");
    if (!Array.isArray(body?.data) || body.data.some((item: unknown) => !item || typeof item !== "object" || Array.isArray(item))) {
      throw new Error("HeyGen returned an invalid options response. Please try again.");
    }
    items.push(...body.data);
    if (!allPages || body.has_more !== true) return items;
    const token = body.next_token;
    if (typeof token !== "string" || !token || seenTokens.has(token)) {
      throw new Error("HeyGen returned an invalid pagination cursor. Please try again.");
    }
    seenTokens.add(token);
    url.searchParams.set("token", token);
  }
  throw new Error("The private HeyGen library is too large to load. Please contact support.");
}

export function createListHeygenOptionsHandler({
  createClient,
  getEnv = (name: string) => Deno.env.get(name),
  fetchImpl = fetch,
}: {
  createClient: typeof SupabaseCreateClient;
  getEnv?: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
}) {
  return async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "GET") return json(req, { error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(req, { error: "Missing Authorization header" }, 401);

  const supabaseUrl = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  const heygenApiKey = getEnv("HEYGEN_API_KEY");
  if (!supabaseUrl || !anonKey) return json(req, { error: "Service is not configured" }, 503);
  if (!heygenApiKey) return json(req, { error: "HEYGEN_API_KEY is not configured" }, 500);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user: callerUser }, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerUser) return json(req, { error: "Invalid or expired session" }, 401);
  const assurance = await requireSmsMfaFloor(callerClient);
  if (!assurance.ok) return json(req, { error: assurance.error, code: assurance.code }, assurance.status);

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

  // The unfiltered first page is dominated by the public catalog and can omit every private
  // avatar/voice. Load the complete private libraries separately, plus 50 public choices. A
  // shared deadline bounds the entire pagination walk, not just each individual request.
  const signal = AbortSignal.timeout(10_000);
  let privateAvatars, publicAvatars, privateVoices, publicVoices;
  try {
    [privateAvatars, publicAvatars, privateVoices, publicVoices] = await Promise.all([
      listOptions("avatars/looks?limit=50&ownership=private", heygenApiKey, fetchImpl, signal, true),
      listOptions("avatars/looks?limit=50&ownership=public", heygenApiKey, fetchImpl, signal),
      listOptions("voices?limit=100&type=private", heygenApiKey, fetchImpl, signal, true),
      listOptions("voices?limit=50&type=public", heygenApiKey, fetchImpl, signal),
    ]);
  } catch (error) {
    const timedOut = signal.aborted || (error instanceof DOMException && error.name === "TimeoutError");
    return json(req, { error: timedOut ? "HeyGen took too long to respond. Please try again." : "Unable to load HeyGen avatars and voices. Check the account connection and try again." }, timedOut ? 504 : 502);
  }
  const unique = (items: Record<string, unknown>[], key: string) =>
    [...new Map(items.filter(item => typeof item[key] === "string" && item[key]).map(item => [item[key], item])).values()];
  const privateAvatarIds = new Set(privateAvatars.map(a => a.id));
  const avatars = unique([...publicAvatars, ...privateAvatars], "id")
    // Training and failed looks cannot render yet. Legacy looks have no status.
    .filter(a => a.status == null || a.status === "completed")
    .map((a: Record<string, unknown>) => {
      const name = String(a.name ?? "");
      const avatarType = String(a.avatar_type ?? a.type ?? a.category ?? "");
      const groupName = String(a.group_name ?? a.avatar_group_name ?? "");
      const isAiTwin = privateAvatarIds.has(a.id) && /twin|instant|custom/i.test(`${name} ${avatarType} ${groupName}`);
      return {
        id: a.id,
        name: a.name,
        preview_image_url: a.preview_image_url,
        gender: a.gender,
        avatar_type: avatarType || null,
        group_name: groupName || null,
        is_ai_twin: isAiTwin,
        is_private: privateAvatarIds.has(a.id),
        default_voice_id: typeof a.default_voice_id === "string" ? a.default_voice_id : null,
      };
    })
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(b.is_ai_twin) - Number(a.is_ai_twin) || Number(b.is_private) - Number(a.is_private));
  const voices = unique([...privateVoices, ...publicVoices], "voice_id").map((v: Record<string, unknown>) => ({
    voice_id: v.voice_id,
    name: v.name,
    language: v.language,
    gender: v.gender,
    preview_audio_url: v.preview_audio_url,
  }));

  return json(req, { success: true, avatars, voices });
  };
}
