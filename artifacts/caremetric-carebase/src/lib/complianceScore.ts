/**
 * One definition of "compliance percentage", for every surface that shows one (BACKLOG.md J80).
 *
 * WHAT WENT WRONG. The Dashboard's "Overall compliance" and the Reports "Compliance Summary"
 * answered the same question two different ways. `get_org_dashboard_summary` counts the CURRENT
 * record per (employee, training type); `generate_paged_compliance_report` counted every row. A
 * renewal inserts a fresh `employee_training_records` row and leaves the prior one graded
 * 'expired' forever (see `currentTrainingRecords.ts`), so the renewed employee contributed last
 * cycle's expired row AND this cycle's compliant one -- and a facility that renewed everything
 * scored WORSE than one that let its records lapse. `20260906170000` gave the report the
 * dashboard's current-record ordering, so the two RPCs now agree.
 *
 * WHY THIS FILE EXISTS ANYWAY. The client computes the same score in its own right (the facility
 * record is graded from rows the page already holds), and it did so with an inline copy of the
 * rule sitting next to a call to `selectCurrentTrainingRecords`. An inline copy is how the two
 * server readers drifted in the first place. The rule lives here now, once, and it drops
 * superseded rows before it counts anything -- which is the property the defect was about, and
 * the one `complianceScore.test.ts` pins.
 *
 * The tracked-status set and the empty-set answer (100, not 0) match the SQL exactly, so a number
 * produced here is comparable with one produced there rather than merely similar.
 */
import { selectCurrentTrainingRecords, type CurrentTrainingRecordLike } from "./currentTrainingRecords";

/**
 * The four statuses that represent a real, dated obligation. `not_applicable` and
 * `pending_review` sit outside the compliant-vs-not split entirely and must not enter the
 * denominator -- matching `count(*) filter (where status in (...))` in both RPCs.
 */
export const TRACKED_COMPLIANCE_STATUSES = ["compliant", "due_soon", "expired", "missing"] as const;

const TRACKED = new Set<string>(TRACKED_COMPLIANCE_STATUSES);

export interface ComplianceCounts {
  /** Tracked obligations after superseded history is dropped. The denominator. */
  total: number;
  compliant: number;
  dueSoon: number;
  expired: number;
  missing: number;
  /** compliant / total, rounded. 100 when nothing is tracked, as both RPCs answer. */
  compliancePercentage: number;
}

/**
 * The percentage itself, for callers whose counts already come from a deduped source (the
 * dashboard RPC) rather than from rows. Same rounding and same empty-set answer as
 * `summarizeCurrentTrainingCompliance`, so the two entry points cannot disagree.
 */
export function compliancePercentage(compliant: number, total: number): number {
  return total > 0 ? Math.round((compliant / total) * 100) : 100;
}

/**
 * Grade raw `employee_training_records` rows.
 *
 * Superseded history is dropped FIRST -- one current record per (employee, training type) -- so a
 * renewed requirement contributes its renewal and nothing else.
 */
export function summarizeCurrentTrainingCompliance<
  T extends CurrentTrainingRecordLike & { status: string },
>(records: T[]): ComplianceCounts {
  const tracked = selectCurrentTrainingRecords(records).filter((record) => TRACKED.has(record.status));
  const counts = {
    total: tracked.length,
    compliant: tracked.filter((record) => record.status === "compliant").length,
    dueSoon: tracked.filter((record) => record.status === "due_soon").length,
    expired: tracked.filter((record) => record.status === "expired").length,
    missing: tracked.filter((record) => record.status === "missing").length,
  };
  return { ...counts, compliancePercentage: compliancePercentage(counts.compliant, counts.total) };
}

export type ComplianceBandTone = "success" | "warning" | "danger" | "unknown";

export interface ComplianceBand {
  tone: ComplianceBandTone;
  label: string;
}

/**
 * The shared reading of a score. The Dashboard donut and its caption used two separate inline
 * threshold ladders written next to each other; one drifting from the other would have coloured
 * the ring and named the band differently on the same number.
 */
export function complianceBand(percentage: number | null | undefined): ComplianceBand {
  if (percentage == null) return { tone: "unknown", label: "—" };
  if (percentage >= 90) return { tone: "success", label: "Excellent" };
  if (percentage >= 75) return { tone: "warning", label: "Needs Improvement" };
  return { tone: "danger", label: "At Risk" };
}

const BAND_TEXT_CLASS: Record<ComplianceBandTone, string> = {
  success: "text-emerald-600",
  warning: "text-amber-600",
  danger: "text-red-600",
  unknown: "text-muted-foreground",
};

export function complianceBandTextClass(percentage: number | null | undefined): string {
  return BAND_TEXT_CLASS[complianceBand(percentage).tone];
}
