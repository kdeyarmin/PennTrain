// Pure helpers for the Compliance Command Center (task Area 1): the generic, user-definable
// facility compliance requirement register. Labels, badge classes, cadence formatting, effective
// status derivation, roll-up summaries, and the facility compliance score all live here so they can
// be unit-tested without a database and shared between the dashboard, drill-downs, and CSV export.
import { daysUntil } from "@/lib/dateUtils";

export const COMPLIANCE_CATEGORIES = [
  { value: "resident_records", label: "Resident records" },
  { value: "assessments_support_plans", label: "Assessments & support plans" },
  { value: "employee_records", label: "Employee records" },
  { value: "training_credentials", label: "Training & credentials" },
  { value: "medication_admin_training", label: "Medication-administration training" },
  { value: "fire_emergency_preparedness", label: "Fire & emergency preparedness" },
  { value: "physical_site_inspections", label: "Physical-site inspections" },
  { value: "incident_reporting", label: "Incident reporting" },
  { value: "quality_management", label: "Quality management" },
  { value: "resident_agreements", label: "Resident agreements" },
  { value: "required_postings", label: "Required postings" },
  { value: "policies_procedures", label: "Policies & procedures" },
  { value: "licensing_survey_prep", label: "Licensing & survey preparation" },
  { value: "other", label: "Other" },
] as const;

export type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number]["value"];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  COMPLIANCE_CATEGORIES.map((c) => [c.value, c.label]),
);

export function categoryLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return CATEGORY_LABELS[value] ?? value;
}

export const COMPLIANCE_STATUSES = [
  "not_started",
  "in_progress",
  "awaiting_review",
  "complete",
  "overdue",
  "not_applicable",
  "exception_approved",
] as const;

export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  awaiting_review: "Awaiting review",
  complete: "Complete",
  overdue: "Overdue",
  not_applicable: "Not applicable",
  exception_approved: "Exception approved",
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABELS[status] ?? status;
}

// Semantic design tokens (matches complianceStatusBadgeClassName in residentCompliance.ts).
export function statusBadgeClassName(status: string): string {
  switch (status) {
    case "complete":
    case "exception_approved":
      return "bg-success text-success-foreground hover:bg-success/80";
    case "awaiting_review":
    case "in_progress":
      return "bg-warning text-warning-foreground hover:bg-warning/80";
    case "overdue":
      return "bg-destructive text-destructive-foreground hover:bg-destructive/80";
    case "not_applicable":
    case "not_started":
    default:
      return "bg-muted text-muted-foreground";
  }
}

