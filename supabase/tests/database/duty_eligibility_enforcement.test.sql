begin;
select plan(21);

select has_table('public', 'duty_eligibility_rules', 'the duty rule table exists');
select has_table('public', 'duty_eligibility_overrides', 'the duty override table exists');
select has_function('public', 'evaluate_duty_eligibility', array['uuid', 'text', 'uuid', 'timestamptz'],
  'the duty evaluation RPC exists');

-- The shipped defaults must not demand a qualification: doing so would block every finalize in any
-- organization that has not populated employee_qualifications, which is most of them on day one.
select is(
  (select count(*)::int from public.duty_eligibility_rules
   where organization_id is null and cardinality(accepted_qualification_keys) > 0),
  0,
  'no shipped default rule demands a qualification'
);

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('b5000000-0000-4000-8000-000000000001', 'Duty Org', 'duty-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('b5000000-0000-4000-8000-000000000011', 'b5000000-0000-4000-8000-000000000001', 'Duty Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'b5000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'b-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'b5000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'b-aide@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'b5000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'b-inactive@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('b5000000-0000-4000-8000-000000000101', 'b5000000-0000-4000-8000-000000000001', 'b-admin@test.local', 'Bree', 'Admin', 'org_admin', true),
  ('b5000000-0000-4000-8000-000000000102', 'b5000000-0000-4000-8000-000000000001', 'b-aide@test.local', 'Blake', 'Aide', 'employee', true),
  ('b5000000-0000-4000-8000-000000000103', 'b5000000-0000-4000-8000-000000000001', 'b-inactive@test.local', 'Bo', 'Former', 'facility_manager', false)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('b5000000-0000-4000-8000-000000000301', 'b5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000011', 'Bailey', 'Resident', current_date - 20, 'active');

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end $$;

-- Evaluation ---------------------------------------------------------------------------
select is(
  public.evaluate_duty_eligibility(
    'b5000000-0000-4000-8000-000000000101', 'resident_assessor',
    'b5000000-0000-4000-8000-000000000011') ->> 'outcome',
  'eligible',
  'an org admin may serve as assessor under the shipped rule'
);

select is(
  public.evaluate_duty_eligibility(
    'b5000000-0000-4000-8000-000000000102', 'resident_assessor',
    'b5000000-0000-4000-8000-000000000011') ->> 'outcome',
  'blocked',
  'an employee may not'
);

select is(
  public.evaluate_duty_eligibility(
    'b5000000-0000-4000-8000-000000000103', 'resident_assessor',
    'b5000000-0000-4000-8000-000000000011') ->> 'outcome',
  'blocked',
  'and neither may a deactivated manager'
);
select ok(
  public.evaluate_duty_eligibility(
    'b5000000-0000-4000-8000-000000000103', 'resident_assessor',
    'b5000000-0000-4000-8000-000000000011') -> 'blocks' @> '["profile_inactive"]'::jsonb,
  'the reason names the deactivation rather than saying only "not permitted"'
);

-- An unknown duty reports that no rule is configured. Silently permitting it would make a typo in a
-- duty key look like a passed check.
select is(
  public.evaluate_duty_eligibility(
    'b5000000-0000-4000-8000-000000000101', 'duty_that_does_not_exist',
    'b5000000-0000-4000-8000-000000000011') ->> 'outcome',
  'warning',
  'an unconfigured duty warns rather than silently passing'
);

-- Qualification checking: turned on by an organization rule, exactly as the comment describes.
insert into public.duty_eligibility_rules
  (organization_id, duty_key, label, description, accepted_qualification_keys, accepted_roles, enforcement)
values
  ('b5000000-0000-4000-8000-000000000001', 'resident_assessor', 'Resident assessor',
   'Signs a resident assessment review as the assessor.',
   array['registered_nurse'], array['org_admin', 'facility_manager'], 'block');

select is(
  public.evaluate_duty_eligibility(
    'b5000000-0000-4000-8000-000000000101', 'resident_assessor',
    'b5000000-0000-4000-8000-000000000011') ->> 'outcome',
  'warning',
  'with no employee record at the facility, the qualification cannot be checked'
);
select ok(
  public.evaluate_duty_eligibility(
    'b5000000-0000-4000-8000-000000000101', 'resident_assessor',
    'b5000000-0000-4000-8000-000000000011') -> 'warnings'
    @> '["no_employee_record_for_qualification_check"]'::jsonb,
  'and that is reported rather than treated as a pass'
);

-- With an employee record but no qualification, the block is real.
insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status
) values (
  'b5000000-0000-4000-8000-000000000201', 'b5000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000011', 'b5000000-0000-4000-8000-000000000101',
  'Bree', 'Admin', 'b-admin@test.local', 'Administrator', current_date - 200, 'active'
);
select is(
  public.evaluate_duty_eligibility(
    'b5000000-0000-4000-8000-000000000101', 'resident_assessor',
    'b5000000-0000-4000-8000-000000000011') ->> 'outcome',
  'blocked',
  'an employee without the required qualification is blocked'
);

