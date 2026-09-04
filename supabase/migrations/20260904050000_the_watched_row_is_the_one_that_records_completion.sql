-- Four critical jobs read their health off pg_cron's exit status, which for them means nothing.
--
-- THE FINDING (BACKLOG G270, the residual half of G269). 20260814010000 stopped the watchdog
-- trusting `cron.job_run_details` for `edge_cron` and `worker` definitions, because when a cron
-- entry's command is a `net.http_post`, "succeeded" records that the REQUEST WAS ENQUEUED, not
-- that the work happened. It keyed that decision on `execution_kind`.
--
-- `execution_kind` is a label, and six critical definitions carry the label `sql_cron` while their
-- cron entry is a `net.http_post` to an Edge Function. For those six the watchdog is back to
-- reading the wrong sensor -- the exact condition that let the billing sync fail hourly for weeks
-- under a green light. Verified on production: all six have zero rows in
-- `app_private.system_job_runs` under their own job_key, so pg_cron is the only thing feeding
-- their freshness.
--
-- Four of the six have a SIBLING definition that records the real work, and that sibling carries
-- `cron_job_name = null` -- so, exactly as in the billing case, the row doing the observing and
-- the row being observed are different rows:
--
--   watched (never records)              records the work (never watched)
--   -----------------------------------  -----------------------------------------
--   certificate-pdf-jobs                 certificate-pdf-generation
--   binder-export-jobs                   binder-export-generation
--   document-analyzer-jobs               document-analyzer-extraction
--   integration-webhook-dispatch-cron    integration-webhook-dispatch
--
-- Each right-hand row is claimed and finished by its Edge Function through
-- `claim_system_job_execution` / `finish_system_job` (generate-certificate-pdf,
-- generate-compliance-binder, analyze-state-form, dispatch-integration-webhooks respectively), and
-- on production all four have recorded successes minutes old. The health signal exists; nothing
-- was reading it.
--
-- THE FIX, following 20260814010000's shape exactly. For each pair the cron entry moves onto the
-- row that records completion, the criticality the PAIR was declared with moves with it, and the
-- now-redundant row is removed -- guarded by its own run history, so a deployment that did record
-- runs under that key keeps them (the FK is ON DELETE RESTRICT).
--
-- The two definitions whose surviving row was `is_critical = false` (binder-export-generation,
-- document-analyzer-extraction) become critical. That is not an escalation: the pair was already
-- declared critical on the half that could never report, so this preserves the intended alerting
-- rather than adding it. Both record a run on every cron tick even with an empty queue -- verified
-- on production, where each has a `last_known_good_at` minutes old -- so a 30-minute freshness SLA
-- against a 5-minute cron has ample margin and will not flap on an idle queue.
--
-- THE OTHER TWO OF THE SIX ARE DELIBERATELY NOT TOUCHED HERE, and this is the honest part.
-- `data-lifecycle` (run-data-lifecycle) and `organization-export-jobs`
-- (process-organization-export-jobs) have no sibling that records anything, because neither Edge
-- Function calls claim_system_job_execution at all. Repointing or relabelling them would not give
-- the watchdog a true sensor -- it would only replace a signal that is always green with one that
-- is always red, and a critical job that pages continuously is the same failure this migration
-- exists to end, pointed the other way. Fixing them means instrumenting those two functions to
-- claim and finish a run, which is an Edge Function change with its own tests and its own deploy;
-- it is recorded in BACKLOG.md as the remainder of G270 rather than half-done here.
--
-- AND THE SAME NARROWING HAS TO REACH THE SECOND READER, which is the part a review caught
-- before this shipped. `run_system_job_watchdog` was taught by 20260814010000 to consult the
-- cron-side signal only for `execution_kind = 'sql_cron'`. `get_system_job_control_plane` -- the
-- function behind /admin/system-jobs, the surface this migration's own comments keep pointing at
-- -- was not: it resolves `greatest(own_success_at, cron_success_at)` unconditionally, and
-- `greatest` ignores NULLs. Before this migration the four recording rows carried
-- `cron_job_name = null`, so the page judged them by their own ledger and the gap was
-- unreachable. Moving the cron names onto them would have opened it: a worker answering 503 on
-- every invocation would page correctly through the watchdog while the page beside it showed a
-- last success minutes old and `is_stale = false`. Fixing one reader and not the other would
-- have left this migration half-done in the most confusing possible way, so the same case
-- expression is applied here.
--
-- BLAST RADIUS. Four cron entries change which definition observes them; two definitions become
-- critical; four redundant definitions are removed where they have no run history; one reporting
-- function stops reading freshness off the wrong sensor. No cron schedule, command, function
-- body, or Edge Function changes, so no job's actual execution is altered -- only which row, and
-- which column, the two readers use to decide whether it happened.
--
-- Rollback: restore the four removed definitions and clear cron_job_name from the four survivors.

