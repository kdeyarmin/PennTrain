-- Comprehensive self-review pass on PR #36 (in addition to, and alongside, Codex's round-7/8
-- findings), covering several issues an internal 8-angle review plus Codex's latest pass surfaced
-- together, applied in one batch rather than one Codex round at a time.

-- Finding Q (Codex P1): alerts_select's trainer branch (added by 20260705050000 specifically to
-- keep trainers from reading credential/incident-derived alert rows they can't read the underlying
-- table for) predates this PR's new resident_compliance_item_id-backed alerts and doesn't exclude
-- them. Residents.tsx/ResidentDetail.tsx/ResidentComplianceReport.tsx are all gated to
-- RESIDENT_ROLES = ('org_admin','facility_manager','auditor') -- trainer is deliberately excluded --
-- but /app/alerts is still reachable by trainer, and until now a trainer assigned to a facility
-- could read resident names and RASP/ASP deadlines straight out of the alerts row's title/message,
-- bypassing that exclusion entirely. Add the same exclusion the other three shapes already have.
alter policy alerts_select on public.alerts using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) in ('org_admin','auditor')
        or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))
        or (
          (select public.current_role()) = 'trainer'
          and public.is_assigned_to_facility(facility_id)
          and employee_credential_id is null
          and incident_notification_id is null
          and resident_compliance_item_id is null
          and not exists (
            select 1 from public.corrective_actions ca
            where ca.id = alerts.corrective_action_id and ca.incident_id is not null
          )
        )
      ))
);

-- Finding R (Codex P2): queue_notification_delivery()'s allow-list never included
-- 'resident_compliance_due', so even orgs with email/sms notifications enabled never got an
-- outbound delivery queued for a due-soon/overdue RASP/ASP deadline -- the whole point of Phase 4
-- was to stop staff from having to remember to check the dashboard, and a silently in-app-only
-- notification undercuts that for any org relying on the delivery channels every other alert type
-- here already uses.
create or replace function public.queue_notification_delivery()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_settings record;
  v_profile record;
begin
  if new.notification_type not in (
    'training_due_soon', 'training_expired', 'policy_attestation_due_soon', 'course_continuation_reminder',
    'resident_compliance_due'
  ) then
    return new;
  end if;

  select email_notifications_enabled, sms_notifications_enabled
    into v_settings
    from public.organization_settings where organization_id = new.organization_id;

  select email, phone, sms_opt_in, is_active into v_profile
    from public.profiles where id = new.profile_id;

  if v_profile is null or not v_profile.is_active then
    return new;
  end if;

  if coalesce(v_settings.email_notifications_enabled, false) and v_profile.email is not null then
    insert into public.notification_deliveries (organization_id, profile_id, notification_id, channel, delivery_type, recipient)
    values (new.organization_id, new.profile_id, new.id, 'email', 'alert', v_profile.email);
  end if;

  if coalesce(v_settings.sms_notifications_enabled, false) and v_profile.sms_opt_in and v_profile.phone is not null then
    insert into public.notification_deliveries (organization_id, profile_id, notification_id, channel, delivery_type, recipient)
    values (new.organization_id, new.profile_id, new.id, 'sms', 'alert', v_profile.phone);
  end if;

  return new;
end;
$function$;

-- Finding S (internal self-review, angle B): resident_compliance_rule_packs only ever seeds
-- admission_track = 'expedited' rows for facility_type = 'ALR' -- PCH has no 'expedited' rows by
-- design, since only ALR's 3 named exception conditions use that track. Residents.tsx's create form
-- hardcodes admission_track = 'standard' unless facility_type is ALR, but nothing in the schema
-- itself stops a direct API call/update from setting a PCH resident's admission_track to
-- 'expedited' -- and when that happens, this function's rule-pack join matches zero rows and
-- silently seeds NO compliance items at all for that resident (no exception, no indication anything
-- is wrong), unlike the NH/HHA/HOS/GH case, which is an intentional, documented scope exclusion.
-- Fix at the one place that actually matters: normalize the admission_track used for the rule-pack
-- lookup to 'standard' for any non-ALR facility, regardless of what's stored on the resident row.
create or replace function public.instantiate_resident_compliance_items(p_resident_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_res record; v_facility_type text; v_admission_track text; v_rule record;
begin
  select id, organization_id, facility_id, admission_date, admission_track into v_res
  from public.residents where id = p_resident_id;
  if v_res.id is null then
    return;
  end if;

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;
  v_admission_track := case when v_facility_type = 'ALR' then v_res.admission_track else 'standard' end;

  for v_rule in
    select distinct on (item_type) *
    from public.resident_compliance_rule_packs
    where facility_type = v_facility_type
      and admission_track = v_admission_track
      and state = 'PA'
      and is_active
      and (organization_id = v_res.organization_id or organization_id is null)
    order by item_type, organization_id nulls last
  loop
    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, citation_topic_id)
    values (
      v_res.organization_id, v_res.facility_id, v_res.id, v_rule.item_type,
      case when v_rule.offset_basis = 'before_admission'
        then v_res.admission_date - v_rule.offset_days
        else v_res.admission_date + v_rule.offset_days
      end,
      v_rule.renewal_interval_days, v_rule.warning_days, v_rule.grace_period_days,
      (select id from public.dhs_citation_topics where citation_ref = v_rule.citation_ref)
    );
  end loop;
end;
$$;
revoke all on function public.instantiate_resident_compliance_items(uuid) from public, anon, authenticated;

-- Finding T (internal self-review, angle A): both the original insert and the round-4 escalation
-- update build a resident-compliance alert's title from the raw item_type slug
-- (coalesce(rci.item_type, ...)) while the message on the very same row correctly humanizes it via
-- replace(rci.item_type, '_', ' ') -- so every resident alert's bold heading in Alerts.tsx reads
-- like "annual_reassessment -- Smith, John" while the line right below it reads "annual
-- reassessment has expired for John Smith". Make title consistent with message.
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
