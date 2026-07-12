-- Group C storage buckets. Path conventions per the architecture plan:
--   course-documents: {org_id|'system'}/{course_id}/...  (course authoring uploads: pdf/scorm/video files
--     referenced by course_blocks.document_id -> training_documents)
--   certificates: generated PDFs referenced by certificates.pdf_storage_bucket/pdf_storage_path.
<<<<<<< HEAD
--     Write is service-role only (a future generate-certificate-pdf Edge Function would use the
--     service-role key to write here) -- no authenticated INSERT/UPDATE/DELETE policy is created at
--     all, matching conv #10's no-direct-client-write posture for anything certificate-related.
=======
--     Write is service-role only (the issue_certificate() RPC route is table-only today; a future
--     generate-certificate-pdf Edge Function would use the service-role key to write here) --
--     no authenticated INSERT/UPDATE/DELETE policy is created at all, matching conv #10's
--     no-direct-client-write posture for anything certificate-related.
>>>>>>> origin/main
insert into storage.buckets (id, name, public)
values
  ('course-documents', 'course-documents', false),
  ('certificates', 'certificates', false)
on conflict (id) do nothing;

<<<<<<< HEAD
=======
-- course-documents: read = platform_admin, system-catalog ('system' folder), or own-org members;
-- write = platform_admin (system catalog) or org_admin/trainer authoring their own org's courses.
>>>>>>> origin/main
create policy "course-documents read" on storage.objects for select to authenticated using (
  bucket_id = 'course-documents'
  and (
    public.is_platform_admin()
    or (storage.foldername(name))[1] = 'system'
    or (storage.foldername(name))[1] = (select public.current_org_id())::text
  )
);

create policy "course-documents write" on storage.objects for insert to authenticated with check (
  bucket_id = 'course-documents'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public."current_role"()) in ('org_admin','trainer'))
  )
);

create policy "course-documents update" on storage.objects for update to authenticated using (
  bucket_id = 'course-documents'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public."current_role"()) in ('org_admin','trainer'))
  )
) with check (
  bucket_id = 'course-documents'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public."current_role"()) in ('org_admin','trainer'))
  )
);

create policy "course-documents delete" on storage.objects for delete to authenticated using (
  bucket_id = 'course-documents'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (select public."current_role"()) in ('org_admin','trainer'))
  )
);

-- certificates bucket: read-only for clients (their own cert, or org/facility staff, or platform_admin);
-- no client write policy at all -- issuance/PDF generation is a service-role-only path.
create policy "certificates read" on storage.objects for select to authenticated using (
  bucket_id = 'certificates'
  and exists (
    select 1 from public.certificates cert
    where cert.pdf_storage_bucket = storage.objects.bucket_id
      and cert.pdf_storage_path = storage.objects.name
      and (
        public.is_platform_admin()
        or public.owns_employee(cert.employee_id)
        or (cert.organization_id = (select public.current_org_id())
            and public.is_assigned_to_facility(cert.facility_id))
      )
  )
);
