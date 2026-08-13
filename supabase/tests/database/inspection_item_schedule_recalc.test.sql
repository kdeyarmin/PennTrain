begin;
select plan(26);

-- 20260810101000 restores the inspection_items maintenance the nightly recalc lost on
-- 2026-07-05: logging an inspection event rolls the item's dates forward immediately
-- (trigger), the nightly sweep flips status against the Pennsylvania calendar, and
-- 'inspection_due' alerts are raised, escalated and resolved like every other domain.
-- Without it, equipment and fire-drill schedules silently stopped being tracked.

select has_function(
  'public', 'recalculate_inspection_item_compliance', array['uuid'],
  'the inspection schedule recalc exists'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.recalculate_inspection_item_compliance(uuid)', 'EXECUTE'),
  'authenticated users cannot run the recalc directly -- it reaches them via the trigger and cron'
);
select has_trigger(
  'public', 'inspection_events', 'inspection_event_rolls_item_forward',
  'logging an inspection event updates the parent item without waiting for the nightly job'
);

------------------------------------------------------------------------------------------------
-- Fixture
------------------------------------------------------------------------------------------------
insert into public.organizations (id, name, slug) values
  ('9c000000-0000-4000-8000-000000000001', 'Inspection Recalc Org', 'inspection-recalc-org');

insert into public.facilities (id, organization_id, name, facility_type) values
  ('9c000000-0000-4000-8000-000000000011', '9c000000-0000-4000-8000-000000000001', 'Inspection Recalc Facility', 'PCH');

insert into public.inspection_items (
  id, organization_id, facility_id, item_kind, item_type, label, inspection_interval_days
) values
  -- A: never inspected, annual interval -- the nightly sweep must still derive a due date.
  ('9c000000-0000-4000-8000-000000000101', '9c000000-0000-4000-8000-000000000001',
   '9c000000-0000-4000-8000-000000000011', 'equipment', 'generator', 'Backup Generator', 365),
  -- B: quarterly, inspected long ago -- expired until re-inspected.
  ('9c000000-0000-4000-8000-000000000102', '9c000000-0000-4000-8000-000000000001',
   '9c000000-0000-4000-8000-000000000011', 'equipment', 'fire_extinguisher', 'Hall Extinguisher', 90),
  -- C: quarterly, drifting toward due -- exercises due_soon and the severity escalation.
  ('9c000000-0000-4000-8000-000000000103', '9c000000-0000-4000-8000-000000000001',
   '9c000000-0000-4000-8000-000000000011', 'procedural', 'fire_drill_program', 'Overnight Fire Drill', 90);

------------------------------------------------------------------------------------------------
-- The trigger path: an event insert updates the item at once
------------------------------------------------------------------------------------------------
insert into public.inspection_events (
  id, organization_id, facility_id, inspection_item_id, performed_date, performed_by, result
) values (
  '9c000000-0000-4000-8000-000000000201', '9c000000-0000-4000-8000-000000000001',
  '9c000000-0000-4000-8000-000000000011', '9c000000-0000-4000-8000-000000000102',
  public.pa_today() - 120, 'Morgan Inspector', 'pass'
);

select is(
  (select last_inspected_date from public.inspection_items where id = '9c000000-0000-4000-8000-000000000102'),
  public.pa_today() - 120,
  'the logged inspection stamps last_inspected_date immediately'
);
select is(
  (select next_due_date from public.inspection_items where id = '9c000000-0000-4000-8000-000000000102'),
  public.pa_today() - 30,
  'next_due_date rolls forward from the inspection by the item interval'
);
select is(
  (select status from public.inspection_items where id = '9c000000-0000-4000-8000-000000000102'),
  'expired',
  'a due date already in the past reads expired, not missing'
);
select is(
  (select count(*)::int from public.alerts
   where inspection_item_id = '9c000000-0000-4000-8000-000000000102'
     and alert_type = 'inspection_due' and status = 'open' and severity = 'critical'),
  1,
  'an expired item raises a critical inspection_due alert'
);

-- A fail is evidence, not a completed inspection: dates and the open alert must not move.
insert into public.inspection_events (
  id, organization_id, facility_id, inspection_item_id, performed_date, performed_by, result
) values (
  '9c000000-0000-4000-8000-000000000204', '9c000000-0000-4000-8000-000000000001',
  '9c000000-0000-4000-8000-000000000011', '9c000000-0000-4000-8000-000000000102',
  public.pa_today(), 'Morgan Inspector', 'fail'
);

