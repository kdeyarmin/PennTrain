-- pgTAP coverage for 20260905010000: approving a shift swap actually trades the two shifts.
--
-- Nothing called `decide_shift_swap` from a test before this file, which is why it could defer a
-- constraint dropped on 2026-07-31 and fail every approval with 42704 for five weeks without a
-- single gate noticing. The approval case here is the one that was broken; the same-day overlap
-- case is the one that a naive fix (delete the line, stop) would have left broken with a different
-- error, because the row-level overlap trigger sees the swap's intermediate state.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(12);

insert into public.organizations(id, name, slug) values
  ('3a000000-0000-4000-8000-000000000001', 'Swap Org', 'swap-approval-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('3a000000-0000-4000-8000-000000000011', '3a000000-0000-4000-8000-000000000001', 'Swap Facility', 'PCH');

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
  ('3a000000-0000-4000-8000-000000000101'::uuid, 'swap-admin@test.local'),
  ('3a000000-0000-4000-8000-000000000102'::uuid, 'swap-worker-a@test.local'),
  ('3a000000-0000-4000-8000-000000000103'::uuid, 'swap-worker-b@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('3a000000-0000-4000-8000-000000000101', '3a000000-0000-4000-8000-000000000001', 'swap-admin@test.local', 'Swap', 'Admin', 'org_admin', true),
  ('3a000000-0000-4000-8000-000000000102', '3a000000-0000-4000-8000-000000000001', 'swap-worker-a@test.local', 'Swap', 'WorkerA', 'employee', true),
  ('3a000000-0000-4000-8000-000000000103', '3a000000-0000-4000-8000-000000000001', 'swap-worker-b@test.local', 'Swap', 'WorkerB', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  first_name = excluded.first_name, last_name = excluded.last_name,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('3a000000-0000-4000-8000-000000000101', '3a000000-0000-4000-8000-000000000011');

insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status
) values
  ('3a000000-0000-4000-8000-000000000201', '3a000000-0000-4000-8000-000000000001',
   '3a000000-0000-4000-8000-000000000011', '3a000000-0000-4000-8000-000000000102',
   'SW-A', 'Swap', 'WorkerA', 'swap-worker-a@test.local', public.pa_today()-100, 'Direct Care Worker', 'active'),
  ('3a000000-0000-4000-8000-000000000202', '3a000000-0000-4000-8000-000000000001',
   '3a000000-0000-4000-8000-000000000011', '3a000000-0000-4000-8000-000000000103',
   'SW-B', 'Swap', 'WorkerB', 'swap-worker-b@test.local', public.pa_today()-100, 'Direct Care Worker', 'active');

insert into public.schedules(id, organization_id, facility_id, title, period_start, period_end, created_by, status) values (
  '3a000000-0000-4000-8000-000000000321', '3a000000-0000-4000-8000-000000000001',
  '3a000000-0000-4000-8000-000000000011', 'Swap schedule', public.pa_today()+1, public.pa_today()+7,
  '3a000000-0000-4000-8000-000000000101', 'published'
);

-- Deliberately the same day and OVERLAPPING: this is the everyday swap (two aides trading a day
-- shift) and the exact shape that makes the row trigger see a conflict mid-statement.
insert into public.shift_assignments(
  id, organization_id, facility_id, schedule_id, employee_id, shift_date, start_time, end_time, status
) values
  ('3a000000-0000-4000-8000-000000000401', '3a000000-0000-4000-8000-000000000001',
   '3a000000-0000-4000-8000-000000000011', '3a000000-0000-4000-8000-000000000321',
   '3a000000-0000-4000-8000-000000000201', public.pa_today()+2, '08:00', '16:00', 'scheduled'),
  ('3a000000-0000-4000-8000-000000000402', '3a000000-0000-4000-8000-000000000001',
   '3a000000-0000-4000-8000-000000000011', '3a000000-0000-4000-8000-000000000321',
   '3a000000-0000-4000-8000-000000000202', public.pa_today()+2, '12:00', '20:00', 'scheduled');

insert into public.shift_swap_requests(
  id, organization_id, facility_id, requester_employee_id, requester_assignment_id,
  target_employee_id, target_assignment_id, status, reason, expires_at
) values (
  '3a000000-0000-4000-8000-000000000501', '3a000000-0000-4000-8000-000000000001',
  '3a000000-0000-4000-8000-000000000011',
  '3a000000-0000-4000-8000-000000000201', '3a000000-0000-4000-8000-000000000401',
  '3a000000-0000-4000-8000-000000000202', '3a000000-0000-4000-8000-000000000402',
  'pending', 'Family commitment that afternoon', now() + interval '3 days'
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

-- ---------------------------------------------------------------------------------------
-- The constraint the old function deferred is gone. That is the whole defect.
-- ---------------------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_constraint where conname = 'shift_assignments_employee_id_shift_date_key'),
  0,
  'the unique constraint the old approval deferred no longer exists (dropped by 20260731053000)'
);

select throws_ok(
  $$ set constraints shift_assignments_employee_id_shift_date_key deferred $$,
  '42704',
  null,
  'deferring it raises 42704, which is what every approval used to hit'
);

-- ---------------------------------------------------------------------------------------
-- Approval trades the two shifts.
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as('3a000000-0000-4000-8000-000000000101');

select lives_ok(
  $$ select public.decide_shift_swap(
       '3a000000-0000-4000-8000-000000000501', true, 'Approved for coverage balance') $$,
  'an overlapping same-day swap is approved without raising'
);

select is(
  (select employee_id from public.shift_assignments where id = '3a000000-0000-4000-8000-000000000401'),
  '3a000000-0000-4000-8000-000000000202'::uuid,
  'the requester''s shift now belongs to the target employee'
);
select is(
  (select employee_id from public.shift_assignments where id = '3a000000-0000-4000-8000-000000000402'),
  '3a000000-0000-4000-8000-000000000201'::uuid,
  'the target''s shift now belongs to the requester'
);
select is(
  (select status from public.shift_swap_requests where id = '3a000000-0000-4000-8000-000000000501'),
  'approved',
  'the swap request is recorded as approved'
);
select ok(
  (select decided_by from public.shift_swap_requests where id = '3a000000-0000-4000-8000-000000000501')
    = '3a000000-0000-4000-8000-000000000101'::uuid
  and (select decision_reason from public.shift_swap_requests where id = '3a000000-0000-4000-8000-000000000501')
    = 'Approved for coverage balance',
  'the decision records who approved it and why'
);

-- ---------------------------------------------------------------------------------------
-- The exemption is data-shaped and self-closing: it holds only while the swap is mid-write.
-- ---------------------------------------------------------------------------------------
reset role;

select ok(
  not app_private.shift_assignment_is_in_flight_swap(
    '3a000000-0000-4000-8000-000000000401', 'swap'),
  'once the swap is approved its rows are no longer exempt -- the guards are live again'
);

-- The rows still carry source = 'swap' after the approval, so the exemption cannot rest on that
-- alone: it also requires a still-pending request, decided by this caller, carrying both decision
-- ids. Nothing a client can set on an assignment turns the guards off.
select ok(
  not app_private.shift_assignment_is_in_flight_swap(
    '3a000000-0000-4000-8000-000000000402', 'swap')
  and not app_private.shift_assignment_is_in_flight_swap(
    '3a000000-0000-4000-8000-000000000401', 'manual'),
  'the exemption cannot be claimed by setting source alone'
);

-- Employee A now holds 12:00-20:00. Handing them the 08:00-16:00 shift as well is a genuine
-- double-booking, and outside an in-flight swap it is still refused.
select throws_ok(
  $$ update public.shift_assignments
     set employee_id = '3a000000-0000-4000-8000-000000000201'
     where id = '3a000000-0000-4000-8000-000000000401' $$,
  '23514',
  null,
  'a genuine double-booking is still refused after the swap'
);

-- ---------------------------------------------------------------------------------------
-- Rejection still works and moves no shift.
-- ---------------------------------------------------------------------------------------
insert into public.shift_swap_requests(
  id, organization_id, facility_id, requester_employee_id, requester_assignment_id,
  target_employee_id, target_assignment_id, status, reason, expires_at
) values (
  '3a000000-0000-4000-8000-000000000502', '3a000000-0000-4000-8000-000000000001',
  '3a000000-0000-4000-8000-000000000011',
  '3a000000-0000-4000-8000-000000000202', '3a000000-0000-4000-8000-000000000401',
  '3a000000-0000-4000-8000-000000000201', '3a000000-0000-4000-8000-000000000402',
  'pending', 'Asking to trade back', now() + interval '3 days'
);

select pg_temp.act_as('3a000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.decide_shift_swap(
       '3a000000-0000-4000-8000-000000000502', false, 'Coverage no longer needed') $$,
  'rejection still succeeds'
);
select is(
  (select employee_id from public.shift_assignments where id = '3a000000-0000-4000-8000-000000000401'),
  '3a000000-0000-4000-8000-000000000202'::uuid,
  'a rejected swap moves nothing'
);

select * from finish();
rollback;
