insert into storage.buckets (id, name, public)
values ('administrator-documents', 'administrator-documents', false)
on conflict (id) do nothing;

-- Path convention: {organization_id}/{profile_id}/... -- self-service like the table RLS above:
-- the administrator can manage their own evidence, org_admin can manage anyone's org-wide.
create policy "administrator-documents read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'administrator-documents'
    and (
      public.is_platform_admin()
      or (storage.foldername(name))[2] = (select auth.uid())::text
      or ((storage.foldername(name))[1] = (select public.current_org_id())::text and (select public.current_role()) in ('org_admin','auditor'))
    )
  );

create policy "administrator-documents write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'administrator-documents'
    and (
      public.is_platform_admin()
      or (storage.foldername(name))[2] = (select auth.uid())::text
      or ((storage.foldername(name))[1] = (select public.current_org_id())::text and (select public.current_role()) = 'org_admin')
    )
  );

create policy "administrator-documents delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'administrator-documents'
    and (
      public.is_platform_admin()
      or (storage.foldername(name))[2] = (select auth.uid())::text
      or ((storage.foldername(name))[1] = (select public.current_org_id())::text and (select public.current_role()) = 'org_admin')
    )
  );
