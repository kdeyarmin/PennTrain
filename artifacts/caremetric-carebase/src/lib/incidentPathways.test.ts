import { describe, expect, it } from "vitest";
import {
  INCIDENT_PATHWAYS,
  getIncidentPathway,
  isPathwayComplete,
  pathwayFields,
  reportabilityPrompts,
  validatePathwayAnswers,
  visiblePathwayFields,
  type IncidentPathway,
} from "./incidentPathways";

/** Legacy `incidents.incident_type` values. A pathway may not invent a new one. */
const LEGACY_INCIDENT_TYPES = new Set([
  "death", "elopement", "abuse_allegation", "medication_error", "significant_injury",
  "assault", "fire", "environmental_emergency", "neglect_allegation", "other",
]);

function answerEverything(pathway: IncidentPathway): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  // Iterate to a fixed point: answering a field can reveal a conditional one.
  for (let pass = 0; pass < 5; pass += 1) {
    for (const field of visiblePathwayFields(pathway, answers)) {
      if (answers[field.key] !== undefined) continue;
      if (field.options) answers[field.key] = field.options[0].value;
      else if (field.type === "boolean") answers[field.key] = true;
      else if (field.type === "number") answers[field.key] = field.min ?? 0;
      else answers[field.key] = "recorded";
    }
  }
  return answers;
}

