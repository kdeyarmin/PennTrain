-- pgTAP coverage for 20260905150000: a kill switch that only turned off the alarm (I17).
--
-- kill_switch_enabled is read in exactly one place -- claim_system_job_execution, which SQL reaches
-- only through execute_registered_sql_job. Twenty of the forty-six cron entries call their function
-- directly and sixteen post to an Edge Function, so for thirty-six of them the switch does nothing.
-- And the watchdog excluded every killed definition from its freshness pass. So flipping the switch
-- on one of the thirty-six left the job running and stopped the alerting: the operator turned off
-- the alarm, not the job. Run with: supabase test db.

begin;
select plan(8);

select has_function(
  'app_private', 'kill_switch_can_stop_job', array['text'],
  'app_private.kill_switch_can_stop_job(text) exists'
);

-- The predicate is the whole fix, so test it against the two real shapes rather than a fixture.
select ok(
  (select bool_and(app_private.kill_switch_can_stop_job(d.job_key))
   from app_private.system_job_definitions d
   join cron.job j on j.jobname = d.cron_job_name
   where j.command like '%execute_registered_sql_job%'),
  'every job whose cron entry routes through execute_registered_sql_job reports a working switch'
);
select ok(
  (select bool_and(not app_private.kill_switch_can_stop_job(d.job_key))
   from app_private.system_job_definitions d
   join cron.job j on j.jobname = d.cron_job_name
   where j.command not like '%execute_registered_sql_job%'),
  'and every job that calls its function directly, or posts to an Edge Function, reports a dead one'
);
select ok(
  (select count(*) from app_private.system_job_definitions d
   join cron.job j on j.jobname = d.cron_job_name
   where j.command not like '%execute_registered_sql_job%') > 0,
  'there is at least one such job -- otherwise the assertion above proves nothing'
);
select is(
  app_switch_absent.n, 0,
  'an unregistered job key reports a dead switch rather than raising'
) from (select (app_private.kill_switch_can_stop_job('no-such-job'))::int as n) app_switch_absent;

-- The watchdog no longer suppresses monitoring on a switch that cannot act.
select matches(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'run_system_job_watchdog'),
  'kill_switch_can_stop_job',
  'the watchdog asks whether the switch can act before letting it silence the freshness pass'
);

-- The five guards that could never fire. current_user inside a postgres-owned SECURITY DEFINER is
-- postgres, so `current_user not in ('postgres', ...)` was always false.
select is(
  (select count(*)::integer from pg_proc p
   where p.proname in ('record_user_invitation_sent', 'record_user_invitation_resent',
                       'reconcile_user_invitation_lifecycle', 'queue_manager_weekly_digests',
                       'restore_all_demo_baselines')
     and p.prosrc like '%current_user not in%'),
  0,
  'no service-only guard still tests current_user, which inside a definer is always the owner'
);
select is(
  (select count(*)::integer from pg_proc p
   where p.proname in ('record_user_invitation_sent', 'record_user_invitation_resent',
                       'reconcile_user_invitation_lifecycle', 'queue_manager_weekly_digests',
                       'restore_all_demo_baselines')
     and p.prosrc like '%auth.role()%'),
  5,
  'all five now read auth.role(), which is the caller''s JWT role and can actually be authenticated'
);

select * from finish();
rollback;
