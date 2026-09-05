-- The kill switch stopped the monitoring, not the job (BACKLOG.md I17, the dangerous half).
--
-- `kill_switch_enabled` is enforced in exactly one place: `claim_system_job_execution`, which SQL
-- reaches only through `public.execute_registered_sql_job`. Ten of the forty-six cron entries go
-- that way. Twenty call their function directly -- `select public.escalate_overdue_work_items()`
-- and so on -- and sixteen are `net.http_post` calls to Edge Functions. For those thirty-six the
-- switch does nothing at all.
--
-- On its own that is a dead control, which is bad enough. What makes it worse is the other half:
-- `run_system_job_watchdog` excludes `kill_switch_enabled` definitions from its freshness pass. So
-- flipping the switch on, say, `escalate-plans-of-correction` -- one of the twenty -- has exactly
-- one effect: the job keeps escalating plans of correction on schedule, and the watchdog stops
-- telling anyone if it breaks. The operator believes they stopped it. They turned off the alarm.
--
-- WHAT THIS CHANGES, and what it deliberately does not.
--
-- It does not re-register the twenty cron commands. That is the recorded fix and it is the right
-- eventual shape, but it is not a mechanical rewrite: `compliance-requirement-maintenance-daily`
-- runs two statements in one command, `generate-resident-service-tasks-daily` passes arguments,
-- `drain-integration-command-inbox` passes a batch size, and one of the twenty IS the watchdog.
-- Getting one of those wrong stops a daily job silently, which is the failure mode this row is
-- about. It needs its own change with a per-entry check, not a sweep at the end of another one.
--
-- What it does is remove the harm: THE WATCHDOG ONLY HONOURS A SWITCH THAT CAN ACT.
-- `app_private.kill_switch_can_stop_job` answers whether a definition's cron entry actually routes
-- through `execute_registered_sql_job`. Where it does, a killed job is still suppressed from
-- staleness alerts -- that is the legitimate use, and paging about a job you deliberately stopped
-- is noise. Where it does not, the definition stays monitored, because the job is still running
-- and its freshness is still real. Flipping a dead switch now changes nothing at all, which is a
-- great deal better than changing only the alerting.
--
-- Surfacing that in `/admin/system-jobs` is left for the same later change as the cron
-- re-registration. `get_system_job_control_plane` returns no kill-switch state of any kind today,
-- so showing "this control will not stop this job" means widening its RETURNS TABLE, the hook and
-- the page -- and the operator-facing half is worth doing next to the fix that makes the switch
-- real, not before it.
--
-- AND FIVE GUARDS THAT COULD NEVER FIRE. `record_user_invitation_sent`, `..._resent`,
-- `reconcile_user_invitation_lifecycle`, `queue_manager_weekly_digests` and
-- `restore_all_demo_baselines` each open with `current_user not in ('postgres', 'service_role',
-- 'supabase_admin')`. Every one is SECURITY DEFINER owned by postgres, so inside them
-- `current_user` IS postgres and the condition is never true. They read as service-only functions
-- and are service-only by grant alone. They now test `auth.role()`, which reads the request's JWT:
-- 'service_role' for a worker, 'authenticated' for a signed-in user, null for a database session
-- or cron. A signed-in caller is refused; cron and the service role are not.
--
-- Rollback: drop the two functions added here and restore run_system_job_watchdog,
-- get_system_job_control_plane and the five guards from their previous migrations.

