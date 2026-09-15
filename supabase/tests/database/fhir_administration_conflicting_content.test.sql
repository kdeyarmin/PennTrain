begin;
select plan(34);

-- Fixtures ------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('f1500000-0000-4000-8000-000000000001', 'FHIR Org A', 'fhir-conflict-org-a', 'active'),
  ('f1500000-0000-4000-8000-000000000002', 'FHIR Org B', 'fhir-conflict-org-b', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('f1500000-0000-4000-8000-000000000011', 'f1500000-0000-4000-8000-000000000001', 'FHIR Facility A1', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'f1500000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'fa-conflict-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'f1500000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'fa-conflict-auditor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'f1500000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'fb-conflict-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('f1500000-0000-4000-8000-000000000101', 'f1500000-0000-4000-8000-000000000001', 'fa-conflict-admin@test.local', 'Fiona', 'Admin', 'org_admin', true),
  ('f1500000-0000-4000-8000-000000000104', 'f1500000-0000-4000-8000-000000000001', 'fa-conflict-auditor@test.local', 'Ida', 'Auditor', 'auditor', true),
  ('f1500000-0000-4000-8000-000000000201', 'f1500000-0000-4000-8000-000000000002', 'fb-conflict-admin@test.local', 'Ben', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('f1500000-0000-4000-8000-000000000301', 'f1500000-0000-4000-8000-000000000001', 'f1500000-0000-4000-8000-000000000011', 'Ravi', 'Resident', public.pa_today() - 30, 'active');
insert into public.integration_api_credentials(
  id, organization_id, name, key_prefix, scopes, status, expires_at, rate_limit_per_minute, created_by
) values (
  'f1500000-0000-4000-8000-000000000401', 'f1500000-0000-4000-8000-000000000001',
  'FHIR Test Credential', 'fa15c0de0401', array['commands:write'], 'active', now() + interval '30 days', 120,
  'f1500000-0000-4000-8000-000000000101'
);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_id, 'role', p_role, 'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'anon' then set local role anon;
  elsif p_role = 'service_role' then set local role service_role;
  else set local role authenticated; end if;
end $$;
create temporary table fhir_conflict_ids(key text primary key, id uuid) on commit drop;
grant all on fhir_conflict_ids to authenticated, anon, service_role;

-- Manager configures a source and maps a FHIR patient ----------------------------------
select pg_temp.act_as('f1500000-0000-4000-8000-000000000101');
select lives_ok($$
  insert into fhir_conflict_ids(key, id) values ('source', public.save_fhir_integration_source(
    'f1500000-0000-4000-8000-000000000011', 'Epic Sandbox', 'Epic', 'ext-fac-1',
    'https://fhir.example.org/r4', 'f1500000-0000-4000-8000-000000000401', 60, 'active'))
$$, 'manager configures a FHIR source bound to a commands:write credential');
select lives_ok($$select public.map_fhir_patient(
  (select id from fhir_conflict_ids where key = 'source'), 'f1500000-0000-4000-8000-000000000301', 'fhir-patient-1',
  jsonb_build_object('system', 'urn:mrn', 'value', 'MRN-1'))
$$, 'manager maps a FHIR Patient id to a resident');

reset role;
create temporary table fhir_conflict_records (
  key text primary key, record jsonb not null, command_id uuid, result jsonb
) on commit drop;
grant all on fhir_conflict_records to authenticated, service_role;
insert into fhir_conflict_records(key, record) values ('original', jsonb_build_object(
  'fhirPatientId', 'fhir-patient-1', 'fhirResourceId', 'conflict-admin-1',
  'fhirRequestId', 'request-1', 'status', 'completed', 'medicationDisplay', 'Synthetic medicine',
  'effectiveAt', '2026-07-25T08:00:00Z', 'performerDisplay', 'Synthetic nurse',
  'raw', jsonb_build_object(
    'resourceType', 'MedicationAdministration', 'id', 'conflict-admin-1',
    'status', 'completed', 'subject', jsonb_build_object('reference', 'Patient/fhir-patient-1'),
    'effectiveDateTime', '2026-07-25T08:00:00Z',
    'dosage', jsonb_build_object('dose', jsonb_build_object('value', 10, 'unit', 'mg')),
    'meta', jsonb_build_object('versionId', '1', 'lastUpdated', '2026-07-25T09:00:00Z')
  )
));
insert into fhir_conflict_records(key, record)
select 'dose', jsonb_set(record, '{raw,dosage,dose,value}', '20'::jsonb)
from fhir_conflict_records where key = 'original';
insert into fhir_conflict_records(key, record)
select 'status', jsonb_set(record || '{"status":"entered-in-error"}', '{raw,status}', '"entered-in-error"')
from fhir_conflict_records where key = 'original';
insert into fhir_conflict_records(key, record)
select 'time', jsonb_set(record || '{"effectiveAt":"2026-07-25T10:00:00Z"}',
  '{raw,effectiveDateTime}', '"2026-07-25T10:00:00Z"')
from fhir_conflict_records where key = 'original';
insert into fhir_conflict_records(key, record)
select 'metadata', jsonb_set(record, '{raw,meta,versionId}', '"2"')
from fhir_conflict_records where key = 'original';

-- Exercise the actual acceptance + applier chain, not a second implementation of its insert.
create function pg_temp.import_fhir_conflict(p_key text, p_records jsonb) returns jsonb
language plpgsql as $$
declare v_id uuid; v_payload jsonb; v_result jsonb;
begin
  v_payload := jsonb_build_object('sourceId', (select id from fhir_conflict_ids where key = 'source'),
    'medicationRequests', '[]'::jsonb, 'medicationAdministrations', p_records);
  select command_id into v_id from public.accept_integration_command(
    'f1500000-0000-4000-8000-000000000401', 'fhir-conflict-' || p_key,
    encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'),
    'fhir.bundle.import', '2026-07-25', v_payload, 'fhir-conflict-test');
  v_result := public.apply_fhir_integration_command(v_id);
  insert into fhir_conflict_records(key, record, command_id, result)
    values ('receipt-' || p_key, v_payload, v_id, v_result)
    on conflict (key) do update set result = excluded.result;
  return v_result;
end;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'service_role');
select is(pg_temp.import_fhir_conflict('initial', jsonb_build_array(
    (select record from fhir_conflict_records where key = 'original'))),
  '{"requestsApplied":0,"administrationsApplied":1,"clinicalApplied":0,"exceptions":0}'::jsonb,
  'first administration is imported with the existing result contract');
insert into fhir_conflict_records(key, record)
select 'saved-evidence', to_jsonb(a) from public.fhir_medication_administrations a
where source_id = (select id from fhir_conflict_ids where key = 'source')
  and fhir_resource_id = 'conflict-admin-1';
select is(pg_temp.import_fhir_conflict('initial', jsonb_build_array(
    (select record from fhir_conflict_records where key = 'original'))),
  (select result from fhir_conflict_records where key = 'receipt-initial'),
  'reapplying the same accepted receipt returns its saved outcome');
select is(pg_temp.import_fhir_conflict('identical', jsonb_build_array(
    (select record from fhir_conflict_records where key = 'original'))),
  '{"requestsApplied":0,"administrationsApplied":1,"clinicalApplied":0,"exceptions":0}'::jsonb,
  'an identical resource in a new receipt remains a successful idempotent replay');
select is((select count(*) from public.fhir_integration_exceptions
  where source_id = (select id from fhir_conflict_ids where key = 'source')), 0::bigint,
  'identical receipt and resource replays do not create exceptions');
select is((select count(*) from public.fhir_medication_administrations
  where source_id = (select id from fhir_conflict_ids where key = 'source')), 1::bigint,
  'replays retain a single original administration');

select is(pg_temp.import_fhir_conflict('dose', jsonb_build_array(
    (select record from fhir_conflict_records where key = 'dose'))),
  '{"requestsApplied":0,"administrationsApplied":0,"clinicalApplied":0,"exceptions":1}'::jsonb,
  'a dose-only change inside raw is recorded as an exception instead of applied');
select ok(exists(select 1 from public.fhir_integration_exceptions
  where source_id = (select id from fhir_conflict_ids where key = 'source')
    and organization_id = 'f1500000-0000-4000-8000-000000000001'
    and facility_id = 'f1500000-0000-4000-8000-000000000011'
    and command_receipt_id = (select command_id from fhir_conflict_records where key = 'receipt-dose')
    and exception_type = 'administration_conflict' and severity = 'urgent' and status = 'open'
    and fhir_patient_id = 'fhir-patient-1'
    and summary like '%conflict-admin-1%conflicting content%'
    and summary not like '%Synthetic medicine%' and summary not like '%20%'),
  'conflict is urgent, scoped, points to the incoming receipt, and contains no clinical payload');
insert into fhir_conflict_ids(key, id)
select 'conflict', id from public.fhir_integration_exceptions
where source_id = (select id from fhir_conflict_ids where key = 'source')
  and exception_type = 'administration_conflict';
select is(pg_temp.import_fhir_conflict('dose-repeat', jsonb_build_array(
    (select record from fhir_conflict_records where key = 'dose')))->>'exceptions', '1',
  'another receipt carrying the same conflict still reports that it was not applied');
select is((select count(*) from public.fhir_integration_exceptions
  where source_id = (select id from fhir_conflict_ids where key = 'source')), 1::bigint,
  'identical conflicts use one review item across command receipts');

select pg_temp.act_as('f1500000-0000-4000-8000-000000000101');
select lives_ok($$select public.resolve_fhir_integration_exception(
  (select id from fhir_conflict_ids where key = 'conflict'), 'acknowledged', 'Checking source evidence')$$,
  'the existing scoped review action can acknowledge a content conflict');
insert into fhir_conflict_records(key, record)
select 'acknowledged-conflict', to_jsonb(e) - 'last_seen_at' - 'updated_at'
from public.fhir_integration_exceptions e where id = (select id from fhir_conflict_ids where key = 'conflict');
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'service_role');
select is(pg_temp.import_fhir_conflict('dose-acknowledged', jsonb_build_array(
    (select record from fhir_conflict_records where key = 'dose')))->>'exceptions', '1',
  'acknowledged conflicts are still not reported as applied');
select is((select to_jsonb(e) - 'last_seen_at' - 'updated_at' from public.fhir_integration_exceptions e
    where id = (select id from fhir_conflict_ids where key = 'conflict')),
  (select record from fhir_conflict_records where key = 'acknowledged-conflict'),
  'a repeated conflict preserves acknowledgment, note and the original conflicting receipt');

select pg_temp.act_as('f1500000-0000-4000-8000-000000000101');
select lives_ok($$select public.resolve_fhir_integration_exception(
  (select id from fhir_conflict_ids where key = 'conflict'), 'resolved', 'Reconciled with source record')$$,
  'a manager can record human reconciliation without editing imported evidence');
insert into fhir_conflict_records(key, record)
select 'resolved-conflict', to_jsonb(e) - 'last_seen_at' - 'updated_at'
from public.fhir_integration_exceptions e where id = (select id from fhir_conflict_ids where key = 'conflict');
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'service_role');
select is(pg_temp.import_fhir_conflict('dose-resolved', jsonb_build_array(
    (select record from fhir_conflict_records where key = 'dose')))->>'exceptions', '1',
  'resolved conflicts are still not reported as evidence updates');
