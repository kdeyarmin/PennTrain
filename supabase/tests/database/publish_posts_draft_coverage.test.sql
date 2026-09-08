-- Draft Called Off / No Show must become live coverage when the schedule is published.
-- Also pins Act 33 shells and apply_employee_lifecycle_transition's operational_admin gate.

begin;
select plan(8);

insert into public.organizations(id, name, slug, subscription_status, trial_ends_at) values
  ('4f000000-0000-4000-8000-000000000001', 'Publish Coverage Org', 'publish-coverage-org', 'trial', now() + interval '10 days');

insert into public.facilities(id, organization_id, name, facility_type) values
  ('4f000000-0000-4000-8000-000000000011', '4f000000-0000-4000-8000-000000000001', 'Publish Home', 'PCH');

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
  ('4f000000-0000-4000-8000-000000000101'::uuid, 'publish-admin@test.local'),
  ('4f000000-0000-4000-8000-000000000102'::uuid, 'publish-aide@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('4f000000-0000-4000-8000-000000000101', '4f000000-0000-4000-8000-000000000001', 'publish-admin@test.local', 'Pub', 'Admin', 'org_admin', true),
  ('4f000000-0000-4000-8000-000000000102', '4f000000-0000-4000-8000-000000000001', 'publish-aide@test.local', 'Pub', 'Aide', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  first_name = excluded.first_name, last_name = excluded.last_name,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('4f000000-0000-4000-8000-000000000101', '4f000000-0000-4000-8000-000000000011');

insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status
) values (
  '4f000000-0000-4000-8000-000000000201', '4f000000-0000-4000-8000-000000000001',
  '4f000000-0000-4000-8000-000000000011', '4f000000-0000-4000-8000-000000000102',
  'PC-1', 'Pub', 'Aide', 'publish-aide@test.local', public.pa_today()-100, 'Direct Care Worker', 'active'
);
insert into public.employee_facility_assignments(organization_id, employee_id, facility_id, is_primary) values
  ('4f000000-0000-4000-8000-000000000001', '4f000000-0000-4000-8000-000000000201',
   '4f000000-0000-4000-8000-000000000011', true)
on conflict (employee_id, facility_id) do nothing;

insert into public.schedules(id, organization_id, facility_id, title, period_start, period_end, created_by, status) values
  ('4f000000-0000-4000-8000-000000000321', '4f000000-0000-4000-8000-000000000001',
   '4f000000-0000-4000-8000-000000000011', 'Draft week with a hole', public.pa_today(), public.pa_today()+7,
   '4f000000-0000-4000-8000-000000000101', 'draft');

insert into public.shift_assignments(
  id, organization_id, facility_id, schedule_id, employee_id, shift_date, start_time, end_time, status
) values
  ('4f000000-0000-4000-8000-000000000401', '4f000000-0000-4000-8000-000000000001',
   '4f000000-0000-4000-8000-000000000011', '4f000000-0000-4000-8000-000000000321',
   '4f000000-0000-4000-8000-000000000201', public.pa_today()+2, '08:00', '16:00', 'called_off'),
  ('4f000000-0000-4000-8000-000000000402', '4f000000-0000-4000-8000-000000000001',
   '4f000000-0000-4000-8000-000000000011', '4f000000-0000-4000-8000-000000000321',
   '4f000000-0000-4000-8000-000000000201', public.pa_today()+3, '08:00', '16:00', 'scheduled');

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
  (select count(*)::bigint from public.open_shift_opportunities
    where schedule_id = '4f000000-0000-4000-8000-000000000321'),
  0::bigint,
  'a draft called-off mark does not post an opening'
);

select pg_temp.act_as('4f000000-0000-4000-8000-000000000101');

select lives_ok(
  $$ select public.publish_schedule('4f000000-0000-4000-8000-000000000321') $$,
  'a manager can publish a draft that already has a called-off assignment'
);

select is(
  (select count(*)::bigint from public.open_shift_opportunities
    where schedule_id = '4f000000-0000-4000-8000-000000000321'
      and shift_date = public.pa_today()+2
      and status = 'open'),
  1::bigint,
  'publishing posts the opening for a draft called-off assignment'
);

select is(
  (select count(*)::bigint from public.work_items
    where organization_id = '4f000000-0000-4000-8000-000000000001'
      and deduplication_key = 'call-off:4f000000-0000-4000-8000-000000000401'),
  1::bigint,
  'publishing opens unfilled-shift work for the draft called-off assignment'
);

select is(
  (select count(*)::bigint from public.open_shift_opportunities
    where schedule_id = '4f000000-0000-4000-8000-000000000321'
      and shift_date = public.pa_today()+3),
  0::bigint,
  'a still-covered published assignment does not open a claim'
);

reset role;

select is(
  (select count(*)::bigint from public.employee_credentials
    where employee_id = '4f000000-0000-4000-8000-000000000201'
      and credential_type = 'act33_child_abuse'
      and status = 'missing'),
  1::bigint,
  'a new hire gets an Act 33 shell so Survey Day can see the gap'
);

select ok(
  (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_employee_lifecycle_transition')
    like '%operational_admin%'
  and (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_employee_lifecycle_transition')
    not like '%assert_phase2_aal2%',
  'apply uses operational_admin, matching create, not the enterprise_scope_admin wall'
);

select ok(
  (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_notification_delivery_health')
    like '%24 hours%'
  and (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_notification_delivery_health')
    like '%unknown%',
  'notification health counts unknown inside 24 hours, matching the synthetic check'
);

select * from finish();
rollback;
