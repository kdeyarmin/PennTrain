begin;
select plan(22);

-- Pins the repairs made for the go-live readiness review (BACKLOG rows B3, B4, B5, B10, G270,
-- N2, SG-2). Every assertion here exists because the condition it describes was TRUE on
-- production on 2026-09-04, not because it seemed like a good invariant: each one is a bug that
-- shipped and stayed shipped because nothing failed while it was open.

-- ---------------------------------------------------------------------------------------
-- B5a: the synthetic health check must be able to reach zero on a correct deployment.
-- ---------------------------------------------------------------------------------------
-- The counter had been reading `active_snapshot_id is null` with no regard for whether the
-- source was ever configured, so a deployment with no SAM_GOV_API_KEY -- where screen-exclusions
-- skips SAM by design -- failed this check every 15 minutes forever. An alarm that has never been
-- silent cannot alarm, which is why the job never caught anything else either.

update public.exclusion_source_state
set active_snapshot_id = null, last_status = 'not_loaded'
where source = 'sam_exclusions';
select is(
  (public.run_phase1_synthetic_checks() ->> 'exclusionSourcesWithoutActiveSnapshot')::int,
  0,
  'a source this deployment never configured is not counted as an integrity violation'
);

-- Every genuine failure mode still lands. These three are the reason the counter exists.
update public.exclusion_source_state set last_status = 'failed' where source = 'sam_exclusions';
select is(
  (public.run_phase1_synthetic_checks() ->> 'exclusionSourcesWithoutActiveSnapshot')::int,
  1,
  'a source whose refresh FAILED is still counted'
);
update public.exclusion_source_state set last_status = 'staging' where source = 'sam_exclusions';
select is(
  (public.run_phase1_synthetic_checks() ->> 'exclusionSourcesWithoutActiveSnapshot')::int,
  1,
  'a source stuck mid-refresh is still counted'
);
update public.exclusion_source_state set last_status = 'succeeded' where source = 'sam_exclusions';
select is(
  (public.run_phase1_synthetic_checks() ->> 'exclusionSourcesWithoutActiveSnapshot')::int,
  1,
  'a source that HAD an active snapshot and lost it is still counted -- the dangerous case'
);

-- ---------------------------------------------------------------------------------------
-- B3: an organization with no settings row can receive nothing, silently.
-- ---------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.organizations o
   where not exists (
     select 1 from public.organization_settings s where s.organization_id = o.id
   )),
  0,
  'every organization has an organization_settings row'
);

-- Enforcement was deliberately NOT added. A trigger creating the row on insert broke
-- record_organization_signup outright (its own plain INSERT then hit the unique key) and seven
-- other suites with it -- see 20260904020000. The forward path is covered by
-- org_baa_gated_ai.test.sql; what belongs here is only the invariant itself.

-- ---------------------------------------------------------------------------------------
-- B10: a trial with no end date never ends.
-- ---------------------------------------------------------------------------------------
insert into public.organizations (name, slug, subscription_status)
values ('Trial Probe', 'trial-probe', 'trial');
select isnt(
  (select trial_ends_at from public.organizations where slug = 'trial-probe'),
  null,
  'a non-demo organization created on a trial gets an actual deadline'
);

insert into public.organizations (name, slug, subscription_status, is_demo, demo_seed_version)
values ('Demo Probe', 'demo-probe', 'trial', true, 1);
select is(
  (select trial_ends_at from public.organizations where slug = 'demo-probe'),
  null,
  'a demo organization is exempt -- it is supposed to run indefinitely'
);

insert into public.organizations (name, slug, subscription_status, trial_ends_at)
values ('Explicit Probe', 'explicit-probe', 'trial', timestamptz '2027-01-01 00:00:00+00');
select is(
  (select trial_ends_at from public.organizations where slug = 'explicit-probe'),
  timestamptz '2027-01-01 00:00:00+00',
  'an explicitly supplied trial end is never overwritten'
);

insert into public.organizations (name, slug, subscription_status)
values ('Active Probe', 'active-probe', 'active');
select is(
  (select trial_ends_at from public.organizations where slug = 'active-probe'),
  null,
  'an organization that is not on a trial is not given a trial deadline'
);

-- ---------------------------------------------------------------------------------------
-- B4: a run whose worker died stays 'running' forever and the ledger keeps saying so.
-- ---------------------------------------------------------------------------------------
insert into app_private.system_job_runs (job_key, correlation_id, trigger_type, status, started_at, last_heartbeat_at)
values
  ('exclusion-screening', 'tap-stranded', 'scheduled', 'running', now() - interval '23 days', now() - interval '23 days'),
  ('exclusion-screening', 'tap-live',     'scheduled', 'running', now() - interval '2 minutes', now() - interval '2 minutes'),
  -- Started long ago but still heartbeating: the sweep must key on the heartbeat, or it would
  -- kill the one job in this system designed to run long (the resumable SAM sweep).
  ('exclusion-screening', 'tap-longrun',  'scheduled', 'running', now() - interval '20 hours', now() - interval '5 minutes');

