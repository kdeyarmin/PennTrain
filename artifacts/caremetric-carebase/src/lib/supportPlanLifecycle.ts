/**
 * Support-plan lifecycle and version comparison (program plan Phase 2c).
 *
 * The legal transition table here MIRRORS `app_private.support_plan_transition_allowed` in
 * 20260726020000. The server is the authority -- this copy exists so the UI can offer only the moves
 * that will actually succeed, not so it can decide them. If the two ever disagree, the server wins
 * and this file is the bug.
 */

export type SupportPlanState =
  | "draft"
  | "awaiting_clinical_review"
  | "awaiting_participation"
  | "awaiting_signature"
  | "approved"
  | "active"
  | "revision_required"
  | "superseded"
  | "closed";

export const SUPPORT_PLAN_STATES: SupportPlanState[] = [
  "draft",
  "awaiting_clinical_review",
  "awaiting_participation",
  "awaiting_signature",
  "approved",
  "active",
  "revision_required",
  "superseded",
  "closed",
];

export const SUPPORT_PLAN_STATE_LABELS: Record<SupportPlanState, string> = {
  draft: "Draft",
  awaiting_clinical_review: "Awaiting clinical review",
  awaiting_participation: "Awaiting resident participation",
  awaiting_signature: "Awaiting signature",
  approved: "Approved",
  active: "Active",
  revision_required: "Revision required",
  superseded: "Superseded",
  closed: "Closed",
};

/** What each state means operationally, shown next to the badge so the name is not the only clue. */
export const SUPPORT_PLAN_STATE_DESCRIPTIONS: Record<SupportPlanState, string> = {
  draft: "Being written. Nothing downstream depends on it yet.",
  awaiting_clinical_review: "Submitted for clinical review before the resident is involved.",
  awaiting_participation: "Waiting on the resident and designated person to take part in developing it.",
  awaiting_signature: "Participation recorded; waiting on the signature or a documented refusal.",
  approved: "Signed off, not yet in force.",
  active: "In force. Staff tasks are generated from this version.",
  revision_required: "Sent back for rework with a recorded reason.",
  superseded: "Replaced by a newer version.",
  closed: "No longer in the lifecycle.",
};

/**
 * Mirrors the server's transition table exactly. `active` is deliberately absent as a target:
 * putting a plan in force also generates service requirements, so it goes through the approval RPC
 * rather than the generic transition.
 */
const ALLOWED_TRANSITIONS: Record<SupportPlanState, SupportPlanState[]> = {
  draft: ["awaiting_clinical_review", "closed"],
  awaiting_clinical_review: ["awaiting_participation", "revision_required"],
  awaiting_participation: ["awaiting_signature", "revision_required"],
  awaiting_signature: ["approved", "revision_required"],
  approved: ["revision_required"],
  active: ["revision_required", "closed"],
  revision_required: ["draft", "closed"],
  superseded: ["closed"],
  closed: [],
};

/** Transitions that cannot proceed without a recorded reason. */
const REASON_REQUIRED: SupportPlanState[] = ["revision_required"];

export function isSupportPlanState(value: string): value is SupportPlanState {
  return (SUPPORT_PLAN_STATES as string[]).includes(value);
}

export function supportPlanStateLabel(state: string): string {
  return isSupportPlanState(state) ? SUPPORT_PLAN_STATE_LABELS[state] : state;
}

export function allowedSupportPlanTransitions(from: string): SupportPlanState[] {
  return isSupportPlanState(from) ? ALLOWED_TRANSITIONS[from] : [];
}

export function canTransitionSupportPlan(from: string, to: string): boolean {
  return isSupportPlanState(to) && allowedSupportPlanTransitions(from).includes(to);
}

export function transitionRequiresReason(to: string): boolean {
  return isSupportPlanState(to) && REASON_REQUIRED.includes(to);
}

/** States where the plan is still being worked on rather than in force or finished. */
export function isSupportPlanInFlight(state: string): boolean {
  return ["draft", "awaiting_clinical_review", "awaiting_participation", "awaiting_signature", "approved", "revision_required"]
    .includes(state);
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/**
 * A plan's needs/goals/services/interventions are jsonb arrays of loosely-shaped objects. The diff
 * is computed from stored content rather than from a stored diff, so correcting a version's content
 * corrects its comparison too.
 */
export type PlanSection = "needs" | "goals" | "services" | "interventions";

export const PLAN_SECTIONS: PlanSection[] = ["needs", "goals", "services", "interventions"];

export const PLAN_SECTION_LABELS: Record<PlanSection, string> = {
  needs: "Needs",
  goals: "Goals",
  services: "Services",
  interventions: "Interventions",
};

export interface PlanEntry {
  [key: string]: unknown;
}

export interface PlanLike {
  version_number: number;
  needs?: unknown;
  goals?: unknown;
  services?: unknown;
  interventions?: unknown;
}

export type PlanChangeKind = "added" | "removed" | "modified" | "unchanged";

export interface PlanFieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface PlanEntryDiff {
  key: string;
  label: string;
  kind: PlanChangeKind;
  fieldChanges: PlanFieldChange[];
}

export interface PlanSectionDiff {
  section: PlanSection;
  label: string;
  entries: PlanEntryDiff[];
  added: number;
  removed: number;
  modified: number;
}

export interface PlanVersionDiff {
  fromVersion: number | null;
  toVersion: number;
  sections: PlanSectionDiff[];
  totalChanges: number;
}

function asEntries(value: unknown): PlanEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is PlanEntry => typeof entry === "object" && entry !== null && !Array.isArray(entry));
}

