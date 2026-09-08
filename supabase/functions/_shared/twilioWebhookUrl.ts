/**
 * Twilio signs the URL it was told to POST to. Dispatch builds status
 * callbacks from TWILIO_NOTIFICATION_STATUS_CALLBACK_URL (or the functions
 * origin). The runtime then presents `req.url`, which in a proxied or aliased
 * invoke is a different host, so validateRequest rejects every legitimate status
 * callback.
 *
 * Reconstruct the signed URL from the public base plus the incoming query
 * (kind, token) so verification matches what dispatch advertised. Consent /
 * inbound Messaging traffic is a different Twilio configuration: apply the
 * status-callback override only when the request is a status callback.
 */

export function twilioWebhookKind(requestUrl: string): "status" | "consent" {
  const incoming = new URL(requestUrl);
  const kind = incoming.searchParams.get("kind");
  if (kind === "status" || kind === "consent") return kind;
  return incoming.searchParams.has("token") ? "status" : "consent";
}

export function resolveTwilioWebhookUrl(
  requestUrl: string,
  configuredPublicUrl: string | undefined,
): string {
  const incoming = new URL(requestUrl);
  const base = configuredPublicUrl?.trim();
  if (!base) return incoming.toString();
  const resolved = new URL(base);
  for (const [key, value] of incoming.searchParams) {
    resolved.searchParams.set(key, value);
  }
  return resolved.toString();
}

export function resolveSignedTwilioWebhookUrl(
  requestUrl: string,
  statusCallbackUrl: string | undefined,
  consentCallbackUrl: string | undefined,
): string {
  const kind = twilioWebhookKind(requestUrl);
  return resolveTwilioWebhookUrl(
    requestUrl,
    kind === "status" ? statusCallbackUrl : consentCallbackUrl,
  );
}
