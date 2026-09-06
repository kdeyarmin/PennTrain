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
select plan(58);

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
    like '%guest_request_denial(''survey_packet_guest''%',
  'the survey-packet guest surface goes through the shared guest gate (J61)'
);

-- ---------------------------------------------------------------------------------------
-- The second half of the fix pass. Same reasoning as above: assert the shape where
-- reproducing the whole path costs more than it proves, and reproduce it where the rule is
-- behavioural and the role matters.
-- ---------------------------------------------------------------------------------------

-- J2. A learner who exhausted the attempts had no way forward at all.
select ok(
  pg_get_functiondef('public.enforce_quiz_attempt_cap()'::regprocedure)
    like '%additional_attempts_granted%',
  'the attempt cap counts what a manager has granted on the assignment (J2)'
);
select has_function('public', 'grant_additional_quiz_attempt', array['uuid', 'text'],
  'a manager can grant another attempt');
select has_function('public', 'cancel_course_assignment', array['uuid', 'text'],
  'and can close a dead assignment so a replacement can be assigned');

-- J26. The bridge stops rewriting a finished cycle.
select is(
  (select count(*)::bigint from regexp_matches(
     pg_get_functiondef('public.complete_course_assignment(uuid)'::regprocedure),
     'status not in \(''compliant'', ''pending_review''\)', 'g')),
  2::bigint,
  'both compliance bridges refuse to overwrite a compliant record or an audience shell (J26)'
);

-- J27. The server reads video_state.
select ok(
  pg_get_functiondef('public.complete_course_assignment(uuid)'::regprocedure)
    like '%course_video_blocks_watched%',
  'completing a course asks whether its video blocks were watched (J27)'
);

-- J30. A cross-facility class is runnable by the trainer who owns it.
select is(
  (select count(*)::bigint from (values
     ('checkin_via_kiosk_pin'), ('complete_training_class'), ('generate_class_checkin_token')
   ) as t(fn)
   where pg_get_functiondef(('public.' || t.fn)::regproc)
     like '%v_class.facility_id is null%'),
  3::bigint,
  'all three trainer class gates admit a class with no facility (J30)'
);

-- J33. The compliance clock follows the admission date.
select has_trigger('public', 'residents', 'rederive_compliance_due_dates',
  'moving the admission date moves the deadlines measured from it (J33)');

-- J34. The float aide at their second site.
select ok(
  public.employee_serves_facility(
    '4c000000-0000-4000-8000-000000000201', '4c000000-0000-4000-8000-000000000011'),
  'an employee serves their primary facility'
);
insert into public.facilities(id, organization_id, name, facility_type) values
  ('4c000000-0000-4000-8000-000000000013', '4c000000-0000-4000-8000-000000000001', 'Second Site', 'PCH');
insert into public.employee_facility_assignments(organization_id, employee_id, facility_id, is_primary) values
  ('4c000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000201',
   '4c000000-0000-4000-8000-000000000013', false)
on conflict (employee_id, facility_id) do nothing;
select ok(
  public.employee_serves_facility(
    '4c000000-0000-4000-8000-000000000201', '4c000000-0000-4000-8000-000000000013'),
  'and every facility they are assigned to, which is what scheduling has always honoured (J34)'
);
select ok(
  not has_function_privilege('authenticated', 'public.employee_serves_facility(uuid, uuid)', 'EXECUTE'),
  'the helper is not reachable from the browser -- it takes an employee id and checks nothing itself'
);

-- J36. A change of condition no longer turns the resident red the next morning.
select ok(
  (select rp.offset_days from public.resident_compliance_rule_packs rp
   where rp.item_type = 'significant_change_reassessment' and rp.facility_type = 'PCH'
     and rp.organization_id is null) > 0,
  'the significant-change reassessment has a window in the rule pack rather than being due today (J36)'
);
select ok(
  pg_get_functiondef((
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_resident_change_event'
  )) like '%resident_compliance_rule_packs%',
  'and create_resident_change_event reads it'
);

-- J37. The money can be given back.
select has_function('public', 'close_resident_personal_fund_account',
  array['uuid', 'text', 'text', 'timestamptz', 'uuid'],
  'a discharged resident''s personal funds can be settled and the account closed (J37)');
