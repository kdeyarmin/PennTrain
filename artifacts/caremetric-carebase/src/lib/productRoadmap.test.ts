import { describe, expect, it } from "vitest";
import { changelogSummary, groupChangelogByPeriod } from "./productRoadmap";
import type { ProductChangelogEntry } from "@/hooks/useProductExperience";

function entry(featureKey: string, releasedAt: string): ProductChangelogEntry {
  return {
    featureKey,
    title: `Feature ${featureKey}`,
    summary: `Summary for ${featureKey}`,
    helpPath: null,
    releasedAt,
    isUnread: false,
  };
}

describe("groupChangelogByPeriod", () => {
  it("groups entries by UTC month, most recent month first", () => {
    const groups = groupChangelogByPeriod([
      entry("a", "2026-07-20T12:00:00Z"),
      entry("b", "2026-06-01T09:00:00Z"),
      entry("c", "2026-07-02T08:00:00Z"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2026-07", "2026-06"]);
    expect(groups[0].label).toBe("July 2026");
    expect(groups[1].label).toBe("June 2026");
    expect(groups[0].entries.map((e) => e.featureKey)).toEqual(["a", "c"]); // newest-first within month
  });

  it("returns an empty array for no entries", () => {
    expect(groupChangelogByPeriod([])).toEqual([]);
  });

  it("skips entries with an unparseable release date instead of throwing", () => {
    const groups = groupChangelogByPeriod([
      entry("good", "2026-05-10T00:00:00Z"),
      entry("bad", "not-a-date"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.featureKey)).toEqual(["good"]);
  });

  it("uses UTC boundaries so a late-UTC-month release lands in that UTC month", () => {
    const groups = groupChangelogByPeriod([entry("edge", "2026-01-31T23:30:00Z")]);
    expect(groups[0].key).toBe("2026-01");
    expect(groups[0].label).toBe("January 2026");
  });
});

describe("changelogSummary", () => {
  it("reports total and latest release date", () => {
    const summary = changelogSummary([
      entry("a", "2026-07-20T12:00:00Z"),
      entry("b", "2026-06-01T09:00:00Z"),
    ]);
    expect(summary.total).toBe(2);
    expect(summary.latestReleasedAt).toBe("2026-07-20T12:00:00Z");
  });

  it("returns a null latest date when empty", () => {
    expect(changelogSummary([])).toEqual({ total: 0, latestReleasedAt: null });
  });
});
