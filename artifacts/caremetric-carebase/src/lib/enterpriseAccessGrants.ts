/**
 * Ending a standing enterprise role grant (BACKLOG.md G10).
 *
 * `end_enterprise_role_grant` shipped with three refusals and no caller. Restating them here is what
 * turns "42501" and "22007" into something a person can act on before they press the button; the
 * server stays the authority and re-checks all of them.
 */

export interface EndGrantInput {
  reason: string;
  /** ISO instant the access stops. */
  effectiveTo: string;
  /** ISO instant the grant started, from the row being ended. */
  effectiveFrom: string;
}

/** Everything wrong with an end-grant form, or an empty list when it will be accepted. */
export function endGrantIssues(input: EndGrantInput): string[] {
  const issues: string[] = [];
  // Mirrors `nullif(trim(coalesce(p_reason,'')),'') is null`. The reason is appended to the grant's
  // own reason column rather than stored separately, so it becomes part of the permanent record of
  // why this person had this access and why they stopped.
  if (!input.reason.trim()) {
    issues.push("Say why the access is ending — it is appended to the grant's permanent reason.");
  }
  const to = Date.parse(input.effectiveTo);
  const from = Date.parse(input.effectiveFrom);
  if (Number.isNaN(to)) {
    issues.push("Give a valid end date and time.");
  } else if (!Number.isNaN(from) && to <= from) {
    // Mirrors `p_effective_to <= v_grant.effective_from`.
    issues.push("The end has to come after the grant started — a grant cannot be un-issued, only closed.");
  }
  return issues;
}

/**
 * How long this access has been standing, in the terms somebody reviewing it thinks in.
 *
 * Grants have no natural expiry, so age is the only signal on the list that distinguishes "granted
 * this morning for a covering shift" from access nobody has looked at since onboarding.
 */
export function grantAgeLabel(effectiveFrom: string, now: Date): string {
  const start = Date.parse(effectiveFrom);
  if (Number.isNaN(start)) return "unknown age";
  const days = Math.floor((now.getTime() - start) / 86_400_000);
  if (days < 0) return "not yet effective";
  if (days === 0) return "standing since today";
  if (days === 1) return "standing 1 day";
  if (days < 60) return `standing ${days} days`;
  const months = Math.floor(days / 30);
  return months < 24 ? `standing ${months} months` : `standing ${Math.floor(days / 365)} years`;
}