export const RECURRENCE_OPTIONS = [
  { value: "one_time", label: "One-time" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semiannual", label: "Semi-annual" },
  { value: "annual", label: "Annual" },
  { value: "custom", label: "Custom interval" },
] as const;

export function recurrenceLabel(recurrence: string | null | undefined, customIntervalDays?: number | null): string {
  if (recurrence === "custom") {
    return customIntervalDays ? `Every ${customIntervalDays} days` : "Custom interval";
  }
  return RECURRENCE_OPTIONS.find((r) => r.value === recurrence)?.label ?? (recurrence ?? "—");
}

export const CHAPTER_OPTIONS = [
  { value: "2600", label: "55 Pa. Code Ch. 2600 (PCH)" },
  { value: "2800", label: "55 Pa. Code Ch. 2800 (ALF)" },
  { value: "other", label: "Other regulation" },
] as const;

export function chapterLabel(chapter: string | null | undefined): string {
  if (!chapter) return "—";
  return CHAPTER_OPTIONS.find((c) => c.value === chapter)?.label ?? chapter;
}

// Occurrences that satisfy an obligation (count toward the score numerator).
const RESOLVED_STATUSES = new Set(["complete", "exception_approved", "not_applicable"]);
// Occurrences that are still actionable (not yet satisfied).
const OPEN_STATUSES = new Set(["not_started", "in_progress", "awaiting_review", "overdue"]);

export function isResolved(status: string): boolean {
  return RESOLVED_STATUSES.has(status);
}

export interface InstanceLike {
  status: string;
  due_date: string;
  evidence_count?: number;
  requires_evidence?: boolean;
  warning_days?: number;
}

/**
 * The status to show/count today. The nightly maintenance job flips past-due occurrences to
 * "overdue", but the UI derives the same verdict immediately so it is never stale between runs:
 * a not_started / in_progress occurrence whose due date has passed reads as overdue.
 */
export function effectiveStatus(instance: InstanceLike, today: Date = new Date()): ComplianceStatus {
  const s = instance.status;
  if (s === "not_started" || s === "in_progress") {
    const d = daysUntil(instance.due_date, today);
    if (d !== null && d < 0) return "overdue";
  }
  return (COMPLIANCE_STATUSES as readonly string[]).includes(s) ? (s as ComplianceStatus) : "not_started";
}

export function isOverdue(instance: InstanceLike, today: Date = new Date()): boolean {
  return effectiveStatus(instance, today) === "overdue";
}

/** Open and due within its warning window (defaults to 14 days when the requirement omits one). */
export function isDueSoon(instance: InstanceLike, today: Date = new Date()): boolean {
  const status = effectiveStatus(instance, today);
  if (status !== "not_started" && status !== "in_progress") return false;
  const d = daysUntil(instance.due_date, today);
  if (d === null || d < 0) return false;
  return d <= (instance.warning_days ?? 14);
}

/** Requires evidence, has none, and is still actionable. */
export function isMissingEvidence(instance: InstanceLike, today: Date = new Date()): boolean {
  if (!instance.requires_evidence) return false;
  if ((instance.evidence_count ?? 0) > 0) return false;
  return OPEN_STATUSES.has(effectiveStatus(instance, today));
}

export interface ComplianceSummary {
  total: number;
  byStatus: Record<ComplianceStatus, number>;
  dueSoon: number;
  overdue: number;
  awaitingReview: number;
  missingEvidence: number;
  resolved: number;
  open: number;
  score: number | null;
}

/**
 * Facility compliance score = round(100 × (resolved + awaiting_review) / (resolved + awaiting_review
 * + overdue)). Occurrences still in-flight and not yet due are excluded from the denominator so
 * upcoming work does not distort the score; null when there is nothing scoreable yet.
 */
export function computeComplianceScore(instances: InstanceLike[], today: Date = new Date()): number | null {
  let good = 0;
  let bad = 0;
  for (const instance of instances) {
    const status = effectiveStatus(instance, today);
    if (RESOLVED_STATUSES.has(status) || status === "awaiting_review") good += 1;
    else if (status === "overdue") bad += 1;
  }
  const denom = good + bad;
  if (denom === 0) return null;
  return Math.round((good / denom) * 100);
}

export function summarizeInstances(instances: InstanceLike[], today: Date = new Date()): ComplianceSummary {
  const byStatus: Record<ComplianceStatus, number> = {
    not_started: 0,
    in_progress: 0,
    awaiting_review: 0,
    complete: 0,
    overdue: 0,
    not_applicable: 0,
    exception_approved: 0,
  };
  let dueSoon = 0;
  let missingEvidence = 0;
  let resolved = 0;
  let open = 0;

  for (const instance of instances) {
    const status = effectiveStatus(instance, today);
    byStatus[status] += 1;
    if (RESOLVED_STATUSES.has(status)) resolved += 1;
    if (OPEN_STATUSES.has(status)) open += 1;
    if (isDueSoon(instance, today)) dueSoon += 1;
    if (isMissingEvidence(instance, today)) missingEvidence += 1;
  }

  return {
    total: instances.length,
    byStatus,
    dueSoon,
    overdue: byStatus.overdue,
    awaitingReview: byStatus.awaiting_review,
    missingEvidence,
    resolved,
    open,
    score: computeComplianceScore(instances, today),
  };
}
