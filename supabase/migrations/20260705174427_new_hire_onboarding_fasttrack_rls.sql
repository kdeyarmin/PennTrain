-- onboarding_checklist_templates: reference catalog, same "nullable org = system default visible
-- to all, org_admin manages their own org's rows" shape as training_types.
alter table public.onboarding_checklist_templates enable row level security;
create policy onboarding_checklist_templates_select on public.onboarding_checklist_templates for select to authenticated using (
  public.is_platform_admin() or organization_id is null or organization_id = (select public.current_org_id())
);
create policy onboarding_checklist_templates_insert on public.onboarding_checklist_templates for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
create policy onboarding_checklist_templates_update on public.onboarding_checklist_templates for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
create policy onboarding_checklist_templates_delete on public.onboarding_checklist_templates for delete to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

-- employee_onboarding_items: same shape as employee_training_records_select -- self-service
-- (the hired employee can see their own checklist), org_admin/auditor org-wide, and anyone
-- assigned to the facility (covers both facility_manager and trainer, since orientation is
-- trainer-relevant work, without needing an explicit role list).
alter table public.employee_onboarding_items enable row level security;
create policy employee_onboarding_items_select on public.employee_onboarding_items for select to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.employees e where e.id = employee_onboarding_items.employee_id and e.profile_id = auth.uid())
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor') or public.is_assigned_to_facility(facility_id)))
);
create policy employee_onboarding_items_insert on public.employee_onboarding_items for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
create policy employee_onboarding_items_update on public.employee_onboarding_items for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'facility_manager')
           or ((select public.current_role()) = 'trainer' and public.is_assigned_to_facility(facility_id)))
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'facility_manager')
           or ((select public.current_role()) = 'trainer' and public.is_assigned_to_facility(facility_id)))
      and public.is_assigned_to_facility(facility_id))
);
create policy employee_onboarding_items_delete on public.employee_onboarding_items for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

-- employee_checkin_logs: an HR/retention concern -- org_admin/facility_manager only (no trainer,
-- no self-service; matches employee_credentials' "sensitive data, no self-view" posture rather
-- than employee_training_records' self-service one, since a retention check-in note is a manager
-- conversation record, not something the employee necessarily has open access to).
alter table public.employee_checkin_logs enable row level security;
create policy employee_checkin_logs_select on public.employee_checkin_logs for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor')
           or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))))
);
create policy employee_checkin_logs_insert on public.employee_checkin_logs for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
create policy employee_checkin_logs_delete on public.employee_checkin_logs for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
