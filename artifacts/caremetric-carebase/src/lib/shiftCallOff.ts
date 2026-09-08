/**
 * Call-off is not a status PATCH. `record_shift_call_off` is the only writer that
 * files the absence, opens the unfilled-shift work item, and posts the opening to
 * `open_shift_opportunities` -- the queue J73 finally gave a producer.
 *
 * A manager clicking "Called Off" on a published schedule used to update
 * `shift_assignments.status` directly, so coverage vanished and the claim queue
 * stayed empty. Drafts stay a planning mark: the RPC would open a work item for a
 * schedule nobody has been shown.
 */

export const SHIFT_CALL_OFF_CATEGORIES = [
  { value: "illness", label: "Illness" },
  { value: "family_emergency", label: "Family emergency" },
  { value: "transportation", label: "Transportation" },
  { value: "bereavement", label: "Bereavement" },
  { value: "jury_duty", label: "Jury duty" },
  { value: "weather", label: "Weather" },
  { value: "personal", label: "Personal" },
  { value: "other", label: "Other" },
] as const;

export type ShiftCallOffCategory = (typeof SHIFT_CALL_OFF_CATEGORIES)[number]["value"];

export function isShiftCallOffCategory(value: string): value is ShiftCallOffCategory {
  return SHIFT_CALL_OFF_CATEGORIES.some((category) => category.value === value);
}

/**
 * Mirrors `protect_shift_assignment_call_off`: a published shift may only become
 * `called_off` through the RPC. Drafts may still be marked in the grid.
 */
export function publishedShiftCallOffRequiresRpc(
  scheduleStatus: string | null | undefined,
): boolean {
  return scheduleStatus === "published";
}

export function shiftCallOffReasonIsReady(reason: string): boolean {
  return reason.trim().length >= 5;
}
