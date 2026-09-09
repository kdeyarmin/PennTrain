/**
 * Native authenticator factors and CareBase SMS verification methods.
 * SMS is verified by the app through Twilio and a server-side, session-bound
 * attestation. It does not change Supabase's native AAL claim.
 */

export type MfaFactorType = "totp" | "phone" | "sms";

export type MfaFactor = {
  id: string;
  factor_type: MfaFactorType;
  friendly_name?: string | null;
  status: "verified" | "unverified";
  created_at: string;
  phone?: string | null;
};

/**
 * Narrow Supabase's factor list to the two types this app knows how to drive.
 *
 * `listFactors()` types a factor as `totp | phone | webauthn` and omits the
 * `phone` number the API actually returns for phone factors, so the raw list is
 * parsed rather than cast -- an unknown factor type is dropped instead of
 * rendering a row with no working verify path.
 */
export function toMfaFactors(raw: readonly unknown[] | null | undefined): MfaFactor[] {
  if (!raw) return [];
  const factors: MfaFactor[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    const factorType = candidate.factor_type;
    if (factorType !== "totp" && factorType !== "phone") continue;
    if (typeof candidate.id !== "string") continue;
    if (typeof candidate.created_at !== "string") continue;
    factors.push({
      id: candidate.id,
      factor_type: factorType,
      friendly_name: typeof candidate.friendly_name === "string" ? candidate.friendly_name : null,
      status: candidate.status === "verified" ? "verified" : "unverified",
      created_at: candidate.created_at,
      phone: typeof candidate.phone === "string" ? candidate.phone : null,
    });
  }
  return factors;
}

/**
 * Normalize an operator-typed phone number to the E.164 form Supabase Auth and
 * Twilio both require. Follows the same rules as `normalizeSmsRecipient` in the
 * notification delivery edge function, with one tightening: a number the user
 * wrote with a leading `+` is only ever read as international, never given a
 * `+1` country code it did not ask for.
 */
export function normalizeMfaPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) {
    if (digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0")) {
      return `+${digits}`;
    }
    return null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * Show enough of an enrolled number to recognize it, never enough to retarget
 * it. Factor lists are visible wherever a session is open, including shared
 * floor devices.
 */
export function maskMfaPhone(phone: string | null | undefined): string {
  if (!phone) return "Text message";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "Text message";
  return `••• ••• ${digits.slice(-4)}`;
}

export function mfaFactorLabel(factor: MfaFactor): string {
  if (factor.friendly_name) return factor.friendly_name;
  return factor.factor_type === "phone" || factor.factor_type === "sms" ? maskMfaPhone(factor.phone) : "Authenticator app";
}

/**
 * Turn a Supabase Auth MFA failure into something an administrator can act on.
 * The raw messages ("MFA enroll is disabled for phone") read as bugs rather
 * than as configuration the operator controls.
 */
export function describeMfaError(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error ? error.message : String(error);

  switch (code) {
    case "mfa_phone_enroll_not_enabled":
      return "This legacy text-message method is unavailable. Add a CareBase text-message method or use an authenticator app.";
    case "mfa_phone_verify_not_enabled":
      return "This legacy text-message method is unavailable. Use your CareBase text-message method or an authenticator app.";
    case "fresh_password_required":
      return "Sign out and sign in again with your password before changing your verification methods.";
    case "mfa_required":
    case "fresh_mfa_required":
      return "Verify an existing method before changing your verification methods.";
    case "sms_unavailable":
    case "sms_mfa_not_configured":
    case "sms_not_configured":
      return "Text-message verification is not configured yet. Use an authenticator app or contact your administrator.";
    case "challenge_expired":
    case "challenge_invalid":
      return "That code has expired or was already used. Request a new code.";
    case "sms_rate_limited":
    case "rate_limited":
    case "over_sms_send_rate_limit":
      return "Too many codes were requested for this number. Wait a minute before asking for another one.";
    case "delivery_failed":
    case "sms_send_failed":
      return "The verification code could not be sent. Check that the number can receive SMS, then try again.";
    case "verification_failed":
    case "invalid_code":
    case "mfa_verification_failed":
      return "That code didn't match. Request a new one and try again.";
    default:
      return message;
  }
}
