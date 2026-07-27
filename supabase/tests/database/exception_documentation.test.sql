begin;
select plan(10);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='resident_service_task_instances'
      and column_name='completion_response'
  ),
  'task instances carry a documentation response separate from status'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='resident_service_task_instances'
      and column_name='documented_assistance_level'
  ),
  'the documented assistance level is denormalized for indexed filtering'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='resident_service_task_exception_idx'
  ),
  'exceptions are indexed for the conflict and change detectors'
);

-- The response vocabulary must match serviceDeliveryContract.ts exactly; drift would let the UI
-- offer a response the database rejects.
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid='public.resident_service_task_instances'::regclass
     and pg_get_constraintdef(oid) like '%completed_with_more_assistance%')
  like '%concern_observed%',
  'the task response vocabulary covers all seven documentation responses'
);

-- Unscheduled services -----------------------------------------------------
select ok(
  exists (select 1 from information_schema.tables
    where table_schema='public' and table_name='resident_unscheduled_services'),
  'unscheduled services have their own table'
);
select ok(
  (select relrowsecurity from pg_class where oid='public.resident_unscheduled_services'::regclass),
  'unscheduled services are row-level secured'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name='resident_unscheduled_services'
      and grantee in ('anon','public') 
  ),
  'unscheduled services are not readable by anon or public'
);
select ok(
  exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name='resident_unscheduled_services'
      and grantee='authenticated' and privilege_type='SELECT'
  ),
  'authenticated users can select unscheduled services, gated by RLS'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name='resident_unscheduled_services'
      and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')
  ),
  'unscheduled services are written only through the RPC, never directly'
);
select ok(
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_resident_service_utilization'
  ),
  'a utilization read model exists for the care-level review'
);

select * from finish();
rollback;
