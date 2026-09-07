// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";
// 20260906120000 (BACKLOG J61) patched resolve_survey_packet_guest_token to run the guest gate
// first, and that gate keys its per-caller throttle on the FIRST x-forwarded-for hop PostgREST
// sees -- the half of that list a caller writes. Forward the trusted hop instead. See
// _shared/guestCallerKey.ts.
//
// The parenthetical that used to stand here -- that the spliced statement called the dropped
// `assert_guest_request_allowed` and so raised 42883 before reaching the gate -- was written
// against a draft. The migration that landed calls `public.guest_request_denial`, and so does the
// deployed function body; the throttle, the suspension check and the failed-attempt row in
// app_private.guest_token_failures are all live on this surface. BACKLOG J74 (P3, guest).
import { guestCallerForwardHeaders } from "../_shared/guestCallerKey.ts";

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
  // POST-only, like the sibling guest endpoints (evidence-guest-download,
  // resident-portal-download): a GET ?token= form put the long-lived grant credential into
  // browser history and any gateway/proxy log line for a PHI-bearing packet, and nothing ever
  // minted such a URL -- the guest page at /survey-packet-access carries the token instead and
  // POSTs it from tab-scoped storage.
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    global: { headers: guestCallerForwardHeaders(req) },
  });

  let token = "";
  try {
    // Capped read. This endpoint is public (verify_jwt=false) and req.json() buffers whatever
    // it is sent; every other public function here goes through readJsonBody for that reason.
    const body = await readJsonBody<{ token?: unknown }>(req);
    token = typeof body?.token === "string" ? body.token : "";
  } catch (error) {
    if (error instanceof RequestBodyError) return json(req, { error: error.message }, error.status);
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  // Anything non-empty goes to the gate. A `token.length < 32` refusal used to be answered here,
  // which quietly undid the reason the gate is called before the RPC's own length test: "a caller
  // guessing tokens is counted whatever shape the guess has". Every guess under 32 characters was
  // turned away by this line, so it reached neither the throttle counters nor
  // app_private.guest_token_failures, and Guest access health reported a scan that never happened.
  // The RPC still answers `invalid_token` for a short token, and this function still answers 403.
  // BACKLOG J74 (P3, guest).
  if (token.length === 0) return json(req, { error: "token is required" }, 400);

  const { data, error } = await admin.rpc("resolve_survey_packet_guest_token", { p_token: token });
  // The RPC's own message is logged, not returned. This caller is unauthenticated and holds only
  // a token, so a Postgres error string -- which can name functions, columns, or constraint
  // identifiers -- is more than it should learn from a failed lookup.
  if (error) {
    console.error("resolve_survey_packet_guest_token failed", error.message);
    return json(req, { error: "Unable to resolve this download link" }, 500);
  }
  const resolved = (data ?? {}) as Record<string, unknown>;
  if (!resolved.allowed) {
    console.warn("survey packet guest token denied", { reason: resolved.reason ?? "denied" });
    return json(req, { error: "Access denied" }, 403);
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
