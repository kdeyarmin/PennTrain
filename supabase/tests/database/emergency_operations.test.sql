begin;
select plan(59);

select has_table('public', 'emergency_plans', 'emergency plans exist');
select has_table('public', 'emergency_plan_versions', 'plan versions exist');
select has_table('public', 'resident_evacuation_profiles', 'resident evacuation profiles exist');
select has_table('public', 'emergency_events', 'emergency events exist');
select has_table('public', 'emergency_event_residents', 'resident accountability exists');
select has_table('public', 'emergency_event_staff', 'staff accountability exists');
select has_table('public', 'emergency_communications', 'emergency communications exist');
select has_table('public', 'emergency_after_action_reviews', 'after-action reviews exist');
select has_table('public', 'emergency_event_actions', 'event corrective actions link to work items');
select is(
  (select public::text from storage.buckets where id = 'emergency-documents'),
  'false',
  'emergency plan documents are private'
);
select ok(
  not has_table_privilege('authenticated', 'public.emergency_events', 'INSERT'),
  'browser roles cannot insert emergency events directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.emergency_plan_versions', 'UPDATE'),
  'browser roles cannot rewrite approved plan versions'
);
select ok(
  not has_table_privilege('authenticated', 'public.emergency_event_timeline', 'INSERT'),
  'browser roles cannot bypass timeline commands'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.start_emergency_event(uuid,text,text,timestamptz,text,text,text,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated users receive the governed event command'
);
select ok(
  not has_function_privilege('authenticated', 'app_private.stamp_emergency_facility_scope()', 'EXECUTE'),
  'internal emergency scope trigger is not callable'
);

insert into public.organizations (id, name, slug, subscription_status) values
  ('70000000-0000-4000-8000-000000000001', 'Emergency Org', 'emergency-org', 'active'),
  ('80000000-0000-4000-8000-000000000001', 'Other Emergency Org', 'other-emergency-org', 'active');

insert into public.facilities (id, organization_id, name, facility_type) values
  ('70000000-0000-4000-8000-000000000011', '70000000-0000-4000-8000-000000000001', 'Prepared Facility', 'PCH'),
  ('70000000-0000-4000-8000-000000000012', '70000000-0000-4000-8000-000000000001', 'Unprepared Facility', 'ALR'),
  ('80000000-0000-4000-8000-000000000011', '80000000-0000-4000-8000-000000000001', 'Other Facility', 'PCH');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'emergency-manager@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'emergency-auditor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'emergency-staff@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'other-manager@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active) values
  ('70000000-0000-4000-8000-000000000101', '70000000-0000-4000-8000-000000000001', 'emergency-manager@test.local', 'Emergency', 'Manager', 'org_admin', true),
  ('70000000-0000-4000-8000-000000000102', '70000000-0000-4000-8000-000000000001', 'emergency-auditor@test.local', 'Emergency', 'Auditor', 'auditor', true),
  ('70000000-0000-4000-8000-000000000103', '70000000-0000-4000-8000-000000000001', 'emergency-staff@test.local', 'Emergency', 'Staff', 'employee', true),
  ('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000001', 'other-manager@test.local', 'Other', 'Manager', 'org_admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  role = excluded.role,
  is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments (profile_id, facility_id) values
  ('70000000-0000-4000-8000-000000000101', '70000000-0000-4000-8000-000000000011'),
  ('70000000-0000-4000-8000-000000000101', '70000000-0000-4000-8000-000000000012');

insert into public.employees (
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status
) values (
  '70000000-0000-4000-8000-000000000301', '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000011', '70000000-0000-4000-8000-000000000103',
  'Emergency', 'Staff', 'Resident Care Aide', 'active'
);

insert into public.residents (
  id, organization_id, facility_id, first_name, last_name, room, admission_date, status
) values (
  '70000000-0000-4000-8000-000000000201', '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000011', 'Prepared', 'Resident', '101', current_date, 'active'
);

insert into public.resident_informal_supports (
  id, organization_id, facility_id, resident_id, name, relationship, phone
) values (
  '70000000-0000-4000-8000-000000000202', '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000011', '70000000-0000-4000-8000-000000000201',
  'Designated Person', 'Daughter', '555-0101'
);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal1', 'iat', extract(epoch from now())::bigint)::text,
    true
  );
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end;
$$;

