-- Review finding (wave 5): the alert queue only ever grows. Every recalc path inserts
-- and escalates open alerts (training due/overdue, missing_document, practicum,
-- certificate_expiring, credential_expiring, corrective_action_overdue,
-- incident_notification_overdue, resident compliance) but nothing ever resolves one
-- when the underlying gap is fixed:
--   * A training record renewed via complete_training_class inserts a NEW compliant
--     row and leaves the old row 'expired' forever, so its 'overdue' alert stays open
--     forever (and escalate_unactioned_alerts keeps paging admins about it).
--   * A credential renewed in place flips back to 'compliant' -- its alert stays open.
--   * A completed corrective action or incident notification keeps its alert open.
-- Operators would have to hand-dismiss every alert after fixing the gap, and /app/alerts
-- plus the weekly digests (which count open alerts) drift further from reality every week.
--
-- Fix: a single resolve_stale_compliance_alerts() pass that closes open alerts whose
-- source condition no longer holds, called from recalculate_all_compliance() (nightly,
-- all orgs), recalculate_incident_notifications() (hourly, its own domain), and
-- complete_training_class() (so an in-person renewal clears the operator's queue
-- immediately). Dismissed alerts are never touched.
--
-- Also fixed here (same functions, so one full-body replace):
--   * recalculate_all_compliance() re-updated practicums with session current_date
--     (UTC on hosted Supabase) immediately after recalculate_compliance_core() had
--     already computed them with the America/New_York calendar day -- near midnight ET
--     the two disagree and the UTC value silently won. The redundant update is removed;
--     credentials and corrective actions now use the same PA day as the core.
--   * recalculate_resident_compliance_statuses() also used current_date; now PA day.
--   * corrective actions marked 'overdue' by the nightly job now step back to 'open'
--     when their due date is pushed into the future (previously one-way forever).
--   * recalculate_incident_notifications() was executable by ANY authenticated user
--     (global SECURITY DEFINER update across every org -- alert-spam/DoS surface).
--     It is cron/service-role-only now, matching recalculate_all_compliance().
--   * complete_training_class() locks the class row (FOR UPDATE), so two concurrent
--     completions of the same class can no longer both see attendees with
--     training_record_id IS NULL and double-issue training records/hours.

