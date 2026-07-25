import { describe, expect, it } from "vitest";
import {
  applyConflictDispositions, CONFLICT_DISPOSITION_LABELS, detectResidentCareConflicts,
  DOCUMENTED_ASSISTANCE_THRESHOLD, DOCUMENTED_ASSISTANCE_WINDOW_DAYS,
  type CareConflictInput,
} from "./residentCareConflicts";
import type { ComparableAnswer } from "./assessmentTemplates";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function answer(attribute: ComparableAnswer["attribute"], value: string): ComparableAnswer {
  return { attribute, value, fieldKey: attribute, label: attribute, templateKey: "mobility_fall_review" };
}

/** A resident where nothing disagrees. Each test introduces exactly one disagreement. */
function clean(overrides: Partial<CareConflictInput> = {}): CareConflictInput {
  return {
    residentId: "r1",
    residentHref: "/app/residents/r1",
    header: { transferAssistance: "one_person", fallRisk: "low", dietTexture: "regular", dietAsOf: "2026-06-01" },
    reviewAnswers: [],
    reviewLabel: "Mobility and fall-risk review",
    reviewDate: "2026-07-20",
    activePlan: {
      id: "plan-1",
      version_number: 3,
      state: "active",
      effective_date: "2026-07-01",
      services: [{ service_name: "Standby assistance during ambulation", transfer_assistance: "one_person" }],
      interventions: [{ intervention: "Fall-prevention checks each shift" }],
    },
    serviceExceptions: [],
    hospitalReturn: null,
    now: NOW,
    ...overrides,
  };
}

describe("no false positives", () => {
  it("finds nothing when the assessment, plan, and header agree", () => {
    expect(detectResidentCareConflicts(clean())).toEqual([]);
  });

  it("finds nothing when the assessment matches the plan exactly", () => {
    const conflicts = detectResidentCareConflicts(clean({
      reviewAnswers: [answer("transfer_assistance", "one_person"), answer("diet_texture", "regular")],
    }));
    expect(conflicts).toEqual([]);
  });

  it("does not flag an assessment that needs LESS help than the plan provides", () => {
    // A plan that over-provides is a care decision, not a safety conflict.
    const conflicts = detectResidentCareConflicts(clean({
      reviewAnswers: [answer("transfer_assistance", "supervision")],
    }));
    expect(conflicts.map((conflict) => conflict.kind)).not.toContain("transfer_assistance_mismatch");
  });

  it("does not flag a less-modified assessed texture than the profile", () => {
    const conflicts = detectResidentCareConflicts(clean({
      header: { transferAssistance: "one_person", fallRisk: "low", dietTexture: "pureed", dietAsOf: "2026-06-01" },
      reviewAnswers: [answer("diet_texture", "regular")],
    }));
    expect(conflicts.map((conflict) => conflict.kind)).not.toContain("diet_texture_mismatch");
  });
});

