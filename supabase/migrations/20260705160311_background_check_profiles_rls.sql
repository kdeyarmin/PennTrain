-- No owns_employee select branch (unlike employee_credentials) -- suitability-determination
-- notes can reference specifics of a disclosed criminal history, so this stays strictly an
-- admin/HR-facing record with no employee self-service view, not just "more sensitive."
alter table public.employee_background_check_profiles enable row level security;

create policy employee_background_check_profiles_select on public.employee_background_check_profiles for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor')
           or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))))
);

create policy employee_background_check_profiles_insert on public.employee_background_check_profiles for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(facility_id))
);

create policy employee_background_check_profiles_update on public.employee_background_check_profiles for update to authenticated using (
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

create policy employee_background_check_profiles_delete on public.employee_background_check_profiles for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
