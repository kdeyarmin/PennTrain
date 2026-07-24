begin;
select plan(32);

-- Structure + hardened grants -----------------------------------------------------------
select has_table('public', 'fhir_writeback_queue', 'outbound FHIR write-back queue exists');
select has_column('public', 'facilities', 'clinical_enabled', 'facilities carry a per-facility clinical switch');
select has_column('public', 'fhir_integration_sources', 'writeback_enabled', 'FHIR sources carry an opt-in write-back switch');
select is(
  (select is_active from public.integration_api_scope_definitions where scope_key = 'clinical.writeback'),
  true,
  'the clinical.writeback credential scope is now active'
);
select has_function('public', 'queue_clinical_observation_writeback', 'observation write-back enqueue RPC exists');
select has_function('public', 'claim_fhir_writeback_batch', 'write-back drain claim RPC exists');
select has_function('public', 'complete_fhir_writeback', 'write-back completion RPC exists');
select has_function('public', 'set_facility_clinical_enabled', 'per-facility enablement toggle RPC exists');
select ok(
  not has_table_privilege('anon', 'public.fhir_writeback_queue', 'SELECT'),
  'anonymous callers cannot read the write-back queue'
);

-- Fixtures ------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('e5000000-0000-4000-8000-000000000001', 'Enablement Org A', 'enablement-org-a', 'active'),
  ('e5000000-0000-4000-8000-000000000002', 'Enablement Org B', 'enablement-org-b', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('e5000000-0000-4000-8000-000000000011', 'e5000000-0000-4000-8000-000000000001', 'Facility A1', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'e5000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'ea-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'e5000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'ea-emp@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'e5000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'ea-mgr@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'e5000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'eb-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('e5000000-0000-4000-8000-000000000101', 'e5000000-0000-4000-8000-000000000001', 'ea-admin@test.local', 'Ada', 'Admin', 'org_admin', true),
  ('e5000000-0000-4000-8000-000000000102', 'e5000000-0000-4000-8000-000000000001', 'ea-emp@test.local', 'Ann', 'Aide', 'employee', true),
  ('e5000000-0000-4000-8000-000000000103', 'e5000000-0000-4000-8000-000000000001', 'ea-mgr@test.local', 'Mel', 'Manager', 'facility_manager', true),
  ('e5000000-0000-4000-8000-000000000201', 'e5000000-0000-4000-8000-000000000002', 'eb-admin@test.local', 'Bob', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name, email, job_title, hire_date, status
) values
  ('e5000000-0000-4000-8000-000000000112', 'e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000011', 'e5000000-0000-4000-8000-000000000102', 'Ann', 'Aide', 'ea-emp@test.local', 'Direct Care Staff', current_date, 'active');

insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status) values
  ('e5000000-0000-4000-8000-000000000301', 'e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000011', 'Rosa', 'Resident', current_date - 30, 'active'),
  ('e5000000-0000-4000-8000-000000000302', 'e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000011', 'Remy', 'Resident', current_date - 20, 'active');

-- A write-back-enabled FHIR source + patient mapping for resident 301 (but not 302).
insert into public.fhir_integration_sources(
  id, organization_id, facility_id, name, vendor_name, fhir_base_url, external_facility_id,
  status, writeback_enabled
) values (
  'e5000000-0000-4000-8000-000000000401', 'e5000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000011', 'Test EHR', 'Test FHIR Vendor',
  'https://fhir.test.invalid/r4', 'ext-fac-1', 'active', true
);
insert into public.fhir_patient_mappings(
  organization_id, facility_id, source_id, resident_id, fhir_patient_id, status
) values (
  'e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000011',
  'e5000000-0000-4000-8000-000000000401', 'e5000000-0000-4000-8000-000000000301', 'patient-301', 'active'
);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal1',
      'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end $$;
create temporary table wb_ids(key text primary key, id uuid) on commit drop;
grant all on wb_ids to authenticated, service_role;

-- Per-facility enablement ---------------------------------------------------------------
-- Facility A1 is clinical-enabled by default: the assigned employee can chart.
select pg_temp.act_as('e5000000-0000-4000-8000-000000000102');
select lives_ok(
  $$insert into wb_ids(key, id) values ('o1', public.record_clinical_observation(
    'e5000000-0000-4000-8000-000000000301', 'blood_pressure', now(), 122, 80, null, 'mm[Hg]'))$$,
  'assigned employee can chart while the facility is clinical-enabled'
);
select lives_ok(
  $$insert into wb_ids(key, id) values ('o2', public.record_clinical_observation(
    'e5000000-0000-4000-8000-000000000302', 'heart_rate', now(), 72, null, null, '/min'))$$,
  'assigned employee can chart a second resident with no write-back mapping'
);

-- The org admin disables the facility.
select pg_temp.act_as('e5000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.set_facility_clinical_enabled('e5000000-0000-4000-8000-000000000011', false)$$,
  'org admin can disable clinical capability for a facility'
);

-- With the facility disabled, new native charting is blocked.
select pg_temp.act_as('e5000000-0000-4000-8000-000000000102');
select throws_ok(
  $$select public.record_clinical_observation(
    'e5000000-0000-4000-8000-000000000301', 'temperature', now(), 37, null, null, 'Cel')$$,
  '42501', null,
  'charting is blocked once the facility is clinical-disabled'
);

-- ...but previously captured records stay readable.
select pg_temp.act_as('e5000000-0000-4000-8000-000000000101');
select ok(
  (select count(*) from public.get_resident_clinical_observations('e5000000-0000-4000-8000-000000000301')) > 0,
  'existing clinical records remain readable at a disabled facility'
);

-- Only an org admin may flip the switch.
select pg_temp.act_as('e5000000-0000-4000-8000-000000000102');
select throws_ok(
  $$select public.set_facility_clinical_enabled('e5000000-0000-4000-8000-000000000011', true)$$,
  '42501', null,
  'an employee cannot change facility clinical enablement'
);
select pg_temp.act_as('e5000000-0000-4000-8000-000000000103');
select throws_ok(
  $$select public.set_facility_clinical_enabled('e5000000-0000-4000-8000-000000000011', true)$$,
  '42501', null,
  'a facility manager cannot change facility clinical enablement'
);
select pg_temp.act_as('e5000000-0000-4000-8000-000000000201');
select throws_ok(
  $$select public.set_facility_clinical_enabled('e5000000-0000-4000-8000-000000000011', true)$$,
  '42501', null,
  'an admin from another organization cannot change this facility'
);

-- Re-enable, and charting works again.
select pg_temp.act_as('e5000000-0000-4000-8000-000000000101');
select lives_ok(
  $$select public.set_facility_clinical_enabled('e5000000-0000-4000-8000-000000000011', true)$$,
  'org admin can re-enable clinical capability'
);
select pg_temp.act_as('e5000000-0000-4000-8000-000000000102');
select lives_ok(
  $$select public.record_clinical_observation(
    'e5000000-0000-4000-8000-000000000301', 'spo2', now(), 98, null, null, '%')$$,
  'charting resumes after the facility is re-enabled'
);

-- FHIR write-back -----------------------------------------------------------------------
-- An employee has no clinical.integration.writeback authority.
select pg_temp.act_as('e5000000-0000-4000-8000-000000000102');
select throws_ok(
  $$select public.queue_clinical_observation_writeback((select id from wb_ids where key = 'o1'))$$,
  '42501', null,
  'an employee cannot queue a clinical write-back'
);

-- The org admin can queue a write-back for a mapped resident.
select pg_temp.act_as('e5000000-0000-4000-8000-000000000101');
select lives_ok(
  $$insert into wb_ids(key, id) values ('wb1', public.queue_clinical_observation_writeback(
    (select id from wb_ids where key = 'o1')))$$,
  'org admin can queue an observation write-back for a write-back-enabled mapped resident'
);

reset role;
select is(
  (select status from public.fhir_writeback_queue where id = (select id from wb_ids where key = 'wb1')),
  'pending',
  'the queued write-back starts in the pending state'
);
select is(
  (select fhir_payload->>'resourceType' from public.fhir_writeback_queue
   where id = (select id from wb_ids where key = 'wb1')),
  'Observation',
  'the queued payload is a serialized FHIR Observation'
);
-- Blood pressure serializes to systolic/diastolic components, never a single valueQuantity.
select is(
  (select fhir_payload->'component'->1->'valueQuantity'->>'value' from public.fhir_writeback_queue
   where id = (select id from wb_ids where key = 'wb1')),
  '80',
  'the blood-pressure write-back preserves the diastolic value as a FHIR component'
);
select ok(
  not ((select fhir_payload from public.fhir_writeback_queue
        where id = (select id from wb_ids where key = 'wb1')) ? 'valueQuantity'),
  'the blood-pressure write-back does not collapse to a single systolic valueQuantity'
);

-- Queueing for a resident with no write-back-enabled mapping is refused.
select pg_temp.act_as('e5000000-0000-4000-8000-000000000101');
select throws_ok(
  $$select public.queue_clinical_observation_writeback((select id from wb_ids where key = 'o2'))$$,
  '42501', null,
  'queueing is refused when the resident has no write-back-enabled FHIR source'
);

-- The service-role drain claims the batch and records completion.
select pg_temp.act_as('e5000000-0000-4000-8000-000000000000', 'service_role');
select is(
  (select count(*)::integer from public.claim_fhir_writeback_batch(10)),
  1,
  'the service-role drain claims the pending write-back'
);
reset role;
select is(
  (select status from public.fhir_writeback_queue where id = (select id from wb_ids where key = 'wb1')),
  'in_flight',
  'a claimed write-back is marked in_flight'
);
select pg_temp.act_as('e5000000-0000-4000-8000-000000000000', 'service_role');
select lives_ok(
  $$select public.complete_fhir_writeback((select id from wb_ids where key = 'wb1'), true, 'ext-obs-1', null)$$,
  'the drain records a successful delivery'
);
reset role;
select is(
  (select status || ':' || coalesce(external_resource_id, '') from public.fhir_writeback_queue
   where id = (select id from wb_ids where key = 'wb1')),
  'sent:ext-obs-1',
  'a completed write-back is marked sent with the external resource id'
);

-- A write-back stuck in_flight past the staleness window is reclaimed (self-healing drain).
reset role;
alter table public.fhir_writeback_queue disable trigger set_updated_at;
insert into public.fhir_writeback_queue(
  organization_id, facility_id, source_id, resident_id, fhir_patient_id,
  resource_type, origin_kind, origin_id, fhir_payload, status, target_url, updated_at
) values (
  'e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000011',
  'e5000000-0000-4000-8000-000000000401', 'e5000000-0000-4000-8000-000000000301', 'patient-301',
  'Observation', 'clinical_observation', 'e5000000-0000-4000-8000-0000000004ff',
  '{"resourceType":"Observation"}'::jsonb, 'in_flight', 'https://fhir.test.invalid/r4',
  now() - interval '30 minutes'
);
alter table public.fhir_writeback_queue enable trigger set_updated_at;
select pg_temp.act_as('e5000000-0000-4000-8000-000000000000', 'service_role');
select is(
  (select count(*)::integer from public.claim_fhir_writeback_batch(10, 300)),
  1,
  'a write-back stuck in_flight past the staleness window is reclaimed by the drain'
);

-- Browser roles cannot drive the drain.
select pg_temp.act_as('e5000000-0000-4000-8000-000000000102');
select throws_ok(
  $$select public.claim_fhir_writeback_batch(10)$$,
  '42501', null,
  'authenticated browser roles cannot claim the write-back queue'
);

select * from finish();
rollback;
