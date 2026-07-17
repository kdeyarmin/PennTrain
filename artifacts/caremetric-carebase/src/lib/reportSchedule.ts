import type { Role } from "@/lib/auth";

export type ReportScheduleFrequency = "daily" | "weekly" | "monthly";
export type ReportScheduleDeliveryMode = "in_app" | "email_link";
export type StoredReportScheduleDeliveryMode = ReportScheduleDeliveryMode | "evidence_room";
export type ReportScheduleAudienceRole = Exclude<Role, "platform_admin">;

export interface ReportScheduleForm {
  scheduleId?: string;
  reportDefinitionId: string;
  frequency: ReportScheduleFrequency;
  deliveryMode: ReportScheduleDeliveryMode;
  roles: ReportScheduleAudienceRole[];
  timeZone: string;
  deliveryHour: number;
  deliveryMinute: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
}

export interface ReportScheduleRun {
  id: string;
  scheduledFor: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "partial" | "failed";
  audienceCount: number;
  inAppCount: number;
  emailQueuedCount: number;
  emailSkippedCount: number;
  errorMessage: string | null;
}

export interface ReportSchedule {
  id: string;
  reportDefinitionId: string;
  name: string;
  frequency: ReportScheduleFrequency;
  deliveryHour: number;
  deliveryMinute: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  cronExpression: string;
  timeZone: string;
  deliveryMode: StoredReportScheduleDeliveryMode;
  audience: { roles?: ReportScheduleAudienceRole[] };
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runs: ReportScheduleRun[];
}

export interface ReportScheduleOperations {
  schedules: ReportSchedule[];
  generatedAt: string;
}

export interface ReportSchedulePreview {
  nextRunAt: string;
  cronExpression: string;
}

export const REPORT_SCHEDULE_ROLE_OPTIONS: Array<{ value: ReportScheduleAudienceRole; label: string }> = [
  { value: "org_admin", label: "Organization admins" },
  { value: "facility_manager", label: "Facility managers" },
  { value: "trainer", label: "Trainers" },
  { value: "employee", label: "Employees" },
  { value: "auditor", label: "Auditors" },
];

export const REPORT_SCHEDULE_WEEKDAYS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
] as const;

export function createDefaultReportScheduleForm(timeZone = "America/New_York"): ReportScheduleForm {
  return {
    reportDefinitionId: "",
    frequency: "weekly",
    deliveryMode: "in_app",
    roles: ["org_admin", "facility_manager"],
    timeZone,
    deliveryHour: 7,
    deliveryMinute: 0,
    dayOfWeek: 1,
    dayOfMonth: null,
  };
}

export function reportScheduleToForm(schedule: ReportSchedule): ReportScheduleForm {
  return {
    scheduleId: schedule.id,
    reportDefinitionId: schedule.reportDefinitionId,
    frequency: schedule.frequency,
    deliveryMode: schedule.deliveryMode === "email_link" ? "email_link" : "in_app",
    roles: schedule.audience.roles?.length ? [...schedule.audience.roles] : ["org_admin", "facility_manager"],
    timeZone: schedule.timeZone,
    deliveryHour: schedule.deliveryHour,
    deliveryMinute: schedule.deliveryMinute,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
  };
}

export function changeReportScheduleFrequency(
  form: ReportScheduleForm,
  frequency: ReportScheduleFrequency,
): ReportScheduleForm {
  return {
    ...form,
    frequency,
    dayOfWeek: frequency === "weekly" ? (form.dayOfWeek ?? 1) : null,
    dayOfMonth: frequency === "monthly" ? (form.dayOfMonth ?? 1) : null,
  };
}

export function isReportScheduleFormValid(form: ReportScheduleForm) {
  const roles = new Set(form.roles);
  return form.reportDefinitionId.length > 0
    && form.timeZone.trim().length > 0
    && form.timeZone.length <= 100
    && Number.isInteger(form.deliveryHour)
    && form.deliveryHour >= 0
    && form.deliveryHour <= 23
    && Number.isInteger(form.deliveryMinute)
    && form.deliveryMinute >= 0
    && form.deliveryMinute <= 59
    && form.roles.length >= 1
    && form.roles.length <= 5
    && roles.size === form.roles.length
    && (form.frequency !== "weekly"
      || (form.dayOfWeek !== null && Number.isInteger(form.dayOfWeek) && form.dayOfWeek >= 1 && form.dayOfWeek <= 7))
    && (form.frequency !== "monthly"
      || (form.dayOfMonth !== null && Number.isInteger(form.dayOfMonth) && form.dayOfMonth >= 1 && form.dayOfMonth <= 28));
}

export function formatReportScheduleTime(hour: number, minute: number) {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}

export function describeReportSchedule(schedule: Pick<ReportScheduleForm, "frequency" | "deliveryHour" | "deliveryMinute" | "dayOfWeek" | "dayOfMonth">) {
  const time = formatReportScheduleTime(schedule.deliveryHour, schedule.deliveryMinute);
  if (schedule.frequency === "weekly") {
    return `Weekly on ${REPORT_SCHEDULE_WEEKDAYS[(schedule.dayOfWeek ?? 1) - 1]} at ${time}`;
  }
  if (schedule.frequency === "monthly") {
    return `Monthly on day ${schedule.dayOfMonth ?? 1} at ${time}`;
  }
  return `Daily at ${time}`;
}

export function formatReportScheduleRunAt(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value));
  } catch {
    return "Unavailable";
  }
}
