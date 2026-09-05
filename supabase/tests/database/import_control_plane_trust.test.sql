-- pgTAP coverage for 20260904130000: the import control plane recognises a trusted worker by its
-- JWT role or its JWT-less superuser session, never by `current_user` (which, inside a SECURITY
-- DEFINER function, is the owner for every caller). Every negative assertion here was a positive
-- outcome on the previous definition, reproduced on a clean replay on 2026-09-04.
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(18);

insert into public.organizations (id, name, slug) values
  ('c1000000-0000-4000-8000-000000000001', 'Trust Org A', 'trust-org-a'),
  ('c2000000-0000-4000-8000-000000000001', 'Trust Org B', 'trust-org-b');

insert into public.facilities (id, organization_id, name, facility_type) values
  ('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'Trust Facility A', 'PCH'),
  ('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'Trust Facility B', 'PCH');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', false, false
from (values
  ('c1000000-0000-4000-8000-000000000103'::uuid, 'trust-employee-a@test.local'),
  ('c1000000-0000-4000-8000-000000000104'::uuid, 'trust-admin-a@test.local')
) as v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active) values
  ('c1000000-0000-4000-8000-000000000103', 'c1000000-0000-4000-8000-000000000001', 'trust-employee-a@test.local', 'Trust', 'Employee', 'employee', true),
  ('c1000000-0000-4000-8000-000000000104', 'c1000000-0000-4000-8000-000000000001', 'trust-admin-a@test.local', 'Trust', 'Admin', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email, first_name = excluded.first_name,
  last_name = excluded.last_name, role = excluded.role, is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

-- An employee of organization B, with a facility assignment the old rollback would have deleted.
insert into public.employees (id, organization_id, facility_id, first_name, last_name, job_title, status)
values ('c2000000-0000-4000-8000-000000000205', 'c2000000-0000-4000-8000-000000000001',
        'c2000000-0000-4000-8000-000000000002', 'Other', 'Tenant', 'Aide', 'active');
insert into public.employee_facility_assignments (organization_id, employee_id, facility_id)
values ('c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000205',
        'c2000000-0000-4000-8000-000000000002')
on conflict do nothing;

-- An import job that belongs to organization B.
insert into public.data_import_jobs (id, organization_id, domain, original_file_name, original_file_sha256, total_rows, duplicate_strategy, status)
values ('c2000000-0000-4000-8000-000000000309', 'c2000000-0000-4000-8000-000000000001', 'employees', 'b.csv', repeat('b', 64), 1, 'create', 'uploaded');

-- An applied employee import in organization A whose ledger row points at organization B's
-- employee -- the shape a cross-tenant rollback needs.
insert into public.data_import_jobs (id, organization_id, domain, original_file_name, original_file_sha256, total_rows, duplicate_strategy, status, applied_at)
values ('c1000000-0000-4000-8000-000000000310', 'c1000000-0000-4000-8000-000000000001', 'employees', 'a.csv', repeat('a', 64), 1, 'create', 'applied', now());
insert into public.data_import_rows (organization_id, job_id, row_number, status, proposed_action, target_table, target_id, applied_at)
values ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000310', 2, 'applied', 'create', 'employees',
        'c2000000-0000-4000-8000-000000000205', now());

create or replace function pg_temp.act_as(p_profile_id uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_profile_id, 'role', 'authenticated', 'aal', 'aal2',
                       'iat', extract(epoch from now())::bigint)::text,
    true
  );
  set local role authenticated;
end
$$;

create or replace function pg_temp.act_as_worker() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
end
$$;

create or replace function pg_temp.act_as_superuser() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- ---------------------------------------------------------------------------------------
-- An employee is nobody's import manager
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as('c1000000-0000-4000-8000-000000000103');

