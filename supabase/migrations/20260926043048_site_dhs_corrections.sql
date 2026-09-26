-- REG19, REG26(b/c/e), REG39: inspection evidence and objective drill findings.
-- Sources: DHS 2600/2800 RCGs pp.4, fire-drill discussions; DHS Act 48 Q/A
-- (October 2016), bedside mobility (2023-06-26), voice devices (2022-08-31).
-- Existing RLS and audit triggers cover these additions. No new public RPC.
alter table public.inspection_items
  add column evacuation_limit_seconds integer check (evacuation_limit_seconds > 0),
  add column evacuation_standard_date date,
  add column fire_safe_area text,
  add column sleeping_hours_start time not null default '23:00',
  add column sleeping_hours_end time not null default '07:00',
  add column sleeping_hours_basis text,
  add constraint inspection_sleeping_window_check check (
    sleeping_hours_start <> sleeping_hours_end
    and ((sleeping_hours_start = time '23:00' and sleeping_hours_end = time '07:00')
      or length(btrim(coalesce(sleeping_hours_basis, ''))) > 0)),
  add constraint inspection_evacuation_standard_check check (
    evacuation_limit_seconds is null or evacuation_standard_date is not null);

alter table public.inspection_events
  add column alarm_sounded boolean,
  add column blocked_exit_route text,
  add column fire_safety_expert_name text,
  add column fire_safety_expert_qualification text,
  add column evacuation_limit_seconds integer,
  add column evacuation_time_exceeded boolean not null default false,
  add column evacuation_exception text,
  add column submitted_to_agency_at date,
  add column tested_alarm_item_ids uuid[] not null default '{}',
  add column regulatory_evidence_version smallint not null default 0 check (regulatory_evidence_version in (0,1));

alter table public.inspection_items drop constraint inspection_items_item_type_check;
alter table public.inspection_items add constraint inspection_items_item_type_check check (item_type in (
  'generator','fire_extinguisher','fire_alarm_system','sprinkler_system','smoke_detector',
  'emergency_lighting','elevator','other_equipment','fire_drill_program','emergency_prep_plan_review',
  'other_procedural','evacuation_time_letter','emergency_supply_check','sleeping_hours_fire_drill',
  'fire_safety_expert_inspection','furnace_inspection','wood_coal_stove_approval',
  'fireplace_chimney_service','private_water_coliform_test','animal_rabies_certificate',
  'fire_department_notice','fire_safety_approval','automatic_external_defibrillator',
  'vehicle_registration','vehicle_insurance','vehicle_safety_inspection',
  'carbon_monoxide_alarm','carbon_monoxide_battery','carbon_monoxide_response_policy',
  'bedside_mobility_device','voice_controlled_device_policy'
));

create or replace function public.validate_inspection_regulatory_evidence()
returns trigger language plpgsql set search_path = '' as $function$
declare
  v_item public.inspection_items%rowtype;
  v_finding text;
  v_in_sleep_window boolean;
  v_alarm_id uuid;
