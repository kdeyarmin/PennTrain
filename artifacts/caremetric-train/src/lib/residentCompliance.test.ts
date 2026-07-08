import { describe, expect, it } from "vitest";
import { getRequiredStateFormInfo, getRequiredStateFormLabel } from "./residentCompliance";

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
      expect(info.sourceLabel).toBe("PA DHS Assisted Living Residence ASP form");
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
    expect(alrDme.sourceLabel).toBe("PA DHS Assisted Living Residence DME form");
    expect(pchPreadmission.url).toContain("Personal_Care_Home-Preadmission-Screening.pdf");
    expect(pchPreadmission.sourceLabel).toBe("PA DHS Personal Care Home Preadmission Screening form");
    expect(alrPreadmission.url).toContain("Assisted_Living-Preadmission_Screening_Form.pdf");
    expect(alrPreadmission.sourceLabel).toBe("PA DHS Assisted Living Residence Preadmission Screening form");
  });

  it("falls back to the PA DHS PCH/ALR compliance forms index when facility type is unsupported", () => {
    const info = getRequiredStateFormInfo("annual_reassessment", "NH");
    expect(info.label).toBe("PA DHS state-approved resident compliance form");
    expect(info.sourceLabel).toBe("PA DHS PCH/ALR Compliance Forms index");
    expect(info.url).toBe("https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-compliance-forms");
  });
});
