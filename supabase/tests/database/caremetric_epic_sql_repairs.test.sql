begin;
select plan(4);

select ok(
  has_table_privilege('authenticated', 'public.workforce_time_off_requests', 'SELECT')
  and has_table_privilege('authenticated', 'public.shift_report_entries', 'SELECT')
  and has_table_privilege('authenticated', 'public.shift_report_acknowledgements', 'SELECT')
  and has_table_privilege('authenticated', 'public.notification_escalation_rules', 'SELECT'),
  'daily operations tables expose their RLS-protected read grants'
);

insert into public.organizations (id, name, slug)
values (
  '94000000-0000-4000-8000-000000000001',
  'CareMetric Repair Test Org',
  'caremetric-repair-test-org'
);

insert into public.facilities (id, organization_id, name, facility_type)
values (
  '94000000-0000-4000-8000-000000000002',
  '94000000-0000-4000-8000-000000000001',
  'CareMetric Repair Facility',
  'PCH'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  reauthentication_token,
  is_sso_user,
  is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000',
  '94000000-0000-4000-8000-000000000003',
  'authenticated',
  'authenticated',
  'caremetric-repair@test.local',
  'x',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  '',
  '',
  '',
  false,
  false
);

select set_config('app.privileged_write', 'on', true);

update public.profiles
set organization_id = null,
    email = 'caremetric-repair@test.local',
    first_name = 'CareMetric',
    last_name = 'Repair',
    role = 'platform_admin',
    is_active = true
where id = '94000000-0000-4000-8000-000000000003';

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '94000000-0000-4000-8000-000000000003',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
set local role authenticated;

select is(
  (
    select item->>'status'
    from jsonb_array_elements(public.search_workspace('CareMetric Repair')->'items') item
    where item->>'kind' = 'facilities'
    limit 1
  ),
  'active',
  'workspace search executes and derives facility status from is_active'
);

select is(
  public.get_resident_care_delivery_analytics(
    '94000000-0000-4000-8000-000000000002',
    current_date - 30,
    current_date
  )->'scope'->>'facilityId',
  '94000000-0000-4000-8000-000000000002',
  'resident care analytics executes against the real change-event schema'
);

select is(
  jsonb_typeof(
    public.get_enterprise_operations_control_plane(
      '94000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000002',
      current_date - 30,
      current_date
    )->'integrationRecovery'
  ),
  'array',
  'enterprise operations recovery data executes with its selected sort column'
);

reset role;
select * from finish();
rollback;
