-- Forward-fix (review finding): recalculate_all_compliance() only escalates already-open alerts
-- for training_records and resident_compliance_items (the resident_compliance_item update block
-- added by 20260706100600_comprehensive_self_review_fixes.sql). practicum, certificate_expiring,
-- credential_expiring, and corrective_action_overdue alerts are still insert-only
-- (`not exists (... status = 'open')`), so once one of those opens at severity='warning' it can
-- never step up as the underlying record moves from due-soon to genuinely expired/overdue: the
-- not-exists guard on the insert blocks a second row, and there is no corresponding UPDATE path
-- (unlike employee_training_records, which recalculates its due_7/due_14/.../overdue alert_type
-- fresh on every insert attempt, and the resident_compliance_item path this migration mirrors).
--
-- A practicum 25 days from due_date opens a 'due_30'/warning alert; 30+ days later the practicum is
-- genuinely 'expired', but the alert is stuck at 'due_30'/warning forever -- an org_admin viewing
-- /app/alerts sees a yellow warning for a practicum that's actually overdue, understating survey
-- risk. It also breaks escalate_unactioned_alerts() (only escalates alert_type in ('due_7',
-- 'overdue')), so a stuck alert never reaches facility admins via the 5-day unactioned-alert
-- escalation path either. Same mechanism for certificate_expiring and credential_expiring (whose
-- alert_type never changes at all -- only severity should step from warning to critical once the
-- underlying record is actually expired), and for corrective_action_overdue (severity is hardcoded
-- 'warning' at insert with no way to reflect that it has now been overdue a long time).
--
-- Fix: add an explicit "escalate open warning to critical" UPDATE for each of these four alert
-- types, mirroring the resident_compliance_item pattern already used in recalculate_all_compliance(),
-- run before each type's corresponding not-exists-guarded insert so a freshly-expired record's
-- already-open alert is corrected in place rather than staying silently stale.
create or replace function public.recalculate_all_compliance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_compliance_core(null);

  update public.practicums p
  set status = case
    when p.due_date is null then 'missing'
    when p.due_date < current_date then 'expired'
    when p.due_date <= current_date + p.reminder_days then 'due_soon'
    else 'compliant'
  end;

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
    when c.expiration_date < current_date then 'expired'
    when c.expiration_date <= current_date + c.warning_days then 'due_soon'
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
    and ca.due_date < current_date;

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
    and ca.due_date < current_date - 14;

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
end;
$$;
