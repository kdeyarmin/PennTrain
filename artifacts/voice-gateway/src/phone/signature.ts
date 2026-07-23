// Twilio webhook signature validation (X-Twilio-Signature): base64
// HMAC-SHA1 of the exact request URL concatenated with the POST params,
// keys sorted, keyed by the account auth token. Every phone webhook is
// rejected without a valid signature — these endpoints are unauthenticated
// otherwise and TwiML responses control live calls.

import crypto from "node:crypto";

export function validateTwilioSignature(
  authToken: string,
  signature: string | undefined,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(data)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
