-- Repoint the two queries that read work items by the old catch-all source type (Phase 7a follow-up).
--
-- 20260726100000 reclassified work items out of the `rule_exception` catch-all into real source
-- types, deriving each from the deduplication key its creator writes. Two existing queries filter on
-- `source_type = 'rule_exception'`, and the backfill silently changed what they match:
--
--   * `get_daily_operations_command_center` counts unfilled shifts as
--     `source_type='rule_exception' and deduplication_key like 'call-off:%'`. Those rows are now
--     `staffing`, so the count would have returned zero forever -- and zero is the one wrong answer
--     that looks like good news. The "Coverage gaps" card would have read 0 with shifts uncovered.
--   * `decide_time_off_request` writes work item history for the item referencing the request,
--     filtered the same way.
--
-- THE GENERAL LESSON, recorded here because it will recur: a backfill that changes a column's values
-- is a change to every query that reads that column. Reclassifying rows is not a data-only change.
--
-- Both functions are re-declared from their definitions in
-- 20260714093000_daily_facility_operations_workforce.sql, which a check confirmed is the newest
-- definition of each. Everything else in both bodies is preserved verbatim.
--
-- Rollback: re-apply both definitions from 20260714093000.

create or replace function public.decide_time_off_request(p_request_id uuid, p_status text, p_manager_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_req public.workforce_time_off_requests%rowtype; v_work uuid;
begin
  if p_status not in ('approved','denied','canceled') then raise exception 'Invalid decision' using errcode='22023'; end if;
  select * into v_req from public.workforce_time_off_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found' using errcode='P0002'; end if;
  perform app_private.assert_daily_ops_manager(v_req.facility_id);
  if v_req.status <> 'pending' then return true; end if;
  update public.workforce_time_off_requests set status = p_status, manager_reason = nullif(btrim(p_manager_reason), ''), decided_by = auth.uid(), decided_at = now() where id = p_request_id;
  insert into public.work_item_history(organization_id, facility_id, work_item_id, event_type, actor_profile_id, reason, evidence)
  select w.organization_id, w.facility_id, w.id, 'time_off_decision', auth.uid(), coalesce(nullif(btrim(p_manager_reason), ''), 'Time off ' || p_status), jsonb_build_object('requestId', p_request_id, 'status', p_status)
  -- Accepts both the reclassified value and the old one, so this keeps working whether or not the
  -- matching row predates the backfill.
  from public.work_items w where w.source_type in ('staffing','rule_exception') and w.source_id = p_request_id;
  return true;
end;
$$;

create or replace function public.get_daily_operations_command_center(p_facility_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare v_base jsonb := '{}'::jsonb; v_facility uuid := p_facility_id;
begin
  if v_facility is not null then v_base := public.get_operations_command_center(v_facility); end if;
  return v_base || jsonb_build_object(
    'generatedAt', now(),
    'facilityId', v_facility,
    'dailyExecution', jsonb_build_object(
      -- Was source_type='rule_exception'. The deduplication-key condition is kept as well: it is
      -- what makes this "unfilled shifts" specifically rather than all staffing work.
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
