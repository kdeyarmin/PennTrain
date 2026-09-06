-- Exclusion screening is removed, at the owner's direction.
--
-- The product screened every active employee's name against the OIG LEIE and SAM.gov exclusion
-- lists. That whole subsystem goes: six tables, a view, fifteen functions, two triggers, two cron
-- entries, a system-job definition, an alert type, a release flag, an Edge Function and a console.
--
-- WHAT THIS GIVES UP, stated plainly because a migration is the last place it can be read before
-- it is true:
--
--   1. Nothing in the product will detect that an employee appears on a federal exclusion list.
--      A facility that employs an excluded individual cannot bill Medicare or Medicaid for
--      anything that person touches, and civil monetary penalties accrue per claim. That
--      detection now has to happen outside this system, by someone.
--   2. `evaluate_schedule_eligibility` blocked scheduling on a confirmed exclusion, and that block
--      was NOT overridable -- one of only three in the whole gate. It is gone. An excluded person
--      can be put on a shift with nothing raised.
--   3. Survey Day's staff roster carried an `exclusionState` chip per employee. Gone.
--
-- The three functions below are patched rather than rewritten: their bodies were taken from the
-- live catalog with pg_get_functiondef and edited at the exclusion references only, so nothing
-- else in them can drift.
--
-- WHAT IS DESTROYED: 157,192 exclusion-list entries, one snapshot, the refresh-run history, and
-- one screening match in `pending_review` with its critical alert -- raised 2026-09-06 01:56 UTC
-- by the widened matcher, never adjudicated. A point-in-time restore is the only way back.
--
-- NOT touched: public.get_organization_export_exclusions(), which is the export catalogue's
-- table-exclusion list and has nothing to do with screening beyond sharing a word.

------------------------------------------------------------------------------------------------
-- 1. Stop the schedule first, so nothing can re-enter while the rest is dropped
------------------------------------------------------------------------------------------------

do $$
declare v_job record;
begin
  for v_job in
    select jobid, jobname from cron.job
    where jobname in ('monthly-exclusion-screening', 'resume-sam-exclusion-screening')
  loop
    perform cron.unschedule(v_job.jobid);
    raise notice 'unscheduled %', v_job.jobname;
  end loop;
end $$;

-- TWO job definitions, not one. `sam-sweep-continuation` (20260815132000) is the hourly resume
-- tick for the SAM sweep: its cron entry is `resume-sam-exclusion-screening`, unscheduled just
-- above, and its worker was `screen-exclusions`, deleted in this change set. Its key names what it
-- does rather than the feature it belongs to, so a search for 'exclusion' or 'screen' among the
-- job keys does not find it -- which is exactly how it was nearly left behind. Left active it
-- would sit in /admin/system-jobs as a job that cannot run: the cron entry is gone, and "Run now"
-- would fall through run-system-job's EDGE_JOBS map (its entry is removed here too) into
-- execute_registered_sql_job and fail.
delete from app_private.system_job_runs
where job_key in ('exclusion-screening', 'sam-sweep-continuation');
delete from app_private.system_job_definitions
where job_key in ('exclusion-screening', 'sam-sweep-continuation');

------------------------------------------------------------------------------------------------
-- 2. The three functions outside the feature that read into it
------------------------------------------------------------------------------------------------
-- The watchdog reconciled stalled refresh runs on every pass; with no refresh runs there is
-- nothing to reconcile, and leaving the call would make the watchdog raise on a dropped function
-- every five minutes.

CREATE OR REPLACE FUNCTION public.run_system_job_watchdog()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare
  v_job record;
  v_state app_private.system_job_watchdog_state%rowtype;
  v_stale_keys text[] := '{}'::text[];
  v_emitted integer := 0;
  v_now timestamptz := now();
