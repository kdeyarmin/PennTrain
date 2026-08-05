-- Medical evaluations: the initial and annual cycles carry their own grace (migration 20260804170000).
--
-- The assertion this suite exists for is the one the shared row made impossible: an ALF resident
-- whose INITIAL medical evaluation is ten days past due is expired, and an ALF resident whose
-- ANNUAL evaluation is ten days past due is not. Before the split those two residents got the same
-- answer, because one `grace_period_days` covered both cycles -- and for ALF that answer was
-- "compliant" for both, which is the permissive direction.

begin;
select plan(21);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from public.resident_compliance_rule_packs
   where organization_id is null and item_type = 'annual_medical_evaluation'),
  3,
  'the annual cycle has its own rule-pack row for PCH and both ALF admission tracks');

select is(
  (select count(distinct grace_period_days)::integer from public.resident_compliance_rule_packs
   where organization_id is null and item_type = 'medical_evaluation'),
  1,
  'every initial-evaluation row agrees on its grace');

select is(
  (select distinct grace_period_days from public.resident_compliance_rule_packs
   where organization_id is null and item_type = 'medical_evaluation'),
  0,
  'and that grace is zero -- both RCG exclusion lists name the initial evaluation directly');

select is(
  (select distinct grace_period_days from public.resident_compliance_rule_packs
   where organization_id is null and item_type = 'annual_medical_evaluation'),
  15,
  'the annual cycle carries the 15 days both RCGs confirm for it');

-- The initial row must not also describe a renewal, or there would be two sources for one successor.
select is(
  (select count(*)::integer from public.resident_compliance_rule_packs
   where organization_id is null and item_type = 'medical_evaluation'
     and renewal_interval_days is not null),
  0,
  'the initial row no longer claims to renew itself');

