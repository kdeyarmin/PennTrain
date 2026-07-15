begin;
select plan(61);

select has_table('public', 'facility_transport_vehicles', 'facility vehicles are governed records');
select has_table('public', 'resident_service_calendar_events', 'resident services share one calendar');
select has_table('public', 'resident_service_calendar_event_staff', 'drivers and accompanying staff are structured');
select has_table('public', 'resident_service_calendar_follow_ups', 'return follow-ups are first-class records');
select has_table('public', 'resident_service_calendar_history', 'calendar history is append-only evidence');
select ok(has_table_privilege('authenticated', 'public.resident_service_calendar_events', 'SELECT'), 'authenticated roles can read scoped calendar events');
select ok(not has_table_privilege('authenticated', 'public.resident_service_calendar_events', 'INSERT'), 'browser roles cannot bypass calendar commands');
select ok(not has_table_privilege('anon', 'public.resident_service_calendar_events', 'SELECT'), 'anonymous users cannot read resident calendars');

insert into public.organizations(id, name, slug, subscription_status) values
  ('74000000-0000-4000-8000-000000000001', 'Calendar Org', 'calendar-org', 'active'),
  ('74000000-0000-4000-8000-000000000002', 'Other Calendar Org', 'other-calendar-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('74000000-0000-4000-8000-000000000011', '74000000-0000-4000-8000-000000000001', 'Calendar Facility', 'PCH'),
  ('74000000-0000-4000-8000-000000000012', '74000000-0000-4000-8000-000000000001', 'Unassigned Facility', 'ALR'),
  ('74000000-0000-4000-8000-000000000013', '74000000-0000-4000-8000-000000000002', 'Other Calendar Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'calendar-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'calendar-employee@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'calendar-auditor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '74000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'other-calendar-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('74000000-0000-4000-8000-000000000101', '74000000-0000-4000-8000-000000000001', 'calendar-admin@test.local', 'Calendar', 'Admin', 'org_admin', true),
  ('74000000-0000-4000-8000-000000000102', '74000000-0000-4000-8000-000000000001', 'calendar-employee@test.local', 'Calendar', 'Employee', 'employee', true),
  ('74000000-0000-4000-8000-000000000103', '74000000-0000-4000-8000-000000000001', 'calendar-auditor@test.local', 'Calendar', 'Auditor', 'auditor', true),
  ('74000000-0000-4000-8000-000000000104', '74000000-0000-4000-8000-000000000002', 'other-calendar-admin@test.local', 'Other', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.facility_assignments(profile_id, facility_id) values
  ('74000000-0000-4000-8000-000000000102', '74000000-0000-4000-8000-000000000011');
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('74000000-0000-4000-8000-000000000201', '74000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000011', 'Jordan', 'Calendar', current_date - 30, 'active'),
  ('74000000-0000-4000-8000-000000000202', '74000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000012', 'Unassigned', 'Calendar', current_date - 20, 'active'),
  ('74000000-0000-4000-8000-000000000203', '74000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000013', 'Other', 'Calendar', current_date - 10, 'active');
insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, department, status
) values (
  '74000000-0000-4000-8000-000000000301', '74000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000011', '74000000-0000-4000-8000-000000000102',
  'Calendar', 'Employee', 'Resident Services Associate', 'Resident Services', 'active'
);
insert into public.employee_facility_assignments(employee_id, facility_id, is_primary) values
  ('74000000-0000-4000-8000-000000000301', '74000000-0000-4000-8000-000000000011', true)
on conflict(employee_id, facility_id) do nothing;

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_id, 'role', p_role, 'aal', 'aal2', 'iat', extract(epoch from now())::bigint
  )::text, true);
  if p_role = 'anon' then set local role anon;
  elsif p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;
create temporary table calendar_ids(key text primary key, id uuid) on commit drop;
grant all on calendar_ids to authenticated, anon, service_role;

