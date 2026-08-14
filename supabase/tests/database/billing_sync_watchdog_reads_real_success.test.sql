begin;
select plan(6);

-- The billing quantity sync answered 503 on every scheduled run for weeks and the watchdog
-- reported it healthy. Two things made that possible, and this suite pins both closed.
--
--   1. The critical definition carried no cron name while the row that carried the cron name
--      was not critical, so run_system_job_watchdog()'s filter -- is_active and is_critical
--      and cron_job_name is not null -- skipped both halves of the same job.
--   2. The resolver accepted cron.job_run_details 'succeeded' as proof the job succeeded. For
--      a cron entry whose command is a net.http_post to an Edge Function, that status only
--      says the request was enqueued. It stays green while the function returns 503 forever.

-- ---------------------------------------------------------------------------
-- One critical definition owns the cron entry
-- ---------------------------------------------------------------------------

select ok(
  exists(
    select 1 from app_private.system_job_definitions
    where job_key = 'billing-quantity-sync'
      and cron_job_name = 'billing-quantity-sync'
      and execution_kind = 'edge_cron'
      and is_critical
      and is_active
  ),
  'the critical billing-quantity-sync definition carries the cron job name the watchdog filters on'
);

select is(
  (select count(*)::int from app_private.system_job_definitions
   where cron_job_name = 'billing-quantity-sync'),
  1,
  'exactly one definition claims the billing-quantity-sync cron entry -- no critical/non-critical split'
);

-- ---------------------------------------------------------------------------
-- A cron entry that keeps succeeding, for work that never happened
-- ---------------------------------------------------------------------------

-- Reproduce the production shape exactly: the cron entry reports a fresh success (pg_cron
-- enqueued the request) while the function has recorded no finished run of its own. Under the
-- previous resolver this read as fresh forever; the job had never once succeeded.
--
-- username must equal current_user: cron.job_run_details carries an RLS policy of
-- username = CURRENT_USER, which Postgres also applies as the INSERT check.
insert into cron.job_run_details (jobid, status, username, database, command, start_time, end_time)
select c.jobid, 'succeeded', current_user, current_database(), c.command, now(), now()
from cron.job c
where c.jobname = 'billing-quantity-sync';

-- Asserted, not assumed: without a fresh cron success the two branches below would be
-- indistinguishable, and the control would fail for the wrong reason.
select ok(
  exists(
    select 1 from cron.job_run_details r
    join cron.job c on c.jobid = r.jobid
    where c.jobname = 'billing-quantity-sync'
      and r.status = 'succeeded'
      and r.start_time > now() - interval '1 minute'
  )
  and not exists(
    select 1 from app_private.system_job_runs
    where job_key = 'billing-quantity-sync' and status = 'succeeded'
  ),
  'fixture precondition: the cron entry reports a fresh success and the sync has no finished run of its own'
);

select public.run_system_job_watchdog();

select results_eq(
  $$ select count(*)::int from app_private.system_job_watchdog_state
     where job_key = 'billing-quantity-sync' and recovered_at is null $$,
  array[1],
  'an edge_cron job with no finished run of its own is stale even while its cron entry succeeds'
);

-- The control, over the identical data: as sql_cron the scheduled command IS the work, so the
-- cron exit status genuinely reports it and must still count. Narrowing the resolver by
-- execution kind must not turn every sql_cron job into a permanent false alarm.
update app_private.system_job_definitions
set execution_kind = 'sql_cron'
where job_key = 'billing-quantity-sync';

select public.run_system_job_watchdog();

select results_eq(
  $$ select recovered_at is not null
     from app_private.system_job_watchdog_state
     where job_key = 'billing-quantity-sync' $$,
  array[true],
  'the same cron success still clears a sql_cron job -- the signal is narrowed, not discarded'
);

select ok(
  pg_get_functiondef('public.run_system_job_watchdog()'::regprocedure) like '%execution_kind%',
  'the watchdog resolves last success by execution kind rather than trusting every cron row'
);

select * from finish();
rollback;
