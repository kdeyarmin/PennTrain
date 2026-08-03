begin;
select plan(23);

-- BACKLOG.md E4, declarative targeting. The property that matters is not "the predicate matches"
-- -- it is that membership stays true as the roster moves. A rule evaluated once at authoring
-- time is the point-in-time pick it replaced, described more precisely.
--
-- The predicates are deliberately the ones compliance_profile_mapping_rules already uses, so the
-- assertions below double as a check that the two vocabularies still mean the same thing.

------------------------------------------------------------------------------------------------
-- Shape and access boundary
------------------------------------------------------------------------------------------------
select has_function(
  'public', 'materialize_policy_campaign_targets', array['uuid'],
  'the per-campaign materializer exists'
);

select has_function(
  'public', 'run_policy_campaign_targeting', array[]::text[],
  'the daily re-evaluation worker exists'
);

select ok(
  not has_function_privilege(
    'anon', 'public.materialize_policy_campaign_targets(uuid)', 'EXECUTE'),
  'anonymous callers cannot materialize targets'
);

select ok(
  not has_function_privilege('anon', 'public.run_policy_campaign_targeting()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.run_policy_campaign_targeting()', 'EXECUTE'),
  'the org-wide worker is service_role only -- no end user runs every tenant''s targeting'
);

select is(
  (select schedule from cron.job where jobname = 'materialize-policy-campaign-targets'),
  '0 11 * * *',
  'targeting is re-evaluated daily'
);

select ok(
  not exists(select 1 from app_private.unwatched_cron_jobs()
             where job_name = 'materialize-policy-campaign-targets'),
  'and the job is watched by the control plane'
);

------------------------------------------------------------------------------------------------
-- A declarative campaign must say who it targets
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('d1000000-0000-4000-8000-000000000001', 'Target Org', 'target-org', 'active'),
  ('d1000000-0000-4000-8000-000000000002', 'Other Org', 'target-other', 'active');

insert into public.facilities(id, organization_id, name, facility_type, is_sandbox, sandbox_seed_version) values
  ('d1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000001', 'Target PCH', 'PCH', false, null),
  ('d1000000-0000-4000-8000-000000000012', 'd1000000-0000-4000-8000-000000000001', 'Target ALR', 'ALR', false, null),
  ('d1000000-0000-4000-8000-000000000021', 'd1000000-0000-4000-8000-000000000002', 'Other PCH', 'PCH', false, null);

insert into public.policy_documents (id, organization_id, title)
values ('d1000000-0000-4000-8000-000000000301', 'd1000000-0000-4000-8000-000000000001', 'Hand Hygiene');

insert into public.policy_document_versions (
  id, policy_document_id, organization_id, version_number, storage_path,
  file_name, file_type, content_hash, status, published_at
) values (
  'd1000000-0000-4000-8000-000000000311', 'd1000000-0000-4000-8000-000000000301',
  'd1000000-0000-4000-8000-000000000001', 1, 'target/v1.pdf',
  'hand-hygiene.pdf', 'application/pdf', repeat('d', 64), 'published', now()
);

-- The failure this guards against is not hypothetical: if "no predicates" meant "match
-- everything", flipping a manual campaign to declarative would put a signature obligation on
-- every employee in the organization.
select throws_ok(
  $$ insert into public.policy_attestation_campaigns (
       id, organization_id, policy_document_id, policy_document_version_id, name, targeting_mode
     ) values (
       'd1000000-0000-4000-8000-000000000499', 'd1000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000301', 'd1000000-0000-4000-8000-000000000311',
       'No predicates', 'declarative'
     ) $$,
  '23514',
  null,
  'a declarative campaign with no predicates is rejected'
);

