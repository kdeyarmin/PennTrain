/**
 * Correcting completed training evidence (BACKLOG.md G6).
 *
 * A completed class is immutable: the trigger added in `20260714233041` refuses writes unless
 * `app.completed_class_correction` is set, and only `correct_completed_training_class` and
 * `correct_completed_class_attendee` set it. Both refuse a reason shorter than ten characters, and
 * the class correction refuses any field outside a fixed descriptive set.
 *
 * These rules are restated here so a form can say what is wrong before submitting rather than after.
 * The server is still the enforcement -- these are the two halves of one decision, and the constants
 * below are pinned to the migration by a test that reads the SQL, so they cannot drift apart
 * silently.
 */

/** Matches the `length(btrim(coalesce(p_reason, ''))) < 10` guard in both correction RPCs. */
export const CORRECTION_REASON_MIN_LENGTH = 10;

/**
 * Fields `correct_completed_training_class` will accept. Anything else is refused outright:
 * scheduled hours and dates are what each attendee's training record was computed from, so
 * "correcting" them would silently desynchronise the record from the class it came from.
 */
export const CORRECTABLE_CLASS_FIELDS = [
  "class_name",
  "location",
  "notes",
  "roster_document_id",
] as const;

export type CorrectableClassField = typeof CORRECTABLE_CLASS_FIELDS[number];

/** Null when the reason is acceptable; otherwise what is wrong with it, in a person's words. */
export function correctionReasonIssue(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) {
    return "A reason is required. It is kept permanently and is what makes this a correction rather than an edit.";
  }
  if (trimmed.length < CORRECTION_REASON_MIN_LENGTH) {
    return `Give at least ${CORRECTION_REASON_MIN_LENGTH} characters — "typo" does not tell the next reader what changed or why.`;
  }
  return null;
}

/**
 * Whether a patch is one the server will accept. Returns the offending keys so a caller can say
 * which field is the problem instead of failing generically.
 */
export function unacceptableClassPatchFields(patch: Record<string, unknown>): string[] {
  const allowed = new Set<string>(CORRECTABLE_CLASS_FIELDS);
  return Object.keys(patch).filter((key) => !allowed.has(key));
}
