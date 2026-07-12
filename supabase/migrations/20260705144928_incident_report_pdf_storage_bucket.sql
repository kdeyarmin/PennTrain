-- Storage for the generated DHS Reportable Incident Form PDF. Write is service-role only (the
-- generate-incident-report-pdf Edge Function) -- no authenticated INSERT/UPDATE/DELETE policy,
-- matching the certificates bucket's no-direct-client-write posture. Read mirrors incidents_select
-- RLS in case a client ever attempts a direct signed-url read outside the edge function's own
-- signed-url response.
insert into storage.buckets (id, name, public) values ('incident-reports', 'incident-reports', false)
on conflict (id) do nothing;

create policy "incident-reports read" on storage.objects for select to authenticated using (
  bucket_id = 'incident-reports'
  and exists (
    select 1 from public.incidents i
    where i.report_pdf_storage_bucket = storage.objects.bucket_id
      and i.report_pdf_storage_path = storage.objects.name
      and (
        public.is_platform_admin()
        or (i.organization_id = (select public.current_org_id())
            and (select public.current_role()) in ('org_admin','auditor')
            or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(i.facility_id)))
      )
  )
);