-- Overrides ------------------------------------------------------------------------------
select pg_temp.act_as('b5000000-0000-4000-8000-000000000101');
select throws_ok($$select public.grant_duty_eligibility_override(
  'b5000000-0000-4000-8000-000000000101', 'resident_assessor',
  'b5000000-0000-4000-8000-000000000011', 'Covering while the RN credential is renewed.',
  now() + interval '30 days')$$,
  '42501',
  null,
  'an override cannot be granted to yourself');

select throws_ok($$select public.grant_duty_eligibility_override(
  'b5000000-0000-4000-8000-000000000102', 'resident_assessor',
  'b5000000-0000-4000-8000-000000000011', 'ok',
  now() + interval '30 days')$$,
  '22023',
  null,
  'an override needs a written reason');

select throws_ok($$select public.grant_duty_eligibility_override(
  'b5000000-0000-4000-8000-000000000102', 'resident_assessor',
  'b5000000-0000-4000-8000-000000000011', 'Covering while the RN credential is renewed.',
  now() + interval '400 days')$$,
  '22023',
  null,
  'and it cannot run longer than a year');

select lives_ok($$select public.grant_duty_eligibility_override(
  'b5000000-0000-4000-8000-000000000102', 'resident_assessor',
  'b5000000-0000-4000-8000-000000000011', 'Covering while the RN credential is renewed.',
  now() + interval '30 days')$$,
  'an org admin grants a scoped, reasoned, expiring override');

reset role;
select is(
  public.evaluate_duty_eligibility(
    'b5000000-0000-4000-8000-000000000102', 'resident_assessor',
    'b5000000-0000-4000-8000-000000000011') ->> 'outcome',
  'warning',
  'the override clears the block but leaves the reason visible as a warning'
);
select ok(
  public.evaluate_duty_eligibility(
    'b5000000-0000-4000-8000-000000000102', 'resident_assessor',
    'b5000000-0000-4000-8000-000000000011') -> 'warnings' @> '["override_applied"]'::jsonb,
  'and says plainly that an override was applied'
);

-- Only an org admin may grant one. A facility manager who could exempt themselves is not a control.
select pg_temp.act_as('b5000000-0000-4000-8000-000000000103');
select throws_ok($$select public.grant_duty_eligibility_override(
  'b5000000-0000-4000-8000-000000000102', 'resident_assessor',
  'b5000000-0000-4000-8000-000000000011', 'Trying to grant without being an org admin.',
  now() + interval '30 days')$$,
  '42501',
  null,
  'a non org-admin cannot grant an override');

-- Negative authorization: the exit gate requires proof the DIRECT call is refused, not that a
-- button is hidden.
--
-- The caller here is the ORG ADMIN, deliberately. An employee would be turned away by the
-- pre-existing care-manager gate, which would make this test pass without exercising the new duty
-- check at all. The org admin clears every prior gate and is stopped only by the organization's
-- qualification rule -- so a failure here can only mean the duty check did not fire.
--
-- The draft is created as the table owner: resident_assessment_reviews grants only SELECT to
-- authenticated, so every write goes through an RPC.
reset role;
insert into public.resident_assessment_reviews(
  organization_id, facility_id, resident_id, template_key, template_version, answers, status
) values (
  'b5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000011',
  'b5000000-0000-4000-8000-000000000301', 'mobility_fall_review', 1, '{}'::jsonb, 'draft'
);

select pg_temp.act_as('b5000000-0000-4000-8000-000000000101');
select throws_ok($$select public.finalize_resident_assessment_review(
  (select id from public.resident_assessment_reviews
   where resident_id = 'b5000000-0000-4000-8000-000000000301'),
  'Bree Admin')$$,
  '42501',
  null,
  'an unqualified assessor calling the finalize RPC directly is refused, not merely hidden from');

reset role;
select is(
  (select status from public.resident_assessment_reviews
   where resident_id = 'b5000000-0000-4000-8000-000000000301'),
  'draft',
  'and the review is still a draft afterwards'
);

select * from finish();
rollback;
