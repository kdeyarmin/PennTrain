// What a screening result actually covers.
//
// The page asserted "OIG LEIE / SAM.gov exclusion-list matches against your roster" unconditionally,
// and an empty queue read "No matches in this queue." Both are claims about two sources. In this
// deployment SAM.gov has never been loaded -- there is no SAM_GOV_API_KEY, exclusion_source_state
// reports sam_exclusions as not_loaded, and the roster has never been checked against it. So a
// clean screening page said "clear" about a source it had never consulted.
//
// That is the kind of statement a surveyor reads as evidence. It has to name what it checked, when
// that snapshot was taken, and what it did not check (BACKLOG.md I27).

export interface ExclusionCoverageSource {
  source: string;
  health_status: "healthy" | "stale" | "failed" | "not_loaded";
  active_snapshot_id: string | null;
  active_since: string | null;
  active_record_count: number | null;
}

export interface ScreenedSource {
  source: string;
  label: string;
  activeSince: string | null;
  recordCount: number | null;
  stale: boolean;
}

export interface UnscreenedSource {
  source: string;
  label: string;
  reason: string;
}

export interface ExclusionCoverage {
  screened: ScreenedSource[];
  unscreened: UnscreenedSource[];
  // One sentence fit to sit under a heading or beside an empty queue.
  sentence: string;
  // True when at least one configured source contributed nothing, so a caller can decide whether
  // an all-clear needs qualifying.
  hasGap: boolean;
}

export const EXCLUSION_SOURCE_LABELS: Record<string, string> = {
  oig_leie: "OIG LEIE",
  sam_exclusions: "SAM.gov",
};

export function exclusionSourceLabel(source: string): string {
  return EXCLUSION_SOURCE_LABELS[source] ?? source;
}

function unscreenedReason(row: ExclusionCoverageSource): string {
  // A failed refresh with an active snapshot still screens -- against the older snapshot -- which
  // is why this keys on whether a snapshot is active rather than on health_status alone.
  if (row.health_status === "failed") return "its last refresh failed and no earlier snapshot is active";
  return "it has never been loaded for this deployment";
}

export function summarizeExclusionCoverage(
  rows: ExclusionCoverageSource[] | null | undefined,
  formatDate: (iso: string) => string,
): ExclusionCoverage {
  const screened: ScreenedSource[] = [];
  const unscreened: UnscreenedSource[] = [];

  for (const row of rows ?? []) {
    const label = exclusionSourceLabel(row.source);
    if (row.active_snapshot_id) {
      screened.push({
        source: row.source,
        label,
        activeSince: row.active_since,
        recordCount: row.active_record_count,
        stale: row.health_status === "stale",
      });
    } else {
      unscreened.push({ source: row.source, label, reason: unscreenedReason(row) });
    }
  }

  const hasGap = unscreened.length > 0;

  if (screened.length === 0) {
    return {
      screened,
      unscreened,
      sentence: unscreened.length === 0
        ? "No exclusion source is configured, so no screening has taken place."
        : `No exclusion source has an active snapshot, so this roster has not been screened. `
          + `${listOf(unscreened.map((s) => s.label))} ${unscreened.length === 1 ? "is" : "are"} unavailable.`,
      hasGap: true,
    };
  }

  const screenedParts = screened.map((entry) => {
    const details: string[] = [];
    if (entry.activeSince) details.push(`snapshot ${formatDate(entry.activeSince)}`);
    if (typeof entry.recordCount === "number") details.push(`${entry.recordCount.toLocaleString()} records`);
    const suffix = details.length ? ` (${details.join(", ")})` : "";
    // Stale is said here rather than left to the freshness cards: a reader looking at the result
    // should not have to scroll to another card to learn the snapshot is out of date.
    return `${entry.label}${suffix}${entry.stale ? ", past its freshness window" : ""}`;
  });

  let sentence = `Screened against ${listOf(screenedParts)}.`;
  if (hasGap) {
    for (const gap of unscreened) {
      sentence += ` ${gap.label} was not screened because ${gap.reason}, so nothing here reflects it.`;
    }
  }

  return { screened, unscreened, sentence, hasGap };
}

function listOf(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