describe("transfer assistance mismatch", () => {
  it("flags an assessed two-person transfer against a one-person plan", () => {
    const conflicts = detectResidentCareConflicts(clean({
      reviewAnswers: [answer("transfer_assistance", "two_person")],
    }));
    const conflict = conflicts.find((entry) => entry.kind === "transfer_assistance_mismatch")!;
    expect(conflict.severity).toBe("high");
    expect(conflict.source.label).toBe("Mobility and fall-risk review");
    expect(conflict.conflicting.label).toBe("Support plan v3");
    expect(conflict.recommendedResolution).toBeTruthy();
    expect(conflict.responsibleRole).toBeTruthy();
  });

  it("reads requires_two_staff on a service as a two-person plan level", () => {
    // That is the field approve_support_plan actually writes to service requirements.
    const conflicts = detectResidentCareConflicts(clean({
      activePlan: {
        id: "plan-1", version_number: 3, state: "active", effective_date: "2026-07-01",
        services: [{ service_name: "Transfer", requires_two_staff: true }],
      },
      reviewAnswers: [answer("transfer_assistance", "two_person")],
    }));
    expect(conflicts.map((conflict) => conflict.kind)).not.toContain("transfer_assistance_mismatch");
  });

  it("falls back to reading the level out of the service text", () => {
    const conflicts = detectResidentCareConflicts(clean({
      activePlan: {
        id: "plan-1", version_number: 3, state: "active", effective_date: "2026-07-01",
        services: [{ service_name: "Transfer with supervision only" }],
      },
      reviewAnswers: [answer("transfer_assistance", "mechanical_lift")],
    }));
    expect(conflicts.map((conflict) => conflict.kind)).toContain("transfer_assistance_mismatch");
  });

  it("stays silent when the plan states no transfer level at all", () => {
    // Inferring "no mention means independent" would manufacture a conflict from absence.
    const conflicts = detectResidentCareConflicts(clean({
      activePlan: { id: "plan-1", version_number: 3, state: "active", effective_date: "2026-07-01", services: [{ service_name: "Bathing" }] },
      reviewAnswers: [answer("transfer_assistance", "two_person")],
    }));
    expect(conflicts.map((conflict) => conflict.kind)).not.toContain("transfer_assistance_mismatch");
  });
});

describe("diet texture mismatch", () => {
  it("flags an assessed mechanical-soft diet against a regular dietary profile", () => {
    const conflicts = detectResidentCareConflicts(clean({
      reviewAnswers: [answer("diet_texture", "minced_and_moist")],
    }));
    const conflict = conflicts.find((entry) => entry.kind === "diet_texture_mismatch")!;
    expect(conflict.severity).toBe("high");
    expect(conflict.conflicting.label).toBe("Dietary profile");
    expect(conflict.conflicting.at).toBe("2026-06-01");
  });

  it("stays silent when there is no dietary profile to disagree with", () => {
    const conflicts = detectResidentCareConflicts(clean({
      header: { transferAssistance: "one_person", fallRisk: "low", dietTexture: null, dietAsOf: null },
      reviewAnswers: [answer("diet_texture", "pureed")],
    }));
    expect(conflicts.map((conflict) => conflict.kind)).not.toContain("diet_texture_mismatch");
  });
});

describe("documented assistance exceeding the plan", () => {
  const supervisionPlan = {
    id: "plan-1", version_number: 3, state: "active", effective_date: "2026-07-01",
    services: [{ service_name: "Toileting with supervision" }],
  };

  it("flags repeated exceptions against a supervision-level plan", () => {
    const conflicts = detectResidentCareConflicts(clean({
      activePlan: supervisionPlan,
      serviceExceptions: Array.from({ length: DOCUMENTED_ASSISTANCE_THRESHOLD }, (_, index) => ({
        status: "not_completed", service_name: "Toileting", at: daysAgo(index + 1),
      })),
    }));
    const conflict = conflicts.find((entry) => entry.kind === "documented_assistance_exceeds_plan")!;
    expect(conflict.severity).toBe("attention");
    expect(conflict.source.label).toContain(`${DOCUMENTED_ASSISTANCE_THRESHOLD} service exceptions`);
  });

  it("does not fire below the threshold", () => {
    const conflicts = detectResidentCareConflicts(clean({
      activePlan: supervisionPlan,
      serviceExceptions: Array.from({ length: DOCUMENTED_ASSISTANCE_THRESHOLD - 1 }, (_, index) => ({
        status: "not_completed", service_name: "Toileting", at: daysAgo(index + 1),
      })),
    }));
    expect(conflicts.map((conflict) => conflict.kind)).not.toContain("documented_assistance_exceeds_plan");
  });

  it("ignores exceptions outside the window", () => {
    const conflicts = detectResidentCareConflicts(clean({
      activePlan: supervisionPlan,
      serviceExceptions: Array.from({ length: 5 }, () => ({
        status: "not_completed", service_name: "Toileting", at: daysAgo(DOCUMENTED_ASSISTANCE_WINDOW_DAYS + 5),
      })),
    }));
    expect(conflicts.map((conflict) => conflict.kind)).not.toContain("documented_assistance_exceeds_plan");
  });

  it("does not fire when the plan already provides a high level of assistance", () => {
    // Exceptions against a two-person plan are an execution problem, not a plan-level disagreement.
    const conflicts = detectResidentCareConflicts(clean({
      activePlan: {
        id: "plan-1", version_number: 3, state: "active", effective_date: "2026-07-01",
        services: [{ service_name: "Transfer", requires_two_staff: true }],
      },
      serviceExceptions: Array.from({ length: 5 }, (_, index) => ({
        status: "not_completed", service_name: "Transfer", at: daysAgo(index + 1),
      })),
    }));
    expect(conflicts.map((conflict) => conflict.kind)).not.toContain("documented_assistance_exceeds_plan");
  });

  it("counts a structured assistance-level exception regardless of status", () => {
    const conflicts = detectResidentCareConflicts(clean({
      activePlan: supervisionPlan,
      serviceExceptions: Array.from({ length: DOCUMENTED_ASSISTANCE_THRESHOLD }, (_, index) => ({
        status: "completed", service_name: "Toileting", at: daysAgo(index + 1), assistance_level: "extensive",
      })),
    }));
    expect(conflicts.map((conflict) => conflict.kind)).toContain("documented_assistance_exceeds_plan");
  });
});

