-- Forward-fix (review finding): the "incident-reports read" storage policy's boolean expression is
-- missing a grouping paren around the role-OR clause, so the facility_manager branch is evaluated
-- without the organization_id match check that gates the org_admin/auditor branch.
--
-- The policy reads:
--   is_platform_admin() or (i.organization_id = current_org_id() and current_role() in
--   ('org_admin','auditor') or (current_role()='facility_manager' and is_assigned_to_facility(...)))
-- Because SQL `and` binds tighter than `or`, this parses as:
--   is_platform_admin() OR (org_check AND admin_or_auditor) OR (facility_manager_check)
-- -- the facility_manager branch is never ANDed with `i.organization_id = current_org_id()`, unlike
-- every correctly-scoped sibling policy (incidents_select, and the incident-documents/
-- violation-documents storage policies), which wrap the entire role-OR group in an extra paren:
-- `org_check AND (admin_or_auditor OR (facility_manager AND assigned))`.
--
-- If a facility_manager's profiles.organization_id is later reassigned to a different org (e.g. via
-- admin-update-user) while a stale facility_assignments row for their OLD org's facility is left
-- behind (admin_update_profile() only updates the profiles row, never facility_assignments), that
-- manager's is_assigned_to_facility(<old-org facility>) can still return true even though
-- current_org_id() now points at the new org. Due to the missing parens, that alone is enough to
-- read the OLD org's confidential DHS reportable-incident PDF (resident identifier, narrative, staff
-- names, investigation findings) via a direct signed-url read/download -- a cross-tenant PII leak
-- the policy's own comment ("Read mirrors incidents_select RLS") explicitly intended to prevent.
--
-- Fix: add the missing parens so the org check wraps the whole role-OR group, matching
-- incidents_select exactly.
alter policy "incident-reports read" on storage.objects using (
  bucket_id = 'incident-reports'
  and exists (
    select 1 from public.incidents i
    where i.report_pdf_storage_bucket = storage.objects.bucket_id
      and i.report_pdf_storage_path = storage.objects.name
      and (
        public.is_platform_admin()
        or (i.organization_id = (select public.current_org_id())
            and ((select public.current_role()) in ('org_admin','auditor')
                 or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(i.facility_id))))
      )
  )
);
