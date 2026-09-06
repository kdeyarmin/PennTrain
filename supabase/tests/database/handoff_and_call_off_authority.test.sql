-- pgTAP coverage for 20260906280000: who may acknowledge a shift handoff, and who decides an
-- absence.
--
-- Both defects were invisible to every gate in the repo because both are authorization written in
-- plpgsql: `acknowledge_shift_report_entry` admitted anyone in the tenant (an auditor included) to
-- a clinical record, and `record_shift_call_off` inserted its absence row with a literal
-- 'approved', so employee self-service approved its own time off and the manager queue -- which
-- reads `status = 'pending'` -- never showed the one row that needed a decision.
--
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(11);

insert into public.organizations(id, name, slug) values
  ('4b000000-0000-4000-8000-000000000001', 'Handoff Org', 'handoff-authority-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('4b000000-0000-4000-8000-000000000011', '4b000000-0000-4000-8000-000000000001', 'Handoff Home', 'PCH');

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
  ('4b000000-0000-4000-8000-000000000101'::uuid, 'handoff-admin@test.local'),
  ('4b000000-0000-4000-8000-000000000102'::uuid, 'handoff-auditor@test.local'),
  ('4b000000-0000-4000-8000-000000000103'::uuid, 'handoff-aide@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('4b000000-0000-4000-8000-000000000101', '4b000000-0000-4000-8000-000000000001', 'handoff-admin@test.local', 'Handoff', 'Admin', 'org_admin', true),
  ('4b000000-0000-4000-8000-000000000102', '4b000000-0000-4000-8000-000000000001', 'handoff-auditor@test.local', 'Handoff', 'Auditor', 'auditor', true),
  ('4b000000-0000-4000-8000-000000000103', '4b000000-0000-4000-8000-000000000001', 'handoff-aide@test.local', 'Handoff', 'Aide', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  first_name = excluded.first_name, last_name = excluded.last_name,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('4b000000-0000-4000-8000-000000000101', '4b000000-0000-4000-8000-000000000011'),
  ('4b000000-0000-4000-8000-000000000102', '4b000000-0000-4000-8000-000000000011');

insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status
) values (
  '4b000000-0000-4000-8000-000000000201', '4b000000-0000-4000-8000-000000000001',
  '4b000000-0000-4000-8000-000000000011', '4b000000-0000-4000-8000-000000000103',
  'HO-1', 'Handoff', 'Aide', 'handoff-aide@test.local', public.pa_today()-200, 'Direct Care Worker', 'active'
);

-- The employees insert trigger already writes the primary employee_facility_assignments row; this
-- is the predicate is_own_employee_assigned_to_facility reads, so assert it rather than assume it.
insert into public.employee_facility_assignments(employee_id, facility_id, is_primary)
values ('4b000000-0000-4000-8000-000000000201', '4b000000-0000-4000-8000-000000000011', true)
on conflict do nothing;

insert into public.shift_report_entries(
  id, organization_id, facility_id, category, priority, shift_period_start, shift_period_end,
  narrative, author_profile_id, requires_acknowledgement, status, idempotency_key
) values (
  '4b000000-0000-4000-8000-000000000301', '4b000000-0000-4000-8000-000000000001',
  '4b000000-0000-4000-8000-000000000011', 'missed_refused_service', 'high',
  now() - interval '8 hours', now(), 'Resident in 204 refused the evening dose; RN notified.',
  '4b000000-0000-4000-8000-000000000101', true, 'open', 'handoff-authority-1'
);

insert into public.schedules(id, organization_id, facility_id, title, period_start, period_end, created_by, status) values (
  '4b000000-0000-4000-8000-000000000321', '4b000000-0000-4000-8000-000000000001',
  '4b000000-0000-4000-8000-000000000011', 'Handoff schedule', public.pa_today(), public.pa_today()+7,
  '4b000000-0000-4000-8000-000000000101', 'published'
);

insert into public.shift_assignments(
  id, organization_id, facility_id, schedule_id, employee_id, shift_date, start_time, end_time, status
) values
  ('4b000000-0000-4000-8000-000000000401', '4b000000-0000-4000-8000-000000000001',
   '4b000000-0000-4000-8000-000000000011', '4b000000-0000-4000-8000-000000000321',
   '4b000000-0000-4000-8000-000000000201', public.pa_today()+2, '07:00', '15:00', 'scheduled'),
  ('4b000000-0000-4000-8000-000000000402', '4b000000-0000-4000-8000-000000000001',
   '4b000000-0000-4000-8000-000000000011', '4b000000-0000-4000-8000-000000000321',
   '4b000000-0000-4000-8000-000000000201', public.pa_today()+4, '07:00', '15:00', 'scheduled');

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

-- ---------------------------------------------------------------------------------------
-- K3. Acknowledging a handoff is a clinical act, not a read.
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as('4b000000-0000-4000-8000-000000000102');

select throws_ok(
  $$ select public.acknowledge_shift_report_entry('4b000000-0000-4000-8000-000000000301') $$,
  '42501',
  null,
  'an auditor in the same organization can no longer acknowledge a handoff entry'
);
select is(
  (select count(*)::int from public.shift_report_acknowledgements
   where shift_report_entry_id = '4b000000-0000-4000-8000-000000000301'),
  0,
  'and nothing was written on their behalf'
);

select pg_temp.act_as('4b000000-0000-4000-8000-000000000103');
select lives_ok(
  $$ select public.acknowledge_shift_report_entry('4b000000-0000-4000-8000-000000000301') $$,
  'the aide whose facility assignments include this building still can'
);
select is(
  (select profile_id from public.shift_report_acknowledgements
   where shift_report_entry_id = '4b000000-0000-4000-8000-000000000301'),
  '4b000000-0000-4000-8000-000000000103'::uuid,
  'and the acknowledgement is recorded against them'
);

select pg_temp.act_as('4b000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.acknowledge_shift_report_entry('4b000000-0000-4000-8000-000000000301') $$,
  'an org_admin running the building still can'
);

-- ---------------------------------------------------------------------------------------
-- K2. A self-service call-off files a request; a manager's call-off files a decision.
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as('4b000000-0000-4000-8000-000000000103');

select lives_ok(
  $$ select public.record_shift_call_off(
       '4b000000-0000-4000-8000-000000000401', 'illness', 'Fever since last night') $$,
  'an employee can still call off their own published, scheduled shift'
);
select is(
  (select status from public.workforce_time_off_requests
   where shift_assignment_id = '4b000000-0000-4000-8000-000000000401'),
  'pending',
  'and the absence it files is pending a manager decision, not self-approved'
);
select is(
  (select status from public.shift_assignments where id = '4b000000-0000-4000-8000-000000000401'),
  'called_off',
  'while the operational half is unchanged -- the shift is still called_off'
);
select is(
  (select count(*)::int from public.open_shift_opportunities
   where schedule_id = '4b000000-0000-4000-8000-000000000321'
     and shift_date = public.pa_today()+2),
  1,
  'and the open-shift opportunity is still posted for the uncovered shift'
);

select pg_temp.act_as('4b000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.record_shift_call_off(
       '4b000000-0000-4000-8000-000000000402', 'family_emergency', 'Called in to the office by phone') $$,
  'a manager can record a call-off on the employee''s behalf'
);
select is(
  (select status from public.workforce_time_off_requests
   where shift_assignment_id = '4b000000-0000-4000-8000-000000000402'),
  'approved',
  'and that one stays approved, because the manager recording it IS the decision'
);

select * from finish();
rollback;
