/**
 * Duty eligibility (program plan Phase 8a, request item 18).
 *
 * WHERE THE ENFORCEMENT LIVES: not here. `evaluate_duty_eligibility` decides, and two server paths
 * refuse the action -- `finalize_resident_assessment_review` calls the guard, and a trigger on
 * `competency_records` does the same for evaluators. Per IMPLEMENTATION_PLAN.md no UI gate is an
 * authorization boundary, so this module exists only to say the same thing to a person *before* they
 * spend five minutes filling in a form that the server will reject.
 *
 * WHY THE BLOCK REASONS ARE SPELLED OUT. "Not permitted" tells someone nothing they can act on. Each
 * code below carries what is wrong and what would resolve it, because the two useful next steps --
 * fix the underlying record, or ask for an override -- are different depending on which it is.
 */

export type DutyOutcome = "eligible" | "warning" | "blocked";

export interface DutyEligibilityResult {
  outcome: DutyOutcome;
  blocks: string[];
  warnings: string[];
  overrideId: string | null;
  dutyKey?: string;
  enforcement?: "block" | "warn";
}

export interface DutyReason {
  code: string;
  /** What is wrong, in plain words. */
  summary: string;
  /** What would resolve it. */
  resolution: string;
  /** True when an override is a sensible response, false when the record itself must change. */
  overridable: boolean;
}

const REASONS: Record<string, Omit<DutyReason, "code">> = {
  profile_not_found: {
    summary: "This person has no account in the organization.",
    resolution: "Invite them, or pick somebody else to sign.",
    overridable: false,
  },
  profile_inactive: {
    summary: "This person's account is deactivated.",
    resolution: "Reactivate the account if they still work here; otherwise somebody else must sign.",
    overridable: false,
  },
  role_not_accepted: {
    summary: "This person's role is not permitted to perform this duty.",
    resolution: "Have somebody in a permitted role sign, or change the duty rule if the role should be allowed.",
    overridable: true,
  },
  qualification_missing: {
    summary: "This person does not hold a qualification this duty requires.",
    resolution: "Record the qualification once it is earned, or ask an organization administrator for a time-limited override.",
    overridable: true,
  },
  no_rule_configured: {
    summary: "No eligibility rule is configured for this duty.",
    resolution: "Nothing is being checked. Configure a rule if this duty should be governed.",
    overridable: false,
  },
  no_employee_record_for_qualification_check: {
    summary: "This person has no employee record at this facility, so their qualifications cannot be checked.",
    resolution: "Add an employee record at this facility if they work here.",
    overridable: false,
  },
  override_applied: {
    summary: "A recorded override is permitting this.",
    resolution: "The override expires; the underlying requirement still needs resolving.",
    overridable: false,
  },
};

export function dutyReason(code: string): DutyReason {
  const known = REASONS[code];
  if (known) return { code, ...known };
  // An unrecognized code must still read as something, not as a blank line in a dialog.
  return {
    code,
    summary: code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    resolution: "Check the duty eligibility rules for this organization.",
    overridable: true,
  };
}

export function dutyReasons(result: DutyEligibilityResult): DutyReason[] {
  return [...result.blocks, ...result.warnings].map(dutyReason);
}

export function isDutyBlocked(result: DutyEligibilityResult | undefined): boolean {
  return result?.outcome === "blocked";
}

/** True when asking an administrator for an override is a sensible next step. */
export function canRequestOverride(result: DutyEligibilityResult | undefined): boolean {
  if (!result || result.outcome !== "blocked") return false;
  return result.blocks.map(dutyReason).some((reason) => reason.overridable);
}

/**
 * One line to show beside the action. Deliberately says who is blocked and why rather than only
 * that the button is unavailable.
 */
export function dutyEligibilitySummary(result: DutyEligibilityResult | undefined): string | null {
  if (!result) return null;
  if (result.outcome === "eligible") return null;
  const reasons = result.outcome === "blocked"
    ? result.blocks.map(dutyReason)
    : result.warnings.map(dutyReason);
  if (reasons.length === 0) return null;
  const lead = result.outcome === "blocked" ? "Cannot sign: " : "Note: ";
  return lead + reasons.map((reason) => reason.summary).join(" ");
}
