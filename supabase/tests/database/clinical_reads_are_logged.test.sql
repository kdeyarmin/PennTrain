-- pgTAP coverage for 20260905260000: a chart read that left no trace (I15 residual).
--
-- app_private.clinical_access_log had two writers, and neither sat behind a surface staff use. The
-- care documentation tab, the FHIR half of the clinical chart and the resident timeline read the
-- clinical tables straight through PostgREST, so the three busiest doors into a resident's record
-- produced no log row at all. Separately, all three definer functions checked scope but not the
-- CareBase module entitlement, which every clinical table's RLS also requires -- so a lapsed
-- organization could read through the RPC what the same read through PostgREST would refuse.
-- Run with: supabase test db.

begin;
select plan(24);

------------------------------------------------------------------------------------------------
-- Fixture: two organizations, identical in every way except the CareBase entitlement
------------------------------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('ca000000-0000-4000-8000-000000000001', 'Logged Chart Org', 'logged-chart-org', 'active'),
  ('ca000000-0000-4000-8000-000000000002', 'Lapsed Module Org', 'lapsed-module-org', 'active');

insert into public.facilities(id, organization_id, name, facility_type) values
  ('ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000001',
   'Logged Chart Facility', 'PCH'),
  ('ca000000-0000-4000-8000-000000000012', 'ca000000-0000-4000-8000-000000000002',
   'Lapsed Module Facility', 'PCH');

insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date, status
) values
  ('ca000000-0000-4000-8000-000000000201', 'ca000000-0000-4000-8000-000000000001',
   'ca000000-0000-4000-8000-000000000011', 'Charted', 'Resident', public.pa_today() - 30, 'active'),
  ('ca000000-0000-4000-8000-000000000202', 'ca000000-0000-4000-8000-000000000001',
   'ca000000-0000-4000-8000-000000000011', 'Second', 'Resident', public.pa_today() - 30, 'active'),
  ('ca000000-0000-4000-8000-000000000203', 'ca000000-0000-4000-8000-000000000002',
   'ca000000-0000-4000-8000-000000000012', 'Lapsed', 'Resident', public.pa_today() - 30, 'active');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'ca000000-0000-4000-8000-000000000101',
   'authenticated', 'authenticated', 'logged-chart-admin@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'ca000000-0000-4000-8000-000000000102',
   'authenticated', 'authenticated', 'lapsed-module-admin@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('ca000000-0000-4000-8000-000000000101', 'ca000000-0000-4000-8000-000000000001',
   'logged-chart-admin@test.local', 'L', 'Admin', 'org_admin', true),
  ('ca000000-0000-4000-8000-000000000102', 'ca000000-0000-4000-8000-000000000002',
   'lapsed-module-admin@test.local', 'M', 'Admin', 'org_admin', true)
