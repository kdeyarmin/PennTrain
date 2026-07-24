import { describe, expect, it } from "vitest";
import { buildSpecialCareComplianceSummary, isSpecialCareUnit } from "./specialCareCompliance";

describe("special care compliance", () => {
  it("detects dementia and special-care unit designations by unit naming convention", () => {
    expect(isSpecialCareUnit({ name: "Memory Care Wing" })).toBe(true);
    expect(isSpecialCareUnit({ name: "Wing A" })).toBe(false);
  });

  it("flags assigned staff without dementia training for designated units", () => {
    const summary = buildSpecialCareComplianceSummary({
      units: [{ id: "u1", name: "Dementia Special Care Unit", is_active: true }],
      residents: [{ id: "r1", sdcu: true, status: "active" }],
      schedulePreferences: [
        { employee_id: "e1", unit_id: "u1" },
        { employee_id: "e2", unit_id: "u1" },
      ],
      trainingTypes: [{ id: "t1", name: "Dementia Care Training", code: "DEMENTIA" }],
      trainingRecords: [{ employee_id: "e1", training_type_id: "t1", status: "compliant" }],
    });

    expect(summary.designatedUnits).toHaveLength(1);
    expect(summary.assignedStaffCount).toBe(2);
    expect(summary.trainedStaffCount).toBe(1);
    expect(summary.staffingGapCount).toBe(1);
    expect(summary.status).toBe("needs_attention");
  });

  it("is not inspection-ready when SDCU residents have no assigned staff at all", () => {
    const summary = buildSpecialCareComplianceSummary({
      units: [{ id: "u1", name: "Memory Care Wing", is_active: true }],
      residents: [{ id: "r1", sdcu: true, status: "active" }],
      schedulePreferences: [],
      trainingTypes: [{ id: "t1", name: "Dementia Care Training", code: "DEMENTIA" }],
      trainingRecords: [],
    });

    expect(summary.assignedStaffCount).toBe(0);
    expect(summary.staffingGapCount).toBe(0);
    expect(summary.status).toBe("needs_attention");
  });

  it("stays inspection-ready for a designated unit with no residents or staff yet", () => {
    const summary = buildSpecialCareComplianceSummary({
      units: [{ id: "u1", name: "Memory Care Wing", is_active: true }],
      residents: [],
      schedulePreferences: [],
      trainingTypes: [{ id: "t1", name: "Dementia Care Training", code: "DEMENTIA" }],
      trainingRecords: [],
    });

    expect(summary.status).toBe("inspection_ready");
  });
});
