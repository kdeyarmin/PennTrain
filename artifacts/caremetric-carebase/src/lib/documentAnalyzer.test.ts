import { describe, expect, it } from "vitest";
import { approveJobForExport, createDocumentAnalyzerJob, declineResidentChartCreation, isPdfFileName, isPotentialResidentDuplicate, markResidentChartCreated, nextJobState, normalizeResidentName, splitResidentName, summarizeBatch, updateJobDraft } from "./documentAnalyzer";

describe("documentAnalyzer", () => {
  it("accepts pdf file names only", () => {
    expect(isPdfFileName("resident-form.PDF")).toBe(true);
    expect(isPdfFileName("resident-form.png")).toBe(false);
  });

  it("creates stable queued jobs with safe defaults", () => {
    const job = createDocumentAnalyzerJob({ name: "Martha_Ellis.pdf", size: 900_000 }, new Date("2026-07-12T00:00:00.000Z"));
    expect(job.status).toBe("queued");
    expect(job.pages).toBe(2);
    expect(job.residentName).toBe("Martha Ellis");
  });

  it("summarizes asynchronous batch status", () => {
    const first = createDocumentAnalyzerJob({ name: "ready.pdf", size: 1 }, new Date("2026-07-12T00:00:00.000Z"));
    const second = createDocumentAnalyzerJob({ name: "queued.pdf", size: 1 }, new Date("2026-07-12T00:00:00.000Z"));
    const summary = summarizeBatch([{ ...first, status: "ready", progress: 100 }, second]);
    expect(summary).toMatchObject({ total: 2, ready: 1, inProgress: 1, approved: 0, isComplete: false });
  });

  it("advances queued jobs through processing to a reviewable result", () => {
    const job = createDocumentAnalyzerJob({ name: "Martha_Ellis.pdf", size: 1 }, new Date("2026-07-12T00:00:00.000Z"));
    const processing = nextJobState(job, new Date("2026-07-12T00:01:00.000Z"));
    expect(processing.status).toBe("processing");

    const completed = [1, 2, 3, 4].reduce((current) => nextJobState(current, new Date("2026-07-12T00:02:00.000Z")), processing);
    expect(completed.progress).toBe(100);
    expect(["ready", "needs_review"]).toContain(completed.status);
  });

  it("keeps manual corrections editable and requires approval before export", () => {
    const job = {
      ...createDocumentAnalyzerJob({ name: "Martha_Ellis.pdf", size: 1 }, new Date("2026-07-12T00:00:00.000Z")),
      status: "ready" as const,
      progress: 100,
      facility: "Sample Home",
      currentStateForm: "2026 Annual Resident Assessment",
      reviewDueDate: "07/12/2026",
    };

    const corrected = updateJobDraft(job, { notes: "Corrected emergency contact after human review." }, new Date("2026-07-12T00:03:00.000Z"));
    expect(corrected.notes).toContain("Corrected emergency contact");
    expect(corrected.approvedForExport).toBe(false);

    const approved = approveJobForExport(corrected, new Date("2026-07-12T00:04:00.000Z"));
    expect(approved.approvedForExport).toBe(true);
  });

  it("parses resident names and tracks chart creation choices", () => {
    expect(splitResidentName("Martha J. Ellis")).toEqual({ firstName: "Martha J.", lastName: "Ellis" });
    expect(splitResidentName("Martha")).toEqual({ firstName: "Martha", lastName: "Unknown" });

    const job = createDocumentAnalyzerJob({ name: "Martha_Ellis.pdf", size: 1 }, new Date("2026-07-12T00:00:00.000Z"));
    expect(markResidentChartCreated(job, "resident-1").chartCreationStatus).toBe("created");
    expect(declineResidentChartCreation(job).chartCreationStatus).toBe("declined");
  });

  it("detects potential duplicate residents before creating a chart", () => {
    const job = { ...createDocumentAnalyzerJob({ name: "Martha_J_Ellis.pdf", size: 1 }), residentName: "Martha J. Ellis", facilityId: "facility-1" };
    expect(normalizeResidentName(" Martha J. Ellis ")).toBe("martha j ellis");
    expect(isPotentialResidentDuplicate(job, { first_name: "Martha J.", last_name: "Ellis", facility_id: "facility-1" })).toBe(true);
    expect(isPotentialResidentDuplicate(job, { first_name: "Martha J.", last_name: "Ellis", facility_id: "facility-2" })).toBe(false);
  });
});
