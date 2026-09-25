import { describe, expect, it } from "vitest";
import { ITEM_TYPE_LABELS, getRequiredStateFormInfo, getRequiredStateFormLabel, stateFormBackdateDays, stateFormDateField } from "./residentCompliance";

const PA_DHS_URL_PREFIX = "https://www.pa.gov/";

describe("getRequiredStateFormInfo", () => {
  it("maps PCH assessment items to the official PA DHS RASP form", () => {
    for (const itemType of ["initial_assessment_15day", "support_plan_30day", "annual_reassessment", "significant_change_reassessment"]) {
      const info = getRequiredStateFormInfo(itemType, "PCH");
      expect(info.label).toBe("RASP (Resident Assessment-Support Plan)");
      expect(info.sourceLabel).toBe("PA DHS Personal Care Home RASP form");
      expect(info.url).toContain("Personal_Care_Home-Resident_Assessment_Support_Plan_RASP.pdf");
      expect(info.url.startsWith(PA_DHS_URL_PREFIX)).toBe(true);
      expect(getRequiredStateFormLabel(itemType, "PCH")).toBe(info.label);
    }
  });

  it("maps ALR assessment items to the official PA DHS ASP form", () => {
    for (const itemType of ["initial_assessment_15day", "support_plan_30day", "annual_reassessment", "significant_change_reassessment"]) {
      const info = getRequiredStateFormInfo(itemType, "ALR");
      expect(info.label).toBe("ASP (Assessment-Support Plan)");
      expect(info.sourceLabel).toBe("PA DHS Assisted Living Facility (ALF) ASP form");
      expect(info.url).toContain("Assisted_Living-Assessment_Support_Plan_Form.pdf");
      expect(info.url.startsWith(PA_DHS_URL_PREFIX)).toBe(true);
      expect(getRequiredStateFormLabel(itemType, "ALR")).toBe(info.label);
    }
  });

  it("uses facility-specific official DME and preadmission screening forms", () => {
    const pchDme = getRequiredStateFormInfo("medical_evaluation", "PCH");
    const alrDme = getRequiredStateFormInfo("medical_evaluation", "ALR");
    const pchPreadmission = getRequiredStateFormInfo("preadmission_screening", "PCH");
    const alrPreadmission = getRequiredStateFormInfo("preadmission_screening", "ALR");

    expect(pchDme.url).toContain("personal-care-homes-dme");
    expect(pchDme.sourceLabel).toBe("PA DHS Personal Care Home DME form");
    expect(alrDme.url).toContain("assisted-living-residences-dme");
    expect(alrDme.sourceLabel).toBe("PA DHS Assisted Living Facility (ALF) DME form");
    expect(pchPreadmission.url).toContain("Personal_Care_Home-Preadmission-Screening.pdf");
    expect(pchPreadmission.sourceLabel).toBe("PA DHS Personal Care Home Preadmission Screening form");
    expect(alrPreadmission.url).toContain("Assisted_Living-Preadmission_Screening_Form.pdf");
    expect(alrPreadmission.sourceLabel).toBe("PA DHS Assisted Living Facility (ALF) Preadmission Screening form");
  });

  it("falls back to the PA DHS PCH/ALF compliance forms index when facility type is unsupported", () => {
    for (const itemType of ["annual_reassessment", "medical_evaluation", "preadmission_screening"]) {
      const info = getRequiredStateFormInfo(itemType, "NH");
      expect(info.label).toBe("PA DHS state-approved resident compliance form");
      expect(info.sourceLabel).toBe("PA DHS personal care home / assisted living compliance forms index");
      expect(info.url).toBe("https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-compliance-forms");
    }
  });

  it("documents the ALF quarterly support plan review on the ASP form", () => {
    expect(ITEM_TYPE_LABELS.support_plan_quarterly_review).toBe("Quarterly Support Plan Review");
    expect(getRequiredStateFormLabel("support_plan_quarterly_review", "ALR")).toBe("ASP (Assessment-Support Plan)");
  });
});

describe("stateFormBackdateDays", () => {
  it("holds the medical evaluation to 60 days before admission in both chapters", () => {
    expect(stateFormBackdateDays("medical_evaluation", "PCH")).toBe(60);
    expect(stateFormBackdateDays("medical_evaluation", "ALR")).toBe(60);
  });

  it("holds the preadmission screening to 30 days before admission", () => {
    expect(stateFormBackdateDays("preadmission_screening", "PCH")).toBe(30);
    expect(stateFormBackdateDays("preadmission_screening", "ALR")).toBe(30);
  });

  it("allows the ALF initial assessment 30 days before admission but not the final support plan", () => {
    expect(stateFormBackdateDays("initial_assessment_15day", "ALR")).toBe(30);
    expect(stateFormBackdateDays("support_plan_30day", "ALR")).toBe(0);
  });

  it("keeps the general 180-day look-back for PCH assessment items and recurring items", () => {
    expect(stateFormBackdateDays("initial_assessment_15day", "PCH")).toBe(180);
    expect(stateFormBackdateDays("support_plan_30day", "PCH")).toBe(180);
    expect(stateFormBackdateDays("annual_reassessment", "ALR")).toBe(180);
    expect(stateFormBackdateDays("support_plan_30day", null)).toBe(180);
  });
});

describe("stateFormDateField", () => {
  it("asks for the examination date on both medical evaluation cycles, because DHS times the DME from the exam", () => {
    for (const itemType of ["medical_evaluation", "annual_medical_evaluation"]) {
      const field = stateFormDateField(itemType);
      expect(field.label).toBe("Date Resident Evaluated (on the DME)");
      expect(field.hint).toMatch(/in-person medical examination/);
      expect(field.hint).not.toMatch(/signed it/);
      expect(field.subject).toBe("The examination date");
    }
  });

  it("keeps the date on the form for the screening and the assessment-support plan", () => {
    for (const itemType of ["preadmission_screening", "initial_assessment_15day", "support_plan_30day", "annual_reassessment", "significant_change_reassessment", "support_plan_quarterly_review"]) {
      const field = stateFormDateField(itemType);
      expect(field.label).toBe("Date on the form");
      expect(field.subject).toBe("The form date");
    }
  });
});
