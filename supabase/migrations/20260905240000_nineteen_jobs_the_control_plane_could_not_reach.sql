-- Nineteen jobs the control plane could not reach, and a switch that told nobody it was dead
-- (I17 residual).
--
-- `20260905150000` made the kill switch honest: the watchdog stops suppressing monitoring for a
-- definition whose switch cannot act, so flipping a dead one now changes nothing rather than
-- changing only the alerting. It deliberately left the other half, and said why -- re-registering
-- the direct cron entries is not a mechanical sweep, and getting one wrong stops a daily job
-- silently, which is the failure mode the row is about. This is that half, done per entry.
--
-- WHAT CHANGES. Nineteen definitions whose cron command was its own SQL statement
-- (`select public.escalate_overdue_work_items()` and the like) now call
-- `execute_registered_sql_job`, like the ten that already did. That is what puts them inside the
-- run ledger, the replay guard and the kill switch at once: none of the three could see them
-- before, so `system_job_runs` had no row for any of them, "Run now" had nothing to claim, and
-- the switch on their control-plane card did nothing at all.
--
-- THE THREE THAT NEEDED READING RATHER THAN SWEEPING, which is why this was not one regex:
--
--   * `compliance-requirement-maintenance-daily` runs THREE statements in one command. All three
--     are the job. Running the first alone would leave the readiness forecast and the invitation
--     lifecycle a day behind the requirements they are derived from, every day, with the control
--     plane reporting success.
--   * `generate-resident-service-tasks-daily` passes a date window, and
--     `drain-integration-command-inbox` a batch size. Those arguments move into the wrapper's own
--     branch, which is what lets every cron command be identical -- and the date window now reads
--     `pa_today()` rather than `current_date`, because after 19:00 Eastern the server has already
--     rolled over and the floor queue was being generated for the wrong first day.
--
-- THE ONE DELIBERATELY LEFT DIRECT. `system-job-last-success-watchdog` keeps its own statement.
-- Routing it through the wrapper would make ITS kill switch real, and a control plane where one
-- switch silences every other job's monitoring is a worse object than one where the watchdog
-- cannot be switched off. It is the only definition that judges the others, so it is the one that
-- must not be stoppable from the same screen. `kill_switch_can_stop_job` reports it as dead, which
-- is now the true answer for it and stays that way on purpose.
--
-- AND THE OPERATOR IS TOLD BEFORE THEY FLIP IT. `get_system_job_control_plane` returns
-- `kill_switch_enabled` and `kill_switch_can_stop`, so a switch that cannot act says so on its own
-- card instead of being discovered afterwards.
--
-- Rollback: re-register the nineteen cron entries with their previous single statements (listed
-- one per job above each `cron.schedule` below) and drop the new branches. The wrapper's other
-- branches and the control-plane columns are additive.

