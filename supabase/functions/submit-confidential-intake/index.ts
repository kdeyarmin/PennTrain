import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";
import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
// The shared, trusted-hop derivation. The local one this replaces took `cf-connecting-ip`
// unconditionally -- meaningful only when Cloudflare verifiably fronts the function, and otherwise
// just another header the caller sets -- and then fell back to the FIRST hop of x-forwarded-for,
// which is the half of that list the caller writes. _shared/clientIp.ts exists because that is
// exactly backwards: the LAST hop is the one the platform gateway observed and appended. This
// endpoint is public (verify_jwt=false), and the value feeds both the per-IP rate limit and the
// ESIGN attribution stored on the intake, so a forgeable value defeated the limit with a fresh
// fake per request and wrote an attacker-chosen address onto a signed legal record.
import { clientIp } from "../_shared/clientIp.ts";

const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeadersForRequest(req), "Content-Type": "application/json" },
});

const sha256 = async (value: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!url || !key || !secret) return json(req, { error: "intake_not_configured" }, 500);

  const admin = createClient(url, key, { auth: { persistSession: false } });
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req, 65_536);
  } catch (error) {
    if (error instanceof RequestBodyError) return json(req, { error: error.message === "Invalid JSON body" ? "invalid_json" : "payload_too_large" }, error.status);
    return json(req, { error: "invalid_json" }, 400);
  }
  if (!body?.turnstile_token) return json(req, { error: "verification_required" }, 400);
  const ip = clientIp(req);
  const ipHash = await sha256(`${Deno.env.get("INTAKE_RATE_LIMIT_SALT") ?? secret}:${ip}`);

  // TURNSTILE FIRST, THEN THE RESERVATION. `reserve_confidential_intake_attempt` counts EVERY
  // confidential_intake_attempts row for this hashed IP in the last hour, whatever became of it
  // -- the I22 shape, fixed there for signup and not here. Reserving before the challenge meant a
  // bot's failed attempts, and a reporter's own retries after a Turnstile timeout, spent the
  // budget of every other person on the same address. The address is a whole building: a
  // facility-wide incident with several witnesses on the staff wifi is exactly when this endpoint
  // matters and exactly when the cap fired. Verifying first means the counted attempts are
  // human-verified submissions. Turnstile is itself the anti-automation control on the path in
  // front of it, and its tokens are single-use, so nothing is left unguarded by the reorder.
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", String(body.turnstile_token));
  if (ip !== "unknown") form.set("remoteip", ip);
  // Bound the vendor round-trip -- a Turnstile brownout must fail fast, not hold the request open.
  const verified = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body: form, signal: AbortSignal.timeout(10_000),
  }).then((response) => response.json()).catch(() => null) as { success?: boolean } | null;
  if (!verified?.success) {
    return json(req, {
      error: "verification_failed",
      message: "The \u201cI am human\u201d check could not be confirmed. Refresh the page and try again.",
    }, 400);
  }

  // A confidential intake address is shared by a whole shift, so the ceiling has to fit the
  // building rather than one person: several witnesses to the same incident, each with a couple
  // of retries, must all get through within the hour. Passed as p_limit because the RPC takes the
  // cap as an argument (20260714233041:752); the SQL default of 5 is unchanged for any other
  // caller.
  const HOURLY_ATTEMPTS_PER_ADDRESS = 25;
  const { data: reservationId, error: reservationError } = await admin.rpc(
    "reserve_confidential_intake_attempt",
    { p_ip_hash: ipHash, p_facility_id: body.facility_id ?? null, p_limit: HOURLY_ATTEMPTS_PER_ADDRESS },
  );
  if (reservationError?.message.includes("confidential_intake_rate_limited")) {
    // The reporter is anonymous and has nowhere else to go; "rate_limited" alone reached the page
    // as "Edge Function returned a non-2xx status code". Say what happened and what still works.
    return json(req, {
      error: "rate_limited",
      message:
        "Too many reports have been submitted from this network in the last hour. Wait an hour and "
        + "try again, or report from a different connection. If someone is in immediate danger, "
        + "call 911 and tell a supervisor now.",
    }, 429);
  }
  if (reservationError || reservationId == null) {
    return json(req, {
      error: "intake_unavailable",
      message: "The confidential intake service is temporarily unavailable. Try again in a few minutes.",
    }, 503);
  }

  const finalize = async (success: boolean, errorCode: string | null) => {
    const { error } = await admin.rpc("finalize_confidential_intake_attempt", {
      p_attempt_id: reservationId,
      p_success: success,
      p_error_code: errorCode,
    });
    if (error) console.error("Failed to finalize intake reservation", error.message);
  };

  const resume = crypto.randomUUID() + crypto.randomUUID();
  const confirmation = crypto.randomUUID() + crypto.randomUUID();
  const { data, error } = await admin.rpc("start_confidential_incident_intake", {
    p_facility_id: body.facility_id,
    p_report_type: body.report_type,
    p_occurred_at: body.occurred_at,
    p_immediate_danger: body.immediate_danger,
    p_severity: body.severity,
    p_reporter_mode: body.reporter_mode,
    p_public_summary: body.public_summary,
    p_narrative: body.narrative,
    p_resident_id: null,
    p_encrypted_contact: {},
    p_resume_secret: resume,
    p_confirmation_token: confirmation,
  });
  await finalize(!error, error ? "submission_failed" : null);
  if (error) {
    return json(req, {
      error: "submission_failed",
      message: "The report could not be accepted. Check the facility code and try again.",
    }, 400);
  }
  return json(req, { data: { ...(data as Record<string, unknown>), resumeSecret: resume } });
});