create temporary table emergency_test_ids (key text primary key, id uuid) on commit drop;
grant all on emergency_test_ids to authenticated, service_role;

select pg_temp.act_as('70000000-0000-4000-8000-000000000101');

select lives_ok($$
  insert into emergency_test_ids values (
    'plan-v1',
    public.create_emergency_plan_version(
      '70000000-0000-4000-8000-000000000011', 'All-Hazards Emergency Plan', current_date,
      'Initial approved emergency plan', '{"evacuationZones":["North","South"]}', null, null
    )
  )
$$, 'manager publishes the initial emergency plan version');
select ok(
  (select current_version_id = (select id from emergency_test_ids where key = 'plan-v1')
   from public.emergency_plans where facility_id = '70000000-0000-4000-8000-000000000011'),
  'facility plan points to the approved version'
);
select is(
  (select version_number from public.emergency_plan_versions where id = (select id from emergency_test_ids where key = 'plan-v1')),
  1,
  'initial plan version is numbered one'
);
select lives_ok($$
  insert into emergency_test_ids values (
    'plan-v2',
    public.create_emergency_plan_version(
      '70000000-0000-4000-8000-000000000011', 'All-Hazards Emergency Plan', current_date + 1,
      'Added transportation vendor escalation', '{"evacuationZones":["North","South"],"transportationEscalation":true}', null, null
    )
  )
$$, 'manager publishes a replacement emergency plan version');
select is(
  (select version_number from public.emergency_plan_versions where id = (select id from emergency_test_ids where key = 'plan-v2')),
  2,
  'replacement plan version increments immutably'
);
select throws_ok(
  $$update public.emergency_plan_versions set change_summary = 'rewrite' where id = (select id from emergency_test_ids where key = 'plan-v1')$$,
  '42501', null, 'browser cannot rewrite an approved plan version'
);

select lives_ok($$
  select public.upsert_resident_evacuation_profile(
    '70000000-0000-4000-8000-000000000201', 'two_person',
    'Wheelchair; cannot use stairs', 'Wheelchair-accessible van', 'Evacuation chair',
    'Evacuation chair and transfer belt', 'Use short direct prompts', 'Prefer North Campus',
    'Review after every mobility change'
  )
$$, 'manager records resident evacuation assistance and transportation needs');
select is(
  (select assistance_level from public.resident_evacuation_profiles where resident_id = '70000000-0000-4000-8000-000000000201'),
  'two_person', 'resident assistance level is structured'
);

select lives_ok($$
  insert into public.emergency_staff_assignments (
    id, organization_id, facility_id, employee_id, emergency_role, responsibility, created_by
  ) values (
    '70000000-0000-4000-8000-000000000401', '70000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000011', '70000000-0000-4000-8000-000000000301',
    'resident_accountability', 'Account for residents in rooms 100-110', '70000000-0000-4000-8000-000000000101'
  )
$$, 'manager assigns an emergency responsibility');
select throws_ok($$
  insert into public.emergency_staff_assignments (
    organization_id, facility_id, employee_id, emergency_role, responsibility
  ) values (
    '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000012',
    '70000000-0000-4000-8000-000000000301', 'logistics', 'Cross-facility assignment'
  )
$$, '42501', null, 'staff assignments cannot cross facility scope');
select lives_ok($$
  insert into public.emergency_resources (
    id, organization_id, facility_id, resource_type, name, contact_name, phone, address, capacity, is_active
  ) values (
    '70000000-0000-4000-8000-000000000501', '70000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000011', 'relocation_site', 'North Campus Shelter',
    'Shelter Lead', '555-0202', '100 North Road', 50, true
  )
$$, 'manager records a relocation site');
select lives_ok($$
  insert into public.emergency_inventory_items (
    id, organization_id, facility_id, inventory_type, item_name, quantity, unit,
    minimum_quantity, status, location, checked_by
  ) values (
    '70000000-0000-4000-8000-000000000601', '70000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000011', 'generator_fuel', 'Generator diesel',
    180, 'gallons', 120, 'ready', 'Generator enclosure', '70000000-0000-4000-8000-000000000101'
  )
$$, 'manager records generator-fuel readiness');
select throws_ok($$
  select public.start_emergency_event(
    '70000000-0000-4000-8000-000000000012', 'drill', 'fire', now(),
    'Unprepared drill', 'Main building', 'South lot', '70000000-0000-4000-8000-000000000101', null, null
  )
$$, '55000', null, 'event cannot start without an approved plan version');

