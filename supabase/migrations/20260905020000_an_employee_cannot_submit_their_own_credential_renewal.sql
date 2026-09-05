-- The employee credential-renewal flow is refused by RLS before it reaches the RPC built for it.
--
-- THE FINDING. `/me/credentials` lets an employee upload a renewal document: `MyCredentials.tsx`
-- calls `useUploadCredentialDocument`, which puts the file in the `credential-documents` bucket
-- under `<organization>/<facility>/<uuid>-<name>` and then inserts the matching
-- `employee_credential_documents` row, before `create_credential_renewal_submission` records the
-- submission. That RPC explicitly admits the employee who owns the credential (20260711213000).
-- Neither write in front of it does:
--
--   * `credential-documents write` (storage) requires `current_role()` in (org_admin,
--     facility_manager) AND `is_assigned_to_facility(...)`, and
--   * `employee_credential_documents_insert` requires the same two roles.
--
-- So the upload fails at the first step with a storage RLS error, and the feature is unreachable
-- for the only role it exists for. The SELECT policies on both already say the opposite -- an
-- employee may read their own credential documents via `owns_employee(employee_id)` -- so this is
-- a write path that was never widened to match its own read path, not a deliberate restriction.
--
-- WHAT THIS CHANGES, and how narrowly. An employee may now write exactly their own credential
-- evidence and nothing else:
--
--   * Table: the insert check gains `owns_employee(employee_id)` as an alternative to the two
--     manager roles. `employee_id` is not caller-supplied at check time -- `stamp_scope_from_credential`
--     re-derives organization, facility and employee from `credential_id` before the policy runs
--     (see the hook's own comment) -- so this reads as "the credential this document is attached to
--     is mine", which is the intended rule.
--   * Storage: an employee may write only under a prefix that matches their OWN employee row's
--     organization and facility. Not `is_assigned_to_facility`, which is a manager's multi-facility
--     scope; an employee has one employee row and one facility, and the prefix must match it.
--
-- DELETE is deliberately not widened on either object. Credential evidence is reviewed by someone
-- else, and an employee who could remove a document after submitting it could rewrite the record a
-- reviewer acted on. That stays org_admin, exactly as it was.
--
-- Rollback: restore both policies from 20260705020605 / 20260705020615 (table) and 20260716224753
-- (storage read) -- which returns the renewal flow to being unreachable.

drop policy if exists employee_credential_documents_insert on public.employee_credential_documents;
create policy employee_credential_documents_insert on public.employee_credential_documents
for insert to authenticated
with check (
  public.is_platform_admin()
  or (
    organization_id = (select public.current_org_id())
    and (
      (
        (select public.current_role()) = any (array['org_admin', 'facility_manager'])
        and public.is_assigned_to_facility(facility_id)
      )
      -- The employee the credential belongs to, stamped server-side from credential_id.
      or public.owns_employee(employee_id)
    )
  )
);

drop policy if exists "credential-documents write" on storage.objects;
create policy "credential-documents write" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'credential-documents'
  and (
    public.is_platform_admin()
    or (
      (storage.foldername(name))[1] = ((select public.current_org_id()))::text
      and (select public.current_role()) = any (array['org_admin', 'facility_manager'])
      and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
    )
    -- An employee writes only under their own employee row's organization and facility prefix.
    or exists (
      select 1
      from public.employees e
      where e.profile_id = (select auth.uid())
        and e.organization_id::text = (storage.foldername(name))[1]
        and e.facility_id::text = (storage.foldername(name))[2]
    )
  )
);