begin
  -- A run whose worker died still says 'running'. Close those first so the freshness pass below,
  -- and every operator surface, reads a ledger that reflects what actually happened.
  perform app_private.reconcile_abandoned_system_job_runs();

  for v_job in
    with resolved as (
      select d.job_key, d.display_name, d.freshness_sla,
        case
          -- For sql_cron the scheduled command IS the work, so pg_cron's exit status is a
          -- true success signal. For edge_cron and worker definitions the cron row only
          -- records that a request was enqueued: an Edge Function that answers 503 on every
          -- invocation still leaves a trail of 'succeeded' cron rows. Those kinds must prove
          -- success with their own finished run.
          when d.execution_kind <> 'sql_cron' then own_success.started_at
          when own_success.started_at is null then cron_success.start_time
          when cron_success.start_time is null then own_success.started_at
          else greatest(own_success.started_at, cron_success.start_time)
        end as last_success_at
      from app_private.system_job_definitions d
      left join cron.job c on c.jobname = d.cron_job_name
      left join lateral (
        select r.started_at
        from app_private.system_job_runs r
        where r.job_key = d.job_key and r.status = 'succeeded'
        order by r.started_at desc limit 1
      ) own_success on true
      left join lateral (
        select cr.start_time
        from cron.job_run_details cr
        where cr.jobid = c.jobid and cr.status = 'succeeded'
        order by cr.runid desc limit 1
      ) cron_success on true
      where d.is_active and d.is_critical and d.cron_job_name is not null
        -- Only a switch that can actually stop the job may also stop the monitoring.
        -- Otherwise flipping it leaves the job running and blinds the watchdog, which is
        -- strictly worse than having no switch (BACKLOG.md I17).
        and not (d.kill_switch_enabled and app_private.kill_switch_can_stop_job(d.job_key))
    )
    select * from resolved
    where last_success_at is null or last_success_at + freshness_sla < v_now
  loop
    v_stale_keys := array_append(v_stale_keys, v_job.job_key);
    select * into v_state
    from app_private.system_job_watchdog_state
    where job_key = v_job.job_key for update;

    if v_state.job_key is null then
      insert into app_private.system_job_watchdog_state (
        job_key, stale_since, last_success_at, last_observed_at, last_emitted_at
      ) values (
        v_job.job_key, v_now, v_job.last_success_at, v_now, v_now
      );
      raise warning 'system_job_watchdog stale job=% display_name=% last_success_at=%',
        v_job.job_key, v_job.display_name, v_job.last_success_at;
      v_emitted := v_emitted + 1;
    elsif v_state.recovered_at is not null or v_state.last_emitted_at < v_now - interval '1 hour' then
      update app_private.system_job_watchdog_state
      set stale_since = case when recovered_at is null then stale_since else v_now end,
          last_success_at = v_job.last_success_at,
          last_observed_at = v_now,
          last_emitted_at = v_now,
          recovered_at = null
      where job_key = v_job.job_key;
      raise warning 'system_job_watchdog stale job=% display_name=% last_success_at=%',
        v_job.job_key, v_job.display_name, v_job.last_success_at;
      v_emitted := v_emitted + 1;
    else
      update app_private.system_job_watchdog_state
      set last_success_at = v_job.last_success_at, last_observed_at = v_now
      where job_key = v_job.job_key;
    end if;
  end loop;

  for v_state in
    select * from app_private.system_job_watchdog_state s
    where s.recovered_at is null
      and not (s.job_key = any(v_stale_keys))
  loop
    update app_private.system_job_watchdog_state
    set recovered_at = v_now, last_observed_at = v_now
    where job_key = v_state.job_key;
    raise log 'system_job_watchdog recovered job=%', v_state.job_key;
  end loop;
  return v_emitted;
end;
$function$;

-- The scheduling gate. See (2) in the header: this removes a non-overridable block.

