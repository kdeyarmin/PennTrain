import { describe, expect, it } from "vitest";
import {
  type DocumentAnalyzerJob,
  isDraftCompleteForApproval,
  isDraftDirty,
  isPdfFileName,
  isPotentialResidentDuplicate,
  jobToDraft,
  makeAnalyzerUploadPath,
  normalizeResidentName,
  parseAnalyzerIssues,
  splitResidentName,
  summarizeAnalyzerJobs,
} from "./documentAnalyzer";

function job(overrides: Partial<DocumentAnalyzerJob> = {}): DocumentAnalyzerJob {
  return {
    id: "job-1",
    requested_by: "profile-1",
    file_name: "Martha_Ellis.pdf",
    file_size: 900_000,
    source_bucket: "state-form-analyzer",
    source_path: "uploads/abc-Martha_Ellis.pdf",
    status: "needs_review",
    attempt_count: 1,
    max_attempts: 3,
    current_run_id: null,
    worker_id: null,
    available_at: "2026-07-12T00:00:00.000Z",
    locked_at: null,
    last_started_at: null,
    completed_at: "2026-07-12T00:01:00.000Z",
    model: "claude-fable-5",
    page_count: 4,
    confidence: 86,
    resident_name: "Martha J. Ellis",
    facility_name: "Sunrise Personal Care Home",
    state_form_template: "RASP (Resident Assessment-Support Plan)",
    review_due_date: "07/12/2026",
    admission_date: null,
    notes: "Walker with standby assist.",
    issues: [],
    approved_for_export: false,
    approved_by: null,
    approved_at: null,
    organization_id: null,
    facility_id: null,
    chart_creation_status: "not_asked",
    chart_resident_id: null,
    last_error_code: null,
    last_error_message: null,
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z",
    ...overrides,
  };
}

describe("documentAnalyzer", () => {
  it("accepts pdf file names only", () => {
    expect(isPdfFileName("resident-form.PDF")).toBe(true);
    expect(isPdfFileName("resident-form.png")).toBe(false);
  });

  it("builds upload paths that satisfy the enqueue RPC's uploads/ pdf rule", () => {
    const path = makeAnalyzerUploadPath(" Martha_Ellis.pdf ");
    expect(path.startsWith("uploads/")).toBe(true);
    expect(path.toLowerCase().endsWith(".pdf")).toBe(true);
  });

  it("summarizes batch status from durable job rows", () => {
    const summary = summarizeAnalyzerJobs([
      job({ status: "ready", approved_for_export: false }),
      job({ id: "job-2", status: "queued" }),
      job({
        id: "job-3",
        status: "needs_review",
        issues: [{ field: "review_due_date", message: "Smudged", severity: "warning", suggested_value: null }],
      }),
    ]);
    expect(summary).toMatchObject({
      total: 3,
      ready: 1,
      needsReview: 1,
      inProgress: 1,
      failed: 0,
      approved: 0,
      totalIssues: 1,
      isComplete: false,
    });
  });

  it("parses stored issues defensively", () => {
    const issues = parseAnalyzerIssues([
      { field: "notes", message: "Margin note illegible", severity: "info", suggested_value: "" },
      { field: "review_due_date", message: "Confirm year", severity: "warning", suggested_value: "07/12/2026" },
      { message: "dropped: missing field" },
      "dropped: not an object",
    ]);
    expect(issues).toEqual([
      { field: "notes", message: "Margin note illegible", severity: "info", suggested_value: null },
      { field: "review_due_date", message: "Confirm year", severity: "warning", suggested_value: "07/12/2026" },
    ]);
    expect(parseAnalyzerIssues(null)).toEqual([]);
    expect(parseAnalyzerIssues("bad" as never)).toEqual([]);
  });

  it("tracks draft edits and approval readiness against the row", () => {
    const row = job();
    const draft = jobToDraft(row);
    expect(isDraftDirty(row, draft)).toBe(false);
    expect(isDraftCompleteForApproval(draft)).toBe(true);

    const edited = { ...draft, reviewDueDate: "08/01/2026" };
    expect(isDraftDirty(row, edited)).toBe(true);
    expect(isDraftCompleteForApproval({ ...draft, residentName: "  " })).toBe(false);
  });

  it("parses resident names for chart creation", () => {
    expect(splitResidentName("Martha J. Ellis")).toEqual({ firstName: "Martha J.", lastName: "Ellis" });
    expect(splitResidentName("Martha")).toEqual({ firstName: "Martha", lastName: "Unknown" });
  });

  it("detects potential duplicate residents before creating a chart", () => {
    expect(normalizeResidentName(" Martha J. Ellis ")).toBe("martha j ellis");
    const draft = { residentName: "Martha J. Ellis", facilityId: "facility-1" };
    expect(isPotentialResidentDuplicate(draft, { first_name: "Martha J.", last_name: "Ellis", facility_id: "facility-1" })).toBe(true);
    expect(isPotentialResidentDuplicate(draft, { first_name: "Martha J.", last_name: "Ellis", facility_id: "facility-2" })).toBe(false);
    expect(isPotentialResidentDuplicate({ ...draft, facilityId: "" }, { first_name: "Martha J.", last_name: "Ellis", facility_id: "facility-1" })).toBe(false);
  });
});
