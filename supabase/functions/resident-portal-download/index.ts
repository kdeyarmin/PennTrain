// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";

const SIGNED_URL_TTL_SECONDS = 300;
const MAX_REQUEST_BYTES = 16_384;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const requestIp = (req: Request) => req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
const sha256Hex = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Service is not configured" }, 500);
  let body: { token?: string; sharedDocumentId?: string } = {};
  try {
    body = await readJsonBody(req, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.token !== "string" || body.token.length < 32 || body.token.length > 4096
      || typeof body.sharedDocumentId !== "string" || !UUID_PATTERN.test(body.sharedDocumentId)) {
    return json({ error: "token and sharedDocumentId are required" }, 400);
  }

  const adminClient = createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const fingerprint = await sha256Hex(`${requestIp(req)}|${req.headers.get("user-agent") ?? ""}`);
  const { data: decision, error: authorizeError } = await adminClient.rpc("authorize_resident_portal_document_download", {
    p_token: body.token, p_shared_document_id: body.sharedDocumentId, p_request_fingerprint_sha256: fingerprint,
  });
  if (authorizeError) {
    console.error("resident portal document authorization failed", authorizeError.message);
    return json({ authorized: false, error: "Authorization failed" }, 403);
  }
  if (!decision?.authorized || !decision.bucket || !decision.path) return json({ authorized: false, error: "Access denied" }, 403);
  const { data, error } = await adminClient.storage.from(decision.bucket).createSignedUrl(decision.path, SIGNED_URL_TTL_SECONDS, { download: decision.fileName });
  if (error || !data?.signedUrl) {
    console.error("resident portal document signing failed", error?.message);
    return json({ error: "Download link could not be created" }, 500);
  }
  return json({ authorized: true, url: data.signedUrl, fileName: decision.fileName, expiresIn: SIGNED_URL_TTL_SECONDS });
});