select ok(
  (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conrelid = 'public.resident_personal_fund_transactions'::regclass
     and c.conname = 'resident_personal_fund_transactions_transaction_kind_check')
    like '%final_disbursement%',
  'and the ledger has a terminal transaction kind to record it with'
);

-- J39, J50, J40. The import ledger, the external id, and the units.
select has_column('public', 'residents', 'external_id',
  'the import''s external id has its own column rather than living in preferred_name (J39)');
select is(
  (select module_key from app_private.product_module_resources
   where resource_schema = 'public' and resource_name = 'facility_units'),
  'modules.workforce',
  'facility_units follows the shifts that reference it (J50)'
);
select is(
  (select count(*)::bigint from pg_policy
   where polname = 'import_ledger_facility_scope'),
  3::bigint,
  'the import ledger is scoped to the facilities a manager manages (J40)'
);

-- J56. The crosswalk can find a governed rule.
select is(
  (select count(*)::bigint from public.regulatory_rule_pack_templates
   where applicability->>'crosswalkObligationId' = 'staff-training'),
  3::bigint,
  'every seeded personnel template names the crosswalk obligation it governs (J56)'
);

-- J78, J82. The kill switch and the watchdog.
select ok(
  app_private.kill_switch_can_stop_job('notification-dispatch'),
  'the switch stops an Edge-cron job, which it always did and the console denied (J78)'
);
select ok(
  not app_private.kill_switch_can_stop_job('system-job-watchdog'),
  'and does not stop the watchdog, which is the one deliberate exemption'
);
select is(
  (select retry_mode from app_private.system_job_definitions where job_key = 'system-job-watchdog'),
  'none',
  'the watchdog offers no manual re-run, so Run now stops writing a false failed run (J82)'
);

-- J80. One definition of compliant.
select ok(
  pg_get_functiondef((
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'generate_paged_compliance_report'
  )) like '%current_training_records%',
  'the compliance report counts the current record per employee and type, as the dashboard does (J80)'
);
select ok(
  pg_get_functiondef('public.get_platform_health()'::regprocedure) like '%is_demo, false)%',
  'and the platform tiles stop counting demo tenants as customers (J80)'
);

-- ---------------------------------------------------------------------------------------
-- The two RPCs whose whole job is a write. Asserting their shape is not enough: `db lint`
-- caught two column names in this branch that no other gate reads deeply enough to see, and
-- a definer function that raises on its own UPDATE looks identical to a working one from
-- outside. So these are called, as a real caller, and their effects are read back.
-- ---------------------------------------------------------------------------------------
insert into public.incidents(id, organization_id, facility_id, incident_type, occurred_at, narrative, severity)
values ('4c000000-0000-4000-8000-000000000601', '4c000000-0000-4000-8000-000000000001',
  '4c000000-0000-4000-8000-000000000011', 'significant_injury', now() - interval '2 days',
  'Readiness narrative', 'moderate');
insert into public.corrective_actions(
  id, organization_id, facility_id, incident_id, description, due_date, status
) values (
  '4c000000-0000-4000-8000-000000000611', '4c000000-0000-4000-8000-000000000001',
  '4c000000-0000-4000-8000-000000000011', '4c000000-0000-4000-8000-000000000601',
  'Retrain the aide on transfers', public.pa_today() + 7, 'open'
);

select pg_temp.act_as('4c000000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.verify_corrective_action(
       '4c000000-0000-4000-8000-000000000611',
       'Observed the aide complete an unaided transfer on three residents.') $$,
  'a corrective action can be completed and verified in one call (J13)'
);
reset role;
select results_eq(
  $$ select status, (verification_notes is not null), (verified_by is not null), (verified_at is not null)
     from public.corrective_actions where id = '4c000000-0000-4000-8000-000000000611' $$,
  $$ values ('completed'::text, true, true, true) $$,
  'and all four columns move together, which is what approve_incident_investigation reads'
);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('4c000000-0000-4000-8000-000000000701', '4c000000-0000-4000-8000-000000000001',
  '4c000000-0000-4000-8000-000000000011', 'Readiness', 'Resident', public.pa_today() - 200, 'active');
