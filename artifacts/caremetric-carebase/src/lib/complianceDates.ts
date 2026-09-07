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
 * Statuses the recalc refuses to recompute, because each is a decision somebody made rather than a
 * position on a clock: `pending_review` says a certificate is waiting for a reviewer, and
 * `not_applicable` says this requirement does not apply to this person.
 */
const DECIDED_STATUSES = new Set(["pending_review", "not_applicable"]);

/**
 * `currentStatus` is the status the record already carries, for an UPDATE. Passing it reproduces
 * the server's first branch; omitting it says the caller is deliberately overriding that decision.
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
): string {
  if (currentStatus && DECIDED_STATUSES.has(currentStatus)) return currentStatus;
  if (!completionDate) return "missing";
  if (!dueDate) return "compliant";
  const today = todayISO();
  if (dueDate < today) return "expired";
  if (dueDate <= addDaysISO(today, warningDays)) return "due_soon";
  return "compliant";
}
