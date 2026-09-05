-- The monthly LEIE refresh cannot fit inside an Edge Function, and when it dies it stays staging
-- forever.
--
-- THE EVIDENCE. `exclusion_refresh_runs` holds one row for source 'oig_leie' with status
-- 'staging', started 2026-08-12 05:00:10 UTC, `staged_record_count` 0, no error and no completion.
-- Its system job run was closed by 20260904080000's reconciler with 'abandoned_run' (heartbeat
-- frozen at +10 s), but the refresh run itself has nothing that closes it, so
-- `exclusion_source_state.oig_leie.last_status` still reads 'staging' 24 days later and the
-- snapshot screening actually matches against is still the one activated 2026-07-12.
--
-- WHY IT DIED, MEASURED RATHER THAN GUESSED. The function invocation log for that morning is past
-- retention, so the kill reason was reconstructed by running the deployed code path against the
-- real source file. `https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv` is 15,578,603 bytes
-- and 83,842 rows today. `loadOigLeie` reads the whole response with `resp.text()`, parses all of
-- it into an array of 83,842 objects, maps that into a second array of ~80k objects each of which
-- retains `raw: row` -- so the first array cannot be collected -- and then builds a dedup Map over
-- the lot. Measured on Deno 2.5.6:
--
--     after resp.text()            rss  78.5 MB
--     after parse()                rss 302.9 MB
--     after filter+map             rss 318.8 MB
--     after dedup                  rss 335.0 MB
--     after batch serialisation    rss 386.1 MB
--
-- A Supabase Edge Function gets 256 MB. The isolate was over the cap during `parse()`, before a
-- single row was staged -- which is exactly what the ledger says: heartbeat at +10 s, zero staged
-- rows, and no recorded failure, because an out-of-memory kill does not run a catch block.
--
-- This is not a transient. The 2026-07-12 snapshot holds 80,192 records and the list only grows,
-- so every monthly fire from here -- starting 2026-09-12 05:00 UTC -- dies the same way.
--
-- THE WORKER'S HALF, for the record, is in `screen-exclusions`: the CSV is now streamed through
-- `CsvParseStream` and staged in 1000-row chunks, which holds the same 80,355 entries at 147.5 MB
-- peak (88 MB above baseline, against 323 MB for the old path) and 1.00 s of CPU against the
-- platform's 2 s. That alone stops the dying.
--
-- WHAT THIS MIGRATION ADDS is the half that has to be in the database: making a death recoverable
-- instead of permanent.
--
-- A DURABLE STAGE CURSOR. `exclusion_refresh_runs` gains `stage_cursor` and `last_progress_at`,
-- written by `record_exclusion_stage_progress` after each staged chunk. Three things follow.
-- Progress becomes visible while a refresh is running rather than only after it ends. A run that
-- parks at its deadline can be continued at the chunk it reached instead of starting over -- which
-- matters because a run that can never finish inside one budget would otherwise re-stage the same
-- prefix forever and never converge. And a stalled run becomes detectable, which is the next part.
--
-- The cursor carries a fingerprint of the source file (`content-length` and `last-modified`), and
-- the worker ignores the cursor unless it matches. Skipping chunks is only sound if the bytes are
-- the same bytes; when OIG publishes a new file mid-resume the cursor is simply dropped and the
-- pass restages from the beginning. Staging is idempotent -- `exclusion_list_entries` upserts on
-- (snapshot_id, source_record_key) and does nothing on conflict -- so restaging costs round trips
-- and changes nothing.
--
-- A SWEEP FOR RUNS NOBODY CLOSED, the sibling of 20260904080000's for job runs and deliberately
-- the same shape: `app_private.reconcile_stalled_exclusion_refresh_runs()` fails any run still
-- 'staging' whose last progress is over six hours old, and `run_system_job_watchdog()` calls it on
-- every pass so this self-heals from now on. It goes through `fail_exclusion_source_refresh`
-- rather than updating the rows directly, so the snapshot, the run and `exclusion_source_state`
-- move together exactly as they do for any other failure -- a sweep that left the three
-- disagreeing would be its own bug.
--
-- Six hours matches the job-run reconciler, and for the same reason: it is far outside anything
-- legitimate (the platform kills an invocation in minutes at most) and the cost of sweeping a live
-- run is worse than the cost of a ghost surviving another few hours. Keyed on progress rather than
-- on the start, so a refresh that is genuinely working is never swept.
--
-- The migration runs the sweep once, which closes the 2026-08-12 row. `exclusion_source_health`
-- then reports oig_leie as 'failed' with a reason instead of 'staging' with none. It stays stale
-- either way -- the data IS stale -- but staleness with an explanation is a finding an operator
-- can act on, and 'staging' is a claim that something is still happening.
--
-- WHAT THIS DOES NOT DO. It does not replay the August run. That snapshot has zero rows; there is
-- nothing in it to salvage, and the September run will build a fresh one. It does not change any
-- schedule, and it does not touch the matching path -- the active snapshot pointer is untouched,
-- so screening keeps matching against the July snapshot until a refresh genuinely succeeds.
--
-- Rollback: drop the two functions added here, restore run_system_job_watchdog() from
-- 20260904080000, and drop the two columns. Runs the sweep already failed stay failed; they cannot
-- be restored to a 'staging' that was never true.

