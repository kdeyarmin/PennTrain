-- 20260705023138 gave the nightly recalc the only producer that maintained
-- inspection_items: roll last_inspected_date/next_due_date forward from the newest
-- inspection_event, flip status against the calendar, and raise 'inspection_due'
-- alerts. Four hours later 20260705061816 redefined recalculate_all_compliance()
-- from an older body and silently dropped all of it, and every redefinition since
-- (through 20260724160000) kept the loss. Since then a logged passing inspection
-- never advanced its item, a passed next_due_date never expired anything, and
-- 'inspection_due' has had no producer -- the only remaining writer was
-- verify_work_order() on a verified repair.
--
-- Restored here as its own function, brought to current conventions: pa_today()/
-- pa_day() instead of the UTC session day, plus the severity escalation and resolve
-- passes 20260724160000 established for every other alert domain. Called from the
-- nightly recalculate_all_compliance() for the whole fleet, and from a new AFTER
-- INSERT trigger on inspection_events for the one item -- the client invalidates its
-- inspection_items query right after logging an event and expects fresh dates.

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
    select ii.id as inspection_item_id, max(e.performed_date) as last_date
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

  -- Escalate an already-open inspection_due alert's severity once the item has actually
  -- expired (as with certificate_expiring, the alert_type never changes -- only severity).
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

  -- Resolve pass, same posture as resolve_stale_compliance_alerts: an item inspected back
  -- into compliance (or retired) closes its open alert; dismissed alerts are never touched.
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

create or replace function public.inspection_event_rolls_item_forward()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recalculate_inspection_item_compliance(new.inspection_item_id);
  return new;
end;
$$;

drop trigger if exists inspection_event_rolls_item_forward on public.inspection_events;
create trigger inspection_event_rolls_item_forward
  after insert on public.inspection_events
  for each row execute function public.inspection_event_rolls_item_forward();

