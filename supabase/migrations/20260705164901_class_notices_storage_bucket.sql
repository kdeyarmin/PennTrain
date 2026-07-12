-- class-notices: generated "Notice of Staff Meeting" PDFs (class details + check-in QR +
-- printed sign-in lines), written only by the generate-class-notice-pdf Edge Function
-- (service-role key). Path convention: {organization_id}/{class_id}.pdf. Mirrors
-- binder-exports' read-only-via-signed-URL pattern, extended to trainer since they're the ones
-- printing/posting it.
insert into storage.buckets (id, name, public)
values ('class-notices', 'class-notices', false)
on conflict (id) do nothing;

create policy "class-notices read" on storage.objects for select to authenticated using (
  bucket_id = 'class-notices'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public.current_role()) in ('org_admin','facility_manager','trainer'))
  )
);
