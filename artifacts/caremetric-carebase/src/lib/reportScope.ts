/**
 * What a compliance report's figures were actually computed over, stated where the reader can see
 * it (BACKLOG.md J80).
 *
 * The Dashboard's "Overall compliance" and the Reports "Compliance Summary" disagreed for years
 * partly because neither said what it was counting, so there was nothing on either screen a reader
 * could compare. `20260906170000` made the report count the same population the dashboard does --
 * the CURRENT record per employee and training type, for active non-synthetic employees at
 * non-sandbox facilities -- and this is the other half of that: a printed report that carries its
 * own denominator, so "72%" can be checked rather than argued with.
 *
 * Kept out of the report RPC deliberately: the filters the reader cares about include the ones the
 * READER set (facility, date window), which only the page knows.
 */

/**
 * Reports whose headline figures are a population count, not a row listing, and which the
 * current-record rule therefore governs. Both are computed by
 * `generate_paged_compliance_report`'s summary branches.
 */
const POPULATION_SCOPED_REPORTS = new Set(["compliance-summary", "facility-compliance"]);

export interface ReportScopeInput {
  reportId: string;
  /** The chosen facility's name, or undefined for every facility the caller can see. */
  facilityName?: string;
  dateFrom?: string;
  dateTo?: string;
  /** What the report's date window filters on, e.g. "Due Date". Null when it takes no dates. */
  dateFieldLabel?: string | null;
  /** Formats a YYYY-MM-DD for display; injected so this stays free of date-library choices. */
  formatDate: (isoDate: string) => string;
}

/**
 * One line per filter, in the order a reader checks them: who is counted, then where, then when.
 * Returns an empty array when there is nothing worth stating.
 */
export function reportScopeLines(input: ReportScopeInput): string[] {
  const lines: string[] = [];
  if (POPULATION_SCOPED_REPORTS.has(input.reportId)) {
    lines.push(
      "Counts the current record per employee and training type — a renewed requirement is counted once, not once per cycle.",
    );
    lines.push("Active, non-synthetic employees at non-sandbox facilities.");
  }
  lines.push(input.facilityName ? `Facility: ${input.facilityName}.` : "All facilities you can access.");
  if (input.dateFieldLabel) {
    const { dateFrom, dateTo, formatDate } = input;
    if (dateFrom && dateTo) {
      lines.push(`${input.dateFieldLabel} between ${formatDate(dateFrom)} and ${formatDate(dateTo)}.`);
    } else if (dateFrom) {
      lines.push(`${input.dateFieldLabel} on or after ${formatDate(dateFrom)}.`);
    } else if (dateTo) {
      lines.push(`${input.dateFieldLabel} on or before ${formatDate(dateTo)}.`);
    } else {
      lines.push(`No ${input.dateFieldLabel.toLowerCase()} limit.`);
    }
  }
  return lines;
}
