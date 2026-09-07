import { describe, expect, it } from "vitest";
import {
  canUploadTrainingDocumentType,
  canUploadTrainingDocuments,
  canWritePolicyDocuments,
} from "./policyPermissions";

describe("policy and document write roles", () => {
  it("admits only the roles the policy_documents_write branch names", () => {
    expect(canWritePolicyDocuments("org_admin")).toBe(true);
    expect(canWritePolicyDocuments("facility_manager")).toBe(true);
    expect(canWritePolicyDocuments("platform_admin")).toBe(true);
    // The two roles the page used to offer every write control to.
    expect(canWritePolicyDocuments("auditor")).toBe(false);
    expect(canWritePolicyDocuments("trainer")).toBe(false);
    expect(canWritePolicyDocuments("employee")).toBe(false);
    expect(canWritePolicyDocuments(undefined)).toBe(false);
  });

  it("keeps the Documents upload card away from the role with no insert branch", () => {
    expect(canUploadTrainingDocuments("trainer")).toBe(true);
    expect(canUploadTrainingDocuments("facility_manager")).toBe(true);
    expect(canUploadTrainingDocuments("auditor")).toBe(false);
    expect(canUploadTrainingDocuments(null)).toBe(false);
  });

  it("refuses a roster upload for the one role whose insert branch excludes it", () => {
    expect(canUploadTrainingDocumentType("trainer", "certificate")).toBe(true);
    expect(canUploadTrainingDocumentType("trainer", "roster")).toBe(false);
    expect(canUploadTrainingDocumentType("facility_manager", "roster")).toBe(true);
    expect(canUploadTrainingDocumentType("auditor", "certificate")).toBe(false);
  });
});