------------------------------------------------------------------------------------------------
-- 1. The wrapper learns the nineteen
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_registered_sql_job(p_job_key text, p_correlation_id text, p_trigger_type text DEFAULT 'scheduled'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- The nineteen that used to be registered as their own SQL statement (BACKLOG.md I17
      -- residual). Their cron entries now call this wrapper like the rest, so the kill switch,
      -- the run ledger and the replay guard cover them too. Arguments live here rather than in
      -- the cron command, which is what makes every entry identical and reviewable at a glance.
      when 'billing-trial-expiry' then perform app_private.enqueue_trial_expiry_notices();
      when 'carebase-report-subscriptions' then perform public.process_due_report_schedules();
      when 'change-followup-escalation' then perform public.escalate_overdue_change_follow_ups();
      when 'compliance-requirement-maintenance' then
        -- Three statements in one cron command, which is why this one could not be swept
        -- mechanically: all three are the job, and running one without the others leaves the
        -- readiness forecast and the invitation lifecycle a day behind the requirements.
        perform public.run_compliance_requirement_maintenance();
        perform public.run_workforce_readiness_forecast_maintenance();
        perform public.reconcile_user_invitation_lifecycle();
      when 'course-assignment-due-reminders' then perform public.queue_course_assignment_due_reminders();
      when 'fhir-integration-freshness' then perform public.run_fhir_integration_freshness_evaluator();
      when 'integration-command-inbox-drain' then perform app_private.drain_integration_command_inbox(20);
      when 'manager-weekly-digest' then perform public.queue_manager_weekly_digests();
      when 'medication-integration-freshness' then perform public.run_medication_integration_freshness_evaluator();
      when 'plan-of-correction-escalation' then perform public.run_plan_of_correction_escalations();
      when 'policy-campaign-recurrence' then perform public.spawn_due_policy_campaign_cycles();
      when 'policy-campaign-targeting' then perform public.run_policy_campaign_targeting();
      when 'public-demo-baseline-restore' then perform app_private.restore_all_demo_baselines();
      when 'resident-service-task-generation' then
        perform public.generate_resident_service_tasks(
          public.pa_today(), public.pa_today() + 14, null);
      when 'shift-handoff-escalation' then perform public.run_shift_handoff_escalations();
      when 'support-plan-activation' then perform public.activate_due_support_plans();
      when 'survey-day-session-expiry' then perform public.expire_stale_survey_day_sessions();
      when 'work-item-escalation' then perform public.escalate_overdue_work_items();
      when 'work-item-registration' then perform public.register_outstanding_work_items();
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
$function$

;

revoke all on function public.execute_registered_sql_job(text, text, text) from public, anon, authenticated;
grant execute on function public.execute_registered_sql_job(text, text, text) to service_role;

------------------------------------------------------------------------------------------------
-- 2. The nineteen cron entries, one at a time
------------------------------------------------------------------------------------------------
select cron.unschedule('billing-trial-expiry-notices')
where exists (select 1 from cron.job where jobname = 'billing-trial-expiry-notices');
select cron.schedule(
  'billing-trial-expiry-notices',
  '0 12 * * *',
  $$ select public.execute_registered_sql_job('billing-trial-expiry', gen_random_uuid()::text); $$
);

select cron.unschedule('process-carebase-report-subscriptions')
where exists (select 1 from cron.job where jobname = 'process-carebase-report-subscriptions');
select cron.schedule(
  'process-carebase-report-subscriptions',
  '*/15 * * * *',
  $$ select public.execute_registered_sql_job('carebase-report-subscriptions', gen_random_uuid()::text); $$
);

select cron.unschedule('escalate-change-followups')
where exists (select 1 from cron.job where jobname = 'escalate-change-followups');
select cron.schedule(
  'escalate-change-followups',
  '*/15 * * * *',
  $$ select public.execute_registered_sql_job('change-followup-escalation', gen_random_uuid()::text); $$
);

select cron.unschedule('compliance-requirement-maintenance-daily')
where exists (select 1 from cron.job where jobname = 'compliance-requirement-maintenance-daily');
select cron.schedule(
  'compliance-requirement-maintenance-daily',
  '15 6 * * *',
  $$ select public.execute_registered_sql_job('compliance-requirement-maintenance', gen_random_uuid()::text); $$
);

select cron.unschedule('course-assignment-due-reminders-daily')
where exists (select 1 from cron.job where jobname = 'course-assignment-due-reminders-daily');
select cron.schedule(
  'course-assignment-due-reminders-daily',
  '30 14 * * *',
  $$ select public.execute_registered_sql_job('course-assignment-due-reminders', gen_random_uuid()::text); $$
);

select cron.unschedule('fhir-integration-freshness')
where exists (select 1 from cron.job where jobname = 'fhir-integration-freshness');
select cron.schedule(
  'fhir-integration-freshness',
  '*/15 * * * *',
  $$ select public.execute_registered_sql_job('fhir-integration-freshness', gen_random_uuid()::text); $$
);

select cron.unschedule('drain-integration-command-inbox')
where exists (select 1 from cron.job where jobname = 'drain-integration-command-inbox');
select cron.schedule(
  'drain-integration-command-inbox',
  '*/5 * * * *',
  $$ select public.execute_registered_sql_job('integration-command-inbox-drain', gen_random_uuid()::text); $$
);

select cron.unschedule('manager-weekly-digest')
where exists (select 1 from cron.job where jobname = 'manager-weekly-digest');
select cron.schedule(
  'manager-weekly-digest',
  '0 12 * * 1',
  $$ select public.execute_registered_sql_job('manager-weekly-digest', gen_random_uuid()::text); $$
);

select cron.unschedule('medication-integration-freshness')
where exists (select 1 from cron.job where jobname = 'medication-integration-freshness');
select cron.schedule(
  'medication-integration-freshness',
  '*/15 * * * *',
  $$ select public.execute_registered_sql_job('medication-integration-freshness', gen_random_uuid()::text); $$
);

select cron.unschedule('escalate-plans-of-correction')
where exists (select 1 from cron.job where jobname = 'escalate-plans-of-correction');
select cron.schedule(
  'escalate-plans-of-correction',
  '30 11 * * *',
  $$ select public.execute_registered_sql_job('plan-of-correction-escalation', gen_random_uuid()::text); $$
);

select cron.unschedule('spawn-policy-campaign-cycles')
where exists (select 1 from cron.job where jobname = 'spawn-policy-campaign-cycles');
select cron.schedule(
  'spawn-policy-campaign-cycles',
  '30 10 * * *',
  $$ select public.execute_registered_sql_job('policy-campaign-recurrence', gen_random_uuid()::text); $$
);

select cron.unschedule('materialize-policy-campaign-targets')
where exists (select 1 from cron.job where jobname = 'materialize-policy-campaign-targets');
select cron.schedule(
  'materialize-policy-campaign-targets',
  '0 11 * * *',
  $$ select public.execute_registered_sql_job('policy-campaign-targeting', gen_random_uuid()::text); $$
);

select cron.unschedule('restore-public-demo-baseline')
where exists (select 1 from cron.job where jobname = 'restore-public-demo-baseline');
select cron.schedule(
  'restore-public-demo-baseline',
  '15 9 * * *',
  $$ select public.execute_registered_sql_job('public-demo-baseline-restore', gen_random_uuid()::text); $$
);

select cron.unschedule('generate-resident-service-tasks-daily')
where exists (select 1 from cron.job where jobname = 'generate-resident-service-tasks-daily');
select cron.schedule(
  'generate-resident-service-tasks-daily',
  '10 2 * * *',
  $$ select public.execute_registered_sql_job('resident-service-task-generation', gen_random_uuid()::text); $$
);

select cron.unschedule('escalate-shift-handoffs')
where exists (select 1 from cron.job where jobname = 'escalate-shift-handoffs');
select cron.schedule(
  'escalate-shift-handoffs',
  '*/15 * * * *',
  $$ select public.execute_registered_sql_job('shift-handoff-escalation', gen_random_uuid()::text); $$
);

select cron.unschedule('activate-due-support-plans')
where exists (select 1 from cron.job where jobname = 'activate-due-support-plans');
select cron.schedule(
  'activate-due-support-plans',
  '10 5 * * *',
  $$ select public.execute_registered_sql_job('support-plan-activation', gen_random_uuid()::text); $$
);

select cron.unschedule('expire-stale-survey-day-sessions')
where exists (select 1 from cron.job where jobname = 'expire-stale-survey-day-sessions');
select cron.schedule(
  'expire-stale-survey-day-sessions',
  '*/15 * * * *',
  $$ select public.execute_registered_sql_job('survey-day-session-expiry', gen_random_uuid()::text); $$
);

select cron.unschedule('escalate-overdue-work-items')
where exists (select 1 from cron.job where jobname = 'escalate-overdue-work-items');
select cron.schedule(
  'escalate-overdue-work-items',
  '*/15 * * * *',
  $$ select public.execute_registered_sql_job('work-item-escalation', gen_random_uuid()::text); $$
);

select cron.unschedule('register-outstanding-work-items')
where exists (select 1 from cron.job where jobname = 'register-outstanding-work-items');
select cron.schedule(
  'register-outstanding-work-items',
  '20 * * * *',
  $$ select public.execute_registered_sql_job('work-item-registration', gen_random_uuid()::text); $$
);

------------------------------------------------------------------------------------------------
-- 3. The control plane says whether the switch can act
------------------------------------------------------------------------------------------------
-- Dropped and recreated rather than replaced: widening a RETURNS TABLE changes the row type, and
-- CREATE OR REPLACE refuses that (42P13). The grant goes with the drop and is restated below.
drop function if exists public.get_system_job_control_plane();

CREATE OR REPLACE FUNCTION public.get_system_job_control_plane()
 RETURNS TABLE(job_key text, display_name text, description text, schedule text, execution_kind text, is_critical boolean, retry_mode text, operator_route text, last_status text, last_attempt_at timestamp with time zone, last_success_at timestamp with time zone, next_expected_at timestamp with time zone, last_duration_ms bigint, attempted_count bigint, succeeded_count bigint, failed_count bigint, error_message text, is_stale boolean, kill_switch_enabled boolean, kill_switch_can_stop boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may inspect system jobs'
      using errcode = '42501';
  end if;

  return query
  with job_state as (
    select
      d.*,
      c.schedule,
      own.status as own_status,
      own.started_at as own_started_at,
      own.finished_at as own_finished_at,
      own.attempted_count as own_attempted_count,
      own.succeeded_count as own_succeeded_count,
      own.failed_count as own_failed_count,
      own.error_message as own_error_message,
      own_success.started_at as own_success_at,
      cron_run.status as cron_status,
      cron_run.start_time as cron_started_at,
      cron_run.end_time as cron_finished_at,
      cron_run.return_message as cron_error_message,
      cron_success.start_time as cron_success_at
    from app_private.system_job_definitions as d
    left join cron.job as c
      on c.jobname = d.cron_job_name
    left join lateral (
      select r.*
      from app_private.system_job_runs as r
      where r.job_key = d.job_key
      order by r.started_at desc
      limit 1
    ) as own on true
    left join lateral (
      select r.started_at
      from app_private.system_job_runs as r
      where r.job_key = d.job_key
        and r.status = 'succeeded'
      order by r.started_at desc
      limit 1
    ) as own_success on true
    left join lateral (
      select cr.status, cr.start_time, cr.end_time, cr.return_message
      from cron.job_run_details as cr
      where cr.jobid = c.jobid
      order by cr.runid desc
      limit 1
    ) as cron_run on true
    left join lateral (
      select cr.start_time
      from cron.job_run_details as cr
      where cr.jobid = c.jobid
        and cr.status = 'succeeded'
      order by cr.runid desc
      limit 1
    ) as cron_success on true
    where d.is_active
  ),
  resolved as (
    select
      s.*,
      -- Every one of these is narrowed by execution_kind for the same reason resolved_success_at
      -- is, below. Picking "whichever side started later" is right only when the cron row IS the
      -- work. For edge_cron and worker definitions the cron row records that a net.http_post was
      -- enqueued: an Edge Function that answers 503 before claiming a run leaves a cron row that
      -- is both NEWER than the last real run and marked 'succeeded'. Reading status off that row
      -- puts "succeeded", a cron duration and no error on /admin/system-jobs for an invocation
      -- that never executed -- while resolved_success_at, correctly, calls the job stale. A
      -- surface that contradicts itself in adjacent columns is worse than one that is simply
      -- wrong, because the reader cannot tell which half to believe.
      case
        when s.execution_kind <> 'sql_cron' then s.own_status
        when coalesce(s.own_started_at, '-infinity'::timestamptz)
           >= coalesce(s.cron_started_at, '-infinity'::timestamptz)
          then s.own_status
        else s.cron_status
      end as resolved_status,
      case
        when s.execution_kind <> 'sql_cron' then s.own_started_at
        else greatest(s.own_started_at, s.cron_started_at)
      end as resolved_started_at,
      case
        when s.execution_kind <> 'sql_cron' then s.own_finished_at
        when coalesce(s.own_started_at, '-infinity'::timestamptz)
           >= coalesce(s.cron_started_at, '-infinity'::timestamptz)
          then s.own_finished_at
        else s.cron_finished_at
      end as resolved_finished_at,
      -- Narrowed by execution_kind, exactly as run_system_job_watchdog is (20260814010000).
      -- For edge_cron and worker definitions the cron row proves delivery at most: an Edge
      -- Function that answers 503 on every invocation still leaves a trail of 'succeeded' cron
      -- rows, and `greatest` ignores NULLs, so before this change a definition that had never
      -- recorded a run of its own read as fresh off pg_cron alone. That is the billing-sync
      -- failure mode (20260814010000) surviving on the human-facing reader after the pager was
      -- fixed -- and 20260904050000 made it reachable for four more jobs by moving their cron
      -- names onto the rows that record completion.
      case
        when s.execution_kind <> 'sql_cron' then s.own_success_at
        else greatest(s.own_success_at, s.cron_success_at)
      end as resolved_success_at,
      case
        when s.execution_kind <> 'sql_cron' then s.own_error_message
        when coalesce(s.own_started_at, '-infinity'::timestamptz)
           >= coalesce(s.cron_started_at, '-infinity'::timestamptz)
          then s.own_error_message
        when s.cron_status <> 'succeeded' then s.cron_error_message
        else null
      end as resolved_error_message
    from job_state as s
  )
  select
    r.job_key,
    r.display_name,
    r.description,
    r.schedule,
    r.execution_kind,
    r.is_critical,
    r.retry_mode,
    r.operator_route,
    coalesce(r.resolved_status, 'never') as last_status,
    r.resolved_started_at as last_attempt_at,
    r.resolved_success_at as last_success_at,
    case
      when r.cron_job_name is not null
        then r.resolved_success_at + r.expected_interval
      else null
    end as next_expected_at,
    case
      when r.resolved_started_at is not null and r.resolved_finished_at is not null
        then (extract(epoch from (r.resolved_finished_at - r.resolved_started_at)) * 1000)::bigint
      else null
    end as last_duration_ms,
    -- Same narrowing as resolved_status: for a non-sql_cron kind the ledger is the only source
    -- of counts, so a newer cron row must not blank them. Leaving these on the "newer side" rule
    -- while status reads the ledger would print a failed run with empty counts.
    case
      when r.execution_kind <> 'sql_cron' then r.own_attempted_count
      when coalesce(r.own_started_at, '-infinity'::timestamptz)
         >= coalesce(r.cron_started_at, '-infinity'::timestamptz)
        then r.own_attempted_count
      else null
    end as attempted_count,
    case
      when r.execution_kind <> 'sql_cron' then r.own_succeeded_count
      when coalesce(r.own_started_at, '-infinity'::timestamptz)
         >= coalesce(r.cron_started_at, '-infinity'::timestamptz)
        then r.own_succeeded_count
      else null
    end as succeeded_count,
    case
      when r.execution_kind <> 'sql_cron' then r.own_failed_count
      when coalesce(r.own_started_at, '-infinity'::timestamptz)
         >= coalesce(r.cron_started_at, '-infinity'::timestamptz)
        then r.own_failed_count
      else null
    end as failed_count,
    r.resolved_error_message as error_message,
    case
      when r.cron_job_name is null then
        r.resolved_status in ('queued', 'running')
        and r.resolved_started_at + r.freshness_sla < now()
      else
        r.resolved_success_at is null
        or r.resolved_success_at + r.freshness_sla < now()
    end as is_stale,
    r.kill_switch_enabled,
    -- Whether flipping that switch would actually stop the job. It is read in exactly one place,
    -- claim_system_job_execution, which SQL reaches only through execute_registered_sql_job -- so
    -- for a definition whose cron entry posts to an Edge Function the control is decorative.
    -- 20260905150000 stopped a dead switch from silencing the watchdog; this is the other half,
    -- which is telling the operator BEFORE they flip it. BACKLOG.md I17.
    app_private.kill_switch_can_stop_job(r.job_key) as kill_switch_can_stop
  from resolved as r
  order by
    case
      when r.cron_job_name is null then
        r.resolved_status in ('queued', 'running')
        and r.resolved_started_at + r.freshness_sla < now()
      else
        r.resolved_success_at is null
        or r.resolved_success_at + r.freshness_sla < now()
    end desc,
    r.is_critical desc,
    r.display_name;
end;
$function$

;

revoke all on function public.get_system_job_control_plane() from public, anon;
grant execute on function public.get_system_job_control_plane() to authenticated, service_role;
