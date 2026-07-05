alter table public.policy_documents enable row level security;
alter table public.policy_document_versions enable row level security;
alter table public.policy_attestation_campaigns enable row level security;
alter table public.policy_attestations enable row level security;

-- current_org_id()/current_role() are wrapped in `(select ...)` throughout this file, matching
-- the rest of the codebase's RLS policies (see fix_rls_initplan_bare_auth_uid.sql): this lets
-- Postgres cache the result once per statement (initplan) instead of re-evaluating per row.
-- current_role specifically MUST be schema-qualified and/or parenthesized this way -- Postgres
-- reserves the bare token `current_role` for the SQL-standard CURRENT_ROLE construct, so an
-- unqualified `current_role()` (no `public.` prefix, not wrapped in a subquery) is a syntax
-- error, not a call to this table's custom same-named function.

create policy policy_documents_select on public.policy_documents
  for select to authenticated
  using (public.is_platform_admin() or (organization_id = (select public.current_org_id())));

create policy policy_documents_write on public.policy_documents
  for all to authenticated
  using (public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = any (array['org_admin','facility_manager'])))
  with check (public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = any (array['org_admin','facility_manager'])));

create policy policy_document_versions_select on public.policy_document_versions
  for select to authenticated
  using (public.is_platform_admin() or (organization_id = (select public.current_org_id())));

create policy policy_document_versions_write on public.policy_document_versions
  for insert to authenticated
  with check (public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = any (array['org_admin','facility_manager'])));

create policy policy_document_versions_update on public.policy_document_versions
  for update to authenticated
  using (public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = any (array['org_admin','facility_manager'])))
  with check (public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = any (array['org_admin','facility_manager'])));

create policy policy_attestation_campaigns_select on public.policy_attestation_campaigns
  for select to authenticated
  using (public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = any (array['org_admin','facility_manager','auditor'])));

create policy policy_attestation_campaigns_write on public.policy_attestation_campaigns
  for insert to authenticated
  with check (public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = any (array['org_admin','facility_manager'])));

create policy policy_attestation_campaigns_delete on public.policy_attestation_campaigns
  for delete to authenticated
  using (public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin'));

create policy policy_attestations_select on public.policy_attestations
  for select to authenticated
  using (
    public.is_platform_admin()
    or public.owns_employee(employee_id)
    or (
      organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) = any (array['org_admin','auditor'])
        or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))
      )
    )
  );

create policy policy_attestations_insert on public.policy_attestations
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) = any (array['org_admin','facility_manager'])
      and public.is_assigned_to_facility(facility_id)
    )
  );

create policy policy_attestations_delete on public.policy_attestations
  for delete to authenticated
  using (public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin'));