select is((select to_jsonb(e) - 'last_seen_at' - 'updated_at' from public.fhir_integration_exceptions e
    where id = (select id from fhir_conflict_ids where key = 'conflict')),
  (select record from fhir_conflict_records where key = 'resolved-conflict'),
  'identical polls preserve resolution status, actor, time, note and review provenance');

select is(pg_temp.import_fhir_conflict('status', jsonb_build_array(
    (select record from fhir_conflict_records where key = 'status')))->>'exceptions', '1',
  'a later entered-in-error status is detected without overwriting completed evidence');
select ok(exists(select 1 from public.fhir_integration_exceptions
  where command_receipt_id = (select command_id from fhir_conflict_records where key = 'receipt-status')
    and exception_type = 'administration_conflict' and status = 'open'),
  'distinct conflicting content creates a new open review after an earlier conflict was resolved');
select is(pg_temp.import_fhir_conflict('time', jsonb_build_array(
    (select record from fhir_conflict_records where key = 'time')))->>'exceptions', '1',
  'changed administration time is detected');
select is(pg_temp.import_fhir_conflict('metadata', jsonb_build_array(
    (select record from fhir_conflict_records where key = 'metadata')))->>'exceptions', '1',
  'metadata-only differences conservatively queue review without claiming a clinical correction');
