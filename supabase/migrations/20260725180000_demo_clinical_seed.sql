-- Demo clinical (EHR) seed.
--
-- Populates the resident clinical chart for the public demo playground so the EHR surfaces built
-- in M0-M5 render with realistic (synthetic) data: native vitals + a care plan, assessment, and
-- signed progress note (Lane B), plus a connected FHIR source with a mapped patient and sample
-- ingested medications, allergy, and problem-list conditions (Lane A). All data is synthetic and
-- clearly attributed to "CareBase Demo". Idempotent: re-running never duplicates rows, so it is
-- safe to invoke from the daily demo-restore cron and on-demand restore.

create or replace function app_private.seed_demo_clinical_data(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org public.organizations%rowtype;
  v_facility public.facilities%rowtype;
  v_resident_id uuid;
  v_actor_id uuid;
  v_source_id uuid;
  v_plan_id uuid;
begin
  -- Only ever touch demo tenants.
  select * into v_org from public.organizations where id = p_organization_id and is_demo;
  if v_org.id is null then
    return;
  end if;

  -- Anchor facility (same selection the operational seed uses) and the anchor resident.
  select * into v_facility
  from public.facilities
  where organization_id = v_org.id and is_active
  order by case facility_type when 'PCH' then 0 when 'ALR' then 1 else 2 end, created_at, id
  limit 1;
  if v_facility.id is null then
    return;
  end if;

  select id into v_resident_id from public.residents
  where organization_id = v_org.id and first_name = 'Evelyn' and last_name = 'Brooks'
  order by created_at limit 1;
  if v_resident_id is null then
    return;
  end if;

  -- A manager/admin profile to attribute authored records to (nullable columns tolerate none).
  select p.id into v_actor_id from public.profiles p
  where p.organization_id = v_org.id and p.role in ('facility_manager', 'org_admin')
  order by case p.role when 'facility_manager' then 0 else 1 end, p.created_at
  limit 1;

  -- Clinical capability is on by default; make the demo tenant's posture explicit.
  update public.residents
  set clinical_data_consent = 'granted', updated_at = now()
  where id = v_resident_id and clinical_data_consent = 'not_recorded';
  update public.facilities
  set clinical_enabled = true, updated_at = now()
  where id = v_facility.id and clinical_enabled is distinct from true;

  -- ---------------------------------------------------------------------------------------------
  -- Lane B (native): vitals, care plan + goal, assessment, signed progress note.
  -- ---------------------------------------------------------------------------------------------

  -- Vitals trend (shows a blood-pressure improvement + normal supporting vitals).
  insert into public.clinical_observations (
    organization_id, facility_id, resident_id, observation_type, loinc_code,
    value_numeric, value_secondary, value_text, unit, observed_at,
    recorded_by_profile_id, recorded_by_name, abnormal_flag, source, note
  )
  select v_org.id, v_facility.id, v_resident_id, s.otype, s.loinc,
    s.vnum, s.vsec, null, s.unit, now() - s.ago,
    v_actor_id, 'CareBase Demo', s.flag, 'native', s.note
  from (values
    ('blood_pressure', '85354-9', 148::numeric, 90::numeric, 'mm[Hg]', interval '3 days', 'high',    'Recheck after rest; resident asymptomatic'),
    ('blood_pressure', '85354-9', 138::numeric, 84::numeric, 'mm[Hg]', interval '2 days', 'high',    null),
    ('blood_pressure', '85354-9', 126::numeric, 78::numeric, 'mm[Hg]', interval '6 hours', 'normal', 'Improved on morning meds'),
    ('heart_rate',     '8867-4',  74::numeric,  null,        '/min',   interval '6 hours', 'normal', null),
    ('spo2',           '59408-5', 97::numeric,  null,        '%',      interval '6 hours', 'normal', null),
    ('weight',         '29463-7', 69.4::numeric, null,       'kg',     interval '1 day',  'normal', null),
    ('pain_score',     '72514-3', 2::numeric,   null,        '{score}', interval '6 hours', 'normal', 'Mild left-knee discomfort with activity')
  ) as s(otype, loinc, vnum, vsec, unit, ago, flag, note)
  where not exists (
    select 1 from public.clinical_observations o
    where o.resident_id = v_resident_id and o.recorded_by_name = 'CareBase Demo'
  );

  -- Care plan + goal.
  insert into public.clinical_care_plans (
    organization_id, facility_id, resident_id, title, category, status,
    period_start, authored_by_profile_id
  )
  select v_org.id, v_facility.id, v_resident_id, 'Fall risk reduction', 'safety', 'active',
    current_date - 30, v_actor_id
  where not exists (
    select 1 from public.clinical_care_plans c
    where c.resident_id = v_resident_id and c.title = 'Fall risk reduction'
  )
  returning id into v_plan_id;
  if v_plan_id is null then
    select id into v_plan_id from public.clinical_care_plans
    where resident_id = v_resident_id and title = 'Fall risk reduction'
    order by created_at limit 1;
  end if;

  insert into public.clinical_care_plan_goals (
    organization_id, facility_id, care_plan_id, description, target_measure, status
  )
  select v_org.id, v_facility.id, v_plan_id,
    'Remain free of falls with injury through the next 90 days',
    'Zero falls with injury; walker used for all ambulation', 'active'
  where v_plan_id is not null and not exists (
    select 1 from public.clinical_care_plan_goals g where g.care_plan_id = v_plan_id
  );

  -- Assessment (finalized Morse fall-risk score).
  insert into public.clinical_assessments (
    organization_id, facility_id, resident_id, assessment_type, instrument_loinc,
    score, risk_band, responses, assessed_at, assessed_by_profile_id, assessed_by_name,
    status, finalized_at
  )
  select v_org.id, v_facility.id, v_resident_id, 'morse_fall', '59461-8',
    45, 'moderate',
    jsonb_build_object(
      'historyOfFalling', 25, 'secondaryDiagnosis', 15, 'ambulatoryAid', 0,
      'ivHeplock', 0, 'gait', 10, 'mentalStatus', 0),
    now() - interval '2 days', v_actor_id, 'CareBase Demo', 'final', now() - interval '2 days'
  where not exists (
    select 1 from public.clinical_assessments a
    where a.resident_id = v_resident_id and a.assessed_by_name = 'CareBase Demo'
  );

  -- Signed nursing progress note.
  insert into public.clinical_progress_notes (
    organization_id, facility_id, resident_id, note_type, authored_at,
    author_profile_id, author_name, body, status, signed_at, signed_by_profile_id, care_plan_id
  )
  select v_org.id, v_facility.id, v_resident_id, 'nursing', now() - interval '1 day',
    v_actor_id, 'CareBase Demo',
    'Resident alert and oriented. Ambulating with rolling walker and standby assist. Blood '
    || 'pressure trending down on current regimen; no orthostatic symptoms reported. Continues '
    || 'on fall-risk precautions per care plan. Tolerating heart-healthy diet well.',
    'signed', now() - interval '1 day', v_actor_id, v_plan_id
  where not exists (
    select 1 from public.clinical_progress_notes n
    where n.resident_id = v_resident_id and n.author_name = 'CareBase Demo'
  );

  -- ---------------------------------------------------------------------------------------------
  -- Lane A (FHIR ingestion boundary): source, patient mapping, sample medications/allergy/problems.
  -- ---------------------------------------------------------------------------------------------

  insert into public.fhir_integration_sources (
    organization_id, facility_id, name, vendor_name, fhir_base_url, external_facility_id,
    supported_resources, status, last_sync_completed_at, created_by
  ) values (
    v_org.id, v_facility.id, 'Demo EHR Connection', 'Demo FHIR Sandbox',
    'https://fhir.demo.invalid/r4', 'demo-facility-1',
    array['MedicationRequest', 'MedicationAdministration', 'AllergyIntolerance', 'Condition']::text[],
    'active', now() - interval '20 minutes', v_actor_id
  )
  on conflict (organization_id, vendor_name, external_facility_id) do nothing;

  select id into v_source_id from public.fhir_integration_sources
  where organization_id = v_org.id and vendor_name = 'Demo FHIR Sandbox'
    and external_facility_id = 'demo-facility-1';
  if v_source_id is null then
    return;
  end if;

  insert into public.fhir_patient_mappings (
    organization_id, facility_id, source_id, resident_id, fhir_patient_id,
    fhir_patient_identifier, mapped_by
  ) values (
    v_org.id, v_facility.id, v_source_id, v_resident_id, 'demo-patient-evelyn',
    jsonb_build_object('system', 'urn:oid:2.16.840.1.113883.4.1', 'value', 'MRN-100101'), v_actor_id
  )
  on conflict (source_id, resident_id) do nothing;

  -- Active medication orders.
  insert into public.fhir_medication_requests (
    organization_id, facility_id, source_id, resident_id, fhir_resource_id, rxnorm_code,
    medication_display, dosage_text, request_status, intent, authored_on, requester_display,
    source_updated_at, raw_resource, raw_record_sha256
  )
  select v_org.id, v_facility.id, v_source_id, v_resident_id, m.rid, m.rxnorm, m.disp, m.dose,
    'active', 'order', now() - interval '30 days', 'Dr. Elena Park', now() - interval '20 minutes',
    m.raw, encode(extensions.digest(convert_to(m.raw::text, 'UTF8'), 'sha256'), 'hex')
  from (values
    ('demo-medreq-lisinopril', '314076', 'Lisinopril 10 MG Oral Tablet', '10 mg by mouth once daily',
      jsonb_build_object('resourceType', 'MedicationRequest', 'id', 'demo-medreq-lisinopril',
        'status', 'active', 'intent', 'order',
        'medicationCodeableConcept', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://www.nlm.nih.gov/research/umls/rxnorm', 'code', '314076',
          'display', 'Lisinopril 10 MG Oral Tablet'))),
        'subject', jsonb_build_object('reference', 'Patient/demo-patient-evelyn'))),
    ('demo-medreq-atorvastatin', '617311', 'Atorvastatin 20 MG Oral Tablet', '20 mg by mouth at bedtime',
      jsonb_build_object('resourceType', 'MedicationRequest', 'id', 'demo-medreq-atorvastatin',
        'status', 'active', 'intent', 'order',
        'medicationCodeableConcept', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://www.nlm.nih.gov/research/umls/rxnorm', 'code', '617311',
          'display', 'Atorvastatin 20 MG Oral Tablet'))),
        'subject', jsonb_build_object('reference', 'Patient/demo-patient-evelyn')))
  ) as m(rid, rxnorm, disp, dose, raw)
  on conflict (source_id, fhir_resource_id) do nothing;

  -- One recent administration event.
  insert into public.fhir_medication_administrations (
    organization_id, facility_id, source_id, resident_id, fhir_resource_id, fhir_request_id,
    administration_status, medication_display, effective_at, performer_display,
    raw_resource, raw_record_sha256
  )
  select v_org.id, v_facility.id, v_source_id, v_resident_id, a.rid, a.req,
    'completed', a.disp, now() - interval '5 hours', 'Nurse J. Rivera, LPN',
    a.raw, encode(extensions.digest(convert_to(a.raw::text, 'UTF8'), 'sha256'), 'hex')
  from (values
    ('demo-medadmin-lisinopril', 'demo-medreq-lisinopril', 'Lisinopril 10 MG Oral Tablet',
      jsonb_build_object('resourceType', 'MedicationAdministration', 'id', 'demo-medadmin-lisinopril',
        'status', 'completed',
        'subject', jsonb_build_object('reference', 'Patient/demo-patient-evelyn')))
  ) as a(rid, req, disp, raw)
  on conflict (source_id, fhir_resource_id) do nothing;

  -- Allergy (medication class -- distinct from the administrative food-allergy field).
  insert into public.fhir_allergy_intolerances (
    organization_id, facility_id, source_id, resident_id, fhir_resource_id, substance_display,
    substance_code, substance_system, clinical_status, verification_status, criticality,
    category, reaction_manifestations, recorded_date, source_updated_at, raw_resource, raw_record_sha256
  )
  select v_org.id, v_facility.id, v_source_id, v_resident_id, x.rid, x.disp, x.code,
    'http://www.nlm.nih.gov/research/umls/rxnorm', 'active', 'confirmed', 'high',
    array['medication']::text[],
    jsonb_build_array(jsonb_build_object('manifestation', 'Hives', 'severity', 'moderate')),
    now() - interval '200 days', now() - interval '20 minutes',
    x.raw, encode(extensions.digest(convert_to(x.raw::text, 'UTF8'), 'sha256'), 'hex')
  from (values
    ('demo-allergy-penicillin', 'Penicillin G', '7980',
      jsonb_build_object('resourceType', 'AllergyIntolerance', 'id', 'demo-allergy-penicillin',
        'clinicalStatus', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', 'code', 'active'))),
        'criticality', 'high',
        'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://www.nlm.nih.gov/research/umls/rxnorm', 'code', '7980', 'display', 'Penicillin G'))),
        'patient', jsonb_build_object('reference', 'Patient/demo-patient-evelyn')))
  ) as x(rid, disp, code, raw)
  on conflict (source_id, fhir_resource_id) do nothing;

  -- Problem list (active confirmed conditions).
  insert into public.fhir_conditions (
    organization_id, facility_id, source_id, resident_id, fhir_resource_id, code_display, code,
    code_system, clinical_status, verification_status, category, onset_date, recorded_date,
    source_updated_at, raw_resource, raw_record_sha256
  )
  select v_org.id, v_facility.id, v_source_id, v_resident_id, c.rid, c.disp, c.code,
    'http://hl7.org/fhir/sid/icd-10-cm', 'active', 'confirmed', 'problem-list-item',
    now() - c.onset_ago, now() - interval '200 days', now() - interval '20 minutes',
    c.raw, encode(extensions.digest(convert_to(c.raw::text, 'UTF8'), 'sha256'), 'hex')
  from (values
    ('demo-condition-htn', 'Essential (primary) hypertension', 'I10', interval '900 days',
      jsonb_build_object('resourceType', 'Condition', 'id', 'demo-condition-htn',
        'clinicalStatus', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://terminology.hl7.org/CodeSystem/condition-clinical', 'code', 'active'))),
        'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://hl7.org/fhir/sid/icd-10-cm', 'code', 'I10',
          'display', 'Essential (primary) hypertension'))),
        'subject', jsonb_build_object('reference', 'Patient/demo-patient-evelyn'))),
    ('demo-condition-hlp', 'Hyperlipidemia, unspecified', 'E78.5', interval '700 days',
      jsonb_build_object('resourceType', 'Condition', 'id', 'demo-condition-hlp',
        'clinicalStatus', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://terminology.hl7.org/CodeSystem/condition-clinical', 'code', 'active'))),
        'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
          'system', 'http://hl7.org/fhir/sid/icd-10-cm', 'code', 'E78.5',
          'display', 'Hyperlipidemia, unspecified'))),
        'subject', jsonb_build_object('reference', 'Patient/demo-patient-evelyn')))
  ) as c(rid, disp, code, onset_ago, raw)
  on conflict (source_id, fhir_resource_id) do nothing;
