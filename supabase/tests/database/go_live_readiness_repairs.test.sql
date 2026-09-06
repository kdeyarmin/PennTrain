begin;
select plan(25);

-- Pins the repairs made for the go-live readiness review (BACKLOG rows B3, B4, B5, B10, G270,
-- N2, SG-2). Every assertion here exists because the condition it describes was TRUE on
-- production on 2026-09-04, not because it seemed like a good invariant: each one is a bug that
-- shipped and stayed shipped because nothing failed while it was open.

-- ---------------------------------------------------------------------------------------
-- B5a: retired with the feature it measured.
-- ---------------------------------------------------------------------------------------
-- Four assertions here pinned `exclusionSourcesWithoutActiveSnapshot`, the Phase-1 synthetic
-- counter that read exclusion_source_state. 20260906020000 removed exclusion screening, so the
-- counter no longer exists to be right or wrong about. The repair it recorded -- that a source
-- this deployment never configured is not an integrity violation -- is not undone by the
-- counter's removal; it simply has nothing left to apply to.

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
  ('binder-export-generation', 'tap-stranded', 'scheduled', 'running', now() - interval '23 days', now() - interval '23 days'),
  ('binder-export-generation', 'tap-live',     'scheduled', 'running', now() - interval '2 minutes', now() - interval '2 minutes'),
  -- Started long ago but still heartbeating: the sweep must key on the heartbeat, or it would
  -- kill any job that legitimately runs for hours. (This used to borrow 'exclusion-screening'
  -- for its resumable SAM sweep; that job key was removed with the feature, and system_job_runs
  -- has an ON DELETE RESTRICT foreign key to the definitions table, so the fixture had to move
  -- to a surviving key rather than keep a dangling one.)
  ('binder-export-generation', 'tap-longrun',  'scheduled', 'running', now() - interval '20 hours', now() - interval '5 minutes');

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

-- ---------------------------------------------------------------------------------------
-- B4: certificates for completions that predate atomic issuance.
--
-- The repair itself is a one-shot DO block in 20260904040000, so what is worth guarding here is
-- the state it leaves behind and the bounded tool that finishes any overflow. If either assertion
-- fails, either the migration was reverted or something reintroduced the pre-atomic gap.
-- ---------------------------------------------------------------------------------------
select is(
  (select count(*)::int
   from public.course_assignments ca
   where ca.status = 'completed'
     and coalesce(ca.completed_at, ca.updated_at) < timestamptz '2026-07-11 15:48:19+00'
     and not exists (select 1 from public.certificates c where c.course_assignment_id = ca.id)),
  0,
  'no completion predating atomic issuance is left without a certificate'
);

select has_function(
  'public',
  'reconcile_course_completion_certificates',
  array['uuid', 'integer'],
  'the bounded repair the migration defers overflow to still exists'
);

-- ---------------------------------------------------------------------------------------
-- H19: the grant layer and the policy layer say the same thing.
--
-- 20260904100000 repairs production, where the hosted image's default privileges left `anon` and
-- `authenticated` holding 381 write grants no policy uses. On a clean database it revokes nothing,
-- so these two assertions are what actually carries the invariant forward: the first fails if a
-- migration grants a write no policy permits, the second if one writes a policy it forgot to grant
-- for. Both directions matter -- an unused grant is a lock left open, an unbacked policy is a
-- feature that silently does nothing.
-- ---------------------------------------------------------------------------------------
select is(
  (select count(*)::int
   from pg_class c
   cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as x(priv)
   cross join (values ('anon'), ('authenticated')) as ro(role_name)
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p')
     and c.relrowsecurity
     and has_table_privilege(ro.role_name, c.oid, x.priv)
     and not exists (
       select 1 from pg_policies p
       where p.schemaname = 'public' and p.tablename = c.relname
         and p.permissive = 'PERMISSIVE' and p.cmd in (x.priv, 'ALL')
         and (ro.role_name = any(p.roles) or 'public' = any(p.roles))
     )),
  0,
  'no browser role holds a write grant that row-level security already denies'
);

