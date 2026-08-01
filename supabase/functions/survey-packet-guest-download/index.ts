// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeadersForRequest(req) },
  });
}

/**
 * Guest download for survey evidence packet zips.
 * Credential is the grant token (no user JWT). Gateway verify_jwt=false.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST" && req.method !== "GET") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let token = "";
  if (req.method === "GET") {
    const url = new URL(req.url);
    token = url.searchParams.get("token") ?? "";
  } else {
    try {
      const body = await req.json();
      token = typeof body?.token === "string" ? body.token : "";
    } catch {
      return json(req, { error: "Invalid JSON body" }, 400);
    }
  }
  if (token.length < 32) return json(req, { error: "token is required" }, 400);

  const { data, error } = await admin.rpc("resolve_survey_packet_guest_token", { p_token: token });
  if (error) return json(req, { error: error.message }, 500);
  const resolved = (data ?? {}) as Record<string, unknown>;
  if (!resolved.allowed) {
    return json(req, { error: "Access denied", reason: resolved.reason ?? "denied" }, 403);
  }

  const bucket = String(resolved.storageBucket ?? "survey-evidence-packets");
  const path = String(resolved.storagePath ?? "");
  const { data: signed, error: signError } = await admin.storage.from(bucket).createSignedUrl(path, 300);
  if (signError || !signed?.signedUrl) {
    return json(req, { error: "Unable to issue download URL" }, 500);
  }

  return json(req, {
    success: true,
    downloadUrl: signed.signedUrl,
    expiresInSeconds: 300,
    contentSha256: resolved.contentSha256,
    byteSize: resolved.byteSize,
    guestLabel: resolved.guestLabel,
    packetExportId: resolved.packetExportId,
  });
});
