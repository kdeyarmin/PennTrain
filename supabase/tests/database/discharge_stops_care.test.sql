-- pgTAP coverage for 20260905140000: discharge stops care documentation (I15).
--
-- The defect was that it did not. A resident discharged on Tuesday kept every service task already
-- scheduled for the rest of the week on the Floor queue, and nothing refused an aide who worked
-- that list. An entry for a discharged resident is documentation of care that did not happen --
-- worse at survey than a gap, because a gap is an omission and this is an assertion.
-- Run with: supabase test db.

begin;
select plan(9);

insert into public.organizations(id, name, slug) values
  ('f1000000-0000-4000-8000-000000000001', 'Discharge Org', 'discharge-org');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('f1000000-0000-4000-8000-000000000011', 'f1000000-0000-4000-8000-000000000001', 'Discharge Facility', 'PCH');
insert into public.residents(id, organization_id, facility_id, first_name, last_name, status, admission_date) values
  ('f1000000-0000-4000-8000-000000000041', 'f1000000-0000-4000-8000-000000000001',
   'f1000000-0000-4000-8000-000000000011', 'Robin', 'Resident', 'active', current_date - 60),
  ('f1000000-0000-4000-8000-000000000042', 'f1000000-0000-4000-8000-000000000001',
   'f1000000-0000-4000-8000-000000000011', 'Dana', 'Departed', 'discharged', current_date - 200);

-- 1-4. The write guard, straight at the tables every path lands on.
select lives_ok(
  $$insert into public.clinical_observations(
      organization_id, facility_id, resident_id, observation_type, observed_at, value_text
    ) values (
      'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000011',
      'f1000000-0000-4000-8000-000000000041', 'blood_pressure', now(), '120/78'
    )$$,
  'documentation for a resident who is still here lands normally'
);
select throws_ok(
  $$insert into public.clinical_observations(
      organization_id, facility_id, resident_id, observation_type, observed_at, value_text
    ) values (
      'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000011',
      'f1000000-0000-4000-8000-000000000042', 'blood_pressure', now(), '120/78'
    )$$,
  '55000',
  null,
  'a clinical observation for a discharged resident is refused'
);
select throws_ok(
  $$insert into public.resident_unscheduled_services(
      organization_id, facility_id, resident_id, service_kind
    ) values (
      'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000011',
      'f1000000-0000-4000-8000-000000000042', 'escort'
    )$$,
  '55000',
  null,
  'so is an unscheduled service -- the guard is on the table, not in each of the seven callers'
);
-- The message has to tell an aide what to do, because an aide is who hits this.
select ok(
  (select prosrc like '%tell the administrator%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'assert_resident_accepts_documentation'),
  'and the refusal tells the person holding the tablet what to do instead'
);

-- 5-6. Hospital leave is deliberately NOT refused: a draft written before the transfer, synced
-- after it, is real care that really happened.
update public.residents set status = 'hospital_leave'
  where id = 'f1000000-0000-4000-8000-000000000041';
select lives_ok(
  $$insert into public.clinical_observations(
      organization_id, facility_id, resident_id, observation_type, observed_at, value_text
    ) values (
      'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000011',
      'f1000000-0000-4000-8000-000000000041', 'blood_pressure', now() - interval '6 hours', '118/76'
    )$$,
  'a late-synced observation for a resident now in hospital is still accepted'
);
select is(
  (select count(*)::integer from public.clinical_observations
   where resident_id = 'f1000000-0000-4000-8000-000000000041'),
  2,
  'both of that resident''s observations are on file'
);

-- 7-9. The transfer RPCs move the status, which is what makes the queue predicate mean anything.
select ok(
  (select prosrc like '%hospital_leave%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'start_hospital_transfer'),
  'start_hospital_transfer now moves the resident to hospital_leave -- it touched residents not at all before'
);
select ok(
  (select prosrc like '%hospital_leave%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_hospital_return'),
  'and complete_hospital_return restores active, only from hospital_leave'
);
select ok(
  (select prosrc like '%r.status in (''active'', ''temporarily_out'')%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_resident_service_task_queue'),
  'the Floor queue lists work only for residents who are actually here'
);

select * from finish();
rollback;
