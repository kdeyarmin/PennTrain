insert into storage.buckets (id, name, public) values ('credential-documents', 'credential-documents', false)
on conflict (id) do nothing;

create policy "credential-documents read" on storage.objects for select to authenticated using (
  bucket_id = 'credential-documents'
  and exists (
    select 1 from public.employee_credential_documents d
    where d.storage_bucket = storage.objects.bucket_id
      and d.storage_path = storage.objects.name
      and (
        public.is_platform_admin()
        or public.owns_employee(d.employee_id)
        or (d.organization_id = (select public.current_org_id())
            and ((select public.current_role()) in ('org_admin','auditor')
                 or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(d.facility_id))))
      )
  )
);

create policy "credential-documents write" on storage.objects for insert to authenticated with check (
  bucket_id = 'credential-documents'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) in ('org_admin','facility_manager')
        and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid))
  )
);

create policy "credential-documents delete" on storage.objects for delete to authenticated using (
  bucket_id = 'credential-documents'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) = 'org_admin')
  )
);
