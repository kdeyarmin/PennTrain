begin;
select plan(14);

-- Finalizing a review proposes what its answers imply. The assertions that matter are the negative
-- ones: that nothing is proposed when no rule matches, and that a broken rule cannot stop a
-- clinician finalizing a review.

-- Fixtures ---------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('fd000000-0000-4000-8000-000000000001', 'Review Org', 'review-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('fd000000-0000-4000-8000-000000000011', 'fd000000-0000-4000-8000-000000000001', 'Review Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'fd000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'fd-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('fd000000-0000-4000-8000-000000000101', 'fd000000-0000-4000-8000-000000000001', 'fd-admin@test.local', 'Rae', 'Review', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values
  ('fd000000-0000-4000-8000-000000000201', 'fd000000-0000-4000-8000-000000000001',
   'fd000000-0000-4000-8000-000000000011', 'Rex', 'Review', public.pa_today(), 'active'),
  -- A second resident, for the no-anchor case: a review with no finalized assessment behind it.
  ('fd000000-0000-4000-8000-000000000202', 'fd000000-0000-4000-8000-000000000001',
   'fd000000-0000-4000-8000-000000000011', 'Nan', 'Noform', public.pa_today(), 'active');

-- The anchor. Its own content answers nothing the rules ask about, so anything proposed must have
-- come from the review -- which is the point of the test.
insert into public.resident_assessment_forms(
  id, organization_id, facility_id, resident_id, form_type, reason, status, version_number, content
) values (
  'fd000000-0000-4000-8000-000000000401', 'fd000000-0000-4000-8000-000000000001',
  'fd000000-0000-4000-8000-000000000011', 'fd000000-0000-4000-8000-000000000201',
  'RASP', 'initial', 'finalized', 1, '{"unrelated": "value"}'::jsonb
);

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated',
    'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- The rule this suite exercises. Keyed the way the seeded PA pack is keyed: on an internal-review
-- field, not on nested assessment-form content.
insert into public.support_plan_assessment_mapping_rules(
  organization_id, facility_id, rule_key, version, assessment_item_key, condition,
  proposed_need, proposed_service, proposed_intervention, rationale
) values (
  'fd000000-0000-4000-8000-000000000001', null, 'review.transfer_support', 1,
  'transfer_assistance', '{"equals": ["one_person", "two_person"]}'::jsonb,
  '{"need": "Requires transfer assistance"}'::jsonb,
  '{"service_name": "Assisted transfers"}'::jsonb, '{}'::jsonb,
  'The mobility review recorded that the resident needs hands-on help to transfer.'
);

-- A matching review proposes ---------------------------------------------------------------------
insert into public.resident_assessment_reviews(
  id, organization_id, facility_id, resident_id, template_key, template_version, answers, status
) values (
  'fd000000-0000-4000-8000-000000000501', 'fd000000-0000-4000-8000-000000000001',
  'fd000000-0000-4000-8000-000000000011', 'fd000000-0000-4000-8000-000000000201',
  'mobility_fall_review', 1, '{"transfer_assistance": "one_person"}'::jsonb, 'draft'
);

select is(
  (select count(*)::int from public.support_plan_proposals
   where resident_id = 'fd000000-0000-4000-8000-000000000201'),
  0,
  'no proposal exists before the review is finalized'
);

select pg_temp.act_as('fd000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.finalize_resident_assessment_review(
    'fd000000-0000-4000-8000-000000000501', 'Rae Review')$$,
  'the mobility review is finalized'
);
reset role;

-- THE assertion this migration exists for: finalizing is what fires the rule pack.
select is(
  (select count(*)::int from public.support_plan_proposals
   where resident_id = 'fd000000-0000-4000-8000-000000000201'),
  1,
  'finalizing the review generated a proposal without anyone pressing a button'
);
-- By presence, not position: rules are ordered by key, and the SHIPPED PA pack keys on
-- `transfer_assistance` too, so this suite's own rule is not necessarily first.
select ok(
  exists(select 1 from public.support_plan_proposals p,
           lateral jsonb_array_elements(p.proposal -> 'items') as item
         where p.resident_id = 'fd000000-0000-4000-8000-000000000201'
           and item ->> 'ruleKey' = 'review.transfer_support'),
  'the proposal contains the rule the review''s answer matched'
);

-- The shipped pack fires on a real review, which is the whole claim of this migration. Asserting
-- only against a rule the test itself inserted would prove the engine works on test data and leave
-- the actual PA rules as untested as they were before.
select ok(
  exists(select 1 from public.support_plan_proposals p,
           lateral jsonb_array_elements(p.proposal -> 'items') as item
         where p.resident_id = 'fd000000-0000-4000-8000-000000000201'
           and item ->> 'ruleKey' = 'pa.mobility.standby_ambulation'),
  'the seeded PA mobility rule fires on a finalized mobility review -- the shipped pack is live'
);

-- Proving the answer came from the REVIEW, not the form: the form answers nothing the rules ask.
select ok(
  (select bool_and(item ->> 'answer' = 'one_person')
   from public.support_plan_proposals p,
        lateral jsonb_array_elements(p.proposal -> 'items') as item
   where p.resident_id = 'fd000000-0000-4000-8000-000000000201'),
  'every matched answer is the review''s, since the anchor form does not answer those keys at all'
);
select is(
  (select assessment_form_id from public.support_plan_proposals
   where resident_id = 'fd000000-0000-4000-8000-000000000201'),
  'fd000000-0000-4000-8000-000000000401'::uuid,
  'the proposal is anchored to the resident''s latest finalized assessment'
);
-- The work item is what actually puts it in front of someone.
select is(
  (select count(*)::int from public.work_items w
   join public.support_plan_proposals p on p.work_item_id = w.id
   where p.resident_id = 'fd000000-0000-4000-8000-000000000201' and w.state = 'open'),
  1,
  'an open work item carries the proposal into the operational queue'
);

-- A review that matches nothing proposes nothing ------------------------------------------------
insert into public.resident_assessment_reviews(
  id, organization_id, facility_id, resident_id, template_key, template_version, answers, status
) values (
  'fd000000-0000-4000-8000-000000000502', 'fd000000-0000-4000-8000-000000000001',
  'fd000000-0000-4000-8000-000000000011', 'fd000000-0000-4000-8000-000000000202',
  'mobility_fall_review', 1, '{"transfer_assistance": "independent"}'::jsonb, 'draft'
);
insert into public.resident_assessment_forms(
  id, organization_id, facility_id, resident_id, form_type, reason, status, version_number, content
) values (
  'fd000000-0000-4000-8000-000000000402', 'fd000000-0000-4000-8000-000000000001',
  'fd000000-0000-4000-8000-000000000011', 'fd000000-0000-4000-8000-000000000202',
  'RASP', 'initial', 'finalized', 1, '{}'::jsonb
);

select pg_temp.act_as('fd000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.finalize_resident_assessment_review(
    'fd000000-0000-4000-8000-000000000502', 'Rae Review')$$,
  'a review whose answers match no rule still finalizes'
);
reset role;