begin
  select * into v_item from public.inspection_items where id = new.inspection_item_id;
  -- Version zero explicitly identifies historical records whose evidence fields did
  -- not exist. A client cannot downgrade a new record to the historical exemption.
  new.regulatory_evidence_version := case when tg_op='INSERT' then 1
    when old.result is distinct from 'pass' and new.result='pass' then 1
    else old.regulatory_evidence_version end;
  if tg_op='UPDATE' and old.evacuation_time_exceeded then
    new.evacuation_time_exceeded := true;
  end if;
  new.tested_alarm_item_ids := array(select distinct alarm_id from unnest(new.tested_alarm_item_ids) alarm_id order by alarm_id);
  if cardinality(new.tested_alarm_item_ids) > 1 then
    raise exception 'A drill can credit one alarm or detector; record separate test results for additional devices' using errcode='23514';
  end if;
  if tg_op = 'UPDATE' and (cardinality(old.tested_alarm_item_ids) > 0 or cardinality(new.tested_alarm_item_ids) > 0)
    and (new.tested_alarm_item_ids is distinct from old.tested_alarm_item_ids
      or new.alarm_sounded is distinct from old.alarm_sounded
      or new.alarm_or_detector_operative is distinct from old.alarm_or_detector_operative
      or new.performed_date is distinct from old.performed_date
      or new.inspection_item_id is distinct from old.inspection_item_id) then
    raise exception 'Drill alarm-test evidence is immutable after recording; append a correction or new test record'
      using errcode = '23514';
  end if;
  if v_item.item_type in ('fire_drill_program', 'fire_safety_expert_inspection') then
    foreach v_alarm_id in array new.tested_alarm_item_ids loop
      if not exists (select 1 from public.inspection_items a where a.id = v_alarm_id
        and a.organization_id = v_item.organization_id and a.facility_id = v_item.facility_id
        and a.item_type in ('smoke_detector','fire_alarm_system') and a.is_active) then
        raise exception 'A tested alarm must be an active detector or fire alarm at this facility' using errcode = '23514';
      end if;
    end loop;
    -- Preserve a recorded standard and untouched legacy evidence. A legacy failure
    -- promoted to pass must first acquire a standard, so NULL cannot bypass validation.
    -- A program standard dated after the drill cannot authorize a longer historical time.
    new.evacuation_limit_seconds := case when tg_op = 'UPDATE'
      and (old.evacuation_limit_seconds is not null or new.regulatory_evidence_version=0) then old.evacuation_limit_seconds
      else coalesce(case when v_item.evacuation_standard_date <= new.performed_date
        then v_item.evacuation_limit_seconds end, 150) end;
    new.evacuation_time_exceeded := case when tg_op = 'UPDATE' and old.evacuation_time_exceeded then true
      else coalesce(new.evacuation_duration_seconds > new.evacuation_limit_seconds, false) end;
    if new.is_sleeping_hours_drill then
      v_in_sleep_window := new.drill_time is not null and case
        when v_item.sleeping_hours_start < v_item.sleeping_hours_end then
          new.drill_time >= v_item.sleeping_hours_start and new.drill_time < v_item.sleeping_hours_end
        else new.drill_time >= v_item.sleeping_hours_start or new.drill_time < v_item.sleeping_hours_end end;
      if not v_in_sleep_window then
        raise exception 'Sleeping-hours drill time must fall within the documented facility sleeping-hours window'
          using errcode = '23514';
      end if;
    end if;
    if new.residents_present_count < 0 or new.residents_evacuated_count < 0 or new.staff_participating_count < 0
      or new.residents_evacuated_count > new.residents_present_count then
      raise exception 'Drill participation counts must be nonnegative and evacuated cannot exceed present'
        using errcode = '23514';
    end if;
    if new.evacuation_time_exceeded then
      v_finding := 'Evacuation exceeded the recorded maximum time; a later successful drill does not erase this finding.';
    elsif new.residents_evacuated_count < new.residents_present_count
      and nullif(btrim(new.evacuation_exception), '') is null then
      v_finding := 'Not all residents evacuated; document corrective action and any applicable permitted exception.';
    elsif new.alarm_sounded = false or new.alarm_or_detector_operative = false then
      v_finding := 'The drill did not use an operative alarm or detector.';
    elsif new.regulatory_evidence_version > 0 and new.result='pass'
      and (new.alarm_sounded is null or new.alarm_or_detector_operative is null) then
      v_finding := 'Alarm activation and operation were not documented; the drill record is incomplete.';
    end if;
    if v_finding is not null then
      if new.result = 'pass' then new.result := 'deficiency_noted'; end if;
      if tg_op = 'INSERT' then new.follow_up_required := true; end if;
      if position(v_finding in coalesce(new.deficiency_notes, '')) = 0 then
        new.deficiency_notes := concat_ws(E'\n', nullif(new.deficiency_notes, ''), v_finding);
      end if;
    end if;
  end if;
  if cardinality(new.tested_alarm_item_ids) > 0 and v_item.item_type not in ('fire_drill_program','fire_safety_expert_inspection') then
    raise exception 'Only a fire drill can identify alarm items tested during that drill' using errcode = '23514';
  end if;
  if new.result = 'pass' and new.regulatory_evidence_version > 0 then
    if v_item.item_type in ('fire_extinguisher','fire_safety_expert_inspection','wood_coal_stove_approval','evacuation_time_letter')
      and (nullif(btrim(new.fire_safety_expert_name), '') is null or nullif(btrim(new.fire_safety_expert_qualification), '') is null) then
      raise exception 'A passing inspection requires the fire safety expert and qualification' using errcode = '23514';
    end if;
    if v_item.item_type = 'emergency_prep_plan_review' and new.submitted_to_agency_at is null then
      raise exception 'Record the annual submission to the local emergency management agency' using errcode = '23514';
    end if;
    if v_item.item_type in ('carbon_monoxide_alarm','carbon_monoxide_battery','carbon_monoxide_response_policy',
      'bedside_mobility_device','voice_controlled_device_policy','furnace_inspection','wood_coal_stove_approval',
      'fireplace_chimney_service','private_water_coliform_test','animal_rabies_certificate','fire_department_notice',
      'fire_safety_approval','automatic_external_defibrillator','vehicle_registration','vehicle_insurance','vehicle_safety_inspection')
      and nullif(btrim(new.notes), '') is null then
      raise exception 'Record evidence or a document reference for this inspection' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.validate_inspection_regulatory_evidence() from public, anon, authenticated;
