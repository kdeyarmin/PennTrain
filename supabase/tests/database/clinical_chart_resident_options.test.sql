begin;
select plan(18);

-- Authorization coverage for public.get_clinical_chart_resident_options, the resident picker behind
-- the employee caregiver charting surface (/me/residents). Employees have no direct RLS reach to
-- public.residents at all, so this SECURITY DEFINER function is the ONLY way that role learns a
-- resident exists -- which makes its negative cases (another facility, another org, an inactive
-- employee) the actual PHI boundary, not a UI concern. Tested both ways, per the program's standing
-- requirement that every new RPC carry positive and negative authorization tests.

select has_function('public', 'get_clinical_chart_resident_options', 'caregiver roster RPC exists');
select ok(
  not has_function_privilege('anon', 'public.get_clinical_chart_resident_options()', 'EXECUTE'),
  'anonymous callers cannot enumerate residents'
);

-- Fixtures ------------------------------------------------------------------------------
-- Org A has two facilities; org B is the cross-tenant control.
insert into public.organizations(id, name, slug, subscription_status) values
  ('c2000000-0000-4000-8000-000000000001', 'Roster Org A', 'roster-org-a', 'active'),
  ('c2000000-0000-4000-8000-000000000002', 'Roster Org B', 'roster-org-b', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('c2000000-0000-4000-8000-000000000011', 'c2000000-0000-4000-8000-000000000001', 'Roster A1', 'PCH'),
  ('c2000000-0000-4000-8000-000000000012', 'c2000000-0000-4000-8000-000000000001', 'Roster A2', 'ALR'),
  ('c2000000-0000-4000-8000-000000000021', 'c2000000-0000-4000-8000-000000000002', 'Roster B1', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'c2000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'r-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c2000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'r-a1-emp@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c2000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'r-a2-emp@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c2000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'r-auditor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c2000000-0000-4000-8000-000000000105', 'authenticated', 'authenticated', 'r-trainer@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c2000000-0000-4000-8000-000000000106', 'authenticated', 'authenticated', 'r-inactive-emp@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c2000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'r-b-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('c2000000-0000-4000-8000-000000000101', 'c2000000-0000-4000-8000-000000000001', 'r-admin@test.local', 'Ada', 'Admin', 'org_admin', true),
  ('c2000000-0000-4000-8000-000000000102', 'c2000000-0000-4000-8000-000000000001', 'r-a1-emp@test.local', 'Ann', 'Aide', 'employee', true),
  ('c2000000-0000-4000-8000-000000000103', 'c2000000-0000-4000-8000-000000000001', 'r-a2-emp@test.local', 'Al', 'Aide', 'employee', true),
  ('c2000000-0000-4000-8000-000000000104', 'c2000000-0000-4000-8000-000000000001', 'r-auditor@test.local', 'Ivy', 'Auditor', 'auditor', true),
  ('c2000000-0000-4000-8000-000000000105', 'c2000000-0000-4000-8000-000000000001', 'r-trainer@test.local', 'Tom', 'Trainer', 'trainer', true),
  ('c2000000-0000-4000-8000-000000000106', 'c2000000-0000-4000-8000-000000000001', 'r-inactive-emp@test.local', 'Ida', 'Inactive', 'employee', true),
  ('c2000000-0000-4000-8000-000000000201', 'c2000000-0000-4000-8000-000000000002', 'r-b-admin@test.local', 'Bob', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- Ann is active at A1; Al is active at A2; Ida's employment is terminated (still an employee-role
-- profile, which is exactly the case a role check alone would wave through).
insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status
) values
  ('c2000000-0000-4000-8000-000000000112', 'c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000011', 'c2000000-0000-4000-8000-000000000102', 'Ann', 'Aide', 'r-a1-emp@test.local', 'Direct Care Staff', public.pa_today(), 'active'),
  ('c2000000-0000-4000-8000-000000000113', 'c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000012', 'c2000000-0000-4000-8000-000000000103', 'Al', 'Aide', 'r-a2-emp@test.local', 'Direct Care Staff', public.pa_today(), 'active'),
  ('c2000000-0000-4000-8000-000000000116', 'c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000011', 'c2000000-0000-4000-8000-000000000106', 'Ida', 'Inactive', 'r-inactive-emp@test.local', 'Direct Care Staff', public.pa_today(), 'terminated');

-- Two present residents at A1 (ordering check), one at A2, one in org B, plus a discharged and a
-- deceased resident at A1 that must not appear on a working roster.
insert into public.residents(id, organization_id, facility_id, first_name, last_name, room, admission_date, status) values
  ('c2000000-0000-4000-8000-000000000301', 'c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000011', 'Rosa', 'Alvarez', '12A', public.pa_today() - 30, 'active'),
  ('c2000000-0000-4000-8000-000000000302', 'c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000011', 'Sam', 'Nguyen', '7', public.pa_today() - 20, 'hospital_leave'),
  ('c2000000-0000-4000-8000-000000000303', 'c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000012', 'Tess', 'Okafor', '3', public.pa_today() - 10, 'active'),
  ('c2000000-0000-4000-8000-000000000304', 'c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000011', 'Dana', 'Discharged', '9', public.pa_today() - 200, 'discharged'),
  ('c2000000-0000-4000-8000-000000000305', 'c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000011', 'Dean', 'Deceased', '10', public.pa_today() - 300, 'deceased'),
  ('c2000000-0000-4000-8000-000000000401', 'c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000021', 'Bea', 'Other', '1', public.pa_today() - 5, 'active');

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal1',
      'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end $$;

-- Assigned employee: sees their own facility, and only present residents -------------------
select pg_temp.act_as('c2000000-0000-4000-8000-000000000102');
select is(
  (select count(*)::integer from public.get_clinical_chart_resident_options()),
  2,
  'an assigned employee sees the active and hospital-leave residents at their facility'
);
select is(
  (select string_agg(last_name, ',' order by last_name) from public.get_clinical_chart_resident_options()),
  'Alvarez,Nguyen',
  'discharged and deceased residents are excluded from a working roster'
);
select ok(
  not exists (
    select 1 from public.get_clinical_chart_resident_options()
    where id = 'c2000000-0000-4000-8000-000000000303'
  ),
  'an employee cannot see a resident at another facility in their own organization'
);
select ok(
  not exists (
    select 1 from public.get_clinical_chart_resident_options()
    where id = 'c2000000-0000-4000-8000-000000000401'
  ),
  'an employee cannot see a resident in another organization'
);
select is(
  (select room from public.get_clinical_chart_resident_options()
   where id = 'c2000000-0000-4000-8000-000000000301'),
  '12A',
  'the roster carries the room label the picker displays'
);

-- The other facility's employee sees the mirror image ------------------------------------
select pg_temp.act_as('c2000000-0000-4000-8000-000000000103');
select is(
  (select count(*)::integer from public.get_clinical_chart_resident_options()),
  1,
  'an employee at the second facility sees only that facility''s resident'
);
select is(
  (select last_name from public.get_clinical_chart_resident_options()),
  'Okafor',
  'and it is the resident actually housed there'
);

-- A terminated employee keeps the employee role and loses the roster ----------------------
select pg_temp.act_as('c2000000-0000-4000-8000-000000000106');
select is(
  (select count(*)::integer from public.get_clinical_chart_resident_options()),
  0,
  'an employee whose employment is terminated sees no residents'
);

-- Manager-side roles ----------------------------------------------------------------------
select pg_temp.act_as('c2000000-0000-4000-8000-000000000101');
select is(
  (select count(*)::integer from public.get_clinical_chart_resident_options()),
  3,
  'an org admin sees present residents across every facility in the organization'
);
select is(
  (select string_agg(last_name, ',') from public.get_clinical_chart_resident_options()),
  'Alvarez,Nguyen,Okafor',
  'results are ordered by last name then first name'
);

select pg_temp.act_as('c2000000-0000-4000-8000-000000000104');
select is(
  (select count(*)::integer from public.get_clinical_chart_resident_options()),
  3,
  'an auditor can read the roster (read-only clinical access)'
);

select pg_temp.act_as('c2000000-0000-4000-8000-000000000105');
select is(
  (select count(*)::integer from public.get_clinical_chart_resident_options()),
  0,
  'a trainer sees no residents -- trainers have no clinical reach at all'
);

-- The cross-tenant control. Org B's admin is not blind -- they see their OWN resident -- so the
-- assertion that matters is that org A's residents are absent, not that the list is empty. An
-- earlier revision of this test asserted a count of zero and failed for the right reason: the
-- fixture gives org B a resident precisely so "sees nothing at all" cannot pass vacuously.
select pg_temp.act_as('c2000000-0000-4000-8000-000000000201');
select is(
  (select count(*)::integer from public.get_clinical_chart_resident_options()),
  1,
  'an org admin from another organization sees only their own organization''s resident'
);
select is(
  (select last_name from public.get_clinical_chart_resident_options()),
  'Other',
  'and it is org B''s resident, never one of org A''s'
);

-- The roster is a filter, not an assertion: an unauthorized caller gets an empty list rather than an
-- error, so the picker renders "no residents" instead of a failure state. Enumerating a resident is
-- the thing that must be impossible; being told "none" is not a leak.
select pg_temp.act_as('c2000000-0000-4000-8000-000000000105');
select lives_ok(
  $$select * from public.get_clinical_chart_resident_options()$$,
  'an unauthorized caller receives an empty roster rather than an exception'
);

-- Reading the roster is not a chart view, so it must not manufacture access-log noise ------
reset role;
select is(
  (select count(*)::integer from app_private.clinical_access_log
   where resident_id in (
     'c2000000-0000-4000-8000-000000000301', 'c2000000-0000-4000-8000-000000000302',
     'c2000000-0000-4000-8000-000000000303'
   )),
  0,
  'listing the roster writes no clinical access-log rows (only opening a chart does)'
);

select * from finish();
rollback;
