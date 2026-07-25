-- Stop the daily command centre returning NULL for a facility with no operations data.
--
-- `get_daily_operations_command_center` builds its result as `v_base || jsonb_build_object(...)`,
-- where `v_base` comes from `get_operations_command_center(facility)`. In Postgres, `NULL || jsonb`
-- is NULL -- so whenever that inner call returns nothing, the whole command centre returns NULL and
-- every figure on Home reads as blank rather than as zero.
--
-- Found by a pgTAP assertion that expected an unfilled-shift count of 1 and got NULL: the facility
-- in the test is new, with no operations data behind it. That is exactly the state a real facility
-- is in on its first day.
--
-- The only change from 20260726110000 is the coalesce. Everything else is preserved verbatim.
--
-- Rollback: re-apply the definition from 20260726110000.

create or replace function public.get_daily_operations_command_center(p_facility_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare v_base jsonb := '{}'::jsonb; v_facility uuid := p_facility_id;
begin
  if v_facility is not null then
    -- coalesce, because `NULL || jsonb_build_object(...)` is NULL, not the right-hand object.
    v_base := coalesce(public.get_operations_command_center(v_facility), '{}'::jsonb);
  end if;
  return v_base || jsonb_build_object(
    'generatedAt', now(),
    'facilityId', v_facility,
    'dailyExecution', jsonb_build_object(
      'unfilledShifts', (select count(*) from public.work_items where (v_facility is null or facility_id=v_facility) and source_type in ('staffing','rule_exception') and state not in ('closed','canceled') and deduplication_key like 'call-off:%'),
      'openHandoffItems', (select count(*) from public.shift_report_entries where (v_facility is null or facility_id=v_facility) and status in ('open','carried_forward')),
      'urgentHandoffItems', (select count(*) from public.shift_report_entries where (v_facility is null or facility_id=v_facility) and status in ('open','carried_forward') and priority='urgent'),
      'pendingTimeOff', (select count(*) from public.workforce_time_off_requests where (v_facility is null or facility_id=v_facility) and status='pending'),
      'openShiftOffers', (select count(*) from public.open_shift_opportunities where (v_facility is null or facility_id=v_facility) and status='open'),
      'unreadUrgentNotifications', (select count(*) from public.notifications n where n.read_at is null and n.notification_type in ('training_expired'))
    ),
    'morningHuddle', coalesce((select jsonb_agg(to_jsonb(x) order by x.priority desc, x.due_at nulls last) from (
      select 'work_item' as kind, id, title, priority, due_at, state, '/app/work/' || id::text as href from public.work_items where (v_facility is null or facility_id=v_facility) and state not in ('closed','canceled')
      union all
      select 'handoff', id, replace(category,'_',' '), priority, created_at, status, '/app/shift-log' from public.shift_report_entries where (v_facility is null or facility_id=v_facility) and status in ('open','carried_forward')
      limit 50
    ) x), '[]'::jsonb)
  );
end;
$$;
