-- A system job run that dies mid-flight stays 'running' forever, and the ledger keeps saying so.
--
-- THE FINDING. `app_private.system_job_runs` holds a row for job_key 'exclusion-screening' with
-- status 'running', started 2026-08-12 05:00:09 UTC, `last_heartbeat_at` frozen at 05:00:10 that
-- same morning, and a cursor of `{"phase": "refreshing", "source": "oig_leie"}`. The monthly
-- exclusion refresh was invoked, claimed its run, began staging the OIG LEIE download, and never
-- came back. Its `exclusion_refresh_runs` row is still 'staging' with `staged_record_count` 0, and
-- the LEIE snapshot that screening actually matches against is still the one activated on
-- 2026-07-12 -- now well past its own 45-day `stale_after`.
--
-- Nothing closed the run, because nothing can: `finish_system_job` is called by the function that
-- claimed it, and that function is gone. So the record says "running" three weeks later, and every
-- surface that reads it -- /admin/system-jobs, get_system_job_control_plane -- repeats that. An
-- operator looking for why exclusion screening is stale sees a job apparently still working.
--
-- WHAT THIS IS AND IS NOT. It is not a lease bug: `claim_system_job_execution` keys on
-- (job_key, correlation_id), so the next monthly invocation gets a new correlation id and claims
-- normally -- the stranded row does not block 2026-09-12 from running. It is not a missing alert
-- either: the run never succeeded, so `last_known_good_at` stays null and the watchdog already
-- reports the job stale, correctly. What is broken is narrower and still worth fixing -- the run
-- ledger, which is the record of what the platform actually did, contains an entry that is simply
-- false, and it will stay false forever.
--
-- THE FIX. `app_private.reconcile_abandoned_system_job_runs()` closes out any run still 'running'
-- whose heartbeat is older than six hours, marking it failed with error_code 'abandoned_run'. The
-- watchdog calls it at the top of every pass, so this self-heals from now on instead of needing a
-- migration each time, and the migration calls it once to close the row that is already stranded.
--
-- 'RUNNING' ONLY, NOT 'QUEUED', and the distinction is the whole safety of this sweep. A first
-- draft sweeps both. It should not: a queued row has never been claimed by any worker. It is what
-- `request_system_job_rerun` and `replay_system_job_dead_letter` insert when an OPERATOR asks for
-- a run, carrying `requested_by = auth.uid()` and a mandatory `request_reason`, with an
-- audit_logs entry pointing at it. Sweeping those would stamp 'the worker that claimed this run
-- never finished it' onto a row no worker ever touched -- a fabricated crash record on an audited
-- operator request, which is worse than the stale row this migration exists to remove. A queued
-- run that nobody picks up is a dispatch problem and needs its own diagnosis, not this label.
--
-- SIX HOURS, AND KEYED ON THE HEARTBEAT RATHER THAN THE START. The heartbeat is the right signal
-- because it distinguishes "still working" from "died": a genuinely long job that is making
-- progress keeps updating it, and the SAM sweep -- the one job here designed to run long -- was
-- explicitly reworked by 20260815132000 to carry a deadline and a durable cursor and resume
-- hourly, so it too heartbeats. Six hours is far outside anything legitimate: Supabase kills an
-- Edge Function invocation orders of magnitude sooner, and every SQL cron worker here finishes in
-- seconds. Deliberately generous, because the cost of sweeping a live run is worse than the cost
-- of a ghost row surviving another few hours.
--
-- IT DOES NOT GO THROUGH `finish_system_job`, deliberately. That function drives retry accounting
-- and the circuit breaker, and this is not a new failure to be counted -- it is a correction to a
-- record that was never closed. Feeding weeks-old ghosts into the circuit breaker could open
-- circuits on jobs that are healthy today. The outage itself is already reported by the watchdog's
-- staleness path, which is where it belongs.
--
-- BLAST RADIUS. On production, one row (the 2026-08-12 exclusion-screening run) becomes 'failed'
-- with an explicit reason instead of a permanent 'running'. Going forward, at most a handful of
-- rows per year. No job's schedule, command or execution changes. What DOES change for an operator
-- is that /admin/system-jobs stops showing a dead run as in progress.
--
-- NOT FIXED HERE: why the 2026-08-12 refresh died, and the stale LEIE snapshot it left behind.
-- That needs the function invocation log for that morning and a re-run of the monthly job from the
-- job control plane, which is ops work; it is recorded in BACKLOG.md.
--
-- Rollback: drop the reconciler and restore run_system_job_watchdog() from 20260814010000. The
-- swept rows stay failed; they cannot be restored to a state that was never true.

create or replace function app_private.reconcile_abandoned_system_job_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed integer;
begin
  update app_private.system_job_runs r
  set status = 'failed',
      finished_at = now(),
      failed_count = greatest(coalesce(r.failed_count, 0), 1),
      error_code = 'abandoned_run',
      error_message = 'No heartbeat for over six hours; the worker that claimed this run never '
        || 'finished it. Closed by app_private.reconcile_abandoned_system_job_runs.',
      updated_at = now()
  -- 'running' only: see the header. A 'queued' row is an operator's audited rerun request that no
  -- worker has claimed yet, and labelling it a worker death would be a fabricated crash record.
  where r.status = 'running'
    and coalesce(r.last_heartbeat_at, r.started_at, r.created_at) < now() - interval '6 hours';

  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;

revoke all on function app_private.reconcile_abandoned_system_job_runs() from public, anon, authenticated;

comment on function app_private.reconcile_abandoned_system_job_runs() is
  'Closes system job runs whose worker died without calling finish_system_job, so the run ledger stops reporting a dead run as in progress. Three deliberate narrowings: ''running'' only, because a ''queued'' row is an operator''s audited rerun request that no worker has claimed and must not be labelled a worker death; keyed on last_heartbeat_at rather than started_at, so a long job genuinely making progress is never swept; and not routed through finish_system_job, because this is a bookkeeping correction rather than a new failure for the circuit breaker to count. See 20260904080000.';

create or replace function public.run_system_job_watchdog()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
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
        and not d.kill_switch_enabled
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
$$;

revoke all on function public.run_system_job_watchdog() from public, anon, authenticated;
grant execute on function public.run_system_job_watchdog() to service_role;

-- Close whatever is already stranded at deploy time -- on production, the 2026-08-12
-- exclusion-screening run.
do $$
declare
  v_closed integer;
begin
  v_closed := app_private.reconcile_abandoned_system_job_runs();
  raise notice 'Closed % abandoned system job run(s).', v_closed;
end;
$$;
