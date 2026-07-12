-- State Forms reminders & digest: keep DHS-required resident form deadlines in front of the
-- people who can act on them instead of relying on someone visiting the page.
--
-- 1. resident_compliance_items.reminder_sent_at -- per-item reminder dedup, same pattern as
--    policy_attestations.reminder_sent_at (20260705152437).
-- 2. notify_resident_compliance_alert() now links the State Forms Center (/app/state-forms)
--    and stamps reminder_sent_at, so the alert-open notification counts as reminder #1 and the
--    weekly sweep can't immediately re-notify the same items.
-- 3. send_resident_compliance_reminders() -- weekly per-recipient AGGREGATED sweep (one
--    notification summarizing N items, not N notifications) for open due_soon/expired items on
--    active residents. notification_type 'resident_compliance_due' is already in
--    queue_notification_delivery()'s email/SMS allow-list (20260711164439), so these reach
--    email/SMS like training reminders do.
-- 4. send_monday_digest() gains resident state-form counts (full-body copy of the LATEST
--    definition in 20260711164439 -- functions here are replaced whole; copying an older body
--    would silently revert later fixes).
-- 5. execute_registered_sql_job() gains the 'resident-compliance-reminders' case (full-body
--    copy of the latest definition in 20260711162509).
-- 6. Job registration + cron schedule (daily 12:15, between the policy reminders at 12:00 and
--    course continuation reminders at 14:00).
--
-- Known overlap, accepted: escalate_unactioned_alerts() separately re-notifies alerts idle 5+
-- days. That path targets specific unactioned alerts, not the recurring "what's due" cadence,
-- and stamps nothing here.

-- 1 ---------------------------------------------------------------------------
alter table public.resident_compliance_items
  add column reminder_sent_at timestamptz;

-- 2 ---------------------------------------------------------------------------
-- Same body as 20260706155552 except: link -> /app/state-forms, plus the reminder_sent_at stamp.
-- Both existing triggers (alert insert 20260706155552, escalation re-notify 20260706155854) keep
-- pointing at this function; no trigger changes.
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
      '/app/state-forms'
    );
  end loop;

  -- The alert-open notification IS the first reminder for this item -- stamp it so the weekly
  -- sweep below can't double-fire inside the same window.
  update public.resident_compliance_items
  set reminder_sent_at = now()
  where id = new.resident_compliance_item_id;

  return new;
end;
$function$;
revoke all on function public.notify_resident_compliance_alert() from public, anon, authenticated;

-- 3 ---------------------------------------------------------------------------
create or replace function public.send_resident_compliance_reminders()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_admin record;
  v_due_soon integer;
  v_expired integer;
begin
  for v_admin in
    select p.id as profile_id, p.organization_id, p.role
    from public.profiles p
    where p.role in ('org_admin', 'facility_manager') and p.is_active
  loop
    select count(*) filter (where i.status = 'due_soon'),
           count(*) filter (where i.status = 'expired')
      into v_due_soon, v_expired
    from public.resident_compliance_items i
    join public.residents r on r.id = i.resident_id
    where i.organization_id = v_admin.organization_id
      and r.status = 'active'
      and i.status in ('due_soon', 'expired')
      and (i.reminder_sent_at is null or i.reminder_sent_at < now() - interval '7 days')
      and (
        v_admin.role = 'org_admin'
        or exists (
          select 1 from public.facility_assignments fa
          where fa.profile_id = v_admin.profile_id and fa.facility_id = i.facility_id
        )
      );

    if coalesce(v_due_soon, 0) = 0 and coalesce(v_expired, 0) = 0 then continue; end if;

    insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
    values (
      v_admin.organization_id, v_admin.profile_id, 'resident_compliance_due',
      'Resident state forms need attention',
      v_expired || ' expired and ' || v_due_soon || ' due soon across resident DHS-required forms.',
      '/app/state-forms'
    );
  end loop;

  -- Stamp swept items once, after every recipient was evaluated against the same eligibility
  -- window -- stamping inside the recipient loop would hide items from every recipient after the
  -- first. Discharged residents' items are never stamped or counted: they aren't actionable work.
  update public.resident_compliance_items i
  set reminder_sent_at = now()
  from public.residents r
  where r.id = i.resident_id
    and r.status = 'active'
    and i.status in ('due_soon', 'expired')
    and (i.reminder_sent_at is null or i.reminder_sent_at < now() - interval '7 days');
