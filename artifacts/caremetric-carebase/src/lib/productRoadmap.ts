import type { ProductChangelogEntry } from "@/hooks/useProductExperience";

/**
 * Turns the flat, release-date-sorted product changelog (get_product_changelog -- which returns
 * every enabled, changelog-titled release flag to a platform admin) into a month-by-month
 * timeline for the admin roadmap view. This is the live replacement for the old hand-maintained
 * static phase list: what's here is exactly what has actually shipped, straight from release_flags.
 *
 * Pure and deterministic (fixed English month labels, UTC boundaries) so it is unit-testable
 * without a locale/timezone dependency.
 */
export interface RoadmapPeriodGroup {
  /** Stable sort key, e.g. "2026-07". */
  key: string;
  /** Human label, e.g. "July 2026". */
  label: string;
  entries: ProductChangelogEntry[];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Groups changelog entries by the UTC month they were released, most recent month first, with
 * each month's entries sorted newest-first. Entries with an unparseable releasedAt are skipped
 * rather than crashing the view.
 */
export function groupChangelogByPeriod(
  entries: readonly ProductChangelogEntry[],
): RoadmapPeriodGroup[] {
  const groups = new Map<string, RoadmapPeriodGroup>();
  for (const entry of entries) {
    const released = new Date(entry.releasedAt);
    if (Number.isNaN(released.getTime())) continue;
    const year = released.getUTCFullYear();
    const month = released.getUTCMonth();
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, label: `${MONTH_NAMES[month]} ${year}`, entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()]
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
    .map((group) => ({
      ...group,
      entries: [...group.entries].sort((a, b) => (a.releasedAt < b.releasedAt ? 1 : a.releasedAt > b.releasedAt ? -1 : 0)),
    }));
}

/** Count of shipped capabilities and the most recent release date (or null when empty). */
export function changelogSummary(entries: readonly ProductChangelogEntry[]): {
  total: number;
  latestReleasedAt: string | null;
} {
  let latest: string | null = null;
  for (const entry of entries) {
    if (latest === null || entry.releasedAt > latest) latest = entry.releasedAt;
  }
  return { total: entries.length, latestReleasedAt: latest };
}
