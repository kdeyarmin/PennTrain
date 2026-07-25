import { describe, expect, it } from "vitest";
import {
  buildIncidentTrends,
  facilityDayOf,
  INVESTIGATION_DUE_DAYS,
  shiftOf,
  type TrendCorrectiveActionLike,
  type TrendIncidentLike,
} from "./incidentTrends";

const NOW = new Date("2026-07-25T12:00:00Z");

function incident(overrides: Partial<TrendIncidentLike> = {}): TrendIncidentLike {
  return {
    id: "i1",
    incident_type: "significant_injury",
    pathway_key: "fall",
    severity: "major",
    status: "investigating",
    occurred_at: "2026-07-20T14:00:00Z", // 10am Eastern -- day shift
    location_detail: "Hallway",
    resident_id: "r1",
    resident_display: "Ellis Resident",
    root_cause: null,
    reportability_status: "not_reportable",
    administrator_approved_at: null,
    closed_at: null,
    ...overrides,
  };
}

function seriesFor(trends: ReturnType<typeof buildIncidentTrends>, key: string) {
  return trends.series.find((entry) => entry.key === key);
}

describe("shift assignment", () => {
  it("places an incident in the shift it happened on, in facility time", () => {
    // 14:00Z is 10am Eastern in July.
    expect(shiftOf("2026-07-20T14:00:00Z")).toBe("day");
    // 20:00Z is 4pm Eastern.
    expect(shiftOf("2026-07-20T20:00:00Z")).toBe("evening");
    // 04:00Z is midnight Eastern -- the previous calendar day locally, and a night shift.
    expect(shiftOf("2026-07-21T04:00:00Z")).toBe("night");
  });

  it("handles the shift boundaries themselves", () => {
    expect(shiftOf("2026-07-20T11:00:00Z")).toBe("day");      // 7am Eastern exactly
    expect(shiftOf("2026-07-20T19:00:00Z")).toBe("evening");  // 3pm Eastern exactly
    expect(shiftOf("2026-07-21T03:00:00Z")).toBe("night");    // 11pm Eastern exactly
  });

  it("returns null rather than guessing on an unparseable timestamp", () => {
    expect(shiftOf("not a date")).toBeNull();
    expect(facilityDayOf("not a date")).toBeNull();
  });

  it("uses the facility day, not the UTC day", () => {
    // 02:00Z on the 21st is 10pm Eastern on the 20th.
    expect(facilityDayOf("2026-07-21T02:00:00Z")).toBe("2026-07-20");
  });
});

describe("every bucket carries its source records", () => {
  it("lists the incident ids behind each bucket, not just a count", () => {
    const trends = buildIncidentTrends({
      incidents: [
        incident({ id: "a" }),
        incident({ id: "b" }),
        incident({ id: "c", occurred_at: "2026-07-20T20:00:00Z" }),
      ],
      correctiveActions: [],
      now: NOW,
    });
    const byShift = seriesFor(trends, "falls_by_shift")!;
    const day = byShift.buckets.find((bucket) => bucket.key === "day")!;
    expect(day.count).toBe(2);
    expect(day.incidentIds.sort()).toEqual(["a", "b"]);
  });

  it("keeps count and ids consistent in every series it produces", () => {
    const trends = buildIncidentTrends({
      incidents: [
        incident({ id: "a", root_cause: "Call bell out of reach" }),
        incident({ id: "b", pathway_key: "skin_tear" }),
        incident({ id: "c", incident_type: "medication_error", pathway_key: "medication_event" }),
        incident({ id: "d", incident_type: "elopement", pathway_key: "elopement" }),
        incident({ id: "e", pathway_key: "behavioral_event", incident_type: "other" }),
        incident({ id: "f", pathway_key: "emergency_transfer" }),
      ],
      correctiveActions: [],
      now: NOW,
    });
    expect(trends.series.length).toBeGreaterThan(0);
    for (const entry of trends.series) {
      for (const bucket of entry.buckets) {
        expect(bucket.incidentIds, `${entry.key}/${bucket.key}`).toHaveLength(bucket.count);
      }
      expect(entry.total).toBe(entry.buckets.reduce((sum, b) => sum + b.count, 0));
    }
  });

  it("orders buckets largest first, because the point is what to look at", () => {
    const trends = buildIncidentTrends({
      incidents: [
        incident({ id: "a", location_detail: "Bathroom" }),
        incident({ id: "b", location_detail: "Hallway" }),
        incident({ id: "c", location_detail: "Hallway" }),
      ],
      correctiveActions: [],
      now: NOW,
    });
    expect(seriesFor(trends, "falls_by_location")!.buckets.map((b) => b.label))
      .toEqual(["Hallway", "Bathroom"]);
  });

  it("drops a series with nothing in it rather than showing an empty chart", () => {
    const trends = buildIncidentTrends({ incidents: [], correctiveActions: [], now: NOW });
    expect(trends.series).toEqual([]);
  });
});

