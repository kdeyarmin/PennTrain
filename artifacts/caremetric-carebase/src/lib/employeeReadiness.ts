// Per-employee readiness verdict engine (task Area 3). Aggregates an employee's credential and
// training status, unsupervised-duty clearance, employment status, and any active restrictions into
// a single verdict with a plain-language "why". Pure and unit-tested; consumed by the employee page.
import { daysUntil, formatDateForDisplay } from "@/lib/dateUtils";

export type ReadinessStatus =
  | "ready"
  | "conditionally_ready"
  | "expiring_soon"
  | "incomplete"
  | "restricted"
  | "not_eligible";

export interface ReadinessCredentialLike {
  label?: string | null;
  status?: string | null;
  expiration_date?: string | null;
}

export interface ReadinessTrainingLike {
  label?: string | null;
  status?: string | null;
}

// Employment statuses that block duty. Kept as an explicit set (rather than "anything != active")
// so an unrecognized status never silently flips an otherwise-current employee to Not Eligible.
const BLOCKING_EMPLOYMENT = new Set(["inactive", "terminated", "suspended", "separated", "on_leave", "leave", "dismissed"]);

export interface ReadinessInput {
  clearedForUnsupervisedDuty?: boolean;
  /** employees.status — a known-blocking value (suspended, terminated, on_leave…) makes duty ineligible. */
  employmentStatus?: string | null;
  credentials?: ReadinessCredentialLike[];
  training?: ReadinessTrainingLike[];
  /** Explicit restrictions / corrective actions limiting what the employee may do. */
  restrictions?: string[];
  /**
   * Labels of the MANDATORY credentials/training the employee's compliance profile requires (the
   * applicable requirement matrix). Any required item with no matching record on file is treated as
   * missing — an absent required item is a gap, not a silent pass.
   */
  requiredItems?: string[];
}

