begin;
select plan(24);

-- Structure + hardened access -----------------------------------------------------------
select has_table('public', 'fhir_integration_sources', 'FHIR source config table exists');
select has_table('public', 'fhir_patient_mappings', 'FHIR patient crosswalk exists');
select has_table('public', 'fhir_medication_requests', 'FHIR MedicationRequest boundary exists');
select has_table('public', 'fhir_medication_administrations', 'FHIR MedicationAdministration boundary exists');
select ok(
  not has_table_privilege('authenticated', 'public.fhir_medication_administrations', 'UPDATE'),
  'browser roles cannot mutate external administration evidence'
);
select ok(
  not has_function_privilege('anon', 'public.apply_fhir_integration_command(uuid)', 'EXECUTE'),
  'anonymous callers cannot apply FHIR imports'
);

-- Fixtures ------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('f1000000-0000-4000-8000-000000000001', 'FHIR Org A', 'fhir-org-a', 'active'),
  ('f1000000-0000-4000-8000-000000000002', 'FHIR Org B', 'fhir-org-b', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('f1000000-0000-4000-8000-000000000011', 'f1000000-0000-4000-8000-000000000001', 'FHIR Facility A1', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'fa-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'fa-auditor@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'fb-admin@test.local', 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('f1000000-0000-4000-8000-000000000101', 'f1000000-0000-4000-8000-000000000001', 'fa-admin@test.local', 'Fiona', 'Admin', 'org_admin', true),
  ('f1000000-0000-4000-8000-000000000104', 'f1000000-0000-4000-8000-000000000001', 'fa-auditor@test.local', 'Ida', 'Auditor', 'auditor', true),
  ('f1000000-0000-4000-8000-000000000201', 'f1000000-0000-4000-8000-000000000002', 'fb-admin@test.local', 'Ben', 'Admin', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.residents(id, organization_id, facility_id, first_name, last_name, admission_date, status)
values ('f1000000-0000-4000-8000-000000000301', 'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000011', 'Ravi', 'Resident', current_date - 30, 'active');
insert into public.integration_api_credentials(
  id, organization_id, name, key_prefix, scopes, status, expires_at, rate_limit_per_minute, created_by
) values (
  'f1000000-0000-4000-8000-000000000401', 'f1000000-0000-4000-8000-000000000001',
  'FHIR Test Credential', 'fa11c0de0401', array['commands:write'], 'active', now() + interval '30 days', 120,
  'f1000000-0000-4000-8000-000000000101'
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
create temporary table fhir_ids(key text primary key, id uuid) on commit drop;
grant all on fhir_ids to authenticated, anon, service_role;

-- Manager configures a source and maps a FHIR patient ----------------------------------
select pg_temp.act_as('f1000000-0000-4000-8000-000000000101');
select lives_ok($$
  insert into fhir_ids(key, id) values ('source', public.save_fhir_integration_source(
    'f1000000-0000-4000-8000-000000000011', 'Epic Sandbox', 'Epic', 'ext-fac-1',
    'https://fhir.example.org/r4', 'f1000000-0000-4000-8000-000000000401', 60, 'active'))
$$, 'manager configures a FHIR source bound to a commands:write credential');
select lives_ok($$select public.map_fhir_patient(
  (select id from fhir_ids where key = 'source'), 'f1000000-0000-4000-8000-000000000301', 'fhir-patient-1',
  jsonb_build_object('system', 'urn:mrn', 'value', 'MRN-1'))
$$, 'manager maps a FHIR Patient id to a resident');

-- A mapped bundle applies cleanly ------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'service_role');
select lives_ok($$
  insert into fhir_ids(key, id)
  select 'command', command_id from public.accept_integration_command(
    'f1000000-0000-4000-8000-000000000401', 'fhirsync-0001', repeat('a', 64),
    'fhir.bundle.import', '2026-07-25',
    jsonb_build_object(
      'sourceId', (select id from fhir_ids where key = 'source'),
      'medicationRequests', jsonb_build_array(jsonb_build_object(
        'fhirPatientId', 'fhir-patient-1', 'fhirResourceId', 'medreq-1',
        'medicationDisplay', 'Atorvastatin 20 mg tablet', 'rxnormCode', '617311',
        'dosageText', '1 tablet nightly', 'status', 'active', 'sourceUpdatedAt', now(),
        'raw', jsonb_build_object('resourceType', 'MedicationRequest'))),
      'medicationAdministrations', jsonb_build_array(jsonb_build_object(
        'fhirPatientId', 'fhir-patient-1', 'fhirResourceId', 'medadmin-1', 'fhirRequestId', 'medreq-1',
        'status', 'completed', 'effectiveAt', now(), 'performerDisplay', 'External nurse',
        'raw', jsonb_build_object('resourceType', 'MedicationAdministration'))),
      'allergies', jsonb_build_array(jsonb_build_object(
        'fhirPatientId', 'fhir-patient-1', 'fhirResourceId', 'allergy-1',
        'substanceDisplay', 'Penicillin', 'substanceCode', '7980', 'substanceSystem', 'rxnorm',
        'clinicalStatus', 'active', 'criticality', 'high', 'sourceUpdatedAt', now(),
        'raw', jsonb_build_object('resourceType', 'AllergyIntolerance'))),
      'conditions', jsonb_build_array(jsonb_build_object(
        'fhirPatientId', 'fhir-patient-1', 'fhirResourceId', 'cond-1',
        'codeDisplay', 'Type 2 diabetes mellitus', 'code', 'E11.9', 'codeSystem', 'icd10cm',
        'clinicalStatus', 'active', 'category', 'problem-list-item', 'sourceUpdatedAt', now(),
        'raw', jsonb_build_object('resourceType', 'Condition'))),
      'serviceRequests', jsonb_build_array(jsonb_build_object(
        'fhirPatientId', 'fhir-patient-1', 'fhirResourceId', 'svc-1',
        'codeDisplay', 'Physical therapy evaluation', 'status', 'active', 'intent', 'order', 'sourceUpdatedAt', now())),
      'documentReferences', jsonb_build_array(jsonb_build_object(
        'fhirPatientId', 'fhir-patient-1', 'fhirResourceId', 'doc-1',
        'typeDisplay', 'History and physical', 'status', 'current', 'sourceUpdatedAt', now()))),
    'fhir-ingest-test')
$$, 'FHIR bundle enters the existing idempotent command inbox');
select is(
  (public.apply_fhir_integration_command((select id from fhir_ids where key = 'command'))->>'exceptions')::integer,
  0, 'a mapped FHIR bundle applies without exceptions');
select is((select count(*)::integer from public.fhir_medication_requests where fhir_resource_id = 'medreq-1'),
  1, 'the FHIR MedicationRequest is imported once');
select is((select count(*)::integer from public.fhir_medication_administrations where fhir_resource_id = 'medadmin-1'),
  1, 'the FHIR MedicationAdministration is imported once');
select is((select rxnorm_code from public.fhir_medication_requests where fhir_resource_id = 'medreq-1'),
  '617311', 'the RxNorm code is extracted for query');
select is((select count(*)::integer from public.fhir_allergy_intolerances where fhir_resource_id = 'allergy-1'),
  1, 'the FHIR AllergyIntolerance is imported');
select is((select clinical_status from public.fhir_allergy_intolerances where fhir_resource_id = 'allergy-1'),
  'active', 'allergy clinical status is extracted');
select is((select count(*)::integer from public.fhir_conditions where fhir_resource_id = 'cond-1'),
  1, 'the FHIR Condition (problem list) is imported');
select is((select count(*)::integer from public.fhir_service_requests where fhir_resource_id = 'svc-1'),
  1, 'the FHIR ServiceRequest is imported');
select is((select count(*)::integer from public.fhir_document_references where fhir_resource_id = 'doc-1'),
  1, 'the FHIR DocumentReference is imported');

-- An unmapped patient produces a triage exception, not a guess -------------------------
select lives_ok($$
  insert into fhir_ids(key, id)
  select 'command2', command_id from public.accept_integration_command(
    'f1000000-0000-4000-8000-000000000401', 'fhirsync-0002', repeat('b', 64),
    'fhir.bundle.import', '2026-07-25',
    jsonb_build_object(
      'sourceId', (select id from fhir_ids where key = 'source'),
      'medicationRequests', jsonb_build_array(jsonb_build_object(
        'fhirPatientId', 'fhir-patient-UNKNOWN', 'fhirResourceId', 'medreq-2',
        'medicationDisplay', 'Unmatched medication', 'status', 'active', 'sourceUpdatedAt', now())),
      'medicationAdministrations', '[]'::jsonb),
    'fhir-ingest-test-2')
$$, 'a second bundle for an unmapped patient is accepted');
select is(
  (public.apply_fhir_integration_command((select id from fhir_ids where key = 'command2'))->>'exceptions')::integer,
  1, 'an unmatched FHIR patient yields exactly one exception');
select ok(
  exists(select 1 from public.fhir_integration_exceptions
    where exception_type = 'unmatched_patient' and fhir_patient_id = 'fhir-patient-UNKNOWN' and status = 'open'),
  'the unmatched patient is queued for human resolution');

-- Clinical read visibility --------------------------------------------------------------
select pg_temp.act_as('f1000000-0000-4000-8000-000000000104');
select is((select count(*)::integer from public.fhir_medication_requests where fhir_resource_id = 'medreq-1'),
  1, 'an auditor in the organization can read imported FHIR medications');
select pg_temp.act_as('f1000000-0000-4000-8000-000000000201');
select is((select count(*)::integer from public.fhir_medication_requests where fhir_resource_id = 'medreq-1'),
  0, 'an admin from another organization cannot read these FHIR medications');

-- Append-only evidence ------------------------------------------------------------------
reset role;
select throws_ok(
  $$delete from public.fhir_medication_administrations where fhir_resource_id = 'medadmin-1'$$,
  '55000', null, 'external FHIR administration evidence cannot be deleted');

select * from finish();
rollback;
