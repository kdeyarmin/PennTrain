-- pgTAP coverage for the 2026-09-06 release-readiness fix pass (BACKLOG Tier J).
--
-- The point of this file is the role it runs as. Two of the defects it covers shipped to
-- production on 2026-09-05 INSIDE fixes, past a green suite, for the same reason: every pgTAP
-- statement that touched the affected tables ran as the superuser, and `authenticated` is the only
-- role that hits the defect. So the shift-assignment and organization cases below run under
-- `set local role authenticated` with a real JWT claim, not as postgres.
--
-- Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(25);

insert into public.organizations(id, name, slug, subscription_status, trial_ends_at) values
  ('4c000000-0000-4000-8000-000000000001', 'Readiness Org', 'readiness-fix-org', 'trial', now() + interval '10 days'),
  ('4c000000-0000-4000-8000-000000000002', 'Readiness Demo', 'readiness-fix-demo', 'trial', now() + interval '10 days');
-- Through the privileged-write escape hatch, because the guard this file is about now reverts
-- is_demo for everybody else -- including the superuser running the fixture.
select set_config('app.privileged_write', 'on', true);
update public.organizations set is_demo = true, demo_seed_version = 1
  where id = '4c000000-0000-4000-8000-000000000002';
select set_config('app.privileged_write', 'off', true);

insert into public.facilities(id, organization_id, name, facility_type) values
  ('4c000000-0000-4000-8000-000000000011', '4c000000-0000-4000-8000-000000000001', 'Readiness Facility', 'PCH'),
  ('4c000000-0000-4000-8000-000000000012', '4c000000-0000-4000-8000-000000000002', 'Demo Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', '', '', false, false
from (values
  ('4c000000-0000-4000-8000-000000000101'::uuid, 'readiness-admin@test.local'),
  ('4c000000-0000-4000-8000-000000000102'::uuid, 'readiness-worker@test.local'),
  ('4c000000-0000-4000-8000-000000000103'::uuid, 'readiness-demo-admin@test.local')
) v(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('4c000000-0000-4000-8000-000000000101', '4c000000-0000-4000-8000-000000000001', 'readiness-admin@test.local', 'Read', 'Admin', 'org_admin', true),
  ('4c000000-0000-4000-8000-000000000102', '4c000000-0000-4000-8000-000000000001', 'readiness-worker@test.local', 'Read', 'Worker', 'employee', true),
  ('4c000000-0000-4000-8000-000000000103', '4c000000-0000-4000-8000-000000000002', 'readiness-demo-admin@test.local', 'Demo', 'Admin', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, email = excluded.email,
  first_name = excluded.first_name, last_name = excluded.last_name,
  role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('4c000000-0000-4000-8000-000000000101', '4c000000-0000-4000-8000-000000000011'),
  ('4c000000-0000-4000-8000-000000000103', '4c000000-0000-4000-8000-000000000012');

insert into public.employees(
  id, organization_id, facility_id, profile_id, employee_number, first_name, last_name,
  email, hire_date, job_title, status
) values (
  '4c000000-0000-4000-8000-000000000201', '4c000000-0000-4000-8000-000000000001',
  '4c000000-0000-4000-8000-000000000011', '4c000000-0000-4000-8000-000000000102',
  'RD-A', 'Read', 'Worker', 'readiness-worker@test.local', public.pa_today()-100, 'Direct Care Worker', 'active'
);
-- The employee insert already stamps a primary assignment through a trigger; this is here so the
-- fixture stays correct if that ever changes.
insert into public.employee_facility_assignments(organization_id, employee_id, facility_id, is_primary) values
  ('4c000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000201',
   '4c000000-0000-4000-8000-000000000011', true)
on conflict (employee_id, facility_id) do nothing;

insert into public.schedules(id, organization_id, facility_id, title, period_start, period_end, created_by, status) values
  ('4c000000-0000-4000-8000-000000000321', '4c000000-0000-4000-8000-000000000001',
   '4c000000-0000-4000-8000-000000000011', 'Published week', public.pa_today(), public.pa_today()+7,
   '4c000000-0000-4000-8000-000000000101', 'published'),
  ('4c000000-0000-4000-8000-000000000322', '4c000000-0000-4000-8000-000000000001',
   '4c000000-0000-4000-8000-000000000011', 'Draft week', public.pa_today()+8, public.pa_today()+14,
   '4c000000-0000-4000-8000-000000000101', 'draft');

insert into public.shift_assignments(
  id, organization_id, facility_id, schedule_id, employee_id, shift_date, start_time, end_time, status
) values
  ('4c000000-0000-4000-8000-000000000401', '4c000000-0000-4000-8000-000000000001',
   '4c000000-0000-4000-8000-000000000011', '4c000000-0000-4000-8000-000000000321',
   '4c000000-0000-4000-8000-000000000201', public.pa_today()+2, '08:00', '16:00', 'scheduled'),
  ('4c000000-0000-4000-8000-000000000402', '4c000000-0000-4000-8000-000000000001',
   '4c000000-0000-4000-8000-000000000011', '4c000000-0000-4000-8000-000000000322',
   '4c000000-0000-4000-8000-000000000201', public.pa_today()+9, '08:00', '16:00', 'scheduled');

create or replace function pg_temp.act_as(p_profile_id uuid, p_aal text default 'aal2')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', p_aal,
    'iat', extract(epoch from now())::bigint
  )::text, true);
  set local role authenticated;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- J1. The regression that took every manager edit of a shift assignment down.
--
-- `prevent_shift_assignment_overlap` was rewritten as an INVOKER trigger calling
-- app_private.shift_assignment_is_in_flight_swap(); a trigger body runs as the user executing the
-- statement, `authenticated` has no USAGE on app_private, and the only pgTAP that updated the
-- table did so as postgres. THIS is the assertion that was missing.
-- ---------------------------------------------------------------------------------------
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'prevent_shift_assignment_overlap'),
  true,
  'the shift-assignment overlap trigger runs as its definer, not as the browser role'
);
select ok(
  not has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  'authenticated still has no USAGE on app_private -- which is why the invoker trigger broke'
);

