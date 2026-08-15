/**
 * Revoking a class's outstanding QR check-in codes.
 *
 * `revoke_class_checkin_tokens` (supabase/migrations/20260714233041_remediate_p2_security_findings.sql)
 * refuses a reason shorter than ten characters and writes the one it accepts into an
 * `audit_logs` row -- the permanent record of why every outstanding code for a class was killed
 * mid-session.
 *
 * The rule is restated here so the form can say what is wrong before submitting rather than after.
 * That matters more than usual on this control: the trainer reaches for it precisely because a code
 * has left the room, and the surface's own copy says a leaked code "keeps working until you revoke
 * it". A refusal that arrives as a raw Postgres error after the click leaves the codes live and the
 * trainer with no idea what to change.
 *
 * The constant is pinned to the migration by a test that reads the SQL, in the same shape as
 * completedClassCorrection.ts, so the two halves of the rule cannot drift apart silently.
 */

/** Matches the `length(btrim(coalesce(p_reason, ''))) < 10` guard in `revoke_class_checkin_tokens`. */
export const CHECKIN_TOKEN_REVOKE_REASON_MIN_LENGTH = 10;

/** Null when the reason is acceptable; otherwise what is wrong with it, in a person's words. */
export function checkinTokenRevokeReasonIssue(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) {
    return "A reason is required. It is kept in the audit log as the record of why the codes were killed.";
  }
  if (trimmed.length < CHECKIN_TOKEN_REVOKE_REASON_MIN_LENGTH) {
    return `Give at least ${CHECKIN_TOKEN_REVOKE_REASON_MIN_LENGTH} characters — say what happened, not just "revoked".`;
  }
  return null;
}