select is((select count(*) from public.fhir_integration_exceptions
  where source_id = (select id from fhir_conflict_ids where key = 'source')
    and exception_type = 'administration_conflict'), 4::bigint,
  'each distinct conflicting content has exactly one durable review item');

select is(pg_temp.import_fhir_conflict('mixed', jsonb_build_array(
    (select record from fhir_conflict_records where key = 'dose'),
    (select jsonb_set(record || '{"fhirResourceId":"conflict-admin-2"}',
      '{raw,id}', '"conflict-admin-2"') from fhir_conflict_records where key = 'original'))),
  '{"requestsApplied":0,"administrationsApplied":1,"clinicalApplied":0,"exceptions":1}'::jsonb,
  'a conflicting resource does not prevent an unrelated administration in the same bundle');

-- A changed crosswalk must not reattribute the retained evidence, even with identical raw data.
reset role;
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('f1500000-0000-4000-8000-000000000302', 'f1500000-0000-4000-8000-000000000001',
  'f1500000-0000-4000-8000-000000000011', 'Second', 'Synthetic', current_date - 30, 'active');
select pg_temp.act_as('f1500000-0000-4000-8000-000000000101');
select lives_ok($$select public.map_fhir_patient(
  (select id from fhir_conflict_ids where key = 'source'), 'f1500000-0000-4000-8000-000000000302',
  'fhir-patient-1', '{"system":"urn:mrn","value":"MRN-2"}')$$,
  'the existing mapping action changes the patient crosswalk');
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'service_role');
select is(pg_temp.import_fhir_conflict('remapped', jsonb_build_array(
    (select record from fhir_conflict_records where key = 'original')))->>'exceptions', '1',
  'identical raw data mapped to another resident is a conflict, not an unchanged replay');
