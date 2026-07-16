import { assertEquals } from "jsr:@std/assert@1.0.14";
import { validateOrganizationExportDocument } from "./organizationExport.ts";

Deno.test("organization export document references are table, bucket, and tenant bound", () => {
  const organizationId = "10000000-0000-4000-8000-000000000001";
  assertEquals(validateOrganizationExportDocument({
    sourceTable: "training_documents",
    organizationId,
    bucket: "external-uploads",
    path: `${organizationId}/20000000-0000-4000-8000-000000000001/file.pdf`,
  }), { valid: true });
  assertEquals(validateOrganizationExportDocument({
    sourceTable: "training_documents",
    organizationId,
    bucket: "external-uploads",
    path: "90000000-0000-4000-8000-000000000009/facility/foreign.pdf",
  }), { valid: false, reason: "organization_path_mismatch" });
  assertEquals(validateOrganizationExportDocument({
    sourceTable: "incident_documents",
    organizationId,
    bucket: "external-uploads",
    path: `${organizationId}/facility/file.pdf`,
  }), { valid: false, reason: "bucket_not_allowed" });
  assertEquals(validateOrganizationExportDocument({
    sourceTable: "training_documents",
    organizationId,
    bucket: "course-documents",
    path: "system/course/file.pdf",
  }), { valid: true });
});
