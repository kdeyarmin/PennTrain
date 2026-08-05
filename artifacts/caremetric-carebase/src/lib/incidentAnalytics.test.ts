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

// An incident reported at 20:30 in Pennsylvania is 00:30Z the NEXT day. Ending the window at a
// literal T23:59:59Z put it ahead of "the end of today", so daysSince returned -1 and the
// `days >= 0` filters dropped it -- understating the counts for the freshest, most likely still
// unresolved incidents.
it("counts an incident reported this evening in Pennsylvania", () => {
  const summary = summarizeIncidentAnalytics([
    { id: "tonight", incident_type: "fall", severity: "major", status: "reported", occurred_at: "2026-07-11T00:30:00Z" },
  ], "2026-07-10");
  expect(summary.reportedLast7Days).toBe(1);
  expect(summary.reportedLast30Days).toBe(1);
});

// Reviewed on #458: elapsed-ms arithmetic is not a calendar-day count. Pennsylvania's November
// fall-back makes one day 25 hours long, so an incident seven facility dates old measured 8 and
// fell out of an inclusive `<= 7` window for about a week after every transition.
it("counts a seven-day-old incident across the fall-back transition", () => {
  const summary = summarizeIncidentAnalytics(
    // 00:30 EDT on 2026-10-27 == 04:30Z. Seven facility dates before 2026-11-03.
    [{ id: "dst", status: "open", severity: "major", incident_type: "fall", occurred_at: "2026-10-27T04:30:00Z" }],
    "2026-11-03",
  );
  expect(summary.reportedLast7Days).toBe(1);
  expect(summary.reportedLast30Days).toBe(1);
});

it("still excludes an incident that is genuinely outside the window", () => {
  const summary = summarizeIncidentAnalytics(
    [{ id: "old", status: "open", severity: "major", incident_type: "fall", occurred_at: "2026-10-26T04:30:00Z" }],
    "2026-11-03",
  );
  expect(summary.reportedLast7Days).toBe(0);
  expect(summary.reportedLast30Days).toBe(1);
});

