/**
 * Whether a confidential-intake submission failed because of the CALLER or because of us.
 *
 * BACKLOG J47 draws that line for a reason: a reporter who is trying to raise a safety concern must
 * not be locked out of the form by our own errors, so a product-caused failure refunds the hourly
 * quota reservation. The mistake was reporting *every* failure as product-caused. One valid
 * Turnstile token then bought unlimited rejected submissions -- a bad facility code, a
 * two-character narrative, a malformed timestamp, each refunded and retryable for ever -- which is
 * the whole throttle gone for anybody willing to solve one challenge.
 *
 * `start_confidential_incident_intake` raises exactly one deliberate error (22023, covering an
 * unknown facility and every too-short field). The constraint, cast and authorization failures
 * beside it are equally the caller's doing. Everything else -- an unknown code, a dropped
 * connection, an internal error, no code at all -- stays product-caused and is still refunded,
 * which is the direction J47 asks for whenever we cannot tell.
 */
const CALLER_CAUSED_SQLSTATES = new Set([
  "22023", // invalid_parameter_value -- the RPC's own validation raise
  "22P02", // invalid_text_representation -- a malformed uuid or timestamp
  "23503", // foreign_key_violation
  "23514", // check_violation -- report_type / severity / reporter_mode
  "42501", // insufficient_privilege
]);

/** `submission_rejected` counts against the quota; `submission_failed` refunds it. */
export function intakeFailureCode(sqlState: string | null | undefined): string {
  return sqlState && CALLER_CAUSED_SQLSTATES.has(sqlState)
    ? "submission_rejected"
    : "submission_failed";
}
