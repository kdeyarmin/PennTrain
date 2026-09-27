-- Regulatory baseline: each chapter's RCG (revised August 1, 2021), pp.4-5;
-- PCH RCG fire-drill appendix; ALF RCG discussion of 2800.14(e), p.14.
-- Existing explicitly saved facility policies remain attributable and unchanged.
alter table public.facility_site_policies alter column inspection_grace set default 'rcg';
alter table public.facility_site_policies alter column alf_approval_renewal set default 'changed_use';
-- The BEFORE validator fills an omitted value from the actual chapter. An
-- explicitly saved false remains an identifiable stricter PCH facility policy.
alter table public.facility_site_policies alter column count_unsuccessful_pch_drills set default null;

create or replace function app_private.site_inspection_grace(p_facility uuid,p_type text)
returns integer language sql stable security definer set search_path='' as $$
  select case
    when not exists(select 1 from public.facilities where id=p_facility and facility_type in ('PCH','ALR')) then 0
    when p_type='fireplace_chimney_service' and not exists(select 1 from public.facilities where id=p_facility and facility_type='ALR') then 0
    when coalesce((select inspection_grace from public.facility_site_policies where facility_id=p_facility),'rcg')<>'rcg' then 0
    when p_type in ('fire_safety_expert_inspection','evacuation_time_letter','emergency_prep_plan_review','furnace_inspection','wood_coal_stove_approval','fireplace_chimney_service') then 15
    when p_type in ('smoke_detector','fire_alarm_system','private_water_coliform_test','sleeping_hours_fire_drill') then 5
    else 0 end;
$$;
revoke all on function app_private.site_inspection_grace(uuid,text) from public,anon,authenticated;

-- §2800.129(c)'s annual chimney service is ALF-specific. Preserve voluntary
-- PCH equipment records without imposing the other chapter's maximum interval.
alter table public.inspection_items drop constraint inspection_regulatory_interval_check;
alter table public.inspection_items add constraint inspection_regulatory_interval_check check (
  inspection_interval_days > 0 and (item_type='fireplace_chimney_service'
    or app_private.inspection_interval_maximum(item_type) is null
    or inspection_interval_days <= app_private.inspection_interval_maximum(item_type)));
create function app_private.enforce_chapter_inspection_interval()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.item_type='fireplace_chimney_service' and new.inspection_interval_days>365
    and exists(select 1 from public.facilities f where f.id=new.facility_id and f.facility_type='ALR') then
    raise exception 'ALF chimney and flue service must follow the annual Chapter 2800 schedule' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function app_private.enforce_chapter_inspection_interval() from public,anon,authenticated;
create trigger enforce_chapter_inspection_interval before insert or update on public.inspection_items
  for each row execute function app_private.enforce_chapter_inspection_interval();

-- Annual, monthly and quarterly baselines are calendar periods. Historical
-- baseline markers (30/90/365) are not literal day limits. Deliberately shorter
-- intervals remain additional facility targets.
create or replace function public.inspection_item_next_due_date(
  p_item_type text, p_interval_days integer, p_last_date date, p_anchor date
)
returns date language sql immutable set search_path='' as $$
  select case
    when p_item_type='fire_drill_program' then case when p_last_date is not null
      then (date_trunc('month',p_last_date::timestamp)+interval '2 months'-interval '1 day')::date
      else (date_trunc('month',p_anchor::timestamp)+interval '1 month'-interval '1 day')::date end
    when p_item_type='sleeping_hours_fire_drill' then (coalesce(p_last_date,p_anchor)+interval '6 months')::date
    -- §2600.130(f)/§2800.130(e): at least once per month. The RCG permits
    -- documented testing during the calendar-month fire drill.
    when p_item_type in ('smoke_detector','fire_alarm_system') then case when p_interval_days in (30,31)
      then (date_trunc('month',coalesce(p_last_date,p_anchor)::timestamp)
        +case when p_last_date is null then interval '1 month' else interval '2 months' end-interval '1 day')::date
      else least(coalesce(p_last_date,p_anchor)+p_interval_days,
        (date_trunc('month',coalesce(p_last_date,p_anchor)::timestamp)
        +case when p_last_date is null then interval '1 month' else interval '2 months' end-interval '1 day')::date) end
    when p_item_type='private_water_coliform_test' then case when p_interval_days in (90,92)
      then (coalesce(p_last_date,p_anchor)+interval '3 months')::date
      else least(coalesce(p_last_date,p_anchor)+p_interval_days,(coalesce(p_last_date,p_anchor)+interval '3 months')::date) end
    when p_interval_days=365 and p_item_type in ('fire_extinguisher','fire_safety_expert_inspection','evacuation_time_letter',
      'emergency_prep_plan_review','furnace_inspection','wood_coal_stove_approval','fireplace_chimney_service','carbon_monoxide_battery')
      then (coalesce(p_last_date,p_anchor)+interval '1 year')::date
    else coalesce(p_last_date,p_anchor)+p_interval_days end;