select pg_temp.act_as('74000000-0000-4000-8000-000000000101');
select lives_ok($$
  insert into calendar_ids values ('vehicle', public.upsert_facility_transport_vehicle(
    '74000000-0000-4000-8000-000000000011', null, 'Accessible Van 1',
    'wheelchair_van', 'CAL-100', 6, true, 'available', 'Lift inspected'
  ))
$$, 'manager creates a facility vehicle');
select is((select status from public.facility_transport_vehicles where id = (select id from calendar_ids where key='vehicle')), 'available', 'vehicle roster retains operational status');

select lives_ok($$
  insert into calendar_ids values ('medical', public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201',
    jsonb_build_object(
      'eventType','medical_appointment','title','Primary care follow-up',
      'providerName','Dr. Rivera','providerContact','555-0100',
      'locationName','Community Health','locationAddress','10 Main Street',
      'startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 1 hour',
      'transportationMode','facility_vehicle','vehicleId',(select id from calendar_ids where key='vehicle'),
      'requiredRecords',jsonb_build_array('Medication administration record','Insurance card'),
      'preparationInstructions','Nothing by mouth after midnight','notes','Confirm appointment morning of visit'
    ),
    jsonb_build_array(
      jsonb_build_object('employeeId','74000000-0000-4000-8000-000000000301','role','driver','instructions','Bring accessible van'),
      jsonb_build_object('externalName','Family Escort','role','accompanying_staff','instructions','Meet at lobby')
    )
  ))
