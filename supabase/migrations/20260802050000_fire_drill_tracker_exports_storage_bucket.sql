-- fire-drill-tracker-exports: server-generated monthly fire-drill tracker PDFs (55 Pa. Code
-- 2600.132/2800.132), one per facility+month, written only by the generate-fire-drill-tracker-pdf
-- Edge Function (service-role key) -- no authenticated INSERT/UPDATE/DELETE policy, matching
-- binder-exports' and incident-reports' write=service-role-only posture. Path convention:
-- {organization_id}/{facility_id}/{YYYY-MM}.pdf, so the read policy can check org + facility
-- assignment straight from the path the same way violation-documents does -- there's no single
-- owning row to join against for a rolled-up month of drills the way there is for one incident or
-- one violation. Read roles mirror inspection_events_select/inspection_items_select (see
-- 20260705023053_inspection_items_rls.sql): org_admin/auditor org-wide, facility_manager/trainer
-- scoped to their assigned facility.
insert into storage.buckets (id, name, public)
values ('fire-drill-tracker-exports', 'fire-drill-tracker-exports', false)
on conflict (id) do nothing;

create policy "fire-drill-tracker-exports read" on storage.objects for select to authenticated using (
  bucket_id = 'fire-drill-tracker-exports'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin', 'auditor')
             or ((select public.current_role()) in ('facility_manager', 'trainer')
                 and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid))))
  )
);
