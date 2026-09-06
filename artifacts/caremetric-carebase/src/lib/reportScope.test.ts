import { describe, expect, it } from "vitest";
import { reportScopeLines } from "./reportScope";

const formatDate = (isoDate: string) => isoDate;

describe("reportScopeLines", () => {
  it("states the current-record rule on the reports whose figures depend on it", () => {
    const lines = reportScopeLines({
      reportId: "compliance-summary",
      dateFieldLabel: "Due Date",
      formatDate,
    });
    expect(lines[0]).toContain("current record per employee and training type");
    expect(lines[1]).toContain("Active, non-synthetic employees");
    expect(lines).toContain("All facilities you can access.");
    expect(lines).toContain("No due date limit.");
  });

  it("covers the per-facility table too, which counts the same population", () => {
    expect(reportScopeLines({ reportId: "facility-compliance", formatDate })[0])
      .toContain("current record per employee and training type");
  });

  it("says nothing about population on a report that lists rows rather than counting them", () => {
    const lines = reportScopeLines({
      reportId: "expired-training",
      facilityName: "Sunrise Manor",
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
      dateFieldLabel: "Due Date",
      formatDate,
    });
    expect(lines).toEqual([
      "Facility: Sunrise Manor.",
      "Due Date between 2026-01-01 and 2026-06-30.",
    ]);
  });

  it("states a one-sided window as one-sided", () => {
    expect(reportScopeLines({ reportId: "due-soon", dateFrom: "2026-01-01", dateFieldLabel: "Due Date", formatDate }))
      .toContain("Due Date on or after 2026-01-01.");
    expect(reportScopeLines({ reportId: "due-soon", dateTo: "2026-06-30", dateFieldLabel: "Due Date", formatDate }))
      .toContain("Due Date on or before 2026-06-30.");
  });

  it("omits the date line entirely for a report that takes no dates", () => {
    const lines = reportScopeLines({ reportId: "training-matrix", dateFieldLabel: null, formatDate });
    expect(lines).toEqual(["All facilities you can access."]);
  });
});
