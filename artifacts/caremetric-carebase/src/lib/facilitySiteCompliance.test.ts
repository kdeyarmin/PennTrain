import { describe, expect, it } from "vitest";
import { drillWeekdayRotation, siteDeadlines } from "./facilitySiteCompliance";

describe("site evidence deadlines", () => {
  it("keeps the withdrawal anchor and 48 elapsed hours across daylight saving", () => {
    const row = { review_type: "fire_approval", event_kind: "withdrawn", occurred_at: "2026-10-31T16:00:00Z", next_review_on: null, details: { oral_notified_at: "2026-10-31T16:00:00Z", written_notified_at: "2026-11-02T16:00:01Z" } };
    const deadlines = siteDeadlines(row);
    expect(deadlines[0].late).toBe(false);
    expect(deadlines[1].due).toBe("2026-11-02T16:00:00.000Z");
    expect(deadlines[1].late).toBe(true);
  });
  it("measures renovation submission in Pennsylvania calendar days", () => {
    const deadlines = siteDeadlines({ review_type: "fire_approval", event_kind: "renovation", occurred_at: "2026-09-27T02:00:00Z", next_review_on: null, details: { submitted_at: "2026-10-12T03:59:00Z" } });
    expect(deadlines[0].due).toBe("2026-10-11");
    expect(deadlines[0].late).toBe(false);
  });
  it("reports missing immediate notice as overdue and retains overdue document copies", () => {
    expect(siteDeadlines({ review_type: "fire_approval", event_kind: "restricted", occurred_at: "2026-01-01T12:00:00Z", next_review_on: null, details: {} }, new Date("2026-01-01T12:00:01Z"))[0].late).toBe(true);
    expect(siteDeadlines({ review_type: "vehicle_documents", event_kind: "review", occurred_at: "2026-01-01T12:00:00Z", next_review_on: "2026-01-10", details: {} }, new Date("2026-01-11T16:00:00Z"))[0].late).toBe(true);
  });
});

describe("drill rotation", () => {
  it("uses date-only weekdays, counts unsuccessful attempts too, and detects repeated days", () => {
    const rotation = drillWeekdayRotation([{ performed_date: "2026-09-26" }, { performed_date: "2026-09-19" }, { performed_date: "2026-09-01" }]);
    expect(rotation.counts).toEqual([0, 0, 1, 0, 0, 0, 2]);
    expect(rotation.latestRepeatedWeekday).toBe(true);
    expect(drillWeekdayRotation([]).latestRepeatedWeekday).toBe(false);
  });
});
