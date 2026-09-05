-- pgTAP coverage for 20260905280000: an OAPSA determination that decided nothing (I26.4).
--
-- employee_background_check_profiles carried the two states in which 6 Pa.C.S. Ch. 5 says a
-- facility may not employ a person -- a not_suitable suitability determination, and a provisional
-- employment period that ran out without clearances -- and neither one stopped anything. They were
-- read by Survey Day views. An administrator could mark someone not suitable and the scheduler
-- would offer them the next shift. Run with: supabase test db.

begin;
select plan(26);

------------------------------------------------------------------------------------------------
-- The window: unknown residency used to take the LONGER one
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('17000000-0000-4000-8000-000000000001', 'OAPSA Org', 'oapsa-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('17000000-0000-4000-8000-000000000011', '17000000-0000-4000-8000-000000000001',
   'OAPSA Facility', 'PCH');

select is(
  public.oapsa_provisional_window_days(true, '17000000-0000-4000-8000-000000000001'), 30,
  'a Pennsylvania resident of two years gets the 30-day provisional window'
);
select is(
  public.oapsa_provisional_window_days(false, '17000000-0000-4000-8000-000000000001'), 90,
  'an established non-resident awaiting the federal check gets 90'
);
select is(
  public.oapsa_provisional_window_days(null, '17000000-0000-4000-8000-000000000001'), 30,
  'and unknown residency gets the SHORTER one -- the longer window has to be established'
);

------------------------------------------------------------------------------------------------
-- Fixture: four employees, one per state
------------------------------------------------------------------------------------------------
insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title, status
) values
  ('17000000-0000-4000-8000-000000000031', '17000000-0000-4000-8000-000000000001',
   '17000000-0000-4000-8000-000000000011', 'Clear', 'Employee', 'Aide', 'active'),
  ('17000000-0000-4000-8000-000000000032', '17000000-0000-4000-8000-000000000001',
   '17000000-0000-4000-8000-000000000011', 'Unsuitable', 'Employee', 'Aide', 'active'),
  ('17000000-0000-4000-8000-000000000033', '17000000-0000-4000-8000-000000000001',
   '17000000-0000-4000-8000-000000000011', 'Lapsed', 'Employee', 'Aide', 'active'),
  ('17000000-0000-4000-8000-000000000034', '17000000-0000-4000-8000-000000000001',
   '17000000-0000-4000-8000-000000000011', 'Closing', 'Employee', 'Aide', 'active');

-- employee_facility_assignments rows come from sync_employee_primary_facility_assignment on insert;
-- writing them here duplicates the key.

-- provisional_max_days is deliberately NOT supplied: the trigger derives it, and a test that
-- supplied it would be testing its own arithmetic rather than the rule.
insert into public.employee_background_check_profiles(
  organization_id, facility_id, employee_id, pa_resident_two_years,
  provisional_start_date, suitability_determination
) values
  ('17000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000011',
   '17000000-0000-4000-8000-000000000031', true, null, 'suitable'),
  ('17000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000011',
   '17000000-0000-4000-8000-000000000032', true, null, 'not_suitable'),
  -- Started 40 days ago on a 30-day resident window: expired ten days ago.
  ('17000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000011',
   '17000000-0000-4000-8000-000000000033', true, public.pa_today() - 40, 'pending'),
  -- Started 20 days ago on the same window: five days left.
  ('17000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000011',
   '17000000-0000-4000-8000-000000000034', true, public.pa_today() - 25, 'pending');

select is(
  (select provisional_max_days from public.employee_background_check_profiles
   where employee_id = '17000000-0000-4000-8000-000000000033'),
  30,
  'the trigger derives the window on write, so no form can widen it by sending a number'
);
select is(
  (select provisional_max_days from public.employee_background_check_profiles
   where employee_id = '17000000-0000-4000-8000-000000000031'),
  null,
  'and leaves it null when no provisional period is running'
);

-- Unknown residency on an existing row must recompute down, not stay at 90.
update public.employee_background_check_profiles
set pa_resident_two_years = null
where employee_id = '17000000-0000-4000-8000-000000000034';
select is(
  (select provisional_max_days from public.employee_background_check_profiles
   where employee_id = '17000000-0000-4000-8000-000000000034'),
  30,
  'clearing the residency answer narrows the window rather than leaving the wider one in place'
);
update public.employee_background_check_profiles
set pa_resident_two_years = true
where employee_id = '17000000-0000-4000-8000-000000000034';

------------------------------------------------------------------------------------------------
-- The reading both gates share
------------------------------------------------------------------------------------------------
select is(
  public.oapsa_duty_status('17000000-0000-4000-8000-000000000031')->>'bar', null,
  'a suitable employee with no provisional period is not barred'
);
select is(
  public.oapsa_duty_status('17000000-0000-4000-8000-000000000032')->>'bar', 'not_suitable',
  'a not_suitable determination bars employment'
);
select is(
  public.oapsa_duty_status('17000000-0000-4000-8000-000000000033')->>'bar', 'provisional_expired',
  'so does a provisional period that ran out'
);
select is(
  (public.oapsa_duty_status('17000000-0000-4000-8000-000000000034')->>'daysRemaining')::int, 5,
  'and one still running reports its countdown'
);
select is(
  public.oapsa_duty_status('17000000-0000-4000-8000-000000000034')->>'bar', null,
  'without barring anyone while it runs'
);

