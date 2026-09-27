begin;
select plan(4);

insert into public.organizations(id, name, slug, subscription_status)
values ('c1110000-0000-4000-8000-000000000001', 'Utilization Org', 'utilization-late-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type)
values ('c1110000-0000-4000-8000-000000000011', 'c1110000-0000-4000-8000-000000000001', 'Utilization Facility', 'PCH');
insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date
) values (
  'c1110000-0000-4000-8000-000000000201', 'c1110000-0000-4000-8000-000000000001',
  'c1110000-0000-4000-8000-000000000011', 'Jamie', 'Resident', public.pa_today()
);
insert into public.resident_assessment_forms(
  id, organization_id, facility_id, resident_id, form_type, reason, status
) values (
  'c1110000-0000-4000-8000-000000000301', 'c1110000-0000-4000-8000-000000000001',
  'c1110000-0000-4000-8000-000000000011', 'c1110000-0000-4000-8000-000000000201',
  'RASP', 'initial', 'draft'
);
insert into public.resident_service_requirements(
  id, organization_id, facility_id, resident_id, source_assessment_form_id, source_plan_version,
  source_section, source_key, service_code, service_name, special_instructions, frequency,
  responsible_role, effective_from
) values (
  'c1110000-0000-4000-8000-000000000401', 'c1110000-0000-4000-8000-000000000001',
  'c1110000-0000-4000-8000-000000000011', 'c1110000-0000-4000-8000-000000000201',
  'c1110000-0000-4000-8000-000000000301', 1, 'section1', 'bathing', 'bathe', 'Bathing assistance',
  'Provide bathing assistance', 'daily', 'employee', public.pa_today()
);

insert into public.resident_service_task_instances(
  id, organization_id, facility_id, resident_id, requirement_id, source_assessment_form_id,
  source_plan_version, service_name, responsible_role, scheduled_start, scheduled_end,
  status, completion_response, documented_assistance_level, performed_at
) values
  ('c1110000-0000-4000-8000-000000000501', 'c1110000-0000-4000-8000-000000000001',
   'c1110000-0000-4000-8000-000000000011', 'c1110000-0000-4000-8000-000000000201',
   'c1110000-0000-4000-8000-000000000401', 'c1110000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() - interval '3 hours', now() - interval '2 hours',
   'completed_late', 'completed_as_planned', null, now() - interval '30 minutes'),
  ('c1110000-0000-4000-8000-000000000502', 'c1110000-0000-4000-8000-000000000001',
   'c1110000-0000-4000-8000-000000000011', 'c1110000-0000-4000-8000-000000000201',
   'c1110000-0000-4000-8000-000000000401', 'c1110000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() - interval '5 hours', now() - interval '4 hours',
   'completed', 'completed_as_planned', null, now() - interval '4 hours'),
  ('c1110000-0000-4000-8000-000000000503', 'c1110000-0000-4000-8000-000000000001',
   'c1110000-0000-4000-8000-000000000011', 'c1110000-0000-4000-8000-000000000201',
   'c1110000-0000-4000-8000-000000000401', 'c1110000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() - interval '7 hours', now() - interval '6 hours',
   'resident_refused', 'resident_refused', null, now() - interval '6 hours'),
  ('c1110000-0000-4000-8000-000000000504', 'c1110000-0000-4000-8000-000000000001',
   'c1110000-0000-4000-8000-000000000011', 'c1110000-0000-4000-8000-000000000201',
   'c1110000-0000-4000-8000-000000000401', 'c1110000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() - interval '9 hours', now() - interval '8 hours',
   'completed_late', 'completed_with_more_assistance', 'two_person', now() - interval '8 hours'),
  ('c1110000-0000-4000-8000-000000000505', 'c1110000-0000-4000-8000-000000000001',
   'c1110000-0000-4000-8000-000000000011', 'c1110000-0000-4000-8000-000000000201',
   'c1110000-0000-4000-8000-000000000401', 'c1110000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() - interval '40 days', now() - interval '40 days' + interval '1 hour',
   'completed_late', 'completed_as_planned', null, now() - interval '40 days');

select is(
  (public.get_resident_service_utilization('c1110000-0000-4000-8000-000000000201', 30)->'exceptions'->>'completed_late')::int,
  1,
  'a late planned completion counts as completed_late'
);
select is(
  (public.get_resident_service_utilization('c1110000-0000-4000-8000-000000000201', 30)->'exceptions'->>'resident_refused')::int,
  1,
  'a refusal still counts on its response'
);
select is(
  (public.get_resident_service_utilization('c1110000-0000-4000-8000-000000000201', 30)->'exceptions'->>'completed_with_more_assistance')::int,
  1,
  'late extra assistance stays on that response and is not also completed_late'
);
select ok(
  not (public.get_resident_service_utilization('c1110000-0000-4000-8000-000000000201', 30)->'exceptions' ? 'completed_as_planned'),
  'an on-time planned completion is not an exception'
);

select * from finish();
rollback;
