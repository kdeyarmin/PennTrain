-- Closed outcomes complete their own work; repeated outcomes keep the queue current.
begin;
select plan(47);

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('ad000000-0000-4000-8000-000000000001', 'Outcome Org', 'outcome-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('ad000000-0000-4000-8000-000000000011', 'ad000000-0000-4000-8000-000000000001', 'Appointment Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'ad000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'outcome-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('ad000000-0000-4000-8000-000000000101', 'ad000000-0000-4000-8000-000000000001', 'outcome-admin@test.local', 'Avery', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('ad000000-0000-4000-8000-000000000201', 'ad000000-0000-4000-8000-000000000001',
  'ad000000-0000-4000-8000-000000000011', 'Avis', 'Resident', public.pa_today() - 40, 'active');
insert into public.employees(id, organization_id, facility_id, first_name, last_name, job_title)
values ('ad000000-0000-4000-8000-000000000301', 'ad000000-0000-4000-8000-000000000001',
  'ad000000-0000-4000-8000-000000000011', 'Dee', 'Driver', 'Driver');

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

insert into public.resident_documents(id, organization_id, facility_id, resident_id, storage_path, file_name, file_type)
select ('ad000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'ad000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000011',
  'ad000000-0000-4000-8000-000000000201',
  'ad000000-0000-4000-8000-000000000001/ad000000-0000-4000-8000-000000000011/outcome-' || n || '.pdf',
  'outcome-' || n || '.pdf', 'application/pdf'
from generate_series(601, 602) n;

insert into public.resident_appointments(id, organization_id, facility_id, resident_id, appointment_type, location, starts_at)
select ('ad000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'ad000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000011',
  'ad000000-0000-4000-8000-000000000201', 'Follow-up test ' || n, 'Clinic', now() - interval '1 hour'
from generate_series(401, 404) n;

select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select throws_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000401', 'closed', 'Visit completed.', now() + interval '1 day')$$,
  '22023', 'A closed appointment cannot have a follow-up deadline',
  'closed plus a deadline is rejected before either record changes');
select throws_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000401', 'closed', 'Orders changed.', null, 'pending_review')$$,
  '22023', 'Acknowledge the new orders before closing this appointment',
  'closed cannot introduce an unacknowledged order');
select throws_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000401', 'closed', '   ')$$,
  '22023', 'Record the outcome summary before closing this appointment',
  'closed requires the same summary as ordinary follow-up completion');
reset role;
select is((select status from public.resident_appointments where id='ad000000-0000-4000-8000-000000000401'),
  'scheduled', 'invalid closed outcomes leave the appointment unchanged');
select is((select count(*)::int from public.work_items where source_id='ad000000-0000-4000-8000-000000000401'),
  0, 'invalid closed outcomes create no orphan follow-up work');

-- An incomplete outcome is editable from the actual Appointments tab. Its second
-- save must refresh the first work item, not strand its old summary and clock.
select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select lives_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000401', 'attended', null, now() - interval '1 day',
  'not_applicable', 'ad000000-0000-4000-8000-000000000601')$$,
  'an incomplete outcome opens its follow-up');
reset role;
update public.work_items set state='in_progress', priority='high',
  owner_profile_id='ad000000-0000-4000-8000-000000000101', escalated_at=now()
where source_id='ad000000-0000-4000-8000-000000000401';
select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select lives_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000401', 'attended', 'Follow-up information received.', now() + interval '3 days')$$,
  'a second outcome save updates its existing work item');
reset role;
select is((select count(*)::int from public.work_items where source_id='ad000000-0000-4000-8000-000000000401'),
  1, 'the same canonical work item is retained');
select is((select due_at from public.work_items where source_id='ad000000-0000-4000-8000-000000000401'),
  now() + interval '3 days', 'the work queue receives the revised deadline');
select is((select description from public.work_items where source_id='ad000000-0000-4000-8000-000000000401'),
  'Follow-up information received.', 'the work queue receives the revised outcome summary');
select is((select uploaded_document_id from public.resident_appointments where id='ad000000-0000-4000-8000-000000000401'),
  'ad000000-0000-4000-8000-000000000601'::uuid, 'a summary-only edit retains the uploaded clinical document link');
