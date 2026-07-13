begin;
select plan(19);

select has_function(
  'public', 'get_operations_command_center', array['uuid'],
  'operations command center snapshot exists'
);
select ok(
  has_function_privilege('authenticated', 'public.get_operations_command_center(uuid)', 'EXECUTE'),
  'authenticated users may request an operations snapshot'
);
select ok(
  not has_function_privilege('anon', 'public.get_operations_command_center(uuid)', 'EXECUTE'),
  'anonymous users cannot request an operations snapshot'
);

insert into public.organizations(id, name, slug, subscription_status) values
  ('91000000-0000-4000-8000-000000000001', 'Command Org', 'command-org', 'active'),
  ('92000000-0000-4000-8000-000000000001', 'Other Command Org', 'other-command-org', 'active');

insert into public.facilities(id, organization_id, name, facility_type) values
  ('91000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000001', 'Command Home', 'PCH'),
  ('91000000-0000-4000-8000-000000000012', '91000000-0000-4000-8000-000000000001', 'Second Command Home', 'ALR'),
  ('92000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000001', 'Other Command Home', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'command-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-8000-000000000000', '91000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'command-manager@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '92000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'other-command-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('91000000-0000-4000-8000-000000000101', '91000000-0000-4000-8000-000000000001', 'command-admin@test.local', 'Command', 'Admin', 'org_admin', true),
  ('91000000-0000-4000-8000-000000000102', '91000000-0000-4000-8000-000000000001', 'command-manager@test.local', 'Command', 'Manager', 'facility_manager', true),
  ('92000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000001', 'other-command-admin@test.local', 'Other', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('91000000-0000-4000-8000-000000000102', '91000000-0000-4000-8000-000000000011');

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('91000000-0000-4000-8000-000000000201', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', 'Active', 'Resident', current_date, 'active'),
  ('92000000-0000-4000-8000-000000000201', '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000011', 'Other', 'Resident', current_date, 'active');

insert into public.resident_compliance_items(
  organization_id, facility_id, resident_id, item_type, due_date, status
) values (
  '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011',
  '91000000-0000-4000-8000-000000000201', 'medical_evaluation', current_date - 1, 'expired'
);

insert into public.work_orders(
  id, organization_id, facility_id, work_order_number, problem_description,
  safety_risk, priority, status, created_by_profile_id
) values (
  '91000000-0000-4000-8000-000000000301', '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000011', 'WO-COMMAND-001', 'Emergency exit door will not latch',
  'immediate_danger', 'emergency', 'open', '91000000-0000-4000-8000-000000000101'
);

insert into public.work_items(
  id, organization_id, facility_id, source_type, source_id, deduplication_key,
  title, priority, due_at, state, owner_profile_id, created_by
) values
  ('91000000-0000-4000-8000-000000000401', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', 'incident', '91000000-0000-4000-8000-000000000501', 'command:urgent', 'Urgent safety follow-up', 'urgent', now() + interval '2 hours', 'open', null, '91000000-0000-4000-8000-000000000101'),
  ('91000000-0000-4000-8000-000000000402', '91000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', 'complaint', '91000000-0000-4000-8000-000000000502', 'command:overdue', 'Overdue complaint response', 'high', now() - interval '1 day', 'in_progress', '91000000-0000-4000-8000-000000000101', '91000000-0000-4000-8000-000000000101'),
  ('92000000-0000-4000-8000-000000000401', '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000011', 'incident', '92000000-0000-4000-8000-000000000501', 'other-command:urgent', 'Other tenant urgent work', 'urgent', now() - interval '1 day', 'open', null, '92000000-0000-4000-8000-000000000101');

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

select pg_temp.act_as('91000000-0000-4000-8000-000000000101');
select is(public.get_operations_command_center('91000000-0000-4000-8000-000000000011')->'facility'->>'name', 'Command Home', 'snapshot identifies the selected facility');
select is((public.get_operations_command_center('91000000-0000-4000-8000-000000000011')->'signals'->>'activeResidents')::integer, 1, 'active residents are counted');
select is(
  (public.get_operations_command_center('91000000-0000-4000-8000-000000000011')->'signals'->>'residentReadinessGaps')::integer,
  (select count(*)::integer from public.resident_compliance_items where facility_id = '91000000-0000-4000-8000-000000000011' and status in ('missing','due_soon','expired')),
  'resident readiness gaps match the caller-visible registry'
);
select is((public.get_operations_command_center('91000000-0000-4000-8000-000000000011')->'signals'->>'openWorkOrders')::integer, 1, 'open work orders are counted');
select is((public.get_operations_command_center('91000000-0000-4000-8000-000000000011')->'signals'->>'highRiskWorkOrders')::integer, 1, 'high-risk work orders are counted');
select is(
  (public.get_operations_command_center('91000000-0000-4000-8000-000000000011')->'workQueue'->>'openCount')::integer,
  (select count(*)::integer from public.work_items where facility_id = '91000000-0000-4000-8000-000000000011' and state not in ('closed','canceled')),
  'open work matches the caller-visible queue'
);
select is((public.get_operations_command_center('91000000-0000-4000-8000-000000000011')->'workQueue'->>'urgentCount')::integer, 1, 'urgent work is counted');
select is(
  (public.get_operations_command_center('91000000-0000-4000-8000-000000000011')->'workQueue'->>'overdueCount')::integer,
  (select count(*)::integer from public.work_items where facility_id = '91000000-0000-4000-8000-000000000011' and state not in ('closed','canceled') and due_at < now()),
  'overdue work matches the caller-visible queue'
);
select is(
  (public.get_operations_command_center('91000000-0000-4000-8000-000000000011')->'workQueue'->>'unassignedCount')::integer,
  (select count(*)::integer from public.work_items where facility_id = '91000000-0000-4000-8000-000000000011' and state not in ('closed','canceled') and owner_profile_id is null),
  'unassigned work matches the caller-visible queue'
);
select is(
  (select x->>'openCount' from jsonb_array_elements(public.get_operations_command_center('91000000-0000-4000-8000-000000000011')->'sourceBreakdown') x where x->>'sourceType' = 'incident'),
  '1', 'source breakdown groups the live queue'
);
select is(
  public.get_operations_command_center('91000000-0000-4000-8000-000000000011')->'attentionItems'->0->>'title',
  'Urgent safety follow-up', 'urgent work is ranked first'
);
select is((public.get_operations_command_center('91000000-0000-4000-8000-000000000012')->'workQueue'->>'openCount')::integer, 0, 'org admin may view an empty second facility');

select pg_temp.act_as('91000000-0000-4000-8000-000000000102');
select is(public.get_operations_command_center('91000000-0000-4000-8000-000000000011')->'facility'->>'id', '91000000-0000-4000-8000-000000000011', 'assigned facility manager may view the facility');
select is(public.get_operations_command_center('91000000-0000-4000-8000-000000000012'), null, 'facility manager cannot view an unassigned facility');

reset role;
select set_config('app.privileged_write', 'on', true);
update public.profiles set role = 'employee' where id = '91000000-0000-4000-8000-000000000102';
select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('91000000-0000-4000-8000-000000000102');
select is(public.get_operations_command_center('91000000-0000-4000-8000-000000000011'), null, 'non-reporting roles cannot call the command center directly');

select pg_temp.act_as('92000000-0000-4000-8000-000000000101');
select is(public.get_operations_command_center('91000000-0000-4000-8000-000000000011'), null, 'cross-tenant facility access returns no snapshot');

reset role;
select * from finish();
rollback;
