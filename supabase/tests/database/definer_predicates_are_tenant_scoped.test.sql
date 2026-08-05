begin;
select plan(10);

-- SECURITY DEFINER functions bypass RLS, so the ones that take an id and answer a question about it
-- have to check who is asking. Four did not, and answered about any tenant's staff:
-- is_employee_access_active, is_employee_assigned_to_facility, employee_has_active_qualification and
-- evaluate_duty_eligibility. 20260727070000 scoped them.
--
-- This test is the probe that found them, kept. It signs in as one organisation's ordinary user and
-- asks each function about ANOTHER organisation's rows, where the true answer is known and is not
-- the refusal value -- so a regression shows up as the truth leaking back rather than as silence.
--
-- The last assertion is the one that generalises: a catalogue sweep for definer functions that take
-- a uuid, are reachable by `authenticated`, and name no authorization helper at all. It is a named
-- allowlist rather than a count, because the interesting information is WHICH function, and because
-- three of the ten it originally returned were false positives whose authorization lives one or two
-- calls down a delegation chain.

insert into public.organizations(id, name, slug, subscription_status) values
  ('ca000000-0000-4000-8000-000000000001', 'Scope A', 'scope-a', 'active'),
  ('cb000000-0000-4000-8000-000000000001', 'Scope B', 'scope-b', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000001', 'A Facility', 'PCH'),
  ('cb000000-0000-4000-8000-000000000011', 'cb000000-0000-4000-8000-000000000001', 'B Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'ca000000-0000-4000-8000-000000000101',
   'authenticated', 'authenticated', 'scope-a@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'cb000000-0000-4000-8000-000000000101',
   'authenticated', 'authenticated', 'scope-b@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('ca000000-0000-4000-8000-000000000101', 'ca000000-0000-4000-8000-000000000001', 'scope-a@test.local', 'A', 'User', 'org_admin', true),
  ('cb000000-0000-4000-8000-000000000101', 'cb000000-0000-4000-8000-000000000001', 'scope-b@test.local', 'B', 'User', 'org_admin', true)
on conflict (id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- Org B's employee is active, staffed to B's facility, and holds a qualification. Every fact below
-- is TRUE, so "false" can only mean the scope test refused rather than the fact being absent.
insert into public.employees(id, organization_id, facility_id, profile_id, first_name, last_name,
                             email, job_title, hire_date, status) values
  ('cb000000-0000-4000-8000-000000000111', 'cb000000-0000-4000-8000-000000000001',
   'cb000000-0000-4000-8000-000000000011', 'cb000000-0000-4000-8000-000000000101',
   'B', 'Employee', 'scope-b@test.local', 'Direct Care Staff', public.pa_today() - 100, 'active');
-- (the employees insert trigger creates the facility assignment; inserting it again collides)

-- Sanity: as the owner, with no interactive caller, the facts really are true. Without this the
-- assertions below would pass just as well against a function that always returns false.
select ok(
  public.is_employee_access_active('cb000000-0000-4000-8000-000000000111'),
  'org B employee is genuinely active, so a later false is a refusal and not the truth'
);
select ok(
  public.is_employee_assigned_to_facility('cb000000-0000-4000-8000-000000000111',
                                          'cb000000-0000-4000-8000-000000000011'),
  'org B employee is genuinely staffed to org B facility'
);

-- Now become org A's user. None of the ids below belong to them.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-4000-8000-000000000101","role":"authenticated"}', true);

select ok(
  not public.is_employee_access_active('cb000000-0000-4000-8000-000000000111'),
  'another tenant is not told whether an employee is employed and unsuspended'
);
select ok(
  not public.is_employee_assigned_to_facility('cb000000-0000-4000-8000-000000000111',
                                              'cb000000-0000-4000-8000-000000000011'),
  'another tenant is not told which facilities an employee is staffed to'
);
select is(
  public.evaluate_duty_eligibility('cb000000-0000-4000-8000-000000000101', 'resident_assessor',
                                   'cb000000-0000-4000-8000-000000000011') -> 'outcome',
  '"ineligible"'::jsonb,
  'another tenant gets no duty verdict for a profile outside its organisation'
);
select is(
  public.evaluate_duty_eligibility('cb000000-0000-4000-8000-000000000101', 'resident_assessor',
                                   'cb000000-0000-4000-8000-000000000011') -> 'blocks',
  '["out_of_scope"]'::jsonb,
  'the refusal says only that it is out of scope -- blocks and warnings are where credential state would leak'
);
-- A refusal that differs from "no such profile" would be an existence oracle: ask about a random
-- uuid and compare. Both must look identical.
select is(
  public.evaluate_duty_eligibility('cb000000-0000-4000-8000-000000000101', 'resident_assessor',
                                   'cb000000-0000-4000-8000-000000000011'),
  public.evaluate_duty_eligibility('00000000-0000-0000-0000-0000000000fe', 'resident_assessor',
                                   'cb000000-0000-4000-8000-000000000011'),
  'a real out-of-tenant profile is indistinguishable from one that does not exist'
);

-- Within the caller's own tenant nothing changed: org A asking about org A still gets real answers.
reset role;
insert into public.employees(id, organization_id, facility_id, profile_id, first_name, last_name,
                             email, job_title, hire_date, status) values
  ('ca000000-0000-4000-8000-000000000111', 'ca000000-0000-4000-8000-000000000001',
   'ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000101',
   'A', 'Employee', 'scope-a@test.local', 'Direct Care Staff', public.pa_today() - 100, 'active');
-- (the employees insert trigger creates the facility assignment; inserting it again collides)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-4000-8000-000000000101","role":"authenticated"}', true);

select ok(
  public.is_employee_access_active('ca000000-0000-4000-8000-000000000111'),
  'the scope test does not break the answer for the caller own organisation'
);
select ok(
  public.is_employee_assigned_to_facility('ca000000-0000-4000-8000-000000000111',
                                          'ca000000-0000-4000-8000-000000000011'),
  'nor for a facility assignment inside the caller organisation'
);

reset role;

-- The sweep that found them, kept as a ratchet ---------------------------------------------------
--
-- Definer + takes a uuid + reachable by authenticated + no authorization helper named anywhere in
-- the body. The allowlist is every survivor that was checked by hand and found sound; adding to it
-- should mean someone traced the delegation chain the way get_resident_administrative_packet's was
-- traced (_before_calendar -> _before_dietary -> _base, which checks admission_row_visible).
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)')
   from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute')
     and 'uuid'::regtype = any(p.proargtypes::oid[])
     and p.prosrc !~* '(assert_|_in_caller_scope|current_org_id|current_role\(|is_platform_admin|is_assigned_to_facility|can_read_employee_peer_data|owns_employee|admission_row_visible|clinical_record_visible|current_session_unlocked|auth\.uid|auth\.jwt|current_profile_active|org_feature_enabled|require_|_visible\(|can_manage|can_view|is_member|_guest|p_token|preview_employee_lifecycle_transition)'
     and p.proname not in (
       -- Authorization proven to live one or two calls down, or no tenant data to disclose:
       'get_resident_administrative_packet',   -- _base checks admission_row_visible and raises 42501
       'save_report_schedule',                 -- delegates to save_report_schedule_configuration
       'evaluate_feature_access',              -- refuses cross-tenant (probed: 42501)
       'has_effective_entitlement',            -- refuses cross-tenant (probed: 42501)
       'course_version_is_published',          -- global course catalogue, no tenant scope
       'evaluate_shift_assignment_eligibility', -- reached only through assign_employee_to_shift
       -- delegates to app_private.record_service_task_response, which carries the identical
       -- manager-or-assigned-employee block from 20260726060100 and raises 42501. Split in
       -- 20260805040000 so the occurrence-time parameter stays off a surface granted to
       -- authenticated; the refusal is asserted through this public wrapper in
       -- support_plan_service_tasks.test.sql rather than left to this comment.
       'record_service_task_response'
     )),
  '(none)',
  'no SECURITY DEFINER function takes a uuid from authenticated without an authorization check'
);

select * from finish();
rollback;