create or replace function public.resolve_stale_compliance_alerts(p_organization_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pa_today date := (now() at time zone 'America/New_York')::date;
begin
  -- Training due/overdue alerts: resolve when the record is no longer due/expired, or
  -- when a renewal inserted a sibling compliant record for the same requirement (the
  -- old row stays 'expired' forever by design, but its alert must not).
  update public.alerts a
  set status = 'resolved', resolved_at = now()
  from public.employee_training_records r
  where a.training_record_id = r.id
    and a.status = 'open'
    and a.alert_type in ('due_90','due_60','due_30','due_14','due_7','overdue')
    and (p_organization_id is null or a.organization_id = p_organization_id)
    and (
      r.status not in ('due_soon','expired')
      or exists (
        select 1 from public.employee_training_records cur
        where cur.employee_id = r.employee_id
          and cur.training_type_id = r.training_type_id
          and cur.id <> r.id
          and cur.status = 'compliant'
      )
    );

  -- Missing-document alerts: resolve once a document exists (or the record/type no
  -- longer requires one).
  update public.alerts a
  set status = 'resolved', resolved_at = now()
  from public.employee_training_records r
  join public.training_types tt on tt.id = r.training_type_id
  where a.training_record_id = r.id
    and a.status = 'open'
    and a.alert_type = 'missing_document'
    and (p_organization_id is null or a.organization_id = p_organization_id)
    and not (
      r.completion_date is not null
      and tt.document_required
      and not exists (select 1 from public.training_documents d where d.training_record_id = r.id)
    );

  -- Practicum alerts: resolve when the practicum is compliant again, or when a
  -- later-year practicum row supersedes it (prior years stay 'expired' forever).
  update public.alerts a
  set status = 'resolved', resolved_at = now()
  from public.practicums p
  where a.practicum_id = p.id
    and a.status = 'open'
    and a.alert_type in ('due_30','overdue')
    and (p_organization_id is null or a.organization_id = p_organization_id)
    and (
      p.status not in ('due_soon','expired')
      or exists (
        select 1 from public.practicums p2
        where p2.employee_id = p.employee_id and p2.practicum_year > p.practicum_year
      )
    );

  -- Certificate expiry alerts: resolve when the certificate stops expiring within the
  -- 60-day window, or when a newer certificate for the same employee+course covers it.
  update public.alerts a
  set status = 'resolved', resolved_at = now()
  from public.certificates c
  where a.certificate_id = c.id
    and a.status = 'open'
    and a.alert_type = 'certificate_expiring'
    and (p_organization_id is null or a.organization_id = p_organization_id)
    and (
      c.expires_at is null
      or c.expires_at > now() + interval '60 days'
      or exists (
        select 1 from public.certificates c2
        where c2.employee_id = c.employee_id
          and c2.course_id = c.course_id
          and c2.id <> c.id
          and (c2.expires_at is null or c2.expires_at > now() + interval '60 days')
      )
    );

  -- Credential expiry alerts: credentials renew in place, so the record itself
  -- flipping out of due_soon/expired is the whole signal.
  update public.alerts a
  set status = 'resolved', resolved_at = now()
  from public.employee_credentials c
  where a.employee_credential_id = c.id
    and a.status = 'open'
    and a.alert_type = 'credential_expiring'
    and (p_organization_id is null or a.organization_id = p_organization_id)
    and c.status not in ('due_soon','expired');

  -- Corrective-action alerts: resolve on completion/cancellation, or when the due
  -- date moves back into the future.
  update public.alerts a
  set status = 'resolved', resolved_at = now()
  from public.corrective_actions ca
  where a.corrective_action_id = ca.id
    and a.status = 'open'
    and a.alert_type = 'corrective_action_overdue'
    and (p_organization_id is null or a.organization_id = p_organization_id)
    and (ca.status in ('completed','cancelled') or ca.due_date is null or ca.due_date >= v_pa_today);

  -- Incident-notification alerts: resolve once the notification is completed (or no
  -- longer overdue after a due_at correction).
  update public.alerts a
  set status = 'resolved', resolved_at = now()
  from public.incident_notifications n
  where a.incident_notification_id = n.id
    and a.status = 'open'
    and a.alert_type = 'incident_notification_overdue'
    and (p_organization_id is null or a.organization_id = p_organization_id)
    and n.status <> 'overdue';

  -- Resident compliance alerts: items recompute bidirectionally (completed_date =>
  -- 'compliant'), so status is authoritative.
  update public.alerts a
  set status = 'resolved', resolved_at = now()
  from public.resident_compliance_items rci
  where a.resident_compliance_item_id = rci.id
    and a.status = 'open'
    and a.alert_type in ('resident_compliance_due_soon','overdue')
    and (p_organization_id is null or a.organization_id = p_organization_id)
    and rci.status not in ('due_soon','expired');
end;
$$;
revoke all on function public.resolve_stale_compliance_alerts(uuid) from public, anon, authenticated;
grant execute on function public.resolve_stale_compliance_alerts(uuid) to service_role;

-- PA calendar day instead of UTC current_date, mirroring recalculate_compliance_core.
create or replace function public.recalculate_resident_compliance_statuses()
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_pa_today date := (now() at time zone 'America/New_York')::date;
begin
  update public.resident_compliance_items
  set status = case
    when status = 'not_applicable' then status
    when completed_date is not null then 'compliant'
    when due_date is null then 'missing'
    when due_date + grace_period_days < v_pa_today then 'expired'
    when due_date <= v_pa_today + warning_days then 'due_soon'
    else 'missing'
  end
  where status <> 'not_applicable';
end;
$$;
revoke all on function public.recalculate_resident_compliance_statuses() from public, anon, authenticated;

-- Full-body copy of 20260705022111's recalculate_incident_notifications() plus the
-- resolve pass; execution restricted to the cron/service-role path (it updates every
-- organization's rows, so an authenticated grant was a cross-tenant noise/DoS surface;
-- the app never calls it client-side).
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

  update public.alerts a
  set status = 'resolved', resolved_at = now()
  from public.incident_notifications n
  where a.incident_notification_id = n.id
    and a.status = 'open'
    and a.alert_type = 'incident_notification_overdue'
    and n.status <> 'overdue';
end;
$$;
revoke all on function public.recalculate_incident_notifications() from public, anon, authenticated;
grant execute on function public.recalculate_incident_notifications() to service_role;

-- Full-body copy of 20260706181430's recalculate_all_compliance() with:
--   * the redundant practicum status update removed (recalculate_compliance_core
--     already owns it, on the America/New_York day);
--   * credential + corrective-action date math moved to the same PA day;
--   * corrective actions un-marked from 'overdue' back to 'open' when no longer past due;
--   * the resolve pass appended.
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

  -- Close every open alert whose underlying gap is fixed (statuses above are final now).
  perform public.resolve_stale_compliance_alerts(null);
end;
$$;

-- Full-body copy of 20260705163017's complete_training_class() with two changes:
--   * the class row is locked FOR UPDATE, so two concurrent completions cannot both
--     read attendees with training_record_id IS NULL and double-issue records/hours;
--   * stale alerts for the org resolve immediately, so renewing a course in person
--     clears the employee's overdue alert without waiting for the nightly job.
create or replace function public.complete_training_class(p_class_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_class record;
  v_attendee record;
  v_record_id uuid;
  v_hours numeric;
begin
  select * into v_class from public.training_classes where id = p_class_id for update;
  if v_class is null then
    raise exception 'training class not found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_class.organization_id = public.current_org_id()
        and (public.current_role() in ('org_admin','facility_manager')
             or (public.current_role() = 'trainer' and v_class.trainer_profile_id = auth.uid())))
  ) then
    raise exception 'not authorized to complete this training class';
  end if;

  for v_attendee in
    select * from public.training_class_attendees where class_id = p_class_id and attended = true and training_record_id is null
  loop
    v_hours := case
      when v_attendee.checked_in_at is not null and v_attendee.checked_out_at is not null
        then greatest(round(extract(epoch from (v_attendee.checked_out_at - v_attendee.checked_in_at)) / 3600.0, 2), 0)
      else v_class.duration_hours
    end;

    insert into public.employee_training_records (
      organization_id, facility_id, employee_id, training_type_id,
      completion_date, status, trainer_name, hours, completion_method
    )
    select
      v_class.organization_id, coalesce(v_class.facility_id, e.facility_id), v_attendee.employee_id, v_class.training_type_id,
      v_class.class_date, 'compliant',
      (select first_name || ' ' || last_name from public.profiles where id = v_class.trainer_profile_id),
      v_hours, 'in_person'
    from public.employees e where e.id = v_attendee.employee_id
    returning id into v_record_id;

    update public.training_class_attendees set training_record_id = v_record_id where id = v_attendee.id;
  end loop;

  update public.training_classes set status = 'completed' where id = p_class_id;

  perform public.recalculate_compliance_core(v_class.organization_id);
  perform public.resolve_stale_compliance_alerts(v_class.organization_id);
end;
$$;
