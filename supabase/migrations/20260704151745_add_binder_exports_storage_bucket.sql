-- binder-exports: generated compliance-binder PDFs, written only by the
-- generate-compliance-binder Edge Function (service-role key). Path convention:
-- {organization_id}/{uuid}.pdf. Client SELECT policy mirrors the other buckets'
-- pattern so a signed URL can be minted for the org's own report-viewing roles;
-- no authenticated INSERT/UPDATE/DELETE policy is created (write=service-role only).
insert into storage.buckets (id, name, public)
values ('binder-exports', 'binder-exports', false)
on conflict (id) do nothing;

create policy "binder-exports read" on storage.objects for select to authenticated using (
  bucket_id = 'binder-exports'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public."current_role"()) in ('org_admin','facility_manager','auditor'))
  )
);
