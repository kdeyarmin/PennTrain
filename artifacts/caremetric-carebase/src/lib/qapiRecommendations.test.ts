import { describe, expect, it } from "vitest";
import { buildIncidentTrends, type TrendIncidentLike } from "./incidentTrends";
import {
  buildQapiRecommendations, QAPI_THRESHOLDS, type QapiRecommendationKey,
} from "./qapiRecommendations";

const NOW = new Date("2026-07-25T12:00:00Z");
const WINDOW = "the last 90 days";

function incident(id: string, overrides: Partial<TrendIncidentLike> = {}): TrendIncidentLike {
  return {
    id,
    incident_type: "significant_injury",
    pathway_key: "fall",
    severity: "major",
    status: "investigating",
    occurred_at: "2026-07-20T14:00:00Z", // day shift
    location_detail: "Hallway",
    resident_id: "r1",
    resident_display: "Ellis Resident",
    root_cause: null,
    reportability_status: "not_reportable",
    administrator_approved_at: "2026-07-21T12:00:00Z",
    closed_at: null,
    ...overrides,
  };
}

function recommend(
  incidents: TrendIncidentLike[],
  extras: Parameters<typeof buildQapiRecommendations>[0] extends never ? never : {
    correctiveActions?: Parameters<typeof buildIncidentTrends>[0]["correctiveActions"];
    existingProjects?: Parameters<typeof buildQapiRecommendations>[0]["existingProjects"];
  } = {},
) {
  const trends = buildIncidentTrends({
    incidents,
    correctiveActions: extras.correctiveActions ?? [],
    now: NOW,
  });
  return buildQapiRecommendations({
    trends, windowLabel: WINDOW, existingProjects: extras.existingProjects,
  });
}

function keys(recommendations: { key: QapiRecommendationKey }[]) {
  return recommendations.map((entry) => entry.key);
}

describe("nothing is recommended without a pattern", () => {
  it("returns nothing for an empty window", () => {
    expect(recommend([])).toEqual([]);
  });

  it("returns nothing when counts sit below every threshold", () => {
    expect(recommend([incident("a"), incident("b")])).toEqual([]);
  });
});

describe("every recommendation cites the records that triggered it", () => {
  it("carries the incident ids behind the finding", () => {
    const incidents = Array.from({ length: QAPI_THRESHOLDS.fallsPerResident }, (_, i) => incident(`f${i}`));
    const [recommendation] = recommend(incidents);
    expect(recommendation.key).toBe("repeated_falls_resident");
    expect(recommendation.incidentIds.sort()).toEqual(incidents.map((i) => i.id).sort());
  });

  it("states the threshold it crossed, so a reader can disagree with it", () => {
    const incidents = Array.from({ length: QAPI_THRESHOLDS.fallsPerResident }, (_, i) => incident(`f${i}`));
    const [recommendation] = recommend(incidents);
    expect(recommendation.threshold).toContain(String(QAPI_THRESHOLDS.fallsPerResident));
    expect(recommendation.finding).toContain(String(QAPI_THRESHOLDS.fallsPerResident));
  });

  it("never produces a score, ranking weight, or probability", () => {
    const incidents = Array.from({ length: 6 }, (_, i) => incident(`f${i}`));
    for (const recommendation of recommend(incidents)) {
      // Guards the request's explicit constraint: no black-box number anywhere in the output.
      for (const value of Object.values(recommendation)) {
        expect(typeof value).not.toBe("number");
      }
      expect(Object.keys(recommendation)).not.toContain("score");
      expect(Object.keys(recommendation)).not.toContain("priority");
    }
  });

  it("gives every recommendation a problem statement someone can start a project from", () => {
    const incidents = Array.from({ length: 6 }, (_, i) => incident(`f${i}`));
    for (const recommendation of recommend(incidents)) {
      expect(recommendation.suggestedProblemStatement.length).toBeGreaterThan(20);
      expect(recommendation.rationale.length).toBeGreaterThan(20);
    }
  });
});

describe("fall patterns", () => {
  it("recommends a project at the resident threshold, not before it", () => {
    const below = Array.from({ length: QAPI_THRESHOLDS.fallsPerResident - 1 }, (_, i) => incident(`f${i}`));
    expect(keys(recommend(below))).not.toContain("repeated_falls_resident");
    expect(keys(recommend([...below, incident("last")]))).toContain("repeated_falls_resident");
  });

  it("does not recommend an environment project for falls whose location was never recorded", () => {
    const incidents = Array.from({ length: QAPI_THRESHOLDS.fallsPerLocation }, (_, i) =>
      incident(`f${i}`, { location_detail: null, resident_id: `r${i}` }));
    expect(keys(recommend(incidents))).not.toContain("repeated_falls_location");
  });

  it("recommends an environment project when one real location repeats", () => {
    const incidents = Array.from({ length: QAPI_THRESHOLDS.fallsPerLocation }, (_, i) =>
      incident(`f${i}`, { location_detail: "Bathroom", resident_id: `r${i}` }));
    expect(keys(recommend(incidents))).toContain("repeated_falls_location");
  });

  it("does not blame a shift that merely happens to be the largest", () => {
    // Six on days and six on evenings: days clears the count threshold but holds only half.
    const incidents = [
      ...Array.from({ length: 6 }, (_, i) => incident(`d${i}`, { resident_id: `r${i}` })),
      ...Array.from({ length: 6 }, (_, i) =>
        incident(`e${i}`, { resident_id: `s${i}`, occurred_at: "2026-07-20T20:00:00Z" })),
    ];
    expect(keys(recommend(incidents))).not.toContain("repeated_falls_shift");
  });

  it("does blame a shift that holds most of the falls", () => {
    const incidents = [
      ...Array.from({ length: 8 }, (_, i) => incident(`d${i}`, { resident_id: `r${i}` })),
      incident("e1", { resident_id: "s1", occurred_at: "2026-07-20T20:00:00Z" }),
    ];
    const shift = recommend(incidents).find((entry) => entry.key === "repeated_falls_shift");
    expect(shift).toBeDefined();
    expect(shift!.finding).toContain("8 of 9");
  });
});