do $$
declare
  v_pair record;
begin
  for v_pair in
    select *
    from (values
      ('certificate-pdf-jobs',              'certificate-pdf-generation',   'process-certificate-pdf-jobs'),
      ('binder-export-jobs',                'binder-export-generation',     'process-binder-export-jobs'),
      ('document-analyzer-jobs',            'document-analyzer-extraction', 'process-document-analyzer-jobs'),
      ('integration-webhook-dispatch-cron', 'integration-webhook-dispatch', 'integration-webhook-dispatch')
    ) as t(stale_key, recording_key, cron_name)
  loop
    -- Release the cron name first: cron_job_name is UNIQUE, so the redundant row has to let go
    -- before the recording row can take it. Deactivate too -- a surviving row (one that has run
    -- history and so escapes the delete below) that kept is_active would list on
    -- /admin/system-jobs as a job that can never be scheduled again.
    update app_private.system_job_definitions
    set cron_job_name = null, is_active = false, updated_at = now()
    where job_key = v_pair.stale_key;

    delete from app_private.system_job_definitions d
    where d.job_key = v_pair.stale_key
      and not exists (
        select 1 from app_private.system_job_runs r where r.job_key = d.job_key
      );

    -- The row the Edge Function actually claims and finishes becomes the watched, critical one.
    update app_private.system_job_definitions
    set cron_job_name = v_pair.cron_name,
        is_critical = true,
        updated_at = now()
    where job_key = v_pair.recording_key;
  end loop;
end;
$$;

comment on column app_private.system_job_definitions.cron_job_name is
  'The cron entry whose freshness this definition is judged by. It must sit on the definition that RECORDS the work through claim_system_job_execution / finish_system_job, not on a sibling that merely schedules it: for a cron command that is a net.http_post, pg_cron''s exit status proves the request was enqueued and nothing more. Splitting the two across separate rows is how the billing sync failed hourly for weeks under a green light (20260814010000) and how four more jobs were still being judged as of 20260904050000.';


-- ---------------------------------------------------------------------------
-- /admin/system-jobs stops reading freshness off pg_cron for non-sql_cron jobs
-- ---------------------------------------------------------------------------

create or replace function public.get_system_job_control_plane()
returns table (
  job_key text,
  display_name text,
  description text,
  schedule text,
  execution_kind text,
  is_critical boolean,
  retry_mode text,
  operator_route text,
  last_status text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_expected_at timestamptz,
  last_duration_ms bigint,
  attempted_count bigint,
  succeeded_count bigint,
  failed_count bigint,
  error_message text,
  is_stale boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
      case
        when coalesce(s.own_started_at, '-infinity'::timestamptz)
           >= coalesce(s.cron_started_at, '-infinity'::timestamptz)
          then s.own_status
        else s.cron_status
      end as resolved_status,
      greatest(s.own_started_at, s.cron_started_at) as resolved_started_at,
      case
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
    case
      when coalesce(r.own_started_at, '-infinity'::timestamptz)
         >= coalesce(r.cron_started_at, '-infinity'::timestamptz)
        then r.own_attempted_count
      else null
    end as attempted_count,
    case
      when coalesce(r.own_started_at, '-infinity'::timestamptz)
         >= coalesce(r.cron_started_at, '-infinity'::timestamptz)
        then r.own_succeeded_count
      else null
    end as succeeded_count,
    case
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
    end as is_stale
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
$$;
