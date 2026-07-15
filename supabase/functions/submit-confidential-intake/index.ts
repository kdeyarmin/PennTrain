import { createClient } from "jsr:@supabase/supabase-js@2.48.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
});
const clientIp = (req: Request) => req.headers.get("cf-connecting-ip")
  ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
const sha256 = async (value: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!url || !key || !secret) return json({ error: "intake_not_configured" }, 500);

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const body = await req.json().catch(() => null);
  if (!body?.turnstile_token) return json({ error: "verification_required" }, 400);
  const ip = clientIp(req);
  const ipHash = await sha256(`${Deno.env.get("INTAKE_RATE_LIMIT_SALT") ?? secret}:${ip}`);
  const { data: reservationId, error: reservationError } = await admin.rpc(
    "reserve_confidential_intake_attempt",
    { p_ip_hash: ipHash, p_facility_id: body.facility_id ?? null, p_limit: 5 },
  );
  if (reservationError?.message.includes("confidential_intake_rate_limited")) {
    return json({ error: "rate_limited" }, 429);
  }
  if (reservationError || reservationId == null) return json({ error: "intake_unavailable" }, 503);

  const finalize = async (success: boolean, errorCode: string | null) => {
    const { error } = await admin.rpc("finalize_confidential_intake_attempt", {
      p_attempt_id: reservationId,
      p_success: success,
      p_error_code: errorCode,
    });
    if (error) console.error("Failed to finalize intake reservation", error.message);
  };

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", body.turnstile_token);
  if (ip !== "unknown") form.set("remoteip", ip);
  const verified = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body: form,
  }).then((response) => response.json()).catch(() => null);
  if (!verified?.success) {
    await finalize(false, "turnstile_failed");
    return json({ error: "verification_failed" }, 400);
  }

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
  if (error) return json({ error: "submission_failed" }, 400);
  return json({ data: { ...data, resumeSecret: resume } });
});