on conflict (id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

-- Only the first organization is entitled to CareBase. A fresh organization with no billing
-- account resolves to 'trial' and picks up the feature default, so switching the module off takes
-- an explicit deny -- which is exactly the shape a lapsed customer has.
insert into public.organization_entitlement_grants(
  organization_id, feature_key, decision, entitlement_value, reason
) values
  ('ca000000-0000-4000-8000-000000000001', 'modules.carebase', 'grant', 'true'::jsonb,
   'pgTAP fixture for the logged clinical readers'),
  ('ca000000-0000-4000-8000-000000000002', 'modules.carebase', 'deny', null,
   'pgTAP fixture: CareBase not entitled');

-- Clinical content for the entitled resident, one row in each domain the new readers return.
insert into public.clinical_care_plans(
  id, organization_id, facility_id, resident_id, title, category, status
) values (
  'ca000000-0000-4000-8000-000000000301', 'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000201',
  'Falls prevention', 'safety', 'active'
);
insert into public.clinical_care_plan_goals(
  id, organization_id, facility_id, care_plan_id, description, status
) values (
  'ca000000-0000-4000-8000-000000000311', 'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000301',
  'Ambulate with walker at all times', 'active'
);
insert into public.clinical_assessments(
  id, organization_id, facility_id, resident_id, assessment_type, assessed_at, score, status
) values (
  'ca000000-0000-4000-8000-000000000321', 'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000201',
  'morse_fall', now() - interval '2 days', 45, 'final'
);
insert into public.clinical_progress_notes(
  id, organization_id, facility_id, resident_id, note_type, body, authored_at, status, signed_at
) values (
  'ca000000-0000-4000-8000-000000000331', 'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000201',
  'nursing', 'Ambulated to dining room with minimal assistance.', now() - interval '1 day',
  'signed', now() - interval '1 day'
);

insert into public.fhir_integration_sources(
  id, organization_id, facility_id, name, vendor_name, external_facility_id, status
) values (
  'ca000000-0000-4000-8000-000000000401', 'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000011', 'Main EHR', 'Epic', 'EXT-1', 'active'
);
insert into public.fhir_medication_requests(
  id, organization_id, facility_id, source_id, resident_id, fhir_resource_id, rxnorm_code,
  medication_display, dosage_text, request_status, source_updated_at, raw_resource, raw_record_sha256
) values
  ('ca000000-0000-4000-8000-000000000411', 'ca000000-0000-4000-8000-000000000001',
   'ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000401',
   'ca000000-0000-4000-8000-000000000201', 'MedReq-1', '197361', 'Amlodipine 5 MG tablet',
   'One tablet by mouth daily', 'active', now() - interval '3 hours',
   '{"resourceType":"MedicationRequest","note":"SECRET-RAW-PAYLOAD"}'::jsonb, repeat('a', 64)),
  ('ca000000-0000-4000-8000-000000000412', 'ca000000-0000-4000-8000-000000000001',
   'ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000401',
   'ca000000-0000-4000-8000-000000000202', 'MedReq-2', '310965', 'Ibuprofen 200 MG tablet',
   'As needed', 'completed', now() - interval '9 hours',
   '{"resourceType":"MedicationRequest"}'::jsonb, repeat('b', 64));
insert into public.fhir_medication_administrations(
  id, organization_id, facility_id, source_id, resident_id, fhir_resource_id, fhir_request_id,
  administration_status, medication_display, effective_at, raw_resource, raw_record_sha256
) values (
  'ca000000-0000-4000-8000-000000000421', 'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000401',
  'ca000000-0000-4000-8000-000000000201', 'MedAdm-1', 'MedReq-1', 'completed',
  'Amlodipine 5 MG tablet', now() - interval '2 hours',
  '{"resourceType":"MedicationAdministration"}'::jsonb, repeat('c', 64)
);
insert into public.fhir_allergy_intolerances(
  id, organization_id, facility_id, source_id, resident_id, fhir_resource_id, substance_display,
  clinical_status, source_updated_at, raw_resource, raw_record_sha256
) values (
  'ca000000-0000-4000-8000-000000000431', 'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000401',
  'ca000000-0000-4000-8000-000000000201', 'Allergy-1', 'Penicillin', 'active',
  now() - interval '6 days', '{"resourceType":"AllergyIntolerance"}'::jsonb, repeat('d', 64)
);
insert into public.fhir_conditions(
  id, organization_id, facility_id, source_id, resident_id, fhir_resource_id, code, code_display,
  clinical_status, source_updated_at, raw_resource, raw_record_sha256
) values (
  'ca000000-0000-4000-8000-000000000441', 'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000401',
  'ca000000-0000-4000-8000-000000000201', 'Condition-1', 'I10', 'Essential hypertension',
  'active', now() - interval '5 days', '{"resourceType":"Condition"}'::jsonb, repeat('e', 64)
);
insert into public.fhir_service_requests(
  id, organization_id, facility_id, source_id, resident_id, fhir_resource_id, code_display,
  request_status, source_updated_at, raw_resource, raw_record_sha256
) values (
  'ca000000-0000-4000-8000-000000000451', 'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000401',
  'ca000000-0000-4000-8000-000000000201', 'ServiceReq-1', 'Physical therapy evaluation',
  'active', now() - interval '4 days', '{"resourceType":"ServiceRequest"}'::jsonb, repeat('f', 64)
);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role, 'aal', 'aal2',
      'iat', extract(epoch from now())::bigint)::text, true);
  if p_role = 'service_role' then set local role service_role; else set local role authenticated; end if;
end $$;

-- authenticated has no USAGE on app_private, and the assertions below run as the reader so that
-- the log rows are attributed to them. Definer rights here read the log without leaving the role.
create or replace function pg_temp.logged(p_resident uuid, p_domain text)
returns integer language sql security definer as $$
  select count(*)::integer from app_private.clinical_access_log l
  where l.resident_id = p_resident and l.clinical_domain = p_domain;
$$;

create or replace function pg_temp.log_actors(p_resident uuid)
returns integer language sql security definer as $$
  select count(distinct l.actor_profile_id)::integer from app_private.clinical_access_log l
  where l.resident_id = p_resident;
$$;

------------------------------------------------------------------------------------------------
-- The predicate, and the three definers that used to check only half of it
------------------------------------------------------------------------------------------------
select has_function(
  'public', 'can_read_clinical_record', array['uuid', 'uuid'],
  'one predicate now answers "may this caller read this clinical record"'
);
select ok(
  (select bool_and(p.prosrc like '%can_read_clinical_record%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('log_clinical_access', 'get_resident_clinical_chart',
                       'get_resident_clinical_observations', 'get_resident_clinical_care',
                       'get_resident_clinical_fhir', 'get_resident_timeline')),
  'and every clinical reader asks it, rather than testing scope and forgetting the module'
);

select pg_temp.act_as('ca000000-0000-4000-8000-000000000101');
select ok(
  public.can_read_clinical_record(
    'ca000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000011'),
  'an in-scope admin of an entitled organization may read'
);

