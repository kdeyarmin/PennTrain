import { describe, expect, it } from "vitest";
import {
  type ExclusionCoverageSource,
  summarizeExclusionCoverage,
} from "./exclusionScreeningCoverage";

const on = (iso: string) => iso.slice(0, 10);

function source(overrides: Partial<ExclusionCoverageSource> & { source: string }): ExclusionCoverageSource {
  return {
    health_status: "healthy",
    active_snapshot_id: "snap-1",
    active_since: "2026-07-12T17:30:22Z",
    active_record_count: 80192,
    ...overrides,
  };
}

describe("summarizeExclusionCoverage", () => {
  it("names the source, its snapshot date and its size", () => {
    const coverage = summarizeExclusionCoverage(
      [source({ source: "oig_leie" }), source({ source: "sam_exclusions", active_record_count: 12 })],
      on,
    );
    expect(coverage.hasGap).toBe(false);
    expect(coverage.sentence).toBe(
      "Screened against OIG LEIE (snapshot 2026-07-12, 80,192 records) and SAM.gov (snapshot 2026-07-12, 12 records).",
    );
  });

  it("qualifies the result when a source has never been loaded", () => {
    // This deployment: no SAM_GOV_API_KEY, so sam_exclusions is not_loaded. An unqualified
    // "no matches" here would be a clean bill of health for a source nobody consulted.
    const coverage = summarizeExclusionCoverage(
      [
        source({ source: "oig_leie" }),
        source({ source: "sam_exclusions", health_status: "not_loaded", active_snapshot_id: null, active_since: null, active_record_count: null }),
      ],
      on,
    );
    expect(coverage.hasGap).toBe(true);
    expect(coverage.screened.map((s) => s.source)).toEqual(["oig_leie"]);
    expect(coverage.unscreened.map((s) => s.source)).toEqual(["sam_exclusions"]);
    expect(coverage.sentence).toBe(
      "Screened against OIG LEIE (snapshot 2026-07-12, 80,192 records). "
        + "SAM.gov was not screened because it has never been loaded for this deployment, so nothing here reflects it.",
    );
  });

  it("says a snapshot is stale in the same breath as the result", () => {
    const coverage = summarizeExclusionCoverage(
      [source({ source: "oig_leie", health_status: "stale" })],
      on,
    );
    expect(coverage.screened[0].stale).toBe(true);
    expect(coverage.sentence).toContain("past its freshness window");
  });

  it("still counts a source as screened when its latest refresh failed but a snapshot is active", () => {
    // fail_exclusion_source_refresh never touches the active pointer, and the page says so:
    // "The prior snapshot remains active while this failure is investigated." Screening really did
    // happen, against that older snapshot -- calling it unscreened would be wrong in the other
    // direction.
    const coverage = summarizeExclusionCoverage(
      [source({ source: "oig_leie", health_status: "failed" })],
      on,
    );
    expect(coverage.hasGap).toBe(false);
    expect(coverage.sentence).toBe("Screened against OIG LEIE (snapshot 2026-07-12, 80,192 records).");
  });

  it("reports a failed source with no active snapshot as unscreened, with the reason", () => {
    const coverage = summarizeExclusionCoverage(
      [source({ source: "oig_leie", health_status: "failed", active_snapshot_id: null, active_since: null, active_record_count: null })],
      on,
    );
    expect(coverage.screened).toEqual([]);
    expect(coverage.sentence).toBe(
      "No exclusion source has an active snapshot, so this roster has not been screened. OIG LEIE is unavailable.",
    );
  });

  it("does not claim screening before the health query has returned", () => {
    expect(summarizeExclusionCoverage(undefined, on).sentence).toBe(
      "No exclusion source is configured, so no screening has taken place.",
    );
    expect(summarizeExclusionCoverage([], on).hasGap).toBe(true);
  });
});
