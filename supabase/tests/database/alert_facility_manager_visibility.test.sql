begin;
select plan(2);

insert into public.organizations (id, name, slug) values
  ('7f000000-0000-4000-8000-000000000001', 'Alert Visibility Org A', 'alert-visibility-org-a'),
  ('7f000000-0000-4000-8000-000000000002', 'Alert Visibility Org B', 'alert-visibility-org-b');

insert into public.facilities (id, organization_id, name, facility_type) values
  ('7f000000-0000-4000-8000-000000000011', '7f000000-0000-4000-8000-000000000001', 'Assigned Facility', 'PCH'),
  ('7f000000-0000-4000-8000-000000000012', '7f000000-0000-4000-8000-000000000001', 'Unassigned Facility', 'PCH'),
  ('7f000000-0000-4000-8000-000000000013', '7f000000-0000-4000-8000-000000000002', 'Other Org Facility', 'PCH');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '7f000000-0000-4000-8000-000000000101',
  'authenticated',
  'authenticated',
  'alert-visibility-manager@test.local',
  'x',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '', '', '', '', '', '', false, false
);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (
  id, organization_id, email, first_name, last_name, role, is_active
) values (
  '7f000000-0000-4000-8000-000000000101',
  '7f000000-0000-4000-8000-000000000001',
  'alert-visibility-manager@test.local',
  'Alert',
  'Manager',
  'facility_manager',
  true
)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  role = excluded.role,
  is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments (profile_id, facility_id) values (
  '7f000000-0000-4000-8000-000000000101',
  '7f000000-0000-4000-8000-000000000011'
);

insert into public.alerts (
  id, organization_id, facility_id, alert_type, title, message, severity, status
) values
  ('7f000000-0000-4000-8000-000000000201', '7f000000-0000-4000-8000-000000000001', null, 'due_30', 'Launch visibility - org-wide', 'Org-wide alert', 'warning', 'open'),
  ('7f000000-0000-4000-8000-000000000202', '7f000000-0000-4000-8000-000000000001', '7f000000-0000-4000-8000-000000000011', 'due_30', 'Launch visibility - assigned', 'Assigned-facility alert', 'warning', 'open'),
  ('7f000000-0000-4000-8000-000000000203', '7f000000-0000-4000-8000-000000000001', '7f000000-0000-4000-8000-000000000012', 'due_30', 'Launch visibility - unassigned', 'Unassigned-facility alert', 'warning', 'open'),
  ('7f000000-0000-4000-8000-000000000204', '7f000000-0000-4000-8000-000000000002', '7f000000-0000-4000-8000-000000000013', 'due_30', 'Launch visibility - other org', 'Other-organization alert', 'warning', 'open');

create or replace function pg_temp.act_as(p_profile_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_profile_id,
      'role', 'authenticated',
      'aal', 'aal2',
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  set local role authenticated;
end
$$;

select pg_temp.act_as('7f000000-0000-4000-8000-000000000101');

select results_eq(
  $$
    select title
    from public.alert_list_rows
    where title like 'Launch visibility - %'
    order by title
  $$,
  $$ values
    ('Launch visibility - assigned'::text),
    ('Launch visibility - org-wide'::text)
  $$,
  'facility managers see assigned-facility and organization-wide alerts only'
);

select lives_ok(
  $$
    update public.alerts
    set status = 'dismissed'
    where id = '7f000000-0000-4000-8000-000000000201'
  $$,
  'facility managers can update an organization-wide alert they are authorized to read'
);

select * from finish();
rollback;