select is(
  (select count(*)::int
   from (
     select p.tablename, r as role_name,
            unnest(case when p.cmd = 'ALL' then array['INSERT', 'UPDATE', 'DELETE'] else array[p.cmd] end) as priv
     from pg_policies p, unnest(p.roles) as r
     where p.schemaname = 'public' and p.permissive = 'PERMISSIVE'
       and p.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
       and r in ('anon', 'authenticated')
   ) pol
   join pg_class c on c.relname = pol.tablename
     and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
   where not has_table_privilege(pol.role_name, c.oid, pol.priv)),
  0,
  'no permissive write policy is left without the grant it needs to ever fire'
);

-- ---------------------------------------------------------------------------------------
-- The operator surface must not contradict the pager.
--
-- 20260904050000 narrowed run_system_job_watchdog's freshness signal AND every resolved_* column
-- of get_system_job_control_plane by execution_kind. The watchdog half is covered by
-- billing_sync_watchdog_reads_real_success.test.sql; this is the /admin/system-jobs half, which
-- was still reading status, timings, counts and error off pg_cron whenever the cron row was newer
-- than the last claimed run. That is precisely the shape an Edge Function produces when it answers
-- 503 before claiming: a 'succeeded' cron row NEWER than the last real run. The screen then read
-- "succeeded" beside a last_success_at the same query called stale.
-- ---------------------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'control-plane-admin@test.local', 'x', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', false, false
);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active)
values ('70000000-0000-0000-0000-000000000001', null, 'control-plane-admin@test.local',
        'Control', 'Plane', 'platform_admin', true)
on conflict (id) do update set role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- The failing shape: a claimed run that FAILED, and a pg_cron row that is both newer and
-- 'succeeded'. Same two constraints as the watchdog suite -- username must equal current_user for
-- the RLS check, and runid must be explicit because the test role has no USAGE on runid_seq.
insert into app_private.system_job_runs (
  job_key, correlation_id, trigger_type, status, started_at, finished_at,
  attempted_count, succeeded_count, failed_count, error_code, error_message
) values (
  'data-lifecycle', 'control-plane-test', 'scheduled', 'failed',
  now() - interval '2 hours', now() - interval '2 hours',
  3, 0, 3, 'lifecycle_step_failed', 'every retention policy failed'
);

insert into cron.job_run_details (runid, jobid, status, username, database, command, start_time, end_time)
select 9876543211, c.jobid, 'succeeded', current_user, current_database(), c.command,
       now() - interval '1 minute', now() - interval '1 minute'
from cron.job c
where c.jobname = 'run-data-lifecycle-nightly';

select ok(
  exists(
    select 1 from cron.job_run_details r
    join cron.job c on c.jobid = r.jobid
    where c.jobname = 'run-data-lifecycle-nightly'
      and r.status = 'succeeded'
      and r.start_time > (
        select max(started_at) from app_private.system_job_runs where job_key = 'data-lifecycle'
      )
  ),
  'fixture precondition: the cron row is newer than the claimed run and says succeeded'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '70000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2'
  )::text,
  true
);
set local role authenticated;

select is(
  (select last_status from public.get_system_job_control_plane() where job_key = 'data-lifecycle'),
  'failed',
  'an edge_cron job reports its own failed run, not the newer cron row that only proves delivery'
);

reset role;
select set_config('request.jwt.claims', null, true);

-- The control, over identical data. For sql_cron the scheduled command IS the work, so pg_cron's
-- exit status genuinely reports it and must still win when it is newer. Narrowing by execution
-- kind must not blind the surface for the jobs the signal is actually valid for.
update app_private.system_job_definitions
set execution_kind = 'sql_cron'
where job_key = 'data-lifecycle';

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '70000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2'
  )::text,
  true
);
set local role authenticated;

select is(
  (select last_status from public.get_system_job_control_plane() where job_key = 'data-lifecycle'),
  'succeeded',
  'the same cron row still wins for a sql_cron job -- the signal is narrowed, not discarded'
);

reset role;
select set_config('request.jwt.claims', null, true);

select * from finish();
rollback;