create trigger validate_regulatory_evidence before insert or update on public.inspection_events
  for each row execute function public.validate_inspection_regulatory_evidence();

-- Keep observed breaches and the source of credited alarm tests available for review.
drop policy inspection_events_delete on public.inspection_events;
create policy inspection_events_delete on public.inspection_events for delete to authenticated using (
  not evacuation_time_exceeded and cardinality(tested_alarm_item_ids)=0
  and (public.is_platform_admin() or (organization_id=(select public.current_org_id()) and (select public.current_role())='org_admin'))
);

-- Historical failures stay in the drill record after follow-up. The maximum at the
-- time of an old event was not stored, so it cannot safely be invented by a backfill.
comment on column public.inspection_events.evacuation_time_exceeded is
  'Observed breach of the evacuation standard on this event. Never cleared by a subsequent successful drill.';

-- A repair alone cannot supply an annual expert approval or specialist service.
do $do$
declare v_definition text; v_old text;
begin
  v_definition := pg_get_functiondef('public.verify_work_order(uuid,text,text)'::regprocedure);
  v_old := '(select i.item_kind from public.inspection_items i where i.id = v.inspection_item_id) = ''equipment''';
  if position(v_old in v_definition) = 0 then
    raise exception 'verify_work_order equipment guard changed; review the regulatory-evidence integration';
  end if;
  execute replace(v_definition, v_old,
    'exists (select 1 from public.inspection_items i where i.id = v.inspection_item_id and i.item_type in (''generator'',''fire_alarm_system'',''sprinkler_system'',''smoke_detector'',''emergency_lighting'',''elevator'',''other_equipment''))');
end;
$do$;

-- Scope is checked by the BEFORE trigger and the caller's existing inspection RLS.
-- SECURITY INVOKER deliberately preserves those permissions for the equipment record.
create or replace function public.record_alarm_tests_from_drill()
returns trigger language plpgsql set search_path = '' as $function$
declare v_alarm_id uuid;
begin
  foreach v_alarm_id in array new.tested_alarm_item_ids loop
    insert into public.inspection_events (organization_id, facility_id, inspection_item_id,
      performed_date, performed_by, performed_by_profile_id, result, follow_up_required, notes)
    values (new.organization_id, new.facility_id, v_alarm_id, new.performed_date, new.performed_by,
      new.performed_by_profile_id,
      case when new.alarm_sounded and new.alarm_or_detector_operative then 'pass' else 'fail' end,
      not coalesce(new.alarm_sounded and new.alarm_or_detector_operative, false),
      'Alarm/detector test recorded during fire drill ' || new.id::text);
  end loop;
  return null;
