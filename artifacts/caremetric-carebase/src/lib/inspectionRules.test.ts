import { describe, expect, it } from "vitest";
import { evacuationFinding, isSleepingHours, maximumInspectionInterval } from "./inspectionRules";

describe("DHS fire inspection rules", () => {
  it("recognizes the cross-midnight sleeping window and custom supported windows", () => {
    expect(isSleepingHours("23:00")).toBe(true);
    expect(isSleepingHours("06:59:59")).toBe(true);
    expect(isSleepingHours("07:00")).toBe(false);
    expect(isSleepingHours("14:30")).toBe(false);
    expect(isSleepingHours("22:30", "22:00", "06:00")).toBe(true);
    expect(isSleepingHours("25:00")).toBe(false);
    expect(isSleepingHours("12:00", "12:00", "12:00")).toBe(false);
  });
  it("distinguishes a time violation, participation gap and failed alarm", () => {
    const complete = { seconds: 150, limit: 150, present: 12, evacuated: 12, alarmSounded: true, alarmOperative: true };
    expect(evacuationFinding(complete)).toBeNull();
    expect(evacuationFinding({ ...complete, seconds: 151 })).toContain("later successful drill does not erase");
    expect(evacuationFinding({ ...complete, evacuated: 11 })).toContain("Not all residents");
    expect(evacuationFinding({ ...complete, alarmSounded: false })).toContain("operative alarm");
    expect(evacuationFinding({ ...complete, evacuated: 11, exception: "ALF hospice exception under 2800.29 documented in resident chart" })).toBeNull();
  });
  it("limits statutory schedules without inventing a interval for manufacturer-dependent equipment", () => {
    expect(maximumInspectionInterval("smoke_detector")).toBe(31);
    expect(maximumInspectionInterval("fire_extinguisher")).toBe(365);
    expect(maximumInspectionInterval("private_water_coliform_test")).toBe(92);
    expect(maximumInspectionInterval("carbon_monoxide_alarm")).toBeUndefined();
    expect(maximumInspectionInterval("carbon_monoxide_battery")).toBe(365);
  });
});