/**
 * Identity for matching an entry across versions. Prefers an explicit key, then a service/need code,
 * then the human label. Two entries that share none of these are treated as distinct, which errs
 * toward showing an add plus a remove rather than inventing a modification that did not happen.
 */
function entryKey(entry: PlanEntry, index: number): string {
  for (const field of ["key", "id", "service_code", "code", "need_key"]) {
    const value = entry[field];
    if (typeof value === "string" && value.trim()) return `${field}:${value.trim()}`;
  }
  const label = entryLabel(entry);
  return label ? `label:${label.toLowerCase()}` : `index:${index}`;
}

function entryLabel(entry: PlanEntry): string {
  for (const field of ["service_name", "name", "title", "need", "description", "intervention", "goal"]) {
    const value = entry[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function scalarString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Objects and arrays are compared by stable serialization: it is better to report "this nested
  // block changed" than to silently treat two different structures as equal.
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function diffFields(before: PlanEntry, after: PlanEntry): PlanFieldChange[] {
  const fields = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  const changes: PlanFieldChange[] = [];
  for (const field of fields) {
    const from = scalarString(before[field]);
    const to = scalarString(after[field]);
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}

function diffSection(section: PlanSection, before: unknown, after: unknown): PlanSectionDiff {
  const beforeEntries = asEntries(before);
  const afterEntries = asEntries(after);
  const beforeByKey = new Map(beforeEntries.map((entry, index) => [entryKey(entry, index), entry]));
  const afterByKey = new Map(afterEntries.map((entry, index) => [entryKey(entry, index), entry]));

  const entries: PlanEntryDiff[] = [];
  // Walk the new version first so the comparison reads in the order the current plan presents.
  for (const [key, entry] of afterByKey) {
    const prior = beforeByKey.get(key);
    if (!prior) {
      entries.push({ key, label: entryLabel(entry) || key, kind: "added", fieldChanges: [] });
      continue;
    }
    const fieldChanges = diffFields(prior, entry);
    entries.push({
      key,
      label: entryLabel(entry) || key,
      kind: fieldChanges.length ? "modified" : "unchanged",
      fieldChanges,
    });
  }
  for (const [key, entry] of beforeByKey) {
    if (afterByKey.has(key)) continue;
    entries.push({ key, label: entryLabel(entry) || key, kind: "removed", fieldChanges: [] });
  }

  return {
    section,
    label: PLAN_SECTION_LABELS[section],
    entries,
    added: entries.filter((entry) => entry.kind === "added").length,
    removed: entries.filter((entry) => entry.kind === "removed").length,
    modified: entries.filter((entry) => entry.kind === "modified").length,
  };
}

/**
 * Compare two plan versions. `before` may be null for the first version, which reports everything as
 * added rather than as an empty diff -- "nothing changed" would be actively misleading for a v1.
 */
export function diffSupportPlanVersions(before: PlanLike | null, after: PlanLike): PlanVersionDiff {
  const sections = PLAN_SECTIONS.map((section) =>
    diffSection(section, before ? before[section] : [], after[section]));
  return {
    fromVersion: before?.version_number ?? null,
    toVersion: after.version_number,
    sections,
    totalChanges: sections.reduce((sum, section) => sum + section.added + section.removed + section.modified, 0),
  };
}

/** One-line summary for a version row, e.g. "3 added, 1 changed". */
export function summarizePlanDiff(diff: PlanVersionDiff): string {
  const added = diff.sections.reduce((sum, section) => sum + section.added, 0);
  const removed = diff.sections.reduce((sum, section) => sum + section.removed, 0);
  const modified = diff.sections.reduce((sum, section) => sum + section.modified, 0);
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  if (modified) parts.push(`${modified} changed`);
  return parts.length ? parts.join(", ") : "No changes";
}

/**
 * True when an approved plan's effective date has already passed -- meaning the scheduled promotion
 * (`activate_due_support_plans`, run by pg_cron) has not run.
 *
 * Mirrors the server's condition in `activate_due_support_plan` rather than re-deciding it: the
 * server refuses a plan that is not yet due, so a UI that offered the action more widely would only
 * produce errors. Date-only comparison, matching the server's `effective_date <= current_date`.
 */
export function isActivationOverdue(
  effectiveDate: string | null | undefined,
  today: Date = new Date(),
): boolean {
  if (!effectiveDate) return false;
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Split rather than `new Date(effectiveDate)`: a bare "YYYY-MM-DD" parses as UTC midnight, which
  // is the previous day west of Greenwich -- so a plan effective today would read as overdue.
  const [year, month, day] = effectiveDate.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return false;
  return new Date(year, month - 1, day) <= localToday;
}
