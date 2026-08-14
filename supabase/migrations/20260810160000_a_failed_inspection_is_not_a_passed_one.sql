-- A failed (or deficiency-noted) inspection must not roll the schedule forward.
--
-- 20260810101000 restored the producer that advances last_inspected_date / next_due_date from
-- the newest inspection_events row. It used max(performed_date) with no result filter, so a
-- fail tonight stamped the item inspected, pushed next_due_date a full interval, flipped
-- status to compliant, and resolved the open inspection_due alert -- while
-- create_work_order_from_failed_inspection was opening a repair work order for the same event.
-- The existing test only exercised result = 'pass'.
--
-- last_inspected_date / next_due_date now come only from passing events. Fail and
-- deficiency_noted stay on the event log (and still open the work order); the item remains
-- due/expired until a pass (or a verified repair) lands.

create or replace function public.recalculate_inspection_item_compliance(p_inspection_item_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pa_today date := public.pa_today();
begin
  update public.inspection_items i
  set
    last_inspected_date = h.last_date,
    next_due_date = coalesce(h.last_date, i.install_date, public.pa_day(i.created_at)) + i.inspection_interval_days
  from (
    select ii.id as inspection_item_id,
           max(e.performed_date) filter (where e.result = 'pass') as last_date
    from public.inspection_items ii
    left join public.inspection_events e on e.inspection_item_id = ii.id
    where p_inspection_item_id is null or ii.id = p_inspection_item_id
    group by ii.id
  ) h
  where h.inspection_item_id = i.id and i.is_active;

  update public.inspection_items i
  set status = case
    when i.next_due_date is null then 'missing'
    when i.next_due_date < v_pa_today then 'expired'
    when i.next_due_date <= v_pa_today + 30 then 'due_soon'
    else 'compliant'
  end
  where i.is_active
    and (p_inspection_item_id is null or i.id = p_inspection_item_id);

  update public.alerts a
  set severity = 'critical',
      message = i.label || ' is overdue for inspection (was due ' || to_char(i.next_due_date, 'Mon DD, YYYY') || ')'
  from public.inspection_items i
  where a.inspection_item_id = i.id
    and a.status = 'open'
    and a.alert_type = 'inspection_due'
    and a.severity = 'warning'
    and i.status = 'expired'
    and (p_inspection_item_id is null or i.id = p_inspection_item_id);

  insert into public.alerts (organization_id, facility_id, inspection_item_id, alert_type, title, message, severity)
  select
    i.organization_id, i.facility_id, i.id,
    'inspection_due',
    i.label || ' — ' || replace(i.item_type, '_', ' '),
    case when i.status = 'expired'
      then i.label || ' is overdue for inspection (was due ' || to_char(i.next_due_date, 'Mon DD, YYYY') || ')'
      else i.label || ' inspection is due ' || to_char(i.next_due_date, 'Mon DD, YYYY')
    end,
    case when i.status = 'expired' then 'critical' else 'warning' end
  from public.inspection_items i
  where i.is_active and i.status in ('due_soon','expired')
    and (p_inspection_item_id is null or i.id = p_inspection_item_id)
    and not exists (
      select 1 from public.alerts a
      where a.inspection_item_id = i.id and a.status = 'open'
    );

  update public.alerts a
  set status = 'resolved', resolved_at = now()
  from public.inspection_items i
  where a.inspection_item_id = i.id
    and a.status = 'open'
    and a.alert_type = 'inspection_due'
    and (p_inspection_item_id is null or i.id = p_inspection_item_id)
    and (not i.is_active or i.status not in ('due_soon','expired'));
end;
$$;

revoke all on function public.recalculate_inspection_item_compliance(uuid) from public, anon, authenticated;
grant execute on function public.recalculate_inspection_item_compliance(uuid) to service_role;