------------------------------------------------------------------------------------------------
-- Roster
------------------------------------------------------------------------------------------------
insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title,
  status, hire_date, worker_type, administers_medications, trainer_status, is_synthetic
) values
  -- Matches an aide-at-the-PCH rule.
  ('d1000000-0000-4000-8000-000000000201', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000011', 'A', 'Aide', 'Direct Care Aide', 'active', public.pa_today() - 100, 'regular', false, false, false),
  ('d1000000-0000-4000-8000-000000000202', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000011', 'B', 'Aide', 'Senior Direct Care Aide', 'active', public.pa_today() - 100, 'regular', false, false, false),
  -- Right title, wrong facility.
  ('d1000000-0000-4000-8000-000000000203', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000012', 'C', 'Aide', 'Direct Care Aide', 'active', public.pa_today() - 100, 'regular', false, false, false),
  -- Right facility, wrong title.
  ('d1000000-0000-4000-8000-000000000204', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000011', 'D', 'Cook', 'Dietary Cook', 'active', public.pa_today() - 100, 'regular', false, false, false),
  -- Right title and facility, but agency rather than regular staff.
  ('d1000000-0000-4000-8000-000000000205', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000011', 'E', 'Agency', 'Direct Care Aide', 'active', public.pa_today() - 100, 'agency', false, false, false),
  -- Right in every dimension but no longer employed.
  ('d1000000-0000-4000-8000-000000000206', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000011', 'F', 'Gone', 'Direct Care Aide', 'terminated', public.pa_today() - 100, 'regular', false, false, false),
  -- Another tenant entirely.
  ('d1000000-0000-4000-8000-000000000207', 'd1000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000021', 'G', 'Other', 'Direct Care Aide', 'active', public.pa_today() - 100, 'regular', false, false, false);

insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name,
  targeting_mode, target_facility_ids, target_worker_type, target_job_title_pattern
) values (
  'd1000000-0000-4000-8000-000000000401', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000301', 'd1000000-0000-4000-8000-000000000311',
  'Hand hygiene -- regular aides at the PCH', 'declarative',
  array['d1000000-0000-4000-8000-000000000011']::uuid[], 'regular', '%Direct Care Aide%'
);

-- A manual campaign alongside it, to prove the sweep leaves it alone.
insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name
) values (
  'd1000000-0000-4000-8000-000000000402', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000301', 'd1000000-0000-4000-8000-000000000311',
  'Hand hygiene -- hand-picked'
);

------------------------------------------------------------------------------------------------
-- Matching
------------------------------------------------------------------------------------------------
select is(
  public.materialize_policy_campaign_targets('d1000000-0000-4000-8000-000000000401'),
  2,
  'the two regular aides at the targeted facility are enrolled'
);

select ok(
  exists(select 1 from public.policy_attestations
         where campaign_id = 'd1000000-0000-4000-8000-000000000401'
           and employee_id = 'd1000000-0000-4000-8000-000000000201')
  and exists(select 1 from public.policy_attestations
         where campaign_id = 'd1000000-0000-4000-8000-000000000401'
           and employee_id = 'd1000000-0000-4000-8000-000000000202'),
  'both matching aides specifically -- an ILIKE pattern catches "Senior Direct Care Aide" too'
);

select is(
  (select count(*)::int from public.policy_attestations
   where campaign_id = 'd1000000-0000-4000-8000-000000000401'
     and employee_id in (
       'd1000000-0000-4000-8000-000000000203', 'd1000000-0000-4000-8000-000000000204',
       'd1000000-0000-4000-8000-000000000205', 'd1000000-0000-4000-8000-000000000206',
       'd1000000-0000-4000-8000-000000000207')),
  0,
  'and nobody outside the rule -- wrong facility, wrong title, agency, terminated, other tenant'
);

select is(
  (select count(*)::int from public.policy_attestations
   where campaign_id = 'd1000000-0000-4000-8000-000000000402'),
  0,
  'the manual campaign beside it is untouched'
);

select isnt(
  (select targets_last_materialized_at from public.policy_attestation_campaigns
   where id = 'd1000000-0000-4000-8000-000000000401'),
  null,
  'the campaign records when its targets were last evaluated'
);

------------------------------------------------------------------------------------------------
-- Idempotence, and the roster moving underneath it
------------------------------------------------------------------------------------------------
select is(
  public.materialize_policy_campaign_targets('d1000000-0000-4000-8000-000000000401'),
  0,
  're-running enrols nobody new'
);

select is(
  (select count(*)::int from public.policy_attestations
   where campaign_id = 'd1000000-0000-4000-8000-000000000401'),
  2,
  'and creates no duplicate obligation'
);

-- The whole point of the ticket. Under the old point-in-time pick this person is simply missing
-- from the campaign, permanently, and nothing reports it.
insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title,
  status, hire_date, worker_type, administers_medications, trainer_status, is_synthetic
) values
  ('d1000000-0000-4000-8000-000000000208', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000011', 'H', 'NewHire', 'Direct Care Aide', 'active', public.pa_today(), 'regular', false, false, false);

select is(
  public.materialize_policy_campaign_targets('d1000000-0000-4000-8000-000000000401'),
  1,
  'a new hire matching the rule is enrolled on the next evaluation'
);

-- A transfer INTO the targeted facility is the same event wearing different clothes.
-- status/hire_date/termination_date/facility_id are guarded by protect_employee_lifecycle_fields
-- and normally move through apply_employee_lifecycle_transition; app.lifecycle_transition is the
-- bypass that function itself sets. Used here because the subject under test is the targeting
-- rule, not the lifecycle guard.
select set_config('app.lifecycle_transition','on',true);
update public.employees set facility_id = 'd1000000-0000-4000-8000-000000000011'
where id = 'd1000000-0000-4000-8000-000000000203';
select set_config('app.lifecycle_transition','off',true);

select is(
  public.materialize_policy_campaign_targets('d1000000-0000-4000-8000-000000000401'),
  1,
  'and so is a transfer into the targeted facility'
);

-- Enrolment is not revoked when someone stops matching: an attestation already signed is
-- evidence, and a pending one records an obligation that existed. Removal is a separate decision
-- from enrolment, and this function deliberately does not make it.
select set_config('app.lifecycle_transition','on',true);
update public.employees set status = 'terminated'
where id = 'd1000000-0000-4000-8000-000000000201';
select set_config('app.lifecycle_transition','off',true);

select is(
  (select count(*)::int from public.policy_attestations
   where campaign_id = 'd1000000-0000-4000-8000-000000000401'
     and employee_id = 'd1000000-0000-4000-8000-000000000201'),
  1,
  'leaving the roster does not delete an attestation already on file'
);

select is(
  public.materialize_policy_campaign_targets('d1000000-0000-4000-8000-000000000401'),
  0,
  'and they are not re-enrolled either'
);

------------------------------------------------------------------------------------------------
-- Attestations created this way are ordinary attestations
------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.policy_attestations
   where campaign_id = 'd1000000-0000-4000-8000-000000000401'
     and (status <> 'pending' or attested_at is not null
          or policy_document_version_id <> 'd1000000-0000-4000-8000-000000000311')),
  0,
  'every enrolment is a pending assignment pinned to the campaign version'
);

select is(
  (select count(distinct organization_id)::int from public.policy_attestations
   where campaign_id = 'd1000000-0000-4000-8000-000000000401'),
  1,
  'and all of them sit in the campaign''s own organization'
);

------------------------------------------------------------------------------------------------
-- The org-wide worker
------------------------------------------------------------------------------------------------
insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name,
  targeting_mode, target_facility_type
) values (
  'd1000000-0000-4000-8000-000000000403', 'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000301', 'd1000000-0000-4000-8000-000000000311',
  'Hand hygiene -- every ALR', 'declarative', 'ALR'
);

-- The ALR now has staff of its own. Without this the worker would have nothing to do and the
-- assertion below would pass whether or not it works.
insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title,
  status, hire_date, worker_type, administers_medications, trainer_status, is_synthetic
) values
  ('d1000000-0000-4000-8000-000000000209', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000012', 'I', 'AlrAide', 'Direct Care Aide', 'active', public.pa_today(), 'regular', false, false, false);

select is(
  public.run_policy_campaign_targeting(),
  1,
  'the daily worker materializes a declarative campaign nobody touched by hand'
);

select is(
  (select count(*)::int from public.policy_attestations
   where campaign_id = 'd1000000-0000-4000-8000-000000000403'
     and employee_id = 'd1000000-0000-4000-8000-000000000209'),
  1,
  'enrolling the ALR employee the facility-type predicate matches, and only them'
);

select is(
  (select count(*)::int from public.policy_attestations
   where campaign_id = 'd1000000-0000-4000-8000-000000000402'),
  0,
  'and the worker still leaves the manual campaign alone'
);

select * from finish();
rollback;
