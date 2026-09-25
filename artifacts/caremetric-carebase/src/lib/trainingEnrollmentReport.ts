import { trainingCsv } from "./trainingWorkspace";
import { formatDateForDisplay } from "./dateUtils";

export type TrainingReportDateBasis = "assigned" | "completed" | "certificate";
export interface TrainingEnrollmentFilters {
  organizationId: string;
  facilityId?: string;
  courseSearch: string;
  status: string;
  dateBasis: TrainingReportDateBasis;
  dateFrom: string;
  dateThrough: string;
}
export interface TrainingEnrollmentRow {
  id: string; employee_id: string; student: string; facility_id: string; facility: string;
  course_id: string; course: string; status: string; assigned_at: string; due_date: string | null;
  completed_at: string | null; percent_complete: number; certificate_id: string | null;
  credential_number: string | null; certificate_issued_at: string | null; certificate_pdf_status: string | null;
}
export interface TrainingEnrollmentPage {
  organization_name: string; facility_name: string | null; generated_at: string; date_basis: TrainingReportDateBasis;
  limit: number; offset: number; total: number; students: number; completed: number;
  in_progress: number; not_started: number; canceled: number; completion_denominator: number;
  certificates: number; revision: string; rows: TrainingEnrollmentRow[];
}
export const DATE_BASIS_LABELS: Record<TrainingReportDateBasis, string> = {
  assigned: "Enrollment date", completed: "Completion date", certificate: "Certificate issue date",
};
const countKeys = ["limit", "offset", "total", "students", "completed", "in_progress", "not_started", "canceled", "completion_denominator", "certificates"] as const;

export function parseTrainingEnrollmentPage(value: unknown): TrainingEnrollmentPage {
  const fail = () => { throw new Error("The training report was incomplete. Refresh before exporting."); };
  if (!value || typeof value !== "object") return fail();
  const page = value as TrainingEnrollmentPage;
  if (countKeys.some(key => !Number.isSafeInteger(page[key]) || page[key] < 0)
    || page.limit < 1 || page.limit > 500 || !Array.isArray(page.rows)
    || page.rows.length !== Math.min(page.limit, Math.max(0, page.total - page.offset))
    || typeof page.organization_name !== "string" || typeof page.generated_at !== "string"
    || (page.facility_name !== null && typeof page.facility_name !== "string")
    || typeof page.revision !== "string" || !/^[a-f0-9]{32}$/.test(page.revision)
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

/** Read every bounded page, refusing a mixed snapshot, repeated rows or missing pages. */
export async function collectTrainingEnrollmentReport(readPage: (offset: number, limit: number) => Promise<TrainingEnrollmentPage>): Promise<TrainingEnrollmentPage> {
  const first = parseTrainingEnrollmentPage(await readPage(0, 500));
  const rows = [...first.rows];
  const ids = new Set(rows.map(row => row.id));
  while (rows.length < first.total) {
    const page = parseTrainingEnrollmentPage(await readPage(rows.length, 500));
    if (page.revision !== first.revision || page.total !== first.total || page.offset !== rows.length || !page.rows.length) {
      throw new Error("Training records changed while exporting. Refresh and try again; no incomplete report was created.");
    }
    for (const row of page.rows) {
      if (ids.has(row.id)) throw new Error("The report repeated an enrollment. Refresh and try again.");
      ids.add(row.id); rows.push(row);
    }
  }
  if (rows.length !== first.total) throw new Error("The report was incomplete. Refresh and try again.");
  return { ...first, rows };
}

export function trainingEnrollmentScope(filters: TrainingEnrollmentFilters): string {
  return `${DATE_BASIS_LABELS[filters.dateBasis]}: ${filters.dateFrom || "all past dates"} through ${filters.dateThrough || "all future dates"} (Pennsylvania time). Status: ${filters.status}. Course title: ${filters.courseSearch || "all courses"}. ${filters.dateBasis === "assigned" ? "Each course assignment counts as one enrollment; annual repeats count separately." : "Only enrollments with the selected date recorded are included."} Completion rate = completed enrollments / non-canceled enrollments in this filtered report. This is training activity, not certification of facility compliance.`;
}
export const TRAINING_REPORT_HEADERS = ["Student", "Facility", "Course", "Status", "Progress %", "Enrolled", "Due", "Completed", "Certificate number", "Certificate issued", "Certificate PDF status", "Enrollment ID"];
export function trainingEnrollmentCells(row: TrainingEnrollmentRow): string[] {
  return [row.student, row.facility, row.course, row.status.replaceAll("_", " "), String(row.percent_complete),
    formatDateForDisplay(row.assigned_at), formatDateForDisplay(row.due_date), formatDateForDisplay(row.completed_at),
    row.credential_number || "", formatDateForDisplay(row.certificate_issued_at), row.certificate_pdf_status || "", row.id];
}
export function trainingEnrollmentCsv(report: TrainingEnrollmentPage, filters: TrainingEnrollmentFilters): string {
  return trainingCsv([
    ["Training enrollment, completion and certificates", report.organization_name],
    ["Generated", report.generated_at], ["Facility scope", report.facility_name || "All accessible facilities in selected organization"],
    [trainingEnrollmentScope(filters)],
    ["Enrollments", report.total, "Students", report.students, "Completed", report.completed, "Non-canceled enrollments", report.completion_denominator, "Issued certificates", report.certificates],
    [], TRAINING_REPORT_HEADERS, ...report.rows.map(trainingEnrollmentCells),
  ]);
}
