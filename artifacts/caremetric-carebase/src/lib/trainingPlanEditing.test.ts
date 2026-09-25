import { describe, expect, it } from "vitest";
import { canManageTrainingPlan, isExplicitCompletionDeadline, trainingPlanErrorMessage, yearlyPlanInputError } from "./trainingPlanEditing";

const plan = { organization_id: "org-a", facility_id: "facility-a" };
const authorized = new Set(["facility-a"]);

describe("training plan error display", () => {
  it("extracts a PostgREST message without requiring an Error instance", () => {
    expect(trainingPlanErrorMessage({ code: "42501", message: "Access to this facility was removed", details: null }))
      .toBe("Access to this facility was removed");
    expect(trainingPlanErrorMessage(new Error("Network unavailable"))).toBe("Network unavailable");
    expect(trainingPlanErrorMessage("Request timed out")).toBe("Request timed out");
  });
  it.each([null, undefined, {}, { message: null }, { message: {} }, { message: "  " }])("uses a readable fallback for malformed failures: %j", error => {
    expect(trainingPlanErrorMessage(error)).toBe("Training plan operation failed. Please try again.");
  });
});

describe("yearly plan authoring scope", () => {
  it.each(["org_admin", "facility_manager", "trainer"])("lets %s edit only a plan in an authorized facility and organization", role => {
    expect(canManageTrainingPlan(role, plan, "org-a", authorized)).toBe(true);
    expect(canManageTrainingPlan(role, { ...plan, facility_id: "other-facility" }, "org-a", authorized)).toBe(false);
    expect(canManageTrainingPlan(role, { ...plan, organization_id: "other-org" }, "org-a", authorized)).toBe(false);
    expect(canManageTrainingPlan(role, plan, "org-a", new Set())).toBe(false);
  });
  it.each(["employee", "auditor", undefined])("does not grant %s authoring through a readable directory", role => {
    expect(canManageTrainingPlan(role, plan, "org-a", authorized)).toBe(false);
  });
  it("preserves the older template roles and platform administration", () => {
    const legacy = { ...plan, facility_id: null };
    expect(canManageTrainingPlan("facility_manager", legacy, "org-a", authorized)).toBe(false);
    expect(canManageTrainingPlan("org_admin", legacy, "org-a", authorized)).toBe(true);
    expect(canManageTrainingPlan("trainer", legacy, "org-a", new Set())).toBe(true);
    expect(canManageTrainingPlan("platform_admin", plan, null, new Set())).toBe(true);
  });
});

describe("administrator-entered year and deadline", () => {
  const valid = { facilityId: "facility-a", trainingYear: "2027", dueDate: "2027-03-17" };
  it("does not substitute a date or year when the administrator leaves them blank", () => {
    expect(yearlyPlanInputError({ ...valid, trainingYear: "" }, authorized)).toContain("training year");
    expect(yearlyPlanInputError({ ...valid, dueDate: "" }, authorized)).toContain("deadline");
  });
  it("rejects an unavailable facility rather than choosing another one", () => {
    expect(yearlyPlanInputError({ ...valid, facilityId: "other-facility" }, authorized)).toContain("facility");
    expect(yearlyPlanInputError(valid, new Set())).toContain("facility");
  });
  it.each(["1989", "2201", "2027.5", "2e3"])("rejects invalid training year %s", trainingYear => {
    expect(yearlyPlanInputError({ ...valid, trainingYear }, authorized)).toContain("training year");
  });
  it.each(["2027-02-29", "2027-04-31", "2027-13-01", "03/17/2027", "2027-03-17T00:00:00Z"])("rejects invalid or non-date deadline %s", value => {
    expect(isExplicitCompletionDeadline(value)).toBe(false);
  });
  it("preserves an explicit valid date, including leap days or a different calendar year", () => {
    expect(isExplicitCompletionDeadline("2028-02-29")).toBe(true);
    expect(yearlyPlanInputError(valid, authorized)).toBeNull();
    expect(yearlyPlanInputError({ ...valid, dueDate: "2028-01-15" }, authorized)).toBeNull();
    expect(valid.dueDate).toBe("2027-03-17");
  });
});
