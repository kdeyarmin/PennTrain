import { readJsonBody } from "./requestBody.ts";

export type TwilioVerifyConfig = { accountSid: string; authToken: string; serviceSid: string };
export type VerifyReply = {
  sid: string;
  account_sid: string;
  service_sid: string;
  to: string;
  channel: string;
  status: string;
};

export class SmsProviderError extends Error {
  constructor(public readonly rateLimited = false) {
    super(rateLimited ? "Please wait before requesting another code." : "Text verification is temporarily unavailable. Try again later.");
  }
}

export function twilioVerifyConfig(env: (name: string) => string | undefined): TwilioVerifyConfig | null {
  const accountSid = env("TWILIO_ACCOUNT_SID") ?? "";
  const authToken = env("TWILIO_AUTH_TOKEN") ?? "";
  const serviceSid = env("TWILIO_VERIFY_SERVICE_SID") ?? "";
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid) || !authToken || !/^VA[0-9a-f]{32}$/i.test(serviceSid)) return null;
  return { accountSid, authToken, serviceSid };
}

/** Provider URLs are fixed; secrets, codes and provider response bodies are never logged. */
export async function twilioVerifyRequest(
  config: TwilioVerifyConfig,
  action: "send" | "check",
  params: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<VerifyReply> {
  let response: Response;
  try {
    response = await fetcher(
      `https://verify.twilio.com/v2/Services/${config.serviceSid}/${action === "send" ? "Verifications" : "VerificationCheck"}`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(params),
      },
    );
  } catch { throw new SmsProviderError(); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SmsProviderError(response.status === 429);
  }
  let raw: Record<string, unknown>;
  try {
    // Reuse the streaming cap for responses as well as inbound request bodies.
    raw = await readJsonBody(new Request("https://provider-response.invalid", { method: "POST", body: response.body, duplex: "half" } as RequestInit), 16_384);
  } catch { throw new SmsProviderError(); }
  for (const key of ["sid", "account_sid", "service_sid", "to", "channel", "status"]) {
    if (typeof raw[key] !== "string") throw new SmsProviderError();
  }
  if (!/^VE[0-9a-f]{32}$/i.test(raw.sid as string) || raw.account_sid !== config.accountSid
    || raw.service_sid !== config.serviceSid || raw.channel !== "sms") throw new SmsProviderError();
  return raw as VerifyReply;
}
