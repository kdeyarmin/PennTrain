/**
 * Planning an audit archive (BACKLOG.md G11).
 *
 * `plan_audit_archive` had no caller. It refuses nothing about the range itself -- it will happily
 * record a batch covering zero rows, or a range that runs backwards, because its own checks are
 * about who you are and whether a legal hold applies. Everything here is the client's job.
 */

export interface ArchivePlanForm {
  from: string;
  to: string;
}

/** What is wrong with the range, or an empty list when it is worth planning. */
export function archivePlanIssues(form: ArchivePlanForm, rowCount: number | null): string[] {
  const issues: string[] = [];
  const from = Date.parse(form.from);
  const to = Date.parse(form.to);
  if (!form.from || Number.isNaN(from)) issues.push("Give a start date for the range.");
  if (!form.to || Number.isNaN(to)) issues.push("Give an end date for the range.");
  if (!Number.isNaN(from) && !Number.isNaN(to) && to <= from) {
    issues.push("The end of the range has to come after its start.");
  }
  // The server records the batch either way, so an empty batch is a permanent row describing
  // nothing. Worth stopping at the keyboard rather than in the archive table.
  if (rowCount === 0) {
    issues.push("No audit rows fall in this range — there is nothing to archive.");
  }
  return issues;
}

/**
 * Whether the caller should be warned before planning, and why.
 *
 * A legal hold does not stop the plan; `plan_audit_archive` stamps `legal_hold_applies` on the batch
 * and returns normally. Saying so up front is the difference between "you cannot" and "you can, and
 * the batch will carry a hold flag that stops it being exported".
 */
export function legalHoldWarning(activeHolds: number, organizationScoped: boolean): string | null {
  if (activeHolds === 0) return null;
  return organizationScoped
    ? `${activeHolds} legal hold${activeHolds === 1 ? " is" : "s are"} active. If one covers this organization the batch will be flagged and must not be exported until the hold is released.`
    : `${activeHolds} legal hold${activeHolds === 1 ? " is" : "s are"} active. A platform-wide plan is covered by any of them, so the batch will be flagged.`;
}

/** The digest, shortened for a screen, without pretending it is the whole value. */
export function shortDigest(sha256: string): string {
  return sha256 ? `${sha256.slice(0, 16)}…` : "not computed";
}
