-- Capacity and retraction for published coverage loss (BACKLOG J130 / J131).

begin;
select plan(14);

insert into public.organizations(id, name, slug, subscription_status, trial_ends_at) values
  ('4a000000-0000-4000-8000-000000000001', 'Slot Retract Org', 'slot-retract-org', 'trial', now() + interval '10 days');

insert into public.facilities(id, organization_id, name, facility_type) values
  ('4a000000-0000-4000-8000-000000000011', '4a000000-0000-4000-8000-000000000001', 'Slot Home', 'PCH');

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
  ('4a000000-0000-4000-8000-000000000101'::uuid, 'slot-admin@test.local'),
  ('4a000000-0000-4000-8000-000000000102'::uuid, 'slot-aide-a@test.local'),
  ('4a000000-0000-4000-8000-000000000103'::uuid, 'slot-aide-b@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('4a000000-0000-4000-8000-000000000101', '4a000000-0000-4000-8000-000000000001', 'slot-admin@test.local', 'Slot', 'Admin', 'org_admin', true),
  ('4a000000-0000-4000-8000-000000000102', '4a000000-0000-4000-8000-000000000001', 'slot-aide-a@test.local', 'Slot', 'AideA', 'employee', true),
  ('4a000000-0000-4000-8000-000000000103', '4a000000-0000-4000-8000-000000000001', 'slot-aide-b@test.local', 'Slot', 'AideB', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  first_name = excluded.first_name, last_name = excluded.last_name,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('4a000000-0000-4000-8000-000000000101', '4a000000-0000-4000-8000-000000000011');

insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status
) values
  ('4a000000-0000-4000-8000-000000000201', '4a000000-0000-4000-8000-000000000001',
   '4a000000-0000-4000-8000-000000000011', '4a000000-0000-4000-8000-000000000102',
   'SL-1', 'Slot', 'AideA', 'slot-aide-a@test.local', public.pa_today()-100, 'Direct Care Worker', 'active'),
  ('4a000000-0000-4000-8000-000000000202', '4a000000-0000-4000-8000-000000000001',
   '4a000000-0000-4000-8000-000000000011', '4a000000-0000-4000-8000-000000000103',
   'SL-2', 'Slot', 'AideB', 'slot-aide-b@test.local', public.pa_today()-100, 'Direct Care Worker', 'active');

insert into public.employee_facility_assignments(organization_id, employee_id, facility_id, is_primary) values
  ('4a000000-0000-4000-8000-000000000001', '4a000000-0000-4000-8000-000000000201',
   '4a000000-0000-4000-8000-000000000011', true),
  ('4a000000-0000-4000-8000-000000000001', '4a000000-0000-4000-8000-000000000202',
   '4a000000-0000-4000-8000-000000000011', true)
on conflict (employee_id, facility_id) do nothing;

insert into public.schedules(id, organization_id, facility_id, title, period_start, period_end, created_by, status) values
  ('4a000000-0000-4000-8000-000000000321', '4a000000-0000-4000-8000-000000000001',
   '4a000000-0000-4000-8000-000000000011', 'Published week', public.pa_today(), public.pa_today()+14,
   '4a000000-0000-4000-8000-000000000101', 'published');

insert into public.shift_assignments(
  id, organization_id, facility_id, schedule_id, employee_id, shift_date, start_time, end_time, status
) values
  ('4a000000-0000-4000-8000-000000000401', '4a000000-0000-4000-8000-000000000001',
   '4a000000-0000-4000-8000-000000000011', '4a000000-0000-4000-8000-000000000321',
   '4a000000-0000-4000-8000-000000000201', public.pa_today()+2, '08:00', '16:00', 'scheduled'),
  ('4a000000-0000-4000-8000-000000000402', '4a000000-0000-4000-8000-000000000001',
   '4a000000-0000-4000-8000-000000000011', '4a000000-0000-4000-8000-000000000321',
   '4a000000-0000-4000-8000-000000000202', public.pa_today()+2, '08:00', '20:00', 'scheduled'),
  ('4a000000-0000-4000-8000-000000000403', '4a000000-0000-4000-8000-000000000001',
   '4a000000-0000-4000-8000-000000000011', '4a000000-0000-4000-8000-000000000321',
   '4a000000-0000-4000-8000-000000000201', public.pa_today()+4, '08:00', '16:00', 'scheduled'),
  ('4a000000-0000-4000-8000-000000000404', '4a000000-0000-4000-8000-000000000001',
   '4a000000-0000-4000-8000-000000000011', '4a000000-0000-4000-8000-000000000321',
   '4a000000-0000-4000-8000-000000000202', public.pa_today()+4, '08:00', '16:00', 'scheduled'),
  ('4a000000-0000-4000-8000-000000000405', '4a000000-0000-4000-8000-000000000001',
   '4a000000-0000-4000-8000-000000000011', '4a000000-0000-4000-8000-000000000321',
   '4a000000-0000-4000-8000-000000000201', public.pa_today()+6, '08:00', '16:00', 'scheduled'),
  ('4a000000-0000-4000-8000-000000000406', '4a000000-0000-4000-8000-000000000001',
   '4a000000-0000-4000-8000-000000000011', '4a000000-0000-4000-8000-000000000321',
   '4a000000-0000-4000-8000-000000000202', public.pa_today()+6, '08:00', '16:00', 'scheduled');

create or replace function pg_temp.act_as(p_profile_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text, true);
  set local role authenticated;
end;
$$;

select pg_temp.act_as('4a000000-0000-4000-8000-000000000101');

select lives_ok(
  $$ update public.shift_assignments set status = 'no_show'
     where id in (
       '4a000000-0000-4000-8000-000000000401',
       '4a000000-0000-4000-8000-000000000402'
     ) $$,
  'a manager can mark two same-start published shifts no-show'
);

select is(
  (select count(*)::bigint from public.open_shift_opportunities
    where schedule_id = '4a000000-0000-4000-8000-000000000321'
      and shift_date = public.pa_today()+2
      and status = 'open'),
  2::bigint,
  'different end times on the same start do not share one opening'
);

select lives_ok(
  $$ update public.shift_assignments set status = 'no_show'
     where id in (
       '4a000000-0000-4000-8000-000000000403',
       '4a000000-0000-4000-8000-000000000404'
     ) $$,
  'a manager can mark two identical published slots no-show'
);

select is(
  (select slots from public.open_shift_opportunities
    where schedule_id = '4a000000-0000-4000-8000-000000000321'
      and shift_date = public.pa_today()+4
      and start_time = '08:00'
      and end_time = '16:00'
      and status = 'open'),
  2,
  'the second identical coverage loss raises slots instead of no-oping'
);

select lives_ok(
  $$ update public.shift_assignments set status = 'scheduled'
     where id = '4a000000-0000-4000-8000-000000000403' $$,
  'a manager can correct a published no-show back to scheduled'
);

select is(
  (select slots from public.open_shift_opportunities
    where schedule_id = '4a000000-0000-4000-8000-000000000321'
      and shift_date = public.pa_today()+4
      and start_time = '08:00'
      and end_time = '16:00'
      and status = 'open'),
  1,
  'correcting one of two no-shows shrinks the opening to the remaining hole'
);

select is(
  (select state from public.work_items
    where organization_id = '4a000000-0000-4000-8000-000000000001'
      and deduplication_key = 'call-off:4a000000-0000-4000-8000-000000000403'),
  'canceled',
  'correcting a no-show cancels that assignment''s unfilled-shift work'
);

select lives_ok(
  $$ update public.shift_assignments set status = 'scheduled'
     where id = '4a000000-0000-4000-8000-000000000404' $$,
  'correcting the last no-show on the slot is allowed'
);

select is(
  (select status from public.open_shift_opportunities
    where schedule_id = '4a000000-0000-4000-8000-000000000321'
      and shift_date = public.pa_today()+4
      and start_time = '08:00'
      and end_time = '16:00'),
  'canceled',
  'the last correction cancels the opening so nobody can claim a covered shift'
);

select lives_ok(
  $$ update public.shift_assignments set status = 'no_show'
     where id = '4a000000-0000-4000-8000-000000000403' $$,
  'the same assignment can be marked no-show again after a correction'
);

select is(
  (select state from public.work_items
    where organization_id = '4a000000-0000-4000-8000-000000000001'
      and deduplication_key = 'call-off:4a000000-0000-4000-8000-000000000403'),
  'open',
  'a later no-show reopens the canceled unfilled-shift work item'
);

select lives_ok(
  $$ select public.record_shift_call_off(
       '4a000000-0000-4000-8000-000000000405', 'illness', 'Fever since last night') $$,
  'a manager can call off the first aide on a published slot'
);

select lives_ok(
  $$ select public.record_shift_call_off(
       '4a000000-0000-4000-8000-000000000406', 'illness', 'Same bug on the second aide') $$,
  'and the second aide on that same slot'
);

select is(
  (select slots from public.open_shift_opportunities
    where schedule_id = '4a000000-0000-4000-8000-000000000321'
      and shift_date = public.pa_today()+6
      and start_time = '08:00'
      and end_time = '16:00'
      and status = 'open'),
  2,
  'the second call-off raises slots on the same opening'
);

select * from finish();
rollback;
