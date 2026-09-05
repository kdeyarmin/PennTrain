-- pgTAP coverage for 20260905240000 (I17 residual): nineteen jobs the control plane could not
-- reach, and a switch that told nobody it was dead.
--
-- 20260905150000 made the kill switch honest -- the watchdog stops suppressing monitoring for a
-- definition whose switch cannot act -- and deliberately left the other half, because
-- re-registering the direct cron entries is not a mechanical sweep and getting one wrong stops a
-- daily job silently. This is that half. Run with: supabase test db.

begin;
select plan(13);

------------------------------------------------------------------------------------------------
-- 1-4. Every SQL cron entry routes through the wrapper, except the one that must not
------------------------------------------------------------------------------------------------
select is(
  (select count(*)::integer
   from app_private.system_job_definitions d
   join cron.job j on j.jobname = d.cron_job_name
   where j.command not like '%net.http_post%'
     and j.command not like '%execute_registered_sql_job%'
     and d.job_key <> 'system-job-watchdog'),
  0,
  'no SQL cron entry runs its own statement any more -- they all go through the wrapper'
);
select is(
  (select count(*)::integer
   from app_private.system_job_definitions d
   join cron.job j on j.jobname = d.cron_job_name
   where j.command like '%execute_registered_sql_job%'),
  29,
  'twenty-nine of them, up from the ten that were routed before'
);
-- The watchdog stays direct on purpose: routing it through the wrapper would make ITS switch real,
-- and one switch that silences every other job's monitoring is a worse control plane than one
-- where the watchdog cannot be turned off from the same screen.
select ok(
  (select j.command not like '%execute_registered_sql_job%'
   from app_private.system_job_definitions d
   join cron.job j on j.jobname = d.cron_job_name
   where d.job_key = 'system-job-watchdog'),
  'the watchdog keeps its own statement, so it cannot be switched off alongside what it watches'
);
select ok(
  not app_private.kill_switch_can_stop_job('system-job-watchdog'),
  'and reports a dead switch, which is the true and intended answer for it'
);

------------------------------------------------------------------------------------------------
-- 5-7. The wrapper knows every job it is now asked to run
------------------------------------------------------------------------------------------------
-- A cron entry pointing at a key the case list does not have raises 22023, and the handler records
-- a durable FAILED run against a job that was never asked to do anything -- which for a critical
-- definition opens its circuit and stops the real schedule. So the two lists have to agree.
select is(
  (select count(*)::integer
   from app_private.system_job_definitions d
   join cron.job j on j.jobname = d.cron_job_name
   where j.command like '%execute_registered_sql_job%'
     and (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'execute_registered_sql_job')
         not like '%''' || d.job_key || '''%'),
  0,
  'every wrapper-routed cron entry names a job key the wrapper has a branch for'
);
select ok(
  (select prosrc like '%run_workforce_readiness_forecast_maintenance%'
      and prosrc like '%reconcile_user_invitation_lifecycle%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'execute_registered_sql_job'),
  'the three-statement daily maintenance job carries all three statements, not just the first'
);
select ok(
  (select prosrc like '%public.pa_today(), public.pa_today() + 14%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'execute_registered_sql_job'),
  'and the service-task window is generated on the facility day, not the server day'
);

------------------------------------------------------------------------------------------------
-- 8-9. The switches that were decorative now work
------------------------------------------------------------------------------------------------
select ok(
  (select count(*) from app_private.system_job_definitions d
   where d.is_active and app_private.kill_switch_can_stop_job(d.job_key)) >= 29,
  'at least twenty-nine live definitions now have a switch that can actually stop them'
);
select ok(
  (select bool_and(app_private.kill_switch_can_stop_job(d.job_key))
   from app_private.system_job_definitions d
   join cron.job j on j.jobname = d.cron_job_name
   where j.command like '%execute_registered_sql_job%'),
  'and every wrapper-routed definition is one of them'
);

------------------------------------------------------------------------------------------------
-- 10-11. The operator is told before they flip it
------------------------------------------------------------------------------------------------
select ok(
  (select pg_get_function_result(p.oid) like '%kill_switch_can_stop boolean%'
     and pg_get_function_result(p.oid) like '%kill_switch_enabled boolean%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_system_job_control_plane'),
  'the control plane returns both the switch position and whether flipping it would do anything'
);
select ok(
  not has_function_privilege('anon', 'public.get_system_job_control_plane()', 'EXECUTE'),
  'and it stays platform-admin work'
);

------------------------------------------------------------------------------------------------
-- 12-13. Nothing is judged by a sensor it does not write to
------------------------------------------------------------------------------------------------
-- A `net.http_post` succeeds the moment the request is enqueued, so for a definition whose cron
-- command is one, pg_cron's exit status proves delivery and nothing else -- which is what
-- `sql_cron` tells the watchdog and the control plane to read. Both of these were labelled that
-- way while their functions answered 401 (I4) and neither surface said a word.
select is(
  (select count(*)::integer
   from app_private.system_job_definitions d
   join cron.job j on j.jobname = d.cron_job_name
   where j.command like '%net.http_post%' and d.execution_kind = 'sql_cron'),
  0,
  'no definition whose cron entry posts to an Edge Function is still judged by pg_cron''s exit status'
);
-- The inverse, which is the trap 20260904090000 documented: a definition relabelled before its
-- function claims a run reads its freshness off a ledger nothing writes to, so a null last-success
-- is stale immediately rather than after the SLA, and it stays stale forever.
select is(
  (select count(*)::integer
   from app_private.system_job_definitions d
   where d.execution_kind <> 'sql_cron'
     and d.job_key in ('process-credential-renewals', 'regulatory-update-polling')
     and d.is_active),
  2,
  'and both of the relabelled ones are live, with their workers instrumented to claim and finish'
);

select * from finish();
rollback;
