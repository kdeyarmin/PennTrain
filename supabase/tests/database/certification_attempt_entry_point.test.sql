-- Certification attempts have an entry point (migration 20260804120000).
--
-- The assertion this suite exists for is that `approve_certification_attempt` -- which shipped in
-- 20260711213000 and had never been called by anything, because nothing could create an attempt --
-- is now reachable through a path a real assessor can walk. It is driven end to end as an
-- authenticated org_admin rather than by writing end states directly.

begin;
select plan(18);

select has_function('public', 'start_certification_attempt', array['uuid', 'uuid', 'timestamptz'],
  'an observation can be started');
select has_function('public', 'record_certification_attempt_item',
  array['uuid', 'uuid', 'text', 'jsonb', 'boolean', 'text'],
  'a checklist item can be recorded');
select has_function('public', 'submit_certification_attempt', array['uuid'],
  'a completed observation can be submitted');

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('ce000000-0000-4000-8000-000000000001', 'Cert Org', 'cert-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('ce000000-0000-4000-8000-000000000011', 'ce000000-0000-4000-8000-000000000001', 'Cert Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'ce000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'cert-assessor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('ce000000-0000-4000-8000-000000000101', 'ce000000-0000-4000-8000-000000000001', 'cert-assessor@test.local', 'Ada', 'Assessor', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(id, organization_id, facility_id, first_name, last_name, job_title) values
  ('ce000000-0000-4000-8000-000000000201', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000011', 'Cara', 'Candidate', 'Aide');
insert into public.certification_definitions(id, organization_id, qualification_key, name, separation_of_duties) values
  ('ce000000-0000-4000-8000-000000000301', 'ce000000-0000-4000-8000-000000000001', 'med_pass', 'Medication pass observation', true);
insert into public.certification_definition_versions(
  id, certification_definition_id, version_number, lifecycle_state, criteria,
  criteria_checksum_sha256, effective_from, authored_by, published_by, published_at
) values (
  'ce000000-0000-4000-8000-000000000401', 'ce000000-0000-4000-8000-000000000301', 1, 'published', '{}'::jsonb,
  repeat('a', 64), now() - interval '30 days',
  'ce000000-0000-4000-8000-000000000101', 'ce000000-0000-4000-8000-000000000101', now() - interval '30 days'
);
-- A draft version, to prove the precondition check is not merely accepting whatever it is given.
insert into public.certification_definition_versions(
  id, certification_definition_id, version_number, lifecycle_state, criteria,
  criteria_checksum_sha256, effective_from, authored_by
) values (
  'ce000000-0000-4000-8000-000000000402', 'ce000000-0000-4000-8000-000000000301', 2, 'draft', '{}'::jsonb,
  repeat('b', 64), now() - interval '1 day', 'ce000000-0000-4000-8000-000000000101'
);
insert into public.certification_checklist_items(
  id, certification_version_id, item_key, prompt, evidence_required, signature_required, sort_order
) values
  ('ce000000-0000-4000-8000-000000000501', 'ce000000-0000-4000-8000-000000000401', 'hand_hygiene', 'Performed hand hygiene', false, false, 1),
  ('ce000000-0000-4000-8000-000000000502', 'ce000000-0000-4000-8000-000000000401', 'right_resident', 'Verified right resident', true, true, 2);

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- ---------------------------------------------------------------------------
-- An unqualified assessor is refused before observing, not after
-- ---------------------------------------------------------------------------
--
-- This is the whole reason the precondition check exists: the approval gate would refuse this
-- attempt anyway, but only after somebody had spent an hour at a bedside filling in a checklist.

select pg_temp.act_as('ce000000-0000-4000-8000-000000000101');
select throws_like($$select public.start_certification_attempt(
  'ce000000-0000-4000-8000-000000000201', 'ce000000-0000-4000-8000-000000000401')$$,
  '%qualified assessor%',
  'an assessor with no qualification is refused, and told which precondition failed');
reset role;

insert into public.assessor_qualifications(
  organization_id, certification_definition_id, assessor_profile_id, effective_from, approved_by
) values (
  'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000301',
  'ce000000-0000-4000-8000-000000000101', now() - interval '60 days', 'ce000000-0000-4000-8000-000000000101'
);

select pg_temp.act_as('ce000000-0000-4000-8000-000000000101');
select throws_like($$select public.start_certification_attempt(
  'ce000000-0000-4000-8000-000000000201', 'ce000000-0000-4000-8000-000000000402')$$,
  '%published and effective%',
  'an unpublished checklist version is refused');

select throws_ok($$select public.start_certification_attempt(
  'ce000000-0000-4000-8000-000000000201', 'ce000000-0000-4000-8000-000000000401', now() + interval '1 day')$$,
  '22023', null,
  'an observation cannot be dated in the future');

-- ---------------------------------------------------------------------------
-- The path that could not be walked at all
-- ---------------------------------------------------------------------------

select lives_ok($$select public.start_certification_attempt(
  'ce000000-0000-4000-8000-000000000201', 'ce000000-0000-4000-8000-000000000401')$$,
  'a qualified assessor starts the observation');
reset role;

select is(
  (select status from public.certification_attempts where employee_id = 'ce000000-0000-4000-8000-000000000201'),
  'in_progress',
  'and it lands in_progress, a state nothing could previously reach');

select pg_temp.act_as('ce000000-0000-4000-8000-000000000101');
-- Two half-filled checklists for one competency and no way to say which is the record.
select throws_ok($$select public.start_certification_attempt(
  'ce000000-0000-4000-8000-000000000201', 'ce000000-0000-4000-8000-000000000401')$$,
  '23505', null,
  'a second open attempt for the same checklist is refused');

-- Submitting before anything is recorded must name the items, not just refuse.
select throws_like($$select public.submit_certification_attempt(
  (select id from public.certification_attempts where employee_id = 'ce000000-0000-4000-8000-000000000201'))$$,
  '%hand_hygiene%',
  'submitting an empty observation names the outstanding items');

-- The evidence and signature rules are enforced per item, where the assessor can act on them.
select throws_like($$select public.record_certification_attempt_item(
  (select id from public.certification_attempts where employee_id = 'ce000000-0000-4000-8000-000000000201'),
  'ce000000-0000-4000-8000-000000000502', 'met', '{}'::jsonb, true)$$,
  '%requires evidence%',
  'an evidence-required item with no evidence is refused');

select throws_like($$select public.record_certification_attempt_item(
  (select id from public.certification_attempts where employee_id = 'ce000000-0000-4000-8000-000000000201'),
  'ce000000-0000-4000-8000-000000000502', 'met', '{"observed": "wristband checked"}'::jsonb, false)$$,
  '%signature%',
  'and one with no signature is refused');

-- An item from a different checklist version is a category error, not a missing row.
select lives_ok($$select public.record_certification_attempt_item(
  (select id from public.certification_attempts where employee_id = 'ce000000-0000-4000-8000-000000000201'),
  'ce000000-0000-4000-8000-000000000501', 'met', '{}'::jsonb, false, null)$$,
  'an item requiring neither evidence nor a signature records cleanly');

select lives_ok($$select public.record_certification_attempt_item(
  (select id from public.certification_attempts where employee_id = 'ce000000-0000-4000-8000-000000000201'),
  'ce000000-0000-4000-8000-000000000502', 'met', '{"observed": "wristband checked aloud"}'::jsonb, true)$$,
  'a fully evidenced and signed item records');

select lives_ok($$select public.submit_certification_attempt(
  (select id from public.certification_attempts where employee_id = 'ce000000-0000-4000-8000-000000000201'))$$,
  'and the completed observation submits');
reset role;

select is(
  (select status from public.certification_attempts where employee_id = 'ce000000-0000-4000-8000-000000000201'),
  'submitted',
  'reaching submitted, the other state nothing could previously reach');

-- ---------------------------------------------------------------------------
-- The point of all of it: approve_certification_attempt becomes reachable
-- ---------------------------------------------------------------------------

select pg_temp.act_as('ce000000-0000-4000-8000-000000000101');
select lives_ok($$select public.approve_certification_attempt(
  (select id from public.certification_attempts where employee_id = 'ce000000-0000-4000-8000-000000000201'),
  'passed', 'Observed a full medication pass without prompting.', repeat('c', 64))$$,
  'the approval function that had never been callable now runs');
reset role;

-- A passed attempt is only meaningful if it grants the qualification duty eligibility reads.
select is(
  (select state from public.employee_qualifications
   where source_attempt_id = (select id from public.certification_attempts
     where employee_id = 'ce000000-0000-4000-8000-000000000201')),
  'active',
  'and the employee holds the qualification it exists to grant');

select * from finish();
rollback;
