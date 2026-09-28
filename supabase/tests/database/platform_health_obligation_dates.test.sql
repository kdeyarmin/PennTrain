-- Platform health counted a clearance from the document date, a closed assignment
-- from its historical due date, and whichever training row won an unordered tie.
begin;
select plan(6);

insert into public.organizations(id, name, slug, subscription_status) values
  ('e2820000-0000-4000-8000-000000000001', 'Platform health org', 'platform-health-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('e2820000-0000-4000-8000-000000000011', 'e2820000-0000-4000-8000-000000000001', 'Health Home', 'NH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000', 'e2820000-0000-4000-8000-000000000301',
  'authenticated', 'authenticated', 'platform-health@test.local', 'x', now(),
  '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('e2820000-0000-4000-8000-000000000301', 'e2820000-0000-4000-8000-000000000001',
   'platform-health@test.local', 'Platform', 'Health', 'platform_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, role = excluded.role, is_active = true;

insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title, status, hire_date
) values
  ('e2820000-0000-4000-8000-000000000101', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'Clearance', 'Staff', 'Aide', 'active', public.pa_today() - 400),
  ('e2820000-0000-4000-8000-000000000102', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'Assigned', 'Staff', 'Aide', 'active', public.pa_today() - 400),
  ('e2820000-0000-4000-8000-000000000103', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'Canceled', 'Staff', 'Aide', 'active', public.pa_today() - 400),
  ('e2820000-0000-4000-8000-000000000104', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'Paused', 'Staff', 'Aide', 'active', public.pa_today() - 400),
  ('e2820000-0000-4000-8000-000000000105', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'Training', 'Staff', 'Aide', 'active', public.pa_today() - 400);

insert into public.courses(id, organization_id, title, status) values
  ('e2820000-0000-4000-8000-000000000401', 'e2820000-0000-4000-8000-000000000001', 'Health course', 'draft');
insert into public.course_versions(id, course_id, organization_id, version_number, title) values
  ('e2820000-0000-4000-8000-000000000411', 'e2820000-0000-4000-8000-000000000401',
   'e2820000-0000-4000-8000-000000000001', 1, 'Health course');
insert into public.course_blocks(course_version_id, organization_id, block_type, sort_order, title, body) values
  ('e2820000-0000-4000-8000-000000000411', 'e2820000-0000-4000-8000-000000000001',
   'text', 0, 'Lesson', '{"content":"Disposable lesson"}');
update public.course_versions set status = 'published', published_at = now()
where id = 'e2820000-0000-4000-8000-000000000411';
update public.courses set status = 'published', current_version_id = 'e2820000-0000-4000-8000-000000000411'
where id = 'e2820000-0000-4000-8000-000000000401';
select set_config('app.privileged_write', 'off', true);

create temp table health_before (health jsonb);
grant all on table health_before to authenticated;

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text,
    true
  );
  set local role authenticated;
end;
$$;

select pg_temp.act_as('e2820000-0000-4000-8000-000000000301');
insert into health_before select public.get_platform_health();

reset role;
select set_config('app.privileged_write', 'on', true);
-- NH so the clearance trigger does not rewrite an explicit policy date.
insert into public.employee_credentials(
  id, organization_id, facility_id, employee_id, credential_type, credential_label,
  status, issue_date, expiration_date, policy_renewal_due_date
) values
  ('e2820000-0000-4000-8000-000000000201', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'e2820000-0000-4000-8000-000000000101',
   'other', 'Policy already past', 'compliant', public.pa_today() - 30,
   public.pa_today() + 400, public.pa_today() - 1),
  ('e2820000-0000-4000-8000-000000000202', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'e2820000-0000-4000-8000-000000000101',
   'immunization', 'Policy inside the window', 'compliant', public.pa_today() - 30,
   public.pa_today() + 400, public.pa_today() + 10),
  ('e2820000-0000-4000-8000-000000000203', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'e2820000-0000-4000-8000-000000000101',
   'i9_employment_eligibility', 'Second policy inside the window', 'compliant', public.pa_today() - 30,
   public.pa_today() + 400, public.pa_today() + 12),
  ('e2820000-0000-4000-8000-000000000204', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'e2820000-0000-4000-8000-000000000101',
   'rn_license', 'Document still inside the window', 'due_soon', public.pa_today() - 30,
   public.pa_today() + 10, public.pa_today() - 5),
  ('e2820000-0000-4000-8000-000000000205', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'e2820000-0000-4000-8000-000000000101',
   'lpn_license', 'Waived document', 'not_applicable', public.pa_today() - 400,
   public.pa_today() - 10, null);

