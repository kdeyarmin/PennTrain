-- Signature defaults of CURRENT_DATE still live on two list-summary RPCs.
-- pa_day_is_the_facility_day.test.sql only greps prosrc, so they survived the
-- 20260810111000 incident-summary fix: any caller that omits p_today / p_from
-- after ~20:00 ET is querying tomorrow's window.
--
-- Same posture as get_incident_list_summary: default null, coalesce to
-- public.pa_today() in the body.

create or replace function public.get_resident_list_summary(
  p_facility_id uuid default null,
  p_status text default null,
  p_search text default null,
  p_today date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with today as (
    select coalesce(p_today, public.pa_today()) as d
  ),
  search as (
    select
      nullif(btrim(p_search), '') as raw,
      '%' || replace(replace(replace(nullif(btrim(p_search), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  ),
  filtered as (
    select resident.*
    from public.resident_roster_rows resident
    cross join search s
    where (p_facility_id is null or resident.facility_id = p_facility_id)
      and (p_status is null or resident.status = p_status)
      and (
        s.raw is null
        or resident.search_text ilike s.pattern
      )
  ), item_summary as (
    select
      count(distinct item.resident_id) filter (
        where item.status in ('expired', 'missing', 'due_soon')
      ) as residents_with_open_items,
      count(*) filter (where item.status = 'expired') as expired_items,
      count(*) filter (where item.status = 'missing') as missing_items,
      count(*) filter (where item.status = 'due_soon') as due_soon_items,
      count(*) filter (
        where item.due_date between t.d and t.d + 14
          and item.status not in ('compliant', 'not_applicable')
      ) as due_within_14_days
    from public.resident_compliance_items item
    join filtered resident on resident.id = item.resident_id
    cross join today t
  )
  select jsonb_build_object(
    'residents', (select count(*) from filtered),
    'activeResidents', (select count(*) from filtered where status = 'active'),
    'residentsWithOpenItems', coalesce(item_summary.residents_with_open_items, 0),
    'expiredItems', coalesce(item_summary.expired_items, 0),
    'missingItems', coalesce(item_summary.missing_items, 0),
    'dueSoonItems', coalesce(item_summary.due_soon_items, 0),
    'dueWithin14Days', coalesce(item_summary.due_within_14_days, 0),
    'newestAdmissionResidentId', (
      select id from filtered order by admission_date desc nulls last, id limit 1
    )
  )
  from item_summary;
$function$;

revoke all on function public.get_resident_list_summary(uuid, text, text, date) from public, anon;
grant execute on function public.get_resident_list_summary(uuid, text, text, date) to authenticated, service_role;

create or replace function public.get_staffing_optimization_snapshot(
  p_facility_id uuid,
  p_from date default null,
  p_through date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_org uuid;
  v_schedule_id uuid;
  v_workload jsonb := '{}'::jsonb;
  v_open_shifts integer;
  v_time_off integer;
  v_pending_swaps integer;
  v_blocked integer;
  v_from date := coalesce(p_from, public.pa_today());
  v_through date := coalesce(p_through, coalesce(p_from, public.pa_today()) + 30);
begin
  v_org := app_private.assert_product_value_manager(p_facility_id);
  if v_through < v_from or v_through > v_from + 120 then
    raise exception 'Staffing forecast window is invalid' using errcode = '22023';
  end if;
  select s.id into v_schedule_id from public.schedules s
  where s.facility_id = p_facility_id and s.period_end >= v_from and s.period_start <= v_through
  order by case s.status when 'published' then 0 else 1 end, s.period_start limit 1;
  if v_schedule_id is not null then v_workload := public.get_schedule_service_workload(v_schedule_id); end if;
  select count(*) into v_open_shifts from public.open_shift_opportunities o
    where o.facility_id = p_facility_id and o.shift_date between v_from and v_through
      and o.status = 'open';
  select count(*) into v_time_off from public.workforce_time_off_requests r
    where r.facility_id = p_facility_id and r.status = 'pending'
      and public.pa_day(r.starts_at) <= v_through and public.pa_day(r.ends_at) >= v_from;
  select count(*) into v_pending_swaps from public.shift_swap_requests s
    where s.facility_id = p_facility_id and s.status = 'pending';
  select count(*) into v_blocked from public.schedule_eligibility_decisions d
    where d.facility_id = p_facility_id and d.outcome = 'blocked'
      and d.evaluated_at >= now() - interval '30 days';
  return jsonb_build_object(
    'facilityId', p_facility_id, 'from', v_from, 'through', v_through,
    'scheduleId', v_schedule_id, 'workload', v_workload,
    'openShifts', v_open_shifts, 'pendingTimeOff', v_time_off,
    'pendingSwaps', v_pending_swaps, 'recentBlockedAssignments', v_blocked,
    'recommendations', coalesce((
      select jsonb_agg(value)
      from jsonb_array_elements(jsonb_build_array(
        case when v_open_shifts > 0 then jsonb_build_object('priority', 'high', 'title', concat(v_open_shifts, ' open shifts need qualified coverage'), 'href', '/app/schedule') end,
        case when v_time_off > 0 then jsonb_build_object('priority', 'normal', 'title', concat(v_time_off, ' time-off requests await decisions'), 'href', '/app/workforce-operations') end,
        case when v_blocked > 0 then jsonb_build_object('priority', 'high', 'title', concat(v_blocked, ' assignment attempts were blocked by qualification rules'), 'href', '/app/workforce-operations') end
      )) value
      where value <> 'null'::jsonb
    ), '[]'::jsonb),
    'generatedAt', now()
  );
end;
$function$;