insert into public.resident_personal_fund_accounts(
  organization_id, facility_id, resident_id, account_number, opened_on, beginning_balance, created_by
) values (
  '4c000000-0000-4000-8000-000000000001', '4c000000-0000-4000-8000-000000000011',
  '4c000000-0000-4000-8000-000000000701', 'PF-READINESS001', public.pa_today() - 150, 40.00,
  '4c000000-0000-4000-8000-000000000101'
);

select pg_temp.act_as('4c000000-0000-4000-8000-000000000101');
select throws_ok(
  $$ select public.close_resident_personal_fund_account(
       '4c000000-0000-4000-8000-000000000701', 'Balance returned', 'Readiness Resident') $$,
  '55000',
  null,
  'a living resident''s personal funds account is not settled -- that is the end of a residency (J37)'
);
reset role;
update public.residents set status = 'discharged', discharge_date = public.pa_today()
where id = '4c000000-0000-4000-8000-000000000701';

select pg_temp.act_as('4c000000-0000-4000-8000-000000000101');
select is(
  (public.close_resident_personal_fund_account(
     '4c000000-0000-4000-8000-000000000701',
     'Balance returned at discharge', 'Jordan Next-of-kin')).amount,
  40.00::numeric,
  'settling a discharged resident''s account returns the whole balance (J37)'
);
reset role;
select results_eq(
  $$ select amount_returned, recipient, (final_transaction_id is not null)
     from public.resident_personal_fund_account_closures
     where resident_id = '4c000000-0000-4000-8000-000000000701' $$,
  $$ values (40.00::numeric, 'Jordan Next-of-kin'::text, true) $$,
  'and the closure is its own append-only row, because the account row cannot be updated at all'
);
select throws_ok(
  $$ update public.resident_personal_fund_account_closures set recipient = 'Someone else'
     where resident_id = '4c000000-0000-4000-8000-000000000701' $$,
  '55000',
  null,
  'which is itself append-only, like the ledger it settles'
);

-- The two Train RPCs, also called rather than merely described: the trap they open is a learner who
-- cannot move, so a signature that exists and raises is no better than no signature at all.
-- A real published course rather than a fixture one. Publishing a course version runs a readiness
-- check only a platform admin may call, and reproducing it here would test the seed rather than the
-- two RPCs; the seeded catalogue already has published courses, and any of them will do.
create temporary table pg_temp_readiness_course as
select c.id as course_id, c.current_version_id as version_id
from public.courses c
where c.status = 'published' and c.current_version_id is not null
order by c.created_at, c.id
limit 1;

insert into public.course_assignments(
  id, organization_id, facility_id, employee_id, course_id, course_version_id, assigned_by, due_date, status
)
select
  '4c000000-0000-4000-8000-000000000821', '4c000000-0000-4000-8000-000000000001',
  '4c000000-0000-4000-8000-000000000011', '4c000000-0000-4000-8000-000000000201',
  r.course_id, r.version_id, '4c000000-0000-4000-8000-000000000101',
  public.pa_today() + 30, 'assigned'
from pg_temp_readiness_course r;

select pg_temp.act_as('4c000000-0000-4000-8000-000000000101');
select is(
  (public.grant_additional_quiz_attempt(
     '4c000000-0000-4000-8000-000000000821',
     'They failed the third attempt on a question the video does not cover.')).additional_attempts_granted,
  1,
  'a manager can grant the attempt that unsticks an exhausted learner (J2)'
);
select throws_ok(
  $$ select public.cancel_course_assignment('4c000000-0000-4000-8000-000000000821', 'too short') $$,
  '22023',
  null,
  'cancelling takes a real reason, because it closes a training obligation'
);
select is(
  (public.cancel_course_assignment(
     '4c000000-0000-4000-8000-000000000821',
     'Superseded by the 2026 revision of this course; reassigning that instead.')).status,
  'canceled',
  'and closes the assignment so the one-open-assignment index admits a replacement (J2)'
);
reset role;
select ok(
  (select canceled_at is not null and cancellation_reason is not null
   from public.course_assignments where id = '4c000000-0000-4000-8000-000000000821'),
  'with the three columns the table''s check constraint requires moving together'
);

select * from finish();
rollback;
