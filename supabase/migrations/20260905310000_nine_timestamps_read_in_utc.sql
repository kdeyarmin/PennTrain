-- Nine timestamps a Pennsylvania facility read in UTC (I23).
--
-- `to_char(some_timestamptz, 'Mon DD, YYYY HH12:MI AM')` renders in the SESSION's TimeZone, and
-- every one of these runs from a cron job or the service role, where that is UTC. Pennsylvania is
-- four or five hours behind it, so a fall reported at 8:00 PM on the 5th appeared in the alert a
-- facility manager reads as "Sep 06, 12:00 AM" -- the wrong time, and after 7 or 8 PM the wrong
-- DAY. The one place that matters most is where it was found: recalculate_incident_notifications
-- writes "notification is overdue for an incident reported ...", and the reporting time is what the
-- notification deadline runs from.
--
-- Nine call sites across eight functions, all of them user-visible text:
--
--   recalculate_incident_notifications  the incident an overdue notification belongs to
--   notify_incident_reported            the in-app notification for a new incident
--   recalculate_all_compliance          x2, a certificate's expiry in an alert
--   get_resident_timeline               "Returned <date>" on a hospital transfer, in a chart
--   start_emergency_event               the start time of a live emergency
--   sample_survey_rehearsal             the incident sampled into a survey rehearsal
--   enqueue_trial_expiry_notices        when a customer's trial ends
--   reconcile_stalled_exclusion_refresh_runs   an operator note about a stalled run
--
-- Deliberately NOT changed: app_private.compute_audit_event_hash renders `at time zone 'UTC'`
-- explicitly, which is correct -- a hash input has to be canonical, not local. And every to_char
-- over a `date` (policy_attestation_campaigns.next_occurrence_on, the OAPSA provisional expiry,
-- every `*_date` column) carries no time zone to get wrong.
--
-- public.pa_local is the counterpart to public.pa_day, which already exists and returns the
-- Pennsylvania calendar date for an instant. This returns the whole local timestamp, so the two
-- cover both shapes and there is one obvious thing to reach for.

create or replace function public.pa_local(p_at timestamptz)
returns timestamp
language sql
stable
as $function$
  -- Null in, null out, matching pa_day. No `set search_path` either, matching the whole pa_*
  -- family: these are SECURITY INVOKER and their bodies are pg_catalog-qualified, so the advisor's
  -- mutable-search_path warning names a shape that carries no escalation. Adding a pin here alone
  -- would make this one helper differ from its six siblings for no gain.
  select pg_catalog.timezone('America/New_York', p_at)
$function$;

comment on function public.pa_local(timestamptz) is
  'The Pennsylvania wall-clock timestamp for an instant. Use before to_char whenever the result is '
  'shown to a person: to_char on a timestamptz renders in the session time zone, which is UTC for '
  'every cron job and service-role call.';

revoke all on function public.pa_local(timestamptz) from public, anon;
grant execute on function public.pa_local(timestamptz) to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- The nine call sites
------------------------------------------------------------------------------------------------
-- Bodies extracted from the live catalog with pg_get_functiondef and patched at the to_char, so
-- nothing else in any of them can drift.

CREATE OR REPLACE FUNCTION app_private.enqueue_trial_expiry_notices()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org record;
  v_admin record;
  v_threshold integer;
  v_days_left integer;
  v_notification_id uuid;
  v_enqueued integer := 0;
