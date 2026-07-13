begin;
select plan(23);

select has_table('public', 'service_workload_profiles', 'service workload profiles are configurable by unit and shift');
select has_column('public', 'shift_assignments', 'eligibility_decision_id', 'assignments retain the decision that authorized them');
select has_function('public', 'preview_shift_assignment_candidates', array['uuid','date','uuid','uuid'], 'manager candidate preview is exposed');
select has_function('public', 'assign_employee_to_shift', array['uuid','uuid','date','uuid','uuid','text'], 'manual assignment is a governed command');
select has_function('public', 'get_schedule_service_workload', array['uuid'], 'service workload summary is exposed');
select ok(not has_table_privilege('authenticated', 'public.shift_assignments', 'INSERT'), 'authenticated clients cannot bypass assignment eligibility with a direct insert');
select ok(not has_function_privilege('anon', 'public.assign_employee_to_shift(uuid,uuid,date,uuid,uuid,text)', 'EXECUTE'), 'anonymous callers cannot assign shifts');

insert into public.organizations(id, name, slug) values
  ('38000000-0000-4000-8000-000000000001', 'Scheduling Org', 'scheduling-priority-8');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('38000000-0000-4000-8000-000000000011', '38000000-0000-4000-8000-000000000001', 'Scheduling Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
from (values
  ('38000000-0000-4000-8000-000000000101'::uuid, 'schedule-admin@test.local'),
  ('38000000-0000-4000-8000-000000000102'::uuid, 'schedule-worker@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('38000000-0000-4000-8000-000000000101', '38000000-0000-4000-8000-000000000001', 'schedule-admin@test.local', 'Schedule', 'Admin', 'org_admin', true),
  ('38000000-0000-4000-8000-000000000102', '38000000-0000-4000-8000-000000000001', 'schedule-worker@test.local', 'Schedule', 'Worker', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  first_name = excluded.first_name, last_name = excluded.last_name,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('38000000-0000-4000-8000-000000000101', '38000000-0000-4000-8000-000000000011');
insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status, administers_medications
) values (
  '38000000-0000-4000-8000-000000000201', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000011', '38000000-0000-4000-8000-000000000102',
  'P8-1', 'Schedule', 'Worker', 'schedule-worker@test.local', current_date-100,
  'Direct Care Worker', 'active', true
);
insert into public.facility_units(id, organization_id, facility_id, name) values (
  '38000000-0000-4000-8000-000000000301', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000011', 'Memory Care'
);
insert into public.shift_definitions(id, organization_id, facility_id, name, start_time, end_time) values
  ('38000000-0000-4000-8000-000000000311', '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000011', 'Day', '08:00', '16:00'),
  ('38000000-0000-4000-8000-000000000312', '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000011', 'Evening', '18:00', '22:00');
insert into public.schedules(id, organization_id, facility_id, title, period_start, period_end, created_by) values (
  '38000000-0000-4000-8000-000000000321', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000011', 'Qualification-aware schedule', current_date+1, current_date+7,
  '38000000-0000-4000-8000-000000000101'
);

insert into public.certification_definitions(
  id, organization_id, qualification_key, name, created_by
) values (
  '38000000-0000-4000-8000-000000000401', '38000000-0000-4000-8000-000000000001',
  'memory-care', 'Memory Care Qualified', '38000000-0000-4000-8000-000000000101'
);
insert into public.certification_definition_versions(
  id, certification_definition_id, version_number, lifecycle_state, criteria,
  criteria_checksum_sha256, effective_from, authored_by, published_by, published_at
) values (
  '38000000-0000-4000-8000-000000000402', '38000000-0000-4000-8000-000000000401', 1,
  'published', '{}', repeat('8',64), now()-interval '1 day', '38000000-0000-4000-8000-000000000101',
  '38000000-0000-4000-8000-000000000101', now()-interval '1 day'
);
insert into public.service_workload_profiles(
  id, organization_id, facility_id, unit_id, shift_definition_id, minimum_staff,
  minimum_medication_qualified_staff, required_qualification_keys, secured_unit_coverage_required,
  updated_by
) values (
  '38000000-0000-4000-8000-000000000501', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000011', '38000000-0000-4000-8000-000000000301',
  '38000000-0000-4000-8000-000000000311', 1, 1, array['memory-care'], true,
  '38000000-0000-4000-8000-000000000101'
);

create or replace function pg_temp.act_as(p_profile_id uuid, p_aal text default 'aal2')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', p_aal,
    'iat', extract(epoch from now())::bigint
  )::text, true);
  set local role authenticated;
end;
$$;

select pg_temp.act_as('38000000-0000-4000-8000-000000000101');
select is(
  public.preview_shift_assignment_candidates(
    '38000000-0000-4000-8000-000000000321', current_date+1,
    '38000000-0000-4000-8000-000000000311', '38000000-0000-4000-8000-000000000301'
  )->0->>'outcome',
  'blocked', 'candidate preview blocks a missing unit-specific qualification'
);
select ok(
  (public.preview_shift_assignment_candidates(
    '38000000-0000-4000-8000-000000000321', current_date+1,
    '38000000-0000-4000-8000-000000000311', '38000000-0000-4000-8000-000000000301'
  )->0->'hardBlocks') ? 'qualification:memory-care',
  'candidate preview explains the exact missing qualification'
);
select throws_ok(
  $$ select public.assign_employee_to_shift(
    '38000000-0000-4000-8000-000000000321', '38000000-0000-4000-8000-000000000201',
    current_date+1, '38000000-0000-4000-8000-000000000311', '38000000-0000-4000-8000-000000000301', null
  ) $$,
  '23514', null, 'the governed assignment command rejects the same hard block'
);

reset role;
insert into public.employee_qualifications(
  organization_id, facility_id, employee_id, certification_definition_id,
  certification_version_id, state, issued_at, effective_from, approved_by
) values (
  '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000011',
  '38000000-0000-4000-8000-000000000201', '38000000-0000-4000-8000-000000000401',
  '38000000-0000-4000-8000-000000000402', 'active', now(), now()-interval '1 day',
  '38000000-0000-4000-8000-000000000101'
);

select pg_temp.act_as('38000000-0000-4000-8000-000000000101');
create temporary table p8_assignment on commit drop as
select assignment.* from public.assign_employee_to_shift(
  '38000000-0000-4000-8000-000000000321', '38000000-0000-4000-8000-000000000201',
  current_date+1, '38000000-0000-4000-8000-000000000311', '38000000-0000-4000-8000-000000000301', 'Qualified assignment'
) assignment;
select ok((select eligibility_decision_id is not null from p8_assignment), 'accepted assignment links to its immutable eligibility decision');
select is((select outcome from public.schedule_eligibility_decisions where id=(select eligibility_decision_id from p8_assignment)), 'eligible', 'persisted decision records the accepted outcome');
reset role;
insert into public.schedule_eligibility_overrides(
  organization_id, facility_id, employee_id, block_code, scope_type, scope_id,
  reason, authority_reference, expires_at, granted_by
) values (
  '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000011',
  '38000000-0000-4000-8000-000000000201', 'schedule_conflict', 'shift',
  '38000000-0000-4000-8000-000000000311', 'Attempted overlap exception for enforcement test',
  'POLICY-SCHED-NO-OVERLAP', now()+interval '7 days', '38000000-0000-4000-8000-000000000101'
);
select pg_temp.act_as('38000000-0000-4000-8000-000000000101');
select is(
  public.evaluate_shift_assignment_eligibility(
    '38000000-0000-4000-8000-000000000201', '38000000-0000-4000-8000-000000000011',
    '38000000-0000-4000-8000-000000000301', '38000000-0000-4000-8000-000000000311',
    current_date+1+'08:00'::time, current_date+1+'16:00'::time, array[]::uuid[]
  )->>'outcome',
  'blocked', 'overlap remains a hard block even if an override row exists'
);
select is(
  public.evaluate_shift_assignment_eligibility(
    '38000000-0000-4000-8000-000000000201', '38000000-0000-4000-8000-000000000011',
    '38000000-0000-4000-8000-000000000301', '38000000-0000-4000-8000-000000000312',
    current_date+1+'18:00'::time, current_date+1+'22:00'::time, array[]::uuid[]
  )->>'outcome',
  'blocked', 'a second shift without minimum rest is blocked'
);
select ok(
  (public.evaluate_shift_assignment_eligibility(
    '38000000-0000-4000-8000-000000000201', '38000000-0000-4000-8000-000000000011',
    '38000000-0000-4000-8000-000000000301', '38000000-0000-4000-8000-000000000312',
    current_date+1+'18:00'::time, current_date+1+'22:00'::time, array[]::uuid[]
  )->'hardBlocks') ? 'insufficient_rest',
  'rest block is explained explicitly'
);

reset role;
insert into public.employee_availability_windows(
  organization_id, facility_id, employee_id, availability_type, starts_at, ends_at, created_by
) values (
  '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000011',
  '38000000-0000-4000-8000-000000000201', 'unavailable',
  current_date+3+'07:00'::time, current_date+3+'17:00'::time,
  '38000000-0000-4000-8000-000000000101'
);
select pg_temp.act_as('38000000-0000-4000-8000-000000000101');
select ok(
  (public.evaluate_shift_assignment_eligibility(
    '38000000-0000-4000-8000-000000000201', '38000000-0000-4000-8000-000000000011',
    '38000000-0000-4000-8000-000000000301', '38000000-0000-4000-8000-000000000311',
    current_date+3+'08:00'::time, current_date+3+'16:00'::time, array[]::uuid[]
  )->'hardBlocks') ? 'employee_unavailable',
  'confirmed unavailability is a hard block rather than a passive warning'
);
select lives_ok(
  $$ select public.create_schedule_eligibility_override(
    '38000000-0000-4000-8000-000000000201', '38000000-0000-4000-8000-000000000011',
    'employee_unavailable', 'shift', '38000000-0000-4000-8000-000000000311',
    'Employee confirmed a bounded availability exception', 'POLICY-SCHED-8', now()+interval '7 days'
  ) $$,
  'an AAL2 administrator can authorize a reasoned, expiring, shift-scoped override'
);
select is(
  public.evaluate_shift_assignment_eligibility(
    '38000000-0000-4000-8000-000000000201', '38000000-0000-4000-8000-000000000011',
    '38000000-0000-4000-8000-000000000301', '38000000-0000-4000-8000-000000000311',
    current_date+3+'08:00'::time, current_date+3+'16:00'::time, array[]::uuid[]
  )->>'outcome',
  'warning', 'a valid bounded override changes blocked to eligible with warning'
);
select is(
  (select count(*)::integer from public.schedule_eligibility_overrides
   where reason = 'Employee confirmed a bounded availability exception'
     and authority_reference = 'POLICY-SCHED-8'
     and scope_type = 'shift' and scope_id = '38000000-0000-4000-8000-000000000311'),
  1, 'override evidence retains reason, authority, scope, expiration, and approver'
);

reset role;
insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date, status, sdcu
) values (
  '38000000-0000-4000-8000-000000000601', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000011', 'Resident', 'One', current_date-10, 'active', true
);
select pg_temp.act_as('38000000-0000-4000-8000-000000000101');
select is((public.get_schedule_service_workload('38000000-0000-4000-8000-000000000321')->>'activeResidents')::integer, 1, 'service workload includes active resident census');
select is((public.get_schedule_service_workload('38000000-0000-4000-8000-000000000321')->>'securedUnitResidents')::integer, 1, 'service workload includes secured-unit coverage demand');
select is(jsonb_array_length(public.get_schedule_service_workload('38000000-0000-4000-8000-000000000321')->'coverageRows'), 7, 'service workload expands the configured unit-shift across the schedule period');
select is((public.get_schedule_service_workload('38000000-0000-4000-8000-000000000321')->>'coverageGapCount')::integer, 6, 'qualified coverage gaps are counted per configured unit-shift day');

select * from finish();
rollback;
