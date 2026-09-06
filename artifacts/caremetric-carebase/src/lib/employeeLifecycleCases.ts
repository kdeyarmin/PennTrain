export const EMPLOYEE_LIFECYCLE_TRANSITIONS = [
  "rehire",
  "transfer",
  "leave",
  "return",
  "terminate",
  "suspend_access",
  "restore_access",
] as const;

export type EmployeeLifecycleTransition = (typeof EMPLOYEE_LIFECYCLE_TRANSITIONS)[number];

export const EMPLOYEE_LIFECYCLE_CASE_STATUSES = [
  "draft",
  "ready",
  "blocked",
  "applied",
  "canceled",
] as const;

export type EmployeeLifecycleCaseStatus = (typeof EMPLOYEE_LIFECYCLE_CASE_STATUSES)[number];

export function lifecycleTransitionLabel(transition: string): string {
  return transition.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function lifecycleCaseStatusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function transitionRequiresTargetFacility(transition: string): boolean {
  return transition === "transfer";
}

/**
 * The employee statuses `preview_employee_lifecycle_transition` will accept for each transition.
 *
 * Read straight off that function's `case p_transition` block. The wizard's employee picker used to
 * be hard-scoped to `status: "active"`, which made three of the seven transitions unreachable from
 * any screen in the product: `rehire` requires a `terminated` employee, `return` requires
 * `on_leave`, and `transfer` admits `on_leave` as well as `active`. The dropdown still listed
 * Rehire and Return, so the only way to pick a person the server would accept was for that person
 * not to be in the list. Once somebody was terminated or put on leave, nothing could bring them
 * back, though the server implements it.
 *
 * `suspend_access` has no status test of its own server-side (it needs a linked profile and no open
 * manual suspension), but a terminated employee's access is already closed by `terminate`, so the
 * picker offers currently-employed staff for it rather than the whole historical roster.
 */
export const LIFECYCLE_TRANSITION_ELIGIBLE_STATUSES: Record<EmployeeLifecycleTransition, readonly string[]> = {
  rehire: ["terminated"],
  transfer: ["active", "on_leave"],
  leave: ["active"],
  return: ["on_leave"],
  terminate: ["active", "on_leave"],
  suspend_access: ["active", "on_leave"],
  restore_access: ["active"],
};

export function lifecycleTransitionEligibleStatuses(transition: string): readonly string[] {
  return LIFECYCLE_TRANSITION_ELIGIBLE_STATUSES[transition as EmployeeLifecycleTransition]
    ?? ["active"];
}

export function lifecycleTransitionAdmitsStatus(transition: string, status: string | null | undefined): boolean {
  return !!status && lifecycleTransitionEligibleStatuses(transition).includes(status);
}

/**
 * The transition to open the wizard on for an employee in a given status.
 *
 * An employee record links straight into the wizard, and landing on a transition that person is
 * ineligible for would show an empty picker with their own name missing from it. The obvious next
 * move for each state is the one the server admits: bring a terminated person back, return someone
 * from leave, put an active employee on leave.
 */
export function defaultLifecycleTransition(status: string | null | undefined): EmployeeLifecycleTransition {
  if (status === "terminated") return "rehire";
  if (status === "on_leave") return "return";
  return "leave";
}

/**
 * Readable text for the codes `preview_employee_lifecycle_transition` returns in `reasons`.
 *
 * The preview answered "why not" all along and the page never read the array, so every blocked case
 * -- whatever the cause -- said only "Transition is blocked until dependencies are resolved," which
 * names no dependency and offers no next step. An unrecognized code still renders (as its own text,
 * de-underscored) rather than being dropped: a new server-side reason must not disappear from the
 * screen just because this table has not caught up with it.
 */
const LIFECYCLE_BLOCK_REASON_LABELS: Record<string, string> = {
  unsupported_transition: "That transition is not one this server accepts.",
  effective_date_required: "An effective date is required.",
  future_effective_date_not_supported: "The effective date cannot be in the future.",
  reason_required: "A reason is required.",
  target_facility_outside_organization_or_inactive:
    "The target facility is inactive or belongs to another organization.",
  workforce_person_link_missing:
    "This employee has no workforce person record yet, so the transition has nothing to write against.",
  hire_requires_no_active_episode:
    "Hire needs an inactive or terminated employee with no open employment episode.",
  rehire_requires_terminated_employee:
    "Rehire needs a terminated employee with no open employment episode.",
  transfer_requires_active_episode:
    "Transfer needs an active or on-leave employee with an open employment episode.",
  transfer_requires_new_facility: "Transfer needs a target facility different from the current one.",
  leave_requires_active_employment: "Leave needs an active employee with an open employment episode.",
  return_requires_leave_state: "Return needs an employee whose status is on leave.",
  terminate_requires_active_episode:
    "Terminate needs an employee who is not already terminated and has an open employment episode.",
  linked_profile_required: "This employee has no linked login account to suspend.",
  manual_access_suspension_already_open: "This employee already has an open manual access suspension.",
  access_restore_requires_active_employment: "Restoring access needs an active employee.",
  no_manual_access_suspension: "This employee has no open manual access suspension to restore.",
  effective_date_precedes_active_episode:
    "The effective date is before the start of the open employment episode.",
};

export function lifecycleBlockReasonLabel(code: string): string {
  return LIFECYCLE_BLOCK_REASON_LABELS[code] ?? code.replaceAll("_", " ");
}

/** The `reasons` array off a preview document, as readable sentences. */
export function lifecyclePreviewReasons(preview: unknown): string[] {
  if (!preview || typeof preview !== "object") return [];
  const reasons = (preview as LifecyclePreviewLike).reasons;
  if (!Array.isArray(reasons)) return [];
  return reasons
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => lifecycleBlockReasonLabel(entry));
}

