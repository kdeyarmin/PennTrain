import type { Json, Tables } from "@/lib/database.types";

// Pure helpers for the State Form Document Analyzer. Jobs are durable
// document_analyzer_jobs rows written by SECURITY DEFINER RPCs and the
// analyze-state-form edge worker; everything here just derives view state from those
// rows, so it stays unit-testable without a Supabase client.

export type DocumentAnalyzerJob = Tables<"document_analyzer_jobs">;

export type DocumentAnalyzerJobStatus = "queued" | "processing" | "needs_review" | "ready" | "failed";

export interface AnalyzerExtractionIssue {
  field: string;
  message: string;
  suggested_value: string | null;
  severity: "warning" | "info";
}

/** The editable review draft the page maintains for the selected job. */
export interface AnalyzerJobDraft {
  residentName: string;
  facilityName: string;
  stateFormTemplate: string;
  reviewDueDate: string;
  admissionDate: string;
  notes: string;
  facilityId: string;
}

const PDF_EXTENSION = /\.pdf$/i;

export function isPdfFileName(fileName: string): boolean {
  return PDF_EXTENSION.test(fileName.trim());
}

/** Storage object path for a new upload; must satisfy the enqueue RPC's uploads/ check. */
export function makeAnalyzerUploadPath(fileName: string): string {
  return `uploads/${crypto.randomUUID()}-${fileName.trim()}`;
}

export function isActiveAnalyzerStatus(status: string): boolean {
  return status === "queued" || status === "processing";
}

export function canReviewAnalyzerStatus(status: string): boolean {
  return status === "needs_review" || status === "ready";
}

/**
 * Defensive parse of the issues jsonb column. The worker validated the model output
 * before persisting, but the UI still never trusts stored shapes blindly.
 */
export function parseAnalyzerIssues(issues: Json | null | undefined): AnalyzerExtractionIssue[] {
  if (!Array.isArray(issues)) return [];
  const parsed: AnalyzerExtractionIssue[] = [];
  for (const item of issues) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const raw = item as Record<string, Json | undefined>;
    if (typeof raw.field !== "string" || typeof raw.message !== "string") continue;
    parsed.push({
      field: raw.field,
      message: raw.message,
      suggested_value: typeof raw.suggested_value === "string" && raw.suggested_value.length > 0
        ? raw.suggested_value
        : null,
      severity: raw.severity === "info" ? "info" : "warning",
    });
  }
  return parsed;
}

export function jobToDraft(job: DocumentAnalyzerJob): AnalyzerJobDraft {
  return {
    residentName: job.resident_name,
    facilityName: job.facility_name,
    stateFormTemplate: job.state_form_template,
    reviewDueDate: job.review_due_date,
    admissionDate: job.admission_date ?? "",
    notes: job.notes,
    facilityId: job.facility_id ?? "",
  };
}

export function isDraftDirty(job: DocumentAnalyzerJob, draft: AnalyzerJobDraft): boolean {
  const base = jobToDraft(job);
  return (Object.keys(base) as (keyof AnalyzerJobDraft)[]).some((key) => base[key] !== draft[key]);
}

/** Mirrors approve_document_analyzer_job's required-field rule for pre-flight UI checks. */
export function isDraftCompleteForApproval(draft: AnalyzerJobDraft): boolean {
  return draft.residentName.trim().length > 0
    && draft.facilityName.trim().length > 0
    && draft.stateFormTemplate.trim().length > 0
    && draft.reviewDueDate.trim().length > 0;
}

export function summarizeAnalyzerJobs(jobs: DocumentAnalyzerJob[]) {
  const ready = jobs.filter((job) => job.status === "ready").length;
  const needsReview = jobs.filter((job) => job.status === "needs_review").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  const inProgress = jobs.filter((job) => isActiveAnalyzerStatus(job.status)).length;
  const totalIssues = jobs.reduce((total, job) => total + parseAnalyzerIssues(job.issues).length, 0);
  const approved = jobs.filter((job) => job.approved_for_export).length;

  return {
    total: jobs.length,
    ready,
    needsReview,
    failed,
    inProgress,
    totalIssues,
    approved,
    isComplete: jobs.length > 0 && inProgress === 0,
  };
}

// Mirrors MAX_PACKET_JOBS in the generate-analyzer-packet edge function: the server
// refuses explicit selections larger than one packet, so approval sets beyond this
// size export as sequential batches in the server's own approved_at order.
export const ANALYZER_EXPORT_BATCH_SIZE = 200;

export function approvedExportBatches(
  jobs: DocumentAnalyzerJob[],
  batchSize = ANALYZER_EXPORT_BATCH_SIZE,
): string[][] {
  const approved = jobs
    .filter((job) => job.approved_for_export)
    .sort((a, b) =>
      (a.approved_at ?? "").localeCompare(b.approved_at ?? "") || a.id.localeCompare(b.id));
  const batches: string[][] = [];
  for (let start = 0; start < approved.length; start += batchSize) {
    batches.push(approved.slice(start, start + batchSize).map((job) => job.id));
  }
  return batches;
}

export function splitResidentName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "Unknown" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

export function normalizeResidentName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isPotentialResidentDuplicate(
  draft: Pick<AnalyzerJobDraft, "residentName" | "facilityId">,
  resident: { first_name: string; last_name: string; facility_id: string },
): boolean {
  if (!draft.facilityId || draft.facilityId !== resident.facility_id) return false;
  return normalizeResidentName(draft.residentName) === normalizeResidentName(`${resident.first_name} ${resident.last_name}`);
}