select lives_ok($$
  insert into emergency_test_ids values (
    'event',
    public.start_emergency_event(
      '70000000-0000-4000-8000-000000000011', 'drill', 'fire', now(),
      'Full-building evacuation drill', 'Main building', 'North assembly area',
      '70000000-0000-4000-8000-000000000101', null, null
    )
  )
$$, 'manager declares an emergency drill');
select is(
  (select status from public.emergency_events where id = (select id from emergency_test_ids where key = 'event')),
  'active', 'new emergency event is active'
);
select is(
  (select plan_version_id from public.emergency_events where id = (select id from emergency_test_ids where key = 'event')),
  (select id from emergency_test_ids where key = 'plan-v2'),
  'event preserves the plan version in force at declaration'
);
select is(
  (select count(*)::integer from public.emergency_event_residents where emergency_event_id = (select id from emergency_test_ids where key = 'event')),
  1, 'active residents are snapshotted into the event roster'
);
select is(
  (select assistance_level_snapshot from public.emergency_event_residents where emergency_event_id = (select id from emergency_test_ids where key = 'event')),
  'two_person', 'resident assistance needs are snapshotted'
);
select is(
  (select count(*)::integer from public.emergency_event_staff where emergency_event_id = (select id from emergency_test_ids where key = 'event')),
  1, 'standing emergency staff are snapshotted into the event roster'
);
select throws_ok($$
  insert into public.emergency_events (
    organization_id, facility_id, event_number, event_mode, event_type, plan_version_id,
    started_at, summary
  ) values (
    '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011',
    'EMG-BYPASS', 'drill', 'fire', (select id from emergency_test_ids where key = 'plan-v2'), now(), 'Bypass attempt'
  )
$$, '42501', null, 'manager cannot bypass event declaration through direct insert');
select throws_ok($$
  select public.transition_emergency_event(
    (select id from emergency_test_ids where key = 'event'), 'stabilized', 'All clear before accountability'
  )
$$, '55000', null, 'event cannot stabilize while anyone is unaccounted');

