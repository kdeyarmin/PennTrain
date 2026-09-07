import { addFacilityCalendarDays, facilityToday } from "./dateUtils";

// Mirrors the due_date/status formulas the nightly recalc applies to employee_training_records, so
// pages that create/update a record client-side (EmployeeDetail.tsx, TrainingMatrix.tsx,
// PendingApprovals.tsx) show the same due_date/status it would compute, instead of a stale value
// until the next cron run. Keep this in sync if that SQL formula ever changes -- there is no single
// source of truth shared between SQL and TypeScript here.
//
// The formula now lives in `recalculate_compliance_core` (20260715210000), which superseded the
// `recalculate_all_compliance` this comment used to name; the status CASE is unchanged across that
// move and reads:
//
//     when r.status in ('not_applicable','pending_review') then r.status
//     when r.completion_date is null                       then 'missing'
//     when tt.renewal_interval_days is null                then 'compliant'
//     when (completion + interval) <  pa_today             then 'expired'
//     when (completion + interval) <= pa_today + warning   then 'due_soon'
//     else 'compliant'

export function todayISO(): string {
  return facilityToday();
}

export function addDaysISO(dateISO: string, days: number): string {
  return addFacilityCalendarDays(dateISO, days);
}

export function computeDueDate(completionDate: string | null, renewalIntervalDays: number | null | undefined): string | null {
  if (!completionDate || renewalIntervalDays == null) return null;
  return addDaysISO(completionDate, renewalIntervalDays);
}

/**
 * Whether this record is a certificate genuinely waiting for a reviewer.
 *
 * WHY THIS IS NARROWER THAN THE RECALC'S OWN BRANCH, which preserves `pending_review` and
 * `not_applicable` unconditionally. `pending_review` carries TWO meanings on this table and they
 * want opposite things from an edit:
 *
 *   1. A certificate awaiting approval. `PendingApprovals` writes `status: 'pending_review'` WITH
 *      `approval_status: 'pending'`, and only a reviewer may graduate it. An ordinary edit that
 *      recomputed the status would credit a certificate nobody had looked at -- measured: the
 *      employee's annual bucket goes from crediting nothing to `completed_hours 8.00` while
 *      `approval_status` is still `pending` and `verified_at` null.
 *
 *   2. An auto-instantiated audience shell, `approval_status` NULL. For a training type with
 *      `audience_verification_required`, facility type is only a catalog prefilter, and
 *      `training_types.audience_verification_required`'s own column comment says the requirement
 *      "remains pending_review and is excluded from annual-hour rollups until an employer confirms
 *      this exact audience BY CHANGING THE RECORD TO AN ACTIVE REQUIREMENT STATUS". Recording
 *      training against such a cell IS that confirmation. Preserving the status there is what a
 *      first version of this did, and it would have saved the completion and the hours while
 *      `recalculate_compliance_core` went on excluding them -- 47 such shells exist in the seeded
 *      demo tenant alone.
 *
 * `approval_status` separates them cleanly and is the only thing that does: a reviewer's queue
 * filters on it, and an audience shell has never been through that queue so it is null.
 * `not_applicable` is the same audience mechanism seen from the other side -- an employer decision
 * among `pending_review`, `not_applicable` and applicable, changed by the same route -- so it is
 * not preserved either; a manager recording a completion against it is asserting the requirement
 * does apply.
 */
function isAwaitingCertificateReview(currentStatus: string | null | undefined, approvalStatus: string | null | undefined): boolean {
  return currentStatus === "pending_review" && approvalStatus === "pending";
}

/**
 * `currentStatus` and `currentApprovalStatus` are what the record already carries, for an UPDATE.
 * Passing them holds a certificate that is still awaiting review; omitting them says the caller is
 * deliberately overriding that, which is what approving one means.
 *
 * WHY THE PARAMETER EXISTS. This function had no way to express the first line of the CASE above,
 * and its three callers do not want the same thing. `PendingApprovals` needs the omission -- moving
 * a record OUT of `pending_review` is what approving it means, and the recalc would never do that
 * on its own. `TrainingMatrix` and `EmployeeDetail` do not: both offer an ordinary edit on an
 * existing record, and a manager correcting a date on a certificate that is still awaiting review
 * silently graduated it.
 *
 * Measured on a live stack rather than argued: a `pending_review` record carrying 8 hours
 * contributes nothing to the employee's annual bucket, because `recalculate_compliance_core`'s
 * `legacy_earned` joins `r.status not in ('pending_review','not_applicable')`. Write `compliant`
 * over that status -- which is exactly the payload the matrix's save produced -- and re-run the
 * recalc, and the bucket reads `required 12.00, completed 8.00` while the record still carries
 * `approval_status = 'pending'` and a null `verified_at`. The certificate nobody has looked at is
 * already counting toward a regulated annual requirement. The row also stays in the approval queue,
 * which filters on `approval_status`, so nothing surfaces the discrepancy; a later REJECT does
 * clean it up (it writes `status: 'missing'` and clears the dates, for this exact reason), so the
 * exposure is the window until somebody reviews it -- which for a queue is the normal state.
 */
export function computeStatus(
  completionDate: string | null,
  dueDate: string | null,
  warningDays: number,
  currentStatus?: string | null,
  currentApprovalStatus?: string | null,
): string {
  if (isAwaitingCertificateReview(currentStatus, currentApprovalStatus)) return currentStatus!;
  if (!completionDate) return "missing";
  if (!dueDate) return "compliant";
  const today = todayISO();
  if (dueDate < today) return "expired";
  if (dueDate <= addDaysISO(today, warningDays)) return "due_soon";
  return "compliant";
}
