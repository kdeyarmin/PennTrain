import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import {
  phase2BillingSha256,
  verifyPhase2StripeSignature,
} from "../_shared/phase2Billing.ts";

const MAX_BODY_BYTES = 1024 * 1024;
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }
  const webhookSecret = Deno.env.get("STRIPE_BILLING_WEBHOOK_SECRET") ?? "";
  const verification = await verifyPhase2StripeSignature(
    rawBody,
    req.headers.get("stripe-signature") ?? "",
    webhookSecret,
  );
  if (!verification.valid) {
    console.warn("Rejected Stripe billing webhook", { reason: verification.reason });
    return json({ error: "invalid_signature" }, 400);
  }
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const eventId = typeof event.id === "string" ? event.id : "";
  const eventType = typeof event.type === "string" ? event.type : "";
  const created = typeof event.created === "number" ? event.created : NaN;
  if (!eventId.startsWith("evt_") || !eventType || !Number.isSafeInteger(created)) {
    return json({ error: "invalid_event" }, 400);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "persistence_not_configured" }, 503);
  const correlationId = (req.headers.get("x-correlation-id") || eventId).slice(0, 200);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("process_stripe_billing_event", {
    p_event_id: eventId,
    p_event_type: eventType,
    p_event_created_at: new Date(created * 1000).toISOString(),
    p_payload: event,
    p_payload_sha256: await phase2BillingSha256(rawBody),
    p_correlation_id: correlationId,
  });
  if (error) {
    console.error("Stripe billing event processing failed", { eventId, correlationId });
    return json({ error: "event_processing_failed" }, 500);
  }
  const result = Array.isArray(data) ? data[0] : data;
  return json({
    received: true,
    eventId,
    duplicate: Boolean(result?.was_duplicate),
    applied: Boolean(result?.was_applied),
    stale: Boolean(result?.was_stale),
  });
});
