import { describe, expect, it } from "vitest";
import { evacuationFinding, isSleepingHours, maximumInspectionInterval, inspectionScheduleLabel, inspectionTypeAppliesToFacility, inspectionGuidance } from "./inspectionRules";

describe("DHS fire inspection rules", () => {
  it("keeps ALF-only inspection requirements out of PCH defaults while identifying retained voluntary records", () => {
    for (const type of ["fireplace_chimney_service", "automatic_external_defibrillator"]) {
      expect(inspectionTypeAppliesToFacility(type, "PCH")).toBe(false);
      expect(inspectionTypeAppliesToFacility(type, "ALR")).toBe(true);
      expect(inspectionTypeAppliesToFacility(type)).toBe(false);
      expect(inspectionGuidance(type, "PCH")).toContain("Additional facility policy");
      expect(inspectionGuidance(type, "ALR")).toContain("2800");
    }
    expect(inspectionTypeAppliesToFacility("fire_extinguisher", "PCH")).toBe(true);
    expect(inspectionGuidance("fire_extinguisher", "PCH")).toContain("annually");
    expect(maximumInspectionInterval("fireplace_chimney_service", "PCH")).toBeUndefined();
    expect(maximumInspectionInterval("fireplace_chimney_service", "ALR")).toBe(365);
  });
  it("labels calendar baselines separately from explicit fixed-day facility schedules", () => {
    expect(inspectionScheduleLabel("furnace_inspection", 365)).toBe("Annually (calendar anniversary)");
    expect(inspectionScheduleLabel("smoke_detector", 30)).toBe("Every calendar month");
    expect(inspectionScheduleLabel("private_water_coliform_test", 90)).toBe("Every 3 calendar months");
    expect(inspectionScheduleLabel("furnace_inspection", 180)).toBe("Every 180 days");
    expect(inspectionScheduleLabel("other_equipment", 365)).toBe("Every 365 days");
  });
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