end;
$function$;
revoke all on function public.send_resident_compliance_reminders()
  from public, anon, authenticated;

-- 4 ---------------------------------------------------------------------------
-- Full-body copy of 20260711164439's send_monday_digest() plus resident state-form counts,
-- scoped identically (org-wide for org_admin, assigned facilities for facility_manager) and
-- included in the skip-if-all-zero check.
create or replace function public.send_monday_digest()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_admin record;
  v_due_soon integer;
  v_expired integer;
  v_critical_alerts integer;
  v_resident_due_soon integer;
  v_resident_expired integer;
  v_notification_id uuid;
begin
  for v_admin in
    select p.id as profile_id, p.organization_id, p.role
    from public.profiles p
    where p.role in ('org_admin', 'facility_manager') and p.is_active
  loop
    select count(*) filter (where r.status = 'due_soon'),
           count(*) filter (where r.status = 'expired')
      into v_due_soon, v_expired
    from public.employee_training_records r
    where r.organization_id = v_admin.organization_id
      and (
        v_admin.role = 'org_admin'
        or exists (
          select 1 from public.facility_assignments fa
          where fa.profile_id = v_admin.profile_id and fa.facility_id = r.facility_id
        )
      );

    select count(*) into v_critical_alerts
    from public.alerts a
    where a.organization_id = v_admin.organization_id
      and a.status = 'open' and a.severity = 'critical'
      and (
        v_admin.role = 'org_admin'
        or (
          a.facility_id is not null
          and exists (
            select 1 from public.facility_assignments fa
            where fa.profile_id = v_admin.profile_id and fa.facility_id = a.facility_id
          )
        )
      );

    select count(*) filter (where i.status = 'due_soon'),
           count(*) filter (where i.status = 'expired')
      into v_resident_due_soon, v_resident_expired
    from public.resident_compliance_items i
    join public.residents res on res.id = i.resident_id
    where i.organization_id = v_admin.organization_id
      and res.status = 'active'
      and (
        v_admin.role = 'org_admin'
        or exists (
          select 1 from public.facility_assignments fa
          where fa.profile_id = v_admin.profile_id and fa.facility_id = i.facility_id
        )
      );

    if v_due_soon = 0 and v_expired = 0 and v_critical_alerts = 0
       and v_resident_due_soon = 0 and v_resident_expired = 0 then continue; end if;

    insert into public.notifications (
      organization_id, profile_id, notification_type, title, body, link
    ) values (
      v_admin.organization_id, v_admin.profile_id, 'training_due_soon',
      'Weekly compliance digest',
      v_expired || ' expired, ' || v_due_soon || ' due soon, ' ||
        v_critical_alerts || ' critical alert(s) open. Resident state forms: ' ||
        v_resident_expired || ' expired, ' || v_resident_due_soon || ' due soon.',
      '/app'
    ) returning id into v_notification_id;

    update public.notification_deliveries
    set delivery_type = 'digest'
    where notification_id = v_notification_id;
  end loop;
end;
$function$;
revoke all on function public.send_monday_digest()
  from public, anon, authenticated;

