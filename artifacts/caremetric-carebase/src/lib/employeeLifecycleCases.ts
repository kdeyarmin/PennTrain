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
  lines.push(value.allowed ? "Transition is currently allowed." : "Transition is blocked until dependencies are resolved.");

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
