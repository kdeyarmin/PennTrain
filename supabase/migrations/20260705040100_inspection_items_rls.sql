-- Least sensitive of the three new modules -- practicums-shape including trainer, but 3-tier
-- not 4: there's no employee "owner" of an inspection record (staff appear only as
-- performed_by/performed_by_profile_id, not as the record's subject), so there's no self-service
-- branch to grant or withhold, not a sensitivity decision.

alter table public.inspection_items enable row level security;

create policy inspection_items_select on public.inspection_items for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor')
           or ((select public.current_role()) in ('facility_manager','trainer') and public.is_assigned_to_facility(facility_id))))
);
create policy inspection_items_insert on public.inspection_items for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy inspection_items_update on public.inspection_items for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy inspection_items_delete on public.inspection_items for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);

alter table public.inspection_events enable row level security;

create policy inspection_events_select on public.inspection_events for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor')
           or ((select public.current_role()) in ('facility_manager','trainer') and public.is_assigned_to_facility(facility_id))))
);
create policy inspection_events_insert on public.inspection_events for insert to authenticated with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy inspection_events_update on public.inspection_events for update to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
);
create policy inspection_events_delete on public.inspection_events for delete to authenticated using (
  public.is_platform_admin() or (organization_id = (select public.current_org_id()) and (select public.current_role()) = 'org_admin')
);
