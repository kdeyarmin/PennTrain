begin;
select plan(18);

select has_function(
  'public', 'get_portfolio_operations_command_center', array[]::text[],
  'portfolio operations command center snapshot exists'
);
select ok(
  has_function_privilege('authenticated', 'public.get_portfolio_operations_command_center()', 'EXECUTE'),
  'authenticated users may request a portfolio snapshot'
);
select ok(
  not has_function_privilege('anon', 'public.get_portfolio_operations_command_center()', 'EXECUTE'),
  'anonymous users cannot request a portfolio snapshot'
);

insert into public.organizations(id, name, slug, subscription_status) values
  ('93000000-0000-4000-8000-000000000001', 'Portfolio Org', 'portfolio-org', 'active'),
  ('94000000-0000-4000-8000-000000000001', 'Other Portfolio Org', 'other-portfolio-org', 'active');

insert into public.facilities(id, organization_id, name, facility_type) values
  ('93000000-0000-4000-8000-000000000011', '93000000-0000-4000-8000-000000000001', 'Priority Home', 'PCH'),
  ('93000000-0000-4000-8000-000000000012', '93000000-0000-4000-8000-000000000001', 'Ready Living', 'ALR'),
  ('93000000-0000-4000-8000-000000000013', '93000000-0000-4000-8000-000000000001', 'Out of Program SNF', 'NH'),
  ('94000000-0000-4000-8000-000000000011', '94000000-0000-4000-8000-000000000001', 'Other Tenant Home', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'portfolio-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'portfolio-manager@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'other-portfolio-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('93000000-0000-4000-8000-000000000101', '93000000-0000-4000-8000-000000000001', 'portfolio-admin@test.local', 'Portfolio', 'Admin', 'org_admin', true),
  ('93000000-0000-4000-8000-000000000102', '93000000-0000-4000-8000-000000000001', 'portfolio-manager@test.local', 'Portfolio', 'Manager', 'facility_manager', true),
  ('94000000-0000-4000-8000-000000000101', '94000000-0000-4000-8000-000000000001', 'other-portfolio-admin@test.local', 'Other', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('93000000-0000-4000-8000-000000000102', '93000000-0000-4000-8000-000000000011');

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('93000000-0000-4000-8000-000000000201', '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000011', 'Portfolio', 'Resident', current_date, 'active');

insert into public.resident_compliance_items(
  organization_id, facility_id, resident_id, item_type, due_date, status
) values (
  '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000011',
  '93000000-0000-4000-8000-000000000201', 'medical_evaluation', current_date - 1, 'expired'
);

insert into public.work_items(
  id, organization_id, facility_id, source_type, source_id, deduplication_key,
  title, priority, due_at, state, owner_profile_id, created_by
) values
  ('93000000-0000-4000-8000-000000000401', '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000011', 'incident', '93000000-0000-4000-8000-000000000501', 'portfolio:urgent', 'Urgent portfolio follow-up', 'urgent', now() + interval '2 hours', 'open', null, '93000000-0000-4000-8000-000000000101'),
  ('93000000-0000-4000-8000-000000000402', '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000011', 'complaint', '93000000-0000-4000-8000-000000000502', 'portfolio:overdue', 'Overdue portfolio follow-up', 'high', now() - interval '1 day', 'in_progress', '93000000-0000-4000-8000-000000000101', '93000000-0000-4000-8000-000000000101'),
  ('93000000-0000-4000-8000-000000000403', '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000013', 'incident', '93000000-0000-4000-8000-000000000503', 'portfolio:excluded', 'Excluded SNF work', 'urgent', now() - interval '1 day', 'open', null, '93000000-0000-4000-8000-000000000101'),
  ('94000000-0000-4000-8000-000000000401', '94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000011', 'incident', '94000000-0000-4000-8000-000000000501', 'other-portfolio:urgent', 'Other tenant urgent work', 'urgent', now() - interval '1 day', 'open', null, '94000000-0000-4000-8000-000000000101');

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text,
    true
  );
  set local role authenticated;
end;
$$;

select pg_temp.act_as('93000000-0000-4000-8000-000000000101');
select is(public.get_portfolio_operations_command_center()->>'organizationId', '93000000-0000-4000-8000-000000000001', 'snapshot identifies the caller organization');
select is((public.get_portfolio_operations_command_center()->'summary'->>'facilityCount')::integer, 2, 'only active PCH and ALF facilities are included');
select is((public.get_portfolio_operations_command_center()->'summary'->>'criticalFacilities')::integer, 1, 'urgent work marks one facility critical');
select is((public.get_portfolio_operations_command_center()->'summary'->>'readyFacilities')::integer, 1, 'the empty facility is ready');
select is(
  (public.get_portfolio_operations_command_center()->'summary'->>'openWork')::integer,
  (select count(*)::integer from public.work_items where facility_id in (
    '93000000-0000-4000-8000-000000000011', '93000000-0000-4000-8000-000000000012'
  ) and state not in ('closed', 'canceled')),
  'portfolio work matches the caller-visible PCH and ALF queues'
);
select is(public.get_portfolio_operations_command_center()->'facilities'->0->'facility'->>'name', 'Priority Home', 'highest-risk facility is ranked first');
select is(public.get_portfolio_operations_command_center()->'facilities'->0->>'readinessStatus', 'critical', 'urgent facility is labeled critical');
select ok((public.get_portfolio_operations_command_center()->'facilities'->0->>'riskScore')::integer > 0, 'critical facility receives a positive risk score');
select is(public.get_portfolio_operations_command_center()->'facilities'->1->>'readinessStatus', 'ready', 'facility without risks is labeled ready');
select is(
  (public.get_portfolio_operations_command_center()->'summary'->>'residentReadinessGaps')::integer,
  (select count(*)::integer from public.resident_compliance_items where facility_id in (
    '93000000-0000-4000-8000-000000000011', '93000000-0000-4000-8000-000000000012'
  ) and status in ('missing', 'due_soon', 'expired')),
  'resident readiness gaps match the caller-visible PCH and ALF registry'
);

select pg_temp.act_as('93000000-0000-4000-8000-000000000102');
select is((public.get_portfolio_operations_command_center()->'summary'->>'facilityCount')::integer, 1, 'facility manager receives only assigned facilities');
select is(public.get_portfolio_operations_command_center()->'facilities'->0->'facility'->>'id', '93000000-0000-4000-8000-000000000011', 'facility manager portfolio contains the assigned facility');

reset role;
select set_config('app.privileged_write', 'on', true);
update public.profiles set role = 'employee' where id = '93000000-0000-4000-8000-000000000102';
select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('93000000-0000-4000-8000-000000000102');
select is(public.get_portfolio_operations_command_center(), null, 'non-reporting roles receive no portfolio snapshot');

select pg_temp.act_as('94000000-0000-4000-8000-000000000101');
select is((public.get_portfolio_operations_command_center()->'summary'->>'facilityCount')::integer, 1, 'other tenant sees only its own PCH and ALF facilities');
select is(public.get_portfolio_operations_command_center()->'facilities'->0->'facility'->>'id', '94000000-0000-4000-8000-000000000011', 'portfolio ranking does not leak another tenant facility');

reset role;
select * from finish();
rollback;