describe("fall risk without intervention", () => {
  it("flags a moderate or high risk when the plan has no fall intervention", () => {
    const conflicts = detectResidentCareConflicts(clean({
      activePlan: { id: "plan-1", version_number: 3, state: "active", effective_date: "2026-07-01", services: [{ service_name: "Bathing assistance" }] },
      reviewAnswers: [answer("fall_risk", "high")],
    }));
    const conflict = conflicts.find((entry) => entry.kind === "fall_risk_without_intervention")!;
    expect(conflict.severity).toBe("high");
  });

  it("is satisfied by a fall intervention anywhere in the plan", () => {
    const conflicts = detectResidentCareConflicts(clean({
      reviewAnswers: [answer("fall_risk", "high")],
    }));
    expect(conflicts.map((conflict) => conflict.kind)).not.toContain("fall_risk_without_intervention");
  });

  it("does not fire at low risk", () => {
    const conflicts = detectResidentCareConflicts(clean({
      activePlan: { id: "plan-1", version_number: 3, state: "active", effective_date: "2026-07-01", services: [{ service_name: "Bathing" }] },
      reviewAnswers: [answer("fall_risk", "low")],
    }));
    expect(conflicts.map((conflict) => conflict.kind)).not.toContain("fall_risk_without_intervention");
  });

  it("falls back to the care header when no review has been done", () => {
    const conflicts = detectResidentCareConflicts(clean({
      header: { transferAssistance: "one_person", fallRisk: "high", dietTexture: "regular", dietAsOf: null },
      activePlan: { id: "plan-1", version_number: 3, state: "active", effective_date: "2026-07-01", services: [{ service_name: "Bathing" }] },
    }));
    const conflict = conflicts.find((entry) => entry.kind === "fall_risk_without_intervention")!;
    expect(conflict.source.label).toBe("Care header");
  });

  it("flags a fall risk with no plan at all", () => {
    const conflicts = detectResidentCareConflicts(clean({
      activePlan: null,
      reviewAnswers: [answer("fall_risk", "moderate")],
    }));
    const conflict = conflicts.find((entry) => entry.kind === "fall_risk_without_intervention")!;
    expect(conflict.conflicting.label).toBe("No support plan in force");
  });
});

