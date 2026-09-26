import { describe, expect, it } from "vitest";
import { applySavedTrainingFilters, saveableTrainingFilters, trainingScheduleDayIsValid } from "./trainingAutomation";

describe("saved Training report scope", () => {
  it("captures the complete filter choice without tenant authority or undefined values", () => {
    const saved = saveableTrainingFilters({ organizationId: "org", facilityId: "facility", employeeId: "employee", planId: undefined,
      purpose: "required", department: "Care", trainingYear: 2026, deadline: "overdue", status: "all", courseSearch: "Dementia", dateBasis: "due", dateFrom: "2026-01-01", dateThrough: "2026-12-31" });
    expect(saved).toEqual({ employeeId: "employee", purpose: "required", department: "Care", trainingYear: 2026, deadline: "overdue", status: "all", courseSearch: "Dementia", dateBasis: "due", dateFrom: "2026-01-01", dateThrough: "2026-12-31" });
    expect(Object.values(saved)).not.toContain(undefined);
  });
  it("applies the authorized scope after saved filter values", () => {
    const saved = { status: "completed", organizationId: "untrusted", facilityId: "untrusted" } as unknown as Parameters<typeof applySavedTrainingFilters>[0];
    expect(applySavedTrainingFilters(saved, "allowed-org", "allowed-facility")).toMatchObject({ organizationId: "allowed-org", facilityId: "allowed-facility", status: "completed", dateBasis: "assigned" });
  });
  it("supports all weekdays and monthly days that occur in every month", () => {
    expect(trainingScheduleDayIsValid("weekly", 7)).toBe(true);
    expect(trainingScheduleDayIsValid("weekly", 8)).toBe(false);
    expect(trainingScheduleDayIsValid("monthly", 28)).toBe(true);
    expect(trainingScheduleDayIsValid("monthly", 29)).toBe(false);
    expect(trainingScheduleDayIsValid("monthly", 1.5)).toBe(false);
    expect(trainingScheduleDayIsValid("other", 1)).toBe(false);
  });
});
