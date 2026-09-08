import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  resolveSignedTwilioWebhookUrl,
  resolveTwilioWebhookUrl,
  twilioWebhookKind,
} from "./twilioWebhookUrl.ts";

const STATUS_ALIAS = "https://callbacks.example.com/twilio-status";
const CONSENT_ALIAS = "https://callbacks.example.com/twilio-consent";
const INTERNAL_STATUS =
  "http://kong:8000/functions/v1/twilio-notification-webhook?kind=status&token=abc";
const INTERNAL_CONSENT =
  "http://kong:8000/functions/v1/twilio-notification-webhook?kind=consent";
const INTERNAL_INBOUND =
  "http://kong:8000/functions/v1/twilio-notification-webhook";

Deno.test("Twilio webhook URL uses the public callback host with the incoming query", () => {
  assertEquals(
    resolveTwilioWebhookUrl(
      INTERNAL_STATUS,
      "https://project.supabase.co/functions/v1/twilio-notification-webhook",
    ),
    "https://project.supabase.co/functions/v1/twilio-notification-webhook?kind=status&token=abc",
  );
});

Deno.test("Twilio webhook URL falls back to the request URL when no public base is set", () => {
  const requestUrl = "https://project.supabase.co/functions/v1/twilio-notification-webhook?kind=status&token=abc";
  assertEquals(resolveTwilioWebhookUrl(requestUrl, undefined), requestUrl);
  assertEquals(resolveTwilioWebhookUrl(requestUrl, "  "), requestUrl);
});

Deno.test("Twilio webhook kind treats a missing kind with a token as status", () => {
  assertEquals(twilioWebhookKind(INTERNAL_STATUS), "status");
  assertEquals(
    twilioWebhookKind("http://kong:8000/functions/v1/twilio-notification-webhook?token=abc"),
    "status",
  );
  assertEquals(twilioWebhookKind(INTERNAL_CONSENT), "consent");
  assertEquals(twilioWebhookKind(INTERNAL_INBOUND), "consent");
});

Deno.test("status callback URL override is not applied to consent traffic", () => {
  assertEquals(
    resolveSignedTwilioWebhookUrl(INTERNAL_STATUS, STATUS_ALIAS, CONSENT_ALIAS),
    `${STATUS_ALIAS}?kind=status&token=abc`,
  );
  assertEquals(
    resolveSignedTwilioWebhookUrl(INTERNAL_CONSENT, STATUS_ALIAS, CONSENT_ALIAS),
    `${CONSENT_ALIAS}?kind=consent`,
  );
  assertEquals(
    resolveSignedTwilioWebhookUrl(INTERNAL_INBOUND, STATUS_ALIAS, undefined),
    INTERNAL_INBOUND,
  );
});
