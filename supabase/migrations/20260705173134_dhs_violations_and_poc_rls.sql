-- dhs_violations/violation_documents: same sensitivity model as incidents (org_admin/
-- facility_manager/auditor, no trainer, no self-service) -- a formal DHS citation and its POC
-- are an org-compliance matter, not a routine equipment check. A violation's retraining tasks
-- still reach the trainer via course_assignments' own RLS, unaffected by this.
alter table public.dhs_violations enable row level security;

create policy dhs_violations_select on public.dhs_violations for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor')
           or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))))
);
create policy dhs_violations_insert on public.dhs_violations for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
create policy dhs_violations_update on public.dhs_violations for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
create policy dhs_violations_delete on public.dhs_violations for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

alter table public.violation_documents enable row level security;

create policy violation_documents_select on public.violation_documents for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor')
           or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))))
);
create policy violation_documents_insert on public.violation_documents for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id))
);
create policy violation_documents_delete on public.violation_documents for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

-- corrective_actions: widen the existing incident-or-inspection policies (see
-- 20260705040200_corrective_actions_inspection_link.sql) to a third, violation-linked branch.
-- Like the inspection-linked branch (and unlike the incident-linked one), trainer is included --
-- a trainer assigned to the facility needs to see and act on retraining tasks a violation's POC
-- created for their roster.
alter policy corrective_actions_select on public.corrective_actions using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) in ('org_admin', 'auditor')
        or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))
        or ((select public.current_role()) = 'trainer' and (inspection_event_id is not null or violation_id is not null) and public.is_assigned_to_facility(facility_id))
      ))
);

alter policy corrective_actions_insert on public.corrective_actions with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and public.is_assigned_to_facility(facility_id)
      and (
        (select public.current_role()) in ('org_admin', 'facility_manager')
        or ((select public.current_role()) = 'trainer' and (inspection_event_id is not null or violation_id is not null))
      ))
);

alter policy corrective_actions_update on public.corrective_actions using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and public.is_assigned_to_facility(facility_id)
      and (
        (select public.current_role()) in ('org_admin', 'facility_manager')
        or ((select public.current_role()) = 'trainer' and (inspection_event_id is not null or violation_id is not null))
      ))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and public.is_assigned_to_facility(facility_id)
      and (
        (select public.current_role()) in ('org_admin', 'facility_manager')
        or ((select public.current_role()) = 'trainer' and (inspection_event_id is not null or violation_id is not null))
      ))
);
-- corrective_actions_delete is unaffected -- org_admin/platform_admin only, regardless of parent.
