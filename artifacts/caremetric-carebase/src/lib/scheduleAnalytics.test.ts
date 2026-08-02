import { describe, expect, it } from "vitest";
import { shiftDurationHours, summarizeScheduleAnalytics, summarizeStaffingRatios, summarizeMedAdminCoverage } from "./scheduleAnalytics";

describe("schedule analytics", () => {
  it("computes overnight shift duration", () => {
    expect(shiftDurationHours("22:00", "06:00")).toBe(8);
  });

  it("summarizes coverage, hours, sources, and overtime risk", () => {
    const assignments = Array.from({ length: 6 }, (_, index) => ({
      employee_id: "e1",
      shift_date: `2026-07-${String(10 + index).padStart(2, "0")}`,
      start_time: "08:00",
      end_time: "16:00",
      status: "scheduled",
      source: index === 0 ? "manual" : "auto_fill",
      unit_id: "u1",
      employees: { first_name: "Ava", last_name: "Aide" },
    }));

    expect(summarizeScheduleAnalytics({ assignments, dates: ["2026-07-10", "2026-07-11"], unitIds: ["u1", "u2"] })).toMatchObject({
      totalShifts: 6,
      scheduledHours: 48,
      autoFilledShifts: 5,
      manualShifts: 1,
      unitDayCoverageGaps: 2,
      employeesOver40Hours: [{ employeeId: "e1", name: "Ava Aide", hours: 48 }],
    });
  });

  it("excludes no_show shifts from coverage and scheduled hours", () => {
    const assignments = [
      { employee_id: "e1", shift_date: "2026-07-10", start_time: "08:00", end_time: "16:00", status: "scheduled", source: "manual", unit_id: "u1", employees: { first_name: "Ava", last_name: "Aide" } },
      { employee_id: "e2", shift_date: "2026-07-10", start_time: "08:00", end_time: "16:00", status: "no_show", source: "manual", unit_id: "u2", employees: { first_name: "Bo", last_name: "Aide" } },
      { employee_id: "e1", shift_date: "2026-07-11", start_time: "08:00", end_time: "16:00", status: "called_off", source: "manual", unit_id: "u1", employees: { first_name: "Ava", last_name: "Aide" } },
    ];

    expect(summarizeScheduleAnalytics({ assignments, dates: ["2026-07-10", "2026-07-11"], unitIds: ["u1", "u2"] })).toMatchObject({
      totalShifts: 3,
      scheduledHours: 8,
      exceptionShifts: 2,
      unitDayCoverageGaps: 3,
      employeesOver40Hours: [],
    });
  });

  it("calculates PPD and minimum staffing warnings from resident count", () => {
    const assignments = [
      { employee_id: "e1", shift_date: "2026-07-10", start_time: "08:00", end_time: "16:00", status: "scheduled", source: "manual", unit_id: "u1" },
      { employee_id: "e2", shift_date: "2026-07-10", start_time: "16:00", end_time: "00:00", status: "scheduled", source: "manual", unit_id: "u1" },
      { employee_id: "e1", shift_date: "2026-07-11", start_time: "08:00", end_time: "16:00", status: "called_off", source: "manual", unit_id: "u1" },
    ];

    expect(summarizeStaffingRatios({
      assignments,
      dates: ["2026-07-10", "2026-07-11"],
      residentsInHouse: 10,
      targetPpd: 1.5,
      minimumStaffPerDay: 2,
    })).toMatchObject({
      residentsInHouse: 10,
      scheduledCareHours: 16,
      ppd: 0.8,
      targetHours: 30,
      targetHoursPerDay: 15,
      hoursGap: 14,
      hoursGapPerDay: 7,
      suggestedEightHourShifts: 2,
      isBelowTarget: true,
      averageResidentsPerScheduledStaff: 10,
      daysBelowMinimumStaffing: [{ date: "2026-07-11", scheduledStaff: 0, minimumStaff: 2 }],
    });
  });
});

