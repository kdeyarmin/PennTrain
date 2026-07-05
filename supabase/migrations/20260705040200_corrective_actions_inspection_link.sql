-- Widens corrective_actions (created in 20260705030000_incidents_core.sql for incident findings)
-- to also serve facility-inspection findings, per the plan to keep this table polymorphic rather
-- than duplicating it. This is a genuinely more complex RLS policy than any single-parent one in
-- the app: the incident-linked branch excludes trainer (matching incidents' sensitivity), while
-- the inspection-linked branch includes trainer (matching inspections' lower sensitivity) --
-- worth an extra review pass since a mistake here would either leak incident-linked corrective
-- actions to trainer or hide inspection-linked ones from trainer.

alter table public.corrective_actions add column inspection_event_id uuid references public.inspection_events(id) on delete cascade;
create index corrective_actions_inspection_event_idx on public.corrective_actions(inspection_event_id);

alter table public.corrective_actions drop constraint corrective_actions_one_parent_check;
alter table public.corrective_actions add constraint corrective_actions_one_parent_check
  check (num_nonnulls(incident_id, inspection_event_id) = 1);

create or replace function public.stamp_scope_from_corrective_action_parent()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_org uuid; v_fac uuid;
begin
  if new.incident_id is not null then
    select organization_id, facility_id into v_org, v_fac from public.incidents where id = new.incident_id;
    if v_org is null then
      raise exception 'incident % not found', new.incident_id using errcode = 'foreign_key_violation';
    end if;
  elsif new.inspection_event_id is not null then
    select organization_id, facility_id into v_org, v_fac from public.inspection_events where id = new.inspection_event_id;
    if v_org is null then
      raise exception 'inspection event % not found', new.inspection_event_id using errcode = 'foreign_key_violation';
    end if;
  else
    raise exception 'corrective_actions row must reference exactly one parent';
  end if;
  new.organization_id := v_org;
  new.facility_id := v_fac;
  return new;
end;
$function$;

-- org_admin/auditor keep org-wide access to every corrective action regardless of parent.
-- facility_manager keeps assigned-facility access to every corrective action regardless of
-- parent. trainer is added, but ONLY for inspection-linked rows -- never incident-linked ones.
alter policy corrective_actions_select on public.corrective_actions using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) in ('org_admin','auditor')
        or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))
        or ((select public.current_role()) = 'trainer' and inspection_event_id is not null and public.is_assigned_to_facility(facility_id))
      ))
);

alter policy corrective_actions_insert on public.corrective_actions with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and public.is_assigned_to_facility(facility_id)
      and (
        (select public.current_role()) in ('org_admin','facility_manager')
        or ((select public.current_role()) = 'trainer' and inspection_event_id is not null)
      ))
);

alter policy corrective_actions_update on public.corrective_actions using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and public.is_assigned_to_facility(facility_id)
      and (
        (select public.current_role()) in ('org_admin','facility_manager')
        or ((select public.current_role()) = 'trainer' and inspection_event_id is not null)
      ))
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and public.is_assigned_to_facility(facility_id)
      and (
        (select public.current_role()) in ('org_admin','facility_manager')
        or ((select public.current_role()) = 'trainer' and inspection_event_id is not null)
      ))
);

-- corrective_actions_delete is unaffected -- org_admin/platform_admin only, regardless of parent.