describe("pathway catalogue", () => {
  it("covers the twelve investigation pathways the request names", () => {
    expect(INCIDENT_PATHWAYS).toHaveLength(12);
  });

  it("has unique keys", () => {
    const keys = INCIDENT_PATHWAYS.map((pathway) => pathway.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("records against an existing incident_type value, never a new one", () => {
    for (const pathway of INCIDENT_PATHWAYS) {
      expect(LEGACY_INCIDENT_TYPES.has(pathway.incidentType)).toBe(true);
    }
  });

  it("maps several operational pathways onto one legacy type", () => {
    // This is the whole point of the separation: a skin tear and a fracture are both
    // `significant_injury` to the state, but asking them the same questions would be useless.
    const injuryPathways = INCIDENT_PATHWAYS.filter((p) => p.incidentType === "significant_injury");
    expect(injuryPathways.map((p) => p.key).sort()).toEqual(
      ["emergency_transfer", "fall", "injury", "skin_tear"],
    );
  });

  it("gives every pathway unique field keys within itself", () => {
    for (const pathway of INCIDENT_PATHWAYS) {
      const keys = pathwayFields(pathway).map((field) => field.key);
      expect(new Set(keys).size, `${pathway.key} has duplicate field keys`).toBe(keys.length);
    }
  });

  it("asks every pathway about physician and designated-person notification", () => {
    for (const pathway of INCIDENT_PATHWAYS) {
      const keys = pathwayFields(pathway).map((field) => field.key);
      expect(keys, pathway.key).toContain("physician_notified");
      expect(keys, pathway.key).toContain("designated_person_notified");
    }
  });

  it("asks every pathway what was done immediately", () => {
    for (const pathway of INCIDENT_PATHWAYS) {
      expect(pathwayFields(pathway).map((f) => f.key), pathway.key).toContain("immediate_intervention");
    }
  });

  it("only references conditional fields that exist in the same pathway", () => {
    for (const pathway of INCIDENT_PATHWAYS) {
      const keys = new Set(pathwayFields(pathway).map((field) => field.key));
      for (const field of pathwayFields(pathway)) {
        if (field.when) expect(keys.has(field.when.field), `${pathway.key}.${field.key}`).toBe(true);
      }
    }
  });

  it("gives select fields options and non-select fields none", () => {
    for (const pathway of INCIDENT_PATHWAYS) {
      for (const field of pathwayFields(pathway)) {
        const isSelect = field.type === "single_select" || field.type === "multi_select";
        expect(Boolean(field.options), `${pathway.key}.${field.key}`).toBe(isSelect);
      }
    }
  });

  it("resolves a pathway by key and returns undefined for an unknown one", () => {
    expect(getIncidentPathway("fall")?.label).toBe("Fall");
    expect(getIncidentPathway("not_a_pathway")).toBeUndefined();
  });
});

describe("reportability posture", () => {
  it("presumes reportability only for kinds the notification trigger already covers", () => {
    const presumed = INCIDENT_PATHWAYS.filter((p) => p.reportability === "presumed_reportable");
    expect(presumed.map((p) => p.key).sort()).toEqual(
      ["abuse_allegation", "death", "elopement", "medication_event", "staff_resident_altercation"],
    );
  });

  it("leaves falls to a determination rather than presuming either answer", () => {
    // A fall is the case that motivated the separation: most are not reportable, and the ones
    // that are must not be silently missed.
    expect(getIncidentPathway("fall")?.reportability).toBe("determination_required");
  });

  it("prompts on a presumed-reportable pathway with no answers at all", () => {
    const death = getIncidentPathway("death")!;
    expect(reportabilityPrompts(death, {})).toHaveLength(1);
  });

  it("does not prompt on a determination-required pathway with unremarkable answers", () => {
    const fall = getIncidentPathway("fall")!;
    expect(reportabilityPrompts(fall, {
      head_strike: "no", emergency_evaluation: "none", injury_observed: "no",
    })).toEqual([]);
  });

  it("prompts when a head strike is confirmed or merely unknown", () => {
    const fall = getIncidentPathway("fall")!;
    expect(reportabilityPrompts(fall, { head_strike: "yes" })).toHaveLength(1);
    expect(reportabilityPrompts(fall, { head_strike: "unknown" })).toHaveLength(1);
  });

  it("prompts when the resident went to an emergency department", () => {
    const fall = getIncidentPathway("fall")!;
    const prompts = reportabilityPrompts(fall, { emergency_evaluation: "emergency_department" });
    expect(prompts.join(" ")).toContain("emergency department");
  });

  it("prompts that suspected theft may be an allegation rather than a property matter", () => {
    const loss = getIncidentPathway("property_loss")!;
    expect(reportabilityPrompts(loss, { suspected_theft: "yes" })).toHaveLength(1);
    expect(reportabilityPrompts(loss, { suspected_theft: "no" })).toEqual([]);
  });

  it("prompts on an injury of unknown origin", () => {
    const injury = getIncidentPathway("injury")!;
    expect(reportabilityPrompts(injury, { origin_known: "unknown" })).toHaveLength(1);
  });

  it("accumulates prompts rather than returning only the first", () => {
    const fall = getIncidentPathway("fall")!;
    expect(reportabilityPrompts(fall, {
      head_strike: "yes", emergency_evaluation: "emergency_department",
    })).toHaveLength(2);
  });
});

describe("the fall pathway", () => {
  const fall = getIncidentPathway("fall")!;

  it("asks whether the fall was witnessed, and about footwear and the assistive device", () => {
    const keys = pathwayFields(fall).map((field) => field.key);
    expect(keys).toEqual(expect.arrayContaining([
      "witnessed", "location", "activity_before", "footwear", "assistive_device_present",
      "environmental_condition", "head_strike", "prior_falls_90_days",
    ]));
  });

  it("hides the injury description until an injury is reported", () => {
    const withoutInjury = visiblePathwayFields(fall, { injury_observed: "no" }).map((f) => f.key);
    expect(withoutInjury).not.toContain("injury_description");
    const withInjury = visiblePathwayFields(fall, { injury_observed: "yes" }).map((f) => f.key);
    expect(withInjury).toContain("injury_description");
  });

  it("asks about anticoagulants only once a head strike is possible", () => {
    expect(visiblePathwayFields(fall, { head_strike: "no" }).map((f) => f.key))
      .not.toContain("anticoagulant_therapy");
    for (const answer of ["yes", "unknown"]) {
      expect(visiblePathwayFields(fall, { head_strike: answer }).map((f) => f.key))
        .toContain("anticoagulant_therapy");
    }
  });

  it("asks what the plan should change only when the answer is that it should", () => {
    expect(visiblePathwayFields(fall, { support_plan_impact: "no" }).map((f) => f.key))
      .not.toContain("support_plan_change");
    expect(visiblePathwayFields(fall, { support_plan_impact: "yes" }).map((f) => f.key))
      .toContain("support_plan_change");
  });
});

describe("validation", () => {
  it("reports every unanswered required field on an empty pathway", () => {
    const fall = getIncidentPathway("fall")!;
    const issues = validatePathwayAnswers(fall, {});
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.kind === "missing_required")).toBe(true);
    expect(isPathwayComplete(fall, {})).toBe(false);
  });

  it("does not demand a hidden conditional field", () => {
    const fall = getIncidentPathway("fall")!;
    const issues = validatePathwayAnswers(fall, { injury_observed: "no" });
    expect(issues.map((issue) => issue.fieldKey)).not.toContain("injury_description");
  });

  it("treats every pathway as complete once its visible required fields are answered", () => {
    for (const pathway of INCIDENT_PATHWAYS) {
      const answers = answerEverything(pathway);
      expect(validatePathwayAnswers(pathway, answers), pathway.key).toEqual([]);
      expect(isPathwayComplete(pathway, answers), pathway.key).toBe(true);
    }
  });

  it("rejects a value that is not one of the field's options", () => {
    const fall = getIncidentPathway("fall")!;
    const answers = { ...answerEverything(fall), footwear: "flip_flops" };
    expect(validatePathwayAnswers(fall, answers)).toEqual([
      expect.objectContaining({ fieldKey: "footwear", kind: "unknown_option" }),
    ]);
  });

  it("rejects a negative prior-fall count", () => {
    const fall = getIncidentPathway("fall")!;
    const answers = { ...answerEverything(fall), prior_falls_90_days: -1 };
    expect(validatePathwayAnswers(fall, answers)).toEqual([
      expect.objectContaining({ fieldKey: "prior_falls_90_days", kind: "out_of_range" }),
    ]);
  });
});