select throws_ok(
  $$ select public.start_data_import_job('training_records', 'x.csv', repeat('1', 64), 1, 'create', null,
       'c1000000-0000-4000-8000-000000000001') $$,
  '42501',
  'Import manager permission required',
  'an employee cannot start an import in their own organization'
);
select throws_ok(
  $$ select public.start_data_import_job('training_records', 'x.csv', repeat('2', 64), 1, 'create', null,
       'c2000000-0000-4000-8000-000000000001') $$,
  '42501',
  'Import manager permission required',
  'an employee cannot start an import in another organization'
);
select throws_ok(
  $$ select public.record_data_import_chunk('c2000000-0000-4000-8000-000000000309', '[]'::jsonb, null, null) $$,
  '42501',
  'Import manager permission required',
  'an employee cannot record ledger rows on another organization''s job'
);
select throws_ok(
  $$ select public.rollback_employee_import_job('c1000000-0000-4000-8000-000000000310') $$,
  '42501',
  'Import manager permission required',
  'an employee cannot roll back an import'
);

-- ---------------------------------------------------------------------------------------
-- An org admin reaches the interactive branch, scoped to their own organization
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as('c1000000-0000-4000-8000-000000000104');

select lives_ok(
  $$ select public.start_data_import_job('employees', 'roster.csv', repeat('3', 64), 1, 'create', null, null) $$,
  'an org admin starts an import the way bulk-import-* calls it: no organization argument'
);
select is(
  (select organization_id from public.data_import_jobs where original_file_sha256 = repeat('3', 64)),
  'c1000000-0000-4000-8000-000000000001'::uuid,
  'the job lands in the admin''s own organization'
);
select lives_ok(
  $$ select public.start_data_import_job('employees', 'roster2.csv', repeat('4', 64), 1, 'create', null,
       'c2000000-0000-4000-8000-000000000001') $$,
  'an org admin naming another organization is not refused outright'
);
select is(
  (select organization_id from public.data_import_jobs where original_file_sha256 = repeat('4', 64)),
  'c1000000-0000-4000-8000-000000000001'::uuid,
  'but the job still lands in their own organization, not the one they named'
);
select throws_ok(
  $$ select public.record_data_import_chunk('c2000000-0000-4000-8000-000000000309', '[]'::jsonb, null, null) $$,
  '42501',
  'Import job is outside your scope',
  'an org admin cannot record ledger rows on another organization''s job'
);

-- The rollback: the ledger row points at organization B's employee. Blocked, and nothing of
-- that employee's is touched.
select lives_ok(
  $$ select public.rollback_employee_import_job('c1000000-0000-4000-8000-000000000310') $$,
  'rolling back a job whose row targets another tenant does not raise'
);
select is(
  (select (public.rollback_employee_import_job('c1000000-0000-4000-8000-000000000310') ->> 'blocked')::int),
  1,
  'the cross-tenant target is counted as blocked'
);
-- Read the other tenant's rows as the runner, not as the org admin, whose RLS cannot see them.
select pg_temp.act_as_superuser();
select is(
  (select count(*)::int from public.employee_facility_assignments
   where employee_id = 'c2000000-0000-4000-8000-000000000205'),
  1,
  'the other tenant''s facility assignment survives'
);
select ok(
  exists (select 1 from public.employees where id = 'c2000000-0000-4000-8000-000000000205'),
  'the other tenant''s employee survives'
);

-- ---------------------------------------------------------------------------------------
-- The worker and the superuser runner are still trusted
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as_worker();
select lives_ok(
  $$ select public.start_data_import_job('employees', 'worker.csv', repeat('5', 64), 1, 'create', null,
       'c2000000-0000-4000-8000-000000000001') $$,
  'a service-role session may start a job for any organization'
);
select is(
  (select organization_id from public.data_import_jobs where original_file_sha256 = repeat('5', 64)),
  'c2000000-0000-4000-8000-000000000001'::uuid,
  'and the job lands where the worker said'
);

select pg_temp.act_as_superuser();
select is(
  app_private.assert_import_manager('c2000000-0000-4000-8000-000000000309'),
  'c2000000-0000-4000-8000-000000000001'::uuid,
  'a JWT-less postgres session (cron, migrations, this runner) resolves a job''s organization'
);

select has_function('app_private', 'is_trusted_database_session', array[]::text[],
  'the trusted-session predicate exists');
select ok(
  not has_function_privilege('authenticated', 'app_private.is_trusted_database_session()', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.is_trusted_database_session()', 'EXECUTE'),
  'no browser role can execute the predicate'
);

select * from finish();
rollback;
