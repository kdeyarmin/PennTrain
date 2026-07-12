-- Org-wide reference library, not per-employee/per-facility evidence -- mirrors course-documents'
-- RLS shape (any authenticated member of the org can read; write is org_admin/facility_manager
-- only), not the per-facility-assigned pattern used by training/incident/credential documents.
-- Path convention: {org_id}/{policy_document_id}/{version_number}-{file_name}.
insert into storage.buckets (id, name, public) values ('policy-documents', 'policy-documents', false)
on conflict (id) do nothing;

create policy "policy-documents read" on storage.objects for select to authenticated using (
  bucket_id = 'policy-documents'
  and (
    public.is_platform_admin()
    or (storage.foldername(name))[1] = (select public.current_org_id())::text
  )
);

create policy "policy-documents write" on storage.objects for insert to authenticated with check (
  bucket_id = 'policy-documents'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) in ('org_admin','facility_manager'))
  )
);

create policy "policy-documents delete" on storage.objects for delete to authenticated using (
  bucket_id = 'policy-documents'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) = 'org_admin')
  )
);