import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { toMfaFactors, type MfaFactor } from "./mfaFactors";

export interface MfaStatus {
  verified: boolean;
  method: "totp" | "sms" | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  hasVerifiedFactor: boolean;
  smsRequired: boolean;
  /** Own-account status is available before MFA; older servers may omit this bootstrap field. */
  accountAccessible?: boolean;
  smsFactors: Array<{ id: string; maskedPhone: string; createdAt: string }>;
}

export interface SmsChallenge {
  challengeId: string;
  maskedPhone: string;
  expiresAt: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** A missing or malformed server answer must never open a protected workspace. */
export function parseMfaStatus(raw: unknown): MfaStatus {
  if (!isObject(raw) || typeof raw.verified !== "boolean" || typeof raw.hasVerifiedFactor !== "boolean" || typeof raw.smsRequired !== "boolean"
    || (raw.accountAccessible !== undefined && typeof raw.accountAccessible !== "boolean")
    || !["totp", "sms", null].includes(raw.method as string | null)
    || !(raw.verifiedAt === null || isDate(raw.verifiedAt))
    || !(raw.expiresAt === null || isDate(raw.expiresAt))
    || !Array.isArray(raw.smsFactors)
    || (raw.verified && (raw.method === null || !raw.hasVerifiedFactor || (raw.smsRequired && raw.method !== "sms")))
    || (raw.verified && raw.method === "sms" && (!isDate(raw.verifiedAt) || !isDate(raw.expiresAt)))) {
    throw new Error("Account security returned an invalid verification status. Try again.");
  }
  const smsFactors = raw.smsFactors.map((factor) => {
    if (!isObject(factor) || typeof factor.id !== "string" || !factor.id
      || typeof factor.maskedPhone !== "string" || !isDate(factor.createdAt)) {
      throw new Error("Account security returned an invalid verification method. Try again.");
    }
    return { id: factor.id, maskedPhone: factor.maskedPhone, createdAt: factor.createdAt };
  });
  return { ...raw, smsFactors } as unknown as MfaStatus;
}

/** The server remains authoritative; the local deadline only closes access sooner between polls. */
export function mfaStatusIsVerified(status: MfaStatus, now = Date.now()): boolean {
  return status.verified && (status.expiresAt === null || Date.parse(status.expiresAt) > now);
}

export async function getMfaStatus(): Promise<MfaStatus> {
  const { data, error } = await supabase.rpc("get_my_mfa_status");
  if (error) throw error;
  return parseMfaStatus(data);
}

async function smsMfaRequest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("sms-mfa", { body });
  if (error) {
    // FunctionsHttpError keeps the structured backend error on its Response. Never display
    // provider response bodies, phone numbers, or credentials as a generic transport error.
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    let details: unknown;
    try { details = await context?.json?.(); } catch { /* retain the transport error */ }
    if (isObject(details) && typeof details.code === "string") {
      // The edge maps provider failures to application codes; never display raw upstream details.
      throw Object.assign(new Error("Text-message verification failed. Try again."), { code: details.code });
    }
    throw error;
  }
  if (!isObject(data)) throw new Error("Text-message verification returned an invalid response. Try again.");
  return data;
}

export async function loadMfaSecurityState(): Promise<{ status: MfaStatus; factors: MfaFactor[]; smsAvailable: boolean }> {
  const [status, factorResult, availability] = await Promise.all([
    getMfaStatus(),
    supabase.auth.mfa.listFactors(),
    // An unconfigured SMS provider must not make the existing authenticator path unusable.
    smsMfaRequest({ action: "status" }).catch(() => null),
  ]);
  if (factorResult.error) throw factorResult.error;
  const factors = toMfaFactors(factorResult.data.all);
  factors.push(...status.smsFactors.map((factor): MfaFactor => ({
    id: factor.id, factor_type: "sms", status: "verified", created_at: factor.createdAt,
    friendly_name: factor.maskedPhone, phone: null,
  })));
  return { status, factors, smsAvailable: availability?.smsAvailable === true };
}

export async function sendSmsMfaCode(phone?: string): Promise<SmsChallenge> {
  const data = await smsMfaRequest({ action: "send", ...(phone ? { phone } : {}) });
  if (typeof data.challengeId !== "string" || !data.challengeId
    || typeof data.maskedPhone !== "string" || !isDate(data.expiresAt)) {
    throw new Error("The code request could not be confirmed. Request a new code.");
  }
  return data as unknown as SmsChallenge;
}

export async function verifySmsMfaCode(challengeId: string, code: string): Promise<void> {
  const data = await smsMfaRequest({ action: "verify", challengeId, code });
  if (data.verified !== true) throw new Error("The code could not be verified. Request a new code.");
  // A successful delivery-provider check alone is insufficient: confirm that the exact current
  // Auth session received the server-side attestation before dismissing a gate or an idle lock.
  if (!mfaStatusIsVerified(await getMfaStatus())) {
    throw new Error("This session could not be verified. Request a new code and try again.");
  }
}

/** Check the server mutation before dismissing the lock overlay or clearing unsaved work. */
export async function finishIdleSessionUnlock(lockEventId: string | null): Promise<void> {
  if (!lockEventId) throw new Error("The session lock could not be confirmed. Sign out and sign in again.");
  const { error } = await supabase.rpc("record_idle_session_unlock", { p_lock_event_id: lockEventId });
  if (error) throw error;
}

/** A native factor enrolled directly through Auth cannot replace an established SMS factor. */
export function usableMfaFactors(factors: readonly MfaFactor[], status: MfaStatus): MfaFactor[] {
  return factors.filter((factor) => factor.status === "verified"
    && (!status.smsRequired || factor.factor_type === "sms"));
}

/** Reads attempted before the account's SMS step must be retried after verification. */
export async function invalidateMfaDependentQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    ["my_mfa_policy"], ["profile-facility"], ["organizations", "self-check"],
    ["organization_settings"], ["navigation_preferences"],
  ].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
