-- Forward-fix (review finding): training_classes_write authorizes a trainer to manage any class
-- they are the named instructor on, regardless of facility assignment (ownership-only check:
-- `current_role()='trainer' and trainer_profile_id = auth.uid()`) -- TrainerClasses.tsx lets a
-- class be scheduled at any facility regardless of the chosen trainer's own facility_assignments,
-- so a traveling trainer covering a one-off session at a facility that isn't their normal post can
-- legitimately manage that class end-to-end. But training_documents_insert and the "signin-sheets rw"
-- storage policy both additionally require is_assigned_to_facility(facility_id) -- so that same
-- trainer, fully authorized to run and complete the class, cannot upload its paper sign-in-sheet
-- roster (ClassDetail.tsx's "Upload Roster" button): the training_documents insert is rejected, then
-- the storage.objects write is rejected too, with only a generic "Failed to upload roster" toast and
-- no indication why.
--
-- Fix: let a trainer's own class stand in for facility assignment specifically for a roster upload
-- (document_type='roster', no employee owner -- exactly the shape ClassDetail.tsx's
-- handleRosterUpload produces) when a training_classes row proves they're the class's trainer at
-- that facility, mirroring training_classes_write's own ownership predicate. This only widens
-- access for that one document_type/upload shape; every other training_documents_insert/
-- signin-sheets path is unchanged.
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
      where tc.organization_id = (select public.current_org_id())
        and tc.facility_id = training_documents.facility_id
        and tc.trainer_profile_id = (select auth.uid())
    )
  )
);

-- "signin-sheets rw" is a single `for all` policy; widen both USING (read/overwrite/delete) and
-- WITH CHECK (insert) identically so a trainer can also read back a roster they were legitimately
-- allowed to upload under their own class, not just write it once and never see it again.
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
        where tc.organization_id = (select public.current_org_id())
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
        where tc.organization_id = (select public.current_org_id())
          and tc.facility_id = ((storage.foldername(name))[2])::uuid
          and tc.trainer_profile_id = (select auth.uid())
      )
    )
  )
);
