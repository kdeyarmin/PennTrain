-- Phase 2 review fix: employee role had no storage RLS grant at all on external-uploads,
-- even though training_documents table RLS already permits an employee to select/insert
-- their own linked rows (employee_id -> employees.profile_id = auth.uid()). The Storage
-- API is a separate authorization layer from table RLS, so createSignedUrl/upload calls
-- were silently rejected for employees despite the table-level policy looking correct.
-- Scope: external-uploads only (certificates/transcripts) -- signin-sheets and
-- competency-attachments remain trainer/admin-only artifacts, not employee self-service.
alter policy "external-uploads rw" on storage.objects
using (
  bucket_id = 'external-uploads'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and ((select public.current_role()) in ('org_admin','auditor')
             or public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
             or ((select public.current_role()) = 'employee'
                 and ((storage.foldername(name))[2])::uuid = (select e.facility_id from public.employees e where e.profile_id = auth.uid()))))
  )
)
with check (
  bucket_id = 'external-uploads'
  and (
    public.is_platform_admin()
    or ((storage.foldername(name))[1] = (select public.current_org_id())::text
        and (((select public.current_role()) in ('org_admin','facility_manager','trainer')
              and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid))
             or ((select public.current_role()) = 'employee'
                 and ((storage.foldername(name))[2])::uuid = (select e.facility_id from public.employees e where e.profile_id = auth.uid()))))
  )
);
