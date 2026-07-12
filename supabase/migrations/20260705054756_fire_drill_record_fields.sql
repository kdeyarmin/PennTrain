-- Fire drills (55 Pa. Code Section 2600.132/2800.132) require a prescribed written record with
-- nine fields (date, time, evacuation duration, exit route, residents present, residents
-- evacuated, staff participating, problems encountered, whether the alarm/detector was
-- operative), plus rotation across shifts/exits over time and a separate 6-month
-- sleeping-hours-drill cadence. inspection_events already has performed_date -- these columns
-- add the rest, nullable since they only apply to fire_drill_program-type inspection_items (the
-- same table also logs equipment checks, which don't have a "shift" or "exit route").
alter table public.inspection_events
  add column drill_time time,
  add column evacuation_duration_seconds integer,
  add column exit_route_used text,
  add column residents_present_count integer,
  add column residents_evacuated_count integer,
  add column staff_participating_count integer,
  add column alarm_or_detector_operative boolean,
  add column problems_encountered text,
  add column shift text check (shift in ('day','evening','overnight')),
  add column is_sleeping_hours_drill boolean not null default false;

-- Two more procedural item types: the fire-safety-expert evacuation-time letter (an
-- annually-expiring document requirement, tracked the same way as any other recurring
-- inspection_item) and the emergency-preparedness 3-day food/water supply check
-- (55 Pa. Code Section 2600.107), following the same pattern 20260705002224_expand_facility_types.sql
-- used to add facility types to this same check constraint.
alter table public.inspection_items drop constraint inspection_items_item_type_check;
alter table public.inspection_items add constraint inspection_items_item_type_check
  check (item_type in (
    'generator','fire_extinguisher','fire_alarm_system','sprinkler_system','smoke_detector',
    'emergency_lighting','elevator','other_equipment',
    'fire_drill_program','emergency_prep_plan_review','other_procedural',
    'evacuation_time_letter','emergency_supply_check'));
