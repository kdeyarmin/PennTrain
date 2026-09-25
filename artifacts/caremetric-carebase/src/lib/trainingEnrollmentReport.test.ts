import { describe, expect, it, vi } from "vitest";
import {
  collectTrainingEnrollmentReport, parseTrainingEnrollmentPage, trainingEnrollmentCells, trainingEnrollmentCsv,
  trainingEnrollmentScope, TRAINING_REPORT_EXPORT_LIMIT, type TrainingEnrollmentFilters, type TrainingEnrollmentPage, type TrainingEnrollmentRow,
} from "./trainingEnrollmentReport";

const filters: TrainingEnrollmentFilters = { organizationId: "org", status: "all", courseSearch: "", dateBasis: "assigned", dateFrom: "", dateThrough: "" };
const row = (id: number): TrainingEnrollmentRow => ({ id: String(id), employee_id: `e${id}`, student: `Student ${id}`, facility_id: "facility", facility: "Personal Care Home", course_id: "course", course: "Safety", status: "assigned", assigned_at: "2026-09-24T15:00:00Z", due_date: null, completed_at: null, percent_complete: 0, certificate_id: null, credential_number: null, certificate_issued_at: null, certificate_pdf_status: null });
const report = (total: number, offset = 0, limit = 500): TrainingEnrollmentPage => ({ organization_name: "Customer", facility_name: null, generated_at: "2026-09-24T15:00:00Z", date_basis: "assigned", limit, offset, total, students: total, completed: 0, in_progress: 0, not_started: total, canceled: 0, completion_denominator: total, certificates: 0, rows: Array.from({ length: Math.min(limit, Math.max(0, total - offset)) }, (_, n) => row(offset + n)) });

describe("complete training enrollment reports", () => {
  it.each([1001, 10_000])("exports all %i enrollments using exactly one snapshot request", async total => {
    const reader = vi.fn(async (offset: number, limit: number) => report(total, offset, limit));
    const result = await collectTrainingEnrollmentReport(reader);
    expect(reader.mock.calls).toEqual([[0, TRAINING_REPORT_EXPORT_LIMIT]]);
    expect(result.rows).toHaveLength(total);
    const csv = trainingEnrollmentCsv(result, filters);
    expect(csv).toContain(`Student ${total - 1}`);
    expect(csv).toContain("Completion rate = completed enrollments / non-canceled enrollments");
  });
  it("rejects exports over the bound and never returns a partial report", async () => {
    const reader = vi.fn(async () => report(10_001, 0, TRAINING_REPORT_EXPORT_LIMIT));
    await expect(collectTrainingEnrollmentReport(reader)).rejects.toThrow("exceeds 10,000 enrollments");
    expect(reader).toHaveBeenCalledTimes(1);
    await expect(collectTrainingEnrollmentReport(async () => { throw new Error("Narrow the dates, course or facility"); })).rejects.toThrow("Narrow the dates");
  });
  it("rejects truncated, duplicate or non-export responses", async () => {
    await expect(collectTrainingEnrollmentReport(async () => report(501))).rejects.toThrow("incomplete");
    await expect(collectTrainingEnrollmentReport(async () => ({ ...report(2, 0, TRAINING_REPORT_EXPORT_LIMIT), rows: [row(0), row(0)] }))).rejects.toThrow("incomplete");
    await expect(collectTrainingEnrollmentReport(async () => report(1, 1, TRAINING_REPORT_EXPORT_LIMIT))).rejects.toThrow("incomplete");
    await expect(collectTrainingEnrollmentReport(async () => report(1))).rejects.toThrow("incomplete");
  });
  it("refuses silent truncation, invalid totals and out-of-range progress", () => {
    expect(() => parseTrainingEnrollmentPage(report(1, 0, 501))).toThrow("incomplete");
    expect(() => parseTrainingEnrollmentPage({ ...report(20), rows: [row(0)] })).toThrow("incomplete");
    expect(() => parseTrainingEnrollmentPage({ ...report(1), completion_denominator: 2 })).toThrow("incomplete");
    expect(() => parseTrainingEnrollmentPage({ ...report(1), rows: [{ ...row(0), percent_complete: 101 }] })).toThrow("incomplete");
  });
  it("keeps zero results valid and states each selected date basis", async () => {
    expect((await collectTrainingEnrollmentReport(async () => report(0, 0, TRAINING_REPORT_EXPORT_LIMIT))).rows).toEqual([]);
    expect(trainingEnrollmentScope({ ...filters, dateBasis: "completed", dateFrom: "2026-01-01" })).toContain("Completion date: 2026-01-01");
    expect(trainingEnrollmentScope({ ...filters, dateBasis: "certificate" })).toContain("Only enrollments with the selected date recorded");
  });
  it.each(["UTC", "Asia/Tokyo", "America/Los_Angeles"])("keeps displayed and exported dates on the filtered Pennsylvania day in a %s browser", browserTimeZone => {
    const nativeFormat = Date.prototype.toLocaleDateString;
    const format = vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (this: Date, locale, options) {
      return nativeFormat.call(this, locale, { timeZone: browserTimeZone, ...options });
    });
    try {
      const data = report(1);
      data.rows[0] = { ...row(0), assigned_at: "2026-01-01T02:00:00Z", completed_at: "2026-01-01T02:00:00Z", certificate_issued_at: "2026-01-01T02:00:00Z", due_date: "2026-01-01" };
      const cells = trainingEnrollmentCells(data.rows[0]);
      expect([cells[5], cells[7], cells[9]]).toEqual(["12/31/2025", "12/31/2025", "12/31/2025"]);
      expect(cells[6]).toBe("1/1/2026");
      const csv = trainingEnrollmentCsv(data, { ...filters, dateBasis: "completed", dateFrom: "2025-12-31", dateThrough: "2025-12-31" });
      expect(csv).toContain("Completion date: 2025-12-31 through 2025-12-31 (Pennsylvania time)");
      expect(csv).toContain('"12/31/2025","1/1/2026","12/31/2025","","12/31/2025"');
    } finally {
      format.mockRestore();
    }
  });
  it("neutralizes spreadsheet formulas in learner and course names", () => {
    const data = report(1);
    data.rows[0].student = "=HYPERLINK(\"https://example.invalid\")";
    const csv = trainingEnrollmentCsv(data, filters);
    expect(csv).toContain("'=HYPERLINK");
  });
});
