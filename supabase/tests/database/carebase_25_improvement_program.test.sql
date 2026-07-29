begin;
select plan(18);

select has_function('public', 'get_workforce_readiness_forecast', array['uuid'],
  'the 30/60/90-day workforce forecast RPC exists');
select has_function('public', 'run_workforce_readiness_forecast_maintenance',
  'the forecast-to-work maintenance function exists');
select has_function('public', 'initialize_implementation_project', array['text', 'date', 'uuid', 'jsonb'],
  'the governed implementation initializer exists');

select is(
  (select category from public.work_item_source_types where key = 'inspection_war_room'),
  'compliance',
  'inspection response requests have a governed source category'
);
select is(
  (select source_type from public.work_item_templates
   where organization_id is null and template_key = 'inspection.war_room_request'),
  'inspection_war_room',
  'the inspection response template uses its specific source type'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'work_item_templates'
      and c.conname = 'work_item_templates_source_type_fkey'
      and c.contype = 'f'
  ),
  'work-item templates are governed by a taxonomy foreign key'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'work_item_templates'
      and c.conname = 'work_item_templates_source_type_check'
  ),
  'the stale cumulative source-type CHECK no longer competes with the taxonomy'
);

select ok(
  position('administrator-profile' in pg_get_functiondef(
    'public.initialize_implementation_project(text,date,uuid,jsonb)'::regprocedure
  )) > 0,
  'new implementation projects include administrator qualification'
);
select ok(
  position('roles-access' in pg_get_functiondef(
    'public.initialize_implementation_project(text,date,uuid,jsonb)'::regprocedure
  )) > 0,
  'new implementation projects include user and access configuration'
);
select ok(
  position('survey-rehearsal' in pg_get_functiondef(
    'public.initialize_implementation_project(text,date,uuid,jsonb)'::regprocedure
  )) > 0,
  'new implementation projects include a Survey Day rehearsal'
);

insert into public.organizations(id, name, slug, subscription_status) values
  ('c2500000-0000-4000-8000-000000000001', 'Forecast Org', 'forecast-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('c2500000-0000-4000-8000-000000000011', 'c2500000-0000-4000-8000-000000000001', 'Forecast Facility', 'PCH');
insert into public.employees(
  id, organization_id, facility_id, first_name, last_name, job_title, status,
  cleared_for_unsupervised_duty
) values (
  'c2500000-0000-4000-8000-000000000101', 'c2500000-0000-4000-8000-000000000001',
  'c2500000-0000-4000-8000-000000000011', 'Future', 'Risk', 'Caregiver', 'active', true
);
insert into public.employee_credentials(
  id, organization_id, facility_id, employee_id, credential_type, credential_label,
  status, expiration_date
) values (
  'c2500000-0000-4000-8000-000000000201', 'c2500000-0000-4000-8000-000000000001',
  'c2500000-0000-4000-8000-000000000011', 'c2500000-0000-4000-8000-000000000101',
  'first_aid', 'First aid', 'active', public.pa_today() + 20
);
insert into public.training_types(
  id, organization_id, code, name, category, state, applies_to_facility_type, is_active
) values (
  'c2500000-0000-4000-8000-000000000301', 'c2500000-0000-4000-8000-000000000001',
  'FORECAST-TRAINING', 'Forecast training', 'annual', 'PA', 'all', true
);
insert into public.employee_training_records(
  id, organization_id, facility_id, employee_id, training_type_id, status,
  completion_date, due_date
) values (
  'c2500000-0000-4000-8000-000000000401', 'c2500000-0000-4000-8000-000000000001',
  'c2500000-0000-4000-8000-000000000011', 'c2500000-0000-4000-8000-000000000101',
  'c2500000-0000-4000-8000-000000000301', 'complete', public.pa_today() - 300, public.pa_today() + 40
);

set local role service_role;
select is(
  (public.get_workforce_readiness_forecast('c2500000-0000-4000-8000-000000000011') ->> 'activeEmployees')::int,
  1,
  'the readiness forecast scopes active employees to the selected facility'
);
select is(
  (public.get_workforce_readiness_forecast('c2500000-0000-4000-8000-000000000011')
    -> 'horizons' -> 0 ->> 'credentialEvents')::int,
  1,
  'the 30-day horizon attributes the expiring credential'
);
select is(
  (public.get_workforce_readiness_forecast('c2500000-0000-4000-8000-000000000011')
    -> 'horizons' -> 0 ->> 'trainingEvents')::int,
  0,
  'the 30-day horizon does not pull a 40-day training renewal forward'
);
select is(
  (public.get_workforce_readiness_forecast('c2500000-0000-4000-8000-000000000011')
    -> 'horizons' -> 1 ->> 'trainingEvents')::int,
  1,
  'the 60-day horizon includes the training renewal with its source record'
);
select is(
  public.get_workforce_readiness_forecast('c2500000-0000-4000-8000-000000000011')
    -> 'risks' -> 0 ->> 'employeeName',
  'Future Risk',
  'the forecast names the employee rather than returning an unexplained count'
);

select lives_ok(
  $$select public.run_workforce_readiness_forecast_maintenance()$$,
  'the forecast maintenance runs through the governed service-role path'
);
select is(
  (select count(*)::int from public.work_items
   where organization_id = 'c2500000-0000-4000-8000-000000000001'
     and deduplication_key = 'readiness-forecast:credential:c2500000-0000-4000-8000-000000000201'),
  1,
  'one expiring credential becomes one deduplicated work item'
);
select is(
  (select priority from public.work_items
   where organization_id = 'c2500000-0000-4000-8000-000000000001'
     and deduplication_key = 'readiness-forecast:credential:c2500000-0000-4000-8000-000000000201'),
  'high',
  'a future 30-day readiness risk is high priority rather than a current urgent blocker'
);

update public.employee_credentials
set expiration_date = public.pa_today() + 100
where id = 'c2500000-0000-4000-8000-000000000201';
select public.run_workforce_readiness_forecast_maintenance();
select is(
  (select state from public.work_items
   where organization_id = 'c2500000-0000-4000-8000-000000000001'
     and deduplication_key = 'readiness-forecast:credential:c2500000-0000-4000-8000-000000000201'),
  'closed',
  'the forecast work item closes when the source record no longer presents a 30-day risk'
);

select * from finish();
rollback;
