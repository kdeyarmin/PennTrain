-- Same reasoning as violation-documents/incident-documents: trainer excluded from read/write, no
-- self-service branch (no employee/resident owner to grant read access to).
insert into storage.buckets (id, name, public) values ('resident-documents', 'resident-documents', false)
on conflict (id) do nothing;

create policy "resident-documents read" on storage.objects for select to authenticated using (
  bucket_id = 'resident-documents'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin', 'auditor')
             or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid))))
  )
);

create policy "resident-documents write" on storage.objects for insert to authenticated with check (
  bucket_id = 'resident-documents'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid))
  )
);

create policy "resident-documents delete" on storage.objects for delete to authenticated using (
  bucket_id = 'resident-documents'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) = 'org_admin')
  )
);