export function canApplyLifecycleCase(status: string): boolean {
  return status === "ready";
}

export function canRefreshLifecycleCase(status: string): boolean {
  return status === "draft" || status === "ready" || status === "blocked";
}

export function canCancelLifecycleCase(status: string): boolean {
  return status === "draft" || status === "ready" || status === "blocked";
}

export interface LifecyclePreviewLike {
  allowed?: boolean;
  /** `preview_employee_lifecycle_transition` returns this as `'reasons', to_jsonb(v_reasons)`. */
  reasons?: unknown;
  blockers?: unknown;
  effects?: unknown;
  dependencies?: unknown;
  summary?: unknown;
  [key: string]: unknown;
}

export function lifecyclePreviewAllowed(preview: unknown): boolean {
  if (!preview || typeof preview !== "object") return false;
  return Boolean((preview as LifecyclePreviewLike).allowed);
}

export function summarizeLifecyclePreview(preview: unknown): string[] {
  if (!preview || typeof preview !== "object") return ["No dependency preview is available."];
  const value = preview as LifecyclePreviewLike;
  const lines: string[] = [];
  lines.push(value.allowed ? "Transition is currently allowed." : "Transition is blocked:");
  // The server says WHY. Reading it is the difference between a screen a manager can act on and one
  // that only reports that something is wrong.
  for (const reason of lifecyclePreviewReasons(preview)) lines.push(reason);

  const collect = (key: "blockers" | "effects" | "dependencies") => {
    const item = value[key];
    if (Array.isArray(item)) {
      for (const entry of item.slice(0, 8)) {
        if (typeof entry === "string") lines.push(`${key}: ${entry}`);
        else if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          const label = String(record.message ?? record.summary ?? record.type ?? JSON.stringify(entry));
          lines.push(`${key}: ${label}`);
        }
      }
    } else if (item && typeof item === "object") {
      lines.push(`${key}: ${JSON.stringify(item)}`);
    }
  };
  collect("blockers");
  collect("effects");
  collect("dependencies");
  if (typeof value.summary === "string" && value.summary.trim()) {
    lines.push(value.summary.trim());
  }
  return lines;
}

export function lifecycleCasesToCsv(
  cases: Array<{
    id: string;
    transition: string;
    status: string;
    effective_on: string;
    reason: string;
    employee_id: string;
    applied_at: string | null;
    canceled_at: string | null;
  }>,
): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [
    "case_id,employee_id,transition,status,effective_on,reason,applied_at,canceled_at",
    ...cases.map((row) =>
      [
        row.id,
        row.employee_id,
        row.transition,
        row.status,
        row.effective_on,
        quote(row.reason),
        row.applied_at ?? "",
        row.canceled_at ?? "",
      ].join(","),
    ),
  ].join("\n");
}
