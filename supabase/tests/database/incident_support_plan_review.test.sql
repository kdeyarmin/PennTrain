begin;
select plan(9);

insert into public.organizations(id, name, slug, subscription_status) values
  ('ef100000-0000-4000-8000-000000000001', 'Review Org', 'support-plan-review-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('ef100000-0000-4000-8000-000000000011', 'ef100000-0000-4000-8000-000000000001', 'Review Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'ef100000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'spr-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('ef100000-0000-4000-8000-000000000101', 'ef100000-0000-4000-8000-000000000001', 'spr-admin@test.local', 'Sam', 'Review', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('ef100000-0000-4000-8000-000000000301', 'ef100000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000011', 'Rita', 'Resident', public.pa_today() - 90, 'active');

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

select pg_temp.act_as('ef100000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.create_incident_atomic(
    'ef100000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000011',
    'significant_injury', now() - interval '2 days', 'ef100000-0000-4000-8000-000000000301', null,
    'Hall', 'Resident slid from the chair. No injury.', 'major',
    '[]'::jsonb, '[]'::jsonb, 'spr-major-1')$$,
  'the major incident is filed'
);

select throws_ok(
  $$select public.record_incident_support_plan_review(
      (select id from public.incidents where idempotency_key = 'spr-major-1'),
      'too short')$$,
  '22023',
  'Record why the support plan needs no change',
  'a review without a reason is refused'
);

select throws_ok(
  $$select public.record_incident_support_plan_review(
      (select id from public.incidents where idempotency_key = 'spr-major-1'),
      'The current plan already covers this fall.')$$,
  '55000',
  'There is no support plan from before this incident to review; create one',
  'no change cannot be recorded when there is no earlier plan'
);

reset role;
insert into public.resident_support_plans(
  id, organization_id, facility_id, resident_id, version_number, state, created_at
) values (
  'ef100000-0000-4000-8000-000000000401', 'ef100000-0000-4000-8000-000000000001',
  'ef100000-0000-4000-8000-000000000011', 'ef100000-0000-4000-8000-000000000301',
  1, 'draft', now() - interval '30 days'
);

select pg_temp.act_as('ef100000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.record_incident_support_plan_review(
      (select id from public.incidents where idempotency_key = 'spr-major-1'),
      'The current plan already covers this fall.')$$,
  'a reviewed plan that needs no change is recorded against the incident'
);

select is(
  (select public.get_incident_follow_through(
      (select id from public.incidents where idempotency_key = 'spr-major-1')
    ) ->> 'support_plan_reviewed_no_change'),
  'true',
  'follow-through treats the signed review as the support-plan stage'
);
select is(
  (select public.get_incident_follow_through(
      (select id from public.incidents where idempotency_key = 'spr-major-1')
    ) ->> 'support_plan_revised_after_incident'),
  'false',
  'the same review is not mistaken for a new support plan'
);

select throws_ok(
  $$select public.record_incident_support_plan_review(
      (select id from public.incidents where idempotency_key = 'spr-major-1'),
      'A second note would rewrite the first.')$$,
  '55000',
  'A support-plan review is already recorded for this incident',
  'the review is not rewritten'
);

select pg_temp.act_as('ef100000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.create_incident_atomic(
    'ef100000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000011',
    'significant_injury', now() - interval '1 hour', 'ef100000-0000-4000-8000-000000000301', null,
    'Hall', 'A later fall, after a new plan.', 'major',
    '[]'::jsonb, '[]'::jsonb, 'spr-major-2')$$,
  'a second major incident is filed after the first review'
);
reset role;
insert into public.resident_support_plans(
  id, organization_id, facility_id, resident_id, version_number, state, created_at
) values (
  'ef100000-0000-4000-8000-000000000402', 'ef100000-0000-4000-8000-000000000001',
  'ef100000-0000-4000-8000-000000000011', 'ef100000-0000-4000-8000-000000000301',
  2, 'draft', now()
);
select pg_temp.act_as('ef100000-0000-4000-8000-000000000101');
select throws_ok(
  $$select public.record_incident_support_plan_review(
      (select id from public.incidents where idempotency_key = 'spr-major-2'),
      'This would deny a plan that was already rewritten.')$$,
  '55000',
  'A support plan was already created after this incident; record the revision instead of no change',
  'a plan created after the incident is a revision, not a no-change review'
);

select * from finish();
rollback;