end;
$function$;
revoke all on function public.record_alarm_tests_from_drill() from public, anon, authenticated;
create trigger record_drill_alarm_tests after insert on public.inspection_events
  for each row when (cardinality(new.tested_alarm_item_ids) > 0)
  execute function public.record_alarm_tests_from_drill();

-- A facility can choose an earlier interval, but cannot extend a regulatory maximum.
create or replace function app_private.inspection_interval_maximum(p_type text)
returns integer language sql immutable set search_path = '' as $function$
  select case
    when p_type in ('smoke_detector','fire_alarm_system') then 31
    when p_type = 'private_water_coliform_test' then 92
    when p_type in ('fire_extinguisher','fire_safety_expert_inspection','evacuation_time_letter',
      'emergency_prep_plan_review','furnace_inspection','wood_coal_stove_approval',
      'fireplace_chimney_service','carbon_monoxide_battery') then 365
    else null end;
$function$;
-- This helper exposes only public rule constants, not tenant data.
grant usage on schema app_private to authenticated, service_role;
revoke all on function app_private.inspection_interval_maximum(text) from public, anon;
grant execute on function app_private.inspection_interval_maximum(text) to authenticated, service_role;

update public.inspection_items set inspection_interval_days = app_private.inspection_interval_maximum(item_type)
where inspection_interval_days > app_private.inspection_interval_maximum(item_type);
alter table public.inspection_items add constraint inspection_regulatory_interval_check check (
  inspection_interval_days > 0 and (app_private.inspection_interval_maximum(item_type) is null
    or inspection_interval_days <= app_private.inspection_interval_maximum(item_type)));

create or replace function public.inspection_item_next_due_date(
  p_item_type text, p_interval_days integer, p_last_date date, p_anchor date
)
returns date language sql immutable set search_path = '' as $function$
  select case
    when p_item_type = 'fire_drill_program' then case when p_last_date is not null
      then (date_trunc('month', p_last_date::timestamp) + interval '2 months' - interval '1 day')::date
      else (date_trunc('month', p_anchor::timestamp) + interval '1 month' - interval '1 day')::date end
    when p_item_type = 'sleeping_hours_fire_drill' then (coalesce(p_last_date, p_anchor) + interval '6 months')::date
    when p_item_type in ('smoke_detector','fire_alarm_system') then least(
      coalesce(p_last_date, p_anchor) + p_interval_days,
      (coalesce(p_last_date, p_anchor) + interval '1 month')::date)
    when p_item_type = 'private_water_coliform_test' then least(
      coalesce(p_last_date, p_anchor) + p_interval_days,
      (coalesce(p_last_date, p_anchor) + interval '3 months')::date)
    else coalesce(p_last_date, p_anchor) + p_interval_days end;
$function$;
revoke all on function public.inspection_item_next_due_date(text,integer,date,date) from public, anon, authenticated;
grant execute on function public.inspection_item_next_due_date(text,integer,date,date) to service_role;
select public.recalculate_inspection_item_compliance();

-- Corrections to an event must also recompute the schedule; the original trigger
-- ran only on insert, which left the dates stale after an approved correction.
create or replace function public.inspection_event_rolls_item_forward()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op <> 'DELETE' then
    perform public.recalculate_inspection_item_compliance(new.inspection_item_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.inspection_item_id is distinct from new.inspection_item_id) then
    perform public.recalculate_inspection_item_compliance(old.inspection_item_id);
  end if;
  return null;
end;
$function$;
revoke all on function public.inspection_event_rolls_item_forward() from public, anon, authenticated;
drop trigger inspection_event_rolls_item_forward on public.inspection_events;
create trigger inspection_event_rolls_item_forward after insert or update or delete on public.inspection_events
  for each row execute function public.inspection_event_rolls_item_forward();
