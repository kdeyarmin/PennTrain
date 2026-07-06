-- Tier 3.6 Phase 4: proactive alerts for resident_compliance_items, closing the "biggest time
-- suck" gap -- staff shouldn't have to remember to check the dashboard. Mirrors the
-- employee_credentials alerts pattern (schema shape: one alert_type covers a wide range of
-- renewal windows, severity carries urgency) and the incidents multi-recipient fan-out pattern
-- (a resident compliance item has no single employee/profile owner, same as an incident).
--
-- In restoring the full historical alert_type list below, this also fixes a pre-existing bug
-- unrelated to this feature: 20260705160331_exclusion_screening_core.sql's rewrite of
-- alerts_alert_type_check silently dropped 'incident_notification_overdue',
-- 'corrective_action_overdue', and 'inspection_due' (added by two earlier migrations), which would
-- make recalculate_incident_notifications()'s hourly cron job (and escalate_unactioned_alerts() /
-- the nightly inspection-due pass) throw a check-constraint violation the next time either found a
-- row to insert. Restored here since this migration already has to rewrite the same constraint.

alter table public.alerts add column resident_compliance_item_id uuid references public.resident_compliance_items(id);
create index alerts_resident_compliance_item_idx on public.alerts(resident_compliance_item_id);

alter table public.alerts drop constraint alerts_alert_type_check;
alter table public.alerts add constraint alerts_alert_type_check check (alert_type in (
  'due_90','due_60','due_30','due_14','due_7','overdue','missing_document',
  'course_assigned','certificate_expiring','external_cert_pending_review',
  'competency_due','training_plan_assigned','inservice_scheduled','credential_expiring',
  'incident_notification_overdue','corrective_action_overdue','inspection_due','exclusion_match_found',
  'resident_compliance_due_soon'));

alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued', 'training_due_soon', 'training_expired',
    'competency_recorded', 'missing_document', 'certificate_expiring', 'practicum_due_soon',
    'practicum_expired', 'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
    'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due'
  ));

-- Full rewrite of recalculate_all_compliance() -- everything above the new block at the bottom is
-- unchanged; adds resident_compliance_items alerts using the same dedup-on-open-alert insert shape
-- every other domain here uses. Reuses the existing 'overdue' alert_type for expired items (rather
-- than inventing a new one) so escalate_unactioned_alerts()'s existing auto-escalation
-- (alert_type in ('due_7','overdue') open 5+ days -> every org_admin/facility_manager) applies to
-- a missed zero-grace RASP/ASP deadline for free.
create or replace function public.recalculate_all_compliance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.employee_training_records r
  set
    due_date = case
      when r.completion_date is null or tt.renewal_interval_days is null then null
      else r.completion_date + tt.renewal_interval_days
    end,
    status = case
      when r.status in ('not_applicable','pending_review') then r.status
      when r.completion_date is null then 'missing'
      when tt.renewal_interval_days is null then 'compliant'
      when (r.completion_date + tt.renewal_interval_days) < current_date then 'expired'
      when (r.completion_date + tt.renewal_interval_days) <= current_date + tt.warning_days_default then 'due_soon'
      else 'compliant'
    end
  from public.training_types tt
  where r.training_type_id = tt.id;

  update public.practicums p
  set status = case
    when p.due_date is null then 'missing'
    when p.due_date < current_date then 'expired'
    when p.due_date <= current_date + p.reminder_days then 'due_soon'
    else 'compliant'
  end;

  insert into public.alerts (organization_id, facility_id, employee_id, training_record_id, alert_type, title, message, severity)
  select
    r.organization_id, r.facility_id, r.employee_id, r.id,
    case
      when r.status = 'expired' then 'overdue'
      when r.due_date <= current_date + 7 then 'due_7'
      when r.due_date <= current_date + 14 then 'due_14'
      when r.due_date <= current_date + 30 then 'due_30'
      when r.due_date <= current_date + 60 then 'due_60'
      else 'due_90'
    end,
    tt.name || ' — ' || e.first_name || ' ' || e.last_name,
    case when r.status = 'expired'
      then tt.name || ' has expired for ' || e.first_name || ' ' || e.last_name
      else tt.name || ' is due soon for ' || e.first_name || ' ' || e.last_name
    end,
    case when r.status = 'expired' then 'critical' else 'warning' end
  from public.employee_training_records r
  join public.training_types tt on tt.id = r.training_type_id
  join public.employees e on e.id = r.employee_id
  where r.status in ('due_soon','expired')
    and not exists (
      select 1 from public.alerts a
      where a.training_record_id = r.id and a.status = 'open'
    );

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
    when c.expiration_date < current_date then 'expired'
    when c.expiration_date <= current_date + c.warning_days then 'due_soon'
    else 'compliant'
  end;

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
    and ca.due_date < current_date;

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

  -- Resident RASP/ASP compliance items: recalculate_resident_compliance_statuses() already handles
  -- the status recompute (grace-period-aware, Phase 1) and runs on its own nightly schedule --
  -- calling it here too means the nightly full-compliance run never misses it even if that
  -- schedule were ever paused, same reasoning recalculate_incident_notifications() above uses.
  perform public.recalculate_resident_compliance_statuses();

  insert into public.alerts (organization_id, facility_id, resident_compliance_item_id, alert_type, title, message, severity)
  select
    rci.organization_id, rci.facility_id, rci.id,
    case when rci.status = 'expired' then 'overdue' else 'resident_compliance_due_soon' end,
    coalesce(rci.item_type, 'Resident compliance item') || ' — ' || r.last_name || ', ' || r.first_name,
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
end;
$$;

-- notify_training_alert() needs no changes: resident_compliance_due_soon/overdue-with-
-- resident_compliance_item_id-set alerts have employee_id null, and its existing
-- "if new.employee_id is null ... return new" guard already no-ops for these, exactly as it
-- already does for every other no-employee-owner alert type.

-- First multi-recipient notification trigger for this domain (mirrors notify_incident_reported()):
-- a resident compliance item has no employee/profile owner, so this fans out to every active
-- org_admin in the org plus every active facility_manager assigned to the item's facility. A WHEN
-- clause keeps this fully additive alongside notify_training_alert() on the same table/event.
create or replace function public.notify_resident_compliance_alert()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_profile_id uuid;
begin
  for v_profile_id in
    select p.id
    from public.profiles p
    where p.organization_id = new.organization_id
      and p.is_active
      and p.role = 'org_admin'
    union
    select fa.profile_id
    from public.facility_assignments fa
    join public.profiles p on p.id = fa.profile_id
    where fa.facility_id = new.facility_id
      and p.is_active
      and p.role = 'facility_manager'
  loop
    insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
    values (
      new.organization_id, v_profile_id, 'resident_compliance_due',
      new.title,
      new.message,
      '/app/resident-compliance'
    );
  end loop;
  return new;
end;
$function$;
revoke all on function public.notify_resident_compliance_alert() from public, anon, authenticated;

create trigger notify_resident_compliance_alert after insert on public.alerts
  for each row when (new.resident_compliance_item_id is not null)
  execute function public.notify_resident_compliance_alert();
