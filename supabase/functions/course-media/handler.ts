import type { createClient as CreateClient } from "jsr:@supabase/supabase-js@2.48.1";
import { corsHeadersForRequest, corsPreflightResponse, allowedCorsOrigins } from "../_shared/cors.ts";
import { MediaError, mediaExact, projectMediaAsset, projectMediaContext, projectMediaIntent, projectMediaReceipt } from "../_shared/courseMediaProtocol.ts";
import { parseMediaHttpRequest, mediaStorageRequest } from "../_shared/courseMediaHttp.ts";
import { stageCourseMedia, mediaRpcError } from "../_shared/courseMediaIngestion.ts";

const cors = { headers: "authorization, x-client-info, apikey, content-type, x-caremetric-media-request", methods: "POST, OPTIONS" };
export function createNativeCourseMediaHandler({ createClient, getEnv = (key: string) => Deno.env.get(key), fetcher = fetch }: {
  createClient: typeof CreateClient; getEnv?: (key: string) => string | undefined; fetcher?: typeof fetch;
}) {
  return async (request: Request): Promise<Response> => {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status,
      headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeadersForRequest(request, cors) } });
    try {
      if (request.method === "OPTIONS") return corsPreflightResponse(request, cors);
      const origin = request.headers.get("origin");
      if (origin && !allowedCorsOrigins(getEnv).has(origin)) throw new MediaError(403, "Origin is not allowed.");
      const authorization = request.headers.get("authorization");
      if (!authorization || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization) || authorization.length > 8192) throw new MediaError(401, "Sign in to access course media.");
      const supabaseUrl = getEnv("SUPABASE_URL"), anon = getEnv("SUPABASE_ANON_KEY"), serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !anon || !serviceKey) throw new MediaError(503, "Course media is not configured.");
      const operation = await parseMediaHttpRequest(request);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]);
      const boundedFetch: typeof fetch = (input, init) => fetcher(input, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) });
      const caller = createClient(supabaseUrl, anon, { global: { fetch: boundedFetch, headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
      const admin = createClient(supabaseUrl, serviceKey, { global: { fetch: boundedFetch }, auth: { persistSession: false, autoRefreshToken: false } });
      const user = await caller.auth.getUser(); if (user.error || !user.data.user) throw new MediaError(401, "Sign in again to access course media.");
      const rpc = async (name: string, args: Record<string, unknown>) => { const result = await caller.rpc(name, args); mediaRpcError(result.error); return result.data; };
      let data;
      if (operation.operation === "media.context") data = projectMediaContext(await rpc("get_native_course_media_context", { p_version_id: operation.versionId, p_block_id: operation.blockId }), operation);
      else if (operation.operation === "media.status") {
        const result = await rpc("get_native_course_media_status", { p_operation_id: operation.operationId }); data = result === null ? null : projectMediaIntent(result);
        if (data && data.operationId !== operation.operationId) throw new MediaError(502, "Unexpected media operation.");
      } else if (operation.operation === "media.finish") {
        data = projectMediaReceipt(await rpc("finish_native_course_media_operation", { p_operation_id: operation.operationId }));
        if (data.operationId !== operation.operationId) throw new MediaError(502, "Unexpected media receipt.");
      } else if (operation.operation === "media.upload") {
        data = await stageCourseMedia(operation, request.body, {
          prepare: input => rpc("prepare_native_course_media_operation", { p_request: input }),
          record: async proof => { const result = await admin.rpc("record_course_media_artifact", proof); mediaRpcError(result.error); },
          storage: (path, input) => mediaStorageRequest({ supabaseUrl, serviceKey }, signal, path, input, fetcher),
        }, signal);
      } else {
        if (operation.range !== null) throw new MediaError(400, "Native media links do not accept a byte range.");
        const reference = await rpc("get_native_course_media_read", { p_version_id: operation.versionId, p_block_id: operation.blockId, p_asset_id: operation.assetId });
        if (!mediaExact(reference, ["id", "contentSha256", "mimeType", "byteSize", "fileName", "storagePath"]) || reference.id !== operation.assetId
          || typeof reference.storagePath !== "string" || reference.storagePath.split("/")[2] !== operation.assetId || !reference.storagePath.endsWith("/" + reference.contentSha256) || !/^(?:global|[0-9a-f-]{36})\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(reference.storagePath)) throw new MediaError(502, "Invalid media reference.");
        const { storagePath, ...projection } = reference; const asset = projectMediaAsset(projection);
        const lifetime = asset.mimeType === "application/pdf" ? 60 : 900;
        const signed = await admin.storage.from("course-media").createSignedUrl(storagePath, lifetime);
        if (signed.error || !signed.data?.signedUrl) throw new MediaError(502, "Course media is unavailable.");
        const current = await rpc("get_native_course_media_read", { p_version_id: operation.versionId, p_block_id: operation.blockId, p_asset_id: operation.assetId });
        if (!mediaExact(current, Object.keys(reference)) || Object.keys(reference).some(key => current[key] !== reference[key])) throw new MediaError(409, "The current media attachment changed.");
        data = { assetId: asset.id, url: signed.data.signedUrl, expiresAt: new Date(Date.now() + lifetime * 1000).toISOString() };
      }
      return json({ data });
    } catch (error) {
      const status = error instanceof MediaError ? error.status : error instanceof SyntaxError ? 400 : 502;
      return json({ error: error instanceof MediaError ? error.message : "The course media request could not be completed." }, status);
    }
  };
}