$$, 'manager schedules a complete medical appointment');
select is((select required_records from public.resident_service_calendar_events where id=(select id from calendar_ids where key='medical')), array['Insurance card','Medication administration record']::text[], 'required records are normalized');
select is((select count(*)::integer from public.resident_service_calendar_event_staff where event_id=(select id from calendar_ids where key='medical')), 2, 'driver and accompanying staff are assigned');
select is((select vehicle_id from public.resident_service_calendar_events where id=(select id from calendar_ids where key='medical')), (select id from calendar_ids where key='vehicle'), 'appointment reserves the selected vehicle');
select is((public.get_resident_administrative_packet('74000000-0000-4000-8000-000000000201') #>> '{upcomingResidentServices,0,title}'), 'Primary care follow-up', 'resident packet includes upcoming calendar obligations');
select is((public.get_resident_administrative_packet('74000000-0000-4000-8000-000000000201') #>> '{dietaryProfile}'), null, 'calendar wrapper preserves prior packet keys when optional dietary data is absent');
select lives_ok($$
  insert into calendar_ids values ('unassigned', public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201',
    jsonb_build_object('eventType','family_visit','title','Family courtyard visit',
      'startsAt',now()+interval '4 days','endsAt',now()+interval '4 days 1 hour',
      'transportationMode','none','requiredRecords','[]'::jsonb), '[]'::jsonb
  ))
$$, 'manager can schedule a family visit without assigned staff');

select pg_temp.act_as('74000000-0000-4000-8000-000000000102');
select is((select count(*)::integer from public.resident_service_calendar_events where id=(select id from calendar_ids where key='medical')), 1, 'assigned employee can view the appointment');
select is((select count(*)::integer from public.resident_service_calendar_event_staff where event_id=(select id from calendar_ids where key='medical')), 2, 'assigned employee can view appointment staffing');
select is((select count(*)::integer from public.resident_service_calendar_events where id=(select id from calendar_ids where key='unassigned')), 0, 'employee cannot view unassigned resident events');
select is((select count(*)::integer from public.facility_transport_vehicles where id=(select id from calendar_ids where key='vehicle')), 1, 'assigned employee can view facility vehicle details');
select throws_ok($$
  select public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201',
    jsonb_build_object('eventType','facility_activity','title','Music group',
      'startsAt',now()+interval '3 days','endsAt',now()+interval '3 days 1 hour',
      'transportationMode','none','requiredRecords','[]'::jsonb), '[]'::jsonb
  )
$$, '42501', null, 'employee cannot create manager calendar records');
select lives_ok($$
  select public.record_resident_service_calendar_outcome(
    (select id from calendar_ids where key='medical'), 'completed', now(),
    'Appointment completed as planned', 'Continue current medications and obtain ordered labs',
    jsonb_build_array(
      jsonb_build_object('title','Schedule ordered laboratory visit','description','Contact laboratory and confirm fasting instructions','ownerProfileId','74000000-0000-4000-8000-000000000101','dueAt',now()+interval '2 days','priority','high'),
      jsonb_build_object('title','Send visit summary to pharmacy','description','Provide updated medication summary to dispensing pharmacy','ownerProfileId','74000000-0000-4000-8000-000000000101','dueAt',now()+interval '1 day','priority','normal')
    ), now()+interval '30 days'
  )
$$, 'assigned employee records completion, return instructions, and follow-ups');

select pg_temp.act_as('74000000-0000-4000-8000-000000000101');
select is((select status from public.resident_service_calendar_events where id=(select id from calendar_ids where key='medical')), 'completed', 'appointment completion is retained');
select is((select return_instructions from public.resident_service_calendar_events where id=(select id from calendar_ids where key='medical')), 'Continue current medications and obtain ordered labs', 'return instructions are retained');
select is((select count(*)::integer from public.resident_service_calendar_follow_ups where event_id=(select id from calendar_ids where key='medical')), 2, 'multiple return follow-ups are distinct records');
select is((select count(*)::integer from public.work_items where source_type='resident_calendar' and source_id in (select id from public.resident_service_calendar_follow_ups where event_id=(select id from calendar_ids where key='medical'))), 2, 'every calendar follow-up creates operational work');
select is((select count(distinct work_item_id)::integer from public.resident_service_calendar_follow_ups where event_id=(select id from calendar_ids where key='medical')), 2, 'follow-ups have separate work items');
select is((select next_appointment_at::date from public.resident_service_calendar_events where id=(select id from calendar_ids where key='medical')), (now()+interval '30 days')::date, 'next appointment is tracked');
select is((select count(*)::integer from public.resident_service_calendar_history where event_id=(select id from calendar_ids where key='medical')), 2, 'creation and completion both retain calendar history');
select is((select source_type from public.work_items where id=(select work_item_id from public.resident_service_calendar_follow_ups where event_id=(select id from calendar_ids where key='medical') order by due_at limit 1)), 'resident_calendar', 'follow-up work retains calendar source context');

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'service_role');
select throws_ok($$
  update public.resident_service_calendar_history set reason='Rewritten evidence'
  where event_id=(select id from calendar_ids where key='medical')
$$, '55000', null, 'calendar history is immutable');
select pg_temp.act_as('74000000-0000-4000-8000-000000000101');

select lives_ok($$
  insert into calendar_ids values ('noshow', public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201',
    jsonb_build_object('eventType','dental_appointment','title','Dental cleaning',
      'providerName','Main Street Dental','startsAt',now()-interval '2 hours',
      'endsAt',now()-interval '1 hour','transportationMode','family','requiredRecords','[]'::jsonb), '[]'::jsonb
  ))
$$, 'manager records a past scheduled dental appointment');
select lives_ok($$
  select public.record_resident_service_calendar_outcome(
    (select id from calendar_ids where key='noshow'), 'no_show', now(),
    'Resident did not arrive for scheduled appointment', null, '[]'::jsonb, null
  )
$$, 'manager records a no-show');
select is((select status from public.resident_service_calendar_events where id=(select id from calendar_ids where key='noshow')), 'no_show', 'no-show outcome is retained');
select is((public.get_qapi_source_metrics('74000000-0000-4000-8000-000000000011', current_date-1, current_date+1)->>'appointmentFailures')::integer, 1, 'QAPI receives authoritative appointment failures');
select ok(public.get_qapi_source_metrics('74000000-0000-4000-8000-000000000011', current_date-1, current_date+1) ? 'nutritionExceptions', 'QAPI retains prior dietary signals');

