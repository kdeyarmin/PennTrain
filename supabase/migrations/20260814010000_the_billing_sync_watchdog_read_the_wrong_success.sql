-- The billing quantity sync failed hourly for weeks and the watchdog reported it healthy.
--
-- THE FINDING. `sync-billing-quantities` has been answering 503 `billing_sync_not_configured`
-- on every scheduled run (the Edge Function secret `STRIPE_SECRET_KEY` is not set on the
-- project). `app_private.system_job_runs` holds zero rows for job_key 'billing-quantity-sync'.
-- Nothing alerted, for two independent reasons -- both in this file's scope:
--
--   1. THE CRITICAL DEFINITION HAD NO CRON NAME. run_system_job_watchdog() iterates
--      `where d.is_active and d.is_critical and d.cron_job_name is not null`. Two rows
--      described this one job:
--
--        billing-quantity-sync       edge_cron  cron_job_name = null   is_critical = true
--        billing-quantity-sync-cron  sql_cron   cron_job_name = set    is_critical = false
--
--      The critical half was skipped for having no cron name; the half with the cron name was
--      skipped for not being critical. Every other edge-function job registered with the
--      pattern that works -- notification-dispatch, heygen-status-polling, exclusion-screening --
--      carries the cron name on the single definition. This job was the one split across two
--      rows, and the split fell exactly on the watchdog's two filters.
--
--   2. pg_cron "succeeded" IS NOT THE JOB SUCCEEDING. Even had the filters passed, the
--      resolver took `greatest(own_success, cron_success)`, where cron_success is the latest
--      `cron.job_run_details.status = 'succeeded'`. For the 13 cron entries whose command is a
--      `net.http_post` to an Edge Function, that status records that the REQUEST WAS ENQUEUED --
--      not that the function did the work. pg_cron reported "succeeded" every hour while the
--      function returned 503 every hour, so last_success_at advanced continuously and the
--      freshness SLA could never be breached. A job that has never once succeeded read as
--      perpetually fresh.
--
--      This is the failure mode 20260726250000 was written to close, one layer down: there the
--      job was invisible because it had no definition row; here it is invisible because its
--      health signal measures the wrong thing. A green light wired to the wrong sensor is worse
--      than no light, because it is trusted.
--
-- THE FIX.
--
--   * The critical `billing-quantity-sync` definition takes ownership of the cron job name
--     (cron_job_name is UNIQUE, so the duplicate releases it first). The redundant
--     `billing-quantity-sync-cron` row is removed -- it existed only to give the cron entry a
--     definition, which the real row now does. Removal is guarded by its own run history so a
--     project that did record runs under that key keeps them (the FK is ON DELETE RESTRICT).
--
--   * The watchdog consults the cron-side signal ONLY for `execution_kind = 'sql_cron'`, where
--     the cron command *is* the work and its exit status genuinely reports it. For `edge_cron`
--     and `worker` definitions the cron row proves delivery at most, so success must come from
--     `system_job_runs` -- the function's own record of having finished.
--
-- BLAST RADIUS. Only edge_cron/worker definitions that are active, critical, and carry a cron
-- name change behavior. That is three rows:
--
--   notification-dispatch   thousands of recorded successes, most recent minutes old -- unchanged.
--   billing-quantity-sync   no recorded success -- goes stale immediately. Intended: that is the
--                           outage this migration exists to surface.
--   exclusion-screening     no recorded success in the retained run window -- will also go stale.
--                           Not a regression introduced here; it is a second job whose health was
--                           being read off the same wrong sensor, and it needs its own look.
--
-- Rollback: restore the previous function body from 20260726250000 and re-insert the
-- billing-quantity-sync-cron definition row.

-- ---------------------------------------------------------------------------
-- One definition owns the cron entry, and it is the critical one
-- ---------------------------------------------------------------------------

-- Deactivated as well as unnamed. The delete below is guarded by run history, so on a project
-- that recorded runs under this key the row survives -- and a surviving row left is_active would
-- be a job definition that can never be scheduled again yet still lists on /admin/system-jobs and
-- still counts in get_system_job_control_plane(). An active-looking job that cannot run is the
-- same class of misleading signal this migration exists to remove.
update app_private.system_job_definitions
set cron_job_name = null, is_active = false, updated_at = now()
where job_key = 'billing-quantity-sync-cron';

delete from app_private.system_job_definitions d
where d.job_key = 'billing-quantity-sync-cron'
  and not exists (
    select 1 from app_private.system_job_runs r where r.job_key = d.job_key
  );

update app_private.system_job_definitions
set
  cron_job_name = 'billing-quantity-sync',
  description = 'Keeps Stripe subscription-item quantities equal to the configured billing '
    || 'metric (quantity 1 for flat self-serve plans). Silence means invoices drift from the '
    || 'catalog with nothing else on screen to say so.',
  updated_at = now()
where job_key = 'billing-quantity-sync';

-- ---------------------------------------------------------------------------
-- The watchdog stops accepting "the request was sent" as "the job succeeded"
-- ---------------------------------------------------------------------------

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
