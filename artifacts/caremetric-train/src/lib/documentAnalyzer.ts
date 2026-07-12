export type DocumentAnalyzerJobStatus = "queued" | "processing" | "needs_review" | "ready" | "failed";

export type DocumentAnalyzerJob = {
  id: string;
  fileName: string;
  status: DocumentAnalyzerJobStatus;
  progress: number;
  pages: number | null;
  confidence: number | null;
  facility: string;
  residentName: string;
  currentStateForm: string;
  issues: number;
  reviewDueDate: string;
  notes: string;
  approvedForExport: boolean;
  facilityId: string;
  admissionDate: string;
  chartResidentId: string | null;
  chartCreationStatus: "not_asked" | "declined" | "created";
  lastUpdated: string;
};

const PDF_EXTENSION = /\.pdf$/i;

export function isPdfFileName(fileName: string): boolean {
  return PDF_EXTENSION.test(fileName.trim());
}

export function createDocumentAnalyzerJob(file: Pick<File, "name" | "size">, now = new Date()): DocumentAnalyzerJob {
  const safeName = file.name.trim() || "Untitled state form.pdf";
  const baseName = safeName.replace(PDF_EXTENSION, "").replace(/[_-]+/g, " ").trim();
  const estimatedPages = Math.max(1, Math.min(24, Math.ceil(file.size / 450_000)));

  return {
    id: `${safeName}-${file.size}-${now.getTime()}`,
    fileName: safeName,
    status: "queued",
    progress: 0,
    pages: estimatedPages,
    confidence: null,
    facility: "Pending AI extraction",
    residentName: baseName || "Pending AI extraction",
    currentStateForm: "Current state form mapping pending",
    issues: 0,
    reviewDueDate: "Pending AI extraction",
    notes: "Pending handwriting extraction",
    approvedForExport: false,
    facilityId: "",
    admissionDate: "",
    chartResidentId: null,
    chartCreationStatus: "not_asked",
    lastUpdated: now.toISOString(),
  };
}

export function summarizeBatch(jobs: DocumentAnalyzerJob[]) {
  const ready = jobs.filter((job) => job.status === "ready").length;
  const needsReview = jobs.filter((job) => job.status === "needs_review").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  const inProgress = jobs.filter((job) => job.status === "queued" || job.status === "processing").length;
  const totalIssues = jobs.reduce((total, job) => total + job.issues, 0);
  const approved = jobs.filter((job) => job.approvedForExport).length;

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

export function nextJobState(job: DocumentAnalyzerJob, now = new Date()): DocumentAnalyzerJob {
  if (job.status === "ready" || job.status === "needs_review" || job.status === "failed") return job;

  if (job.status === "queued") {
    return { ...job, status: "processing", progress: Math.max(job.progress, 18), lastUpdated: now.toISOString() };
  }

  const nextProgress = Math.min(100, job.progress + 28);
  if (nextProgress < 100) {
    return { ...job, progress: nextProgress, lastUpdated: now.toISOString() };
  }

  const needsReview = job.fileName.length % 3 === 0;
  return {
    ...job,
    status: needsReview ? "needs_review" : "ready",
    progress: 100,
    confidence: needsReview ? 86 : 96,
    facility: "Sample Personal Care Home",
    residentName: job.residentName === "Pending AI extraction" ? "Extracted resident" : job.residentName,
    currentStateForm: "2026 Annual Resident Assessment",
    issues: needsReview ? 3 : 0,
    reviewDueDate: "07/12/2026",
    notes: "Walker with standby assist. Medication reminders transferred from handwritten notes. Emergency contact requires final verification.",
    approvedForExport: false,
    facilityId: "",
    admissionDate: "",
    chartResidentId: null,
    chartCreationStatus: "not_asked",
    lastUpdated: now.toISOString(),
  };
}

export function updateJobDraft(job: DocumentAnalyzerJob, patch: Partial<Pick<DocumentAnalyzerJob, "residentName" | "facility" | "facilityId" | "currentStateForm" | "reviewDueDate" | "admissionDate" | "notes">>, now = new Date()): DocumentAnalyzerJob {
  return { ...job, ...patch, approvedForExport: false, lastUpdated: now.toISOString() };
}

export function approveJobForExport(job: DocumentAnalyzerJob, now = new Date()): DocumentAnalyzerJob {
  const hasRequiredFields = Boolean(job.residentName.trim() && job.facility.trim() && job.currentStateForm.trim() && job.reviewDueDate.trim());
  const canApprove = hasRequiredFields && (job.status === "ready" || job.status === "needs_review");
  return { ...job, approvedForExport: canApprove, lastUpdated: now.toISOString() };
}

export function splitResidentName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "Unknown" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

export function markResidentChartCreated(job: DocumentAnalyzerJob, residentId: string, now = new Date()): DocumentAnalyzerJob {
  return { ...job, chartResidentId: residentId, chartCreationStatus: "created", lastUpdated: now.toISOString() };
}

export function declineResidentChartCreation(job: DocumentAnalyzerJob, now = new Date()): DocumentAnalyzerJob {
  return { ...job, chartCreationStatus: "declined", lastUpdated: now.toISOString() };
}

export function normalizeResidentName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isPotentialResidentDuplicate(job: Pick<DocumentAnalyzerJob, "residentName" | "facilityId">, resident: { first_name: string; last_name: string; facility_id: string }): boolean {
  if (!job.facilityId || job.facilityId !== resident.facility_id) return false;
  return normalizeResidentName(job.residentName) === normalizeResidentName(`${resident.first_name} ${resident.last_name}`);
}