begin
  for v_org in
    select o.id, o.name, o.trial_ends_at
    from public.organizations o
    join public.billing_accounts a on a.organization_id = o.id
    where o.trial_ends_at is not null
      and o.trial_ends_at > now()
      and o.trial_ends_at <= now() + interval '7 days'
      and not o.is_demo
      -- Only accounts still living off the signup trial. Comped, active,
      -- suspended, and already-downgraded accounts are not trial-notice
      -- audiences.
      and a.billing_state = 'trial'
      -- A live subscription (its own Stripe trial included) overrides the
      -- in-app window -- same guard as get_effective_entitlements.
      and not exists (
        select 1 from public.billing_subscriptions s
        where s.organization_id = o.id
          and s.billing_state in ('trial', 'active', 'grace')
      )
  loop
    -- Most-imminent applicable threshold only: T-7 through T-2 send the
    -- 7-day notice once; T-1 (or a catch-up run landing inside the final
    -- day) sends the 1-day notice once.
    v_threshold := case
      when v_org.trial_ends_at <= now() + interval '1 day' then 1
      else 7
    end;

    insert into app_private.billing_trial_notice_log (
      organization_id, threshold_days, trial_ends_at
    ) values (v_org.id, v_threshold, v_org.trial_ends_at)
    on conflict do nothing;
    if not found then
      continue; -- already notified for this window+threshold
    end if;

    v_days_left := greatest(
      1, ceil(extract(epoch from (v_org.trial_ends_at - now())) / 86400)::integer);

    for v_admin in
      select p.id
      from public.profiles p
      where p.organization_id = v_org.id
        and p.role = 'org_admin'
        and p.is_active
    loop
      insert into public.notifications (
        organization_id, profile_id, notification_type, title, body, link
      ) values (
        v_org.id, v_admin.id, 'billing_trial_expiring',
        case when v_threshold = 1
          then 'Your free trial ends tomorrow'
          else 'Your free trial is ending soon' end,
        'The ' || v_org.name || ' free trial ends on '
          || to_char(public.pa_local(v_org.trial_ends_at), 'FMMonth DD, YYYY')
          || ' (' || v_days_left || ' day' || case when v_days_left = 1 then '' else 's' end
          || ' left). Choose a plan to keep uninterrupted access to your subscribed modules.',
        '/app/billing'
      ) returning id into v_notification_id;

      -- Off-platform delivery honors the recipient's preferred channel,
      -- consent, and org channel settings; the dispatch worker sends the
      -- generic external copy for this type.
      perform public.enqueue_preferred_notification_delivery(
        v_org.id, v_admin.id, v_notification_id, 'alert');
      v_enqueued := v_enqueued + 1;
    end loop;
  end loop;

  return v_enqueued;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.reconcile_stalled_exclusion_refresh_runs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run record;
  v_closed integer := 0;
