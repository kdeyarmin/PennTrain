begin;
select plan(10);

select has_function(
  'public',
  'get_customer_value_dashboard',
  array[]::text[],
  'customer value dashboard read model exists'
);
select ok(
  has_function_privilege('authenticated', 'public.get_customer_value_dashboard()', 'EXECUTE'),
  'authenticated users may request the customer value dashboard'
);
select ok(
  not has_function_privilege('anon', 'public.get_customer_value_dashboard()', 'EXECUTE'),
  'anonymous users cannot request the customer value dashboard'
);

insert into public.organizations(id, name, slug, subscription_status)
values ('97500000-0000-4000-8000-000000000001', 'Value Roundtrip Org', 'value-roundtrip-org', 'active');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '97500000-0000-4000-8000-000000000101',
  'authenticated', 'authenticated', 'value-roundtrip-admin@test.local', 'x', now(),
  '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values (
  '97500000-0000-4000-8000-000000000101',
  '97500000-0000-4000-8000-000000000001',
  'value-roundtrip-admin@test.local', 'Value', 'Admin', 'org_admin', true
)
on conflict(id) do update set
  organization_id = excluded.organization_id,
  role = excluded.role,
  is_active = true;
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_id uuid)
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_id,
      'role', 'authenticated',
      'aal', 'aal2',
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  set local role authenticated;
end;
$$;

select pg_temp.act_as('97500000-0000-4000-8000-000000000101');

select lives_ok(
  $$
    select public.save_customer_value_baseline(
      47.25,
      100,
      '["Paper binder", "Legacy LMS"]'::jsonb,
      '{
        "report_export_minutes": 12,
        "mock_inspection_minutes": 90,
        "course_completion_admin_minutes": 8,
        "closed_work_item_minutes": 4,
        "portal_message_minutes": 3
      }'::jsonb,
      'Customer-confirmed Value Center baseline'
    )
  $$,
  'organization admin can save a customer value baseline'
);

select is(
  public.get_customer_value_dashboard()->>'configured',
  'true',
  'saved dashboard is configured'
);
select is(
  (public.get_customer_value_dashboard()->>'hourlyAdminCost')::numeric,
  47.25::numeric,
  'dashboard returns the editable hourly admin cost'
);
select is(
  (public.get_customer_value_dashboard()->>'retiredSoftwareMonthlyCost')::numeric,
  100::numeric,
  'dashboard returns the editable retired software cost'
);
select is(
  public.get_customer_value_dashboard()->'retiredTools',
  '["Paper binder", "Legacy LMS"]'::jsonb,
  'dashboard returns the editable retired systems'
);
select is(
  public.get_customer_value_dashboard()->'assumptions',
  '{
    "report_export_minutes": 12,
    "mock_inspection_minutes": 90,
    "course_completion_admin_minutes": 8,
    "closed_work_item_minutes": 4,
    "portal_message_minutes": 3
  }'::jsonb,
  'dashboard returns every editable time-saving assumption'
);
select isnt(
  public.get_customer_value_dashboard()->>'baselineUpdatedAt',
  null,
  'dashboard returns a baseline version for safe client hydration'
);

reset role;
select * from finish();
rollback;
