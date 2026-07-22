export interface SurveyEvidencePacketJob {
  id: string;
  status: string;
  facility_ids: string[];
  requested_at: string;
  completed_at: string | null;
  content_sha256: string | null;
  byte_size: number | null;
  correlation_id: string;
  attempt_count: number;
  max_attempts: number;
  last_error_code: string | null;
  last_error_message: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
}

export type SurveyEvidencePacketReadiness = "ready" | "stale" | "processing" | "failed";

export interface SurveyEvidencePacketManifest {
  readiness: SurveyEvidencePacketReadiness;
  readinessLabel: string;
  readinessDetail: string;
  generatedAt: string | null;
  requestedAt: string;
  facilityScopeLabel: string;
  checksumLabel: string;
  sizeLabel: string;
  correlationId: string;
  attemptsLabel: string;
  storageLabel: string;
  accessControlNote: string;
  auditTrailNote: string;
  errorDetail: string | null;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "Not recorded";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function packetReadiness(job: SurveyEvidencePacketJob, now: Date): Pick<SurveyEvidencePacketManifest, "readiness" | "readinessLabel" | "readinessDetail"> {
  if (job.status === "failed") {
    return {
      readiness: "failed",
      readinessLabel: "Needs regeneration",
      readinessDetail: "The pinned binder export failed, so this packet is not ready for survey handoff.",
    };
  }

  if (job.status !== "succeeded" || !job.completed_at) {
    return {
      readiness: "processing",
      readinessLabel: "Rendering",
      readinessDetail: "The packet is still being generated. Keep the current binder available until this job completes.",
    };
  }

  const ageMs = now.getTime() - new Date(job.completed_at).getTime();
  if (ageMs > ONE_DAY_MS) {
    return {
      readiness: "stale",
      readinessLabel: "Stale packet",
      readinessDetail: "The packet is over 24 hours old. Generate a fresh binder before using it for a live survey handoff.",
    };
  }

  return {
    readiness: "ready",
    readinessLabel: "Ready for handoff",
    readinessDetail: "The packet completed in the last 24 hours and has recorded integrity metadata.",
  };
}

export function surveyEvidencePacketManifest(job: SurveyEvidencePacketJob, now: Date = new Date()): SurveyEvidencePacketManifest {
  const readiness = packetReadiness(job, now);
  const facilityCount = job.facility_ids.length;
  const storageLabel = job.storage_bucket && job.storage_path ? `${job.storage_bucket}/${job.storage_path}` : "Not stored yet";
  const errorDetail = job.last_error_code || job.last_error_message
    ? [job.last_error_code, job.last_error_message].filter(Boolean).join(": ")
    : null;

  return {
    ...readiness,
    generatedAt: job.completed_at,
    requestedAt: job.requested_at,
    facilityScopeLabel: facilityCount === 1 ? "Single facility" : `${facilityCount} facilities`,
    checksumLabel: job.content_sha256 ? `${job.content_sha256.slice(0, 12)}…` : "Not recorded",
    sizeLabel: formatBytes(job.byte_size),
    correlationId: job.correlation_id,
    attemptsLabel: `${job.attempt_count} of ${job.max_attempts}`,
    storageLabel,
    accessControlNote: "Download links are short-lived and issued only after the existing binder job visibility/RLS check succeeds.",
    auditTrailNote: "Use the job ID, requester, correlation ID, checksum, status, and download function logs as the survey packet access trail.",
    errorDetail,
  };
}