select lives_ok($$
  select public.record_emergency_accountability(
    (select id from emergency_test_ids where key = 'event'), 'resident',
    '70000000-0000-4000-8000-000000000201', 'relocated',
    '70000000-0000-4000-8000-000000000301', '70000000-0000-4000-8000-000000000501',
    'Resident transferred to accessible shelter area'
  )
$$, 'resident is accounted for with assistance and relocation');
select lives_ok($$
  select public.record_emergency_accountability(
    (select id from emergency_test_ids where key = 'event'), 'staff',
    '70000000-0000-4000-8000-000000000301', 'evacuated', null, null,
    'Staff member at assembly point'
  )
$$, 'staff member is accounted for');
select is(
  (select name from public.emergency_resources where id = (
    select relocation_site_id from public.emergency_event_residents
    where emergency_event_id = (select id from emergency_test_ids where key = 'event')
  )),
  'North Campus Shelter', 'resident relocation destination is retained'
);
select is(
  (public.queue_designated_person_notifications(
    (select id from emergency_test_ids where key = 'event'),
    'The resident is safe at the North Campus Shelter.', 'phone'
  )->>'recipientCount')::integer,
  1, 'mass notification queues every designated-person contact'
);
select is(
  (select count(*)::integer from public.emergency_communications
   where emergency_event_id = (select id from emergency_test_ids where key = 'event')
     and audience = 'designated_person' and delivery_status = 'queued'),
  1, 'designated-person notification evidence is queryable'
);
select lives_ok($$
  select public.add_emergency_timeline_entry(
    (select id from emergency_test_ids where key = 'event'), 'observation', now(),
    'Evacuation route remained clear.', '{"route":"north exit"}'
  )
$$, 'manager appends an event timeline observation');
select lives_ok($$
  select public.log_emergency_communication(
    (select id from emergency_test_ids where key = 'event'), 'utility', null, null,
    'Electric utility', '555-0303', 'phone', 'confirmed',
    'Utility confirmed no service interruption.', now(), null
  )
$$, 'utility communication is logged');
select lives_ok($$
  select public.add_emergency_corrective_action(
    (select id from emergency_test_ids where key = 'event'),
    'Replace faded evacuation placard', 'Install a high-contrast placard at the north exit.',
    '70000000-0000-4000-8000-000000000101', 'high', now() + interval '7 days'
  )
$$, 'after-action finding creates owned corrective work');
select is(
  (select w.source_type from public.emergency_event_actions a
   join public.work_items w on w.id = a.work_item_id
   where a.emergency_event_id = (select id from emergency_test_ids where key = 'event')),
  'emergency', 'corrective action uses the shared work engine'
);
select lives_ok($$
  select public.transition_emergency_event(
    (select id from emergency_test_ids where key = 'event'), 'stabilized',
    'All residents and staff accounted for at the assembly area'
  )
$$, 'fully accounted event reaches stabilized status');
select throws_ok($$
  select public.transition_emergency_event(
    (select id from emergency_test_ids where key = 'event'), 'closed',
    'Close before after-action review'
  )
$$, '55000', null, 'event cannot close before after-action approval');
select throws_ok($$
  select public.save_emergency_after_action(
    (select id from emergency_test_ids where key = 'event'), 'approved',
    'The drill was completed.', '', '', '', ''
  )
$$, '55000', null, 'incomplete after-action review cannot be approved');
select lives_ok($$
  select public.save_emergency_after_action(
    (select id from emergency_test_ids where key = 'event'), 'approved',
    'All residents and staff evacuated and were accounted for within the drill objective.',
    'Accountability roles were clear and transportation equipment was ready.',
    'The north-exit placard was faded and difficult to read.',
    'Quarterly route inspections should include signage legibility.',
    'Replace the placard and verify the repair through the shared work queue.'
  )
$$, 'manager approves an evidence-backed after-action review');
select lives_ok($$
  select public.transition_emergency_event(
    (select id from emergency_test_ids where key = 'event'), 'closed',
    'After-action review approved; event command formally closed'
  )
$$, 'stabilized event closes after after-action approval');
select is(
  (select status from public.emergency_events where id = (select id from emergency_test_ids where key = 'event')),
  'closed', 'event lifecycle records formal closure'
);
select is(
  (select w.state from public.emergency_event_actions a
   join public.work_items w on w.id = a.work_item_id
   where a.emergency_event_id = (select id from emergency_test_ids where key = 'event')),
  'open', 'event closure does not silently close corrective work'
);

reset role;
select throws_ok($$
  update public.emergency_event_timeline set description = 'rewrite'
  where emergency_event_id = (select id from emergency_test_ids where key = 'event')
$$, '55000', null, 'event timeline is append-only evidence');

select pg_temp.act_as('70000000-0000-4000-8000-000000000102');
select is(
  (select count(*)::integer from public.emergency_events),
  1, 'auditor can read scoped emergency evidence'
);
select throws_ok($$
  select public.create_emergency_plan_version(
    '70000000-0000-4000-8000-000000000011', 'Auditor Rewrite', current_date,
    'Auditor should not publish', '{}', null, null
  )
$$, '42501', null, 'auditor cannot publish emergency plans');

select pg_temp.act_as('80000000-0000-4000-8000-000000000101');
select is(
  (select count(*)::integer from public.emergency_events),
  0, 'other tenant cannot see emergency events'
);
select is(
  (select count(*)::integer from public.emergency_plan_versions),
  0, 'other tenant cannot see emergency plan history'
);
select is(
  (select count(*)::integer from public.emergency_event_residents),
  0, 'other tenant cannot see resident accountability'
);
select is(
  (select count(*)::integer from public.emergency_communications),
  0, 'other tenant cannot see emergency communications'
);

select * from finish();
rollback;