describe("summarizeMedAdminCoverage", () => {
  const authorizedOnly = (authorizedIds: string[]) => (employeeId: string) => authorizedIds.includes(employeeId);

  it("flags a shift with staff scheduled but none of them currently authorized", () => {
    const assignments = [
      { employee_id: "e1", shift_date: "2026-07-10", status: "scheduled", shift_definition_id: "day", shift_name: "Day" },
    ];
    const result = summarizeMedAdminCoverage({ assignments, dates: ["2026-07-10"], isAuthorized: authorizedOnly([]) });
    expect(result.gaps).toEqual([{ date: "2026-07-10", shiftName: "Day", scheduledStaff: 1 }]);
    expect(result.datesWithGaps).toEqual(["2026-07-10"]);
  });

  it("does not flag a shift where at least one scheduled employee is authorized", () => {
    const assignments = [
      { employee_id: "e1", shift_date: "2026-07-10", status: "scheduled", shift_definition_id: "day", shift_name: "Day" },
      { employee_id: "e2", shift_date: "2026-07-10", status: "scheduled", shift_definition_id: "day", shift_name: "Day" },
    ];
    const result = summarizeMedAdminCoverage({ assignments, dates: ["2026-07-10"], isAuthorized: authorizedOnly(["e2"]) });
    expect(result.gaps).toEqual([]);
  });

  it("does not flag a shift with zero staff scheduled at all -- that is a separate, existing coverage-gap signal", () => {
    const result = summarizeMedAdminCoverage({ assignments: [], dates: ["2026-07-10"], isAuthorized: authorizedOnly([]) });
    expect(result.gaps).toEqual([]);
    expect(result.datesWithGaps).toEqual([]);
  });

  it("does not count a called-off or no-show employee's authorization toward covering the shift", () => {
    const assignments = [
      { employee_id: "e1", shift_date: "2026-07-10", status: "called_off", shift_definition_id: "day", shift_name: "Day" },
      { employee_id: "e2", shift_date: "2026-07-10", status: "no_show", shift_definition_id: "day", shift_name: "Day" },
    ];
    const result = summarizeMedAdminCoverage({ assignments, dates: ["2026-07-10"], isAuthorized: authorizedOnly(["e1", "e2"]) });
    // Both authorized staff are absent (called off / no-show) -- but with no *active* assignment on
    // the shift at all, this is "no staff scheduled", not a med-admin-specific gap.
    expect(result.gaps).toEqual([]);
  });

  it("catches a shift-specific gap even when the day overall has authorized coverage on a different shift", () => {
    const assignments = [
      { employee_id: "authorized-e1", shift_date: "2026-07-10", status: "scheduled", shift_definition_id: "day", shift_name: "Day" },
      { employee_id: "unauthorized-e2", shift_date: "2026-07-10", status: "scheduled", shift_definition_id: "night", shift_name: "Night" },
    ];
    const result = summarizeMedAdminCoverage({
      assignments,
      dates: ["2026-07-10"],
      isAuthorized: authorizedOnly(["authorized-e1"]),
    });
    expect(result.gaps).toEqual([{ date: "2026-07-10", shiftName: "Night", scheduledStaff: 1 }]);
    expect(result.datesWithGaps).toEqual(["2026-07-10"]);
  });

  it("groups assignments with no shift_definition_id together instead of dropping them", () => {
    const assignments = [
      { employee_id: "e1", shift_date: "2026-07-10", status: "scheduled", shift_definition_id: null, shift_name: null },
    ];
    const result = summarizeMedAdminCoverage({ assignments, dates: ["2026-07-10"], isAuthorized: authorizedOnly([]) });
    expect(result.gaps).toEqual([{ date: "2026-07-10", shiftName: "Shift", scheduledStaff: 1 }]);
  });

  it("sorts gaps by date then shift name and dedupes datesWithGaps", () => {
    const assignments = [
      { employee_id: "e1", shift_date: "2026-07-11", status: "scheduled", shift_definition_id: "night", shift_name: "Night" },
      { employee_id: "e2", shift_date: "2026-07-10", status: "scheduled", shift_definition_id: "night", shift_name: "Night" },
      { employee_id: "e3", shift_date: "2026-07-10", status: "scheduled", shift_definition_id: "day", shift_name: "Day" },
    ];
    const result = summarizeMedAdminCoverage({
      assignments,
      dates: ["2026-07-10", "2026-07-11"],
      isAuthorized: authorizedOnly([]),
    });
    expect(result.gaps.map((g) => `${g.date}|${g.shiftName}`)).toEqual([
      "2026-07-10|Day",
      "2026-07-10|Night",
      "2026-07-11|Night",
    ]);
    expect(result.datesWithGaps).toEqual(["2026-07-10", "2026-07-11"]);
  });

  it("ignores assignments outside the schedule's date range", () => {
    const assignments = [
      { employee_id: "e1", shift_date: "2026-08-01", status: "scheduled", shift_definition_id: "day", shift_name: "Day" },
    ];
    const result = summarizeMedAdminCoverage({ assignments, dates: ["2026-07-10"], isAuthorized: authorizedOnly([]) });
    expect(result.gaps).toEqual([]);
  });
});
