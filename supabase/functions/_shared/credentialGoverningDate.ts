const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Leading `YYYY-MM-DD` of a date or timestamp, or null when it is not a calendar day. */
export function calendarDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const day = value.slice(0, 10);
  return CALENDAR_DAY.test(day) ? day : null;
}

/**
 * Earlier calendar day, ignoring blanks.
 * PostgreSQL `least()` skips nulls; a missing expiration must not hide a policy date, and the reverse.
 */
export function earliestCalendarDate(...values: unknown[]): string | null {
  const days = values.map(calendarDay).filter((day): day is string => day !== null);
  if (days.length === 0) return null;
  days.sort();
  return days[0];
}

export interface CredentialDeadline {
  expiration_date?: unknown;
  policy_renewal_due_date?: unknown;
}

/**
 * The date that makes a clearance due.
 * `apply_staff_credential_policy` stores status from `least(expiration_date, policy_renewal_due_date)`.
 * Readers that look only at the document expiration miss an earlier facility renewal policy.
 */
export function credentialGoverningDate(credential: CredentialDeadline): string | null {
  return earliestCalendarDate(credential.expiration_date, credential.policy_renewal_due_date);
}

export function credentialGoverningDateInWindow(credential: CredentialDeadline, from: string, through: string): boolean {
  const due = credentialGoverningDate(credential);
  return due !== null && due >= from && due <= through;
}

export function credentialsInGoverningWindow<T extends CredentialDeadline>(rows: T[], from: string, through: string): T[] {
  return rows
    .filter((row) => credentialGoverningDateInWindow(row, from, through))
    .sort((a, b) => (credentialGoverningDate(a) ?? "").localeCompare(credentialGoverningDate(b) ?? ""));
}

/**
 * Rows that might be due in the window. Either column can be the earlier date, so the filter is wider
 * than the answer: keep a row only when `credentialGoverningDate` itself falls inside the window.
 * A later document expiration must not keep a clearance whose policy date has already passed.
 */
export function credentialDeadlineWindowFilter(from: string, through: string): string {
  if (!CALENDAR_DAY.test(from) || !CALENDAR_DAY.test(through)) {
    throw new Error("credential window dates must be YYYY-MM-DD");
  }
  return `and(expiration_date.gte.${from},expiration_date.lte.${through}),and(policy_renewal_due_date.gte.${from},policy_renewal_due_date.lte.${through})`;
}
