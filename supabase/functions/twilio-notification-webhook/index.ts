import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import twilio from "npm:twilio@6.0.2";
import {
  hmacSha256Hex,
  isUuid,
  mapTwilioStatus,
  normalizeTwilioConsentAction,
  sanitizeProviderDetail,
  sha256Hex,
} from "../_shared/notificationDelivery.ts";

const MAX_FORM_BYTES = 64 * 1024;

function text(
  body: string,
  status: number,
  contentType = "text/plain",
): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType },
  });
}

function emptyTwiml(status = 200): Response {
  return text("<Response></Response>", status, "text/xml; charset=utf-8");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return text("Method not allowed", 405);

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FORM_BYTES) {
    return text("Payload too large", 413);
  }
  if (
    !req.headers.get("content-type")?.toLowerCase().includes(
      "application/x-www-form-urlencoded",
    )
  ) {
    return text("Unsupported media type", 415);
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_FORM_BYTES) {
    return text("Payload too large", 413);
  }

  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const expectedAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!authToken || !expectedAccountSid) {
    return text("Webhook verification is not configured", 503);
  }

  const form = new URLSearchParams(rawBody);
  const params = Object.fromEntries(form.entries());
  if (
    !signature || !twilio.validateRequest(authToken, signature, req.url, params)
  ) {
    console.warn("rejected Twilio notification webhook with invalid signature");
    return text("Forbidden", 403);
  }
  if (form.get("AccountSid") !== expectedAccountSid) {
    console.warn("rejected Twilio notification webhook for unexpected account");
    return text("Forbidden", 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return text("Webhook persistence is not configured", 503);
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ??
    (url.searchParams.has("token") ? "status" : "consent");

  if (kind === "status") {
    const callbackToken = url.searchParams.get("token");
    const messageSid = form.get("MessageSid") ?? "";
    const mapping = mapTwilioStatus(form.get("MessageStatus"));
    if (!isUuid(callbackToken) || !messageSid || !mapping) {
      return text("Invalid callback", 400);
    }

    const { data: attempt, error: attemptError } = await adminClient
      .from("notification_delivery_attempts")
      .select("id, provider_message_id")
      .eq("callback_token", callbackToken)
      .eq("provider", "twilio")
      .maybeSingle();
    if (attemptError) return text("Persistence failed", 500);
    if (!attempt) return text("Unknown callback", 404);
    if (
      attempt.provider_message_id && attempt.provider_message_id !== messageSid
    ) {
      console.warn(
        "rejected Twilio callback with mismatched provider message id",
        { attemptId: attempt.id },
      );
      return text("Callback mismatch", 409);
    }

    const errorCode = sanitizeProviderDetail(form.get("ErrorCode"), 100);
    const errorDetail = sanitizeProviderDetail(form.get("ErrorMessage"));
    const providerEventId = await sha256Hex(
      `twilio\n${attempt.id}\n${messageSid}\n${mapping.eventType}\n${
        errorCode ?? ""
      }`,
    );
    const { error } = await adminClient.rpc(
      "record_notification_provider_event",
      {
        p_provider: "twilio",
        p_provider_event_id: providerEventId,
        p_attempt_id: attempt.id,
        p_provider_message_id: messageSid,
        p_event_type: mapping.eventType,
        p_outcome: mapping.outcome,
        p_error_code: errorCode,
        p_error_detail: errorDetail,
        p_occurred_at: new Date().toISOString(),
      },
    );
    if (error) {
      console.error("failed to persist signed Twilio status callback", {
        attemptId: attempt.id,
      });
      return text("Persistence failed", 500);
    }
    return new Response(null, { status: 204 });
  }

  if (kind === "consent") {
    const action = normalizeTwilioConsentAction(
      form.get("OptOutType"),
      form.get("Body"),
    );
    if (!action) return emptyTwiml();

    const providerEventId = form.get("MessageSid") ?? "";
    const recipient = form.get("From")?.trim() ?? "";
    const fingerprintSecret =
      Deno.env.get("NOTIFICATION_RECIPIENT_HASH_SECRET") ?? "";
    if (!providerEventId || !recipient) {
      return text("Invalid consent callback", 400);
    }
    if (fingerprintSecret.length < 32) {
      return text("Consent evidence is not configured", 503);
    }

    const recipientFingerprint = await hmacSha256Hex(
      fingerprintSecret,
      recipient,
    );
    const { error } = await adminClient.rpc(
      "record_notification_consent_event",
      {
        p_channel: "sms",
        p_action: action,
        p_provider: "twilio",
        p_provider_event_id: providerEventId,
        p_recipient_fingerprint: recipientFingerprint,
        p_occurred_at: new Date().toISOString(),
        p_source: form.has("OptOutType")
          ? "twilio_advanced_opt_out"
          : "twilio_inbound_keyword",
        p_attempt_id: null,
        // Used only for the protected database lookup/update; it is never stored
        // in the consent event ledger.
        p_recipient: recipient,
      },
    );
    if (error) {
      console.error("failed to persist signed Twilio consent callback", {
        providerEventId,
      });
      return text("Persistence failed", 500);
    }

    // Advanced Opt-Out already sent the configured reply. Empty TwiML avoids a
    // duplicate response while acknowledging the inbound webhook.
    return emptyTwiml();
  }

  return text("Unknown callback kind", 404);
});
