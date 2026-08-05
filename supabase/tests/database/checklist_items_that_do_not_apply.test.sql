-- A checklist item that does not apply is complete (migrations 20260804120000, 20260804180000).
--
-- `record_certification_attempt_item` accepts `not_applicable` without evidence or a signature: an
-- item that a particular observation could not exercise has nothing to photograph and nobody to
-- sign it. Both completeness gates then ignored `result` and demanded evidence and a signature
-- regardless, so a checklist carrying such an item could be filled in completely and never
-- submitted or approved -- a dead end reachable from ordinary use, not an edge case.
--
-- This suite walks it: record the required item as not applicable, then submit, then approve.

begin;
select plan(9);

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('ca000000-0000-4000-8000-000000000001', 'NA Org', 'na-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000001', 'NA Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'ca000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'na-assessor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('ca000000-0000-4000-8000-000000000101', 'ca000000-0000-4000-8000-000000000001', 'na-assessor@test.local', 'Nadia', 'Assessor', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(id, organization_id, facility_id, first_name, last_name, job_title) values
  ('ca000000-0000-4000-8000-000000000201', 'ca000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000011', 'Nils', 'Candidate', 'Aide');
insert into public.certification_definitions(id, organization_id, qualification_key, name, separation_of_duties) values
  ('ca000000-0000-4000-8000-000000000301', 'ca000000-0000-4000-8000-000000000001', 'na_med_pass', 'Observation with an inapplicable step', false);
insert into public.certification_definition_versions(
  id, certification_definition_id, version_number, lifecycle_state, criteria,
  criteria_checksum_sha256, effective_from, authored_by, published_by, published_at
) values (
  'ca000000-0000-4000-8000-000000000401', 'ca000000-0000-4000-8000-000000000301', 1, 'published', '{}'::jsonb,
  repeat('a', 64), now() - interval '30 days',
  'ca000000-0000-4000-8000-000000000101', 'ca000000-0000-4000-8000-000000000101', now() - interval '30 days'
);
-- The second item demands both evidence and a signature. It is the one that will not apply.
insert into public.certification_checklist_items(
  id, certification_version_id, item_key, prompt, evidence_required, signature_required, sort_order
) values
  ('ca000000-0000-4000-8000-000000000501', 'ca000000-0000-4000-8000-000000000401', 'hand_hygiene', 'Performed hand hygiene', false, false, 1),
  ('ca000000-0000-4000-8000-000000000502', 'ca000000-0000-4000-8000-000000000401', 'insulin_draw', 'Drew up insulin', true, true, 2);

insert into public.assessor_qualifications(
  organization_id, certification_definition_id, assessor_profile_id, effective_from, approved_by
) values (
  'ca000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000301',
  'ca000000-0000-4000-8000-000000000101', now() - interval '60 days',
  'ca000000-0000-4000-8000-000000000101'
);

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- The walk ---------------------------------------------------------------------------
select pg_temp.act_as('ca000000-0000-4000-8000-000000000101');

select lives_ok($$select public.start_certification_attempt(
  'ca000000-0000-4000-8000-000000000201', 'ca000000-0000-4000-8000-000000000401')$$,
  'an observation starts');

select lives_ok($$select public.record_certification_attempt_item(
  (select id from public.certification_attempts where employee_id = 'ca000000-0000-4000-8000-000000000201'),
  'ca000000-0000-4000-8000-000000000501', 'met', '{}'::jsonb, false, null)$$,
  'the ordinary item records');

-- The point of the suite: this item requires evidence AND a signature, and supplies neither.
select lives_ok($$select public.record_certification_attempt_item(
  (select id from public.certification_attempts where employee_id = 'ca000000-0000-4000-8000-000000000201'),
  'ca000000-0000-4000-8000-000000000502', 'not_applicable', '{}'::jsonb, false,
  'This resident is not on insulin')$$,
  'an evidence-and-signature item records as not applicable without either');

select is(
  (select ai.result from public.certification_attempt_items ai
     where ai.checklist_item_id = 'ca000000-0000-4000-8000-000000000502'),
  'not_applicable',
  'and it is stored as not applicable rather than skipped');

select is(
  (select ai.evidence from public.certification_attempt_items ai
     where ai.checklist_item_id = 'ca000000-0000-4000-8000-000000000502'),
  '{}'::jsonb,
  'with no evidence, which is the whole point');

-- Before 20260804180000 and the submit-gate fix, both of these raised 23514 forever.
select lives_ok($$select public.submit_certification_attempt(
  (select id from public.certification_attempts where employee_id = 'ca000000-0000-4000-8000-000000000201'))$$,
  'the observation submits rather than naming the inapplicable item as missing');

select lives_ok($$select public.approve_certification_attempt(
  (select id from public.certification_attempts where employee_id = 'ca000000-0000-4000-8000-000000000201'),
  'passed', 'Observed competent; insulin step did not apply to this resident', repeat('c', 64))$$,
  'and it approves');

select is(
  (select status from public.certification_attempts
     where employee_id = 'ca000000-0000-4000-8000-000000000201'),
  'passed',
  'the attempt reaches a decision');

-- An item nobody recorded at all is still missing: `ai.id is null` was deliberately left alone.
reset role;
insert into public.certification_checklist_items(
  id, certification_version_id, item_key, prompt, evidence_required, signature_required, sort_order
) values
  ('ca000000-0000-4000-8000-000000000503', 'ca000000-0000-4000-8000-000000000401', 'unrecorded', 'Never touched', false, false, 3);
select set_config('app.privileged_write', 'on', true);
insert into public.certification_attempts(
  id, organization_id, facility_id, employee_id, certification_version_id,
  assessor_profile_id, status, observed_at, created_by
) values (
  'ca000000-0000-4000-8000-000000000601', 'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000201',
  'ca000000-0000-4000-8000-000000000401', 'ca000000-0000-4000-8000-000000000101',
  'in_progress', now(), 'ca000000-0000-4000-8000-000000000101'
);
select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('ca000000-0000-4000-8000-000000000101');
select throws_like($$select public.submit_certification_attempt(
  'ca000000-0000-4000-8000-000000000601')$$,
  '%unrecorded%',
  'not applicable has to be said: an item nobody recorded is still outstanding');
reset role;

select * from finish();
rollback;