select is(
  (select last_inspected_date from public.inspection_items where id = '9c000000-0000-4000-8000-000000000102'),
  public.pa_today() - 120,
  'a failed inspection does not stamp last_inspected_date'
);
select is(
  (select next_due_date from public.inspection_items where id = '9c000000-0000-4000-8000-000000000102'),
  public.pa_today() - 30,
  'a failed inspection does not roll next_due_date forward'
);
select is(
  (select status from public.inspection_items where id = '9c000000-0000-4000-8000-000000000102'),
  'expired',
  'a failed inspection leaves an overdue item expired'
);
select is(
  (select count(*)::int from public.alerts
   where inspection_item_id = '9c000000-0000-4000-8000-000000000102'
     and alert_type = 'inspection_due' and status = 'open' and severity = 'critical'),
  1,
  'a failed inspection does not resolve the open inspection_due alert'
);

-- Re-inspecting the expired item brings it back and closes its alert.
insert into public.inspection_events (
  id, organization_id, facility_id, inspection_item_id, performed_date, performed_by, result
) values (
  '9c000000-0000-4000-8000-000000000202', '9c000000-0000-4000-8000-000000000001',
  '9c000000-0000-4000-8000-000000000011', '9c000000-0000-4000-8000-000000000102',
  public.pa_today(), 'Morgan Inspector', 'pass'
);

select is(
  (select next_due_date from public.inspection_items where id = '9c000000-0000-4000-8000-000000000102'),
  public.pa_today() + 90,
  'a fresh passing inspection advances next_due_date a full interval'
);
select is(
  (select status from public.inspection_items where id = '9c000000-0000-4000-8000-000000000102'),
  'compliant',
  'and the item reads compliant again'
);
select is(
  (select count(*)::int from public.alerts
   where inspection_item_id = '9c000000-0000-4000-8000-000000000102' and status = 'open'),
  0,
  'no open alert remains for the re-inspected item'
);
select is(
  (select count(*)::int from public.alerts
   where inspection_item_id = '9c000000-0000-4000-8000-000000000102'
     and alert_type = 'inspection_due' and status = 'resolved'),
  1,
  'the stale alert was resolved, not deleted or left open'
);

-- Approaching the due date is a warning, not a crisis.
insert into public.inspection_events (
  id, organization_id, facility_id, inspection_item_id, performed_date, performed_by, result
) values (
  '9c000000-0000-4000-8000-000000000203', '9c000000-0000-4000-8000-000000000001',
  '9c000000-0000-4000-8000-000000000011', '9c000000-0000-4000-8000-000000000103',
  public.pa_today() - 70, 'Morgan Inspector', 'pass'
);

select is(
  (select status from public.inspection_items where id = '9c000000-0000-4000-8000-000000000103'),
  'due_soon',
  'an item inside the 30-day window reads due_soon'
);
select is(
  (select count(*)::int from public.alerts
   where inspection_item_id = '9c000000-0000-4000-8000-000000000103'
     and alert_type = 'inspection_due' and status = 'open' and severity = 'warning'),
  1,
  'a due_soon item raises a warning inspection_due alert'
);

------------------------------------------------------------------------------------------------
-- The nightly path: recalculate_all_compliance() owns the fleet
------------------------------------------------------------------------------------------------
-- Age item C's inspection under the open warning alert (an UPDATE fires no insert
-- trigger, so only the nightly sweep can notice), then run the job.
update public.inspection_events
set performed_date = public.pa_today() - 200
where id = '9c000000-0000-4000-8000-000000000203';

select lives_ok(
  $$ select public.recalculate_all_compliance() $$,
  'the nightly recalc runs with inspection maintenance restored'
);

select is(
  (select status from public.inspection_items where id = '9c000000-0000-4000-8000-000000000103'),
  'expired',
  'the sweep expires an item whose due date has passed'
);
select is(
  (select next_due_date from public.inspection_items where id = '9c000000-0000-4000-8000-000000000103'),
  public.pa_today() - 110,
  'and recomputes its due date from the newest inspection'
);
select is(
  (select count(*)::int from public.alerts
   where inspection_item_id = '9c000000-0000-4000-8000-000000000103' and alert_type = 'inspection_due'),
  1,
  'the open warning alert is not duplicated by the sweep'
);
select is(
  (select severity from public.alerts
   where inspection_item_id = '9c000000-0000-4000-8000-000000000103'
     and alert_type = 'inspection_due' and status = 'open'),
  'critical',
  'it is escalated in place once the item expires'
);

-- The never-inspected item gets a schedule from its own record.
select is(
  (select next_due_date from public.inspection_items where id = '9c000000-0000-4000-8000-000000000101'),
  public.pa_today() + 365,
  'a never-inspected item is scheduled from its creation date plus interval'
);
select is(
  (select last_inspected_date from public.inspection_items where id = '9c000000-0000-4000-8000-000000000101'),
  null,
  'without inventing an inspection that never happened'
);
select is(
  (select status from public.inspection_items where id = '9c000000-0000-4000-8000-000000000101'),
  'compliant',
  'an annual item scheduled today is compliant'
);
select is(
  (select count(*)::int from public.alerts
   where inspection_item_id = '9c000000-0000-4000-8000-000000000101'),
  0,
  'and raises no alert'
);

select * from finish();
rollback;