describe("what counts as a fall", () => {
  it("uses the pathway, not the state incident type", () => {
    // Both are significant_injury to the state; only one is a fall.
    const trends = buildIncidentTrends({
      incidents: [incident({ id: "a", pathway_key: "fall" }), incident({ id: "b", pathway_key: "skin_tear" })],
      correctiveActions: [],
      now: NOW,
    });
    expect(seriesFor(trends, "falls_by_shift")!.total).toBe(1);
  });

  it("does not count an incident with no pathway chosen as a fall", () => {
    const trends = buildIncidentTrends({
      incidents: [incident({ id: "a", pathway_key: null })],
      correctiveActions: [],
      now: NOW,
    });
    expect(seriesFor(trends, "falls_by_shift")).toBeUndefined();
  });

  it("separates injury kinds the single state type cannot", () => {
    const trends = buildIncidentTrends({
      incidents: [
        incident({ id: "a", pathway_key: "skin_tear" }),
        incident({ id: "b", pathway_key: "injury" }),
      ],
      correctiveActions: [],
      now: NOW,
    });
    expect(seriesFor(trends, "injuries_by_type")!.buckets.map((b) => b.key).sort())
      .toEqual(["injury", "skin_tear"]);
  });

  it("records an unrecorded fall location as such rather than dropping it", () => {
    const trends = buildIncidentTrends({
      incidents: [incident({ id: "a", location_detail: null })],
      correctiveActions: [],
      now: NOW,
    });
    expect(seriesFor(trends, "falls_by_location")!.buckets[0].label).toBe("Not recorded");
  });
});

describe("repeat residents", () => {
  it("names only residents with more than one incident in the window", () => {
    const trends = buildIncidentTrends({
      incidents: [
        incident({ id: "a", resident_id: "r1", resident_display: "Ellis" }),
        incident({ id: "b", resident_id: "r1", resident_display: "Ellis" }),
        incident({ id: "c", resident_id: "r2", resident_display: "Devon" }),
      ],
      correctiveActions: [],
      now: NOW,
    });
    expect(trends.repeatResidents).toHaveLength(1);
    expect(trends.repeatResidents[0].label).toBe("Ellis");
    expect(trends.repeatResidents[0].incidentIds.sort()).toEqual(["a", "b"]);
  });

  it("ignores incidents with no resident attached", () => {
    const trends = buildIncidentTrends({
      incidents: [
        incident({ id: "a", resident_id: null }),
        incident({ id: "b", resident_id: null }),
      ],
      correctiveActions: [],
      now: NOW,
    });
    expect(trends.repeatResidents).toEqual([]);
  });
});

