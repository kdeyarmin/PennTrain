-- Phase 2 review fix: Settings.tsx (logo upload) targets a bucket named 'org-branding'
-- that was never created in the Group B storage migration -- confirmed missing via
-- list_buckets and the group_b_storage_buckets.sql migration content. Path convention:
-- {organization_id}/logo.{ext}. Org-wide read (not facility-scoped) per the architecture
-- decision table; write restricted to org_admin/facility_manager (matching the corrected
-- Settings.tsx canManage gate) or platform_admin.
insert into storage.buckets (id, name, public)
values ('org-branding', 'org-branding', false)
on conflict (id) do nothing;

create policy "org-branding read" on storage.objects for select to authenticated using (
  bucket_id = 'org-branding'
  and (
    public.is_platform_admin()
    or (storage.foldername(name))[1] = (select public.current_org_id())::text
  )
);

create policy "org-branding insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'org-branding'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) in ('org_admin','facility_manager'))
  )
);

create policy "org-branding update" on storage.objects for update to authenticated using (
  bucket_id = 'org-branding'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) in ('org_admin','facility_manager'))
  )
) with check (
  bucket_id = 'org-branding'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) in ('org_admin','facility_manager'))
  )
);

create policy "org-branding delete" on storage.objects for delete to authenticated using (
  bucket_id = 'org-branding'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) in ('org_admin','facility_manager'))
  )
);
