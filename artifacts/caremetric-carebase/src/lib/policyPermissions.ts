import type { Role } from "@/lib/auth";

/**
 * Who may write policy documents, versions and attestation campaigns.
 *
 * This mirrors the `policy_documents_write` / `policy_document_versions_update` /
 * `policy_attestation_campaigns_*` policies, whose org branch is
 * `current_role() = any (array['org_admin','facility_manager'])` plus `is_platform_admin()`
 * (20260716221235). Every write control on Policies & Procedures rendered for every role that can
 * *read* the page -- and `policy_attestation_campaigns_select` deliberately admits `auditor`, whose
 * whole job is to read them. So an auditor was offered "New Policy Document", "Upload Version",
 * "Publish", "New Attestation Campaign" and "Assign", and each one ended in a 42501 toast
 * (BACKLOG.md J74, Policy).
 *
 * A hidden button is not a boundary -- RLS is, and it has not changed. This is the page telling the
 * truth about what it will be allowed to do.
 */
export const POLICY_DOCUMENT_WRITE_ROLES: readonly Role[] = [
  "platform_admin",
  "org_admin",
  "facility_manager",
];

export function canWritePolicyDocuments(role: Role | null | undefined): boolean {
  return !!role && POLICY_DOCUMENT_WRITE_ROLES.includes(role);
}

/**
 * Who may add a training document from the Documents page.
 *
 * `training_documents_insert` admits platform_admin, org_admin, facility_manager (in an assigned
 * facility) and trainer (in an assigned facility, and never a roster except through their own
 * class) -- plus any employee for their own rows, which is the `/me/documents` path, not this one.
 * `auditor` has no insert branch at all, and the whole Upload Document card rendered for them.
 */
export const DOCUMENTS_UPLOAD_ROLES: readonly Role[] = [
  "platform_admin",
  "org_admin",
  "facility_manager",
  "trainer",
];

export function canUploadTrainingDocuments(role: Role | null | undefined): boolean {
  return !!role && DOCUMENTS_UPLOAD_ROLES.includes(role);
}

/**
 * The trainer branch of `training_documents_insert` refuses `document_type = 'roster'` unless the
 * storage path names a class that trainer owns -- which the Documents page's upload never does, so
 * a trainer picking "Roster" there always met 42501. Rosters reach the same table through the class
 * page's own roster upload.
 */
export function canUploadTrainingDocumentType(role: Role | null | undefined, documentType: string): boolean {
  if (!canUploadTrainingDocuments(role)) return false;
  return !(role === "trainer" && documentType === "roster");
}
