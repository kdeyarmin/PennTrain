insert into storage.buckets (id, name, public) values
  ('external-uploads', 'external-uploads', false),
  ('signin-sheets', 'signin-sheets', false),
  ('competency-attachments', 'competency-attachments', false)
on conflict (id) do nothing;

create policy "external-uploads rw" on storage.objects for all to authenticated using (
  bucket_id = 'external-uploads'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin','auditor')
             or public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)))
  )
) with check (
  bucket_id = 'external-uploads'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin','facility_manager','trainer')
             and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)))
  )
);

create policy "signin-sheets rw" on storage.objects for all to authenticated using (
  bucket_id = 'signin-sheets'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin','auditor')
             or public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)))
  )
) with check (
  bucket_id = 'signin-sheets'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin','facility_manager','trainer')
             and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)))
  )
);

create policy "competency-attachments rw" on storage.objects for all to authenticated using (
  bucket_id = 'competency-attachments'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin','auditor')
             or public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)))
  )
) with check (
  bucket_id = 'competency-attachments'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin','facility_manager','trainer')
             and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)))
  )
);
