import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUSTOMER_VALUE_BASELINE,
  customerValueBaselineToInput,
  customerValueBaselinesMatch,
  customerValueDashboardToForm,
  isCustomerValueBaselineValid,
} from "./customerValueBaseline";

describe("customerValueBaseline", () => {
  it("hydrates every editable field from the saved dashboard baseline", () => {
    expect(customerValueDashboardToForm({
      configured: true,
      hourlyAdminCost: 41.5,
      retiredSoftwareMonthlyCost: 250,
      retiredTools: ["Paper binder", "Legacy LMS"],
      assumptions: {
        report_export_minutes: 12,
        mock_inspection_minutes: 90,
        course_completion_admin_minutes: 8,
        closed_work_item_minutes: 4,
        portal_message_minutes: 3,
      },
    })).toEqual({
      hourlyCost: "41.5",
      softwareCost: "3000",
      reportMinutes: "12",
      inspectionMinutes: "90",
      courseMinutes: "8",
      workItemMinutes: "4",
      portalMinutes: "3",
      replacedSystems: "Paper binder, Legacy LMS",
    });
  });

  it("uses suggested values only when no saved baseline exists", () => {
    expect(customerValueDashboardToForm({ configured: false })).toEqual(DEFAULT_CUSTOMER_VALUE_BASELINE);
  });

  it("normalizes the form into the save contract", () => {
    expect(customerValueBaselineToInput({
      ...DEFAULT_CUSTOMER_VALUE_BASELINE,
      replacedSystems: " Paper binder, , Legacy LMS ",
    })).toMatchObject({
      hourlyAdminCost: 32,
      annualSoftwareCost: 12000,
      replacedSystems: ["Paper binder", "Legacy LMS"],
    });
  });

  it("compares numeric-equivalent forms without reporting false edits", () => {
    expect(customerValueBaselinesMatch(
      DEFAULT_CUSTOMER_VALUE_BASELINE,
      { ...DEFAULT_CUSTOMER_VALUE_BASELINE, hourlyCost: "32.0" },
    )).toBe(true);
  });

  it("rejects empty, negative, and oversized values before they reach the RPC", () => {
    expect(isCustomerValueBaselineValid(DEFAULT_CUSTOMER_VALUE_BASELINE)).toBe(true);
    expect(isCustomerValueBaselineValid({ ...DEFAULT_CUSTOMER_VALUE_BASELINE, reportMinutes: "" })).toBe(false);
    expect(isCustomerValueBaselineValid({ ...DEFAULT_CUSTOMER_VALUE_BASELINE, portalMinutes: "-1" })).toBe(false);
    expect(isCustomerValueBaselineValid({ ...DEFAULT_CUSTOMER_VALUE_BASELINE, reportMinutes: "10081" })).toBe(false);
    expect(isCustomerValueBaselineValid({ ...DEFAULT_CUSTOMER_VALUE_BASELINE, replacedSystems: "x".repeat(121) })).toBe(false);
  });
});