alter table public.exclusion_refresh_runs
  add column if not exists stage_cursor jsonb,
  add column if not exists last_progress_at timestamptz;

comment on column public.exclusion_refresh_runs.stage_cursor is
  'Durable staging progress for a resumable refresh: how many chunks and entries have been staged, '
  'and a fingerprint of the source file they were parsed from. Null until the first chunk lands. '
  'A worker must ignore the cursor unless the fingerprint matches the file it is currently reading.';
comment on column public.exclusion_refresh_runs.last_progress_at is
  'When the run last staged a chunk. Distinguishes a refresh that is working from one that died: '
  'app_private.reconcile_stalled_exclusion_refresh_runs() keys on this, not on started_at.';

-- Records one chunk of staging progress. Deliberately narrow: it cannot move a run out of
-- 'staging', cannot touch counts or checksums, and cannot resurrect a terminal run -- those belong
-- to complete_/fail_exclusion_source_refresh, which own the snapshot handshake.
create or replace function public.record_exclusion_stage_progress(
  p_run_id uuid,
  p_cursor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.exclusion_refresh_runs%rowtype;
begin
  if p_cursor is null or jsonb_typeof(p_cursor) <> 'object' then
    raise exception 'stage cursor must be a json object'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_run
  from public.exclusion_refresh_runs
  where id = p_run_id
  for update;
  if not found then
    raise exception 'exclusion refresh run % not found', p_run_id using errcode = 'no_data_found';
  end if;

  -- A terminal run recording progress means a worker outlived its own completion. Say so rather
  -- than writing a cursor nobody will read.
  if v_run.status <> 'staging' then
    raise exception 'exclusion refresh run % is not staging', p_run_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  update public.exclusion_refresh_runs
  set stage_cursor = p_cursor,
      last_progress_at = now()
  where id = v_run.id;

  return jsonb_build_object('runId', v_run.id, 'stageCursor', p_cursor);
end;
$$;

revoke all on function public.record_exclusion_stage_progress(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_exclusion_stage_progress(uuid, jsonb) to service_role;

comment on function public.record_exclusion_stage_progress(uuid, jsonb) is
  'Records durable staging progress for an in-flight exclusion refresh. Service role only; the '
  'refresh workers are the only callers.';

-- begin_exclusion_source_refresh now returns the stage cursor, because a resuming worker has to
-- know where the last one stopped. Otherwise byte-identical to the deployed definition.
--
-- The cursor deliberately SURVIVES the failed -> staging reset. Clearing it would send a retry
-- back to chunk zero, which is the livelock this exists to prevent: a run that cannot finish
-- inside one budget would redo the same prefix on every attempt and never reach the end. The
-- fingerprint check in the worker is what makes carrying it forward safe.
create or replace function public.begin_exclusion_source_refresh(
  p_correlation_id uuid,
  p_source text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.exclusion_refresh_runs%rowtype;
  v_run_id uuid;
  v_snapshot_id uuid;
begin
  if p_correlation_id is null then
    raise exception 'correlation_id is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_source not in ('oig_leie', 'sam_exclusions') then
    raise exception 'unsupported exclusion source: %', p_source using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('exclusion-refresh:' || p_source, 0));

  select * into v_run
  from public.exclusion_refresh_runs
  where correlation_id = p_correlation_id and source = p_source
  for update;

  if found then
    if v_run.status = 'failed' then
      update public.exclusion_refresh_runs
      set status = 'staging', expected_record_count = null,
          staged_record_count = 0, checksum = null, error = null,
          activated_snapshot_id = null, completed_at = null,
          last_progress_at = now()
      where id = v_run.id;
      update public.exclusion_source_snapshots
      set status = 'staging', record_count = null, checksum = null,
          validated_at = null, activated_at = null
      where id = v_run.snapshot_id;
      update public.exclusion_source_state
      set last_run_id = v_run.id, last_attempt_at = now(), last_status = 'staging',
          last_error = null, updated_at = now()
      where source = p_source;
      v_run.status := 'staging';
    end if;

    return jsonb_build_object(
      'runId', v_run.id,
      'snapshotId', v_run.snapshot_id,
      'status', v_run.status,
      'replayed', true,
      'recordCount', v_run.staged_record_count,
      'checksum', v_run.checksum,
      'activatedSnapshotId', v_run.activated_snapshot_id,
      'stageCursor', v_run.stage_cursor
    );
  end if;

  v_run_id := gen_random_uuid();
  v_snapshot_id := gen_random_uuid();

  insert into public.exclusion_refresh_runs (
    id, correlation_id, source, snapshot_id, status
  ) values (
    v_run_id, p_correlation_id, p_source, v_snapshot_id, 'staging'
  );
  insert into public.exclusion_source_snapshots (
    id, source, refresh_run_id, status
  ) values (
    v_snapshot_id, p_source, v_run_id, 'staging'
  );

  update public.exclusion_source_state
  set last_run_id = v_run_id, last_attempt_at = now(), last_status = 'staging',
      last_error = null, updated_at = now()
  where source = p_source;

  return jsonb_build_object(
    'runId', v_run_id,
    'snapshotId', v_snapshot_id,
    'status', 'staging',
    'replayed', false,
    'activatedSnapshotId', null,
    'stageCursor', null
  );
end;
$$;

-- The sibling of app_private.reconcile_abandoned_system_job_runs(), for the refresh ledger.
create or replace function app_private.reconcile_stalled_exclusion_refresh_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
      'No staging progress since ' || to_char(v_run.last_progress, 'YYYY-MM-DD HH24:MI:SS UTC')
        || '; the worker that opened this refresh never finished it. Closed by '
        || 'app_private.reconcile_stalled_exclusion_refresh_runs.'
    );
    v_closed := v_closed + 1;
  end loop;

  return v_closed;
end;
$$;

revoke all on function app_private.reconcile_stalled_exclusion_refresh_runs() from public, anon, authenticated;

comment on function app_private.reconcile_stalled_exclusion_refresh_runs() is
  'Closes exclusion refresh runs left staging by a worker that died, so exclusion_source_health '
  'reports a failure with a reason instead of a refresh that appears to still be running. Called '
  'by run_system_job_watchdog() on every pass.';

-- run_system_job_watchdog(), unchanged from 20260904080000 apart from the second reconciler call.
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

-- Close the 2026-08-12 run that has been staging since. Idempotent: the sweep only touches runs
-- that are still staging and have made no progress for six hours.
do $$
declare
  v_closed integer;
begin
  v_closed := app_private.reconcile_stalled_exclusion_refresh_runs();
  raise notice 'reconcile_stalled_exclusion_refresh_runs closed % stalled refresh run(s)', v_closed;
end;
$$;