-- Full-body copy of 20260724160000's recalculate_all_compliance() with one addition:
-- the inspection_items pass, run right before the closing resolve pass -- where the
-- original producer sat in 20260705023138's body.
create or replace function public.recalculate_all_compliance()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pa_today date := (now() at time zone 'America/New_York')::date;
begin
  perform public.recalculate_compliance_core(null);

  -- Escalate an already-open due_30 practicum alert once the practicum is genuinely expired.
  update public.alerts a
  set alert_type = 'overdue', severity = 'critical',
      title = 'Practicum — ' || e.first_name || ' ' || e.last_name,
      message = 'Annual practicum has expired for ' || e.first_name || ' ' || e.last_name
  from public.practicums p
  join public.employees e on e.id = p.employee_id
  where a.practicum_id = p.id
    and a.status = 'open'
    and a.alert_type = 'due_30'
    and p.status = 'expired';

  insert into public.alerts (organization_id, facility_id, employee_id, practicum_id, alert_type, title, message, severity)
  select
    p.organization_id, p.facility_id, p.employee_id, p.id,
    case when p.status = 'expired' then 'overdue' else 'due_30' end,
    'Practicum — ' || e.first_name || ' ' || e.last_name,
    case when p.status = 'expired'
      then 'Annual practicum has expired for ' || e.first_name || ' ' || e.last_name
      else 'Annual practicum is due soon for ' || e.first_name || ' ' || e.last_name
    end,
    case when p.status = 'expired' then 'critical' else 'warning' end
  from public.practicums p
  join public.employees e on e.id = p.employee_id
  where p.status in ('due_soon','expired')
    and not exists (
      select 1 from public.alerts a
      where a.practicum_id = p.id and a.status = 'open'
    );

  insert into public.alerts (organization_id, facility_id, employee_id, training_record_id, alert_type, title, message, severity)
  select
    r.organization_id, r.facility_id, r.employee_id, r.id,
    'missing_document',
    tt.name || ' — missing document for ' || e.first_name || ' ' || e.last_name,
    tt.name || ' requires a supporting document, but none is on file for ' || e.first_name || ' ' || e.last_name,
    'warning'
  from public.employee_training_records r
  join public.training_types tt on tt.id = r.training_type_id
  join public.employees e on e.id = r.employee_id
  where r.completion_date is not null
    and tt.document_required
    and not exists (select 1 from public.training_documents d where d.training_record_id = r.id)
    and not exists (
      select 1 from public.alerts a
      where a.training_record_id = r.id and a.alert_type = 'missing_document' and a.status = 'open'
    );

  -- Escalate an already-open certificate_expiring alert's severity once the certificate has
  -- actually expired (the alert_type itself never changes for this domain -- only severity should).
  update public.alerts a
  set severity = 'critical',
      message = 'Certificate for ' || co.title || ' expired ' || to_char(c.expires_at, 'Mon DD, YYYY') || ' for ' || e.first_name || ' ' || e.last_name
  from public.certificates c
  join public.employees e on e.id = c.employee_id
  join public.courses co on co.id = c.course_id
  where a.certificate_id = c.id
    and a.status = 'open'
    and a.alert_type = 'certificate_expiring'
    and a.severity = 'warning'
    and c.expires_at < now();

  insert into public.alerts (organization_id, facility_id, employee_id, certificate_id, alert_type, title, message, severity)
  select
    c.organization_id, c.facility_id, c.employee_id, c.id,
    'certificate_expiring',
    'Certificate expiring — ' || e.first_name || ' ' || e.last_name,
    'Certificate for ' || co.title || ' expires ' || to_char(c.expires_at, 'Mon DD, YYYY') || ' for ' || e.first_name || ' ' || e.last_name,
    case when c.expires_at < now() then 'critical' else 'warning' end
  from public.certificates c
  join public.employees e on e.id = c.employee_id
  join public.courses co on co.id = c.course_id
  where c.expires_at is not null
    and c.expires_at <= now() + interval '60 days'
    and not exists (
      select 1 from public.alerts a
      where a.certificate_id = c.id and a.status = 'open'
    );

  update public.employee_credentials c
  set status = case
    when c.status = 'not_applicable' then c.status
    when c.expiration_date is null then (case when c.issue_date is not null then 'compliant' else 'missing' end)
    when c.expiration_date < v_pa_today then 'expired'
    when c.expiration_date <= v_pa_today + c.warning_days then 'due_soon'
    else 'compliant'
  end;

  -- Escalate an already-open credential_expiring alert's severity once the credential has expired.
  update public.alerts a
  set severity = 'critical',
      message = coalesce(c.credential_label, replace(c.credential_type, '_', ' ')) || ' has expired for ' || e.first_name || ' ' || e.last_name
  from public.employee_credentials c
  join public.employees e on e.id = c.employee_id
  where a.employee_credential_id = c.id
    and a.status = 'open'
    and a.alert_type = 'credential_expiring'
    and a.severity = 'warning'
    and c.status = 'expired';

  insert into public.alerts (organization_id, facility_id, employee_id, employee_credential_id, alert_type, title, message, severity)
  select
    c.organization_id, c.facility_id, c.employee_id, c.id,
    'credential_expiring',
    coalesce(c.credential_label, replace(c.credential_type, '_', ' ')) || ' — ' || e.first_name || ' ' || e.last_name,
    case when c.status = 'expired'
      then coalesce(c.credential_label, replace(c.credential_type, '_', ' ')) || ' has expired for ' || e.first_name || ' ' || e.last_name
      else coalesce(c.credential_label, replace(c.credential_type, '_', ' ')) || ' is due soon for ' || e.first_name || ' ' || e.last_name
    end,
    case when c.status = 'expired' then 'critical' else 'warning' end
  from public.employee_credentials c
  join public.employees e on e.id = c.employee_id
  where c.status in ('due_soon','expired')
    and not exists (
      select 1 from public.alerts a
      where a.employee_credential_id = c.id and a.status = 'open'
    );

  perform public.recalculate_incident_notifications();

  update public.corrective_actions ca
  set status = 'overdue'
  where ca.status in ('open','in_progress')
    and ca.due_date < v_pa_today;

  -- Symmetric with every other domain here: when a deadline is extended, a row this
  -- job marked 'overdue' steps back to 'open' instead of staying overdue forever.
  update public.corrective_actions ca
  set status = 'open'
  where ca.status = 'overdue'
    and (ca.due_date is null or ca.due_date >= v_pa_today);

  -- corrective_action_overdue alerts are inserted unconditionally at severity='warning' the moment
  -- the action becomes overdue (there's no separate "due soon" state for a corrective action in this
  -- schema to escalate FROM) -- so, to keep this alert type from reading as perpetually low-urgency
  -- no matter how long it's been ignored, step it up to 'critical' once it has been overdue for more
  -- than 14 days (a configurable sample threshold, same posture as this schema's other
  -- documented-as-sample day-counts -- adjust if the org wants a different grace window).
  update public.alerts a
  set severity = 'critical',
      message = left(ca.description, 200) || ' was due ' || to_char(ca.due_date, 'Mon DD, YYYY') || ' and remains unresolved'
  from public.corrective_actions ca
  where a.corrective_action_id = ca.id
    and a.status = 'open'
    and a.alert_type = 'corrective_action_overdue'
    and a.severity = 'warning'
    and ca.due_date < v_pa_today - 14;

  insert into public.alerts (organization_id, facility_id, corrective_action_id, alert_type, title, message, severity)
  select
    ca.organization_id, ca.facility_id, ca.id,
    'corrective_action_overdue',
    'Corrective action overdue',
    left(ca.description, 200) || ' was due ' || to_char(ca.due_date, 'Mon DD, YYYY'),
    'warning'
  from public.corrective_actions ca
  where ca.status = 'overdue'
    and not exists (
      select 1 from public.alerts a
      where a.corrective_action_id = ca.id and a.status = 'open'
    );

  perform public.recalculate_resident_compliance_statuses();

  update public.alerts a
  set alert_type = 'overdue', severity = 'critical',
      title = coalesce(replace(rci.item_type, '_', ' '), 'Resident compliance item') || ' — ' || r.last_name || ', ' || r.first_name,
      message = replace(rci.item_type, '_', ' ') || ' has expired for ' || r.first_name || ' ' || r.last_name
  from public.resident_compliance_items rci
  join public.residents r on r.id = rci.resident_id
  where a.resident_compliance_item_id = rci.id
    and a.status = 'open'
    and a.alert_type = 'resident_compliance_due_soon'
    and rci.status = 'expired';

  insert into public.alerts (organization_id, facility_id, resident_compliance_item_id, alert_type, title, message, severity)
  select
    rci.organization_id, rci.facility_id, rci.id,
    case when rci.status = 'expired' then 'overdue' else 'resident_compliance_due_soon' end,
    coalesce(replace(rci.item_type, '_', ' '), 'Resident compliance item') || ' — ' || r.last_name || ', ' || r.first_name,
    case when rci.status = 'expired'
      then replace(rci.item_type, '_', ' ') || ' has expired for ' || r.first_name || ' ' || r.last_name
      else replace(rci.item_type, '_', ' ') || ' is due soon for ' || r.first_name || ' ' || r.last_name
    end,
    case when rci.status = 'expired' then 'critical' else 'warning' end
  from public.resident_compliance_items rci
  join public.residents r on r.id = rci.resident_id
  where rci.status in ('due_soon','expired')
    and not exists (
      select 1 from public.alerts a
      where a.resident_compliance_item_id = rci.id and a.status = 'open'
    );

  perform public.recalculate_inspection_item_compliance(null);

  -- Close every open alert whose underlying gap is fixed (statuses above are final now).
  perform public.resolve_stale_compliance_alerts(null);
end;
$$;