select pg_temp.act_as('4c000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ update public.shift_assignments set status = 'confirmed'
     where id = '4c000000-0000-4000-8000-000000000401' $$,
  'a manager can change a shift assignment status AS THE BROWSER ROLE'
);
select lives_ok(
  $$ update public.shift_assignments set start_time = '09:00'
     where id = '4c000000-0000-4000-8000-000000000401' $$,
  'a manager can retime a shift assignment as the browser role'
);
reset role;

-- ---------------------------------------------------------------------------------------
-- J76. The tenant could write its own entitlement input.
--
-- organizations_update deliberately admits an org_admin for their own row -- Settings uses it for
-- ai_features_enabled -- so this trigger is the only guard. It reverted four columns; trial_ends_at
-- and is_demo were not among them.
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as('4c000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ update public.organizations
     set trial_ends_at = now() + interval '75 years', is_demo = true, demo_seed_version = 1,
         contact_email = 'ops@readiness.test'
     where id = '4c000000-0000-4000-8000-000000000001' $$,
  'the write itself is still allowed -- the guard is a revert, not a refusal (plan_name and the '
  'subscription quartet are refused outright by protect_organization_billing_contract instead)'
);
reset role;

select ok(
  (select trial_ends_at from public.organizations where id = '4c000000-0000-4000-8000-000000000001')
    < now() + interval '1 year',
  'an org_admin cannot extend their own trial: trial_ends_at is reverted'
);
select is(
  (select coalesce(is_demo, false) from public.organizations where id = '4c000000-0000-4000-8000-000000000001'),
  false,
  'an org_admin cannot flip is_demo, which would switch off mandatory MFA for the tenant'
);
select is(
  (select contact_email from public.organizations where id = '4c000000-0000-4000-8000-000000000001'),
  'ops@readiness.test',
  'the columns a tenant is meant to own still save'
);

-- ---------------------------------------------------------------------------------------
-- J14. The step-up wall and the demo tenant.
-- ---------------------------------------------------------------------------------------
select pg_temp.act_as('4c000000-0000-4000-8000-000000000103');
select is(
  public.identity_operation_requires_aal2('identity_admin'),
  false,
  'a demo organization is exempt from the operation gate, as it already is from the login gate'
);
reset role;
select pg_temp.act_as('4c000000-0000-4000-8000-000000000101');
select is(
  public.identity_operation_requires_aal2('identity_admin'),
  true,
  'a real organization is not'
);
select is(
  public.identity_operation_requires_aal2('operational_admin'),
  false,
  'daily operational work is off the identity-administrator bar (BACKLOG J14)'
);
select is(
  public.identity_operation_requires_aal2('confidential_identity_reveal'),
  true,
  'unmasking a confidential reporter stays behind step-up'
);
reset role;

