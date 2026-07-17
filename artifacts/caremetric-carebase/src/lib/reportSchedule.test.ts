import { describe, expect, it } from "vitest";
import {
  changeReportScheduleFrequency,
  createDefaultReportScheduleForm,
  describeReportSchedule,
  formatReportScheduleTime,
  isReportScheduleFormValid,
  REPORT_SCHEDULE_ROLE_OPTIONS,
  reportScheduleToForm,
  type ReportSchedule,
  type ReportScheduleAudienceRole,
} from "./reportSchedule";

describe("reportSchedule", () => {
  it("creates a valid weekly manager schedule", () => {
    const form = { ...createDefaultReportScheduleForm(), reportDefinitionId: "report-1" };
    expect(isReportScheduleFormValid(form)).toBe(true);
    expect(describeReportSchedule(form)).toBe("Weekly on Monday at 7:00 AM");
  });

  it("normalizes conditional day fields when frequency changes", () => {
    const weekly = createDefaultReportScheduleForm();
    const monthly = changeReportScheduleFrequency(weekly, "monthly");
    expect(monthly).toMatchObject({ frequency: "monthly", dayOfWeek: null, dayOfMonth: 1 });
    expect(changeReportScheduleFrequency(monthly, "daily")).toMatchObject({
      frequency: "daily", dayOfWeek: null, dayOfMonth: null,
    });
  });

  it("rejects missing audiences and out-of-range schedule fields", () => {
    const form = { ...createDefaultReportScheduleForm(), reportDefinitionId: "report-1" };
    expect(isReportScheduleFormValid({ ...form, roles: [] })).toBe(false);
    expect(isReportScheduleFormValid({ ...form, deliveryHour: 24 })).toBe(false);
    expect(isReportScheduleFormValid({ ...form, dayOfWeek: 8 })).toBe(false);
    expect(isReportScheduleFormValid({ ...form, roles: ["employee" as ReportScheduleAudienceRole] })).toBe(false);
    expect(REPORT_SCHEDULE_ROLE_OPTIONS.map((option) => option.value)).toEqual(["org_admin", "facility_manager", "auditor"]);
  });

  it("hydrates the edit form from an existing schedule", () => {
    const schedule: ReportSchedule = {
      id: "schedule-1",
      reportDefinitionId: "report-1",
      name: "Compliance report",
      frequency: "monthly",
      deliveryHour: 14,
      deliveryMinute: 30,
      dayOfWeek: null,
      dayOfMonth: 15,
      cronExpression: "30 14 15 * *",
      timeZone: "America/Chicago",
      deliveryMode: "email_link",
      audience: { roles: ["auditor"] },
      enabled: true,
      nextRunAt: null,
      lastRunAt: null,
      runs: [],
    };
    expect(reportScheduleToForm(schedule)).toMatchObject({
      scheduleId: "schedule-1",
      reportDefinitionId: "report-1",
      frequency: "monthly",
      deliveryMode: "email_link",
      roles: ["auditor"],
      dayOfMonth: 15,
    });
    expect(reportScheduleToForm({ ...schedule, deliveryMode: "evidence_room" })).toBeNull();
  });

  it("formats midnight, noon, and afternoon consistently", () => {
    expect(formatReportScheduleTime(0, 0)).toBe("12:00 AM");
    expect(formatReportScheduleTime(12, 15)).toBe("12:15 PM");
    expect(formatReportScheduleTime(17, 45)).toBe("5:45 PM");
  });
});
