begin;
select plan(77);

select has_table('public', 'enterprise_portfolios', 'enterprise portfolios exist');
select has_table('public', 'enterprise_regions', 'enterprise regions exist');
select has_table('public', 'enterprise_organization_memberships', 'organization hierarchy is effective-dated');
select has_table('public', 'enterprise_scope_memberships', 'identity scope membership is effective-dated');
select has_table('public', 'enterprise_access_grants', 'role grants are effective-dated');
select has_table('public', 'workforce_people', 'canonical workforce people exist');
select has_table('public', 'employment_episodes', 'employment episode history exists');
select has_table('public', 'employment_lifecycle_events', 'append-only lifecycle evidence exists');
select has_table('public', 'employment_lifecycle_dispositions', 'dependent lifecycle disposition evidence exists');
select has_table('public', 'compliance_profile_definitions', 'governed compliance profiles exist');
select has_table('public', 'employee_compliance_profile_assignments', 'effective compliance assignments exist');

select has_function('public', 'has_effective_permission',
  array['text', 'text', 'uuid', 'timestamp with time zone'],
  'central permission resolver exists');
select has_function('public', 'get_enterprise_scope_control_plane', array[]::text[],
  'enterprise control-plane read model exists');
select has_function('public', 'preview_employee_lifecycle_transition',
  array['uuid', 'text', 'date', 'uuid', 'text'],
  'lifecycle preview RPC exists');
select has_function('public', 'apply_employee_lifecycle_transition',
  array['uuid', 'text', 'date', 'uuid', 'text'],
  'guarded lifecycle apply RPC exists');
select has_function('public', 'explain_employee_compliance_profile',
  array['uuid', 'date'], 'compliance explanation RPC exists');