end;
$function$;

revoke all on function app_private.seed_demo_clinical_data(uuid) from public, anon, authenticated;
grant execute on function app_private.seed_demo_clinical_data(uuid) to service_role;

-- Fold the clinical seed into both re-seed orchestrators so provisioned demo tenants and the
-- daily restore cron pick it up (definitions mirror 20260717163659; only the clinical call is new).
create or replace function public.restore_demo_baseline()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid := public.current_org_id();
  v_result jsonb;
begin
  if auth.uid() is null or public.current_role() <> 'org_admin' or not exists (
    select 1 from public.organizations o where o.id = v_org_id and o.is_demo
  ) then
    raise exception 'Only a demo organization administrator may restore demo data'
      using errcode = '42501';
  end if;
  v_result := app_private.seed_demo_organization(v_org_id);
  perform app_private.seed_demo_clinical_data(v_org_id);
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_org_id, auth.uid(), 'demo_organization', v_org_id::text, 'baseline_restored', v_result
  );
  return v_result;
end;
$function$;

create or replace function app_private.restore_all_demo_baselines()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org record;
  v_count integer := 0;
begin
  if current_user not in ('postgres', 'supabase_admin')
     and coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Demo restore requires a trusted worker' using errcode = '42501';
  end if;
  for v_org in select id from public.organizations where is_demo loop
    perform app_private.seed_demo_organization(v_org.id);
    perform app_private.seed_demo_clinical_data(v_org.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.restore_demo_baseline() from public, anon, service_role;
revoke all on function app_private.restore_all_demo_baselines() from public, anon, authenticated, service_role;
grant execute on function public.restore_demo_baseline() to authenticated;
grant execute on function app_private.restore_all_demo_baselines() to service_role;

-- Seed the existing hosted demo tenant on deploy.
do $block$
declare v_org_id uuid;
begin
  select id into v_org_id from public.organizations
  where slug = 'sunrise-healthcare' and is_demo;
  if v_org_id is not null then
    perform app_private.seed_demo_clinical_data(v_org_id);
  end if;
end;
$block$;