insert into public.course_assignments(
  id, organization_id, facility_id, employee_id, course_id, course_version_id,
  assigned_by, due_date, status
) values
  ('e2820000-0000-4000-8000-000000000501', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'e2820000-0000-4000-8000-000000000102',
   'e2820000-0000-4000-8000-000000000401', 'e2820000-0000-4000-8000-000000000411',
   'e2820000-0000-4000-8000-000000000301', public.pa_today() - 1, 'assigned'),
  ('e2820000-0000-4000-8000-000000000502', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'e2820000-0000-4000-8000-000000000103',
   'e2820000-0000-4000-8000-000000000401', 'e2820000-0000-4000-8000-000000000411',
   'e2820000-0000-4000-8000-000000000301', public.pa_today() - 1, 'canceled'),
  ('e2820000-0000-4000-8000-000000000503', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'e2820000-0000-4000-8000-000000000104',
   'e2820000-0000-4000-8000-000000000401', 'e2820000-0000-4000-8000-000000000411',
   'e2820000-0000-4000-8000-000000000301', public.pa_today() - 1, 'paused');
select set_config('app.privileged_write', 'off', true);

insert into public.training_types(
  id, organization_id, code, name, category, state, applies_to_facility_type,
  renewal_interval_days, warning_days_default, is_active
) values (
  'e2820000-0000-4000-8000-000000000031', 'e2820000-0000-4000-8000-000000000001',
  'HEALTH-TIE', 'Tied annual topic', 'annual', 'PA', 'BOTH', 365, 30, true
);
-- The smaller id is the missing placeholder. A date-only tie must still count the real row.
insert into public.employee_training_records(
  id, organization_id, facility_id, employee_id, training_type_id,
  completion_date, due_date, status, created_at
) values
  ('e2820000-0000-4000-8000-000000000041', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'e2820000-0000-4000-8000-000000000105',
   'e2820000-0000-4000-8000-000000000031',
   null, public.pa_today() - 1, 'missing', timestamptz '2026-03-01 15:00:00+00'),
  ('e2820000-0000-4000-8000-000000000042', 'e2820000-0000-4000-8000-000000000001',
   'e2820000-0000-4000-8000-000000000011', 'e2820000-0000-4000-8000-000000000105',
   'e2820000-0000-4000-8000-000000000031',
   null, public.pa_today() - 1, 'expired', timestamptz '2026-03-01 15:00:00+00');

select pg_temp.act_as('e2820000-0000-4000-8000-000000000301');

select is(
  (public.get_platform_health()->>'expiredCredentials')::int
    - (select (health->>'expiredCredentials')::int from health_before),
  2,
  'a past facility renewal counts as expired even when the document date is later'
);
select is(
  (public.get_platform_health()->>'expiringCredentialsWithin30Days')::int
    - (select (health->>'expiringCredentialsWithin30Days')::int from health_before),
  2,
  'the 30-day tile follows the facility renewal, not a later document date'
);
select is(
  (public.get_platform_health()->>'incompleteCourseAssignments')::int
    - (select (health->>'incompleteCourseAssignments')::int from health_before),
  1,
  'a canceled or paused assignment is not incomplete work'
);
select is(
  (public.get_platform_health()->>'overdueCourseAssignments')::int
    - (select (health->>'overdueCourseAssignments')::int from health_before),
  1,
  'a canceled or paused assignment does not stay overdue on its old due date'
);
select is(
  (public.get_platform_health()->>'overdueTrainingRecords')::int
    - (select (health->>'overdueTrainingRecords')::int from health_before),
  1,
  'a missing placeholder that ties every date is not the overdue training record'
);

select ok(
  pg_get_functiondef('public.get_platform_health()'::regprocedure)
    like '%least(expiration_date, policy_renewal_due_date)%',
  'the credential tiles name the governing date'
);

select * from finish();
rollback;
