-- Coverage producer leftovers after J112, plus due_soon eligibility and approved PTO windows.

begin;
select plan(9);

insert into public.organizations(id, name, slug, subscription_status, trial_ends_at) values
  ('4e000000-0000-4000-8000-000000000001', 'Coverage Rest Org', 'coverage-rest-org', 'trial', now() + interval '10 days');

insert into public.facilities(id, organization_id, name, facility_type) values
  ('4e000000-0000-4000-8000-000000000011', '4e000000-0000-4000-8000-000000000001', 'Coverage Home', 'PCH');

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
  ('4e000000-0000-4000-8000-000000000101'::uuid, 'coverage-admin@test.local'),
  ('4e000000-0000-4000-8000-000000000102'::uuid, 'coverage-aide@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('4e000000-0000-4000-8000-000000000101', '4e000000-0000-4000-8000-000000000001', 'coverage-admin@test.local', 'Cov', 'Admin', 'org_admin', true),
  ('4e000000-0000-4000-8000-000000000102', '4e000000-0000-4000-8000-000000000001', 'coverage-aide@test.local', 'Cov', 'Aide', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  first_name = excluded.first_name, last_name = excluded.last_name,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('4e000000-0000-4000-8000-000000000101', '4e000000-0000-4000-8000-000000000011');

insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status
) values (
  '4e000000-0000-4000-8000-000000000201', '4e000000-0000-4000-8000-000000000001',
  '4e000000-0000-4000-8000-000000000011', '4e000000-0000-4000-8000-000000000102',
  'CR-1', 'Cov', 'Aide', 'coverage-aide@test.local', public.pa_today()-100, 'Direct Care Worker', 'active'
);
insert into public.employee_facility_assignments(organization_id, employee_id, facility_id, is_primary) values
  ('4e000000-0000-4000-8000-000000000001', '4e000000-0000-4000-8000-000000000201',
   '4e000000-0000-4000-8000-000000000011', true)
on conflict (employee_id, facility_id) do nothing;

insert into public.schedules(id, organization_id, facility_id, title, period_start, period_end, created_by, status) values
  ('4e000000-0000-4000-8000-000000000321', '4e000000-0000-4000-8000-000000000001',
   '4e000000-0000-4000-8000-000000000011', 'Published week', public.pa_today(), public.pa_today()+7,
   '4e000000-0000-4000-8000-000000000101', 'published'),
  ('4e000000-0000-4000-8000-000000000322', '4e000000-0000-4000-8000-000000000001',
   '4e000000-0000-4000-8000-000000000011', 'Draft week', public.pa_today()+8, public.pa_today()+14,
   '4e000000-0000-4000-8000-000000000101', 'draft');

insert into public.shift_assignments(
  id, organization_id, facility_id, schedule_id, employee_id, shift_date, start_time, end_time, status
) values
  ('4e000000-0000-4000-8000-000000000401', '4e000000-0000-4000-8000-000000000001',
   '4e000000-0000-4000-8000-000000000011', '4e000000-0000-4000-8000-000000000321',
   '4e000000-0000-4000-8000-000000000201', public.pa_today()+2, '08:00', '16:00', 'scheduled'),
  ('4e000000-0000-4000-8000-000000000402', '4e000000-0000-4000-8000-000000000001',
   '4e000000-0000-4000-8000-000000000011', '4e000000-0000-4000-8000-000000000322',
   '4e000000-0000-4000-8000-000000000201', public.pa_today()+9, '08:00', '16:00', 'scheduled');

insert into public.employee_credentials(
  organization_id, facility_id, employee_id, credential_type, status, issue_date, expiration_date
) values
  ('4e000000-0000-4000-8000-000000000001', '4e000000-0000-4000-8000-000000000011',
   '4e000000-0000-4000-8000-000000000201', 'lpn_license', 'due_soon',
   public.pa_today()-200, public.pa_today()+45);

insert into public.workforce_time_off_requests(
  id, organization_id, facility_id, employee_id, request_type, starts_at, ends_at, status, reason, requested_by
) values (
  '4e000000-0000-4000-8000-000000000601', '4e000000-0000-4000-8000-000000000001',
  '4e000000-0000-4000-8000-000000000011', '4e000000-0000-4000-8000-000000000201',
  'time_off',
  public.pa_midnight(public.pa_today()+4) + time '08:00',
  public.pa_midnight(public.pa_today()+5) + time '08:00',
  'pending', 'Family wedding', '4e000000-0000-4000-8000-000000000102'
);

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

select pg_temp.act_as('4e000000-0000-4000-8000-000000000101');

select is(
  public.evaluate_schedule_eligibility(
    '4e000000-0000-4000-8000-000000000201',
    '4e000000-0000-4000-8000-000000000011',
    public.pa_midnight(public.pa_today()+3) + time '08:00',
    public.pa_midnight(public.pa_today()+3) + time '16:00',
    array[]::text[], array['lpn_license']::text[], array[]::uuid[], array[]::uuid[]
  )->>'outcome',
  'eligible',
  'a due_soon license that still covers the shift does not hard-block'
);

reset role;
update public.employee_credentials
   set status = 'expired', expiration_date = public.pa_today() - 1
 where employee_id = '4e000000-0000-4000-8000-000000000201'
   and credential_type = 'lpn_license';
select pg_temp.act_as('4e000000-0000-4000-8000-000000000101');

select is(
  public.evaluate_schedule_eligibility(
    '4e000000-0000-4000-8000-000000000201',
    '4e000000-0000-4000-8000-000000000011',
    public.pa_midnight(public.pa_today()+3) + time '08:00',
    public.pa_midnight(public.pa_today()+3) + time '16:00',
    array[]::text[], array['lpn_license']::text[], array[]::uuid[], array[]::uuid[]
  )->>'outcome',
  'blocked',
  'an expired license still blocks'
);

select lives_ok(
  $$ update public.shift_assignments set status = 'no_show'
     where id = '4e000000-0000-4000-8000-000000000401' $$,
  'a manager can still mark a published shift no-show'
);

select is(
  (select count(*)::bigint from public.open_shift_opportunities
    where schedule_id = '4e000000-0000-4000-8000-000000000321'
      and shift_date = public.pa_today()+2
      and status = 'open'),
  1::bigint,
  'a published no-show posts the opening'
);

select is(
  (select count(*)::bigint from public.work_items
    where organization_id = '4e000000-0000-4000-8000-000000000001'
      and deduplication_key = 'call-off:4e000000-0000-4000-8000-000000000401'),
  1::bigint,
  'a published no-show opens unfilled-shift work'
);

select lives_ok(
  $$ update public.shift_assignments set status = 'no_show'
     where id = '4e000000-0000-4000-8000-000000000402' $$,
  'a draft may still be marked no-show as a planning mark'
);

select is(
  (select count(*)::bigint from public.open_shift_opportunities
    where schedule_id = '4e000000-0000-4000-8000-000000000322'),
  0::bigint,
  'a draft no-show does not post an opening'
);

select lives_ok(
  $$ select public.decide_time_off_request(
       '4e000000-0000-4000-8000-000000000601', 'approved', 'Covered for the wedding') $$,
  'a manager can approve pending time off'
);

reset role;

select is(
  (select count(*)::bigint from public.employee_availability_windows
    where employee_id = '4e000000-0000-4000-8000-000000000201'
      and availability_type = 'unavailable'
      and starts_at = public.pa_midnight(public.pa_today()+4) + time '08:00'),
  1::bigint,
  'approval writes the unavailable window eligibility reads'
);

select * from finish();
rollback;
