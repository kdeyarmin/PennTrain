-- A published shift's Called Off mark must go through record_shift_call_off. Direct
-- UPDATE is the manager-grid path that skipped the open-shift producer (BACKLOG J73).
-- Authenticated is the only role that hits the defect -- every earlier pgTAP that
-- updated shift_assignments ran as postgres, which is why the suite stayed green.

begin;
select plan(6);

insert into public.organizations(id, name, slug, subscription_status, trial_ends_at) values
  ('4d000000-0000-4000-8000-000000000001', 'Calloff Guard Org', 'calloff-guard-org', 'trial', now() + interval '10 days');

insert into public.facilities(id, organization_id, name, facility_type) values
  ('4d000000-0000-4000-8000-000000000011', '4d000000-0000-4000-8000-000000000001', 'Calloff Home', 'PCH');

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
  ('4d000000-0000-4000-8000-000000000101'::uuid, 'calloff-admin@test.local'),
  ('4d000000-0000-4000-8000-000000000102'::uuid, 'calloff-aide@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('4d000000-0000-4000-8000-000000000101', '4d000000-0000-4000-8000-000000000001', 'calloff-admin@test.local', 'Call', 'Admin', 'org_admin', true),
  ('4d000000-0000-4000-8000-000000000102', '4d000000-0000-4000-8000-000000000001', 'calloff-aide@test.local', 'Call', 'Aide', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  first_name = excluded.first_name, last_name = excluded.last_name,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('4d000000-0000-4000-8000-000000000101', '4d000000-0000-4000-8000-000000000011');

insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status
) values (
  '4d000000-0000-4000-8000-000000000201', '4d000000-0000-4000-8000-000000000001',
  '4d000000-0000-4000-8000-000000000011', '4d000000-0000-4000-8000-000000000102',
  'CO-1', 'Call', 'Aide', 'calloff-aide@test.local', public.pa_today()-100, 'Direct Care Worker', 'active'
);
insert into public.employee_facility_assignments(organization_id, employee_id, facility_id, is_primary) values
  ('4d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000201',
   '4d000000-0000-4000-8000-000000000011', true)
on conflict (employee_id, facility_id) do nothing;

insert into public.schedules(id, organization_id, facility_id, title, period_start, period_end, created_by, status) values
  ('4d000000-0000-4000-8000-000000000321', '4d000000-0000-4000-8000-000000000001',
   '4d000000-0000-4000-8000-000000000011', 'Published week', public.pa_today(), public.pa_today()+7,
   '4d000000-0000-4000-8000-000000000101', 'published'),
  ('4d000000-0000-4000-8000-000000000322', '4d000000-0000-4000-8000-000000000001',
   '4d000000-0000-4000-8000-000000000011', 'Draft week', public.pa_today()+8, public.pa_today()+14,
   '4d000000-0000-4000-8000-000000000101', 'draft');

insert into public.shift_assignments(
  id, organization_id, facility_id, schedule_id, employee_id, shift_date, start_time, end_time, status
) values
  ('4d000000-0000-4000-8000-000000000401', '4d000000-0000-4000-8000-000000000001',
   '4d000000-0000-4000-8000-000000000011', '4d000000-0000-4000-8000-000000000321',
   '4d000000-0000-4000-8000-000000000201', public.pa_today()+2, '08:00', '16:00', 'scheduled'),
  ('4d000000-0000-4000-8000-000000000402', '4d000000-0000-4000-8000-000000000001',
   '4d000000-0000-4000-8000-000000000011', '4d000000-0000-4000-8000-000000000322',
   '4d000000-0000-4000-8000-000000000201', public.pa_today()+9, '08:00', '16:00', 'scheduled');

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

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'protect_shift_assignment_call_off'),
  false,
  'the call-off guard runs as the invoker so write_is_through_a_trusted_path can see authenticated'
);

select pg_temp.act_as('4d000000-0000-4000-8000-000000000101');
select throws_ok(
  $$ update public.shift_assignments set status = 'called_off'
     where id = '4d000000-0000-4000-8000-000000000401' $$,
  '42501',
  'A published shift is called off through record_shift_call_off, which posts the opening and opens coverage work.',
  'a manager cannot PATCH a published shift to called_off'
);
select lives_ok(
  $$ update public.shift_assignments set status = 'confirmed'
     where id = '4d000000-0000-4000-8000-000000000401' $$,
  'other published status changes still go through the grid'
);
select lives_ok(
  $$ update public.shift_assignments set status = 'called_off'
     where id = '4d000000-0000-4000-8000-000000000402' $$,
  'a draft may still be marked called_off as a planning mark'
);
select lives_ok(
  $$ select public.record_shift_call_off(
       '4d000000-0000-4000-8000-000000000401', 'illness', 'Manager recorded the call-off') $$,
  'the RPC is the published path and still works for a manager'
);
reset role;

select is(
  (select count(*)::bigint from public.open_shift_opportunities
   where schedule_id = '4d000000-0000-4000-8000-000000000321'
     and shift_date = public.pa_today()+2 and status = 'open'),
  1::bigint,
  'the RPC still posts the opening'
);

select * from finish();
rollback;
