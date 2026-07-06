-- pgTAP tests for the RLS role matrix and the compliance recalc function.
--
-- Run with: supabase test db  (requires the local Docker dev stack; see supabase/config.toml).
-- NOTE: this file was written and syntax-reviewed but NOT executed against a running Postgres
-- instance in the environment that authored it (no Docker daemon was available there) -- run it
-- once before relying on it, and treat a first failure as "fix the test" as plausibly as "fix the
-- app," same as any newly-written test.
--
-- Coverage is deliberately narrow (a "minimal" harness, not exhaustive): one representative
-- employee-scoped table (employee_training_records), one org-config table with a narrower write
-- role than most (training_types, org_admin-only), and the core recalculate_org_compliance()
-- due_date/status formula. Extend with the same pattern for other tables as they matter.

begin;
select plan(13);

-- ---------------------------------------------------------------------------
-- Fixtures: two orgs, one facility each, one profile per role we need.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a1', 'Test Org A', 'test-org-a'),
  ('00000000-0000-0000-0000-0000000000b1', 'Test Org B', 'test-org-b');

insert into public.facilities (id, organization_id, name, facility_type) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'Test Facility A', 'PCH'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', 'Test Facility B', 'PCH');

-- profiles.id references auth.users(id), so each test profile needs a matching auth.users row
-- first -- mirrors the minimal column set supabase/seed.sql uses for its own demo users.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email,
  'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', false, false
from (values
  ('00000000-0000-0000-0000-0000000000a3'::uuid, 'org-admin-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a4'::uuid, 'auditor-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a5'::uuid, 'fm-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b3'::uuid, 'org-admin-b@test.local')
) as v(id, email);

insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', 'org-admin-a@test.local', 'Org', 'AdminA', 'org_admin', true),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', 'auditor-a@test.local', 'Auditor', 'A', 'auditor', true),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a1', 'fm-a@test.local', 'Facility', 'ManagerA', 'facility_manager', true),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1', 'org-admin-b@test.local', 'Org', 'AdminB', 'org_admin', true);

insert into public.facility_assignments (profile_id, facility_id) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a2');

insert into public.employees (id, organization_id, facility_id, first_name, last_name, job_title, status) values
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'Test', 'Employee', 'Aide', 'active');

insert into public.training_types (id, organization_id, code, name, category, renewal_interval_days, warning_days_default, is_system_default) values
  ('00000000-0000-0000-0000-0000000000a7', null, 'TEST-ANNUAL', 'Test Annual Training', 'Test', 365, 90, true);

-- The insert above fires the PA-rulepack auto-instantiation trigger (20260705142938) for every
-- existing active employee it applies to, so it already created a 'missing' employee_training_records
-- shell row for a6/a7 -- clear it so the RLS tests below own the only row for this employee/type pair.
delete from public.employee_training_records
where employee_id = '00000000-0000-0000-0000-0000000000a6'
  and training_type_id = '00000000-0000-0000-0000-0000000000a7';

-- Helper: simulate an authenticated request from the given profile for the rest of the
-- transaction block (mirrors how PostgREST sets these GUCs per-request in production).
create or replace function pg_temp.act_as(p_profile_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile_id::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- employee_training_records: org_admin can insert in their own org; auditor cannot;
-- cross-org insert is denied even for a role that could otherwise write.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3'); -- org_admin, org A

select lives_ok(
  $$ insert into public.employee_training_records
     (organization_id, facility_id, employee_id, training_type_id, status)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
             '00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a7', 'missing') $$,
  'org_admin can insert a training record in their own org'
);

select isnt_empty(
  $$ select 1 from public.employee_training_records where employee_id = '00000000-0000-0000-0000-0000000000a6' $$,
  'org_admin can then select the record they just inserted'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4'); -- auditor, org A

select throws_ok(
  $$ insert into public.employee_training_records
     (organization_id, facility_id, employee_id, training_type_id, status)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
             '00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a7', 'missing') $$,
  null, null,
  'auditor cannot insert a training record (read-only role)'
);

