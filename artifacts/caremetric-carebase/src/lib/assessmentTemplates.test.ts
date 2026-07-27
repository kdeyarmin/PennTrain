import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_TEMPLATES, comparableAnswers, getTemplate, internalReviewTemplates,
  isFieldVisible, isTemplateComplete, templateCitation, templateFields, templateProgress,
  templatesForFacility, validateTemplateAnswers, visibleFields,
  type AssessmentTemplate, type TemplateAnswers,
} from "./assessmentTemplates";
import {
  AMBULATION_LABELS, COGNITIVE_STATUS_LABELS, ELOPEMENT_RISK_LABELS, FALL_RISK_LABELS,
  TEXTURE_LABELS, TRANSFER_ASSISTANCE_LABELS,
} from "./residentCareHeader";

const preadmission = getTemplate("preadmission_assessment")!;
const hospitalReturn = getTemplate("hospital_return_review")!;
const mobility = getTemplate("mobility_fall_review")!;
const continence = getTemplate("continence_review")!;

describe("catalog shape", () => {
  it("defines the ten templates the request names", () => {
    expect(ASSESSMENT_TEMPLATES.map((template) => template.key)).toEqual([
      "initial_assessment", "annual_assessment", "significant_change_assessment", "support_plan",
      "preadmission_assessment", "hospital_return_review", "cognitive_behavioral_review",
      "mobility_fall_review", "nutritional_review", "continence_review",
    ]);
  });

  it("gives every template governance metadata", () => {
    for (const template of ASSESSMENT_TEMPLATES) {
      expect(template.title).toBeTruthy();
      expect(template.purpose).toBeTruthy();
      expect(template.version).toBeGreaterThan(0);
      expect(template.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(template.facilityTypes.length).toBeGreaterThan(0);
      expect(template.signature).toBeDefined();
    }
  });

  it("keeps state-form-backed templates content-free and internal reviews content-bearing", () => {
    // The RASP/ASP shape is dictated by DHS and lives in residentAssessmentFormSchema. Duplicating
    // it here would create two definitions of the same form.
    for (const template of ASSESSMENT_TEMPLATES) {
      if (template.kind === "state_form_backed") {
        expect(template.sections).toEqual([]);
        expect(template.stateFormNotice).toBeTruthy();
      } else {
        expect(template.sections.length).toBeGreaterThan(0);
      }
    }
  });

  it("resolves every declared citation against the governed library", () => {
    for (const template of ASSESSMENT_TEMPLATES) {
      if (!template.citation) continue;
      expect(templateCitation(template)).toBeDefined();
    }
  });

  it("has unique field keys within each template", () => {
    for (const template of ASSESSMENT_TEMPLATES) {
      const keys = templateFields(template).map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("points every conditional field at a field that exists in the same template", () => {
    // A condition referencing a missing key would silently hide the field forever.
    for (const template of ASSESSMENT_TEMPLATES) {
      const keys = new Set(templateFields(template).map((field) => field.key));
      for (const field of templateFields(template)) {
        if (field.when) expect(keys.has(field.when.field)).toBe(true);
      }
    }
  });

  it("gives every select field options", () => {
    for (const template of ASSESSMENT_TEMPLATES) {
      for (const field of templateFields(template)) {
        if (field.type === "single_select" || field.type === "multi_select") {
          expect(field.options?.length ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("shared vocabulary with the care header", () => {
  // Phase 3 compares assessment answers directly against the care header's coded values. If the two
  // vocabularies drift, every conflict rule that uses them breaks silently.
  const optionValues = (templateKey: string, fieldKey: string) =>
    templateFields(getTemplate(templateKey)!)
      .find((field) => field.key === fieldKey)!
      .options!.map((option) => option.value)
      .sort();

  const headerValues = (labels: Record<string, string>) =>
    Object.keys(labels).filter((value) => value !== "not_assessed" && value !== "not_documented").sort();

  it("matches transfer-assistance values", () => {
    expect(optionValues("mobility_fall_review", "transfer_assistance")).toEqual(headerValues(TRANSFER_ASSISTANCE_LABELS));
  });

  it("matches ambulation values", () => {
    expect(optionValues("mobility_fall_review", "ambulation_status")).toEqual(headerValues(AMBULATION_LABELS));
  });

  it("matches fall-risk values", () => {
    expect(optionValues("mobility_fall_review", "fall_risk")).toEqual(headerValues(FALL_RISK_LABELS));
  });

  it("matches elopement-risk values", () => {
    expect(optionValues("cognitive_behavioral_review", "elopement_risk")).toEqual(headerValues(ELOPEMENT_RISK_LABELS));
  });

  it("matches cognitive-status values", () => {
    expect(optionValues("cognitive_behavioral_review", "cognitive_status")).toEqual(headerValues(COGNITIVE_STATUS_LABELS));
  });

  it("matches diet-texture values", () => {
    expect(optionValues("nutritional_review", "diet_texture")).toEqual(Object.keys(TEXTURE_LABELS).sort());
  });
});

describe("lookup", () => {
  it("returns undefined for an unknown key rather than throwing", () => {
    expect(getTemplate("no_such_template")).toBeUndefined();
  });

  it("returns nothing for a facility type with no templates", () => {
    expect(templatesForFacility("NH")).toEqual([]);
    expect(templatesForFacility(null)).toEqual([]);
    expect(templatesForFacility(undefined)).toEqual([]);
  });

  it("returns the six internal reviews for a PCH or ALF", () => {
    for (const facilityType of ["PCH", "ALR"]) {
      expect(internalReviewTemplates(facilityType).map((template) => template.key)).toEqual([
        "preadmission_assessment", "hospital_return_review", "cognitive_behavioral_review",
        "mobility_fall_review", "nutritional_review", "continence_review",
      ]);
    }
  });
});

describe("conditional visibility", () => {
  it("hides a dependant field while its controlling field is unanswered", () => {
    // Demanding a justification before the decision is made makes the form unfinishable.
    const unmet = templateFields(preadmission).find((field) => field.key === "unmet_needs_detail")!;
    expect(isFieldVisible(unmet, {})).toBe(false);
  });

  it("reveals a dependant field when the controlling value matches", () => {
    const unmet = templateFields(preadmission).find((field) => field.key === "unmet_needs_detail")!;
    expect(isFieldVisible(unmet, { can_meet_needs: "no" })).toBe(true);
    expect(isFieldVisible(unmet, { can_meet_needs: "unknown" })).toBe(true);
    expect(isFieldVisible(unmet, { can_meet_needs: "yes" })).toBe(false);
  });

  it("handles boolean conditions in both directions", () => {
    const missing = templateFields(hospitalReturn).find((field) => field.key === "discharge_paperwork_missing_detail")!;
    expect(isFieldVisible(missing, { discharge_paperwork_received: false })).toBe(true);
    expect(isFieldVisible(missing, { discharge_paperwork_received: true })).toBe(false);
    expect(isFieldVisible(missing, {})).toBe(false);

    const interval = templateFields(continence).find((field) => field.key === "toileting_interval_hours")!;
    expect(isFieldVisible(interval, { scheduled_toileting: true })).toBe(true);
    expect(isFieldVisible(interval, { scheduled_toileting: false })).toBe(false);
  });

  it("treats unconditional fields as always visible", () => {
    const fallRisk = templateFields(mobility).find((field) => field.key === "fall_risk")!;
    expect(isFieldVisible(fallRisk, {})).toBe(true);
  });

  it("excludes hidden fields from the visible set", () => {
    const visible = visibleFields(preadmission, { can_meet_needs: "yes" }).map((field) => field.key);
    expect(visible).not.toContain("unmet_needs_detail");
  });
});

describe("validation", () => {
  const completeMobility: TemplateAnswers = {
    ambulation_status: "walker",
    transfer_assistance: "one_person",
    fall_risk: "low",
    falls_last_90_days: 0,
  };

  it("passes a fully answered template", () => {
    expect(validateTemplateAnswers(mobility, completeMobility)).toEqual([]);
    expect(isTemplateComplete(mobility, completeMobility)).toBe(true);
  });

  it("reports each missing required field once, with its label", () => {
    const issues = validateTemplateAnswers(mobility, {});
    expect(issues.every((issue) => issue.kind === "missing_required")).toBe(true);
    expect(issues.map((issue) => issue.fieldKey).sort())
      .toEqual(["ambulation_status", "fall_risk", "falls_last_90_days", "transfer_assistance"]);
    expect(issues[0].message).toContain(issues[0].label);
  });

  it("does not report a hidden conditional field as missing", () => {
    // fall_intervention_summary is required only at moderate/high risk.
    expect(isTemplateComplete(mobility, completeMobility)).toBe(true);
  });

  it("requires the conditional field once its condition is met", () => {
    const issues = validateTemplateAnswers(mobility, { ...completeMobility, fall_risk: "high" });
    expect(issues.map((issue) => issue.fieldKey)).toEqual(["fall_intervention_summary"]);
  });

  it("treats blank strings and empty arrays as unanswered", () => {
    const issues = validateTemplateAnswers(mobility, { ...completeMobility, ambulation_status: "   " });
    expect(issues.map((issue) => issue.fieldKey)).toContain("ambulation_status");
  });

  it("accepts zero as an answer to a required number field", () => {
    // falls_last_90_days: 0 is a real, meaningful answer -- not a blank.
    expect(validateTemplateAnswers(mobility, completeMobility)).toEqual([]);
  });

  it("flags a number outside its range", () => {
    const issues = validateTemplateAnswers(continence, {
      bladder_continence: "continent",
      bowel_continence: "continent",
      scheduled_toileting: true,
      toileting_interval_hours: 40,
      requests_assistance_reliably: true,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("out_of_range");
    expect(issues[0].message).toContain("hours");
  });

  it("flags an option value that is not in the field's list", () => {
    const issues = validateTemplateAnswers(mobility, { ...completeMobility, transfer_assistance: "hoist" });
    expect(issues.map((issue) => issue.kind)).toContain("unknown_option");
  });

  it("validates every entry of a multi-select, not just the first", () => {
    const cognitive = getTemplate("cognitive_behavioral_review")!;
    const issues = validateTemplateAnswers(cognitive, {
      cognitive_status: "mild_impairment",
      elopement_risk: "none",
      behaviour_change_observed: false,
      orientation_concerns: ["time", "galaxy"],
    });
    expect(issues.map((issue) => issue.kind)).toContain("unknown_option");
  });
});

describe("progress", () => {
  it("counts only visible fields", () => {
    const progress = templateProgress(mobility, { fall_risk: "low" });
    // fall_intervention_summary is hidden at low risk, so it is not part of the denominator.
    expect(progress.total).toBe(5);
    expect(progress.answered).toBe(1);
  });

  it("grows the denominator when an answer reveals more questions", () => {
    const before = templateProgress(mobility, { fall_risk: "low" });
    const after = templateProgress(mobility, { fall_risk: "high" });
    expect(after.total).toBeGreaterThan(before.total);
  });

  it("reports zero rather than dividing by zero for a content-free template", () => {
    const stateForm = getTemplate("initial_assessment") as AssessmentTemplate;
    expect(templateProgress(stateForm, {})).toEqual({ answered: 0, total: 0, percent: 0 });
  });
});

describe("comparable answers for conflict detection", () => {
  it("returns each comparable answer tagged with its care attribute", () => {
    const answers = { ambulation_status: "walker", transfer_assistance: "two_person", fall_risk: "high", falls_last_90_days: 2, fall_intervention_summary: "Hourly checks" };
    const comparable = comparableAnswers(mobility, answers);
    expect(comparable.map((entry) => [entry.attribute, entry.value])).toEqual([
      ["ambulation_status", "walker"],
      ["transfer_assistance", "two_person"],
      ["fall_risk", "high"],
    ]);
    expect(comparable[0].templateKey).toBe("mobility_fall_review");
  });

  it("omits unanswered comparable fields rather than emitting empty values", () => {
    expect(comparableAnswers(mobility, {})).toEqual([]);
  });

  it("omits comparable fields that are currently hidden", () => {
    const comparable = comparableAnswers(hospitalReturn, { discharge_paperwork_received: true, diet_texture: "pureed" });
    expect(comparable.map((entry) => entry.attribute)).toEqual(["diet_texture"]);
  });

  it("covers every care attribute a conflict rule needs across the template set", () => {
    const covered = new Set(
      ASSESSMENT_TEMPLATES.flatMap((template) =>
        templateFields(template).map((field) => field.comparesTo).filter(Boolean)),
    );
    expect(covered).toEqual(new Set([
      "transfer_assistance", "ambulation_status", "cognitive_status",
      "elopement_risk", "fall_risk", "diet_texture",
    ]));
  });
});
