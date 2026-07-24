-- PT-003: per-command integration inbox contracts.
-- medication.snapshot.import is registered at schema version 2026-07-14 in
-- public.integration_schema_definitions with least-privilege scope
-- medications:write; commands:write stays the superset scope for every command;
-- unregistered command types keep the 2026-07-11 baseline envelope. This must
-- match PHASE2_INTEGRATION_COMMAND_CONTRACTS in
-- supabase/functions/_shared/phase2Integration.ts and
-- 20260724230000_per_command_integration_contracts.sql.
begin;
select plan(13);

select has_function('public', 'accept_integration_command',
  array['uuid', 'text', 'text', 'text', 'text', 'jsonb', 'text'],
  'the versioned command inbox RPC exists');
select results_eq(
  $$ select schema_version from public.integration_schema_definitions
     where schema_kind = 'command' and schema_name = 'medication.snapshot.import'
       and lifecycle_status = 'active' $$,
  $$ values ('2026-07-14'::text) $$,
  'medication.snapshot.import is registered at 2026-07-14 in the schema registry'
);

insert into public.organizations(id, name, slug, subscription_status)
values ('aa000000-0000-4000-8000-000000000001', 'Command Contract Org', 'command-contract-org', 'active');
insert into public.integration_api_credentials(
  id, organization_id, name, key_prefix, scopes, status, expires_at, rate_limit_per_minute
) values
  ('aa000000-0000-4000-8000-000000000101', 'aa000000-0000-4000-8000-000000000001',
   'Medication least privilege', 'aa0000000001', array['medications:write'], 'active',
   now() + interval '30 days', 120),
  ('aa000000-0000-4000-8000-000000000102', 'aa000000-0000-4000-8000-000000000001',
   'Generic command superset', 'aa0000000002', array['commands:write'], 'active',
   now() + interval '30 days', 120),
  ('aa000000-0000-4000-8000-000000000103', 'aa000000-0000-4000-8000-000000000001',
   'Read only', 'aa0000000003', array['events:read'], 'active',
   now() + interval '30 days', 120);

reset role;
set local role service_role;

create temporary table med_command_first on commit drop as
select * from public.accept_integration_command(
  'aa000000-0000-4000-8000-000000000101', 'med-contract-0001', repeat('a', 64),
  'medication.snapshot.import', '2026-07-14',
  '{"sourceId":"aa000000-0000-4000-8000-000000000201","orders":[],"administrations":[]}'::jsonb,
  'med-contract-correlation'
);
select results_eq(
  $$ select was_duplicate, command_status from med_command_first $$,
  $$ values (false, 'accepted'::text) $$,
  'a medications:write credential submits a medication snapshot at its registered version'
);
select results_eq(
  $$ select command_id = (select command_id from med_command_first), was_duplicate
     from public.accept_integration_command(
       'aa000000-0000-4000-8000-000000000101', 'med-contract-0001', repeat('a', 64),
       'medication.snapshot.import', '2026-07-14',
       '{"sourceId":"aa000000-0000-4000-8000-000000000201","orders":[],"administrations":[]}'::jsonb,
       'med-contract-correlation-retry') $$,
  $$ values (true, true) $$,
  'a replayed medication command returns the canonical receipt'
);
select is(
  (select count(*)::integer from app_private.integration_command_receipts
   where credential_id = 'aa000000-0000-4000-8000-000000000101'
     and idempotency_key = 'med-contract-0001'),
  1,
  'medication command idempotency stores one receipt'
);
select is(
  (select count(*)::integer from app_private.integration_event_log
   where causation_id = (select command_id::text from med_command_first)),
  1,
  'an accepted medication command emits one versioned accepted event'
);
select results_eq(
  $$ select was_duplicate, command_status from public.accept_integration_command(
       'aa000000-0000-4000-8000-000000000102', 'med-contract-0002', repeat('b', 64),
       'medication.snapshot.import', '2026-07-14',
       '{"sourceId":"aa000000-0000-4000-8000-000000000201","orders":[],"administrations":[]}'::jsonb,
       'med-contract-superset') $$,
  $$ values (false, 'accepted'::text) $$,
  'commands:write remains a superset scope that can submit medication snapshots'
);
select lives_ok(
  $$ select * from public.accept_integration_command(
       'aa000000-0000-4000-8000-000000000102', 'generic-contract-0001', repeat('c', 64),
       'workforce.lifecycle.sync', '2026-07-11', '{"externalId":"employee-1"}'::jsonb,
       'generic-contract-correlation') $$,
  'unregistered commands keep the 2026-07-11 baseline envelope'
);

select throws_ok(
  $$ select * from public.accept_integration_command(
       'aa000000-0000-4000-8000-000000000103', 'read-only-0001', repeat('d', 64),
       'medication.snapshot.import', '2026-07-14', '{}'::jsonb, 'read-only-correlation') $$,
  '42501', null, 'a read-only credential cannot submit any command'
);
select throws_ok(
  $$ select * from public.accept_integration_command(
       'aa000000-0000-4000-8000-000000000101', 'med-scope-0001', repeat('e', 64),
       'workforce.lifecycle.sync', '2026-07-11', '{}'::jsonb, 'med-scope-correlation') $$,
  '42501', null, 'the medication scope does not extend to the generic inbox'
);
select throws_ok(
  $$ select * from public.accept_integration_command(
       'aa000000-0000-4000-8000-000000000102', 'med-version-0001', repeat('f', 64),
       'medication.snapshot.import', '2026-07-11', '{}'::jsonb, 'med-version-correlation') $$,
  '22023', 'Command medication.snapshot.import requires schema version 2026-07-14',
  'a medication snapshot at the baseline version is rejected naming the registered version'
);
select throws_ok(
  $$ select * from public.accept_integration_command(
       'aa000000-0000-4000-8000-000000000101', 'med-version-0002', repeat('0', 64),
       'medication.snapshot.import', '2026-07-01', '{}'::jsonb, 'med-version-correlation-2') $$,
  '22023', 'Command medication.snapshot.import requires schema version 2026-07-14',
  'an unknown medication schema version is rejected naming the registered version'
);
select throws_ok(
  $$ select * from public.accept_integration_command(
       'aa000000-0000-4000-8000-000000000102', 'generic-version-0001', repeat('1', 64),
       'workforce.lifecycle.sync', '2026-07-14', '{}'::jsonb, 'generic-version-correlation') $$,
  '22023', 'Command workforce.lifecycle.sync requires schema version 2026-07-11',
  'an unregistered command cannot borrow another command''s version'
);

select * from finish();
rollback;