-- An empty proposal carrying a high-priority work item is a false alarm, and false alarms are how
-- an operational queue stops being read.
select is(
  (select count(*)::int from public.support_plan_proposals
   where resident_id = 'fd000000-0000-4000-8000-000000000202'),
  0,
  'a review that matches no rule proposes nothing at all'
);
select is(
  (select count(*)::int from public.work_items
   where organization_id = 'fd000000-0000-4000-8000-000000000001'
     and deduplication_key like 'support-plan-proposal:%'),
  1,
  'and raises no work item -- the queue holds only the one real proposal'
);

-- The explicit path returns null rather than an empty proposal.
select pg_temp.act_as('fd000000-0000-4000-8000-000000000101');
select is(
  public.generate_support_plan_proposal('fd000000-0000-4000-8000-000000000402', 'Manual check'),
  null,
  'generating explicitly with no matching rule returns null instead of an empty proposal'
);
reset role;

-- Finalizing survives a broken rule --------------------------------------------------------------
-- A malformed mapping rule must not be able to block clinical documentation. This one names a
-- condition operator nothing implements, so it simply fails to match rather than raising -- and the
-- review finalizes either way, which is the behaviour being pinned.
insert into public.resident_assessment_reviews(
  id, organization_id, facility_id, resident_id, template_key, template_version, answers, status
) values (
  'fd000000-0000-4000-8000-000000000503', 'fd000000-0000-4000-8000-000000000001',
  'fd000000-0000-4000-8000-000000000011', 'fd000000-0000-4000-8000-000000000201',
  'continence_review', 1, '{"transfer_assistance": "two_person"}'::jsonb, 'draft'
);
update public.support_plan_assessment_mapping_rules
  set condition = '{"nonsenseOperator": 42}'::jsonb
  where rule_key = 'review.transfer_support';

select pg_temp.act_as('fd000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.finalize_resident_assessment_review(
    'fd000000-0000-4000-8000-000000000503', 'Rae Review', 'fd000000-0000-4000-8000-000000000501')$$,
  'a review finalizes even when a mapping rule is malformed'
);
reset role;

select is(
  (select status from public.resident_assessment_reviews
   where id = 'fd000000-0000-4000-8000-000000000503'),
  'final',
  'the review is recorded as final -- the clinician''s act is never blocked by the rule pack'
);

select * from finish();
rollback;
