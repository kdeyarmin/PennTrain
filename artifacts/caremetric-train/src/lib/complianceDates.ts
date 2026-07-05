// Mirrors the due_date/status formulas in recalculate_all_compliance() (supabase/migrations/
// 20260704053624_compliance_rpcs_and_audit_trigger.sql) for employee_training_records, so pages
// that create/update a record client-side (EmployeeDetail.tsx, TrainingMatrix.tsx,
// PendingApprovals.tsx) show the same due_date/status the nightly recalc would compute, instead
// of a stale value until the next cron run. Keep this in sync if that SQL formula ever changes --
// there is no single source of truth shared between SQL and TypeScript here.

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function computeDueDate(completionDate: string | null, renewalIntervalDays: number | null | undefined): string | null {
  if (!completionDate || renewalIntervalDays == null) return null;
  return addDaysISO(completionDate, renewalIntervalDays);
}

export function computeStatus(completionDate: string | null, dueDate: string | null, warningDays: number): string {
  if (!completionDate) return "missing";
  if (!dueDate) return "compliant";
  const today = todayISO();
  if (dueDate < today) return "expired";
  if (dueDate <= addDaysISO(today, warningDays)) return "due_soon";
  return "compliant";
}