CREATE OR REPLACE FUNCTION public.evaluate_schedule_eligibility(p_employee_id uuid, p_facility_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_required_qualification_keys text[] DEFAULT ARRAY[]::text[], p_required_credential_types text[] DEFAULT ARRAY[]::text[], p_required_training_type_ids uuid[] DEFAULT ARRAY[]::uuid[], p_exclude_assignment_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_employee public.employees%rowtype;
  v_policy public.schedule_eligibility_policies%rowtype;
  v_block text;
  v_training_type_id uuid;
  v_blocks text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_override_ids uuid[] := array[]::uuid[];
  v_unresolved text[] := array[]::text[];
  v_hours numeric := 0;
  v_duration numeric;
  v_snapshot jsonb;
  v_oapsa jsonb;
  v_outcome text;
begin
  if p_ends_at <= p_starts_at then
    raise exception 'Eligibility interval must have positive duration' using errcode = '22023';
  end if;
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  if not (
    session_user = 'postgres'
    or
    coalesce(auth.jwt()->>'role', '') = 'service_role'
    or public.is_platform_admin()
    or v_employee.profile_id = auth.uid()
    or public.current_org_id() = v_employee.organization_id
  ) then raise exception 'Eligibility evaluation is outside caller scope' using errcode = '42501'; end if;
  select * into v_policy from public.schedule_eligibility_policies
  where organization_id = v_employee.organization_id;
  if not found then
    v_policy.max_weekly_hours := 40;
    v_policy.warning_weekly_hours := 36;
    v_policy.minimum_rest_hours := 8;
  end if;
  if v_employee.status <> 'active' then v_blocks := array_append(v_blocks, 'lifecycle_inactive'); end if;
  if not exists (
    select 1 from public.employee_facility_assignments a
    where a.employee_id = p_employee_id and a.facility_id = p_facility_id
  ) then v_blocks := array_append(v_blocks, 'facility_not_assigned'); end if;
  -- OAPSA (6 Pa.C.S. Ch. 5). A not-suitable determination and a lapsed provisional period are the
  -- two states in which the facility may not put this person on a shift at all; before this they
  -- were recorded on the background-check profile, rendered on Survey Day views, and stopped
  -- nothing. Both are computed by public.oapsa_duty_status so the schedule and the duty gate
  -- cannot disagree about them.
  v_oapsa := public.oapsa_duty_status(p_employee_id, public.pa_day(p_starts_at));
  if v_oapsa->>'bar' = 'not_suitable' then
    v_blocks := array_append(v_blocks, 'oapsa_not_suitable');
  elsif v_oapsa->>'bar' = 'provisional_expired' then
    v_blocks := array_append(v_blocks, 'oapsa_provisional_expired');
  elsif (v_oapsa->>'daysRemaining')::integer <= 14 then
    -- The last two weeks of a provisional period are when the clearances have to arrive. A warning
    -- rather than a block: the person may still work, and the scheduler is the one who needs to
    -- know the window is closing.
    v_warnings := array_append(v_warnings, 'oapsa_provisional_expiring');
  end if;
  foreach v_block in array coalesce(p_required_qualification_keys, array[]::text[])
  loop
    if not public.employee_has_active_qualification(p_employee_id, v_block, p_starts_at) then
      v_blocks := array_append(v_blocks, 'qualification:' || v_block);
    end if;
  end loop;
  foreach v_block in array coalesce(p_required_credential_types, array[]::text[])
  loop
    if not exists (
      select 1 from public.employee_credentials c
      where c.employee_id = p_employee_id and c.credential_type = v_block
        and c.status = 'compliant'
        and (c.issue_date is null or c.issue_date <= public.pa_day(p_starts_at))
        and (c.expiration_date is null or c.expiration_date >= public.pa_day(p_ends_at))
    ) then v_blocks := array_append(v_blocks, 'credential:' || v_block); end if;
  end loop;
  foreach v_training_type_id in array coalesce(p_required_training_type_ids, array[]::uuid[])
  loop
    if not exists (
      select 1 from public.employee_training_records r
      where r.employee_id = p_employee_id and r.training_type_id = v_training_type_id
        and r.status = 'compliant' and r.approval_status = 'approved'
        and (r.completion_date is null or r.completion_date <= public.pa_day(p_starts_at))
        and (r.due_date is null or r.due_date >= public.pa_day(p_ends_at))
    ) then v_blocks := array_append(v_blocks, 'training:' || v_training_type_id::text); end if;
  end loop;
  if exists (
    select 1 from public.shift_assignments s
    where s.employee_id = p_employee_id
      and s.id <> all(coalesce(p_exclude_assignment_ids, array[]::uuid[]))
      and s.status in ('scheduled', 'confirmed')
      and tstzrange(
        s.shift_date + s.start_time,
        s.shift_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end,
        '[)'
      ) && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then v_blocks := array_append(v_blocks, 'schedule_conflict'); end if;
  select coalesce(sum(
    extract(epoch from (
      s.shift_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end
      - (s.shift_date + s.start_time)
    )) / 3600
  ), 0) into v_hours
  from public.shift_assignments s
  where s.employee_id = p_employee_id
    and s.id <> all(coalesce(p_exclude_assignment_ids, array[]::uuid[]))
    and s.status in ('scheduled', 'confirmed', 'completed')
    and s.shift_date between public.pa_week_start(p_starts_at)
      and public.pa_week_start(p_starts_at) + 6;
  v_duration := extract(epoch from (p_ends_at - p_starts_at)) / 3600;
  if v_hours + v_duration > v_policy.max_weekly_hours then
    v_blocks := array_append(v_blocks, 'weekly_hours_limit');
  elsif v_hours + v_duration > v_policy.warning_weekly_hours then
    v_warnings := array_append(v_warnings, 'weekly_hours_warning');
  end if;
  if exists (
    select 1 from public.employee_availability_windows a
    where a.employee_id = p_employee_id and a.availability_type = 'unavailable'
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then v_warnings := array_append(v_warnings, 'outside_availability'); end if;
  foreach v_block in array v_blocks
  loop
    -- oapsa_not_suitable joins the non-overridable set: it is a determination somebody in this
    -- organization made and recorded, so the way to undo it is to change the determination, with
    -- the attestation trail that carries, rather than to schedule around it. A lapsed provisional
    -- period is overridable, because the commonest cause is a clearance that arrived and has not
    -- been filed yet, and an override is an auditable record of exactly that claim.
    if v_block in ('lifecycle_inactive', 'oapsa_not_suitable') then
      v_unresolved := array_append(v_unresolved, v_block);
    else
      declare v_override_id uuid;
      begin
        select o.id into v_override_id
        from public.schedule_eligibility_overrides o
        where o.employee_id = p_employee_id and o.facility_id = p_facility_id
          and o.block_code = v_block and o.revoked_at is null
          and o.effective_from <= p_starts_at and o.expires_at >= p_ends_at
        order by o.created_at desc limit 1;
        if v_override_id is null then
          v_unresolved := array_append(v_unresolved, v_block);
        else
          v_override_ids := array_append(v_override_ids, v_override_id);
        end if;
      end;
    end if;
  end loop;
  v_outcome := case when cardinality(v_unresolved) > 0 then 'blocked'
    when cardinality(v_warnings) > 0 or cardinality(v_override_ids) > 0 then 'warning'
    else 'eligible' end;
  select jsonb_build_object(
    'policyUpdatedAt', v_policy.updated_at,
    'employeeStatus', v_employee.status,
    'facilityAssignmentIds', coalesce((select jsonb_agg(a.id order by a.id) from public.employee_facility_assignments a where a.employee_id = p_employee_id), '[]'::jsonb),
    'qualificationIds', coalesce((select jsonb_agg(q.id order by q.id) from public.employee_qualifications q where q.employee_id = p_employee_id and q.effective_from <= p_starts_at and (q.effective_to is null or q.effective_to > p_starts_at)), '[]'::jsonb),
    'credentialIds', coalesce((select jsonb_agg(c.id order by c.id) from public.employee_credentials c where c.employee_id = p_employee_id), '[]'::jsonb),
    'oapsa', v_oapsa,
    'weeklyHoursBefore', v_hours,
    'requestedHours', v_duration
  ) into v_snapshot;
  return jsonb_build_object(
    'outcome', v_outcome,
    'hardBlocks', to_jsonb(v_unresolved),
    'warnings', to_jsonb(v_warnings),
    'appliedOverrideIds', to_jsonb(v_override_ids),
    'sourceSnapshot', v_snapshot,
    'sourceChecksumSha256', encode(extensions.digest(convert_to(v_snapshot::text, 'utf8'), 'sha256'), 'hex')
  );
end;
$function$;

-- Survey Day's roster. `exclusionState` leaves the RPC's shape, so its two chips go with it.

CREATE OR REPLACE FUNCTION public.get_survey_day_staff_roster(p_session_id uuid, p_search text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_session public.survey_day_sessions%rowtype;
  v_facility uuid;
  v_limit integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_pattern text := '%' || replace(replace(replace(nullif(btrim(coalesce(p_search, '')), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_total integer;
  v_summary jsonb;
  v_rows jsonb;
begin
  select * into v_session from public.survey_day_sessions where id = p_session_id;
  if not found then raise exception 'Survey Day session not found or outside caller scope' using errcode = 'P0002'; end if;
  v_facility := v_session.facility_id;

  with base as (
    select
      e.id,
      e.first_name || ' ' || e.last_name as name,
      e.job_title,
      case when exists (
        select 1 from public.employee_training_records tr
        where tr.employee_id = e.id and tr.facility_id = v_facility and tr.status in ('expired', 'due_soon', 'missing')
      ) then 'attention' else 'ready' end as training_state,
      case when exists (
        select 1 from public.employee_credentials c
        where c.employee_id = e.id and c.facility_id = v_facility and c.status in ('expired', 'due_soon', 'missing')
      ) then 'attention' else 'ready' end as credential_state,
      case
        when exists (select 1 from public.employee_background_check_profiles b where b.employee_id = e.id and b.suitability_determination = 'not_suitable') then 'attention'
        when not exists (select 1 from public.employee_background_check_profiles b where b.employee_id = e.id and b.suitability_determination in ('suitable', 'suitable_with_conditions')) then 'unknown'
        else 'ready'
      end as background_state
    from public.employees e
    where e.facility_id = v_facility
      and e.status = 'active'
      and (v_search is null or (e.first_name || ' ' || e.last_name || ' ' || coalesce(e.job_title, '')) ilike v_pattern)
  ),
  scored as (
    select b.*,
      case when 'attention' in (training_state, credential_state) or background_state <> 'ready'
           then 'attention' else 'ready' end as overall_flag
    from base b
  )
  select
    count(*)::integer,
    jsonb_build_object(
      'total', count(*),
      'ready', count(*) filter (where overall_flag = 'ready'),
      'attention', count(*) filter (where overall_flag = 'attention')
    )
  into v_total, v_summary
  from scored;

  with base as (
    select
      e.id,
      e.first_name || ' ' || e.last_name as name,
      e.job_title,
      case when exists (
        select 1 from public.employee_training_records tr
        where tr.employee_id = e.id and tr.facility_id = v_facility and tr.status in ('expired', 'due_soon', 'missing')
      ) then 'attention' else 'ready' end as training_state,
      case when exists (
        select 1 from public.employee_credentials c
        where c.employee_id = e.id and c.facility_id = v_facility and c.status in ('expired', 'due_soon', 'missing')
      ) then 'attention' else 'ready' end as credential_state,
      case
        when exists (select 1 from public.employee_background_check_profiles b where b.employee_id = e.id and b.suitability_determination = 'not_suitable') then 'attention'
        when not exists (select 1 from public.employee_background_check_profiles b where b.employee_id = e.id and b.suitability_determination in ('suitable', 'suitable_with_conditions')) then 'unknown'
        else 'ready'
      end as background_state
    from public.employees e
    where e.facility_id = v_facility
      and e.status = 'active'
      and (v_search is null or (e.first_name || ' ' || e.last_name || ' ' || coalesce(e.job_title, '')) ilike v_pattern)
  ),
  scored as (
    select b.*,
      case when 'attention' in (training_state, credential_state) or background_state <> 'ready'
           then 'attention' else 'ready' end as overall_flag
    from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'employeeId', id,
    'name', name,
    'jobTitle', job_title,
    'trainingState', training_state,
    'credentialState', credential_state,
    'backgroundState', background_state,
    'overallFlag', overall_flag,
    'route', '/app/employees/' || id
  ) order by name, id), '[]'::jsonb)
  into v_rows
  from (select * from scored order by name, id limit v_limit offset (v_page - 1) * v_limit) page;

  return jsonb_build_object('rows', v_rows, 'count', v_total, 'summary', v_summary, 'page', v_page, 'pageSize', v_limit);
end;
$function$;


-- The Phase-1 synthetic health check counted exclusion sources without an active snapshot, and
-- execute_registered_sql_job failed the job when that counter was non-zero. Both go: a counter
-- over a dropped table cannot be zero, it raises.

CREATE OR REPLACE FUNCTION public.run_phase1_synthetic_checks()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'completedAssignmentsWithoutCertificate', (
      select count(*) from public.course_assignments ca
      left join public.certificates c on c.course_assignment_id = ca.id
      where ca.status = 'completed' and c.id is null
    ),
    'certificatePdfJobsExhausted', (
      select count(*) from public.certificate_pdf_jobs j
      where j.status = 'failed' and j.attempt_count >= j.max_attempts
    ),
    'notificationOutcomesUnknown', (
      select count(*) from public.notification_deliveries n where n.final_outcome = 'unknown'
    ),
    'auditIntegrityIssuesOpen', (
      select count(*) from app_private.audit_integrity_issues i where i.resolved_at is null
    ),
    'auditTriggerGaps', (
      select count(*)
      from app_private.audit_entity_manifest m
      where m.audit_mode = 'row_trigger'
        and not exists (
          select 1
          from pg_catalog.pg_trigger tr
          join pg_catalog.pg_proc p on p.oid = tr.tgfoid
          where tr.tgrelid = pg_catalog.to_regclass(
            pg_catalog.format('%I.%I', m.table_schema, m.table_name)
          )
            and not tr.tgisinternal
            and p.proname = 'audit_log_trigger'
        )
    ),
    'checkedAt', now()
  ) into v_result;

  return v_result;
end;
$function$;

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
        -- Fourth statement, added with the OAPSA gates: the provisional clock is a date, so
        -- nothing moves it but the calendar and nothing notices it but a sweep.
        perform public.run_oapsa_provisional_maintenance();
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

-- Two scheduling functions held 'confirmed_exclusion' in their non-overridable block lists.
-- Nothing can produce that code now, so the entries are dead rather than protective -- and a
-- reviewer finding them later would reasonably conclude the screen still exists.

CREATE OR REPLACE FUNCTION public.create_schedule_eligibility_override(p_employee_id uuid, p_facility_id uuid, p_block_code text, p_scope_type text, p_scope_id uuid, p_reason text, p_authority_reference text, p_expires_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_employee public.employees%rowtype; v_id uuid;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found or v_employee.facility_id <> p_facility_id and not public.is_employee_assigned_to_facility(p_employee_id, p_facility_id) then
    raise exception 'Employee is outside override facility' using errcode = '23514';
  end if;
  perform app_private.assert_phase3_admin(v_employee.organization_id, 'scheduling.eligibility.override', p_facility_id);
  if p_block_code in ('lifecycle_inactive', 'oapsa_not_suitable')
     or p_scope_type not in ('facility','shift','class')
     or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'Override is not permitted or is too broad' using errcode = '22023';
  end if;
  insert into public.schedule_eligibility_overrides(
    organization_id, facility_id, employee_id, block_code, scope_type,
    scope_id, reason, authority_reference, expires_at, granted_by
  ) values (
    v_employee.organization_id, p_facility_id, p_employee_id, p_block_code,
    p_scope_type, p_scope_id, btrim(p_reason), btrim(p_authority_reference),
    p_expires_at, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.evaluate_shift_assignment_eligibility(p_employee_id uuid, p_facility_id uuid, p_unit_id uuid, p_shift_definition_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_exclude_assignment_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_required_qualifications text[] := array[]::text[];
  v_required_credentials text[] := array[]::text[];
  v_required_training_types uuid[] := array[]::uuid[];
  v_result jsonb;
  v_blocks text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_valid_override_ids uuid[] := array[]::uuid[];
  v_override_id uuid;
  v_override public.schedule_eligibility_overrides%rowtype;
  v_policy public.schedule_eligibility_policies%rowtype;
  v_snapshot jsonb;
  v_outcome text;
  v_previous_end timestamptz;
  v_next_start timestamptz;
begin
  select
    coalesce(array_agg(distinct q) filter (where q is not null), array[]::text[]),
    coalesce(array_agg(distinct c) filter (where c is not null), array[]::text[]),
    coalesce(array_agg(distinct t) filter (where t is not null), array[]::uuid[])
  into v_required_qualifications, v_required_credentials, v_required_training_types
  from public.shift_eligibility_requirements r
  left join lateral unnest(r.required_qualification_keys) q on true
  left join lateral unnest(r.required_credential_types) c on true
  left join lateral unnest(r.required_training_type_ids) t on true
  where r.facility_id = p_facility_id
    and r.shift_definition_id = p_shift_definition_id
    and r.is_active;

  select
    array(select distinct x from unnest(v_required_qualifications || coalesce(w.required_qualification_keys, array[]::text[])) x),
    array(select distinct x from unnest(v_required_credentials || coalesce(w.required_credential_types, array[]::text[])) x)
  into v_required_qualifications, v_required_credentials
  from public.service_workload_profiles w
  where w.facility_id = p_facility_id
    and w.shift_definition_id = p_shift_definition_id
    and w.unit_id is not distinct from p_unit_id;

  v_required_qualifications := coalesce(v_required_qualifications, array[]::text[]);
  v_required_credentials := coalesce(v_required_credentials, array[]::text[]);

  v_result := public.evaluate_schedule_eligibility(
    p_employee_id, p_facility_id, p_starts_at, p_ends_at,
    v_required_qualifications, v_required_credentials, v_required_training_types,
    coalesce(p_exclude_assignment_ids, array[]::uuid[])
  );
  v_blocks := array(select jsonb_array_elements_text(v_result->'hardBlocks'));
  v_warnings := array(select jsonb_array_elements_text(v_result->'warnings'));

  -- Availability is a hard scheduling constraint. An explicit manager override may authorize it,
  -- but a warning alone must never let a direct insert schedule unavailable staff.
  if 'outside_availability' = any(v_warnings) then
    v_warnings := array_remove(v_warnings, 'outside_availability');
    v_blocks := array_append(v_blocks, 'employee_unavailable');
  end if;

  select * into v_policy from public.schedule_eligibility_policies
  where organization_id = (select e.organization_id from public.employees e where e.id = p_employee_id);
  if not found then v_policy.minimum_rest_hours := 8; end if;

  select max(
    s.shift_date + s.end_time
      + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end
  ) into v_previous_end
  from public.shift_assignments s
  where s.employee_id = p_employee_id
    and s.id <> all(coalesce(p_exclude_assignment_ids, array[]::uuid[]))
    and s.status in ('scheduled', 'confirmed', 'completed')
    and s.shift_date + s.end_time
      + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end <= p_starts_at;

  select min(s.shift_date + s.start_time) into v_next_start
  from public.shift_assignments s
  where s.employee_id = p_employee_id
    and s.id <> all(coalesce(p_exclude_assignment_ids, array[]::uuid[]))
    and s.status in ('scheduled', 'confirmed')
    and s.shift_date + s.start_time >= p_ends_at;

  if (v_previous_end is not null and p_starts_at - v_previous_end < v_policy.minimum_rest_hours * interval '1 hour')
     or (v_next_start is not null and v_next_start - p_ends_at < v_policy.minimum_rest_hours * interval '1 hour') then
    v_blocks := array_append(v_blocks, 'insufficient_rest');
  end if;

  -- Revalidate every override selected by the legacy engine. Facility overrides apply only to
  -- this facility; shift overrides apply only to this exact shift definition.
  foreach v_override_id in array coalesce(
    array(select jsonb_array_elements_text(v_result->'appliedOverrideIds'))::uuid[],
    array[]::uuid[]
  ) loop
    select * into v_override from public.schedule_eligibility_overrides where id = v_override_id;
    if v_override.block_code not in ('lifecycle_inactive', 'facility_not_assigned', 'schedule_conflict')
       and (
         (v_override.scope_type = 'facility' and (v_override.scope_id is null or v_override.scope_id = p_facility_id))
         or (v_override.scope_type = 'shift' and v_override.scope_id = p_shift_definition_id)
       ) then
      v_valid_override_ids := array_append(v_valid_override_ids, v_override_id);
    else
      v_blocks := array_append(v_blocks, v_override.block_code);
    end if;
  end loop;

  -- Apply valid shift-scoped overrides to blocks introduced by this wrapper (availability/rest)
  -- or left unresolved by the shared engine.
  for v_override in
    select o.* from public.schedule_eligibility_overrides o
    where o.employee_id = p_employee_id and o.facility_id = p_facility_id
      and o.scope_type = 'shift' and o.scope_id = p_shift_definition_id
      and o.revoked_at is null and o.effective_from <= p_starts_at and o.expires_at >= p_ends_at
  loop
    if v_override.block_code = any(v_blocks)
       and v_override.block_code not in ('lifecycle_inactive', 'facility_not_assigned', 'schedule_conflict') then
      v_blocks := array_remove(v_blocks, v_override.block_code);
      if not v_override.id = any(v_valid_override_ids) then
        v_valid_override_ids := array_append(v_valid_override_ids, v_override.id);
      end if;
    end if;
  end loop;

  v_blocks := array(select distinct x from unnest(v_blocks) x order by x);
  v_warnings := array(select distinct x from unnest(v_warnings) x order by x);
  v_outcome := case
    when cardinality(v_blocks) > 0 then 'blocked'
    when cardinality(v_warnings) > 0 or cardinality(v_valid_override_ids) > 0 then 'warning'
    else 'eligible'
  end;
  v_snapshot := coalesce(v_result->'sourceSnapshot', '{}'::jsonb) || jsonb_build_object(
    'unitId', p_unit_id,
    'shiftDefinitionId', p_shift_definition_id,
    'requiredQualificationKeys', to_jsonb(v_required_qualifications),
    'requiredCredentialTypes', to_jsonb(v_required_credentials),
    'requiredTrainingTypeIds', to_jsonb(v_required_training_types),
    'minimumRestHours', v_policy.minimum_rest_hours,
    'previousShiftEndsAt', v_previous_end,
    'nextShiftStartsAt', v_next_start
  );
  return jsonb_build_object(
    'outcome', v_outcome,
    'hardBlocks', to_jsonb(v_blocks),
    'warnings', to_jsonb(v_warnings),
    'appliedOverrideIds', to_jsonb(v_valid_override_ids),
    'sourceSnapshot', v_snapshot,
    'sourceChecksumSha256', encode(extensions.digest(convert_to(v_snapshot::text, 'utf8'), 'sha256'), 'hex')
  );
end;
$function$;

-- The function above now also refuses 'oapsa_not_suitable' in its own validation. That gap
-- predates this change -- the function checked ('lifecycle_inactive', 'confirmed_exclusion') while
-- the constraint forbade three codes -- so an override for an OAPSA determination was refused by
-- the CHECK with a bare 23514 rather than by the function with its 22023 and its message. Closed
-- here rather than left, because this migration is already rewriting both halves and leaving them
-- disagreeing is how the next reader concludes one of them is wrong.
--
-- And the constraint that refused an override for it. Kept in step with the two functions above
-- rather than left as harmless dead weight: a CHECK naming a block code nothing can emit reads,
-- to the next person, as evidence the screen is still there.
alter table public.schedule_eligibility_overrides
  drop constraint schedule_eligibility_overrides_block_code_check;
alter table public.schedule_eligibility_overrides
  add constraint schedule_eligibility_overrides_block_code_check check (
    block_code <> all (array['lifecycle_inactive', 'oapsa_not_suitable'])
  );

------------------------------------------------------------------------------------------------
-- 3. On-hire screening
------------------------------------------------------------------------------------------------

drop trigger if exists screen_new_employee_exclusions on public.employees;
drop function if exists public.screen_new_employee_for_exclusions();
-- The flag is one of SIX tables keyed by feature_key, and deleting only the flag leaves the
-- capability sellable: PackageEntitlementTermCard offers every row in feature_definitions, so a
-- platform admin could still add `screening.on_hire_exclusion` to a commercial package and
-- get_effective_entitlements would evaluate the grant -- for a feature that no longer exists.
-- Grants and package rows go first so the definition is not left orphaning them.
delete from public.organization_entitlement_grants where feature_key = 'screening.on_hire_exclusion';
delete from public.package_entitlements where feature_key = 'screening.on_hire_exclusion';
delete from public.feature_kill_switches where feature_key = 'screening.on_hire_exclusion';
delete from public.organization_release_cohorts where feature_key = 'screening.on_hire_exclusion';
delete from public.release_flags where feature_key = 'screening.on_hire_exclusion';
delete from public.feature_definitions where feature_key = 'screening.on_hire_exclusion';

------------------------------------------------------------------------------------------------
-- 4. Alerts and work items that pointed at a match
------------------------------------------------------------------------------------------------
-- The alert rows go rather than being retained: each one is a pointer to a match row that is
-- about to stop existing, and an alert nobody can open is worse than none.

delete from public.alerts where alert_type = 'exclusion_match_found';

alter table public.alerts drop constraint alerts_alert_type_check;
alter table public.alerts add constraint alerts_alert_type_check check (
  alert_type = any (array[
    'due_90', 'due_60', 'due_30',
    'due_14', 'due_7', 'overdue',
    'missing_document', 'course_assigned', 'certificate_expiring',
    'external_cert_pending_review', 'competency_due', 'training_plan_assigned',
    'inservice_scheduled', 'credential_expiring', 'incident_notification_overdue',
    'corrective_action_overdue', 'inspection_due', 'resident_compliance_due_soon',
    'oapsa_provisional_expiring'
  ])
);

-- public.alert_list_rows is `select a.*, ...`, which froze the column list at creation time and
-- so blocks the drop. Dropped and recreated rather than CASCADEd -- a cascade would take the
-- alert queue's paged read model with it. The body below is 20260717155120's verbatim; `a.*`
-- simply resolves to one fewer column now.
drop view if exists public.alert_list_rows;

alter table public.alerts drop column if exists exclusion_screening_match_id;

create or replace view public.alert_list_rows
with (security_invoker = true)
as
select
  a.*,
  coalesce(notification.incident_id, action.incident_id) as linked_incident_id,
  coalesce(a.inspection_item_id, inspection_event.inspection_item_id) as linked_inspection_item_id,
  compliance_item.resident_id as linked_resident_id
from public.alerts a
left join public.incident_notifications notification
  on notification.id = a.incident_notification_id
left join public.corrective_actions action
  on action.id = a.corrective_action_id
left join public.inspection_events inspection_event
  on inspection_event.id = action.inspection_event_id
left join public.resident_compliance_items compliance_item
  on compliance_item.id = a.resident_compliance_item_id;

revoke all on table public.alert_list_rows from public, anon;
grant select on table public.alert_list_rows to authenticated, service_role;

-- Cancelled rather than deleted: a work item is the record of something a person was asked to do,
-- and the asking happened. Zero rows carry this source today (measured on production before this
-- was written); the statement is here so a deployment that has some does not strand them.
update public.work_items
set state = 'canceled', closed_at = coalesce(closed_at, now()), updated_at = now()
where source_type = 'exclusion_match' and state not in ('closed', 'canceled');

-- Retire the source type rather than delete it. Deleting is wrong three ways here: the canceled
-- rows above still carry it and their history should stay readable; work_item_templates.source_type
-- has a foreign key to this table; and app_private.classify_work_item_source() ADOPTS an unknown
-- type rather than rejecting it (20260726120100, deliberately -- refusing means somebody's
-- compliance task silently does not exist), so a deleted row would simply be re-registered with a
-- generated label the next time anything used the key. Deactivating is what the column is for.
update public.work_item_source_types
set active = false
where key = 'exclusion_match';

------------------------------------------------------------------------------------------------
-- 5. The feature itself
------------------------------------------------------------------------------------------------

-- The audit manifest is keyed by table name and nothing cascades into it, so its five rows would
-- outlive the tables they classify. That is not cosmetic: get_audit_coverage() reports a
-- 'row_trigger' entry as unsatisfied when the trigger is absent, and a dropped table has no
-- trigger -- so leaving them turns the audit-coverage report permanently red on tables that no
-- longer exist. Caught by audit_manifest_covers_every_table.test.sql, which checks the direction
-- (manifest -> table) that the "every table has a row" assertion does not.
-- Same shape, second registry: product_module_resources classifies each table into a product
-- module and is keyed by name, so its five rows would point at nothing. modular_product_entitlements
-- asserts every classified resource resolves to a real table. The RESTRICTIVE module policies
-- themselves need no statement -- a policy is dropped with its table.
delete from app_private.product_module_resources
where resource_schema = 'public'
  and resource_name in (
    'exclusion_screening_matches', 'exclusion_list_entries', 'exclusion_source_state',
    'exclusion_source_snapshots', 'exclusion_refresh_runs'
  );

delete from app_private.audit_entity_manifest
where table_schema in ('public', 'app_private')
  and table_name in (
    'exclusion_screening_matches', 'exclusion_list_entries', 'exclusion_source_state',
    'exclusion_source_snapshots', 'exclusion_refresh_runs'
  );

drop view if exists public.exclusion_source_health;

-- Tables before functions: three expression indexes are built on exclusion_name_key(last_name),
-- so the function cannot be dropped while they exist. One statement for the tables because
-- exclusion_source_snapshots and exclusion_refresh_runs reference each other and neither can go
-- first. The immutability trigger on exclusion_list_entries goes down with its table, which is
-- what then lets its function drop cleanly below.
drop table if exists
  public.exclusion_screening_matches,
  public.exclusion_list_entries,
  public.exclusion_source_state,
  public.exclusion_source_snapshots,
  public.exclusion_refresh_runs;

-- The 2026-07-12 dedup backup outlived the deduplication it was taken for, and there is nothing
-- left for it to be restored into.
drop table if exists app_private.exclusion_list_entries_dedup_backup_20260712;

drop function if exists public.begin_exclusion_source_refresh(uuid, text);
drop function if exists public.complete_exclusion_source_refresh(uuid, integer);
drop function if exists public.fail_exclusion_source_refresh(uuid, text);
drop function if exists public.record_exclusion_stage_progress(uuid, jsonb);
drop function if exists public.get_exclusion_sam_sweep_state();
drop function if exists public.rescan_org_exclusion_matches(uuid);
drop function if exists public.match_exclusion_list_against_roster_core(text, uuid);
drop function if exists public.exclusion_name_match_score(text, text, text, text);
drop function if exists public.exclusion_name_probes(text);
drop function if exists public.exclusion_name_key(text);
drop function if exists public.exclusion_source_record_key(text, text, text, text, text, date, text, date, date, date, text, text);
drop function if exists public.enforce_exclusion_snapshot_entry_immutability();
drop function if exists app_private.screen_employee_against_active_exclusions(uuid);
drop function if exists app_private.reconcile_stalled_exclusion_refresh_runs();