/** Normalize a label for matching a requirement against an on-file record (case/punctuation-insensitive). */
function normalizeLabel(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export interface ReadinessVerdict {
  status: ReadinessStatus;
  label: string;
  badgeClass: string;
  /** Ordered, plain-language explanation of the verdict (the "why"). */
  reasons: string[];
  /** True when the employee may perform assigned duties (with or without conditions). */
  canWork: boolean;
}

const STATUS_META: Record<ReadinessStatus, { label: string; badgeClass: string }> = {
  ready: { label: "Ready", badgeClass: "bg-success text-success-foreground hover:bg-success/80" },
  conditionally_ready: { label: "Conditionally Ready", badgeClass: "bg-info text-info-foreground hover:bg-info/80" },
  expiring_soon: { label: "Expiring Soon", badgeClass: "bg-warning text-warning-foreground hover:bg-warning/80" },
  incomplete: { label: "Incomplete", badgeClass: "bg-muted text-muted-foreground ring-1 ring-inset ring-destructive/30" },
  restricted: { label: "Restricted", badgeClass: "bg-warning text-warning-foreground hover:bg-warning/80" },
  not_eligible: { label: "Not Eligible", badgeClass: "bg-destructive text-destructive-foreground hover:bg-destructive/80" },
};

export function readinessLabel(status: string): string {
  return (STATUS_META as Record<string, { label: string }>)[status]?.label ?? status;
}

export function readinessBadgeClass(status: string): string {
  return (STATUS_META as Record<string, { badgeClass: string }>)[status]?.badgeClass ?? STATUS_META.incomplete.badgeClass;
}

function credLabel(c: ReadinessCredentialLike): string {
  return (c.label && c.label.trim()) || "A credential/clearance";
}
function trainLabel(t: ReadinessTrainingLike): string {
  return (t.label && t.label.trim()) || "A training requirement";
}
function withExpiry(base: string, date: string | null | undefined, verb: string): string {
  return date ? `${base} ${verb} ${formatDateForDisplay(date)}` : base;
}

function verdict(status: ReadinessStatus, reasons: string[]): ReadinessVerdict {
  return {
    status,
    label: STATUS_META[status].label,
    badgeClass: STATUS_META[status].badgeClass,
    reasons,
    canWork: status !== "not_eligible" && status !== "incomplete",
  };
}

/**
 * Compute an employee's readiness. Worst-case wins, in priority order:
 * not_eligible → restricted → incomplete → conditionally_ready → expiring_soon → ready.
 * Statuses are read from the recalc-maintained values (compliant/due_soon/expired/missing/
 * not_applicable), the same vocabulary credentialAnalytics uses.
 */
export function computeEmployeeReadiness(input: ReadinessInput, today: Date = new Date()): ReadinessVerdict {
  const credentials = input.credentials ?? [];
  const training = input.training ?? [];
  const restrictions = (input.restrictions ?? []).filter((r) => r && r.trim());

  const expiredCreds = credentials.filter((c) => c.status === "expired");
  const missingCreds = credentials.filter((c) => c.status === "missing");
  const dueCreds = credentials.filter((c) => c.status === "due_soon");
  const expiredTraining = training.filter((t) => t.status === "expired");
  const missingTraining = training.filter((t) => t.status === "missing");
  const dueTraining = training.filter((t) => t.status === "due_soon");

  // Applicable requirement matrix: a mandatory requirement with no matching record on file is a gap.
  const requiredItems = (input.requiredItems ?? []).map((r) => r?.trim()).filter((r): r is string => Boolean(r));
  const coveredLabels = new Set([...credentials, ...training].map((r) => normalizeLabel(r.label)).filter(Boolean));
  const missingRequired = requiredItems.filter((req) => !coveredLabels.has(normalizeLabel(req)));

  const inactive = input.employmentStatus != null && BLOCKING_EMPLOYMENT.has(input.employmentStatus.toLowerCase());

  // 1. Not eligible — inactive employment, or a required credential/training has lapsed.
  if (inactive || expiredCreds.length > 0 || expiredTraining.length > 0) {
    const reasons: string[] = [];
    if (inactive) reasons.push(`Employment status is "${input.employmentStatus}".`);
    for (const c of expiredCreds) reasons.push(withExpiry(credLabel(c), c.expiration_date, "expired"));
    for (const t of expiredTraining) reasons.push(`${trainLabel(t)} is expired.`);
    return verdict("not_eligible", reasons);
  }

  // 2. Restricted — an active restriction / corrective action limits duties.
  if (restrictions.length > 0) {
    return verdict("restricted", restrictions.map((r) => r.trim()));
  }

  // 3. Incomplete — nothing on file to establish readiness, a required record is marked missing, or a
  //    mandatory requirement from the compliance profile has no matching record at all. An employee
  //    with no records (and no known requirements) must not read as "Ready" on an empty slate.
  if (credentials.length === 0 && training.length === 0 && requiredItems.length === 0) {
    return verdict("incomplete", ["No credential or training records are on file to establish readiness."]);
  }
  if (missingCreds.length > 0 || missingTraining.length > 0 || missingRequired.length > 0) {
    const reasons: string[] = [];
    for (const c of missingCreds) reasons.push(`${credLabel(c)} is missing.`);
    for (const t of missingTraining) reasons.push(`${trainLabel(t)} is missing.`);
    for (const req of missingRequired) reasons.push(`Required "${req}" has no record on file.`);
    return verdict("incomplete", reasons);
  }

  // 4. Conditionally ready — not cleared for unsupervised duty (may work supervised).
  if (input.clearedForUnsupervisedDuty === false) {
    const reasons = ["Not yet cleared for unsupervised duty — may work under supervision."];
    for (const c of dueCreds) reasons.push(withExpiry(credLabel(c), c.expiration_date, "expires"));
    return verdict("conditionally_ready", reasons);
  }

  // 5. Expiring soon — eligible now, but something renews soon.
  if (dueCreds.length > 0 || dueTraining.length > 0) {
    const reasons: string[] = [];
    for (const c of dueCreds) reasons.push(withExpiry(credLabel(c), c.expiration_date, "expires"));
    for (const t of dueTraining) reasons.push(`${trainLabel(t)} is due soon.`);
    return verdict("expiring_soon", reasons);
  }

  // 6. Ready.
  return verdict("ready", ["All credentials, clearances, and training are current."]);
}

/** True when a credential/training record is within `days` of expiring (for callers deriving due_soon). */
export function isWithinWindow(expirationDate: string | null | undefined, days: number, today: Date = new Date()): boolean {
  const d = daysUntil(expirationDate, today);
  return d !== null && d >= 0 && d <= days;
}
