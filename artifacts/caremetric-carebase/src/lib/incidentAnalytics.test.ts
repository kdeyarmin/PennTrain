import { describe, expect, it } from "vitest";
import { summarizeIncidentAnalytics } from "./incidentAnalytics";

describe("summarizeIncidentAnalytics", () => {
  it("summarizes open incident pressure and recent volume", () => {
    const summary = summarizeIncidentAnalytics([
      { id: "old-open", incident_type: "fall", severity: "major", status: "investigating", occurred_at: "2026-06-01T12:00:00Z" },
      { id: "critical", incident_type: "fall", severity: "critical", status: "reported", occurred_at: "2026-07-08T12:00:00Z" },
      { id: "closed", incident_type: "medication_error", severity: "minor", status: "closed", occurred_at: "2026-07-05T12:00:00Z" },
    ], "2026-07-10");

    expect(summary).toMatchObject({ open: 2, criticalOpen: 1, majorOrCritical: 2, reportedLast7Days: 2, reportedLast30Days: 2 });
    expect(summary.oldestOpenIncidentId).toBe("old-open");
    expect(summary.topIncidentType).toBe("fall");
  });
});
