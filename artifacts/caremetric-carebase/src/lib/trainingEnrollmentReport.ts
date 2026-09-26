import { trainingCsv } from "./trainingWorkspace";
import { formatDateForDisplay } from "./dateUtils";

export type TrainingReportDateBasis = "assigned" | "completed" | "certificate" | "due";
export interface TrainingEnrollmentFilters {
  organizationId: string;
  facilityId?: string;
  employeeId?: string; planId?: string; purpose?: "all" | "required" | "optional"; department?: string; trainingYear?: number; deadline?: "all" | "overdue" | "due_soon";
  courseSearch: string;
  status: string;
  dateBasis: TrainingReportDateBasis;
  dateFrom: string;
  dateThrough: string;
}
export interface TrainingEnrollmentRow {
  is_required?: boolean; assignment_is_required?: boolean; assignment_origin?: string; training_plan_id?: string | null; plan_name?: string | null; training_year?: number | null; department?: string | null; course_version?: string | null; credit_hours?: number;
  id: string; employee_id: string; student: string; facility_id: string; facility: string;
  course_id: string; course: string; status: string; assigned_at: string; due_date: string | null;
  completed_at: string | null; percent_complete: number; certificate_id: string | null;
  credential_number: string | null; certificate_issued_at: string | null; certificate_pdf_status: string | null;
}
export interface TrainingEnrollmentPage {
  organization_name: string; facility_name: string | null; generated_at: string; date_basis: TrainingReportDateBasis;
  limit: number; offset: number; total: number; students: number; completed: number;
  in_progress: number; not_started: number; canceled: number; completion_denominator: number;
  required_total?: number; required_completed?: number; optional_total?: number;
  certificates: number; rows: TrainingEnrollmentRow[];
}
export const DATE_BASIS_LABELS: Record<TrainingReportDateBasis, string> = {
  due: "Due date", assigned: "Enrollment date", completed: "Completion date", certificate: "Certificate issue date",
};
export const TRAINING_REPORT_EXPORT_LIMIT = 10_000;
export const TRAINING_REPORT_EXPORT_LIMIT_MESSAGE = "This report exceeds 10,000 enrollments. Narrow the dates, course or facility before exporting; no partial report was created.";
const countKeys = ["limit", "offset", "total", "students", "completed", "in_progress", "not_started", "canceled", "completion_denominator", "certificates"] as const;

export function parseTrainingEnrollmentPage(value: unknown): TrainingEnrollmentPage {
  const fail = () => { throw new Error("The training report was incomplete. Refresh before exporting."); };
  if (!value || typeof value !== "object") return fail();
  const page = value as TrainingEnrollmentPage;
  if (countKeys.some(key => !Number.isSafeInteger(page[key]) || page[key] < 0)
    || page.limit < 1 || (page.limit > 500 && page.limit !== TRAINING_REPORT_EXPORT_LIMIT) || !Array.isArray(page.rows)
    || (page.limit === TRAINING_REPORT_EXPORT_LIMIT && (page.offset !== 0 || page.total > TRAINING_REPORT_EXPORT_LIMIT))
    || page.rows.length !== Math.min(page.limit, Math.max(0, page.total - page.offset))
    || typeof page.organization_name !== "string" || typeof page.generated_at !== "string"
    || (page.facility_name !== null && typeof page.facility_name !== "string")
    || !Object.hasOwn(DATE_BASIS_LABELS, page.date_basis)
    || page.completion_denominator !== page.total - page.canceled
    || page.completed > page.completion_denominator || page.students > page.total || page.certificates > page.total) return fail();
  for (const row of page.rows) {
    if (!row || ["id", "employee_id", "student", "facility_id", "facility", "course_id", "course", "status", "assigned_at"].some(key => typeof row[key as keyof TrainingEnrollmentRow] !== "string")
      || !Number.isFinite(row.percent_complete) || row.percent_complete < 0 || row.percent_complete > 100
      || ["due_date", "completed_at", "certificate_id", "credential_number", "certificate_issued_at", "certificate_pdf_status"].some(key => row[key as keyof TrainingEnrollmentRow] !== null && typeof row[key as keyof TrainingEnrollmentRow] !== "string")) return fail();
  }
  if (new Set(page.rows.map(row => row.id)).size !== page.rows.length) return fail();
  return page;
}

