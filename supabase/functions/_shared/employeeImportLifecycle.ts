/**
 * J118 locked status / hire_date / facility_id on the roster edit form because
 * `protect_employee_lifecycle_fields` refuses those columns unless
 * `app.lifecycle_transition` is on. CSV update still sent them, so a title-and-phone
 * re-import that also carried a different status failed mid-apply.
 *
 * Create still writes them. Update never does.
 */

const LIFECYCLE_IMPORT_KEYS = ["status", "hire_date", "facility_id", "termination_date"] as const;

export function stripEmployeeLifecycleFromImportUpdate(
  payload: Record<string, unknown>,
  existing: Record<string, unknown>,
): { payload: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const next: Record<string, unknown> = { ...payload };
  for (const key of LIFECYCLE_IMPORT_KEYS) {
    if (!(key in next)) continue;
    const incoming = next[key];
    const current = existing[key];
    delete next[key];
    if (incoming == null || incoming === "") continue;
    if (String(incoming) !== String(current ?? "")) {
      warnings.push(`${key} cannot be changed by import; use a lifecycle case. The current value was kept.`);
    }
  }
  return { payload: next, warnings };
}