select lives_ok($$
  insert into calendar_ids values ('transport1', public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201',
    jsonb_build_object('eventType','transportation','title','Therapy transportation',
      'startsAt',now()+interval '7 days','endsAt',now()+interval '7 days 2 hours',
      'transportationMode','facility_vehicle','vehicleId',(select id from calendar_ids where key='vehicle'),'requiredRecords','[]'::jsonb), '[]'::jsonb
  ))
$$, 'manager schedules facility transportation');
select throws_ok($$
  select public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201',
    jsonb_build_object('eventType','outside_activity','title','Community outing',
      'startsAt',now()+interval '7 days 30 minutes','endsAt',now()+interval '7 days 3 hours',
      'transportationMode','facility_vehicle','vehicleId',(select id from calendar_ids where key='vehicle'),'requiredRecords','[]'::jsonb), '[]'::jsonb
  )
$$, '23P01', null, 'vehicle double-booking is blocked');
select lives_ok($$
  insert into calendar_ids values ('staff1', public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201',
    jsonb_build_object('eventType','community_service','title','Volunteer shift',
      'startsAt',now()+interval '9 days','endsAt',now()+interval '9 days 2 hours',
      'transportationMode','family','requiredRecords','[]'::jsonb),
    jsonb_build_array(jsonb_build_object('employeeId','74000000-0000-4000-8000-000000000301','role','accompanying_staff'))
  ))
$$, 'manager assigns staff to a community service');
select throws_ok($$
  select public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201',
    jsonb_build_object('eventType','outside_activity','title','Overlapping outing',
      'startsAt',now()+interval '9 days 1 hour','endsAt',now()+interval '9 days 3 hours',
      'transportationMode','none','requiredRecords','[]'::jsonb),
    jsonb_build_array(jsonb_build_object('employeeId','74000000-0000-4000-8000-000000000301','role','accompanying_staff'))
  )
$$, '23P01', null, 'staff double-booking is blocked');
select lives_ok($$
  select public.reschedule_resident_service_calendar_event(
    (select id from calendar_ids where key='staff1'), now()+interval '10 days',
    now()+interval '10 days 2 hours', 'Community partner changed the service date'
  )
$$, 'manager reschedules a calendar event');
select is((select count(*)::integer from public.resident_service_calendar_history where event_id=(select id from calendar_ids where key='staff1') and event_type='rescheduled'), 1, 'reschedule history retains prior and new times');
select lives_ok($$
  select public.record_resident_service_calendar_outcome(
    (select id from calendar_ids where key='staff1'), 'canceled', now(),
    'Community partner canceled the volunteer shift', null, '[]'::jsonb, null
  )
$$, 'manager cancels a scheduled service');
select is((select outcome_reason from public.resident_service_calendar_events where id=(select id from calendar_ids where key='staff1')), 'Community partner canceled the volunteer shift', 'cancellation reason is retained');

select lives_ok($$
  insert into calendar_ids values ('external', public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201',
    jsonb_build_object('eventType','therapy','title','Physical therapy',
      'startsAt',now()+interval '12 days','endsAt',now()+interval '12 days 1 hour',
      'transportationMode','vendor','transportationVendor','Mobility Transit','requiredRecords',jsonb_build_array('Therapy order')),
    jsonb_build_array(jsonb_build_object('externalName','Vendor Driver','role','driver'))
  ))
