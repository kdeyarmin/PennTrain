const DOCUMENT_BUCKETS: Record<string, ReadonlySet<string>> = {
  training_documents: new Set([
    "external-uploads",
    "signin-sheets",
    "competency-attachments",
    "course-documents",
  ]),
  incident_documents: new Set(["incident-documents"]),
  resident_documents: new Set(["resident-documents"]),
};

export function validateOrganizationExportDocument(input: {
  sourceTable: string;
  organizationId: string;
  bucket: string;
  path: string;
}): { valid: true } | { valid: false; reason: string } {
  const allowedBuckets = DOCUMENT_BUCKETS[input.sourceTable];
  if (!allowedBuckets?.has(input.bucket)) return { valid: false, reason: "bucket_not_allowed" };
  const segments = input.path.split("/");
  if (
    segments.length < 2 || segments.some((segment) => !segment || segment === "." || segment === "..") ||
    input.path.includes("\\")
  ) return { valid: false, reason: "invalid_path" };
  const systemCourseDocument = input.sourceTable === "training_documents" &&
    input.bucket === "course-documents" && segments[0] === "system";
  if (!systemCourseDocument && segments[0] !== input.organizationId) {
    return { valid: false, reason: "organization_path_mismatch" };
  }
  return { valid: true };
}
