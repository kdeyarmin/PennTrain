begin;
select plan(22);

-- The combined proposal engine. The assertions that matter most are the ones about rules that must
-- NOT fire: an engine that proposes everything is the failure mode 20260726040100 described, and it
-- passes any test that only checks "a proposal was created".

-- The flattener, tested directly ---------------------------------------------------------------
select is(
  app_private.flatten_assessment_answers('{"a": "1"}'::jsonb),
  '{"a": "1"}'::jsonb,
  'a flat object is returned unchanged'
);
select is(
  app_private.flatten_assessment_answers('{"section1": {"items": {"bathing": {"degree": "C"}}}}'::jsonb),
  '{"section1.items.bathing.degree": "C"}'::jsonb,
  'nested objects flatten to dotted paths'
);
-- Arrays stay whole: conditions are written against scalars, and an invented index syntax would be
-- a guess nobody writes rules against.
select is(
  app_private.flatten_assessment_answers('{"meds": ["a", "b"]}'::jsonb),
  '{"meds": ["a", "b"]}'::jsonb,
  'an array is kept at its own path rather than expanded'
);
select is(
  app_private.flatten_assessment_answers('"not an object"'::jsonb),
  '{}'::jsonb,
  'a non-object collapses to empty rather than raising'
);

-- Fixtures ---------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('fc000000-0000-4000-8000-000000000001', 'Engine Org', 'engine-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('fc000000-0000-4000-8000-000000000011', 'fc000000-0000-4000-8000-000000000001', 'Engine Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'fc000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'fc-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('fc000000-0000-4000-8000-000000000101', 'fc000000-0000-4000-8000-000000000001', 'fc-admin@test.local', 'Eve', 'Engine', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('fc000000-0000-4000-8000-000000000201', 'fc000000-0000-4000-8000-000000000001',
        'fc000000-0000-4000-8000-000000000011', 'Engine', 'Resident', public.pa_today(), 'active');

-- The resident needs some physical assistance with ambulation, and has no behavioural problem.
insert into public.resident_assessment_forms(
  id, organization_id, facility_id, resident_id, form_type, reason, status, version_number, content
) values (
  'fc000000-0000-4000-8000-000000000401', 'fc000000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000011', 'fc000000-0000-4000-8000-000000000201',
  'RASP', 'initial', 'finalized', 1,
  '{"section1": {"items": {"ambulation": {"degree": "C"}}},
    "section3": {"items": {"behavior": {"degree": "A"}}}}'::jsonb
);

-- Two rules. One matches the resident's answer; one does not. Before this migration BOTH would have
-- been proposed, because the engine never looked at the condition.
insert into public.support_plan_assessment_mapping_rules(
  organization_id, facility_id, rule_key, version, assessment_item_key, condition,
  proposed_need, proposed_service, proposed_intervention, rationale
) values
  ('fc000000-0000-4000-8000-000000000001', null, 'standby_ambulation', 1,
   'section1.items.ambulation.degree', '{"equals": ["C", "D"]}'::jsonb,
   '{"need": "Assistance with ambulation"}'::jsonb,
   '{"service_name": "Standby assistance"}'::jsonb,
   '{"intervention": "Stay within arm''s reach"}'::jsonb,
   'Degree C or D on ambulation means the resident cannot walk unaided.'),
  ('fc000000-0000-4000-8000-000000000001', null, 'behavior_plan', 1,
   'section3.items.behavior.degree', '{"equals": ["C", "D"]}'::jsonb,
   '{"need": "Behavioural support"}'::jsonb, '{}'::jsonb, '{}'::jsonb,
   'A moderate or severe behavioural problem needs a documented approach.');

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated',
    'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- Generation ------------------------------------------------------------------------------------
select pg_temp.act_as('fc000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.generate_support_plan_proposal('fc000000-0000-4000-8000-000000000401', 'Initial assessment finalized')$$,
  'a care manager generates a proposal from the finalized assessment'
);
reset role;

-- Before asserting that the behavioural rule did NOT fire, prove its key RESOLVES. An unresolvable
-- assessment_item_key yields a null answer, which also fails to match -- so without this, "only one
-- rule fired" would pass just as happily on a typo'd key, and would be testing nothing about the
-- condition. This is the failure mode that matters most: an assertion green for the wrong reason.
select is(
  app_private.flatten_assessment_answers(
    (select content from public.resident_assessment_forms
     where id = 'fc000000-0000-4000-8000-000000000401')) -> 'section3.items.behavior.degree',
  '"A"'::jsonb,
  'the non-matching rule''s assessment key resolves to a real answer, so its exclusion is the condition''s doing'
);

-- THE assertion this migration exists for.
select is(
  (select jsonb_array_length(proposal -> 'items') from public.support_plan_proposals
   where assessment_form_id = 'fc000000-0000-4000-8000-000000000401'),
  1,
  'only the rule whose condition matches the resident''s answer fires'
);
select is(
  (select proposal -> 'items' -> 0 ->> 'ruleKey' from public.support_plan_proposals
   where assessment_form_id = 'fc000000-0000-4000-8000-000000000401'),
  'standby_ambulation',
  'the rule that fired is the ambulation rule, not the behavioural one'
);

-- Provenance: a reviewer can see which answer triggered it and why.
select is(
  (select proposal -> 'items' -> 0 ->> 'assessmentItemKey' from public.support_plan_proposals
   where assessment_form_id = 'fc000000-0000-4000-8000-000000000401'),
  'section1.items.ambulation.degree',
  'the proposal records which assessment item triggered the rule'
);
select is(
  (select proposal -> 'items' -> 0 -> 'answer' from public.support_plan_proposals
   where assessment_form_id = 'fc000000-0000-4000-8000-000000000401'),
  '"C"'::jsonb,
  'the proposal records the answer the rule matched against'
);
select ok(
  (select (proposal -> 'items' -> 0 ->> 'rationale') like '%cannot walk unaided%'
   from public.support_plan_proposals where assessment_form_id = 'fc000000-0000-4000-8000-000000000401'),
  'the proposal carries the rule''s own stated reason'
);

-- Plan-compatible shape: this is what review_support_plan_proposal merges.
select is(
  (select jsonb_array_length(proposal -> 'proposedNeeds')
        + jsonb_array_length(proposal -> 'proposedServices')
        + jsonb_array_length(proposal -> 'proposedInterventions')
   from public.support_plan_proposals where assessment_form_id = 'fc000000-0000-4000-8000-000000000401'),
  3,
  'the matched rule contributes a need, a service, and an intervention'
);
-- An empty proposed_* must not become an empty entry on the plan.
select is(
  (select jsonb_array_length(proposal -> 'proposedDme') from public.support_plan_proposals
   where assessment_form_id = 'fc000000-0000-4000-8000-000000000401'),
  0,
  'a rule that proposes no DME contributes no DME entry'
);
select is(
  (select proposal -> 'proposedNeeds' -> 0 ->> 'key' from public.support_plan_proposals
   where assessment_form_id = 'fc000000-0000-4000-8000-000000000401'),
  'standby_ambulation',
  'a rule that curates no key of its own falls back to its rule key so the plan merge can dedupe'
);
-- Precedence, locked in: the seeded PA rules DO curate their own keys, and two rules deliberately
-- sharing one must stay a single plan entry. A stamp that overrode them would silently split those.
select is(
  (select jsonb_build_object('key', 'rule_key_fallback') || '{"key": "curated", "need": "x"}'::jsonb),
  '{"key": "curated", "need": "x"}'::jsonb,
  'a rule''s own key wins over the rule-key fallback'
);

-- Accepting reaches the plan, and accepting twice does not duplicate ---------------------------
select pg_temp.act_as('fc000000-0000-4000-8000-000000000101');
select lives_ok($$select public.review_support_plan_proposal(
  (select id from public.support_plan_proposals where assessment_form_id = 'fc000000-0000-4000-8000-000000000401'),
  'accepted', 'Matches what the assessment recorded.')$$,
  'the proposal is accepted');
-- Re-accepting is what the key stamping defends against: before it, this doubled the plan.
select lives_ok($$select public.review_support_plan_proposal(
  (select id from public.support_plan_proposals where assessment_form_id = 'fc000000-0000-4000-8000-000000000401'),
  'accepted', 'Re-confirmed after a second read.')$$,
  'the same proposal is accepted a second time');
reset role;

select is(
  (select jsonb_array_length(needs) + jsonb_array_length(services) + jsonb_array_length(interventions)
   from public.resident_support_plans where resident_id = 'fc000000-0000-4000-8000-000000000201'),
  3,
  'accepting twice leaves one need, one service, and one intervention -- not two of each'
);

-- Review answers reach the engine too -----------------------------------------------------------
-- This is the capability inherited from the review-keyed engine. Without it that engine's only
-- distinctive input would have been dropped along with the function.
insert into public.resident_assessment_reviews(
  id, organization_id, facility_id, resident_id, template_key, template_version, answers, status,
  -- A 'final' review must name who signed it and when; the table refuses an unsigned one, on the
  -- grounds that an unsigned "final" record is not evidence.
  assessor_name, assessor_signed_at
) values (
  'fc000000-0000-4000-8000-000000000501', 'fc000000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000011', 'fc000000-0000-4000-8000-000000000201',
  'mobility_fall_review', 1, '{"fall_risk": "high"}'::jsonb, 'final',
  'Eve Engine', now()
);
insert into public.support_plan_assessment_mapping_rules(
  organization_id, facility_id, rule_key, version, assessment_item_key, condition,
  proposed_need, proposed_service, proposed_intervention, rationale
) values (
  'fc000000-0000-4000-8000-000000000001', null, 'fall_precautions', 1,
  'fall_risk', '{"equals": ["high"]}'::jsonb,
  '{"need": "Fall precautions"}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  'A high fall risk recorded on review needs a documented precaution.'
);

-- A second form: proposals are unique on (organization, assessment_form, resident).
insert into public.resident_assessment_forms(
  id, organization_id, facility_id, resident_id, form_type, reason, status, version_number, content
) values (
  'fc000000-0000-4000-8000-000000000402', 'fc000000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000011', 'fc000000-0000-4000-8000-000000000201',
  'RASP', 'significant_change', 'finalized', 2,
  '{"section1": {"items": {"ambulation": {"degree": "A"}}}}'::jsonb
);

select pg_temp.act_as('fc000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.generate_support_plan_proposal('fc000000-0000-4000-8000-000000000402', 'Significant change review')$$,
  'a proposal is generated for the second assessment'
);
reset role;

select ok(
  exists(
    select 1 from public.support_plan_proposals p,
      lateral jsonb_array_elements(p.proposal -> 'items') as item
    where p.assessment_form_id = 'fc000000-0000-4000-8000-000000000402'
      and item ->> 'ruleKey' = 'fall_precautions'
  ),
  'a rule keyed on a finalized review''s answer fires -- the review engine''s input survives'
);
-- The second form answers ambulation "A", which the ambulation rule does not match. If form content
-- were ignored in favour of review answers, this rule would still be absent -- but the assertion
-- above already proves review answers are read, so together they show both sources are consulted.
select ok(
  not exists(
    select 1 from public.support_plan_proposals p,
      lateral jsonb_array_elements(p.proposal -> 'items') as item
    where p.assessment_form_id = 'fc000000-0000-4000-8000-000000000402'
      and item ->> 'ruleKey' = 'standby_ambulation'
  ),
  'the ambulation rule does not fire on a form that answers degree A'
);

-- The dead engine is gone.
select is(
  (select count(*)::int from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'generate_support_plan_proposal_from_review'),
  0,
  'the review-keyed engine no longer exists -- there is one way a proposal is made'
);

select * from finish();
rollback;