describe("overdue investigations", () => {
  const old = "2026-07-01T12:00:00Z";

  it("counts an unapproved investigation past the due window", () => {
    const trends = buildIncidentTrends({
      incidents: [incident({ id: "a", occurred_at: old })],
      correctiveActions: [],
      now: NOW,
    });
    expect(trends.overdueInvestigations.count).toBe(1);
    expect(trends.overdueInvestigations.incidentIds).toEqual(["a"]);
    expect(trends.overdueInvestigations.label).toContain(String(INVESTIGATION_DUE_DAYS));
  });

  it("does not count one that was approved, however late", () => {
    const trends = buildIncidentTrends({
      incidents: [incident({ id: "a", occurred_at: old, administrator_approved_at: "2026-07-24T12:00:00Z" })],
      correctiveActions: [],
      now: NOW,
    });
    expect(trends.overdueInvestigations.count).toBe(0);
  });

  it("does not count a closed incident", () => {
    const trends = buildIncidentTrends({
      incidents: [incident({ id: "a", occurred_at: old, status: "closed" })],
      correctiveActions: [],
      now: NOW,
    });
    expect(trends.overdueInvestigations.count).toBe(0);
  });

  it("does not count one still inside the window", () => {
    const trends = buildIncidentTrends({
      incidents: [incident({ id: "a", occurred_at: "2026-07-24T12:00:00Z" })],
      correctiveActions: [],
      now: NOW,
    });
    expect(trends.overdueInvestigations.count).toBe(0);
  });
});

describe("corrective action effectiveness", () => {
  const action = (o: Partial<TrendCorrectiveActionLike> = {}): TrendCorrectiveActionLike => ({
    incident_id: "a", status: "open", due_date: "2026-08-01",
    completed_date: null, verification_notes: null, ...o,
  });

  it("reports nothing rather than zero percent when there are no actions", () => {
    const trends = buildIncidentTrends({ incidents: [], correctiveActions: [], now: NOW });
    expect(trends.correctiveActionEffectiveness.verifiedRate).toBeNull();
  });

  it("counts a completed action as effective only once it is verified", () => {
    const trends = buildIncidentTrends({
      incidents: [],
      correctiveActions: [
        action({ status: "completed", completed_date: "2026-07-20" }),
        action({ status: "completed", completed_date: "2026-07-20", verification_notes: "Audited." }),
      ],
      now: NOW,
    });
    const effect = trends.correctiveActionEffectiveness;
    expect(effect.completed).toBe(2);
    expect(effect.verified).toBe(1);
    expect(effect.verifiedRate).toBe(50);
  });

  it("counts an action past its due date as overdue", () => {
    const trends = buildIncidentTrends({
      incidents: [],
      correctiveActions: [action({ due_date: "2026-07-01" })],
      now: NOW,
    });
    expect(trends.correctiveActionEffectiveness.overdue).toBe(1);
  });

  it("excludes cancelled actions from every figure", () => {
    const trends = buildIncidentTrends({
      incidents: [],
      correctiveActions: [action({ status: "cancelled", due_date: "2026-07-01" })],
      now: NOW,
    });
    const effect = trends.correctiveActionEffectiveness;
    expect(effect.total).toBe(0);
    expect(effect.overdue).toBe(0);
    expect(effect.verifiedRate).toBeNull();
  });
});

describe("root causes", () => {
  it("groups causes that repeat regardless of casing or padding", () => {
    const trends = buildIncidentTrends({
      incidents: [
        incident({ id: "a", root_cause: "Call bell out of reach" }),
        incident({ id: "b", root_cause: "  call bell out of reach  " }),
      ],
      correctiveActions: [],
      now: NOW,
    });
    const causes = seriesFor(trends, "root_causes")!;
    expect(causes.buckets).toHaveLength(1);
    expect(causes.buckets[0].count).toBe(2);
  });

  it("ignores incidents with no root cause recorded", () => {
    const trends = buildIncidentTrends({
      incidents: [incident({ id: "a", root_cause: "   " })],
      correctiveActions: [],
      now: NOW,
    });
    expect(seriesFor(trends, "root_causes")).toBeUndefined();
  });
});
