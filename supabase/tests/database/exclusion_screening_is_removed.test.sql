-- Exclusion screening was removed at the owner's direction (20260906020000).
--
-- A removal needs assertions as much as a feature does, and for two reasons. The first is the
-- obvious one: nothing should quietly come back. The second is the one that nearly bit here --
-- a removal this wide reaches things that are not part of the feature, and the risk is not that
-- too little goes but that too much does. Four functions outside the feature read into it
-- (evaluate_schedule_eligibility, get_survey_day_staff_roster, run_phase1_synthetic_checks,
-- execute_registered_sql_job), a fifth called its reconciler (run_system_job_watchdog), a view
-- selected `alerts.*` and so froze the dropped column into its own shape, and
-- get_organization_export_exclusions shares a word with the feature and nothing else. Each of
-- those is pinned below.
--
-- Run with: supabase test db.

begin;
select plan(16);

------------------------------------------------------------------------------------------------
-- Gone
------------------------------------------------------------------------------------------------

select is(
  (select count(*)::int from information_schema.tables
   where table_schema in ('public', 'app_private') and table_name like 'exclusion%'),
  0,
  'no exclusion table or view survives, including the app_private dedup backup'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.proname like '%exclusion%'
     and p.proname <> 'get_organization_export_exclusions'),
  0,
  'and no screening function, in either schema'
);

select is(
  (select count(*)::int from pg_trigger t
   where t.tgrelid = 'public.employees'::regclass and not t.tgisinternal
     and t.tgname = 'screen_new_employee_exclusions'),
  0,
  'a new hire is no longer screened at insert time'
);

select is(
  (select count(*)::int from cron.job
   where jobname in ('monthly-exclusion-screening', 'resume-sam-exclusion-screening')),
  0,
  'neither cron entry is scheduled'
);

-- Both of them. `sam-sweep-continuation` is the hourly resume tick for the SAM sweep -- same cron
-- entry, same Edge Function -- and its key names what it does rather than the feature it serves,
-- so a search for 'exclusion' or 'screen' among the job keys does not return it. Left active it
-- would list in /admin/system-jobs as a job whose cron entry and worker are both gone.
select is(
  (select count(*)::int from app_private.system_job_definitions
   where job_key in ('exclusion-screening', 'sam-sweep-continuation')),
  0,
  'and both job definitions the control plane drew from are gone'
);

-- The structural form of the same claim: no active definition may point at a cron entry that does
-- not exist. This is what a name search cannot tell you.
select is(
  (select count(*)::int from app_private.system_job_definitions d
   where d.is_active and d.cron_job_name is not null
     and not exists (select 1 from cron.job c where c.jobname = d.cron_job_name)),
  0,
  'no active job definition is left pointing at an unscheduled cron entry'
);

select is(
  (select count(*)::int from public.release_flags where feature_key = 'screening.on_hire_exclusion'),
  0,
  'the on-hire release flag is retired rather than left switched on over nothing'
);

------------------------------------------------------------------------------------------------
-- The alert vocabulary and the column that pointed at a match
------------------------------------------------------------------------------------------------

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'alerts'
     and column_name = 'exclusion_screening_match_id'),
  0,
  'alerts no longer carries a foreign key to a table that does not exist'
);

select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'alerts_alert_type_check')
    not like '%exclusion_match_found%',
  'and exclusion_match_found is out of the alert-type vocabulary'
);

------------------------------------------------------------------------------------------------
-- Not collateral damage
------------------------------------------------------------------------------------------------
-- public.alert_list_rows is `select a.*, ...`, so the dropped column blocked the drop and the
-- view had to be recreated. A CASCADE would have taken it instead, silently, and the alert queue
-- reads it on every mount.

select has_view('public', 'alert_list_rows', 'the paged alert read model survived the column drop');
select has_column('public', 'alert_list_rows', 'linked_incident_id',
  'and still resolves its deep-link targets');

-- Shares a word with the feature and nothing else: this is the export catalogue's list of tables
-- that hold no organization_id.
select has_function('public', 'get_organization_export_exclusions', array[]::text[],
  'the export exclusions catalogue is untouched -- it was never part of screening');

-- The Phase-1 health check dropped a counter. It must still answer, or every synthetic run fails.
select ok(
  public.run_phase1_synthetic_checks() ? 'auditIntegrityIssuesOpen'
    and not (public.run_phase1_synthetic_checks() ? 'exclusionSourcesWithoutActiveSnapshot'),
  'the synthetic health check still runs, without the counter it can no longer compute'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and (p.prosrc ~* 'exclusion_(list_entries|screening_matches|source_state|source_snapshots|refresh_runs|source_health)'
          or p.prosrc ~* 'exclusionSourcesWithoutActiveSnapshot'
          or p.prosrc ~* 'confirmed_exclusion')),
  0,
  'and no function anywhere still reads a dropped object -- plpgsql resolves at run time, so a '
  || 'missed reference would not have failed the migration, only the next call'
);

select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conname = 'schedule_eligibility_overrides_block_code_check') like '%oapsa_not_suitable%'
  and (select pg_get_constraintdef(oid) from pg_constraint
       where conname = 'schedule_eligibility_overrides_block_code_check') not like '%confirmed_exclusion%',
  'the override guard still refuses an OAPSA determination and no longer names a dead block code'
);

-- The audit manifest is keyed by name and nothing cascades into it. A 'row_trigger' entry whose
-- table is gone reports as unsatisfied for ever, so get_audit_coverage() would have gone
-- permanently red on five tables that no longer exist. This is the direction the "every table has
-- a manifest row" assertion cannot see.
select is(
  (select count(*)::int from app_private.audit_entity_manifest
   where table_name like 'exclusion%'),
  0,
  'no audit-manifest row outlives the table it classified'
);

select * from finish();
rollback;
