-- pgTAP coverage for 20260905160000: a monthly drill that was never monthly (I18).
--
-- Two schedules, both wrong. The monthly drill ran on a 30-day interval, so a drill on January 31
-- set the next deadline to March 2 and February could be skipped with every screen reading
-- "compliant". The six-month sleeping-hours drill was recorded on the event, printed on the
-- tracker, asked for by name on the detail page -- and computed nowhere at all.
-- Run with: supabase test db.

begin;
select plan(18);

------------------------------------------------------------------------------------------------
-- 1-5. The rule itself, against literal dates so the assertions do not move with the calendar.
------------------------------------------------------------------------------------------------
select has_function(
  'public', 'inspection_item_next_due_date', array['text', 'integer', 'date', 'date'],
  'the due-date rule exists as one function rather than inline in each caller'
);
select is(
  public.inspection_item_next_due_date('fire_drill_program', 30, date '2026-01-31', date '2026-01-01'),
  date '2026-02-28',
  'a drill on the last day of January is due again by the last day of February -- not March 2'
);
select is(
  public.inspection_item_next_due_date('fire_drill_program', 30, date '2026-01-02', date '2026-01-01'),
  date '2026-02-28',
  'and a drill on January 2 has exactly the same deadline: the rule is the month, not the gap'
);
select is(
  public.inspection_item_next_due_date('fire_drill_program', 30, null, date '2026-03-14'),
  date '2026-03-31',
  'a program with no drill yet owes one this month, not next'
);
select is(
  public.inspection_item_next_due_date('sleeping_hours_fire_drill', 183, date '2026-01-20', date '2025-01-01'),
  date '2026-07-20',
  'the sleeping-hours drill is six calendar months from the last one'
);

------------------------------------------------------------------------------------------------
-- Fixture
------------------------------------------------------------------------------------------------
insert into public.organizations (id, name, slug) values
  ('a5000000-0000-4000-8000-000000000001', 'Drill Org', 'drill-org');
insert into public.facilities (id, organization_id, name, facility_type) values
  ('a5000000-0000-4000-8000-000000000011', 'a5000000-0000-4000-8000-000000000001', 'Drill Facility', 'PCH');

insert into public.inspection_items (
  id, organization_id, facility_id, item_kind, item_type, label, inspection_interval_days, install_date
) values (
  'a5000000-0000-4000-8000-000000000101', 'a5000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000011', 'procedural', 'fire_drill_program',
  'Monthly Fire Drill', 30, public.pa_today() - 400
);

------------------------------------------------------------------------------------------------
-- 6-8. The sleeping-hours schedule exists at all, which it never did before.
------------------------------------------------------------------------------------------------
select is(
  (select count(*)::integer from public.inspection_items
   where derived_from_inspection_item_id = 'a5000000-0000-4000-8000-000000000101'
     and item_type = 'sleeping_hours_fire_drill'),
  1,
  'creating a fire drill program derives exactly one sleeping-hours schedule'
);
select throws_ok(
  $$insert into public.inspection_events (
      inspection_item_id, performed_date, performed_by, result
    ) select id, public.pa_today(), 'Morgan', 'pass'
      from public.inspection_items
      where derived_from_inspection_item_id = 'a5000000-0000-4000-8000-000000000101'$$,
  '55000',
  null,
  'a drill cannot be logged against the derived schedule -- it belongs to the program'
);
select is(
  (select status from public.inspection_items
   where id = 'a5000000-0000-4000-8000-000000000101'),
  'expired',
  'a program installed over a year ago with no drill on file is expired, not compliant'
);

------------------------------------------------------------------------------------------------
-- 9-13. Monthly drills roll the program forward; they do not touch the six-month clock.
------------------------------------------------------------------------------------------------
insert into public.inspection_events (
  inspection_item_id, performed_date, performed_by, result, shift, is_sleeping_hours_drill
) values (
  'a5000000-0000-4000-8000-000000000101', date_trunc('month', public.pa_today())::date,
  'Morgan Aide', 'pass', 'day', false
);

select is(
  (select next_due_date from public.inspection_items where id = 'a5000000-0000-4000-8000-000000000101'),
  (date_trunc('month', public.pa_today()) + interval '2 months' - interval '1 day')::date,
  'a drill this month moves the deadline to the last day of next month'
);
select is(
  (select status from public.inspection_items where id = 'a5000000-0000-4000-8000-000000000101'),
  'compliant',
  'and the program reads compliant again'
);
select is(
  (select last_inspected_date from public.inspection_items
   where derived_from_inspection_item_id = 'a5000000-0000-4000-8000-000000000101'),
  null,
  'a day-shift drill is not a sleeping-hours drill, so the six-month clock has still never started'
);
select is(
  (select status from public.inspection_items
   where derived_from_inspection_item_id = 'a5000000-0000-4000-8000-000000000101'),
  'expired',
  'and with the program installed 400 days ago that schedule is overdue -- this is the case nothing computed'
);
select is(
  (select count(*)::integer from public.alerts a
   join public.inspection_items i on i.id = a.inspection_item_id
   where i.derived_from_inspection_item_id = 'a5000000-0000-4000-8000-000000000101'
     and a.alert_type = 'inspection_due' and a.status = 'open' and a.severity = 'critical'),
  1,
  'an overdue sleeping-hours drill raises its own critical alert'
);

------------------------------------------------------------------------------------------------
-- 14-16. Ticking "sleeping hours" is what moves it, and it moves at once.
------------------------------------------------------------------------------------------------
insert into public.inspection_events (
  inspection_item_id, performed_date, performed_by, result, shift, is_sleeping_hours_drill
) values (
  'a5000000-0000-4000-8000-000000000101', public.pa_today() - 1,
  'Morgan Aide', 'pass', 'overnight', true
);

select is(
  (select next_due_date from public.inspection_items
   where derived_from_inspection_item_id = 'a5000000-0000-4000-8000-000000000101'),
  (public.pa_today() - 1 + interval '6 months')::date,
  'the sleeping-hours drill rolls its schedule six months forward without waiting for the nightly sweep'
);
select is(
  (select status from public.inspection_items
   where derived_from_inspection_item_id = 'a5000000-0000-4000-8000-000000000101'),
  'compliant',
  'and the schedule reads compliant'
);
select is(
  (select count(*)::integer from public.alerts a
   join public.inspection_items i on i.id = a.inspection_item_id
   where i.derived_from_inspection_item_id = 'a5000000-0000-4000-8000-000000000101'
     and a.status = 'open'),
  0,
  'its alert is closed by the drill, not left for someone to dismiss by hand'
);

------------------------------------------------------------------------------------------------
-- 17-18. Retiring the program retires its derived schedule, and Survey Day asks about both.
------------------------------------------------------------------------------------------------
update public.inspection_items set is_active = false
where id = 'a5000000-0000-4000-8000-000000000101';
select is(
  (select is_active from public.inspection_items
   where derived_from_inspection_item_id = 'a5000000-0000-4000-8000-000000000101'),
  false,
  'deactivating the program deactivates the schedule derived from it'
);

select ok(
  exists (
    select 1 from public.entrance_conference_items
    where data_source = 'inspections'
      and item_types @> array['fire_drill_program', 'sleeping_hours_fire_drill']
  ) and not exists (
    select 1 from public.entrance_conference_items
    where data_source = 'inspections' and item_types is null
  ),
  'the Survey Day fire-drill row covers both cadences, and no inspections row is left unscoped'
);

select * from finish();
rollback;
