-- Facility managers can upload compliance evidence (storage insert policy already allows them) and
-- can remove it through remove_compliance_evidence, but the storage DELETE policy only admitted
-- org_admin. useRemoveComplianceEvidence deletes the object first, so a facility manager's Remove
-- button always failed before the RPC ran. Align delete with write: same org folder, assigned
-- facility, manager roles.

drop policy if exists "compliance-evidence delete" on storage.objects;
create policy "compliance-evidence delete" on storage.objects for delete to authenticated using (
  bucket_id = 'compliance-evidence'
  and (
    public.is_platform_admin()
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
    )
  )
);
