import { Buffer } from "node:buffer";
import { createClient } from "jsr:@supabase/supabase-js@2.48.1";
import { EventWebhook } from "npm:@sendgrid/eventwebhook@8.0.0";
import {
  hmacSha256Hex,
  isUuid,
  mapSendGridConsent,
  mapSendGridEvent,
  sanitizeProviderDetail,
  sha256Hex,
} from "../_shared/notificationDelivery.ts";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_EVENTS = 1000;
const MAX_WEBHOOK_AGE_SECONDS = 48 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

function response(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

function eventTime(
  rawTimestamp: unknown,
  webhookTimestampSeconds: number,
): string {
  const seconds = typeof rawTimestamp === "number"
    ? rawTimestamp
    : Number(rawTimestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(seconds) || seconds <= 0 ||
    seconds > nowSeconds + MAX_CLOCK_SKEW_SECONDS ||
    seconds < nowSeconds - 7 * 24 * 60 * 60
  ) {
    return new Date(webhookTimestampSeconds * 1000).toISOString();
  }
  return new Date(seconds * 1000).toISOString();
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response("Method not allowed", 405);

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return response("Payload too large", 413);
  }

  const payloadBytes = new Uint8Array(await req.arrayBuffer());
  if (payloadBytes.byteLength > MAX_BODY_BYTES) {
    return response("Payload too large", 413);
  }

  const signature = req.headers.get("x-twilio-email-event-webhook-signature") ??
    "";
  const timestamp = req.headers.get("x-twilio-email-event-webhook-timestamp") ??
    "";
  const publicKeyValue = Deno.env.get("SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY") ??
    "";
  if (!publicKeyValue) {
    return response("Webhook verification is not configured", 503);
  }

  const timestampSeconds = Number(timestamp);
  const ageSeconds = Math.floor(Date.now() / 1000) - timestampSeconds;
  if (
    !Number.isFinite(timestampSeconds) ||
    ageSeconds > MAX_WEBHOOK_AGE_SECONDS || ageSeconds < -MAX_CLOCK_SKEW_SECONDS
  ) {
    console.warn(
      "rejected SendGrid notification webhook outside replay window",
    );
    return response("Forbidden", 403);
  }

  let signatureValid = false;
  try {
    const verifier = new EventWebhook();
    const publicKey = verifier.convertPublicKeyToECDSA(publicKeyValue);
    signatureValid = verifier.verifySignature(
      publicKey,
      Buffer.from(payloadBytes),
      signature,
      timestamp,
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    console.warn(
      "rejected SendGrid notification webhook with invalid signature",
    );
    return response("Forbidden", 403);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return response("Invalid JSON", 400);
  }
  if (!Array.isArray(payload) || payload.length > MAX_EVENTS) {
    return response("Invalid event batch", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return response("Webhook persistence is not configured", 503);
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const providerEvents: Array<Record<string, unknown>> = [];
  const consentEvents: Array<{
    attemptId: string;
    action: "opt_in" | "opt_out";
    eventId: string;
    occurredAt: string;
    source: string;
    recipientFingerprint: string;
    recipient: string;
  }> = [];
  const fingerprintSecret =
    Deno.env.get("NOTIFICATION_RECIPIENT_HASH_SECRET") ?? "";

  for (const candidate of payload) {
    if (!candidate || typeof candidate !== "object") continue;
    const event = candidate as Record<string, unknown>;
    const attemptId = event.cm_attempt_id;
    if (!isUuid(attemptId)) continue;

    const providerMessageId = typeof event.sg_message_id === "string"
      ? event.sg_message_id
      : "";
    const occurredAt = eventTime(event.timestamp, timestampSeconds);
    const mapping = mapSendGridEvent(event.event);
    const consentAction = mapSendGridConsent(event.event);
    const rawEventId = typeof event.sg_event_id === "string"
      ? event.sg_event_id
      : "";
    const eventId = rawEventId && rawEventId.length <= 512
      ? rawEventId
      : await sha256Hex(
        `sendgrid\n${rawEventId}\n${attemptId}\n${providerMessageId}\n${
          String(event.event ?? "")
        }\n${occurredAt}`,
      );

    if (mapping) {
      providerEvents.push({
        provider: "sendgrid",
        provider_event_id: eventId,
        attempt_id: attemptId,
        provider_message_id: providerMessageId,
        event_type: mapping.eventType,
        outcome: mapping.outcome,
        error_code: sanitizeProviderDetail(event.status ?? event.type, 100),
        error_detail: sanitizeProviderDetail(event.reason ?? event.response),
        occurred_at: occurredAt,
      });
    }

    if (consentAction) {
      if (fingerprintSecret.length < 32) {
        return response("Consent evidence is not configured", 503);
      }
      const recipient = typeof event.email === "string"
        ? event.email.trim().toLowerCase()
        : "";
      if (!recipient) continue;
      consentEvents.push({
        attemptId,
        action: consentAction,
        eventId,
        occurredAt,
        source: `sendgrid_${
          String(event.event ?? "event").toLowerCase().replace(
            /[^a-z0-9]+/g,
            "_",
          )
        }`,
        recipientFingerprint: await hmacSha256Hex(fingerprintSecret, recipient),
        recipient,
      });
    }
  }

  if (providerEvents.length) {
    const { error } = await adminClient.rpc(
      "record_notification_provider_events",
      {
        p_events: providerEvents,
      },
    );
    if (error) {
      console.error("failed to persist signed SendGrid delivery event batch", {
        count: providerEvents.length,
      });
      return response("Persistence failed", 500);
    }
  }

  if (consentEvents.length) {
    const { error } = await adminClient.rpc(
      "record_notification_consent_events",
      {
        p_events: consentEvents.map((event) => ({
          channel: "email",
          action: event.action,
          provider: "sendgrid",
          provider_event_id: event.eventId,
          recipient_fingerprint: event.recipientFingerprint,
          occurred_at: event.occurredAt,
          source: event.source,
          attempt_id: event.attemptId,
          // Used only by the database command for normalized suppression lookup;
          // the consent evidence table stores the keyed fingerprint, not PII.
          recipient: event.recipient,
        })),
      },
    );
    if (error) {
      console.error("failed to persist signed SendGrid consent event batch", {
        count: consentEvents.length,
      });
      return response("Persistence failed", 500);
    }
  }

  // Event IDs and the database unique key make retries idempotent. Return fast
  // after the single delivery-event batch write and normally-small consent set.
  return new Response(null, { status: 204 });
});