/** Export one complete database snapshot; never join independently changing report pages. */
export async function collectTrainingEnrollmentReport(readPage: (offset: number, limit: number) => Promise<TrainingEnrollmentPage>): Promise<TrainingEnrollmentPage> {
  const result = await readPage(0, TRAINING_REPORT_EXPORT_LIMIT);
  if (result.total > TRAINING_REPORT_EXPORT_LIMIT) throw new Error(TRAINING_REPORT_EXPORT_LIMIT_MESSAGE);
  const report = parseTrainingEnrollmentPage(result);
  if (report.offset !== 0 || report.limit !== TRAINING_REPORT_EXPORT_LIMIT || report.rows.length !== report.total) {
    throw new Error("The report was incomplete. Refresh and try again; no partial report was created.");
  }
  return report;
}

export function trainingEnrollmentScope(filters: TrainingEnrollmentFilters, report?: TrainingEnrollmentPage): string {
  const employee = filters.employeeId ? report?.rows.find(row => row.employee_id === filters.employeeId)?.student || "Selected employee" : "all";
  const plan = filters.planId ? report?.rows.find(row => row.training_plan_id === filters.planId)?.plan_name || "Selected learning plan" : "all";
  return `${DATE_BASIS_LABELS[filters.dateBasis]}: ${filters.dateFrom || "all past dates"} through ${filters.dateThrough || "all future dates"} (Pennsylvania time). Employee: ${employee}. Plan: ${plan}. Purpose: ${filters.purpose || "all"}. Department: ${filters.department || "all"}. Training year: ${filters.trainingYear || "all"}. Deadline: ${(filters.deadline || "all").replaceAll("_", " ")}. Status: ${filters.status.replaceAll("_", " ")}. Course title: ${filters.courseSearch || "all courses"}. ${filters.dateBasis === "assigned" ? "Each course assignment counts as one enrollment; annual repeats count separately." : "Only enrollments with the selected date recorded are included."} Completion rate = completed enrollments / non-canceled enrollments in this filtered report. This is training activity, not certification of facility compliance.`;
}
export const TRAINING_REPORT_HEADERS = ["Student", "Facility", "Course", "Status", "Progress %", "Enrolled", "Due", "Completed", "Certificate number", "Certificate issued", "Certificate PDF status", "Enrollment ID", "Required / optional", "Learning plan", "Course version", "Earned credit hours"];
export function trainingEnrollmentCells(row: TrainingEnrollmentRow): string[] {
  return [row.student, row.facility, row.course, row.status.replaceAll("_", " "), String(row.percent_complete),
    formatDateForDisplay(row.assigned_at, { timeZone: "America/New_York" }), formatDateForDisplay(row.due_date), formatDateForDisplay(row.completed_at, { timeZone: "America/New_York" }),
    row.credential_number || "", formatDateForDisplay(row.certificate_issued_at, { timeZone: "America/New_York" }), row.certificate_pdf_status || "", row.id, row.is_required === false ? "Optional" : "Required", row.plan_name || "", row.course_version || "", String(row.credit_hours ?? 0)];
}
export function trainingEnrollmentCsv(report: TrainingEnrollmentPage, filters: TrainingEnrollmentFilters): string {
  return trainingCsv([
    ["Training enrollment, completion and certificates", report.organization_name],
    ["Generated", report.generated_at], ["Facility scope", report.facility_name || "All accessible facilities in selected organization"],
    [trainingEnrollmentScope(filters, report)],
    ["Enrollments", report.total, "Students", report.students, "Completed", report.completed, "Non-canceled enrollments", report.completion_denominator, "Issued certificates", report.certificates],
    [], TRAINING_REPORT_HEADERS, ...report.rows.map(trainingEnrollmentCells),
  ]);
}