------------------------------------------------------------------------------------------------
-- The schedule gate
------------------------------------------------------------------------------------------------
create or replace function pg_temp.schedule_outcome(p_employee uuid) returns jsonb
language sql as $$
  select public.evaluate_schedule_eligibility(
    p_employee, '17000000-0000-4000-8000-000000000011',
    (public.pa_today() + 1)::timestamptz + interval '7 hours',
    (public.pa_today() + 1)::timestamptz + interval '15 hours');
$$;

select is(
  pg_temp.schedule_outcome('17000000-0000-4000-8000-000000000032')->>'outcome', 'blocked',
  'a not_suitable employee cannot be scheduled'
);
select ok(
  pg_temp.schedule_outcome('17000000-0000-4000-8000-000000000032')->'hardBlocks'
    @> '["oapsa_not_suitable"]'::jsonb,
  'and the reason names the determination rather than something vaguer'
);
select is(
  pg_temp.schedule_outcome('17000000-0000-4000-8000-000000000033')->>'outcome', 'blocked',
  'an employee whose provisional period ended cannot be scheduled'
);
select ok(
  pg_temp.schedule_outcome('17000000-0000-4000-8000-000000000033')->'hardBlocks'
    @> '["oapsa_provisional_expired"]'::jsonb,
  'and that reason is named too'
);
select ok(
  pg_temp.schedule_outcome('17000000-0000-4000-8000-000000000034')->'warnings'
    @> '["oapsa_provisional_expiring"]'::jsonb,
  'a period inside its last fortnight warns the scheduler without stopping the shift'
);
select is(
  pg_temp.schedule_outcome('17000000-0000-4000-8000-000000000034')->>'outcome', 'warning',
  'which is a warning, not a block -- the person may still work'
);
select is(
  pg_temp.schedule_outcome('17000000-0000-4000-8000-000000000031')->>'outcome', 'eligible',
  'and a clear employee is still eligible'
);

-- An override must not clear the determination -- and the row cannot even be written, which is
-- where lifecycle_inactive and confirmed_exclusion were already held.
select throws_ok(
  $$ insert into public.schedule_eligibility_overrides(
       organization_id, facility_id, employee_id, block_code, scope_type, reason,
       authority_reference, effective_from, expires_at, granted_by
     ) values (
       '17000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000011',
       '17000000-0000-4000-8000-000000000032', 'oapsa_not_suitable', 'facility',
       'pgTAP: attempt to override a statutory bar', 'pgTAP',
       now() - interval '1 day', now() + interval '30 days',
       '17000000-0000-4000-8000-000000000032'
     ) $$,
  '23514', null,
  'no override row can be written against a not_suitable determination -- changing the determination is the way'
);
select is(
  pg_temp.schedule_outcome('17000000-0000-4000-8000-000000000032')->>'outcome', 'blocked',
  'and the employee stays blocked'
);

------------------------------------------------------------------------------------------------
-- The clock is watched
------------------------------------------------------------------------------------------------
select lives_ok(
  $$ select public.run_oapsa_provisional_maintenance() $$,
  'the daily sweep runs'
);
select is(
  (select count(*)::int from public.alerts
   where employee_id = '17000000-0000-4000-8000-000000000033'
     and alert_type = 'oapsa_provisional_expiring' and status = 'open' and severity = 'critical'),
  1,
  'an expired provisional period raises a critical alert'
);
select is(
  (select count(*)::int from public.alerts
   where employee_id = '17000000-0000-4000-8000-000000000034'
     and alert_type = 'oapsa_provisional_expiring' and status = 'open' and severity = 'warning'),
  1,
  'one about to expire raises a warning'
);
select is(
  (select count(*)::int from public.alerts
   where employee_id = '17000000-0000-4000-8000-000000000031'
     and alert_type = 'oapsa_provisional_expiring'),
  0,
  'and an employee with no provisional period raises nothing'
);

-- Re-running must not duplicate, and clearing the period must resolve.
select public.run_oapsa_provisional_maintenance();
select is(
  (select count(*)::int from public.alerts
   where employee_id = '17000000-0000-4000-8000-000000000033'
     and alert_type = 'oapsa_provisional_expiring'),
  1,
  'a second sweep does not duplicate the alert'
);

update public.employee_background_check_profiles
set provisional_start_date = null
where employee_id = '17000000-0000-4000-8000-000000000033';
select public.run_oapsa_provisional_maintenance();
select is(
  (select status from public.alerts
   where employee_id = '17000000-0000-4000-8000-000000000033'
     and alert_type = 'oapsa_provisional_expiring'),
  'resolved',
  'and clearing the provisional period resolves the alert rather than leaving it open'
);

select * from finish();
rollback;
