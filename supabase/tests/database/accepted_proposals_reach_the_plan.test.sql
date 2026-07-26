begin;
select plan(10);

-- Accepting a support-plan proposal must put its content into the draft plan. Before this, a
-- resident's first plan could never hold anything, so it could never be submitted and never became
-- effective -- and service tasks are generated from an effective plan, so nothing downstream worked.

-- The merge helper, tested directly: it is where duplicates and key-less entries are decided.
select is(
  app_private.merge_plan_entries('[]'::jsonb, '[{"key":"a","need":"A"}]'::jsonb),
  '[{"key": "a", "need": "A"}]'::jsonb,
  'an entry merges into an empty plan'
);
select is(
  app_private.merge_plan_entries('[{"key":"a","need":"A"}]'::jsonb, '[{"key":"a","need":"A again"}]'::jsonb),
  '[{"key": "a", "need": "A"}]'::jsonb,
  'a key already in the plan is not added twice -- accepting twice is not two services'
);
select is(
  jsonb_array_length(
    app_private.merge_plan_entries('[{"key":"a"}]'::jsonb, '[{"key":"b"}]'::jsonb)),
  2,
  'a new key is appended alongside the existing one'
);
-- Content the reviewer accepted must not be silently dropped just because it carries no key.
select is(
  jsonb_array_length(
    app_private.merge_plan_entries('[]'::jsonb, '[{"need":"no key here"}]'::jsonb)),
  1,
  'an entry without a key is kept rather than discarded'
);
select is(
  app_private.merge_plan_entries(null, null),
  '[]'::jsonb,
  'nulls collapse to an empty array rather than propagating'
);

-- Fixtures ---------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('fb000000-0000-4000-8000-000000000001', 'Plan Org', 'plan-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('fb000000-0000-4000-8000-000000000011', 'fb000000-0000-4000-8000-000000000001', 'Plan Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'fb000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'fb-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('fb000000-0000-4000-8000-000000000101', 'fb000000-0000-4000-8000-000000000001', 'fb-admin@test.local', 'Pam', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('fb000000-0000-4000-8000-000000000201', 'fb000000-0000-4000-8000-000000000001',
        'fb000000-0000-4000-8000-000000000011', 'Plan', 'Resident', current_date, 'active');

-- Two assessment forms: support_plan_proposals is unique on (organization, assessment_form,
-- resident) and treats NULL form ids as equal, so two proposals for one resident need two forms.
-- version_number differs: the table is unique on (resident, form_type, version).
insert into public.resident_assessment_forms(id, organization_id, facility_id, resident_id, form_type, reason, status, version_number)
values
  ('fb000000-0000-4000-8000-000000000401', 'fb000000-0000-4000-8000-000000000001',
   'fb000000-0000-4000-8000-000000000011', 'fb000000-0000-4000-8000-000000000201', 'RASP', 'initial', 'finalized', 1),
  ('fb000000-0000-4000-8000-000000000402', 'fb000000-0000-4000-8000-000000000001',
   'fb000000-0000-4000-8000-000000000011', 'fb000000-0000-4000-8000-000000000201', 'RASP', 'significant_change', 'finalized', 2);

insert into public.support_plan_proposals(
  id, organization_id, facility_id, resident_id, assessment_form_id, proposal, rationale, state
) values (
  'fb000000-0000-4000-8000-000000000301', 'fb000000-0000-4000-8000-000000000001',
  'fb000000-0000-4000-8000-000000000011', 'fb000000-0000-4000-8000-000000000201',
  'fb000000-0000-4000-8000-000000000401',
  '{"proposedNeeds":[{"key":"ambulation_support","need":"Requires standby assistance"}],
    "proposedServices":[{"key":"standby_ambulation","service_name":"Standby assistance"}],
    "proposedInterventions":[{"key":"standby_ambulation","intervention":"Stay within arm''s reach"}]}'::jsonb,
  'Mobility review recorded supervision for transfers.', 'proposed'
);

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- Accepting creates the draft and fills it ---------------------------------------------------------
select is(
  (select count(*)::int from public.resident_support_plans where resident_id = 'fb000000-0000-4000-8000-000000000201'),
  0,
  'the resident has no plan before the proposal is reviewed'
);

select pg_temp.act_as('fb000000-0000-4000-8000-000000000101');
select lives_ok($$select public.review_support_plan_proposal(
  'fb000000-0000-4000-8000-000000000301', 'accepted', 'Matches the mobility findings.')$$,
  'a care manager accepts the proposal');
reset role;

-- This is the assertion the whole migration exists for: the plan is no longer empty, so it can be
-- submitted, so the lifecycle can start at all.
select is(
  (select jsonb_array_length(needs) + jsonb_array_length(services) + jsonb_array_length(interventions)
   from public.resident_support_plans where resident_id = 'fb000000-0000-4000-8000-000000000201'),
  3,
  'the accepted proposal reaches the draft plan as needs, services, and interventions'
);

-- Rejection must leave the plan alone; that is what rejecting means.
insert into public.support_plan_proposals(
  id, organization_id, facility_id, resident_id, assessment_form_id, proposal, rationale, state
) values (
  'fb000000-0000-4000-8000-000000000302', 'fb000000-0000-4000-8000-000000000001',
  'fb000000-0000-4000-8000-000000000011', 'fb000000-0000-4000-8000-000000000201',
  'fb000000-0000-4000-8000-000000000402',
  '{"proposedServices":[{"key":"unwanted","service_name":"Something the reviewer declined"}]}'::jsonb,
  'Second proposal.', 'proposed'
);
select pg_temp.act_as('fb000000-0000-4000-8000-000000000101');
select lives_ok($$select public.review_support_plan_proposal(
  'fb000000-0000-4000-8000-000000000302', 'rejected', 'Not appropriate for this resident.')$$,
  'the second proposal is rejected');
reset role;

select is(
  (select jsonb_array_length(services) from public.resident_support_plans
   where resident_id = 'fb000000-0000-4000-8000-000000000201'),
  1,
  'a rejected proposal adds nothing to the plan'
);

select * from finish();
rollback;
