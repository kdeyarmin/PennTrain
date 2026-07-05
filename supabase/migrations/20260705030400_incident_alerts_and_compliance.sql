-- Wires incident_notifications and corrective_actions into the compliance alert engine, and
-- adds a notification fan-out for newly reported incidents.

alter table public.alerts add column incident_notification_id uuid references public.incident_notifications(id);
alter table public.alerts add column corrective_action_id uuid references public.corrective_actions(id);
create index alerts_incident_notification_idx on public.alerts(incident_notification_id);
create index alerts_corrective_action_idx on public.alerts(corrective_action_id);

alter table public.alerts drop constraint alerts_alert_type_check;
alter table public.alerts add constraint alerts_alert_type_check check (alert_type in (
  'due_90','due_60','due_30','due_14','due_7','overdue','missing_document',
  'course_assigned','certificate_expiring','external_cert_pending_review',
  'competency_due','training_plan_assigned','inservice_scheduled','credential_expiring',
  'incident_notification_overdue','corrective_action_overdue'));

alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued', 'training_due_soon', 'training_expired',
    'competency_recorded', 'missing_document', 'certificate_expiring',
    'practicum_due_soon', 'practicum_expired', 'credential_expiring', 'incident_reported'
  ));

-- Reportable-incident notification deadlines (PA DHS: 24 hours; CMS F609 abuse/neglect with
-- injury: 2 hours) are too tight for the once-nightly recalculate_all_compliance() batch --
-- a 2-hour deadline could sit silently unflagged for most of a day. This phase is factored into
-- its own function so it can be scheduled hourly on its own (below) AND still run as part of the
-- nightly full recalculation, without duplicating the SQL in two places.
create or replace function public.recalculate_incident_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.incident_notifications n
  set status = case
    when n.completed_at is not null then 'completed'
    when n.due_at < now() then 'overdue'
    else 'pending'
  end;

  insert into public.alerts (organization_id, facility_id, incident_notification_id, alert_type, title, message, severity)
  select
    n.organization_id, n.facility_id, n.id,
    'incident_notification_overdue',
    'Incident notification overdue',
    replace(n.notification_type, '_', ' ') || ' notification is overdue for an incident reported ' || to_char(i.reported_at, 'Mon DD, YYYY HH12:MI AM'),
    'critical'
  from public.incident_notifications n
  join public.incidents i on i.id = n.incident_id
  where n.status = 'overdue'
    and not exists (
      select 1 from public.alerts a
      where a.incident_notification_id = n.id and a.status = 'open'
    );
end;
$$;
revoke all on function public.recalculate_incident_notifications() from public;
revoke all on function public.recalculate_incident_notifications() from anon;
grant execute on function public.recalculate_incident_notifications() to authenticated;

select cron.schedule(
  'recalculate-incident-notifications-hourly',
  '0 * * * *',
  $$ select public.recalculate_incident_notifications(); $$
);

-- Full rewrite of recalculate_all_compliance() -- everything above the two new blocks at the
-- bottom is unchanged from 20260705020413_credentials_alerts_and_compliance.sql.
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

  -- Incident-notification overdue alerts also get a dedicated hourly schedule (above) since
  -- reportable-incident deadlines can be as short as 2 hours -- calling the same function here
  -- too just means the nightly run doesn't miss anything if the hourly job were ever paused.
  perform public.recalculate_incident_notifications();

  -- Corrective actions (shared by incidents now and facility inspections from Phase 3 on) --
  -- written generically against status/due_date so it needs no changes when Phase 3 adds
  -- inspection-linked rows to this same table.
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
end;
$$;

-- notify_training_alert() needs no changes: incident_notification_overdue/corrective_action_overdue
-- alerts have employee_id null (no natural owner), and the function's existing
-- "if new.employee_id is null ... return new" guard already keeps them out of anyone's personal
-- notification feed, exactly like inspection_due will in Phase 3.

-- New: fan out to every org_admin in the org plus every facility_manager assigned to the
-- incident's facility on every new incident, regardless of severity (per product decision --
-- revisit if incident volume ever makes this noisy for a given customer). This is the first
-- multi-recipient notification trigger in this codebase; every other notify_* function notifies
-- exactly one profile (the affected employee).
create or replace function public.notify_incident_reported()
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
      new.organization_id, v_profile_id, 'incident_reported',
      'New incident reported',
      replace(new.incident_type, '_', ' ') || ' incident reported ' || to_char(new.occurred_at, 'Mon DD, YYYY HH12:MI AM'),
      '/app/incidents/' || new.id
    );
  end loop;
  return new;
end;
$function$;
revoke all on function public.notify_incident_reported() from public;
revoke all on function public.notify_incident_reported() from anon;
revoke all on function public.notify_incident_reported() from authenticated;

create trigger notify_incident_reported after insert on public.incidents
  for each row execute function public.notify_incident_reported();
