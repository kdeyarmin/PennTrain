begin;
select plan(9);

-- complete_hospital_return_reconciliation had no test at all when it shipped in 20260726070100, and
-- it was broken on its main path: appending to a text[] with `v_outstanding := v_outstanding || 'x'`
-- raises 22P02 "malformed array literal", because a bare quoted literal is `unknown` and Postgres
-- resolves `anyarray || unknown` as array-to-array. So the function succeeded only when nothing was
-- outstanding, and died with a raw type error in every case it exists to handle.
--
-- The order of the assertions below is the point. The gap cases run FIRST. A test that closes a
-- complete episode passes just as happily against the broken function, so writing the happy path
-- first would have produced a green test over a function that could not do its job -- which is how
-- this got here.

insert into public.organizations(id, name, slug, subscription_status)
values ('7a000000-0000-4000-8000-000000000001', 'Return Org', 'return-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type)
values ('7a000000-0000-4000-8000-000000000011', '7a000000-0000-4000-8000-000000000001', 'Return Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '7a000000-0000-4000-8000-000000000101',
   'authenticated', 'authenticated', 'return-manager@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values ('7a000000-0000-4000-8000-000000000101', '7a000000-0000-4000-8000-000000000001',
        'return-manager@test.local', 'Return', 'Manager', 'org_admin', true)
on conflict(id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('7a000000-0000-4000-8000-000000000201', '7a000000-0000-4000-8000-000000000001',
        '7a000000-0000-4000-8000-000000000011', 'Ronan', 'Returned', public.pa_today() - 90, 'active');

-- An episode back from hospital with every reconciliation gap still open.
insert into public.hospital_transfer_episodes(
  id, organization_id, facility_id, resident_id, reason, destination, transfer_time,
  transport_method, status, return_time, discharge_document_id,
  medication_reconciliation_status, changed_order_ack_status,
  assessment_review_required, support_plan_review_required
) values (
  '7a000000-0000-4000-8000-000000000301', '7a000000-0000-4000-8000-000000000001',
  '7a000000-0000-4000-8000-000000000011', '7a000000-0000-4000-8000-000000000201',
  'Fall with head strike', 'York Hospital', now() - interval '3 days',
  'ems', 'returned', now() - interval '4 hours', null,
  'pending', 'pending_review', true, true
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"7a000000-0000-4000-8000-000000000101","role":"authenticated"}', true);

-- The failing path, first ------------------------------------------------------------------------
--
-- errcode 22023 is invalid_parameter_value, the code the function raises deliberately. 22P02 is
-- invalid_text_representation -- the malformed-array-literal error. Asserting on the code rather
-- than just "it throws" is what separates a working refusal from a crash: the broken function threw
-- too, which is why "does it raise?" would not have caught anything.
--
-- This assertion is the load-bearing one, and running the suite against the pre-fix body shows why:
-- five of these nine fail there, but 'the refusal names the missing discharge paperwork' PASSES,
-- because 22P02's own text is `malformed array literal: "discharge paperwork"` -- the crash quotes
-- the very string the message was supposed to contain. A throws_like on the wording alone would
-- have called the broken function correct.
select throws_ok(
  $$select public.complete_hospital_return_reconciliation('7a000000-0000-4000-8000-000000000301', null)$$,
  '22023',
  null,
  'closing a return with gaps is refused deliberately, not by a type error'
);

-- And the refusal has to NAME the gaps, because a manager cannot act on "22P02".
select throws_like(
  $$select public.complete_hospital_return_reconciliation('7a000000-0000-4000-8000-000000000301', null)$$,
  '%discharge paperwork%',
  'the refusal names the missing discharge paperwork'
);
select throws_like(
  $$select public.complete_hospital_return_reconciliation('7a000000-0000-4000-8000-000000000301', null)$$,
  '%medication reconciliation%',
  'the refusal names the outstanding medication reconciliation'
);
select throws_like(
  $$select public.complete_hospital_return_reconciliation('7a000000-0000-4000-8000-000000000301', null)$$,
  '%physician order acknowledgement%',
  'the refusal names the unacknowledged physician orders'
);
select throws_like(
  $$select public.complete_hospital_return_reconciliation('7a000000-0000-4000-8000-000000000301', null)$$,
  '%hospital-return assessment review%',
  'the refusal names the missing assessment review'
);
select throws_like(
  $$select public.complete_hospital_return_reconciliation('7a000000-0000-4000-8000-000000000301', null)$$,
  '%support-plan revision%',
  'the refusal names the missing support-plan revision'
);

-- Closing the gaps one kind at a time proves the list shrinks rather than being all-or-nothing.
reset role;
insert into public.resident_documents(
  id, organization_id, facility_id, resident_id, storage_path, file_name, file_type,
  document_label, uploaded_by_profile_id
) values (
  '7a000000-0000-4000-8000-000000000401', '7a000000-0000-4000-8000-000000000001',
  '7a000000-0000-4000-8000-000000000011', '7a000000-0000-4000-8000-000000000201',
  'residents/7a00/discharge.pdf', 'discharge.pdf', 'application/pdf',
  'Hospital discharge summary', '7a000000-0000-4000-8000-000000000101'
);
update public.hospital_transfer_episodes
set discharge_document_id = '7a000000-0000-4000-8000-000000000401',
    medication_reconciliation_status = 'completed',
    changed_order_ack_status = 'acknowledged'
where id = '7a000000-0000-4000-8000-000000000301';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"7a000000-0000-4000-8000-000000000101","role":"authenticated"}', true);

select throws_like(
  $$select public.complete_hospital_return_reconciliation('7a000000-0000-4000-8000-000000000301', null)$$,
  '%hospital-return assessment review%',
  'the clinical gaps still hold the episode open once the paperwork gaps are closed'
);

-- The clean path ----------------------------------------------------------------------------------
reset role;
update public.hospital_transfer_episodes
set assessment_review_required = false, support_plan_review_required = false
where id = '7a000000-0000-4000-8000-000000000301';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"7a000000-0000-4000-8000-000000000101","role":"authenticated"}', true);

select lives_ok(
  $$select public.complete_hospital_return_reconciliation('7a000000-0000-4000-8000-000000000301', 'All gaps closed')$$,
  'an episode with nothing outstanding reconciles'
);

reset role;
select is(
  (select count(*)::int from public.audit_logs
   where entity_id = '7a000000-0000-4000-8000-000000000301'
     and action = 'hospital_transfer.reconciliation_completed'),
  1,
  'the completed reconciliation is recorded in the audit trail'
);

select * from finish();
rollback;
