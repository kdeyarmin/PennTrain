/**
 * Multi-factor authentication factor helpers.
 *
 * Supabase Auth supports two second factors that both raise a session to the
 * `aal2` claim our privileged RLS policies and `assert_phase2_aal2()` checks
 * require: a TOTP authenticator app, and a one-time code delivered by SMS
 * ("phone" factors). The SMS option is a paid Supabase add-on ("Advanced MFA
 * Phone") that also needs an SMS provider configured on the Auth project, so
 * the UI only offers it where the deployment has actually turned it on.
 */

export type MfaFactorType = "totp" | "phone";

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
    factors.push({
      id: candidate.id,
      factor_type: factorType,
      friendly_name: typeof candidate.friendly_name === "string" ? candidate.friendly_name : null,
      status: candidate.status === "verified" ? "verified" : "unverified",
      created_at: typeof candidate.created_at === "string" ? candidate.created_at : "",
      phone: typeof candidate.phone === "string" ? candidate.phone : null,
    });
  }
  return factors;
}

/**
 * Whether this deployment advertises SMS codes as an enrollment option.
 *
 * Defaults to off: a project without the Advanced MFA Phone add-on rejects
 * phone enrollment outright, and an option that always errors is worse than
 * no option at all.
 */
export function isSmsMfaEnabled(
  flag: unknown = import.meta.env.VITE_MFA_SMS_ENABLED,
): boolean {
  return flag === true || flag === "true";
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
  return factor.factor_type === "phone" ? maskMfaPhone(factor.phone) : "Authenticator app";
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
      return "Text-message verification isn't enabled on this Supabase project yet. An administrator must turn on the Advanced MFA Phone add-on and configure the SMS provider.";
    case "mfa_phone_verify_not_enabled":
      return "Text-message verification is no longer enabled on this Supabase project. Use an authenticator app, or ask an administrator to re-enable phone factors.";
    case "over_sms_send_rate_limit":
      return "Too many codes were requested for this number. Wait a minute before asking for another one.";
    case "sms_send_failed":
      return "The verification code could not be sent. Check that the number can receive SMS, then try again.";
    case "mfa_verification_failed":
      return "That code didn't match. Request a new one and try again.";
    default:
      return message;
  }
}