select is((select jsonb_build_object('state',state,'priority',priority,'owner',owner_profile_id)
  from public.work_items where source_id='ad000000-0000-4000-8000-000000000401'),
  jsonb_build_object('state','in_progress','priority','high','owner','ad000000-0000-4000-8000-000000000101'),
  'revising the outcome preserves work state, priority and assignment');
select ok((select escalated_at is null from public.work_items where source_id='ad000000-0000-4000-8000-000000000401'),
  'a future deadline clears the old escalation clock');

select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select lives_ok($$select public.update_work_item_assignment(
  (select follow_up_work_item_id from public.resident_appointments where id='ad000000-0000-4000-8000-000000000401'),
  'ad000000-0000-4000-8000-000000000101', 'high', now() + interval '4 days')$$,
  'a manager can revise the deadline directly from the work queue');
select lives_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000401', 'follow_up_required', 'Further details received.')$$,
  'an outcome can be updated without supplying another deadline');
reset role;
select is((select due_at from public.work_items where source_id='ad000000-0000-4000-8000-000000000401'),
  now() + interval '4 days', 'omitting a deadline preserves the manager-revised work clock');
select is((select follow_up_due_at from public.resident_appointments where id='ad000000-0000-4000-8000-000000000401'),
  now() + interval '4 days', 'the appointment receives the current work deadline instead of overwriting it');

select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select lives_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000401', 'closed', 'Follow-up completed; resident informed.')$$,
  'a valid closed outcome delegates to ordinary follow-up completion');
reset role;
select is((select state from public.work_items where source_id='ad000000-0000-4000-8000-000000000401'),
  'closed', 'the existing follow-up closes in the same transaction');
select ok((select follow_up_completed_at is not null and follow_up_completed_by='ad000000-0000-4000-8000-000000000101'
  from public.resident_appointments where id='ad000000-0000-4000-8000-000000000401'),
  'clinical completion records its actor and time');
select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select lives_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000401', 'closed', 'Follow-up completed; resident and family informed.')$$,
  'repeating or correcting a closed outcome does not repeat the completed sign-off');
reset role;
select is((select count(*)::int from public.audit_logs where entity_id='ad000000-0000-4000-8000-000000000401'
  and action='appointment.follow_up_completed'), 1, 'a repeated closed request records only one clinical sign-off');
select is((select outcome_summary from public.resident_appointments where id='ad000000-0000-4000-8000-000000000401'),
  'Follow-up completed; resident and family informed.', 'the existing outcome correction path remains available');
select is((select description from public.work_items where source_id='ad000000-0000-4000-8000-000000000401'),
  'Follow-up completed; resident and family informed.', 'the closed work summary receives the correction too');
select is((select uploaded_document_id from public.resident_appointments where id='ad000000-0000-4000-8000-000000000401'),
  'ad000000-0000-4000-8000-000000000601'::uuid, 'closing and correcting the outcome retain its document link');
select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select lives_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000401', 'closed', 'Updated document received.', null,
  'not_applicable', 'ad000000-0000-4000-8000-000000000602')$$,
  'an explicitly supplied replacement document is still accepted');
reset role;
select is((select uploaded_document_id from public.resident_appointments where id='ad000000-0000-4000-8000-000000000401'),
  'ad000000-0000-4000-8000-000000000602'::uuid, 'explicit document replacement changes the linked document');
select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select throws_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000401', 'follow_up_required', 'New follow-up requested.')$$,
  '22023', 'This appointment follow-up is already completed. Its closed summary can still be corrected.',
  'a stale outcome cannot turn a signed-off appointment into new follow-up work');
reset role;
select is((select status from public.resident_appointments where id='ad000000-0000-4000-8000-000000000401'),
  'closed', 'the completed appointment remains closed after a stale update');

-- The saved pending state must be checked before the update can reset its flag.
select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select public.record_appointment_outcome('ad000000-0000-4000-8000-000000000402', 'attended', 'Orders changed.', null, 'pending_review');
select throws_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000402', 'closed', 'Close requested.', null, 'not_applicable')$$,
  '22023', 'Acknowledge the new orders before closing this appointment',
  'closed cannot erase a saved order acknowledgement obligation');
select lives_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000402', 'attended', 'Summary corrected without acknowledgement.', null, 'not_applicable')$$,
  'an ordinary summary correction is allowed while its orders remain pending');
