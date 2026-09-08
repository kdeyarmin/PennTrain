/**
 * Twilio signs the URL it was told to POST to. Dispatch builds that from
 * TWILIO_NOTIFICATION_STATUS_CALLBACK_URL (or the functions origin). The
 * runtime then presents `req.url`, which in a proxied or aliased invoke is a
 * different host, so validateRequest rejects every legitimate status callback.
 *
 * Reconstruct the signed URL from the public base plus the incoming query
 * (kind, token) so verification matches what dispatch advertised.
 */
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