begin
  for v_run in
    select id, source, coalesce(last_progress_at, started_at) as last_progress
    from public.exclusion_refresh_runs
    where status = 'staging'
      and coalesce(last_progress_at, started_at) < now() - interval '6 hours'
    order by started_at
  loop
    -- Through the same function every other failure goes through, so the run, its snapshot and
    -- exclusion_source_state cannot end up disagreeing about what happened.
    perform public.fail_exclusion_source_refresh(
      v_run.id,
      'No staging progress since ' || to_char(public.pa_local(v_run.last_progress), 'YYYY-MM-DD HH24:MI:SS "ET"')
        || '; the worker that opened this refresh never finished it. Closed by '
        || 'app_private.reconcile_stalled_exclusion_refresh_runs.'
    );
    v_closed := v_closed + 1;
  end loop;

  return v_closed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_resident_timeline(p_resident_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(occurred_at timestamp with time zone, event_type text, title text, status text, detail text, href text, source_id uuid)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_res public.residents%rowtype;
begin
  -- Invoker rights, so this select is already scoped by the residents RLS policy; a resident the
  -- caller cannot see yields no row and no log entry, and the union below returns nothing either.
  select * into v_res from public.residents where id = p_resident_id;
  if found and public.can_read_clinical_record(v_res.organization_id, v_res.facility_id) then
    perform public.log_clinical_access(p_resident_id, 'view_domain', 'timeline', null, null);
  end if;
  return query
    select event.occurred_at, event.event_type, event.title, event.status,
      event.detail, event.href, event.source_id
    from (
      -- Every branch is carried forward unchanged from 20260726070100 and 20260828120000 -- dropping
      -- any of them would silently empty the clinical chart's timeline. This body was extracted from
      -- the live catalog with pg_get_functiondef and patched, not retyped.
      -- TRAP, carried forward: a UNION takes its column names from the FIRST branch, and the outer
      -- select references them by name (event.occurred_at). That branch must alias occurred_at
      -- explicitly -- which is why the appointment branch is appended rather than placed first.
      select h.transfer_time as occurred_at, 'hospital_transfer'::text event_type,
        'Hospital transfer: ' || coalesce(h.destination, 'hospital') title,
        h.status,
        left(concat_ws(' · ',
          nullif(h.reason, ''),
          case when h.status = 'returned' then 'Returned ' || to_char(public.pa_local(h.return_time), 'YYYY-MM-DD') end,
          nullif(h.condition_changes, ''),
          nullif(h.diet_changes, ''),
          nullif(h.mobility_changes, '')
        ), 500) detail,
        '/app/residents/' || h.resident_id::text || '?tab=timeline' href, h.id source_id
      from public.hospital_transfer_episodes h
      where h.resident_id = p_resident_id and h.status <> 'canceled'
      union all
      select coalesce(rr.assessor_signed_at, rr.created_at), 'assessment_review',
        'Review: ' || replace(rr.template_key, '_', ' '), rr.status,
        left(coalesce(rr.assessor_name, ''), 500),
        '/app/residents/' || rr.resident_id::text || '?tab=assessments', rr.id
      from public.resident_assessment_reviews rr where rr.resident_id = p_resident_id
      union all
      select us.occurred_at, 'unscheduled_service',
        'Extra care: ' || replace(us.service_kind, '_', ' '), null::text,
        left(coalesce(us.note, ''), 500), '/app/resident-care-delivery', us.id
      from public.resident_unscheduled_services us where us.resident_id = p_resident_id
      union all
      select i.occurred_at, 'incident',
        'Incident: ' || replace(i.incident_type, '_', ' '),
        i.status, left(i.narrative, 500),
        '/app/incidents/' || i.id::text, i.id
      from public.incidents i where i.resident_id = p_resident_id
      union all
      select c.identified_at, 'change_of_condition',
        'Condition change: ' || replace(c.category, '_', ' '), c.status,
        left(c.immediate_observations, 500), '/app/change-of-condition/' || c.id::text, c.id
      from public.resident_change_events c where c.resident_id = p_resident_id
      union all
      -- completion_response is preferred over status so the timeline shows what staff documented
      -- ("completed with more assistance") rather than only that the task closed.
      select coalesce(s.performed_at, s.scheduled_start), 'resident_service',
        'Service: ' || s.service_name, coalesce(s.completion_response, s.status),
        left(s.note, 500), '/app/services', s.id
      from public.resident_service_task_instances s where s.resident_id = p_resident_id
      union all
      select co.created_at, 'complaint', 'Complaint: ' || replace(co.category, '_', ' '),
        co.status, left(co.description, 500), '/app/complaints/' || co.id::text, co.id
      from public.complaints co where co.resident_id = p_resident_id
      union all
      select rc.updated_at, 'compliance', 'Compliance: ' || replace(rc.item_type, '_', ' '),
        rc.status, left(rc.notes, 500), '/app/residents/' || rc.resident_id::text, rc.id
      from public.resident_compliance_items rc where rc.resident_id = p_resident_id
      union all
      select d.occurred_at, 'dietary', 'Dietary: ' || replace(d.event_type, '_', ' '),
        null::text, left(d.summary, 500), '/app/dietary-operations?resident=' || d.resident_id::text, d.id
      from public.dietary_operations_history d where d.resident_id = p_resident_id
      union all
      select f.created_at, 'financial', 'Financial: ' || replace(f.event_type, '_', ' '),
        null::text, left(f.summary, 500), '/app/resident-finance?resident=' || f.resident_id::text, f.id
      from public.resident_financial_history f where f.resident_id = p_resident_id
      union all
      select a.occurred_at, 'external_medication',
        'External eMAR: ' || replace(a.administration_status, '_', ' '),
        a.administration_status,
        left(coalesce(o.medication_display, 'Medication administration evidence'), 500),
        '/app/medication-integration?resident=' || a.resident_id::text, a.id
      from public.external_medication_administration_events a
      left join public.external_medication_orders o
        on o.source_id = a.source_id and o.external_order_id = a.external_order_id
      where a.resident_id = p_resident_id
      union all
      select ob.observed_at, 'vital',
        'Vital: ' || replace(ob.observation_type, '_', ' '), ob.abnormal_flag,
        coalesce(ob.value_numeric::text, ob.value_text) || coalesce(' ' || ob.unit, ''),
        '/app/residents/' || ob.resident_id::text || '/chart', ob.id
      from public.clinical_observations ob
      where ob.resident_id = p_resident_id and not ob.entered_in_error
      union all
      select n.authored_at, 'progress_note',
        'Note: ' || replace(n.note_type, '_', ' '), n.status, left(n.body, 500),
        '/app/residents/' || n.resident_id::text || '/chart', n.id
      from public.clinical_progress_notes n where n.resident_id = p_resident_id
      union all
      select ca.assessed_at, 'assessment',
        'Assessment: ' || replace(ca.assessment_type, '_', ' '), ca.status,
        coalesce('Score ' || ca.score::text, '') || coalesce(' · ' || ca.risk_band, ''),
        '/app/residents/' || ca.resident_id::text || '/chart', ca.id
      from public.clinical_assessments ca where ca.resident_id = p_resident_id
      union all
      select coalesce(fc.recorded_date, fc.source_updated_at), 'diagnosis',
        'Diagnosis: ' || fc.code_display, fc.clinical_status, fc.code,
        '/app/residents/' || fc.resident_id::text || '/chart', fc.id
      from public.fhir_conditions fc where fc.resident_id = p_resident_id
      union all
      select coalesce(fm.authored_on, fm.source_updated_at), 'medication',
        'Medication: ' || fm.medication_display, fm.request_status, fm.dosage_text,
        '/app/residents/' || fm.resident_id::text || '/chart', fm.id
      from public.fhir_medication_requests fm where fm.resident_id = p_resident_id
      union all
      -- An appointment is the most common reason a resident leaves the building, and the most common
      -- source of an order change the support plan does not yet reflect. It was the one resident-level
      -- record with no timeline entry at all.
      select ap.starts_at, 'appointment',
        'Appointment: ' || ap.appointment_type, ap.status,
        left(concat_ws(' · ',
          nullif(ap.provider_name, ''),
          nullif(ap.location, ''),
          case when ap.new_order_ack_status = 'pending_review' then 'New orders awaiting acknowledgement' end,
          nullif(ap.outcome_summary, '')
        ), 500),
        '/app/residents/' || ap.resident_id::text || '?tab=appointments', ap.id
      from public.resident_appointments ap where ap.resident_id = p_resident_id
    ) event
    where event.occurred_at is not null
    order by event.occurred_at desc, event.source_id
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_incident_reported()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      replace(new.incident_type, '_', ' ') || ' incident reported ' || to_char(public.pa_local(new.occurred_at), 'Mon DD, YYYY HH12:MI AM'),
      '/app/incidents/' || new.id
    );
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_all_compliance()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      message = 'Certificate for ' || co.title || ' expired ' || to_char(public.pa_local(c.expires_at), 'Mon DD, YYYY') || ' for ' || e.first_name || ' ' || e.last_name
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
    'Certificate for ' || co.title || ' expires ' || to_char(public.pa_local(c.expires_at), 'Mon DD, YYYY') || ' for ' || e.first_name || ' ' || e.last_name,
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
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_incident_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.incident_notifications n
  set status = case
    when n.completed_at is not null then 'completed'
    when n.due_at < now() then 'overdue'
    else 'pending'
  end
  where n.status <> 'not_required';

  insert into public.alerts (organization_id, facility_id, incident_notification_id, alert_type, title, message, severity)
  select
    n.organization_id, n.facility_id, n.id,
    'incident_notification_overdue',
    'Incident notification overdue',
    replace(n.notification_type, '_', ' ') || ' notification is overdue for an incident reported ' || to_char(public.pa_local(i.reported_at), 'Mon DD, YYYY HH12:MI AM'),
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
$function$;

