-- pgTAP coverage for 20260905150000: a kill switch that only turned off the alarm (I17).
--
-- kill_switch_enabled is read in exactly one place -- claim_system_job_execution, which SQL reaches
-- only through execute_registered_sql_job. Twenty of the forty-six cron entries call their function
-- directly and sixteen post to an Edge Function, so for thirty-six of them the switch does nothing.
-- And the watchdog excluded every killed definition from its freshness pass. So flipping the switch
-- on one of the thirty-six left the job running and stopped the alerting: the operator turned off
-- the alarm, not the job. Run with: supabase test db.

begin;
select plan(9);

select has_function(
  'app_private', 'kill_switch_can_stop_job', array['text'],
  'app_private.kill_switch_can_stop_job(text) exists'
);

-- The predicate is the whole fix, so test it against the two real shapes rather than a fixture.
select ok(
  -- RETARGETED by 20260906170000 (BACKLOG J78). These two assertions used to pin the cron command
  -- string: a switch works iff the entry routes through execute_registered_sql_job. That is one
  -- layer short of where the switch is actually read. It is read inside
  -- claim_system_job_execution, and every Edge worker claims before it works -- a raised claim
  -- comes back as a 500 and the job does not run. So the switch stops all forty-three claiming
  -- jobs, the old predicate said thirty-one, and the console told operators the switch was dead on
  -- notification dispatch and certificate rendering, which it stops. What is pinned now is the
  -- fact itself: the switch works for exactly the jobs whose worker claims.
  (select bool_and(app_private.kill_switch_can_stop_job(d.job_key))
   from app_private.system_job_definitions d
   where d.claims_before_running),
  'every job whose worker claims an execution reports a working switch'
);
select ok(
  (select bool_and(not app_private.kill_switch_can_stop_job(d.job_key))
   from app_private.system_job_definitions d
   where not d.claims_before_running),
  'and only a job that never claims reports a dead one'
);
select is(
  (select coalesce(string_agg(d.job_key, ', ' order by d.job_key), '')
   from app_private.system_job_definitions d
   where not d.claims_before_running),
  'system-job-watchdog',
  'the watchdog is the one deliberate exemption -- disabling a job must not blind the thing that notices jobs have stopped'
);
select ok(
  (select count(*) from app_private.system_job_definitions d
   join cron.job j on j.jobname = d.cron_job_name
   where j.command not like '%execute_registered_sql_job%') > 0,
  'and Edge-routed jobs do exist -- they are the ones the old cron-string predicate got wrong'
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