select ok(
  (select bool_and(citation_ref = case when facility_type = 'ALR' then '2800.141' else '2600.141' end)
   from public.resident_compliance_rule_packs
   where organization_id is null and item_type = 'annual_medical_evaluation'),
  'the annual rows cite the same section as the initial ones -- this is a cycle split, not a new rule');

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('2e000000-0000-4000-8000-000000000001', 'Cycle Org', 'cycle-org', 'active');
-- One of each facility type: the bug pointed in opposite directions for the two.
insert into public.facilities(id, organization_id, name, facility_type) values
  ('2e000000-0000-4000-8000-000000000011', '2e000000-0000-4000-8000-000000000001', 'Cycle ALF', 'ALR'),
  ('2e000000-0000-4000-8000-000000000012', '2e000000-0000-4000-8000-000000000001', 'Cycle PCH', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '2e000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'cycle-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('2e000000-0000-4000-8000-000000000101', '2e000000-0000-4000-8000-000000000001', 'cycle-admin@test.local', 'Cy', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, status, admission_date) values
  ('2e000000-0000-4000-8000-000000000201', '2e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000011', 'Alf', 'Resident', 'active', public.pa_today() - 40),
  ('2e000000-0000-4000-8000-000000000202', '2e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000012', 'Pch', 'Resident', 'active', public.pa_today() - 40);

-- ---------------------------------------------------------------------------
-- Instantiation: the initial evaluation gets the initial cycle's grace
-- ---------------------------------------------------------------------------

select is(
  (select grace_period_days from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'medical_evaluation'),
  0,
  'an ALF admission produces an initial evaluation with no grace -- it used to get 15');

select is(
  (select grace_period_days from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000202' and item_type = 'medical_evaluation'),
  0,
  'and so does a PCH admission, which is unchanged');

select is(
  (select count(*)::integer from public.resident_compliance_items
   where resident_id in ('2e000000-0000-4000-8000-000000000201', '2e000000-0000-4000-8000-000000000202')
     and item_type = 'annual_medical_evaluation'),
  0,
  'no annual evaluation exists yet -- it is created by completing the initial one, not at admission');

-- ---------------------------------------------------------------------------
-- The status the whole split exists to get right
-- ---------------------------------------------------------------------------
--
-- Back-date the ALF initial evaluation to ten days overdue. Under the old shared row this resident
-- read `due_soon`, because the annual grace was covering the initial cycle.

update public.resident_compliance_items
set due_date = public.pa_today() - 10
where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'medical_evaluation';
select public.recalculate_resident_compliance_statuses();

select is(
  (select status from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'medical_evaluation'),
  'expired',
  'an ALF initial evaluation ten days past due is expired, not covered by an annual grace');

-- ---------------------------------------------------------------------------
-- Completion creates the annual cycle, from the annual row
-- ---------------------------------------------------------------------------

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- complete_resident_compliance_item() requires is_assigned_to_facility even for an org_admin,
-- and that resolves profile -> employee -> assignment.
insert into public.employees(id, organization_id, facility_id, profile_id, first_name, last_name, job_title) values
  ('2e000000-0000-4000-8000-000000000111', '2e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000011', '2e000000-0000-4000-8000-000000000101', 'Cy', 'Admin', 'Administrator');
insert into public.employee_facility_assignments(organization_id, employee_id, facility_id)
select '2e000000-0000-4000-8000-000000000001', '2e000000-0000-4000-8000-000000000111', f.id
from public.facilities f where f.organization_id = '2e000000-0000-4000-8000-000000000001'
on conflict do nothing;

-- The completion path requires the state-approved DHS form attached to this specific item.
insert into public.resident_documents(id, organization_id, facility_id, resident_id, storage_bucket, storage_path, file_name, file_type, is_state_form, state_form_source_label, compliance_item_id, uploaded_by_profile_id)
select '2e000000-0000-4000-8000-000000000301', '2e000000-0000-4000-8000-000000000001',
       ci.facility_id, ci.resident_id, 'resident-documents', 'cycle/dme.pdf', 'dme.pdf', 'application/pdf', true, 'PA DHS DME (Documentation of Medical Evaluation)', ci.id,
       '2e000000-0000-4000-8000-000000000101'
from public.resident_compliance_items ci
where ci.resident_id = '2e000000-0000-4000-8000-000000000201' and ci.item_type = 'medical_evaluation';

select pg_temp.act_as('2e000000-0000-4000-8000-000000000101');
select lives_ok($$select public.complete_resident_compliance_item(
  (select id from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'medical_evaluation'),
  '2e000000-0000-4000-8000-000000000301')$$,
  'the initial evaluation completes');
reset role;

select is(
  (select count(*)::integer from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'annual_medical_evaluation'),
  1,
  'and its successor is an annual_medical_evaluation, not another initial one');

select is(
  (select grace_period_days from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'annual_medical_evaluation'),
  15,
  'the successor takes the annual row''s 15-day grace, not the initial row''s zero');

select is(
  (select renewal_interval_days from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'annual_medical_evaluation'),
  365,
  'and renews yearly from its own row');

select is(
  (select due_date from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'annual_medical_evaluation'),
  public.pa_today() + 365,
  'due a year from completion, not a year from the missed original deadline');

-- The other half of the pair: an annual evaluation ten days past due IS still covered.
update public.resident_compliance_items
set due_date = public.pa_today() - 10
where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'annual_medical_evaluation';
select public.recalculate_resident_compliance_statuses();

select isnt(
  (select status from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'annual_medical_evaluation'),
  'expired',
  'an ALF annual evaluation ten days past due is still inside its 15-day grace');

-- Sixteen days is outside it. Without this the "grace" could be any number at all.
update public.resident_compliance_items
set due_date = public.pa_today() - 16
where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'annual_medical_evaluation';
select public.recalculate_resident_compliance_statuses();

select is(
  (select status from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'annual_medical_evaluation'),
  'expired',
  'and sixteen days past due is expired -- the grace is 15, not unbounded');

-- ---------------------------------------------------------------------------
-- The annual cycle renews as itself, and stays filed as a medical evaluation
-- ---------------------------------------------------------------------------

insert into public.resident_documents(id, organization_id, facility_id, resident_id, storage_bucket, storage_path, file_name, file_type, is_state_form, state_form_source_label, compliance_item_id, uploaded_by_profile_id)
select '2e000000-0000-4000-8000-000000000302', '2e000000-0000-4000-8000-000000000001',
       ci.facility_id, ci.resident_id, 'resident-documents', 'cycle/dme2.pdf', 'dme2.pdf', 'application/pdf', true, 'PA DHS DME (Documentation of Medical Evaluation)', ci.id,
       '2e000000-0000-4000-8000-000000000101'
from public.resident_compliance_items ci
where ci.resident_id = '2e000000-0000-4000-8000-000000000201' and ci.item_type = 'annual_medical_evaluation'
  and ci.completed_date is null;

select pg_temp.act_as('2e000000-0000-4000-8000-000000000101');
select lives_ok($$select public.complete_resident_compliance_item(
  (select id from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000201'
     and item_type = 'annual_medical_evaluation' and completed_date is null),
  '2e000000-0000-4000-8000-000000000302')$$,
  'the annual evaluation completes');
reset role;

select is(
  (select count(*)::integer from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'annual_medical_evaluation'),
  2,
  'and renews as another annual evaluation rather than reverting to an initial one');

select is(
  (select count(distinct grace_period_days)::integer from public.resident_compliance_items
   where resident_id = '2e000000-0000-4000-8000-000000000201' and item_type = 'annual_medical_evaluation'),
  1,
  'every annual evaluation in the chain carries the same grace');

-- Filed with the other medical evaluations, not swept into the reassessment bucket by the
-- trigger's `else` branch.
select is(
  (select ct.category from public.resident_compliance_items ci
   join public.dhs_citation_topics ct on ct.id = ci.citation_topic_id
   where ci.resident_id = '2e000000-0000-4000-8000-000000000201'
     and ci.item_type = 'annual_medical_evaluation' limit 1),
  'ALR Medical Evaluations',
  'an ALF annual evaluation is filed under medical evaluations, not reassessments');

select * from finish();
rollback;
