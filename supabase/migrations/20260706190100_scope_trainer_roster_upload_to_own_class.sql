-- Forward-fix (Copilot + Codex review on PR #43): the trainer roster exception added in
-- 20260706101450_allow_trainer_roster_upload_outside_facility_assignment.sql proved a trainer is
-- assigned to SOME class at the target facility, but never checked WHICH class the actual
-- storage_path/object belongs to. Both the roster upload path
-- (`<org>/<facility>/<classId>/<filename>`, per ClassDetail.tsx's handleRosterUpload) and the
-- corresponding training_documents.storage_path column already carry the specific class id --
-- this fix just checks it. Without it, a trainer who teaches Class A at Facility F could read,
-- overwrite, or delete Class B's roster/sign-in sheet at the same facility, or insert a
-- training_documents row falsely labeled as evidence for a class they have nothing to do with.
alter policy training_documents_insert on public.training_documents with check (
  public.is_platform_admin()
  or (employee_id is not null and exists (select 1 from public.employees e where e.id = training_documents.employee_id and e.profile_id = (select auth.uid())))
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
  or (
    (select public.current_role()) = 'trainer'
    and document_type = 'roster'
    and employee_id is null
    and organization_id = (select public.current_org_id())
    and exists (
      select 1 from public.training_classes tc
      where tc.id = split_part(training_documents.storage_path, '/', 3)::uuid
        and tc.organization_id = (select public.current_org_id())
        and tc.facility_id = training_documents.facility_id
        and tc.trainer_profile_id = (select auth.uid())
    )
  )
);

alter policy "signin-sheets rw" on storage.objects using (
  bucket_id = 'signin-sheets'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin','auditor')
             or public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)))
    or (
      (select public.current_role()) = 'trainer'
      and (storage.foldername(name))[1] = (select public.current_org_id())::text
      and exists (
        select 1 from public.training_classes tc
        where tc.id = ((storage.foldername(name))[3])::uuid
          and tc.organization_id = (select public.current_org_id())
          and tc.facility_id = ((storage.foldername(name))[2])::uuid
          and tc.trainer_profile_id = (select auth.uid())
      )
    )
  )
) with check (
  bucket_id = 'signin-sheets'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin','facility_manager','trainer')
             and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)))
    or (
      (select public.current_role()) = 'trainer'
      and (storage.foldername(name))[1] = (select public.current_org_id())::text
      and exists (
        select 1 from public.training_classes tc
        where tc.id = ((storage.foldername(name))[3])::uuid
          and tc.organization_id = (select public.current_org_id())
          and tc.facility_id = ((storage.foldername(name))[2])::uuid
          and tc.trainer_profile_id = (select auth.uid())
      )
    )
  )
);