$$;
revoke all on function public.inspection_item_next_due_date(text,integer,date,date) from public,anon,authenticated;
grant execute on function public.inspection_item_next_due_date(text,integer,date,date) to service_role;

do $patch$
declare v_def text; v_old text; v_new text;
begin
  v_def:=pg_get_functiondef('public.recalculate_inspection_item_compliance(uuid)'::regprocedure);
  v_old:='exists(select 1 from public.facility_site_policies p join public.facilities f on f.id=p.facility_id where p.facility_id=ii.facility_id and f.facility_type=''PCH'' and p.count_unsuccessful_pch_drills)';
  -- A generic failure/maintenance event is not an attempted drill. The recorded
  -- drill time distinguishes a held (including aborted) drill from such an issue.
  v_new:='e.drill_time is not null and exists(select 1 from public.facilities f left join public.facility_site_policies p on p.facility_id=f.id where f.id=ii.facility_id and f.facility_type=''PCH'' and coalesce(p.count_unsuccessful_pch_drills,true))';
  if position(v_old in v_def)=0 then raise exception 'Review inspection drill counting before changing its baseline'; end if;
  v_def:=replace(v_def,v_old,v_new);
  v_old:='i.item_type, i.inspection_interval_days, h.last_date,';
  if position(v_old in v_def)=0 then raise exception 'Review inspection chapter scope before changing calendar baselines'; end if;
  execute replace(v_def,v_old,'case when exists(select 1 from public.facilities f where f.id=i.facility_id and f.facility_type in (''PCH'',''ALR'')) then i.item_type else ''fixed_day_facility_schedule'' end, i.inspection_interval_days, h.last_date,');

  v_def:=pg_get_functiondef('public.validate_facility_site_record()'::regprocedure);
  v_old:='coalesce((select alf_approval_renewal from public.facility_site_policies where facility_id=new.facility_id),''every_three_years'')';
  v_new:='coalesce((select alf_approval_renewal from public.facility_site_policies where facility_id=new.facility_id),''changed_use'')';
  if position(v_old in v_def)=0 then raise exception 'Review fire approval validator before changing its baseline'; end if;
  v_def:=replace(v_def,v_old,v_new);
  v_old:='if tg_table_name=''facility_site_policies'' then';
  if position(v_old in v_def)=0 then raise exception 'Review the site-policy default validator'; end if;
  execute replace(v_def,v_old,v_old||E'\n    new.count_unsuccessful_pch_drills:=coalesce(new.count_unsuccessful_pch_drills,v_type=''PCH'');');
end $patch$;

-- Recalculate unsaved-policy facilities against the baseline, keeping actual
-- inspection dates, retained failed-drill findings and saved policies intact.
do $refresh$
declare v_id uuid;
begin
  for v_id in select i.id from public.inspection_items i join public.facilities f on f.id=i.facility_id
    where f.facility_type in ('PCH','ALR')
      and not exists(select 1 from public.facility_site_policies p where p.facility_id=f.id)
  loop
    perform public.recalculate_inspection_item_compliance(v_id);
  end loop;
end $refresh$;
