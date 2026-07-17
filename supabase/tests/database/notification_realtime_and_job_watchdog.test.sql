begin;
select plan(12);

select has_table(
  'app_private', 'system_job_watchdog_state',
  'the job watchdog retains deduplication and recovery state'
);
select has_function(
  'public', 'run_system_job_watchdog', array[]::text[],
  'the autonomous job freshness watchdog exists'
);
select ok(
  not has_function_privilege('authenticated', 'public.run_system_job_watchdog()', 'EXECUTE'),
  'interactive users cannot invoke the watchdog'
);
select ok(
  has_function_privilege('service_role', 'public.run_system_job_watchdog()', 'EXECUTE'),
  'the scheduler service may invoke the watchdog'
);
select results_eq(
  $$ select count(*)::int from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'notifications' $$,
  array[1],
  'notifications are published to Supabase Realtime'
);
select results_eq(
  $$ select count(*)::int from cron.job
     where jobname = 'system-job-last-success-watchdog'
       and schedule = '*/5 * * * *' $$,
  array[1],
  'the watchdog is scheduled every five minutes'
);
select ok(
  pg_get_functiondef('public.begin_notification_delivery_attempt(uuid,text,text)'::regprocedure)
    like '%pg_advisory_xact_lock%',
  'the spend decision is serialized per organization'
);
select ok(
  pg_get_functiondef('public.begin_notification_delivery_attempt(uuid,text,text)'::regprocedure)
    like '%spend_cap_reached%',
  'the provider boundary includes the enforced spend-cap outcome'
);

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode
) values (
  'watchdog-test-job', 'Watchdog test job', 'pgTAP watchdog behavior fixture',
  'sql_cron', 'watchdog-test-job-cron', interval '5 minutes',
  interval '10 minutes', true, 'manual'
);

select cmp_ok(
  public.run_system_job_watchdog(), '>=', 1,
  'the watchdog emits at least one initial stale-job event'
);
select results_eq(
  $$ select count(*)::int from app_private.system_job_watchdog_state
     where job_key = 'watchdog-test-job' and recovered_at is null $$,
  array[1],
  'a stale critical job is retained in open watchdog state'
);
select is(
  public.run_system_job_watchdog(), 0,
  'repeated watchdog runs are deduplicated within the one-hour alert window'
);

insert into app_private.system_job_runs (
  job_key, correlation_id, status, started_at, finished_at, last_heartbeat_at
) values (
  'watchdog-test-job', 'watchdog-recovery', 'succeeded',
  now(), now(), now()
);
select public.run_system_job_watchdog();
select results_eq(
  $$ select recovered_at is not null
     from app_private.system_job_watchdog_state
     where job_key = 'watchdog-test-job' $$,
  array[true],
  'a fresh successful run closes the stale watchdog state'
);

select * from finish();
rollback;