select is(
  app_private.reconcile_abandoned_system_job_runs(),
  1,
  'the sweep closes exactly the run whose heartbeat stopped'
);
select is(
  (select status from app_private.system_job_runs where correlation_id = 'tap-stranded'),
  'failed',
  'the abandoned run is closed as failed rather than left running forever'
);
select is(
  (select error_code from app_private.system_job_runs where correlation_id = 'tap-stranded'),
  'abandoned_run',
  'and it says why, so an operator is not left guessing at a three-week-old run'
);
select is(
  (select status from app_private.system_job_runs where correlation_id = 'tap-live'),
  'running',
  'a run that is heartbeating normally is untouched'
);
select is(
  (select status from app_private.system_job_runs where correlation_id = 'tap-longrun'),
  'running',
  'and so is a genuinely long run that is still reporting progress'
);

-- ---------------------------------------------------------------------------------------
-- G270: the watched row must be the one that records completion.
-- ---------------------------------------------------------------------------------------
-- For a cron entry whose command is a net.http_post, pg_cron's exit status proves the request was
-- enqueued and nothing more. A definition judged on that signal reads healthy through a total
-- outage -- which is exactly how the billing sync failed hourly for weeks (20260814010000).
select is(
  (select coalesce(string_agg(d.job_key, ', ' order by d.job_key), '(none)')
   from app_private.system_job_definitions d
   join cron.job c on c.jobname = d.cron_job_name
   where d.is_active
     and d.is_critical
     and d.execution_kind = 'sql_cron'
     and c.command ilike '%net.http_post%'),
  '(none)',
  'no critical sql_cron definition is judged by a cron entry that only fires an HTTP request'
);

-- 20260904050000 had to exempt data-lifecycle and organization-export-jobs from the assertion
-- above, because neither Edge Function recorded a run at all -- so there was no true signal to
-- point the watchdog at. 20260904090000 instrumented both functions and repointed them, which is
-- what let the exemption go. These pin the shape that replaced it.
select is(
  (select execution_kind from app_private.system_job_definitions where job_key = 'data-lifecycle'),
  'edge_cron',
  'data-lifecycle is labelled for what its cron entry actually does -- fire an HTTP request'
);

select is(
  (select job_key || ':' || is_critical::text
   from app_private.system_job_definitions
   where cron_job_name = 'process-organization-export-jobs'),
  'organization-data-export:true',
  'the export cron entry is owned by the worker that claims and finishes the run'
);

select is(
  (select coalesce(string_agg(job_key, ', ' order by job_key), '(none)')
   from app_private.system_job_definitions
   where cron_job_name in (
     'process-certificate-pdf-jobs', 'process-binder-export-jobs',
     'process-document-analyzer-jobs', 'integration-webhook-dispatch'
   )),
  'binder-export-generation, certificate-pdf-generation, document-analyzer-extraction, integration-webhook-dispatch',
  'each of the four cron entries is owned by the definition its Edge Function actually finishes'
);

select is(
  (select count(*)::int from app_private.system_job_definitions
   where cron_job_name in (
     'process-certificate-pdf-jobs', 'process-binder-export-jobs',
     'process-document-analyzer-jobs', 'integration-webhook-dispatch'
   )
   and not is_critical),
  0,
  'and each survivor carries the criticality the pair was declared with'
);

-- ---------------------------------------------------------------------------------------
-- SG-2: a governed rule pack has to point at the subsection that states its numbers.
-- ---------------------------------------------------------------------------------------
-- Verified against the published sections on 2026-09-04: 2600.65(e) carries the 12-hour floor,
-- the first-year orientation inclusion and the 6-hour on-the-job cap; 2800.65(h) carries the
-- 16-hour floor and the statement that 2800.69 dementia hours are additional. The subsections the
-- templates used to cite -- (f)/(g) and (i)/(j) -- are topic lists and state no hours at all.
select is(
  (select count(*)::int from public.regulatory_rule_pack_templates
   where template_key in ('pa.pch.2600.65.personnel', 'pa.alf.2800.65.personnel')
     and (calculation_parameters ->> 'notes') !~ 'verified against the published section'),
  0,
  'both PA templates record that their hour floors were read against the published section'
);

select is(
  (select (calculation_parameters ->> 'generalAnnualHours')
     || '/' || coalesce(calculation_parameters ->> 'maxOnTheJobTrainingHours', '-')
   from public.regulatory_rule_pack_templates
   where template_key = 'pa.pch.2600.65.personnel'),
  '12/6',
  'PCH keeps 55 Pa. Code 2600.65(e): 12 annual hours, at most 6 of them on the job'
);

-- ---------------------------------------------------------------------------------------
-- N2: the one mutable search_path nobody had argued for.
-- ---------------------------------------------------------------------------------------
select isnt(
  (select p.proconfig from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.proname = 'clinical_disclosure_allowed'),
  null,
  'clinical_disclosure_allowed pins its search_path -- it gates every outbound clinical disclosure'
);

select * from finish();
rollback;