select pg_temp.act_as('ca000000-0000-4000-8000-000000000102');
select ok(
  not public.can_read_clinical_record(
    'ca000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000012'),
  'an in-scope admin of an organization without CareBase may not -- which is what the RLS says too'
);
select throws_ok(
  $$ select public.get_resident_clinical_chart('ca000000-0000-4000-8000-000000000203') $$,
  '42501',
  'Clinical access is outside caller scope',
  'and the chart RPC refuses that read instead of serving what PostgREST would have withheld'
);

------------------------------------------------------------------------------------------------
-- Care documentation: the tab now leaves a record, one row per domain it discloses
------------------------------------------------------------------------------------------------
select pg_temp.act_as('ca000000-0000-4000-8000-000000000101');

select is(
  pg_temp.logged('ca000000-0000-4000-8000-000000000201', 'care_plans'), 0,
  'nothing is logged before the read'
);

select is(
  jsonb_array_length(
    public.get_resident_clinical_care('ca000000-0000-4000-8000-000000000201')->'carePlans'), 1,
  'the care reader returns the resident''s care plans'
);
select is(
  (public.get_resident_clinical_care('ca000000-0000-4000-8000-000000000201')
    ->'goals'->0->>'description'),
  'Ambulate with walker at all times',
  'and the goals hanging off them, which the hook used to assemble with a second round trip'
);
select is(
  (public.get_resident_clinical_care('ca000000-0000-4000-8000-000000000201')
    ->'notes'->0->>'body'),
  'Ambulated to dining room with minimal assistance.',
  'and the progress notes'
);

-- Three calls above, three domains each.
select is(
  pg_temp.logged('ca000000-0000-4000-8000-000000000201', 'care_plans'), 3,
  'every call writes a care_plans access row'
);
select is(
  pg_temp.logged('ca000000-0000-4000-8000-000000000201', 'assessments'), 3,
  'and an assessments row'
);
select is(
  pg_temp.logged('ca000000-0000-4000-8000-000000000201', 'progress_notes'), 3,
  'and a progress_notes row -- a query for who read the notes finds this read'
);
select is(
  pg_temp.log_actors('ca000000-0000-4000-8000-000000000201'), 1,
  'attributed to the reader, not to the definer''s owner'
);

------------------------------------------------------------------------------------------------
-- The FHIR half of the chart: logged, and without the raw inbound payload
------------------------------------------------------------------------------------------------
select is(
  (public.get_resident_clinical_fhir('ca000000-0000-4000-8000-000000000201')
    ->'medications'->0->>'medication_display'),
  'Amlodipine 5 MG tablet',
  'the FHIR reader returns what the chart renders'
);
select ok(
  not (public.get_resident_clinical_fhir('ca000000-0000-4000-8000-000000000201')::text
        like '%SECRET-RAW-PAYLOAD%'),
  'without raw_resource, which select("*") was shipping to the browser for every row'
);
select is(
  pg_temp.logged('ca000000-0000-4000-8000-000000000201', 'medications'), 2,
  'and each call writes one row per FHIR domain disclosed'
);
select is(
  pg_temp.logged('ca000000-0000-4000-8000-000000000201', 'orders'), 2,
  'orders included -- the service requests are part of the same disclosure'
);

------------------------------------------------------------------------------------------------
-- The timeline: five clinical branches, one honest word for the digest it shows
------------------------------------------------------------------------------------------------
select ok(
  exists(select 1 from public.get_resident_timeline('ca000000-0000-4000-8000-000000000201')
         where event_type = 'progress_note'),
  'the timeline still composes its clinical branches'
);
select is(
  pg_temp.logged('ca000000-0000-4000-8000-000000000201', 'timeline'), 1,
  'and now says so in the access log'
);

-- A resident the caller cannot see must not produce a log row -- the timeline keeps invoker rights,
-- so the union returns nothing and there is nothing to record.
select is(
  (select count(*)::integer from public.get_resident_timeline('ca000000-0000-4000-8000-000000000203')),
  0,
  'a timeline for an out-of-scope resident is empty'
);
select is(
  pg_temp.logged('ca000000-0000-4000-8000-000000000203', 'timeline'), 0,
  'and logs nothing, rather than raising or recording an access that did not happen'
);

------------------------------------------------------------------------------------------------
-- The integration console stops being a facility-wide medication list
------------------------------------------------------------------------------------------------
select is(
  (public.get_facility_fhir_ingestion_activity('ca000000-0000-4000-8000-000000000011')
    ->>'requestActiveTotal')::integer,
  1,
  'the console reader counts what the operator needs: active requests in the facility'
);
select is(
  jsonb_array_length(
    public.get_facility_fhir_ingestion_activity('ca000000-0000-4000-8000-000000000011')->'residents'),
  2,
  'broken down by resident, so an unmatched or silent patient is visible'
);
select ok(
  (public.get_facility_fhir_ingestion_activity('ca000000-0000-4000-8000-000000000011')::text
    not like '%Amlodipine%')
  and (public.get_facility_fhir_ingestion_activity('ca000000-0000-4000-8000-000000000011')::text
    not like '%197361%'),
  'carrying no drug name and no RxNorm code -- reading those is a chart read, and belongs on the chart'
);

select * from finish();
rollback;