select has_function('public', 'get_workforce_compliance_control_plane', array[]::text[],
  'workforce control-plane read model exists');

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'enterprise_portfolios', 'enterprise_regions',
        'enterprise_organization_memberships', 'enterprise_scope_memberships',
        'permission_definitions', 'role_templates', 'role_template_permissions',
        'enterprise_access_grants', 'enterprise_scope_backfill_exceptions',
        'workforce_people', 'workforce_employee_links', 'employment_episodes',
        'employment_lifecycle_events', 'employment_lifecycle_dispositions',
        'employee_access_suspensions',
        'workforce_backfill_exceptions', 'compliance_profile_definitions',
        'compliance_profile_requirements', 'compliance_profile_mapping_rules',
        'employee_compliance_profile_assignments',
        'compliance_profile_resolution_exceptions'
      )
      and not c.relrowsecurity
  ),
  'every Phase 2 public table has RLS enabled'
);
select ok(
  has_table_privilege('authenticated', 'public.enterprise_scope_memberships', 'SELECT')
  and not has_table_privilege('authenticated', 'public.enterprise_scope_memberships', 'INSERT')
  and not has_table_privilege('authenticated', 'public.enterprise_access_grants', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.role_templates', 'INSERT'),
  'enterprise access tables are read-only through the Data API'
);
select ok(
  has_table_privilege('authenticated', 'public.employment_lifecycle_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.employment_lifecycle_events', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.employment_lifecycle_dispositions', 'UPDATE')
  and not has_table_privilege('service_role', 'public.employment_lifecycle_events', 'DELETE'),
  'lifecycle evidence cannot be rewritten through API roles'
);
select ok(
  has_function_privilege('service_role',
    'public.apply_employee_lifecycle_transition(uuid,text,date,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.apply_employee_lifecycle_transition(uuid,text,date,uuid,text)', 'EXECUTE'),
  'lifecycle mutation is explicit for trusted/authenticated callers and closed to anonymous callers'
);
select ok(
  not has_schema_privilege('authenticated', 'app_private', 'USAGE')
  and not has_function_privilege('authenticated',
    'app_private.profile_has_effective_permission(uuid,text,text,uuid,timestamp with time zone)',
    'EXECUTE'),
  'private authorization helpers are not directly callable'
);

insert into public.organizations(id, name, slug) values
  ('22000000-0000-4000-8000-000000000001', 'Phase Two Tenant A', 'phase-two-tenant-a'),
  ('22000000-0000-4000-8000-000000000002', 'Phase Two Tenant B', 'phase-two-tenant-b');

insert into public.facilities(id, organization_id, name, facility_type) values
  ('22000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000001', 'Tenant A One', 'PCH'),
  ('22000000-0000-4000-8000-000000000012', '22000000-0000-4000-8000-000000000001', 'Tenant A Two', 'ALR'),
  ('22000000-0000-4000-8000-000000000013', '22000000-0000-4000-8000-000000000002', 'Tenant B One', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated',
  'authenticated', v.email, 'x', now(), '{}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', '', '', '', false, false
from (values
  ('22000000-0000-4000-8000-000000000101'::uuid, 'phase2-platform@test.local'),
  ('22000000-0000-4000-8000-000000000102'::uuid, 'phase2-admin-a@test.local'),
  ('22000000-0000-4000-8000-000000000103'::uuid, 'phase2-manager-a@test.local'),
  ('22000000-0000-4000-8000-000000000104'::uuid, 'phase2-trainer-a@test.local'),
  ('22000000-0000-4000-8000-000000000105'::uuid, 'phase2-auditor-a@test.local'),
  ('22000000-0000-4000-8000-000000000106'::uuid, 'phase2-employee-a@test.local'),
  ('22000000-0000-4000-8000-000000000107'::uuid, 'phase2-admin-b@test.local'),
  ('22000000-0000-4000-8000-000000000108'::uuid, 'phase2-employee-b@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(
  id, organization_id, first_name, last_name, email, role, is_active
) values
  ('22000000-0000-4000-8000-000000000101', null, 'Platform', 'Admin', 'phase2-platform@test.local', 'platform_admin', true),
  ('22000000-0000-4000-8000-000000000102', '22000000-0000-4000-8000-000000000001', 'Org', 'Admin A', 'phase2-admin-a@test.local', 'org_admin', true),
  ('22000000-0000-4000-8000-000000000103', '22000000-0000-4000-8000-000000000001', 'Facility', 'Manager A', 'phase2-manager-a@test.local', 'facility_manager', true),
  ('22000000-0000-4000-8000-000000000104', '22000000-0000-4000-8000-000000000001', 'Trainer', 'A', 'phase2-trainer-a@test.local', 'trainer', true),
  ('22000000-0000-4000-8000-000000000105', '22000000-0000-4000-8000-000000000001', 'Auditor', 'A', 'phase2-auditor-a@test.local', 'auditor', true),
  ('22000000-0000-4000-8000-000000000106', '22000000-0000-4000-8000-000000000001', 'Employee', 'A', 'phase2-employee-a@test.local', 'employee', true),
  ('22000000-0000-4000-8000-000000000107', '22000000-0000-4000-8000-000000000002', 'Org', 'Admin B', 'phase2-admin-b@test.local', 'org_admin', true),
  ('22000000-0000-4000-8000-000000000108', '22000000-0000-4000-8000-000000000002', 'Employee', 'B', 'phase2-employee-b@test.local', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email,
  role = excluded.role,
  is_active = excluded.is_active;
select set_config('app.privileged_write', '', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('22000000-0000-4000-8000-000000000103', '22000000-0000-4000-8000-000000000011'),
  ('22000000-0000-4000-8000-000000000104', '22000000-0000-4000-8000-000000000011');

insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name,
  email, hire_date, job_title, status
) values
  ('22000000-0000-4000-8000-000000000201', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000103', 'Facility', 'Manager A', 'phase2-manager-a@test.local', current_date - 100, 'Manager', 'active'),
  ('22000000-0000-4000-8000-000000000202', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000106', 'Employee', 'A', 'phase2-employee-a@test.local', current_date - 60, 'Caregiver', 'active'),
  ('22000000-0000-4000-8000-000000000203', '22000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000013', '22000000-0000-4000-8000-000000000108', 'Employee', 'B', 'phase2-employee-b@test.local', current_date - 50, 'Caregiver', 'active');

insert into public.schedules(
  id, organization_id, facility_id, title, period_start, period_end, status, created_by
) values (
  '22000000-0000-4000-8000-000000000501',
  '22000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000011',
  'Phase 2 lifecycle schedule', current_date, current_date + 14,
  'published', '22000000-0000-4000-8000-000000000102'
);
insert into public.shift_assignments(
  id, organization_id, schedule_id, facility_id, employee_id,
  shift_date, start_time, end_time, status
) values
  ('22000000-0000-4000-8000-000000000502', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000501', '22000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000202', current_date + 2, '08:00', '16:00', 'confirmed'),
  ('22000000-0000-4000-8000-000000000503', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000501', '22000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000201', current_date + 3, '08:00', '16:00', 'scheduled');

insert into public.courses(id, organization_id, title, status, created_by)
values (
  '22000000-0000-4000-8000-000000000510',
  '22000000-0000-4000-8000-000000000001',
  'Phase 2 lifecycle course', 'draft',
  '22000000-0000-4000-8000-000000000102'
);
insert into public.course_versions(
  id, course_id, organization_id, version_number, title, status
) values (
  '22000000-0000-4000-8000-000000000511',
  '22000000-0000-4000-8000-000000000510',
  '22000000-0000-4000-8000-000000000001', 1,
  'Phase 2 lifecycle course v1', 'draft'
);
insert into public.course_blocks(
  id, course_version_id, organization_id, block_type, sort_order, title, body
) values (
  '22000000-0000-4000-8000-000000000514',
  '22000000-0000-4000-8000-000000000511',
  '22000000-0000-4000-8000-000000000001',
  'text', 0, 'Lifecycle lesson', '{"content":"Lifecycle fixture lesson"}'::jsonb
);
select set_config('app.privileged_write', 'on', true);
update public.course_versions
set status = 'published', published_at = now()
where id = '22000000-0000-4000-8000-000000000511';
update public.courses
set status = 'published',
    current_version_id = '22000000-0000-4000-8000-000000000511'
where id = '22000000-0000-4000-8000-000000000510';
insert into public.course_assignments(
  id, organization_id, facility_id, employee_id, course_id,
  course_version_id, assigned_by, due_date, status
) values
  ('22000000-0000-4000-8000-000000000512', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000202', '22000000-0000-4000-8000-000000000510', '22000000-0000-4000-8000-000000000511', '22000000-0000-4000-8000-000000000102', current_date + 10, 'in_progress'),
  ('22000000-0000-4000-8000-000000000513', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000201', '22000000-0000-4000-8000-000000000510', '22000000-0000-4000-8000-000000000511', '22000000-0000-4000-8000-000000000102', current_date + 11, 'assigned');
select set_config('app.privileged_write', '', true);

insert into public.training_types(
  id, organization_id, code, name, category
) values (
  '22000000-0000-4000-8000-000000000520',
  '22000000-0000-4000-8000-000000000001',
  'PHASE2-LIFECYCLE', 'Phase 2 lifecycle training', 'Orientation'
);
insert into public.training_classes(
  id, organization_id, facility_id, trainer_profile_id, training_type_id,
  class_name, class_date, status
) values (
  '22000000-0000-4000-8000-000000000521',
  '22000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000011',
  '22000000-0000-4000-8000-000000000104',
  '22000000-0000-4000-8000-000000000520',
  'Phase 2 future class', current_date + 5, 'draft'
);
insert into public.training_class_attendees(id, class_id, employee_id) values
  ('22000000-0000-4000-8000-000000000522', '22000000-0000-4000-8000-000000000521', '22000000-0000-4000-8000-000000000202'),
  ('22000000-0000-4000-8000-000000000523', '22000000-0000-4000-8000-000000000521', '22000000-0000-4000-8000-000000000201');

create or replace function pg_temp.act_as(
  p_profile_id uuid,
  p_aal text default 'aal2'
) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_profile_id::text,
      'role', 'authenticated',
      'aal', p_aal,
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  set local role authenticated;
end;
$$;

select is(
  (select count(*)::integer from public.enterprise_organization_memberships
   where organization_id in (
     '22000000-0000-4000-8000-000000000001',
     '22000000-0000-4000-8000-000000000002'
   ) and effective_to is null),
  2,
  'new organizations receive isolated enterprise hierarchy memberships'
);
select is(
  (select count(*)::integer from public.enterprise_scope_memberships
   where profile_id = '22000000-0000-4000-8000-000000000106'
     and scope_type = 'organization' and effective_to is null),
  1,
  'employee JIT/profile projection is idempotent and creates one tenant membership'
);
select is(
  (select count(*)::integer
   from public.role_template_permissions rtp
   join public.role_templates rt on rt.id = rtp.role_template_id
   where rt.built_in_role = 'employee'),
  0,
  'employee tenant membership carries no organization-wide self permission'
);

select pg_temp.act_as('22000000-0000-4000-8000-000000000101');
select ok(
  public.has_effective_permission('enterprise.scope.read', 'organization', '22000000-0000-4000-8000-000000000001')
  and public.has_effective_permission('enterprise.scope.read', 'organization', '22000000-0000-4000-8000-000000000002'),
  'platform administrator resolves access across operational tenants'
);

reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000102');
select ok(
  public.has_effective_permission('enterprise.scope.manage', 'organization', '22000000-0000-4000-8000-000000000001'),
  'organization administrator manages its own organization'
);
select ok(
  not public.has_effective_permission('enterprise.scope.read', 'organization', '22000000-0000-4000-8000-000000000002'),
  'organization administrator cannot resolve another tenant'
);

reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000103');
select ok(
  public.has_effective_permission('workforce.lifecycle.manage', 'facility', '22000000-0000-4000-8000-000000000011')
  and not public.has_effective_permission('workforce.lifecycle.manage', 'facility', '22000000-0000-4000-8000-000000000012'),
  'facility manager is isolated to its effective facility scope'
);

reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000104');
select ok(
  public.has_effective_permission('workforce.compliance.read', 'facility', '22000000-0000-4000-8000-000000000011')
  and not public.has_effective_permission('workforce.lifecycle.manage', 'facility', '22000000-0000-4000-8000-000000000011'),
  'trainer is a scoped reader and cannot manage employment lifecycle'
);

reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000105');
select ok(
  public.has_effective_permission('workforce.evidence.read', 'organization', '22000000-0000-4000-8000-000000000001')
  and not public.has_effective_permission('workforce.compliance.manage', 'organization', '22000000-0000-4000-8000-000000000001'),
  'auditor remains organization-scoped and read-only'
);

reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000106');
select ok(
  not public.has_effective_permission('workforce.self.read', 'organization', '22000000-0000-4000-8000-000000000001'),
  'subject-bound self access is not modeled as an organization permission'
);
select is((select count(*)::integer from public.employees), 1,
  'employee RLS exposes only the linked employee, not another employee in its tenant');

reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000102');
select throws_ok(
  $$ select public.grant_enterprise_role(
    '22000000-0000-4000-8000-000000000108', 'organization',
    '22000000-0000-4000-8000-000000000001',
    (select id from public.role_templates where built_in_role = 'employee'),
    now(), null, 'cross tenant attempt'
  ) $$,
  null, null,
  'organization administrator cannot attach another-tenant identity'
);

reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000102', 'aal1');
select throws_ok(
  $$ select public.upsert_enterprise_role_template(
    '22000000-0000-4000-8000-000000000001', 'aal1-role', 'AAL1 Role', '',
    array['workforce.lifecycle.read'], null
  ) $$,
  '42501', null,
  'privileged enterprise mutation requires AAL2'
);

reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000102');
select lives_ok(
  $$ select public.upsert_enterprise_role_template(
    '22000000-0000-4000-8000-000000000001', 'supervisor', 'Supervisor A', '',
    array['workforce.lifecycle.read'], null
  ) $$,
  'tenant A can create its local role-template code'
);
reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000107');
select lives_ok(
  $$ select public.upsert_enterprise_role_template(
    '22000000-0000-4000-8000-000000000002', 'supervisor', 'Supervisor B', '',
    array['workforce.lifecycle.read'], null
  ) $$,
  'tenant B can independently use the same local role-template code'
);
reset role;
select is(
  (select count(*)::integer from public.role_templates where code = 'supervisor'),
  2,
  'custom role-template codes are unique per tenant rather than globally'
);
select pg_temp.act_as('22000000-0000-4000-8000-000000000102');
select throws_ok(
  $$ select public.upsert_enterprise_role_template(
    '22000000-0000-4000-8000-000000000001', 'supervisor', 'Duplicate', '',
    array['workforce.lifecycle.read'], null
  ) $$,
  '23505', null,
  'duplicate role-template code inside one tenant is rejected'
);

reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000101');
update public.organizations set subscription_status = 'suspended'
where id = '22000000-0000-4000-8000-000000000002';
reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000107');
select ok(
  public.current_org_id() is null
  and public.current_role() is null
  and not public.has_effective_permission(
    'enterprise.scope.read', 'organization', '22000000-0000-4000-8000-000000000002'
  ),
  'suspended tenant immediately loses legacy and Phase 2 authorization'
);
reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000101');
update public.organizations set subscription_status = 'active'
where id = '22000000-0000-4000-8000-000000000002';

reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000102');
select throws_ok(
  $$ update public.employees set status = 'inactive'
     where id = '22000000-0000-4000-8000-000000000202' $$,
  '42501', null,
  'direct lifecycle-field updates are rejected'
);

reset role;
insert into auth.sessions(id, user_id, created_at, updated_at, aal)
values (
  '22000000-0000-4000-8000-000000000301',
  '22000000-0000-4000-8000-000000000106', now(), now(), 'aal1'
);
select pg_temp.act_as('22000000-0000-4000-8000-000000000102');
select lives_ok(
  $$ select public.apply_employee_lifecycle_transition(
    '22000000-0000-4000-8000-000000000202', 'leave', current_date, null,
    'Approved leave'
  ) $$,
  'organization administrator can apply a guarded leave transition'
);
select results_eq(
  $$ select
       (select status from public.shift_assignments where id = '22000000-0000-4000-8000-000000000502'),
       (select status from public.course_assignments where id = '22000000-0000-4000-8000-000000000512'),
       (select lifecycle_disposition from public.training_class_attendees where id = '22000000-0000-4000-8000-000000000522'),
       (select status from public.schedules where id = '22000000-0000-4000-8000-000000000501') $$,
  $$ values ('called_off'::text, 'paused'::text, 'paused'::text, 'published'::text) $$,
  'leave calls off future shifts, pauses learning work, and preserves the schedule itself'
);
select is(
  (select count(*)::integer
   from public.employment_lifecycle_dispositions d
   join public.employment_lifecycle_events e on e.id = d.lifecycle_event_id
   where e.employee_id = '22000000-0000-4000-8000-000000000202'
     and e.event_type = 'leave_started'),
  4,
  'leave records append-only disposition evidence for shift, schedule, course, and roster'
);
reset role;
select ok(
  exists (
    select 1 from public.notifications
    where profile_id = '22000000-0000-4000-8000-000000000106'
      and notification_type = 'workforce_lifecycle_changed'
  ),
  'lifecycle disposition creates an in-app notification for the affected worker'
);
select ok(
  exists (
    select 1 from app_private.integration_event_log
    where event_type = 'workforce.employee.lifecycle.changed'
      and event_schema_version = '2026-07-11'
      and payload->>'employeeId' = '22000000-0000-4000-8000-000000000202'
      and payload->>'transition' = 'leave'
      and (payload->>'eventVersion')::integer = 1
  ),
  'leave publishes a versioned tenant integration event'
);
select is(
  (select count(*)::integer from auth.sessions
   where user_id = '22000000-0000-4000-8000-000000000106'),
  0,
  'leave revokes linked authentication sessions'
);
reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000106');
select ok(
  public.current_role() is null and public.current_org_id() is null,
  'leave deactivation immediately removes role and tenant scope from a live JWT'
);
reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000102');
select lives_ok(
  $$ select public.apply_employee_lifecycle_transition(
    '22000000-0000-4000-8000-000000000202', 'return', current_date, null,
    'Returned from approved leave'
  ) $$,
  'return transition closes leave suspension'
);
select ok(
  (select is_active from public.profiles where id = '22000000-0000-4000-8000-000000000106')
  and public.is_employee_access_active('22000000-0000-4000-8000-000000000202'),
  'return restores access only after the suspension is closed'
);
select results_eq(
  $$ select
       (select status from public.shift_assignments where id = '22000000-0000-4000-8000-000000000502'),
       (select status from public.course_assignments where id = '22000000-0000-4000-8000-000000000512'),
       (select lifecycle_disposition from public.training_class_attendees where id = '22000000-0000-4000-8000-000000000522') $$,
  $$ values ('called_off'::text, 'in_progress'::text, 'active'::text) $$,
  'return resumes only lifecycle-paused learning work and does not reinstate called-off shifts'
);

select lives_ok(
  $$ select public.apply_employee_lifecycle_transition(
    '22000000-0000-4000-8000-000000000201', 'transfer', current_date,
    '22000000-0000-4000-8000-000000000012', 'Manager transferred to facility two'
  ) $$,
  'transfer rolls the employment episode under source and target authorization'
);
reset role;
select pg_temp.act_as('22000000-0000-4000-8000-000000000103');
select ok(
  not public.has_effective_permission('workforce.lifecycle.manage', 'facility', '22000000-0000-4000-8000-000000000011')
  and public.has_effective_permission('workforce.lifecycle.manage', 'facility', '22000000-0000-4000-8000-000000000012'),
  'transfer removes old-facility access and grants target-facility access atomically'
);
select results_eq(
  $$ select
       (select status from public.shift_assignments where id = '22000000-0000-4000-8000-000000000503'),
       (select facility_id from public.course_assignments where id = '22000000-0000-4000-8000-000000000513'),
       (select lifecycle_disposition from public.training_class_attendees where id = '22000000-0000-4000-8000-000000000523') $$,
  $$ values (
       'called_off'::text,
       '22000000-0000-4000-8000-000000000012'::uuid,
       'removed'::text
     ) $$,
  'transfer calls off source shifts, carries active courses, and removes source-facility rosters'
);
reset role;
select is(
  (select count(*)::integer from public.employment_episodes
   where employee_id = '22000000-0000-4000-8000-000000000201'),
  2,
  'facility transfer retains the prior episode and opens a successor episode'
);

insert into public.shift_assignments(
  id, organization_id, schedule_id, facility_id, employee_id,
  shift_date, start_time, end_time, status
) values (
  '22000000-0000-4000-8000-000000000504',
  '22000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000501',
  '22000000-0000-4000-8000-000000000011',
  '22000000-0000-4000-8000-000000000202', current_date + 4,
  '08:00', '16:00', 'scheduled'
);
insert into auth.sessions(id, user_id, created_at, updated_at, aal)
values (
  '22000000-0000-4000-8000-000000000302',
  '22000000-0000-4000-8000-000000000106', now(), now(), 'aal1'
);
select pg_temp.act_as('22000000-0000-4000-8000-000000000102');
select lives_ok(
  $$ select public.apply_employee_lifecycle_transition(
    '22000000-0000-4000-8000-000000000202', 'terminate', current_date, null,
    'Employment ended'
  ) $$,
  'termination closes the active employment episode'
);
reset role;
select ok(
  (select status = 'terminated' from public.employees
   where id = '22000000-0000-4000-8000-000000000202')
  and not (select is_active from public.profiles
   where id = '22000000-0000-4000-8000-000000000106')
  and not exists (select 1 from auth.sessions
   where user_id = '22000000-0000-4000-8000-000000000106'),
  'termination suspends access and removes refreshable sessions'
);
select results_eq(
  $$ select
       (select status from public.shift_assignments where id = '22000000-0000-4000-8000-000000000504'),
       (select status from public.course_assignments where id = '22000000-0000-4000-8000-000000000512'),
       (select lifecycle_disposition from public.training_class_attendees where id = '22000000-0000-4000-8000-000000000522') $$,
  $$ values ('called_off'::text, 'canceled'::text, 'removed'::text) $$,
  'termination cancels incomplete learning work and future scheduling commitments'
);
select ok(
  exists (
    select 1
    from app_private.workforce_lifecycle_integration_outbox o
    join public.employment_lifecycle_events e on e.id = o.event_id
    where e.employee_id = '22000000-0000-4000-8000-000000000202'
      and e.event_type = 'terminated' and o.published_at is not null
  ),
  'transactional lifecycle outbox records successful publication without losing its envelope'
);
select lives_ok(
  $$ select public.apply_employee_lifecycle_transition(
    '22000000-0000-4000-8000-000000000202', 'rehire', current_date,
    '22000000-0000-4000-8000-000000000012', 'Rehired into facility two'
  ) $$,
  'rehire opens a new episode without rewriting prior employment evidence'
);
select results_eq(
  $$ select count(*)::integer,
       count(*) filter (where episode_status = 'active')::integer
     from public.employment_episodes
     where employee_id = '22000000-0000-4000-8000-000000000202' $$,
  $$ values (2, 1) $$,
  'rehire keeps one closed historical episode and one active episode'
);
select throws_ok(
  $$ update public.employment_lifecycle_events set reason = 'rewritten'
     where employee_id = '22000000-0000-4000-8000-000000000202' $$,
  '55000', null,
  'lifecycle evidence is immutable even for a privileged database caller'
);
select is(
  (select count(*)::integer from public.employment_lifecycle_events
   where employee_id = '22000000-0000-4000-8000-000000000202'
     and event_type in ('terminated', 'rehired')),
  2,
  'termination and rehire each retain immutable evidence'
);

reset role;
insert into public.compliance_profile_definitions(
  id, organization_id, code, version, name, profile_kind
) values
  ('22000000-0000-4000-8000-000000000401', '22000000-0000-4000-8000-000000000001', 'caregiver-primary', 1, 'Caregiver Primary', 'primary'),
  ('22000000-0000-4000-8000-000000000402', '22000000-0000-4000-8000-000000000001', 'alternate-primary', 1, 'Alternate Primary', 'primary'),
  ('22000000-0000-4000-8000-000000000403', '22000000-0000-4000-8000-000000000001', 'medication-extension', 1, 'Medication Extension', 'extension');
insert into public.compliance_profile_requirements(
  profile_definition_id, requirement_key, label, is_mandatory,
  minimum_hours, evidence_required
) values
  ('22000000-0000-4000-8000-000000000401', 'workforce.orientation', 'Advanced orientation', true, 4, true),
  ('22000000-0000-4000-8000-000000000403', 'workforce.medication', 'Medication administration', true, 2, true);
insert into public.compliance_profile_mapping_rules(
  organization_id, profile_definition_id, name, priority, job_title_pattern
) values (
  '22000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000401',
  'Caregiver titles', 10, '%Caregiver%'
);

select results_eq(
  $$ select count(*)::integer,
       count(*) filter (where is_mandatory and evidence_required)::integer
     from public.compliance_profile_requirements r
     join public.compliance_profile_definitions p on p.id = r.profile_definition_id
     where p.is_mandatory_baseline $$,
  $$ values (3, 3) $$,
  'mandatory baseline is present and every baseline requirement is evidence-backed'
);
select throws_ok(
  $$ insert into public.compliance_profile_requirements(
       profile_definition_id, requirement_key, label, is_mandatory,
       minimum_hours, evidence_required
     ) values (
       '22000000-0000-4000-8000-000000000402',
       'workforce.orientation', 'Weakened orientation', false, 0, false
     ) $$,
  '23514', null,
  'tenant compliance profile cannot weaken the mandatory baseline'
);

select pg_temp.act_as('22000000-0000-4000-8000-000000000102');
select ok(
  (public.explain_employee_compliance_profile(
    '22000000-0000-4000-8000-000000000202', current_date
  ) -> 'profiles') @> '[{"code":"mandatory-baseline"},{"code":"caregiver-primary"}]'::jsonb,
  'profile explanation includes mandatory baseline and deterministic mapping rule'
);
select lives_ok(
  $$ select public.upsert_compliance_profile_assignment(
    '22000000-0000-4000-8000-000000000202',
    '22000000-0000-4000-8000-000000000401', current_date - 5, null,
    'Approved caregiver profile'
  ) $$,
  'governed RPC can assign one primary workforce profile'
);
select throws_ok(
  $$ select public.upsert_compliance_profile_assignment(
    '22000000-0000-4000-8000-000000000202',
    '22000000-0000-4000-8000-000000000402', current_date - 4, null,
    'Conflicting primary profile'
  ) $$,
  '23P01', null,
  'multiple overlapping primary workforce profiles are rejected'
);
select is(
  public.upsert_compliance_profile_assignment(
    '22000000-0000-4000-8000-000000000202',
    '22000000-0000-4000-8000-000000000403', current_date - 2, null,
    'Medication extension v1'
  ),
  public.upsert_compliance_profile_assignment(
    '22000000-0000-4000-8000-000000000202',
    '22000000-0000-4000-8000-000000000403', current_date - 2, null,
    'Medication extension v1'
  ),
  'exact assignment replay returns the canonical history row'
);
select lives_ok(
  $$ select public.upsert_compliance_profile_assignment(
    '22000000-0000-4000-8000-000000000202',
    '22000000-0000-4000-8000-000000000403', current_date, null,
    'Medication extension v2'
  ) $$,
  'assignment supersession closes history and appends a new explanation row'
);
select is(
  (select count(*)::integer
   from public.employee_compliance_profile_assignments
   where employee_id = '22000000-0000-4000-8000-000000000202'
     and profile_definition_id = '22000000-0000-4000-8000-000000000403'
     and effective_from <= current_date
     and (effective_to is null or effective_to > current_date)),
  1,
  'half-open assignment boundary exposes only the successor on its start date'
);
select is(
  (select count(*)::integer
   from public.employee_compliance_profile_assignments
   where employee_id = '22000000-0000-4000-8000-000000000202'
     and profile_definition_id = '22000000-0000-4000-8000-000000000403'
     and effective_from <= current_date - 1
     and (effective_to is null or effective_to > current_date - 1)),
  1,
  'half-open assignment boundary preserves the prior explanation before supersession'
);
select is(
  jsonb_array_length(public.explain_employee_compliance_profile(
    '22000000-0000-4000-8000-000000000202', current_date
  ) -> 'profiles'),
  3,
  'mandatory baseline, one primary, and an approved extension coexist'
);

reset role;
select throws_ok(
  $$ update public.compliance_profile_requirements
     set evidence_required = false
     where profile_definition_id = (
       select id from public.compliance_profile_definitions
       where is_mandatory_baseline
     ) and requirement_key = 'workforce.orientation' $$,
  '23514', null,
  'mandatory baseline cannot be weakened in place'
);

select pg_temp.act_as('22000000-0000-4000-8000-000000000102');
select throws_ok(
  $$ insert into public.employee_compliance_profile_assignments(
       organization_id, facility_id, employee_id, profile_definition_id,
       effective_from, source, reason
     ) values (
       '22000000-0000-4000-8000-000000000001',
       '22000000-0000-4000-8000-000000000012',
       '22000000-0000-4000-8000-000000000202',
       '22000000-0000-4000-8000-000000000403', current_date, 'manual', 'bypass'
     ) $$,
  '42501', null,
  'direct compliance assignment cannot bypass the governed RPC'
);

reset role;
select is(
  (select count(*)::integer
   from app_private.audit_entity_manifest
   where table_name in (
     'enterprise_portfolios', 'enterprise_regions',
     'enterprise_organization_memberships', 'enterprise_scope_memberships',
     'permission_definitions', 'role_templates', 'role_template_permissions',
     'enterprise_access_grants', 'enterprise_scope_backfill_exceptions',
     'workforce_people', 'workforce_employee_links', 'employment_episodes',
     'employment_lifecycle_events', 'employment_lifecycle_dispositions',
     'employee_access_suspensions',
     'workforce_backfill_exceptions', 'compliance_profile_definitions',
     'compliance_profile_requirements', 'compliance_profile_mapping_rules',
     'employee_compliance_profile_assignments',
     'compliance_profile_resolution_exceptions'
   )),
  21,
  'every Phase 2 scope/workforce table is classified in the audit manifest'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private')
      and p.proname in (
        'has_effective_permission', 'get_effective_access',
        'get_enterprise_scope_control_plane', 'grant_enterprise_role',
        'end_enterprise_role_grant', 'upsert_enterprise_role_template',
        'preview_employee_lifecycle_transition',
        'apply_employee_lifecycle_transition',
        'explain_employee_compliance_profile',
        'upsert_compliance_profile_assignment',
        'get_workforce_compliance_control_plane'
      )
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  ),
  'every privileged Phase 2 RPC has a fixed search_path'
);

select * from finish();
rollback;
