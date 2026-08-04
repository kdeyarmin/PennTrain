-- Resident appointment lifecycle (migration 20260804110000).
--
-- The three assertions this suite exists for are the three dead ends the migration closed: a
-- preparation list nobody could tick, an acknowledgement status nothing could reach, and a follow-up
-- work item nothing could close. Each is asserted by driving the real RPC as a real authenticated
-- role, not by writing the end state directly.

begin;
select plan(35);

select has_table('public', 'resident_appointment_preparation_items', 'the preparation list exists');
select has_function('public', 'set_appointment_preparation_item', array['uuid', 'boolean', 'text'],
  'an item can be marked ready');
select has_function('public', 'complete_appointment_preparation', array['uuid', 'text'],
  'the pre-departure sign-off exists');
select has_function('public', 'acknowledge_appointment_new_order', array['uuid', 'text'],
  'new orders can be acknowledged');
select has_function('public', 'complete_appointment_follow_up', array['uuid', 'text'],
  'the follow-up can be closed');
select has_function('public', 'reschedule_resident_appointment',
  array['uuid', 'timestamptz', 'text', 'timestamptz', 'timestamptz'],
  'an appointment can be rescheduled');

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('ac000000-0000-4000-8000-000000000001', 'Appointment Org', 'appointment-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('ac000000-0000-4000-8000-000000000011', 'ac000000-0000-4000-8000-000000000001', 'Appointment Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'ac000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'ac-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('ac000000-0000-4000-8000-000000000101', 'ac000000-0000-4000-8000-000000000001', 'ac-admin@test.local', 'Avery', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('ac000000-0000-4000-8000-000000000201', 'ac000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000011', 'Avis', 'Resident', public.pa_today() - 40, 'active');
insert into public.employees(id, organization_id, facility_id, first_name, last_name, job_title)
values ('ac000000-0000-4000-8000-000000000301', 'ac000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000011', 'Dee', 'Driver', 'Driver');

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- ---------------------------------------------------------------------------
-- The schedule's three arrays become tickable preparation items
-- ---------------------------------------------------------------------------
--
-- This is the whole point of the trigger: `schedule_resident_appointment` is unchanged, and a caller
-- that already passed these arrays gets tracking without knowing this migration happened.

select pg_temp.act_as('ac000000-0000-4000-8000-000000000101');
select lives_ok($$select public.schedule_resident_appointment(
  'ac000000-0000-4000-8000-000000000201', 'Cardiology', 'Mercy Cardiology',
  now() + interval '3 days', now() + interval '3 days 2 hours', 'Dr. Ellis',
  'County Transport', 'Van 3', null, null, now() + interval '3 days' - interval '1 hour',
  array['Current medication list', 'Insurance card'],
  array['Portable oxygen'],
  '["Hold breakfast", {"label": "Notify family"}]'::jsonb
)$$, 'an appointment is scheduled through the untouched creator');
reset role;

select is(
  (select count(*)::int from public.resident_appointment_preparation_items i
   join public.resident_appointments a on a.id = i.appointment_id
   where a.resident_id = 'ac000000-0000-4000-8000-000000000201'),
  5,
  'two documents, one piece of equipment, and two checklist entries became five items'
);

-- A bare string and an object with a label are both real forms in the wild; neither may land as a
-- row labelled "null", which would put an unactionable line in front of an aide.
select is(
  (select count(*)::int from public.resident_appointment_preparation_items
   where item_kind = 'task' and label in ('Hold breakfast', 'Notify family')),
  2,
  'a string checklist entry and an object one both produce a usable label'
);

-- ---------------------------------------------------------------------------
-- Readiness costs a name and an instant
-- ---------------------------------------------------------------------------

select throws_ok($$update public.resident_appointment_preparation_items
  set ready = true where label = 'Insurance card'$$,
  '23514', null,
  'an item cannot be marked ready with nobody''s name on it');

select pg_temp.act_as('ac000000-0000-4000-8000-000000000101');
select lives_ok($$select public.set_appointment_preparation_item(
  (select id from public.resident_appointment_preparation_items where label = 'Insurance card'), true)$$,
  'the RPC marks an item ready');
reset role;

select is(
  (select ready_by from public.resident_appointment_preparation_items where label = 'Insurance card'),
  'ac000000-0000-4000-8000-000000000101'::uuid,
  'and records who said so');

-- ---------------------------------------------------------------------------
-- The sign-off is gated on the list, and names what is missing
-- ---------------------------------------------------------------------------

select pg_temp.act_as('ac000000-0000-4000-8000-000000000101');
select throws_like($$select public.complete_appointment_preparation(
  (select id from public.resident_appointments where resident_id = 'ac000000-0000-4000-8000-000000000201'))$$,
  '%Current medication list%',
  'the sign-off refuses and names the outstanding item rather than failing vaguely');

-- Ready everything, then sign off.
select public.set_appointment_preparation_item(id, true)
  from public.resident_appointment_preparation_items
  where appointment_id = (select id from public.resident_appointments
    where resident_id = 'ac000000-0000-4000-8000-000000000201')
    and not ready;
select lives_ok($$select public.complete_appointment_preparation(
  (select id from public.resident_appointments where resident_id = 'ac000000-0000-4000-8000-000000000201'))$$,
  'with everything ready, the sign-off is accepted');
reset role;

select isnt(
  (select preparation_completed_at from public.resident_appointments
   where resident_id = 'ac000000-0000-4000-8000-000000000201'),
  null,
  'and the departure sign-off is stamped');

-- Reopening an item must retract the sign-off; leaving it would have the record asserting something
-- that is no longer true.
select pg_temp.act_as('ac000000-0000-4000-8000-000000000101');
select public.set_appointment_preparation_item(
  (select id from public.resident_appointment_preparation_items where label = 'Portable oxygen'), false);
reset role;
select is(
  (select preparation_completed_at from public.resident_appointments
   where resident_id = 'ac000000-0000-4000-8000-000000000201'),
  null,
  'reopening an item retracts the sign-off it would otherwise contradict');

-- ---------------------------------------------------------------------------
-- Rescheduling links a successor rather than losing the appointment
-- ---------------------------------------------------------------------------

select pg_temp.act_as('ac000000-0000-4000-8000-000000000101');
select throws_like($$select public.record_appointment_outcome(
  (select id from public.resident_appointments where resident_id = 'ac000000-0000-4000-8000-000000000201'),
  'rescheduled')$$,
  '%reschedule_resident_appointment%',
  'the outcome RPC refuses a bare reschedule and points at the path that links one');

select lives_ok($$select public.reschedule_resident_appointment(
  (select id from public.resident_appointments where resident_id = 'ac000000-0000-4000-8000-000000000201'),
  now() + interval '10 days', 'Provider cancelled the clinic.')$$,
  'the reschedule RPC creates the replacement');
reset role;

select is(
  (select count(*)::int from public.resident_appointments
   where resident_id = 'ac000000-0000-4000-8000-000000000201'),
  2,
  'the replacement is a real appointment, not an edit of the original');
select isnt(
  (select rescheduled_to_appointment_id from public.resident_appointments
   where resident_id = 'ac000000-0000-4000-8000-000000000201' and status = 'rescheduled'),
  null,
  'and the original names it, so the appointment does not simply disappear');
-- Retyping the transport arrangements is how a resident travels without their oxygen.
select is(
  (select equipment_required from public.resident_appointments
   where resident_id = 'ac000000-0000-4000-8000-000000000201' and status = 'scheduled'),
  array['Portable oxygen'],
  'the replacement inherits the equipment list');

-- A superseded appointment must stop holding its driver's slot. Found by running the reschedule
-- path rather than reading it: the successor is created before the original can be marked
-- superseded (the successor's id is what marks it), so with the old predicate the appointment
-- conflicted with itself and every reschedule retired that driver's window permanently.
select pg_temp.act_as('ac000000-0000-4000-8000-000000000101');
select lives_ok($$select public.schedule_resident_appointment(
  'ac000000-0000-4000-8000-000000000201', 'Podiatry', 'Foot Clinic',
  now() + interval '20 days', now() + interval '20 days 2 hours', null, null, null,
  'ac000000-0000-4000-8000-000000000301', null, now() + interval '20 days' - interval '30 minutes'
)$$, 'an appointment is scheduled with a driver assigned');

select lives_ok($$select public.reschedule_resident_appointment(
  (select id from public.resident_appointments
   where appointment_type = 'Podiatry' and status = 'scheduled'),
  now() + interval '20 days 30 minutes', 'Clinic moved the slot by half an hour.')$$,
  'and it can be moved to an overlapping time without conflicting with itself');
reset role;

-- Releasing the hold must not erase who was assigned. The reschedule clears driver and escort only
-- for the duration of the successor's insert and restores them from the locked snapshot.
select is(
  (select driver_employee_id from public.resident_appointments
   where appointment_type = 'Podiatry' and status = 'rescheduled'),
  'ac000000-0000-4000-8000-000000000301'::uuid,
  'and the superseded appointment still records the driver it had');

-- ---------------------------------------------------------------------------
-- New orders: the state that had no path out of it
-- ---------------------------------------------------------------------------

select pg_temp.act_as('ac000000-0000-4000-8000-000000000101');
select lives_ok($$select public.record_appointment_outcome(
  (select id from public.resident_appointments
   where resident_id = 'ac000000-0000-4000-8000-000000000201'
     and appointment_type = 'Cardiology' and status = 'scheduled'),
  'attended', 'Furosemide increased.', now() + interval '1 day', 'pending_review')$$,
  'an outcome with new orders is recorded');
reset role;

select is(
  (select count(*)::int from public.work_items
   where deduplication_key like 'appointment-follow-up:%' and state = 'open'),
  1,
  'and it raises exactly one open follow-up work item');
-- 20260726100100 asked new creators to name their source type rather than lean on the mapping.
select is(
  (select source_type from public.work_items where deduplication_key like 'appointment-follow-up:%'),
  'resident_appointment',
  'the work item names its real source type');

select pg_temp.act_as('ac000000-0000-4000-8000-000000000101');
-- "Acknowledged" on its own is the endpoint this migration exists to remove.
select throws_ok($$select public.acknowledge_appointment_new_order(
  (select id from public.resident_appointments
   where resident_id = 'ac000000-0000-4000-8000-000000000201' and status = 'attended'), '   ')$$,
  '22023', null,
  'an acknowledgement with no substance behind it is refused');

-- Closing the follow-up while the orders are unacknowledged is the failure the hospital-return work
-- already named: an order nobody acknowledged is an order nobody is carrying out.
select throws_like($$select public.complete_appointment_follow_up(
  (select id from public.resident_appointments
   where resident_id = 'ac000000-0000-4000-8000-000000000201' and status = 'attended'))$$,
  '%acknowledgement of the new orders%',
  'the follow-up cannot be closed over an unacknowledged order');

select lives_ok($$select public.acknowledge_appointment_new_order(
  (select id from public.resident_appointments
   where resident_id = 'ac000000-0000-4000-8000-000000000201' and status = 'attended'),
  'Furosemide increased to 40mg daily; MAR updated and the day nurse briefed.')$$,
  'the orders are acknowledged with a note');
reset role;

select is(
  (select new_order_ack_by from public.resident_appointments
   where resident_id = 'ac000000-0000-4000-8000-000000000201' and status = 'attended'),
  'ac000000-0000-4000-8000-000000000101'::uuid,
  'and the acknowledgement carries the acknowledger');

-- ---------------------------------------------------------------------------
-- Closing the follow-up closes the work item with it
-- ---------------------------------------------------------------------------

select pg_temp.act_as('ac000000-0000-4000-8000-000000000101');
select lives_ok($$select public.complete_appointment_follow_up(
  (select id from public.resident_appointments
   where resident_id = 'ac000000-0000-4000-8000-000000000201' and status = 'attended'),
  'Plan updated and family informed.')$$,
  'with both gates satisfied the follow-up closes');
reset role;

select is(
  (select state from public.work_items where deduplication_key like 'appointment-follow-up:%'),
  'closed',
  'and the work item closes with it, instead of sitting in the queue forever');

-- ---------------------------------------------------------------------------
-- The timeline can finally see an appointment
-- ---------------------------------------------------------------------------

select pg_temp.act_as('ac000000-0000-4000-8000-000000000101');
select is(
  (select count(*)::int from public.get_resident_timeline('ac000000-0000-4000-8000-000000000201', 200)
   where event_type = 'appointment'),
  4,
  'every appointment, original and replacement, reaches the resident timeline');
-- The union carries fifteen other branches. Losing one silently empties part of the clinical chart,
-- which is exactly what the migration's own comment warns about.
select is(
  (select count(*)::int from public.get_resident_timeline('ac000000-0000-4000-8000-000000000201', 200)
   where href like '%tab=appointments%'),
  4,
  'and each one links back to the tab that can act on it');
reset role;

select * from finish();
rollback;
