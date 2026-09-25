import type { createClient as SupabaseCreateClient } from "jsr:@supabase/supabase-js@2.48.1";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Claim = { attempt_id: string; lease_id?: string; payload?: Record<string, unknown>;
  state: string; video_id?: string; should_submit: boolean; retry_after?: number; error?: string };

export function createGenerateCourseVideoHandler({ createClient, getEnv = (name: string) => Deno.env.get(name), fetchImpl = fetch }: {
  createClient: typeof SupabaseCreateClient; getEnv?: (name: string) => string | undefined; fetchImpl?: typeof fetch;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return corsPreflightResponse(req);
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json(req, { error: "Missing Authorization header" }, 401);
    const url = getEnv("SUPABASE_URL"), anon = getEnv("SUPABASE_ANON_KEY"), service = getEnv("SUPABASE_SERVICE_ROLE_KEY"), apiKey = getEnv("HEYGEN_API_KEY");
    if (!url || !anon || !service || !apiKey) return json(req, { error: "Video generation is not configured" }, 503);
    const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json(req, { error: "Invalid or expired session" }, 401);
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
      body = parsed;
    } catch { return json(req, { error: "Invalid JSON body" }, 400); }
    const { course_block_id, request_id, avatar_id, voice_id, script, title, replace_existing, expected_video_url, expected_media_asset_id } = body;
    if (typeof course_block_id !== "string" || !UUID.test(course_block_id)
      || typeof request_id !== "string" || !UUID.test(request_id)
      || typeof avatar_id !== "string" || !avatar_id.trim() || avatar_id.length > 200
      || typeof voice_id !== "string" || !voice_id.trim() || voice_id.length > 200
      || typeof script !== "string" || !script.trim() || script.length > 50000
      || (title !== undefined && (typeof title !== "string" || title.length > 1000))
      || (replace_existing !== undefined && typeof replace_existing !== "boolean")
      || (expected_media_asset_id !== undefined && expected_media_asset_id !== null && (typeof expected_media_asset_id !== "string" || !UUID.test(expected_media_asset_id)))
      || (expected_video_url !== undefined && expected_video_url !== null && typeof expected_video_url !== "string")) {
      return json(req, { error: "A valid request ID, course block, avatar, voice, and script are required. Reload the page if it was already open." }, 400);
    }
    // The authenticated RPC authorizes platform-admin/native-or-SMS assurance before every
    // paid call. Its row lock, frozen payload, and durable aliases survive browser reloads.
    const { data, error: claimError } = await caller.rpc("claim_course_video_generation", {
      p_block_id: course_block_id, p_request_id: request_id,
      p_payload: { type: "avatar", avatar_id, voice_id, script, ...(title === undefined ? {} : { title }) },
      p_replace_existing: replace_existing === true, p_expected_video_url: expected_video_url ?? null, p_expected_media_asset_id: expected_media_asset_id ?? null,
    });
    if (claimError) {
      const status = claimError.code === "42501" ? 403 : claimError.code === "P0002" ? 404 : claimError.code === "22023" ? 400 : claimError.code === "55000" ? 409 : 503;
      return json(req, { error: status === 503 ? "The video request could not be reserved. Please try again." : claimError.message }, status);
    }
    const claim = data as Claim | null;
    if (!claim?.attempt_id || !UUID.test(claim.attempt_id)) return json(req, { error: "Invalid video reservation response" }, 503);
    if (!claim.should_submit) {
      if (claim.state === "processing" || claim.state === "completed") {
        return json(req, { success: true, attempt_id: claim.attempt_id, video_id: claim.video_id, status: claim.state, reused: true });
      }
      const error = claim.state === "reconciliation_required"
        ? "The provider response is unresolved. Contact support to reconcile this request before starting another paid render."
        : claim.state === "failed" || claim.state === "stale"
        ? claim.error || "This request has ended. Close and reopen the dialog to deliberately start a new request."
        : "This video submission is still being confirmed. Retry this request in 45 seconds; it will reuse the same paid attempt.";
      return json(req, { error, attempt_id: claim.attempt_id, status: claim.state, retry_after: claim.retry_after ?? 45 }, 409);
    }
    if (!claim.lease_id || !UUID.test(claim.lease_id) || !claim.payload) return json(req, { error: "Invalid video reservation lease" }, 503);
    const worker = createClient(url, service);
    const finish = async (outcome: "accepted" | "unknown" | "failed", videoId?: string, error?: string) => await worker.rpc("finish_course_video_submission", {
      p_attempt_id: claim.attempt_id, p_lease_id: claim.lease_id!, p_outcome: outcome,
      p_video_id: videoId ?? null, p_error: error ?? null,
    });
    let response: Response;
    let provider: { data?: { video_id?: unknown } } | null;
    try {
      response = await fetchImpl("https://api.heygen.com/v3/videos", { method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json", "Idempotency-Key": claim.attempt_id },
        body: JSON.stringify(claim.payload), signal: AbortSignal.timeout(10_000) });
      provider = await response.json().catch(() => null);
    } catch {
      await finish("unknown", undefined, "The provider response was interrupted; retry the same request.").catch(() => undefined);
      return json(req, { error: "HeyGen did not confirm the submission. Retry this request in 45 seconds; the same attempt will be reused.", attempt_id: claim.attempt_id }, 502);
    }
    const videoId = provider?.data?.video_id;
    if (!response.ok || typeof videoId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(videoId)) {
      // 409, 429, 5xx and malformed success can represent an accepted paid request. Never free
      // that attempt for a new key. Only definitive request/auth refusals are terminal here.
      const rejected = [400, 401, 403, 404, 422].includes(response.status);
      await finish(rejected ? "failed" : "unknown", undefined, rejected
        ? "HeyGen rejected this video request. Check the avatar, voice, script, and account connection."
        : "HeyGen has not confirmed the submission. Retry the same request.").catch(() => undefined);
      return json(req, { error: rejected
        ? "HeyGen rejected this video request. Check the selected avatar, voice, script, and account connection, then reopen the dialog to start a new request."
        : "HeyGen has not confirmed the submission. Retry this request in 45 seconds; it will reuse the same attempt.", attempt_id: claim.attempt_id }, 502);
    }
    const { data: saved, error: saveError } = await finish("accepted", videoId).catch(() => ({ data: null, error: { message: "save unavailable" } }));
    if (saveError || !saved) return json(req, { error: "HeyGen accepted the request, but confirmation could not be saved. Retry this request; it will reuse the same attempt.", attempt_id: claim.attempt_id }, 503);
    if (saved?.state === "stale") return json(req, { error: "Course content changed while the video was being submitted. The render was not attached; reload the course.", attempt_id: claim.attempt_id }, 409);
    return json(req, { success: true, attempt_id: claim.attempt_id, video_id: videoId, status: "processing" });
  };
}