create or replace function app_private.kill_switch_can_stop_job(p_job_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- The switch is checked inside claim_system_job_execution, which SQL reaches only through
  -- execute_registered_sql_job. A cron entry that calls its function directly, or posts to an Edge
  -- Function, never passes through that check.
  select exists (
    select 1
    from app_private.system_job_definitions d
    join cron.job j on j.jobname = d.cron_job_name
    where d.job_key = p_job_key
      and j.command like '%execute_registered_sql_job%'
  );
$$;

revoke all on function app_private.kill_switch_can_stop_job(text) from public, anon, authenticated;

comment on function app_private.kill_switch_can_stop_job(text) is
  'Whether flipping kill_switch_enabled actually stops this job. True only when its cron entry '
  'routes through execute_registered_sql_job, which is the only place the switch is read. Used so '
  'the watchdog does not go silent on a job its switch cannot stop (BACKLOG.md I17).';

-- run_system_job_watchdog, unchanged apart from the kill-switch predicate.
create or replace function public.run_system_job_watchdog()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$declare
  v_job record;
  v_state app_private.system_job_watchdog_state%rowtype;
  v_stale_keys text[] := '{}'::text[];
  v_emitted integer := 0;
  v_now timestamptz := now();
begin
  -- A run whose worker died still says 'running'. Close those first so the freshness pass below,
  -- and every operator surface, reads a ledger that reflects what actually happened.
  perform app_private.reconcile_abandoned_system_job_runs();
  -- Same problem, different ledger: a refresh whose worker died still says 'staging', and
  -- exclusion_source_health repeats that as though a load were in progress. Same six-hour
  -- threshold, same reason it is keyed on progress rather than on the start.
  perform app_private.reconcile_stalled_exclusion_refresh_runs();

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
$fn$;
create or replace function public.queue_manager_weekly_digests()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_profile public.profiles%rowtype;
  v_facility_ids uuid[];
  v_credentials integer;
  v_training integer;
  v_incidents integer;
  v_alerts integer;
  v_classes integer;
  v_resident_items integer;
  v_poc_due integer;
  v_inserted integer := 0;
  v_body text;
  v_items jsonb;
  v_digest_id uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role'
     and auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'Only the trusted digest worker may queue manager digests'
      using errcode = '42501';
  end if;
  for v_profile in
    select p.* from public.profiles p
    join public.organizations o on o.id = p.organization_id
    where p.is_active and p.role in ('org_admin','facility_manager')
      and o.subscription_status not in ('suspended','canceled')
  loop
    if exists (
      select 1 from public.notifications n
      where n.profile_id = v_profile.id
        and n.notification_type = 'manager_weekly_digest'
        and n.created_at >= public.pa_midnight(public.pa_week_start(now()))
    ) then continue; end if;

    if v_profile.role = 'org_admin' then
      select coalesce(array_agg(f.id), '{}'::uuid[]) into v_facility_ids
      from public.facilities f
      where f.organization_id = v_profile.organization_id
        and f.is_active and not f.is_sandbox;
    else
      select coalesce(array_agg(f.id), '{}'::uuid[]) into v_facility_ids
      from public.facility_assignments fa
      join public.facilities f on f.id = fa.facility_id
      where fa.profile_id = v_profile.id and f.is_active and not f.is_sandbox;
    end if;
    if cardinality(v_facility_ids) = 0 then continue; end if;

    select count(*) into v_credentials from public.employee_credentials c
    where c.facility_id = any(v_facility_ids)
      and c.expiration_date between public.pa_today() and public.pa_today() + 30;
    select count(*) into v_training from (
      select distinct on (r.employee_id, r.training_type_id) r.status
      from public.employee_training_records r
      where r.facility_id = any(v_facility_ids)
      order by r.employee_id, r.training_type_id,
        r.due_date desc nulls last, r.completion_date desc nulls last, r.created_at desc,
        (r.status = 'missing'), r.id
    ) cur
    where cur.status in ('expired','missing');
    select count(*) into v_incidents from public.incidents i
    where i.facility_id = any(v_facility_ids) and i.status <> 'closed';
    select count(*) into v_alerts from public.alerts a
    where a.facility_id = any(v_facility_ids) and a.status = 'open';
    select count(*) into v_classes from public.training_classes c
    where c.facility_id = any(v_facility_ids)
      and c.class_date between public.pa_today() and public.pa_today() + 6
      and c.status <> 'cancelled';
    -- Carried over from send_monday_digest(), which is losing its schedule below. Restricted to
    -- active residents for the same reason it was there: an item against a discharged resident is
    -- not this week's work.
    select count(*) into v_resident_items
    from public.resident_compliance_items i
    join public.residents res on res.id = i.resident_id
    where i.facility_id = any(v_facility_ids)
      and res.status = 'active'
      and i.status in ('due_soon','expired');
    -- BACKLOG.md C4, digest half: a plan of correction whose due date is within a week or already
    -- past, on a violation whose plan has NOT yet been submitted. Counted from the facility day,
    -- like every other date comparison in this function.
    --
    -- 'open' only. The first cut also counted 'poc_submitted', which put this tally out of step
    -- with run_plan_of_correction_escalations once that sweep narrowed to unsubmitted plans. The
    -- digest is the number a manager reconciles against, so a tally larger than anything the
    -- daily job escalates reads as "some of these are silently unescalated" when the difference
    -- is entirely work already done. poc_due_date is the deadline to SUBMIT and
    -- submit_plan_of_correction meets it; what remains after that is corrective-action work
    -- items with their own escalation (C3), which is not this line.
    select count(*) into v_poc_due
    from public.dhs_violations v
    where v.facility_id = any(v_facility_ids)
      and v.status = 'open'
      and v.poc_due_date is not null
      and v.poc_due_date <= public.pa_today() + 7;

    v_body := format(
      '%s credentials expiring; %s overdue or missing training items; %s open incidents; '
        || '%s unacknowledged alerts; %s classes this week; %s resident compliance items due or overdue; '
        || '%s plans of correction due or overdue.',
      v_credentials, v_training, v_incidents, v_alerts, v_classes, v_resident_items, v_poc_due
    );
    -- Paths point at pages that exist, with no query string that the destination does not parse.
    -- The first cut used ?complianceStatus=due and ?pocStatus=due; Residents/Violations accept only
    -- search/facility/status/page, so both silently opened an ordinary unfiltered list while looking
    -- like a filtered one. Resident compliance items get their own report page. Violations has a
    -- status filter, and now that this count is 'open' only, ?status=open would at least be a
    -- valid value -- but the count is also narrowed by due date and that filter is not, so the
    -- list would still be larger than the number beside it. Worse than no filter, so still none.
    --
    -- The carried-forward items hold to the same rule. Incidents has a status filter, but 'open'
    -- is not a value its table allows ('reported','investigating','closed'), so ?status=open
    -- rendered an EMPTY list under a non-zero count, and the page cannot express "not closed" --
    -- no filter. The training matrix reads statusFilter (with no 'overdue' value), credentials
    -- reads facilityFilter/employeeFilter/statusFilter, and classes has no range param -- each
    -- ignored its query string while looking filtered, so none carry one. Alerts keeps
    -- ?status=open: that page parses status, and 'open' is the very value this count uses.
    v_items := jsonb_build_array(
      jsonb_build_object('key','credentials','label','Credentials expiring within 30 days','count',v_credentials,'path','/app/credentials'),
      jsonb_build_object('key','training','label','Overdue or missing training items','count',v_training,'path','/app/training-matrix'),
      jsonb_build_object('key','incidents','label','Open incidents','count',v_incidents,'path','/app/incidents'),
      jsonb_build_object('key','alerts','label','Unacknowledged alerts','count',v_alerts,'path','/app/alerts?status=open'),
      jsonb_build_object('key','classes','label','Classes this week','count',v_classes,'path','/trainer/classes'),
      jsonb_build_object('key','resident_compliance','label','Resident compliance items due or overdue','count',v_resident_items,'path','/app/resident-compliance'),
      jsonb_build_object('key','poc','label','Plans of correction due or overdue','count',v_poc_due,'path','/app/violations')
    );
    insert into public.manager_digest_snapshots (
      organization_id, profile_id, week_started_on, items
    ) values (
      v_profile.organization_id, v_profile.id, public.pa_week_start(now()), v_items
    )
    on conflict (profile_id, week_started_on) do update set items = excluded.items
    returning id into v_digest_id;
    insert into public.notifications (
      organization_id, profile_id, notification_type, title, body, link
    ) values (
      v_profile.organization_id, v_profile.id, 'manager_weekly_digest',
      'Your weekly manager digest', v_body, '/account/manager-digest/' || v_digest_id
    );
    v_inserted := v_inserted + 1;
  end loop;
  return v_inserted;
end;
$fn$;

create or replace function public.reconcile_user_invitation_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_accepted integer := 0;
  v_expired integer := 0;
begin
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update public.user_invitation_lifecycle i
  set status = 'accepted',
      accepted_at = coalesce(u.last_sign_in_at, u.email_confirmed_at, now()),
      last_error = null,
      updated_at = now()
  from auth.users u
  where u.id = i.invited_user_id
    and i.status in ('sent','expired')
    and (u.last_sign_in_at is not null or u.email_confirmed_at is not null);
  get diagnostics v_accepted = row_count;

  update public.user_invitation_lifecycle i
  set status = 'expired',
      accepted_at = null,
      last_error = 'The invitation expired before the user completed account setup.',
      updated_at = now()
  where i.status = 'sent'
    and i.expires_at < now()
    and not exists (
      select 1 from auth.users u
      where u.id = i.invited_user_id
        and (u.last_sign_in_at is not null or u.email_confirmed_at is not null)
    );
  get diagnostics v_expired = row_count;

  return jsonb_build_object('accepted', v_accepted, 'expired', v_expired, 'completedAt', now());
end;
$fn$;

create or replace function public.record_user_invitation_resent(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_invitation public.user_invitation_lifecycle%rowtype;
begin
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select * into v_invitation
  from public.user_invitation_lifecycle
  where id = p_invitation_id
  for update;
  if v_invitation.id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if v_invitation.status in ('accepted', 'revoked') then
    raise exception 'Closed invitations cannot be resent' using errcode = '22023';
  end if;

  update public.user_invitation_lifecycle
  set status = 'sent',
      send_count = send_count + 1,
      last_sent_at = now(),
      expires_at = now() + interval '7 days',
      delivery_failed_at = null,
      accepted_at = null,
      revoked_at = null,
      last_error = null,
      updated_at = now()
  where id = p_invitation_id
  returning * into v_invitation;

  return jsonb_build_object(
    'invitationId', v_invitation.id,
    'status', v_invitation.status,
    'sendCount', v_invitation.send_count,
    'lastSentAt', v_invitation.last_sent_at,
    'expiresAt', v_invitation.expires_at
  );
end;
$fn$;

create or replace function public.record_user_invitation_sent(p_invited_user_id uuid, p_email text, p_first_name text, p_last_name text, p_invited_role text, p_organization_id uuid, p_employee_id uuid, p_redirect_to text, p_created_by uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_invited_role not in ('platform_admin','org_admin','facility_manager','trainer','employee','auditor') then
    raise exception 'Unsupported invited role' using errcode = '22023';
  end if;
  if p_invited_role <> 'platform_admin' and p_organization_id is null then
    raise exception 'Organization is required for this invitation' using errcode = '22023';
  end if;
  if p_employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.organization_id = p_organization_id
  ) then
    raise exception 'Employee is outside invitation scope' using errcode = '42501';
  end if;
  if p_created_by is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_created_by
      and (p.role = 'platform_admin' or p.organization_id is not distinct from p_organization_id)
  ) then
    raise exception 'Invitation creator is outside scope' using errcode = '42501';
  end if;

  insert into public.user_invitation_lifecycle(
    organization_id, employee_id, invited_user_id, email, first_name, last_name,
    invited_role, redirect_to, created_by
  ) values (
    p_organization_id, p_employee_id, p_invited_user_id, lower(btrim(p_email)),
    btrim(p_first_name), btrim(p_last_name), p_invited_role,
    nullif(btrim(coalesce(p_redirect_to, '')), ''), p_created_by
  ) returning id into v_id;

  return v_id;
end;
$fn$;

create or replace function app_private.restore_all_demo_baselines()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org record;
  v_count integer := 0;
begin
  if auth.role() is not null and auth.role() <> 'service_role'
     and coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Demo restore requires a trusted worker' using errcode = '42501';
  end if;
  for v_org in select id from public.organizations where is_demo loop
    perform app_private.seed_demo_organization(v_org.id);
    perform app_private.seed_demo_clinical_data(v_org.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;