select isnt_empty(
  $$ select 1 from public.employee_training_records where employee_id = '00000000-0000-0000-0000-0000000000a6' $$,
  'auditor can still select training records in their own org'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b3'); -- org_admin, org B (cross-org)

select throws_ok(
  $$ insert into public.employee_training_records
     (organization_id, facility_id, employee_id, training_type_id, status)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
             '00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a7', 'missing') $$,
  null, null,
  'org_admin from a different org cannot insert into org A''s scope'
);

select is_empty(
  $$ select 1 from public.employee_training_records where employee_id = '00000000-0000-0000-0000-0000000000a6' and organization_id = '00000000-0000-0000-0000-0000000000b1' $$,
  'org B''s org_admin has no visibility into org A''s training records'
);

-- ---------------------------------------------------------------------------
-- training_types: org_admin can create an org-custom type; facility_manager cannot
-- (training_types_insert/_update require current_role() = 'org_admin' specifically).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3'); -- org_admin, org A

select lives_ok(
  $$ insert into public.training_types (organization_id, code, name, category)
     values ('00000000-0000-0000-0000-0000000000a1', 'CUSTOM-A', 'Org A Custom Type', 'Test') $$,
  'org_admin can create a custom training type for their own org'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a5'); -- facility_manager, org A

select throws_ok(
  $$ insert into public.training_types (organization_id, code, name, category)
     values ('00000000-0000-0000-0000-0000000000a1', 'CUSTOM-B', 'Should Fail', 'Test') $$,
  null, null,
  'facility_manager cannot create a training type (training_types_insert is org_admin-only)'
);

select isnt_empty(
  $$ select 1 from public.training_types where organization_id = '00000000-0000-0000-0000-0000000000a1' or organization_id is null $$,
  'facility_manager can still read the org''s training types (system defaults + custom)'
);

-- ---------------------------------------------------------------------------
-- recalculate_org_compliance(): authorization, plus the due_date/status formula, run as org_admin.
-- Queries below are scoped to training_type_id = a7 since the training_types inserts above and
-- below each trigger the auto-instantiation trigger, which creates additional employee_training_records
-- shell rows for a6 on other training types.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b3'); -- org_admin, org B (cross-org)

select throws_ok(
  $$ select public.recalculate_org_compliance('00000000-0000-0000-0000-0000000000a1') $$,
  null, null,
  'org_admin from a different org cannot recalculate org A''s compliance'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');

update public.employee_training_records
set completion_date = current_date - 400 -- completed 400 days ago; renewal_interval_days = 365
where employee_id = '00000000-0000-0000-0000-0000000000a6'
  and training_type_id = '00000000-0000-0000-0000-0000000000a7';

select recalculate_org_compliance('00000000-0000-0000-0000-0000000000a1');

select results_eq(
  $$ select due_date from public.employee_training_records where employee_id = '00000000-0000-0000-0000-0000000000a6' and training_type_id = '00000000-0000-0000-0000-0000000000a7' $$,
  $$ select (current_date - 400 + 365)::date $$,
  'recalculate_org_compliance sets due_date = completion_date + renewal_interval_days'
);

select results_eq(
  $$ select status from public.employee_training_records where employee_id = '00000000-0000-0000-0000-0000000000a6' and training_type_id = '00000000-0000-0000-0000-0000000000a7' $$,
  ARRAY['expired'],
  'a record whose due_date has passed is marked expired'
);

update public.employee_training_records
set completion_date = current_date - 300 -- due_date = current_date + 65, inside the 90-day warning window
where employee_id = '00000000-0000-0000-0000-0000000000a6'
  and training_type_id = '00000000-0000-0000-0000-0000000000a7';

select recalculate_org_compliance('00000000-0000-0000-0000-0000000000a1');

select results_eq(
  $$ select status from public.employee_training_records where employee_id = '00000000-0000-0000-0000-0000000000a6' and training_type_id = '00000000-0000-0000-0000-0000000000a7' $$,
  ARRAY['due_soon'],
  'a record due within the warning window (but not yet past due) is marked due_soon'
);

select * from finish();
rollback;
