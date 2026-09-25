import { describe, expect, it, vi } from "vitest";
import {
  collectTrainingEnrollmentReport, parseTrainingEnrollmentPage, trainingEnrollmentCsv,
  trainingEnrollmentScope, type TrainingEnrollmentFilters, type TrainingEnrollmentPage, type TrainingEnrollmentRow,
} from "./trainingEnrollmentReport";

const filters: TrainingEnrollmentFilters = { organizationId: "org", status: "all", courseSearch: "", dateBasis: "assigned", dateFrom: "", dateThrough: "" };
const row = (id: number): TrainingEnrollmentRow => ({ id: String(id), employee_id: `e${id}`, student: `Student ${id}`, facility_id: "facility", facility: "Personal Care Home", course_id: "course", course: "Safety", status: "assigned", assigned_at: "2026-09-24T15:00:00Z", due_date: null, completed_at: null, percent_complete: 0, certificate_id: null, credential_number: null, certificate_issued_at: null, certificate_pdf_status: null });
const report = (total: number, offset = 0, limit = 500): TrainingEnrollmentPage => ({ organization_name: "Customer", facility_name: null, generated_at: "2026-09-24T15:00:00Z", date_basis: "assigned", limit, offset, total, students: total, completed: 0, in_progress: 0, not_started: total, canceled: 0, completion_denominator: total, certificates: 0, revision: "a".repeat(32), rows: Array.from({ length: Math.min(limit, Math.max(0, total - offset)) }, (_, n) => row(offset + n)) });

describe("complete training enrollment reports", () => {
  it("exports every enrollment beyond the server cap without double counting", async () => {
    const reader = vi.fn(async (offset: number, limit: number) => report(1001, offset, limit));
    const result = await collectTrainingEnrollmentReport(reader);
    expect(reader.mock.calls).toEqual([[0, 500], [500, 500], [1000, 500]]);
    expect(result.rows).toHaveLength(1001);
    const csv = trainingEnrollmentCsv(result, filters);
    expect(csv).toContain("Student 1000");
    expect(csv).toContain("Completion rate = completed enrollments / non-canceled enrollments");
  });
  it("rejects changed filters/results during paged export instead of creating an incomplete artifact", async () => {
    await expect(collectTrainingEnrollmentReport(async offset => ({ ...report(501, offset), revision: offset ? "b".repeat(32) : "a".repeat(32) }))).rejects.toThrow("changed while exporting");
    await expect(collectTrainingEnrollmentReport(async offset => ({ ...report(501, offset), rows: offset ? [row(0)] : report(501).rows }))).rejects.toThrow("repeated an enrollment");
  });
  it("refuses silent truncation, invalid totals and out-of-range progress", () => {
    expect(() => parseTrainingEnrollmentPage({ ...report(20), rows: [row(0)] })).toThrow("incomplete");
    expect(() => parseTrainingEnrollmentPage({ ...report(1), completion_denominator: 2 })).toThrow("incomplete");
    expect(() => parseTrainingEnrollmentPage({ ...report(1), rows: [{ ...row(0), percent_complete: 101 }] })).toThrow("incomplete");
  });
  it("keeps zero results valid and states each selected date basis", async () => {
    expect((await collectTrainingEnrollmentReport(async () => report(0))).rows).toEqual([]);
    expect(trainingEnrollmentScope({ ...filters, dateBasis: "completed", dateFrom: "2026-01-01" })).toContain("Completion date: 2026-01-01");
    expect(trainingEnrollmentScope({ ...filters, dateBasis: "certificate" })).toContain("Only enrollments with the selected date recorded");
  });
  it("neutralizes spreadsheet formulas in learner and course names", () => {
    const data = report(1);
    data.rows[0].student = "=HYPERLINK(\"https://example.invalid\")";
    const csv = trainingEnrollmentCsv(data, filters);
    expect(csv).toContain("'=HYPERLINK");
  });
});