describe("other patterns", () => {
  it("recommends a project on repeated medication events", () => {
    const incidents = Array.from({ length: QAPI_THRESHOLDS.medicationEvents }, (_, i) =>
      incident(`m${i}`, { incident_type: "medication_error", pathway_key: "medication_event", resident_id: `r${i}` }));
    expect(keys(recommend(incidents))).toContain("repeated_medication_events");
  });

  it("recommends a project on rising emergency transfers", () => {
    const incidents = Array.from({ length: QAPI_THRESHOLDS.emergencyTransfers }, (_, i) =>
      incident(`t${i}`, { pathway_key: "emergency_transfer", resident_id: `r${i}` }));
    expect(keys(recommend(incidents))).toContain("increased_emergency_transfers");
  });

  it("recommends a project when the same root cause keeps recurring", () => {
    const incidents = Array.from({ length: QAPI_THRESHOLDS.repeatedRootCause }, (_, i) =>
      incident(`c${i}`, { resident_id: `r${i}`, root_cause: "Call bell out of reach" }));
    const cause = recommend(incidents).find((entry) => entry.key === "repeated_root_cause");
    expect(cause).toBeDefined();
    expect(cause!.title).toContain("Call bell out of reach");
  });

  it("recommends a project when corrective actions close without verification", () => {
    const recommendations = recommend([], {
      correctiveActions: Array.from({ length: QAPI_THRESHOLDS.unverifiedActions }, () => ({
        incident_id: "a", status: "completed", due_date: "2026-07-01",
        completed_date: "2026-07-02", verification_notes: null,
      })),
    });
    expect(keys(recommendations)).toContain("corrective_actions_unverified");
  });

  it("does not recommend that when the completions were verified", () => {
    const recommendations = recommend([], {
      correctiveActions: Array.from({ length: QAPI_THRESHOLDS.unverifiedActions }, () => ({
        incident_id: "a", status: "completed", due_date: "2026-07-01",
        completed_date: "2026-07-02", verification_notes: "Audited and confirmed.",
      })),
    });
    expect(keys(recommendations)).not.toContain("corrective_actions_unverified");
  });

  it("recommends a project when investigations keep running late", () => {
    const incidents = Array.from({ length: QAPI_THRESHOLDS.overdueInvestigations }, (_, i) =>
      incident(`o${i}`, {
        resident_id: `r${i}`, occurred_at: "2026-07-01T12:00:00Z", administrator_approved_at: null,
      }));
    expect(keys(recommend(incidents))).toContain("overdue_investigations");
  });
});

describe("duplicate suppression", () => {
  const incidents = Array.from({ length: QAPI_THRESHOLDS.fallsPerResident }, (_, i) => incident(`f${i}`));

  it("suppresses a pattern that already has an open project", () => {
    const [recommendation] = recommend(incidents);
    const suppressed = recommend(incidents, {
      existingProjects: [{ id: "p1", status: "active", pattern_key: recommendation.patternId }],
    });
    expect(keys(suppressed)).not.toContain("repeated_falls_resident");
  });

  it("still surfaces a pattern whose project was closed — recurrence after closure is the point", () => {
    const [recommendation] = recommend(incidents);
    for (const status of ["closed", "canceled"]) {
      const shown = recommend(incidents, {
        existingProjects: [{ id: "p1", status, pattern_key: recommendation.patternId }],
      });
      expect(keys(shown), status).toContain("repeated_falls_resident");
    }
  });

  it("does not suppress a different pattern", () => {
    const suppressed = recommend(incidents, {
      existingProjects: [{ id: "p1", status: "active", pattern_key: "repeated_falls_location:Bathroom" }],
    });
    expect(keys(suppressed)).toContain("repeated_falls_resident");
  });

  it("ignores projects that were not opened from a recommendation", () => {
    const shown = recommend(incidents, {
      existingProjects: [{ id: "p1", status: "active", pattern_key: null }],
    });
    expect(keys(shown)).toContain("repeated_falls_resident");
  });

  it("gives each pattern instance a distinct id so one resident does not suppress another", () => {
    const mixed = [
      ...Array.from({ length: 3 }, (_, i) => incident(`a${i}`, { resident_id: "r1", resident_display: "Ellis" })),
      ...Array.from({ length: 3 }, (_, i) => incident(`b${i}`, { resident_id: "r2", resident_display: "Devon" })),
    ];
    const patternIds = recommend(mixed)
      .filter((entry) => entry.key === "repeated_falls_resident")
      .map((entry) => entry.patternId);
    expect(new Set(patternIds).size).toBe(patternIds.length);
    expect(patternIds).toHaveLength(2);
  });
});
