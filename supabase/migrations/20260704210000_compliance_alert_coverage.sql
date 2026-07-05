-- Backfilled from the live database; see 20260704190000 for why this file is a reconstruction
-- rather than the original recovered SQL.
--
-- recalculate_all_compliance() previously only generated alerts for expiring/expired
-- employee_training_records. Expands it to cover the other compliance-relevant scenarios that
-- already had a place in alerts.alert_type's check constraint but no generator: practicum
-- due/expired, missing required documents, and expiring certificates. Also wires alerts into the
-- notification center (20260704200000) via a per-insert trigger that maps alert_type to a
-- learner-facing notification.

create or replace function public.recalculate_all_compliance()
returns void language plpgsql security definer set search_path to 'public' as $function$
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

  -- Practicum compliance alerts. Practicums don't have the training-record's
  -- graduated due_90..due_7 buckets, just due_soon/expired, so this collapses
  -- to a single non-overdue bucket (due_30) alongside overdue.
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

  -- Missing-required-document alerts: a training record with a completion
  -- date on file, whose training_type demands supporting evidence
  -- (document_required), but with no training_documents row referencing it.
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

  -- Certificate-expiring alerts: within 60 days of expiry, or already past it.
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
end;
$function$;

-- Fan each newly-inserted alert out to the assigned employee's notification feed, mapping the
-- alert's own type/target-column combination onto a learner-facing notification_type.
create or replace function public.notify_training_alert()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_profile_id uuid; v_notification_type text;
begin
  v_notification_type := case
    when new.alert_type = 'missing_document' then 'missing_document'
    when new.alert_type = 'certificate_expiring' then 'certificate_expiring'
    when new.practicum_id is not null and new.alert_type = 'overdue' then 'practicum_expired'
    when new.practicum_id is not null
         and new.alert_type in ('due_90', 'due_60', 'due_30', 'due_14', 'due_7') then 'practicum_due_soon'
    when new.training_record_id is not null and new.alert_type = 'overdue' then 'training_expired'
    when new.training_record_id is not null
         and new.alert_type in ('due_90', 'due_60', 'due_30', 'due_14', 'due_7') then 'training_due_soon'
    else null
  end;
  if new.employee_id is null or v_notification_type is null then
    return new;
  end if;
  select profile_id into v_profile_id from public.employees where id = new.employee_id;
  if v_profile_id is null then return new; end if;
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  values (new.organization_id, v_profile_id, v_notification_type, new.title, new.message, '/me');
  return new;
end;
$function$;
create trigger notify_training_alert after insert on public.alerts
  for each row execute function public.notify_training_alert();
