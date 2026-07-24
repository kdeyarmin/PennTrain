import { describe, expect, it } from "vitest";
import { shiftDurationHours, summarizeScheduleAnalytics, summarizeStaffingRatios } from "./scheduleAnalytics";

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
