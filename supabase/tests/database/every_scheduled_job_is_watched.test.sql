begin;
select plan(8);

-- The ratchet. Both surfaces that report job health -- run_system_job_watchdog() and
-- get_system_job_control_plane(), which backs /admin/system-jobs -- are driven by
-- system_job_definitions. A scheduled job with no definition row is invisible to both, so the page
-- reads as a complete list of healthy jobs while the unregistered ones are simply unobserved.
--
-- This suite fails when a cron.schedule is added without a definition. That is the point: the gap it
-- closes was not created deliberately, it accumulated one migration at a time.

select is(
  (select count(*)::int from app_private.unwatched_cron_jobs()),
  0,
  'every scheduled cron job has a system_job_definitions row'
);

-- Named, not just counted: on failure the diagnostic has to say WHICH job, or the next person
-- repeats this whole investigation.
select is(
  (select coalesce(string_agg(job_name, ', ' order by job_name), '(none)')
   from app_private.unwatched_cron_jobs()),
  '(none)',
  'and no job is left unwatched (any listed above must gain a definition or a stated exclusion)'
);

-- The specific jobs whose silence is most costly. Pinned individually because a count assertion
-- stays green if someone deletes a definition and adds an unrelated one.
select ok(
  exists(select 1 from app_private.system_job_definitions
         where cron_job_name = 'generate-resident-service-tasks-daily' and is_critical),
  'floor task generation is watched as critical -- its silence empties every aide''s task list'
);
select ok(
  exists(select 1 from app_private.system_job_definitions
         where cron_job_name = 'activate-due-support-plans' and is_critical),
  'support-plan activation is watched as critical'
);
select ok(
  exists(select 1 from app_private.system_job_definitions
         where cron_job_name = 'run-data-lifecycle-nightly' and is_critical),
  'retention enforcement is watched as critical -- silence there is a compliance exposure'
);

-- The watchdog is the job whose failure suppresses every other job's alerting, so it is the one
-- that must not be missing from its own table.
select ok(
  exists(select 1 from app_private.system_job_definitions
         where cron_job_name = 'system-job-last-success-watchdog' and is_critical),
  'the watchdog watches the watchdog'
);

-- Criticality has to stay meaningful. If everything is critical the alert stream is noise, which is
-- operationally the same as watching nothing -- so this asserts the split still exists rather than
-- asserting a specific count that would need editing on every future job.
select ok(
  (select count(*) from app_private.system_job_definitions where not is_critical) >= 5,
  'a meaningful set of jobs is deliberately non-critical -- criticality still discriminates'
);

-- A definition pointing at a cron job that does not exist is the mirror-image bug: the watchdog
-- joins on cron_job_name and silently finds no runs, which reads as "never succeeded" forever.
select is(
  (select count(*)::int
   from app_private.system_job_definitions d
   where d.cron_job_name is not null
     and d.execution_kind = 'sql_cron'
     and not exists (select 1 from cron.job c where c.jobname = d.cron_job_name)),
  0,
  'no sql_cron definition points at a cron job that does not exist'
);

select * from finish();
rollback;
