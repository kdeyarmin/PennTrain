import { corsHeadersForRequest, corsPreflightResponse } from "../_shared/cors.ts";
import { readJsonBody, RequestBodyError } from "../_shared/requestBody.ts";
import { SmsProviderError, twilioVerifyConfig, twilioVerifyRequest } from "../_shared/twilioVerify.ts";

type RpcResult = { data: unknown; error: { code?: string; message?: string; hint?: string } | null };
type Client = {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
};
type Dependencies = {
  createClient: (url: string, key: string, options?: Record<string, unknown>) => Client;
  getEnv?: (name: string) => string | undefined;
  fetcher?: typeof fetch;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decode only AFTER Auth has verified the entire bearer. Never accept identity from the body. */
function verifiedSession(token: string, userId: string): { sessionId: string; nativeAal2: boolean } | null {
  try {
    const payload = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const claims = JSON.parse(atob(payload + "=".repeat((4 - payload.length % 4) % 4)));
    if (claims.sub !== userId || typeof claims.session_id !== "string" || !UUID.test(claims.session_id)) return null;
    return { sessionId: claims.session_id, nativeAal2: claims.aal === "aal2" };
  } catch { return null; }
}

function record(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid service response");
  return data as Record<string, unknown>;
}
function stringField(data: Record<string, unknown>, name: string): string {
  if (typeof data[name] !== "string" || !data[name]) throw new Error("Invalid service response");
  return data[name];
}

class StateError extends Error {
  readonly code: string;
  readonly hint: string;

  constructor(code: string, hint = "") {
    super("MFA state request rejected");
    this.code = code;
    this.hint = hint;
  }
}
async function rpc(client: Client, name: string, args?: Record<string, unknown>): Promise<unknown> {
  const result = await client.rpc(name, args);
  if (result.error) throw new StateError(result.error.code ?? "", result.error.hint ?? "");
  return result.data;
}

export function createSmsMfaHandler({ createClient, getEnv = (name) => Deno.env.get(name), fetcher = fetch }: Dependencies) {
  function json(req: Request, value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), { status, headers: {
      ...corsHeadersForRequest(req, { getEnv }), "Content-Type": "application/json", "Cache-Control": "no-store",
    } });
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return corsPreflightResponse(req, { getEnv });
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    const authorization = req.headers.get("Authorization") ?? "";
    if (!/^Bearer\s+\S+$/i.test(authorization)) return json(req, { error: "Sign in to continue." }, 401);
    const url = getEnv("SUPABASE_URL");
    const anonKey = getEnv("SUPABASE_ANON_KEY");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json(req, { error: "Verification is temporarily unavailable." }, 503);
    try {
      const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
      const { data: { user }, error } = await caller.auth.getUser();
      if (error || !user) return json(req, { error: "Sign in to continue." }, 401);
      const session = verifiedSession(authorization.replace(/^Bearer\s+/i, ""), user.id);
      if (!session) return json(req, { error: "Sign in again to verify this session." }, 401);
      const body = await readJsonBody(req, 2048);
      if (Array.isArray(body) || !["status", "send", "verify"].includes(String(body.action))) {
        return json(req, { error: "Invalid verification request." }, 400);
      }
      const config = twilioVerifyConfig(getEnv);
      if (body.action === "status") {
        const status = record(await rpc(caller, "get_my_mfa_status"));
        return json(req, { ...status, smsAvailable: config !== null });
      }
      const admin = createClient(url, serviceKey);
      const identity = { p_profile_id: user.id, p_session_id: session.sessionId };
      if (!config) return json(req, { error: "Text verification is not configured. Contact your administrator.", code: "sms_unavailable" }, 503);
      if (body.action === "send") {
        if (body.phone !== undefined && (typeof body.phone !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(body.phone))) {
          return json(req, { error: "Enter a mobile number with its country code." }, 400);
        }
        const prepared = record(await rpc(admin, "prepare_sms_mfa_challenge", {
          ...identity, p_phone: body.phone ?? null, p_native_aal2: session.nativeAal2,
        }));
        const challengeId = stringField(prepared, "challengeId");
        const phone = stringField(prepared, "phone");
        const expiresAt = stringField(prepared, "expiresAt");
        const sent = await twilioVerifyRequest(config, "send", { To: phone, Channel: "sms" }, fetcher);
        if (sent.to !== phone || sent.status !== "pending") throw new SmsProviderError();
        await rpc(admin, "activate_sms_mfa_challenge", {
          ...identity, p_challenge_id: challengeId, p_verification_sid: sent.sid,
        });
        return json(req, { challengeId, maskedPhone: `••• ••• ${phone.slice(-4)}`, expiresAt });
      }
      if (typeof body.challengeId !== "string" || !UUID.test(body.challengeId)
        || typeof body.code !== "string" || !/^[0-9]{4,10}$/.test(body.code)) {
        return json(req, { error: "Enter the code from your text message." }, 400);
      }
      const pending = record(await rpc(admin, "reserve_sms_mfa_check", { ...identity, p_challenge_id: body.challengeId }));
      const sid = stringField(pending, "verificationSid");
      const phone = stringField(pending, "phone");
      const attemptId = stringField(pending, "attemptId");
      const finish = (approved: boolean) => rpc(admin, "complete_sms_mfa_check", {
        ...identity, p_challenge_id: body.challengeId, p_attempt_id: attemptId, p_approved: approved,
      });
      let checked;
      try {
        checked = await twilioVerifyRequest(config, "check", { VerificationSid: sid, Code: body.code }, fetcher);
        if (checked.sid !== sid || checked.to !== phone) throw new SmsProviderError();
      } catch (providerError) {
        // A timed-out provider request never grants assurance. Release the check lease if possible.
        try { await finish(false); } catch { /* Fails closed until the server lease expires. */ }
        throw providerError;
      }
      const completed = record(await finish(checked.status === "approved"));
      if (checked.status !== "approved" || completed.verified !== true) {
        return json(req, { error: "That code is invalid or expired. Request a new code and try again.", code: "invalid_code" }, 400);
      }
      return json(req, { verified: true });
    } catch (error) {
      if (error instanceof RequestBodyError) return json(req, { error: error.message }, error.status);
      if (error instanceof SmsProviderError) return json(req, {
        error: error.message, code: error.rateLimited ? "sms_rate_limited" : "sms_send_failed",
      }, error.rateLimited ? 429 : 503);
      if (error instanceof StateError) {
        if (["sms_send_rate_limited", "sms_check_rate_limited", "sms_provider_challenge_reused", "sms_verification_in_progress"].includes(error.hint)) {
          return json(req, { error: "Please wait before requesting another code or using a different session.", code: "sms_rate_limited" }, 429);
        }
        if (error.hint === "sms_mfa_session_unavailable") {
          return json(req, { error: "Sign in again to verify this session.", code: "fresh_password_required" }, 401);
        }
        if (error.hint === "sms_challenge_unavailable") {
          return json(req, { error: "This code is unavailable or expired. Request a new code.", code: "challenge_expired" }, 400);
        }
        const knownHints: Record<string, string> = {
          fresh_password_required: "Sign in again with your password before changing verification settings.",
          fresh_mfa_required: "Verify your current method before changing verification settings.",
          mfa_required: "Verify your current method before changing verification settings.",
          challenge_expired: "This code has expired. Request a new code.",
        };
        if (knownHints[error.hint]) return json(req, { error: knownHints[error.hint], code: error.hint }, error.code === "42501" ? 403 : 400);
        if (error.code === "42501") return json(req, { error: "Sign in again and verify your existing method before changing verification settings." }, 403);
        if (error.code === "22023") return json(req, { error: "This verification request is invalid or expired. Request a new code." }, 400);
        if (error.code === "P0001" || error.code === "23505") return json(req, { error: "Please wait before requesting another code or using a different session." }, 429);
      }
      return json(req, { error: "Verification could not be completed. Please try again later." }, 503);
    }
  };
}
