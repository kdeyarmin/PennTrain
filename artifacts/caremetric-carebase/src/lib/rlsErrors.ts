import { errorText } from "./errorText";

/**
 * Turn a Postgres row-level-security refusal into something a user can act on.
 *
 * `facilities_select` is org-wide, so every facility dropdown in the product can offer a
 * facility_manager a facility they hold no `facility_assignments` row for. The insert policies are
 * not org-wide -- they call `is_assigned_to_facility()` -- so picking the wrong one fails, and the
 * page rendered PostgREST's own sentence verbatim:
 *
 *   new row violates row-level security policy for table "employees"
 *
 * That names a policy and a table, which is the right answer for a log and the wrong one for the
 * person at the workstation: it reads like an outage, gives no next step, and leaks the schema. The
 * pickers are narrowed to assigned facilities so this is no longer the routine outcome, but the
 * refusal is still reachable (an assignment revoked in another tab, a stale form, a facility
 * deactivated mid-edit), so the message it produces has to be a sentence.
 *
 * PostgREST reports these as SQLSTATE 42501 with a message containing "violates row-level security
 * policy"; a `WITH CHECK` failure on a plain insert may arrive with only the message, so both are
 * matched.
 */
export function isRlsViolation(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === "42501") return true;
  }
  return errorText(error).toLowerCase().includes("violates row-level security policy");
}

/**
 * The message to show for a failed write: the facility-assignment sentence when the database
 * refused on RLS, and the original text otherwise.
 */
export function facilityScopedErrorText(error: unknown): string {
  return isRlsViolation(error)
    ? "You are not assigned to that facility. Pick one of your assigned facilities, or ask an organization admin to assign you."
    : errorText(error);
}