$$, 'external transportation staff can be documented');
select is((select external_staff_name from public.resident_service_calendar_event_staff where event_id=(select id from calendar_ids where key='external') and assignment_role='driver'), 'Vendor Driver', 'external driver name is retained');
select throws_ok($$
  select public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201',
    jsonb_build_object('eventType','laboratory_visit','title','Invalid two-driver visit',
      'startsAt',now()+interval '14 days','endsAt',now()+interval '14 days 1 hour',
      'transportationMode','family','requiredRecords','[]'::jsonb),
    jsonb_build_array(jsonb_build_object('externalName','Driver One','role','driver'),jsonb_build_object('externalName','Driver Two','role','driver'))
  )
$$, '23505', null, 'an event cannot have two drivers');
select throws_ok($$
  select public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201',
    jsonb_build_object('eventType','therapy','title','Missing vehicle',
      'startsAt',now()+interval '15 days','endsAt',now()+interval '15 days 1 hour',
      'transportationMode','facility_vehicle','requiredRecords','[]'::jsonb), '[]'::jsonb
  )
$$, '22023', null, 'facility transportation requires a vehicle');
select throws_ok($$
  select public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201',
    jsonb_build_object('eventType','therapy','title','Invalid time',
      'startsAt',now()+interval '16 days','endsAt',now()+interval '16 days - 1 hour',
      'transportationMode','none','requiredRecords','[]'::jsonb), '[]'::jsonb
  )
$$, '22023', null, 'event end must follow its start');
select is((select count(*)::integer from public.work_item_templates where template_key='resident_calendar.followup' and source_type='resident_calendar'), 1, 'calendar follow-up template is active');

select pg_temp.act_as('74000000-0000-4000-8000-000000000103');
select is((select count(*)::integer from public.resident_service_calendar_events where facility_id='74000000-0000-4000-8000-000000000011'), 6, 'auditor can read the full facility calendar');
select throws_ok($$
  select public.upsert_facility_transport_vehicle(
    '74000000-0000-4000-8000-000000000011', null, 'Audit Van', 'van', null, 4, false, 'available', null
  )
$$, '42501', null, 'auditor cannot modify vehicle configuration');
select throws_ok($$
  update public.resident_service_calendar_events set notes='Direct rewrite'
  where id=(select id from calendar_ids where key='external')
$$, '42501', null, 'authenticated roles cannot directly rewrite calendar events');

select pg_temp.act_as('74000000-0000-4000-8000-000000000104');
select is((select count(*)::integer from public.resident_service_calendar_events where organization_id='74000000-0000-4000-8000-000000000001'), 0, 'cross-tenant calendar rows are hidden');
select throws_ok($$
  select public.record_resident_service_calendar_outcome(
    (select id from calendar_ids where key='external'), 'completed', now(),
    'Cross tenant attempt', null, '[]'::jsonb, null
  )
$$, '42501', null, 'cross-tenant outcome command is denied');

select pg_temp.act_as('74000000-0000-4000-8000-000000000102');
select is((select count(*)::integer from public.resident_service_calendar_events where id=(select id from calendar_ids where key='medical')), 1, 'assigned employee retains access after completion');
select throws_ok($$
  select public.upsert_facility_transport_vehicle(
    '74000000-0000-4000-8000-000000000011', null, 'Employee Van', 'van', null, 4, false, 'available', null
  )
$$, '42501', null, 'employee cannot modify vehicle configuration');
select throws_ok($$
  select public.record_resident_service_calendar_outcome(
    (select id from calendar_ids where key='unassigned'), 'completed', now(),
    'Unauthorized completion attempt', null, '[]'::jsonb, null
  )
$$, '42501', null, 'employee cannot record an unassigned event outcome');

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'anon');
select throws_ok($$
  select public.create_resident_service_calendar_event(
    '74000000-0000-4000-8000-000000000201', '{}'::jsonb, '[]'::jsonb
  )
$$, '42501', null, 'anonymous callers cannot execute calendar commands');
select throws_ok($$
  select count(*) from public.resident_service_calendar_events
$$, '42501', null, 'anonymous callers cannot read calendar rows');

select * from finish();
rollback;
