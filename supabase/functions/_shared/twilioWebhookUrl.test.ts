import { assertEquals } from "jsr:@std/assert@1.0.14";
import { resolveTwilioWebhookUrl } from "./twilioWebhookUrl.ts";

Deno.test("Twilio webhook URL uses the public callback host with the incoming query", () => {
  assertEquals(
    resolveTwilioWebhookUrl(
      "http://kong:8000/functions/v1/twilio-notification-webhook?kind=status&token=abc",
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