describe("plan predating a hospital return", () => {
  it("flags a plan older than a return that recorded changes", () => {
    const conflicts = detectResidentCareConflicts(clean({
      hospitalReturn: { episodeId: "ep-1", returnedAt: daysAgo(3), recordedChanges: true },
    }));
    const conflict = conflicts.find((entry) => entry.kind === "plan_predates_hospital_return")!;
    expect(conflict.severity).toBe("high");
    expect(conflict.source.label).toContain("3 days ago");
  });

  it("does not fire when the return recorded no changes", () => {
    const conflicts = detectResidentCareConflicts(clean({
      hospitalReturn: { episodeId: "ep-1", returnedAt: daysAgo(3), recordedChanges: false },
    }));
    expect(conflicts.map((conflict) => conflict.kind)).not.toContain("plan_predates_hospital_return");
  });

  it("does not fire when the plan was revised after the return", () => {
    const conflicts = detectResidentCareConflicts(clean({
      activePlan: { id: "plan-2", version_number: 4, state: "active", effective_date: "2026-07-24", services: [], interventions: [{ intervention: "Fall checks" }] },
      hospitalReturn: { episodeId: "ep-1", returnedAt: daysAgo(10), recordedChanges: true },
    }));
    expect(conflicts.map((conflict) => conflict.kind)).not.toContain("plan_predates_hospital_return");
  });
});

describe("keys, ordering, and dispositions", () => {
  it("gives every conflict a source, a conflicting record, a resolution, and an owner", () => {
    const conflicts = detectResidentCareConflicts(clean({
      reviewAnswers: [answer("transfer_assistance", "two_person"), answer("diet_texture", "pureed")],
      hospitalReturn: { episodeId: "ep-1", returnedAt: daysAgo(2), recordedChanges: true },
    }));
    expect(conflicts.length).toBeGreaterThan(1);
    for (const conflict of conflicts) {
      expect(conflict.key).toBeTruthy();
      expect(conflict.source.label).toBeTruthy();
      expect(conflict.conflicting.label).toBeTruthy();
      expect(conflict.recommendedResolution).toBeTruthy();
      expect(conflict.responsibleRole).toBeTruthy();
    }
  });

  it("produces stable keys across repeated detection", () => {
    const input = clean({ reviewAnswers: [answer("transfer_assistance", "two_person")] });
    expect(detectResidentCareConflicts(input).map((conflict) => conflict.key))
      .toEqual(detectResidentCareConflicts(input).map((conflict) => conflict.key));
  });

  it("sorts high severity ahead of attention", () => {
    const conflicts = detectResidentCareConflicts(clean({
      reviewAnswers: [answer("transfer_assistance", "two_person")],
      activePlan: { id: "plan-1", version_number: 3, state: "active", effective_date: "2026-07-01", services: [{ service_name: "Toileting with supervision" }], interventions: [{ intervention: "Fall checks" }] },
      serviceExceptions: Array.from({ length: 4 }, (_, index) => ({ status: "not_completed", service_name: "Toileting", at: daysAgo(index + 1) })),
    }));
    expect(conflicts[0].severity).toBe("high");
    expect(conflicts[conflicts.length - 1].severity).toBe("attention");
  });

  it("suppresses a conflict whose disposition still applies", () => {
    const conflicts = detectResidentCareConflicts(clean({ reviewAnswers: [answer("transfer_assistance", "two_person")] }));
    expect(applyConflictDispositions(conflicts, [{ conflict_key: conflicts[0].key }])).toEqual([]);
  });

  it("resurfaces the conflict when the disagreement itself changes", () => {
    // Resolving "two_person vs one_person" must not absolve "mechanical_lift vs one_person".
    const before = detectResidentCareConflicts(clean({ reviewAnswers: [answer("transfer_assistance", "two_person")] }));
    const after = detectResidentCareConflicts(clean({ reviewAnswers: [answer("transfer_assistance", "mechanical_lift")] }));
    expect(applyConflictDispositions(after, [{ conflict_key: before[0].key }])).toHaveLength(1);
  });

  it("offers the three dispositions the request names", () => {
    expect(Object.keys(CONFLICT_DISPOSITION_LABELS)).toEqual(["accepted", "corrected", "exception_documented"]);
  });
});