select is((select to_jsonb(a) from public.fhir_medication_administrations a
    where source_id = (select id from fhir_conflict_ids where key = 'source')
      and fhir_resource_id = 'conflict-admin-1'),
  (select record from fhir_conflict_records where key = 'saved-evidence'),
  'all original administration columns, hash, resident and import time remain exactly unchanged');

-- Scope and immutable evidence remain enforced by the existing boundaries.
select pg_temp.act_as('f1500000-0000-4000-8000-000000000201');
select is((select count(*) from public.fhir_integration_exceptions
  where source_id = (select id from fhir_conflict_ids where key = 'source')), 0::bigint,
  'another organization cannot read these conflict exceptions');
select throws_ok($$select public.resolve_fhir_integration_exception(
  (select id from fhir_conflict_ids where key = 'conflict'), 'resolved', 'Out of scope')$$,
  '42501', null, 'another organization cannot resolve the conflict');
reset role;
select set_config('app.privileged_write', 'on', true);
update public.profiles set role = 'facility_manager'
where id = 'f1500000-0000-4000-8000-000000000104';
select set_config('app.privileged_write', 'off', true);
select pg_temp.act_as('f1500000-0000-4000-8000-000000000104');
select is((select count(*) from public.fhir_integration_exceptions
  where source_id = (select id from fhir_conflict_ids where key = 'source')), 0::bigint,
  'an unassigned facility manager cannot read the conflict');
select throws_ok($$select public.resolve_fhir_integration_exception(
  (select id from fhir_conflict_ids where key = 'conflict'), 'dismissed', 'Unassigned')$$,
  '42501', null, 'an unassigned facility manager cannot dismiss the conflict');
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'anon');
select throws_ok($$select public.apply_fhir_integration_command(
  (select id from fhir_conflict_ids where key = 'source'))$$,
  '42501', null, 'anonymous callers still cannot invoke the applier');
reset role;
select throws_ok($$update public.fhir_medication_administrations set administration_status = 'entered-in-error'
  where source_id = (select id from fhir_conflict_ids where key = 'source')
    and fhir_resource_id = 'conflict-admin-1'$$,
  '55000', null, 'the append-only guard still refuses UPDATE even for the database owner');
select throws_ok($$delete from public.fhir_medication_administrations
  where source_id = (select id from fhir_conflict_ids where key = 'source')
    and fhir_resource_id = 'conflict-admin-1'$$,
  '55000', null, 'the append-only guard still refuses DELETE even for the database owner');
select ok(exists(select 1 from app_private.integration_command_receipts r
  where r.id = (select command_id from fhir_conflict_records where key = 'receipt-dose')
    and r.status = 'applied' and r.result->>'exceptions' = '1'
    and r.payload->'medicationAdministrations'->0 =
      (select record from fhir_conflict_records where key = 'dose')),
  'the incoming content remains durable in the receipt with the existing partial-apply status');
select * from finish();
rollback;