reset role;
select is((select new_order_ack_status from public.resident_appointments where id='ad000000-0000-4000-8000-000000000402'),
  'pending_review', 'an ordinary edit cannot clear the saved order obligation');
select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select throws_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000402', 'closed', 'Second close requested.', null, 'not_applicable')$$,
  '22023', 'Acknowledge the new orders before closing this appointment',
  'editing then closing cannot bypass the separate order acknowledgement');
reset role;
select is((select new_order_ack_status from public.resident_appointments where id='ad000000-0000-4000-8000-000000000402'),
  'pending_review', 'the pending order survives a rejected close');
select is((select state from public.work_items where source_id='ad000000-0000-4000-8000-000000000402'),
  'open', 'its follow-up work stays open');
select is((select a.follow_up_due_at = w.due_at from public.resident_appointments a
  join public.work_items w on w.id=a.follow_up_work_item_id where a.id='ad000000-0000-4000-8000-000000000402'),
  true, 'an automatically assigned first deadline is shared by appointment and queue');
select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select lives_ok($$select public.acknowledge_appointment_new_order(
  'ad000000-0000-4000-8000-000000000402', 'Orders reviewed and assigned to the responsible caregiver.')$$,
  'the separate order acknowledgement remains available');
select lives_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000402', 'closed', 'Orders reviewed and follow-up completed.')$$,
  'the appointment can close after the separate acknowledgement');
reset role;
select ok((select new_order_ack_status='acknowledged' and new_order_ack_at is not null
  and new_order_ack_by='ad000000-0000-4000-8000-000000000101' and follow_up_completed_at is not null
  from public.resident_appointments where id='ad000000-0000-4000-8000-000000000402'),
  'closure retains the acknowledgement provenance and clinical completion');

-- A manually completed work item stays completed if its source summary is corrected.
select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select public.record_appointment_outcome('ad000000-0000-4000-8000-000000000403', 'attended', null, now() + interval '1 day');
select public.transition_work_item((select follow_up_work_item_id from public.resident_appointments
  where id='ad000000-0000-4000-8000-000000000403'), 'closed', 'Work completed separately.');
select lives_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000403', 'attended', 'Documented after the work was completed.', now() + interval '1 day')$$,
  'source correction remains possible after manual work closure');
select throws_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000403', 'attended', 'A different deadline.', now() + interval '2 days')$$,
  '22023', 'The follow-up work is already closed or canceled. A new follow-up cannot be added to it.',
  'a new deadline cannot silently become closed work');
select throws_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000403', 'follow_up_required', 'Further action requested.')$$,
  '22023', 'The follow-up work is already closed or canceled. A new follow-up cannot be added to it.',
  'new follow-up demand cannot reuse finished work');
select throws_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000403', 'attended', 'New orders.', null, 'pending_review')$$,
  '22023', 'The follow-up work is already closed or canceled. A new follow-up cannot be added to it.',
  'new unacknowledged orders cannot reuse finished work');
reset role;
select is((select state from public.work_items where source_id='ad000000-0000-4000-8000-000000000403'),
  'closed', 'source correction never reopens terminal work');

insert into public.work_items(organization_id,facility_id,source_type,source_id,deduplication_key,title,description,priority,due_at,state,created_by)
values('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000011','complaint',
  'ad000000-0000-4000-8000-000000000499','appointment-follow-up:ad000000-0000-4000-8000-000000000404',
  'Unrelated work','Do not overwrite','normal',now() + interval '5 days','open','ad000000-0000-4000-8000-000000000101');
select pg_temp.act_as('ad000000-0000-4000-8000-000000000101');
select throws_ok($$select public.record_appointment_outcome(
  'ad000000-0000-4000-8000-000000000404', 'attended', 'New summary', now() + interval '1 day')$$,
  '23514', 'Appointment follow-up work item does not match its source',
  'a conflicting canonical key cannot overwrite an unrelated work item');
reset role;
select is((select description from public.work_items where source_id='ad000000-0000-4000-8000-000000000499'),
  'Do not overwrite', 'the unrelated work survives unchanged');
select is((select status from public.resident_appointments where id='ad000000-0000-4000-8000-000000000404'),
  'scheduled', 'source mismatch rolls back the appointment update as well');

select * from finish();
rollback;