-- ---------------------------------------------------------------------------------------
-- J66, J73. Call-off guards, and the open-shift queue's first producer.
-- ---------------------------------------------------------------------------------------
update public.shift_assignments set status = 'completed'
  where id = '4c000000-0000-4000-8000-000000000401';
select pg_temp.act_as('4c000000-0000-4000-8000-000000000101');
select throws_ok(
  $$ select public.record_shift_call_off('4c000000-0000-4000-8000-000000000401', 'illness', 'Flu') $$,
  '22023',
  null,
  'a completed shift cannot be called off (BACKLOG J66)'
);
reset role;
update public.shift_assignments set status = 'scheduled'
  where id = '4c000000-0000-4000-8000-000000000401';

select pg_temp.act_as('4c000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.record_shift_call_off('4c000000-0000-4000-8000-000000000401', 'illness', 'Flu, out for the day') $$,
  'a scheduled shift on a published schedule can be called off'
);
reset role;
select is(
  (select count(*)::bigint from public.open_shift_opportunities
   where schedule_id = '4c000000-0000-4000-8000-000000000321'
     and shift_date = public.pa_today()+2 and status = 'open'),
  1::bigint,
  'the call-off posts the opening to the claim queue -- its first producer (BACKLOG J73)'
);

-- A DRAFT schedule posts no opening, and an employee cannot act on one at all.
select pg_temp.act_as('4c000000-0000-4000-8000-000000000102');
select throws_ok(
  $$ select public.record_shift_call_off('4c000000-0000-4000-8000-000000000402', 'illness', 'Flu') $$,
  '22023',
  null,
  'an employee cannot call off a shift on a schedule nobody has published (BACKLOG J66)'
);
reset role;

-- ---------------------------------------------------------------------------------------
-- Shapes that are cheaper to assert than to reproduce, but were each a live defect.
-- ---------------------------------------------------------------------------------------
select ok(
  pg_get_functiondef('public.review_credential_renewal_submission(uuid,text,jsonb,text)'::regprocedure)
    like '%not in (''clean'', ''not_scanned'')%',
  'credential renewal review accepts the not_scanned verdict the worker actually writes (J16)'
);
select ok(
  pg_get_functiondef('public.generate_schedule_assignments(uuid)'::regprocedure)
    like '%when check_violation then%',
  'schedule auto-fill skips an ineligible employee instead of aborting the run (J17)'
);
select ok(
  pg_get_functiondef('public.decide_shift_swap(uuid,boolean,text)'::regprocedure)
    like '%evaluate_shift_assignment_eligibility%',
  'swap approval asks the wrapper, so the shift definition''s requirements and rest rule count (J18)'
);
select ok(
  pg_get_functiondef('public.claim_open_shift(uuid)'::regprocedure)
    like '%evaluate_shift_assignment_eligibility%',
  'so does the claim path, now that the queue has a producer (J73)'
);
select ok(
  pg_get_functiondef('app_private.route_operational_work()'::regprocedure)
    like '%pa_midnight(((v_new->>''poc_due_date'')::date) + 1)%',
  'a plan of correction is due at the end of the Pennsylvania day, not midnight UTC (J15)'
);
select ok(
  pg_get_functiondef('public.update_work_item_assignment(uuid,uuid,text,timestamptz)'::regprocedure)
    like '%escalated_at = null%',
  'retiming a work item clears the escalation stamp (J60)'
);
select ok(
  pg_get_functiondef('public.rotate_integration_api_credential(uuid,timestamptz)'::regprocedure)
    like '%update public.fhir_integration_sources%',
  'rotating a credential repoints the sources bound to it (J9)'
);
select ok(
  pg_get_functiondef('public.run_policy_campaign_targeting()'::regprocedure)
    like '%c.closed_at is null%',
  'the declarative campaign sweep stops at a closed campaign (J8)'
);
select ok(
  pg_get_functiondef('public.resolve_survey_packet_guest_token(text)'::regprocedure)
    like '%assert_guest_request_allowed(''survey_packet_guest''%',
  'the survey-packet guest surface goes through the shared guest gate (J61)'
);

select * from finish();
rollback;
