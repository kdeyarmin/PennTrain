-- Credentials/clearances are more sensitive than training records (background-check flags,
-- license numbers), so unlike the standard 4-tier shape (practicums etc.), trainer is excluded
-- entirely from read and write here -- only org_admin/facility_manager can manage them, and only
-- org_admin/auditor/facility_manager can read org-wide or facility-scoped. The employee the
-- credential belongs to can read their own (self-service, matching every other per-employee
-- table), but cannot write -- clearance/license data is admin-verified, not self-reported.

alter table public.employee_credentials enable row level security;

create policy employee_credentials_select on public.employee_credentials for select to authenticated using (
  public.is_platform_admin()
  or public.owns_employee(employee_id)
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor')
           or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))))
);

create policy employee_credentials_insert on public.employee_credentials for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
);

create policy employee_credentials_update on public.employee_credentials for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
);

create policy employee_credentials_delete on public.employee_credentials for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

alter table public.employee_credential_documents enable row level security;

create policy employee_credential_documents_select on public.employee_credential_documents for select to authenticated using (
  public.is_platform_admin()
  or public.owns_employee(employee_id)
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor')
           or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))))
);

-- No self-service branch here (unlike select) -- an employee can read their own credential
-- documents but not upload them; clearance/license evidence is admin-collected, not
-- self-attested. No update policy either: documents are immutable once uploaded.
create policy employee_credential_documents_insert on public.employee_credential_documents for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
);

create policy employee_credential_documents_delete on public.employee_credential_documents for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
