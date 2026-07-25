begin;
select plan(10);

select has_function('public', 'get_schedule_acuity_roster', array['uuid'],
  'the acuity roster read path exists');

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('c6000000-0000-4000-8000-000000000001', 'Acuity Org', 'acuity-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('c6000000-0000-4000-8000-000000000011', 'c6000000-0000-4000-8000-000000000001', 'Acuity Facility', 'PCH');
insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date, status,
  level_of_care, transfer_assistance, ambulation_status, fall_risk, elopement_risk, cognitive_status
) values
  ('c6000000-0000-4000-8000-000000000301', 'c6000000-0000-4000-8000-000000000001',
   'c6000000-0000-4000-8000-000000000011', 'Casey', 'Heavy', current_date - 400, 'active',
   'total_physical_assistance', 'two_person', 'wheelchair', 'high', 'monitored', 'moderate_impairment'),
  ('c6000000-0000-4000-8000-000000000302', 'c6000000-0000-4000-8000-000000000001',
   'c6000000-0000-4000-8000-000000000011', 'Cameron', 'Light', current_date - 400, 'active',
   'independent', 'independent', 'independent', 'low', 'none', 'no_impairment'),
  -- A discharged resident must not appear: a roster that counts people who have left produces a
  -- workload figure for care nobody is giving.
  ('c6000000-0000-4000-8000-000000000303', 'c6000000-0000-4000-8000-000000000001',
   'c6000000-0000-4000-8000-000000000011', 'Cody', 'Discharged', current_date - 400, 'discharged',
   'total_physical_assistance', 'mechanical_lift', 'bedfast', 'high', 'high', 'severe_impairment');

insert into public.schedules(
  id, organization_id, facility_id, title, period_start, period_end
) values (
  'c6000000-0000-4000-8000-000000000401', 'c6000000-0000-4000-8000-000000000001',
  'c6000000-0000-4000-8000-000000000011', 'Test week', current_date, current_date + 6
);

select is(
  jsonb_array_length(public.get_schedule_acuity_roster('c6000000-0000-4000-8000-000000000401') -> 'residents'),
  2,
  'the roster carries only active residents'
);

select is(
  public.get_schedule_acuity_roster('c6000000-0000-4000-8000-000000000401')
    -> 'residents' -> 0 ->> 'display_name',
  'Cameron Light',
  'residents are ordered by name so the payload is stable between calls'
);

-- Each acuity attribute must reach the client, because each is a separate line in the itemized
-- workload. A missing one silently reduces somebody's estimated care.
select is(
  public.get_schedule_acuity_roster('c6000000-0000-4000-8000-000000000401')
    -> 'residents' -> 1 ->> 'level_of_care',
  'total_physical_assistance',
  'the level of care is carried'
);
select is(
  public.get_schedule_acuity_roster('c6000000-0000-4000-8000-000000000401')
    -> 'residents' -> 1 ->> 'transfer_assistance',
  'two_person',
  'and the transfer assistance'
);
select is(
  public.get_schedule_acuity_roster('c6000000-0000-4000-8000-000000000401')
    -> 'residents' -> 1 ->> 'cognitive_status',
  'moderate_impairment',
  'and the cognitive status'
);

-- No escort staff are assigned, so the escort count is zero rather than inferred from anything else.
select is(
  (public.get_schedule_acuity_roster('c6000000-0000-4000-8000-000000000401')
    -> 'residents' -> 1 ->> 'appointment_escorts')::int,
  0,
  'appointment escorts count only events with staff actually assigned'
);

-- The function computes no workload figure at all: that arithmetic is in acuityWorkload.ts so it is
-- reproducible from a fixture roster without a database.
select ok(
  not (public.get_schedule_acuity_roster('c6000000-0000-4000-8000-000000000401') ? 'totalMinutes'),
  'the read path returns no workload total'
);
select ok(
  not (public.get_schedule_acuity_roster('c6000000-0000-4000-8000-000000000401') ? 'requiredStaff'),
  'and certainly no required staffing level'
);

-- The disclaimer travels with the data, so an export cannot present these numbers as a requirement
-- without carrying the sentence that says they are not one.
select ok(
  public.get_schedule_acuity_roster('c6000000-0000-4000-8000-000000000401')
    ->> 'advisoryNotice' like '%not a required staffing level%',
  'the advisory notice is part of the payload'
);

select * from finish();
rollback;
