begin;
select plan(13);

select has_function('public', 'get_facility_occupancy_board', array['uuid'],
  'the occupancy board read path exists');

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('e8000000-0000-4000-8000-000000000001', 'Occupancy Org', 'occupancy-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('e8000000-0000-4000-8000-000000000011', 'e8000000-0000-4000-8000-000000000001', 'Occupancy Facility', 'PCH');
insert into public.facility_buildings(id, organization_id, facility_id, name, licensed_capacity) values
  ('e8000000-0000-4000-8000-000000000021', 'e8000000-0000-4000-8000-000000000001',
   'e8000000-0000-4000-8000-000000000011', 'Main House', 20);
insert into public.facility_rooms(
  id, organization_id, facility_id, building_id, room_number, room_type
) values
  ('e8000000-0000-4000-8000-000000000031', 'e8000000-0000-4000-8000-000000000001',
   'e8000000-0000-4000-8000-000000000011', 'e8000000-0000-4000-8000-000000000021', '101', 'semi_private');

insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date, status
) values
  ('e8000000-0000-4000-8000-000000000301', 'e8000000-0000-4000-8000-000000000001',
   'e8000000-0000-4000-8000-000000000011', 'Ola', 'Resident', public.pa_today() - 100, 'active'),
  ('e8000000-0000-4000-8000-000000000302', 'e8000000-0000-4000-8000-000000000001',
   'e8000000-0000-4000-8000-000000000011', 'Omar', 'Away', public.pa_today() - 100, 'hospital_leave'),
  ('e8000000-0000-4000-8000-000000000303', 'e8000000-0000-4000-8000-000000000001',
   'e8000000-0000-4000-8000-000000000011', 'Opal', 'Gone', public.pa_today() - 300, 'discharged');

insert into public.facility_beds(
  id, organization_id, facility_id, room_id, bed_label, status, occupied_by_resident_id
) values
  ('e8000000-0000-4000-8000-000000000041', 'e8000000-0000-4000-8000-000000000001',
   'e8000000-0000-4000-8000-000000000011', 'e8000000-0000-4000-8000-000000000031', 'A',
   'occupied', 'e8000000-0000-4000-8000-000000000301'),
  -- A resident on hospital leave still holds their bed.
  ('e8000000-0000-4000-8000-000000000042', 'e8000000-0000-4000-8000-000000000001',
   'e8000000-0000-4000-8000-000000000011', 'e8000000-0000-4000-8000-000000000031', 'B',
   'occupied', 'e8000000-0000-4000-8000-000000000302'),
  ('e8000000-0000-4000-8000-000000000043', 'e8000000-0000-4000-8000-000000000001',
   'e8000000-0000-4000-8000-000000000011', 'e8000000-0000-4000-8000-000000000031', 'C',
   'maintenance_hold', null);

-- Licensed capacity, before any licence exists --------------------------------------
-- This is the assertion that matters most: with no licence on file the board must report NO
-- licensed capacity, not the three beds it can see. Substituting a physical number for a regulatory
-- one is how a facility comes to believe it has room it is not licensed for.
select ok(
  public.get_facility_occupancy_board('e8000000-0000-4000-8000-000000000011')
    ->> 'licensedCapacity' is null,
  'with no licence on file, licensed capacity is null rather than a bed count'
);
select is(
  public.get_facility_occupancy_board('e8000000-0000-4000-8000-000000000011')
    ->> 'licensedCapacitySource',
  'no_active_license_on_file',
  'and the board says why it has no figure'
);

-- With a licence -----------------------------------------------------------------------
insert into public.facility_licenses(
  organization_id, facility_id, license_type, license_number, status,
  effective_from, expires_on, licensed_capacity
) values (
  'e8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000011',
  'personal_care_home', 'PCH-12345', 'active',
  public.pa_today() - 30, public.pa_today() + 300, 16
);

select is(
  (public.get_facility_occupancy_board('e8000000-0000-4000-8000-000000000011')
    ->> 'licensedCapacity')::int,
  16,
  'licensed capacity comes from the facility licence'
);
select is(
  public.get_facility_occupancy_board('e8000000-0000-4000-8000-000000000011')
    ->> 'licensedCapacitySource',
  'facility_license',
  'and the board names the licence as its source'
);

-- The building's own allocation is reported separately and never substituted for the licence: it is
-- 20 here while the licence permits 16, and conflating them would overstate capacity by four beds.
select is(
  (public.get_facility_occupancy_board('e8000000-0000-4000-8000-000000000011')
    -> 'buildings' -> 0 ->> 'building_allocated_capacity')::int,
  20,
  'the building allocation is reported separately from the licensed figure'
);

-- An expired licence is not a licence.
update public.facility_licenses set expires_on = public.pa_today() - 1
where facility_id = 'e8000000-0000-4000-8000-000000000011';
select ok(
  public.get_facility_occupancy_board('e8000000-0000-4000-8000-000000000011')
    ->> 'licensedCapacity' is null,
  'an expired licence stops providing a capacity figure'
);
update public.facility_licenses set expires_on = public.pa_today() + 300
where facility_id = 'e8000000-0000-4000-8000-000000000011';

-- Census -------------------------------------------------------------------------------
select is(
  (public.get_facility_occupancy_board('e8000000-0000-4000-8000-000000000011')
    -> 'census' ->> 'activeResidents')::int,
  1,
  'active residents are counted'
);
select is(
  (public.get_facility_occupancy_board('e8000000-0000-4000-8000-000000000011')
    -> 'census' ->> 'occupyingABed')::int,
  2,
  'a resident on hospital leave still counts against capacity, because they still hold a bed'
);

-- Bed states ---------------------------------------------------------------------------
select is(
  (public.get_facility_occupancy_board('e8000000-0000-4000-8000-000000000011')
    -> 'buildings' -> 0 ->> 'maintenance_hold')::int,
  1,
  'a maintenance hold is reported as its own state, not merged into unavailable'
);
select is(
  (public.get_facility_occupancy_board('e8000000-0000-4000-8000-000000000011')
    -> 'buildings' -> 0 ->> 'occupied_but_away')::int,
  1,
  'and a held bed whose resident is away is distinguishable from one in use tonight'
);

-- Reconciliation -------------------------------------------------------------------------
-- Bed occupancy and resident census are maintained by different write paths, so they can disagree.
-- The board reports the disagreement rather than hiding it behind one number.
insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date, status
) values (
  'e8000000-0000-4000-8000-000000000304', 'e8000000-0000-4000-8000-000000000001',
  'e8000000-0000-4000-8000-000000000011', 'Otto', 'Bedless', public.pa_today() - 5, 'active'
);
select is(
  jsonb_array_length(public.get_facility_occupancy_board('e8000000-0000-4000-8000-000000000011')
    -> 'reconciliation' -> 'residentsWithoutABed'),
  1,
  'a resident occupying no bed is reported'
);

-- The other direction: a bed still pointing at somebody who has been discharged.
update public.facility_beds set occupied_by_resident_id = 'e8000000-0000-4000-8000-000000000303'
where id = 'e8000000-0000-4000-8000-000000000043';
select is(
  jsonb_array_length(public.get_facility_occupancy_board('e8000000-0000-4000-8000-000000000011')
    -> 'reconciliation' -> 'bedsHeldByNonResidents'),
  1,
  'and a bed still held by a discharged resident is reported too'
);

select * from finish();
rollback;