-- 5 ---------------------------------------------------------------------------
-- Full-body copy of 20260711162509's execute_registered_sql_job() plus the
-- 'resident-compliance-reminders' case. The mapping stays static; operators cannot inject SQL.
create or replace function public.execute_registered_sql_job(
  p_job_key text,
  p_correlation_id text,
  p_trigger_type text default 'scheduled'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim record;
  v_result jsonb := '{}'::jsonb;
begin
  select * into v_claim
  from public.claim_system_job_execution(
    p_job_key, p_correlation_id, p_trigger_type, null
  );
  if not coalesce(v_claim.should_execute, false) then
    return jsonb_build_object('replayed', true, 'runId', v_claim.run_id);
  end if;

  begin
    case p_job_key
      when 'compliance-recalculation' then perform public.recalculate_all_compliance();
      when 'incident-notifications' then perform public.recalculate_incident_notifications();
      when 'alert-escalation' then perform public.escalate_unactioned_alerts();
      when 'monday-digest' then perform public.send_monday_digest();
      when 'policy-reminders' then perform public.send_policy_attestation_reminders();
      when 'course-status-recalculation' then perform public.recalculate_course_assignment_statuses();
      when 'course-continuation-reminders' then perform public.queue_course_continuation_reminders();
      when 'resident-compliance-recalculation' then perform public.recalculate_resident_compliance_statuses();
      when 'resident-compliance-reminders' then perform public.send_resident_compliance_reminders();
      when 'audit-integrity-reconciliation' then
        v_result := public.reconcile_audit_integrity(10000);
        if coalesce((v_result ->> 'openIssues')::integer, 0) > 0 then
          perform public.finish_system_job(
            v_claim.run_id, 'failed', 1, 0, 1, v_result,
            'audit_integrity_issues',
            left('Audit integrity reconciliation found open issues: ' || v_result::text, 2000)
          );
          return v_result || jsonb_build_object(
            'runId', v_claim.run_id,
            'status', 'failed'
          );
        end if;
      when 'phase1-synthetic-health' then
        v_result := public.run_phase1_synthetic_checks();
        if coalesce((v_result ->> 'completedAssignmentsWithoutCertificate')::bigint, 0) > 0
           or coalesce((v_result ->> 'certificatePdfJobsExhausted')::bigint, 0) > 0
           or coalesce((v_result ->> 'notificationOutcomesUnknown')::bigint, 0) > 0
           or coalesce((v_result ->> 'exclusionSourcesWithoutActiveSnapshot')::bigint, 0) > 0
           or coalesce((v_result ->> 'auditIntegrityIssuesOpen')::bigint, 0) > 0
           or coalesce((v_result ->> 'auditTriggerGaps')::bigint, 0) > 0 then
          perform public.finish_system_job(
            v_claim.run_id, 'failed', 1, 0, 1, v_result,
            'synthetic_invariant_violation',
            left('Phase 1 synthetic checks found invariant violations: ' || v_result::text, 2000)
          );
          return v_result || jsonb_build_object(
            'runId', v_claim.run_id,
            'status', 'failed'
          );
        end if;
      else
        raise exception 'Job is not a registered SQL worker' using errcode = '22023';
    end case;

    perform public.finish_system_job(
      v_claim.run_id, 'succeeded', 1, 1, 0, v_result, null, null
    );
    return v_result || jsonb_build_object('runId', v_claim.run_id);
  exception when others then
    perform public.finish_system_job(
      v_claim.run_id, 'failed', 1, 0, 1, v_result,
      sqlstate, left(sqlerrm, 2000)
    );
    -- Re-raising would abort the cron transaction and roll the failed run
    -- record back with it. Keep failure evidence durable for alerting/retry.
    return jsonb_build_object(
      'runId', v_claim.run_id,
      'status', 'failed',
      'errorCode', sqlstate,
      'errorMessage', left(sqlerrm, 2000)
    );
  end;
end;
$function$;
revoke all on function public.execute_registered_sql_job(text, text, text)
  from public, anon, authenticated;
grant execute on function public.execute_registered_sql_job(text, text, text)
  to service_role;

-- 6 ---------------------------------------------------------------------------
insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values
  (
    'resident-compliance-reminders',
    'Resident state-form reminders',
    'Queues weekly aggregated reminders for open resident DHS form deadlines',
    'sql_cron',
    'resident-compliance-reminders-daily',
    interval '1 day', interval '30 hours', false, 'manual', '/admin/system-jobs'
  )
on conflict (job_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  execution_kind = excluded.execution_kind,
  cron_job_name = excluded.cron_job_name,
  expected_interval = excluded.expected_interval,
  freshness_sla = excluded.freshness_sla,
  is_critical = excluded.is_critical,
  retry_mode = excluded.retry_mode,
  operator_route = excluded.operator_route,
  updated_at = now();

select cron.unschedule(jobname)
from cron.job
where jobname = 'resident-compliance-reminders-daily';

select cron.schedule('resident-compliance-reminders-daily', '15 12 * * *',
  $$select public.execute_registered_sql_job('resident-compliance-reminders', gen_random_uuid()::text);$$);