CREATE OR REPLACE FUNCTION public.sample_survey_rehearsal(p_rehearsal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.survey_rehearsals%rowtype;
  v_inserted integer := 0;
begin
  select * into v from public.survey_rehearsals where id = p_rehearsal_id for update;
  if v.id is null then raise exception 'Survey rehearsal not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if v.status not in ('draft', 'sampled') then
    raise exception 'Only draft or sampled rehearsals can be (re)sampled' using errcode = '22023';
  end if;

  delete from public.survey_rehearsal_items where rehearsal_id = v.id;

  -- Random sample across current live compliance surfaces. Each domain contributes a share,
  -- then a final trim keeps the configured size.
  with pool as (
    (
      select 'employee_credential'::text as domain, c.id as source_id,
             concat(e.last_name, ', ', e.first_name, ': ', coalesce(c.credential_label, c.credential_type)) as source_label,
             case when c.status in ('expired', 'missing') then 'critical'
                  when c.status = 'due_soon' then 'elevated' else 'standard' end as risk_tier
      from public.employee_credentials c
      join public.employees e on e.id = c.employee_id
      where c.facility_id = v.facility_id and e.status = 'active'
      order by case when v.sample_method = 'high_risk'
        then case when c.status in ('expired', 'missing') then 0 when c.status = 'due_soon' then 1 else 2 end
        else 0 end,
        random()
      limit greatest(1, ceil(v.sample_size::numeric / 4))
    )
    union all
    (
      select 'training_record', t.id,
             concat(e.last_name, ', ', e.first_name, ': training ', coalesce(t.status, 'unknown')),
             case when t.status in ('expired', 'missing') then 'critical'
                  when t.status = 'due_soon' then 'elevated' else 'standard' end
      from public.employee_training_records t
      join public.employees e on e.id = t.employee_id
      where t.facility_id = v.facility_id and e.status = 'active'
      order by case when v.sample_method = 'high_risk'
        then case when t.status in ('expired', 'missing') then 0 when t.status = 'due_soon' then 1 else 2 end
        else 0 end,
        random()
      limit greatest(1, ceil(v.sample_size::numeric / 4))
    )
    union all
    (
      select 'incident', i.id,
             concat('Incident ', coalesce(i.incident_type, 'event'), ' · ', to_char(public.pa_local(i.occurred_at), 'YYYY-MM-DD')),
             case when i.closed_at is null then 'elevated' else 'standard' end
      from public.incidents i
      where i.facility_id = v.facility_id
      order by case when v.sample_method = 'high_risk'
        then case when i.closed_at is null then 0 else 1 end
        else 0 end,
        random()
      limit greatest(1, ceil(v.sample_size::numeric / 4))
    )
    union all
    (
      select 'work_item', w.id,
             concat('Work: ', left(w.title, 120)),
             case when w.priority in ('urgent', 'high') then 'elevated' else 'standard' end
      from public.work_items w
      where w.facility_id = v.facility_id
        and w.state not in ('closed', 'canceled')
      order by case when v.sample_method = 'high_risk'
        then case when w.priority = 'urgent' then 0 when w.priority = 'high' then 1 else 2 end
        else 0 end,
        random()
      limit greatest(1, ceil(v.sample_size::numeric / 4))
    )
  ),
  chosen as (
    select * from pool
    order by case when v.sample_method = 'high_risk'
      then case risk_tier when 'critical' then 0 when 'elevated' then 1 else 2 end
      else 0 end,
      random()
    limit v.sample_size
  )
  insert into public.survey_rehearsal_items(
    organization_id, facility_id, rehearsal_id, domain, source_id, source_label, risk_tier
  )
  select v.organization_id, v.facility_id, v.id, domain, source_id, source_label, risk_tier
  from chosen;
  get diagnostics v_inserted = row_count;

  update public.survey_rehearsals
  set status = 'sampled',
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = v.id;

  return jsonb_build_object(
    'rehearsalId', v.id,
    'status', 'sampled',
    'itemCount', v_inserted,
    'sampleMethod', v.sample_method,
    'sampleSize', v.sample_size
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_emergency_event(p_facility_id uuid, p_event_mode text, p_event_type text, p_started_at timestamp with time zone, p_summary text, p_location_description text, p_assembly_point text, p_incident_commander uuid, p_incident_id uuid DEFAULT NULL::uuid, p_inspection_event_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fac public.facilities%rowtype;
  v_plan_version uuid;
  v_id uuid;
  v_number text;
  v_local_date date;
  v_local_time time;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_fac.organization_id, v_fac.id);
  select current_version_id into v_plan_version from public.emergency_plans where facility_id = v_fac.id;
  if v_plan_version is null then raise exception 'An approved emergency plan version is required' using errcode = '55000'; end if;
  if p_event_mode not in ('drill', 'actual')
     or p_event_type not in (
       'fire', 'severe_weather', 'power_outage', 'water_outage', 'hvac_outage',
       'evacuation', 'shelter_in_place', 'missing_person', 'infectious_disease',
       'transportation_disruption', 'other'
     )
     or length(btrim(coalesce(p_summary, ''))) < 5 then
    raise exception 'Emergency event declaration is incomplete' using errcode = '22023';
  end if;
  if p_incident_id is not null and not exists (
    select 1 from public.incidents i where i.id = p_incident_id and i.facility_id = v_fac.id
  ) then raise exception 'Linked incident crosses facility scope' using errcode = '42501'; end if;
  if p_inspection_event_id is not null and not exists (
    select 1 from public.inspection_events i where i.id = p_inspection_event_id and i.facility_id = v_fac.id
  ) then raise exception 'Linked drill crosses facility scope' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('emergency-event-number'), hashtext(v_fac.organization_id::text));
  v_number := 'EMG-' || to_char(public.pa_local(coalesce(p_started_at, now())), 'YYYY') || '-' ||
    lpad((select (count(*) + 1)::text from public.emergency_events where organization_id = v_fac.organization_id), 4, '0');
  insert into public.emergency_events (
    organization_id, facility_id, event_number, event_mode, event_type,
    plan_version_id, incident_id, inspection_event_id, incident_commander_profile_id,
    started_at, location_description, assembly_point, summary, declared_by
  ) values (
    v_fac.organization_id, v_fac.id, v_number, p_event_mode, p_event_type,
    v_plan_version, p_incident_id, p_inspection_event_id, p_incident_commander,
    coalesce(p_started_at, now()), nullif(btrim(p_location_description), ''),
    nullif(btrim(p_assembly_point), ''), btrim(p_summary), auth.uid()
  ) returning id, public.pa_day(started_at), public.pa_clock(started_at) into v_id, v_local_date, v_local_time;

  insert into public.emergency_event_residents (
    organization_id, facility_id, emergency_event_id, resident_id,
    resident_name_snapshot, room_snapshot, assistance_level_snapshot,
    mobility_needs_snapshot, transportation_needs_snapshot,
    evacuation_method_snapshot, required_equipment_snapshot
  )
  select
    r.organization_id, r.facility_id, v_id, r.id,
    r.first_name || ' ' || r.last_name, r.room,
    coalesce(ep.assistance_level, 'full_assistance'), ep.mobility_needs,
    ep.transportation_needs, ep.evacuation_method, ep.required_equipment
  from public.residents r
  left join public.resident_evacuation_profiles ep on ep.resident_id = r.id
  where r.facility_id = v_fac.id and r.status = 'active';

  insert into public.emergency_event_staff (
    organization_id, facility_id, emergency_event_id, employee_id,
    employee_name_snapshot, job_title_snapshot, responsibility_snapshot, roster_source
  )
  select distinct on (e.id)
    e.organization_id, v_fac.id, v_id, e.id, e.first_name || ' ' || e.last_name,
    e.job_title, coalesce(esa.responsibility, 'Scheduled shift'),
    case when sa.id is not null then 'scheduled_shift' else 'emergency_assignment' end
  from public.employees e
  left join public.shift_assignments sa on sa.employee_id = e.id
    and sa.facility_id = v_fac.id
    and sa.status in ('scheduled', 'confirmed', 'completed')
    and (
      (sa.start_time <= sa.end_time and sa.shift_date = v_local_date and v_local_time between sa.start_time and sa.end_time)
      or (sa.start_time > sa.end_time and (
        (sa.shift_date = v_local_date and v_local_time >= sa.start_time)
        or (sa.shift_date = v_local_date - 1 and v_local_time <= sa.end_time)
      ))
    )
  left join public.emergency_staff_assignments esa on esa.employee_id = e.id
    and esa.facility_id = v_fac.id and esa.is_active
  where e.organization_id = v_fac.organization_id and e.status = 'active'
    and (sa.id is not null or esa.id is not null)
  order by e.id, (sa.id is not null) desc, esa.is_backup, esa.created_at;

  insert into public.emergency_event_timeline (
    organization_id, facility_id, emergency_event_id, event_type,
    occurred_at, description, metadata, recorded_by
  ) values (
    v_fac.organization_id, v_fac.id, v_id, 'declared', coalesce(p_started_at, now()),
    'Emergency event declared and accountability rosters snapshotted.',
    jsonb_build_object('eventMode', p_event_mode, 'eventType', p_event_type), auth.uid()
  );
  return v_id;
end;
$function$;
