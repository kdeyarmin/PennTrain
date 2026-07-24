-- FHIR R4 ingestion boundary -- Lane A, clinical resource pack.
--
-- Extends the FHIR medication boundary (20260725120000) with the remaining Phase-1 clinical
-- resources: AllergyIntolerance, Condition (problem list / diagnoses), ServiceRequest (non-med
-- orders), and DocumentReference (metadata). They ride the same fhir_integration_sources +
-- fhir_patient_mappings crosswalk, the same fhir.bundle.import command, and the same exception
-- queue -- apply_fhir_integration_command is extended to drain them. Read-only mirror; statuses
-- are stored as free text (FHIR value sets are large and vendor-variable -- ingest, don't reject).

create table public.fhir_allergy_intolerances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  resident_id uuid not null references public.residents(id) on delete restrict,
  fhir_resource_id text not null check (length(btrim(fhir_resource_id)) between 1 and 200),
  substance_display text not null check (length(btrim(substance_display)) between 1 and 300),
  substance_code text,
  substance_system text,
  clinical_status text,
  verification_status text,
  criticality text,
  category text[],
  reaction_manifestations jsonb,
  recorded_date timestamptz,
  source_updated_at timestamptz not null,
  imported_at timestamptz not null default now(),
  raw_resource jsonb not null,
  raw_record_sha256 text not null check (raw_record_sha256 ~ '^[0-9a-f]{64}$'),
  unique (source_id, fhir_resource_id),
  foreign key (source_id, organization_id, facility_id)
    references public.fhir_integration_sources(id, organization_id, facility_id) on delete cascade
);
create index fhir_allergy_intolerances_resident_idx
  on public.fhir_allergy_intolerances(resident_id, clinical_status);

create table public.fhir_conditions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  resident_id uuid not null references public.residents(id) on delete restrict,
  fhir_resource_id text not null check (length(btrim(fhir_resource_id)) between 1 and 200),
  code_display text not null check (length(btrim(code_display)) between 1 and 300),
  code text,
  code_system text,
  clinical_status text,
  verification_status text,
  category text,
  onset_date timestamptz,
  abatement_date timestamptz,
  recorded_date timestamptz,
  source_updated_at timestamptz not null,
  imported_at timestamptz not null default now(),
  raw_resource jsonb not null,
  raw_record_sha256 text not null check (raw_record_sha256 ~ '^[0-9a-f]{64}$'),
  unique (source_id, fhir_resource_id),
  foreign key (source_id, organization_id, facility_id)
    references public.fhir_integration_sources(id, organization_id, facility_id) on delete cascade
);
create index fhir_conditions_resident_idx
  on public.fhir_conditions(resident_id, clinical_status, source_updated_at desc);

create table public.fhir_service_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  resident_id uuid not null references public.residents(id) on delete restrict,
  fhir_resource_id text not null check (length(btrim(fhir_resource_id)) between 1 and 200),
  code_display text not null check (length(btrim(code_display)) between 1 and 300),
  code text,
  code_system text,
  request_status text,
  intent text,
  priority text,
  authored_on timestamptz,
  requester_display text,
  source_updated_at timestamptz not null,
  imported_at timestamptz not null default now(),
  raw_resource jsonb not null,
  raw_record_sha256 text not null check (raw_record_sha256 ~ '^[0-9a-f]{64}$'),
  unique (source_id, fhir_resource_id),
  foreign key (source_id, organization_id, facility_id)
    references public.fhir_integration_sources(id, organization_id, facility_id) on delete cascade
);
create index fhir_service_requests_resident_idx
  on public.fhir_service_requests(resident_id, request_status, source_updated_at desc);

create table public.fhir_document_references (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  resident_id uuid not null references public.residents(id) on delete restrict,
  fhir_resource_id text not null check (length(btrim(fhir_resource_id)) between 1 and 200),
  type_display text,
  doc_status text,
  doc_type_code text,
  content_url text,
  content_content_type text,
  context_start timestamptz,
  source_updated_at timestamptz not null,
  imported_at timestamptz not null default now(),
  raw_resource jsonb not null,
  raw_record_sha256 text not null check (raw_record_sha256 ~ '^[0-9a-f]{64}$'),
  unique (source_id, fhir_resource_id),
  foreign key (source_id, organization_id, facility_id)
    references public.fhir_integration_sources(id, organization_id, facility_id) on delete cascade
);
create index fhir_document_references_resident_idx
  on public.fhir_document_references(resident_id, source_updated_at desc);

-- Per-type upsert helpers (called by apply_fhir_integration_command inside a savepoint so a
-- single bad record becomes an exception rather than failing the whole sync).
create or replace function app_private.upsert_fhir_allergy(
  p_source public.fhir_integration_sources, p_resident_id uuid, p_record jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.fhir_allergy_intolerances(
    organization_id, facility_id, source_id, resident_id, fhir_resource_id,
    substance_display, substance_code, substance_system, clinical_status, verification_status,
    criticality, category, reaction_manifestations, recorded_date, source_updated_at,
    raw_resource, raw_record_sha256
  ) values (
    p_source.organization_id, p_source.facility_id, p_source.id, p_resident_id,
    p_record->>'fhirResourceId', p_record->>'substanceDisplay', nullif(p_record->>'substanceCode', ''),
    nullif(p_record->>'substanceSystem', ''), nullif(p_record->>'clinicalStatus', ''),
    nullif(p_record->>'verificationStatus', ''), nullif(p_record->>'criticality', ''),
    case when p_record ? 'category' then array(select jsonb_array_elements_text(p_record->'category')) else null end,
    p_record->'reactionManifestations', nullif(p_record->>'recordedDate', '')::timestamptz,
    (p_record->>'sourceUpdatedAt')::timestamptz, coalesce(p_record->'raw', '{}'::jsonb),
    encode(extensions.digest(convert_to(p_record::text, 'UTF8'), 'sha256'), 'hex')
  ) on conflict (source_id, fhir_resource_id) do update set
    resident_id = excluded.resident_id, substance_display = excluded.substance_display,
    substance_code = excluded.substance_code, substance_system = excluded.substance_system,
    clinical_status = excluded.clinical_status, verification_status = excluded.verification_status,
    criticality = excluded.criticality, category = excluded.category,
    reaction_manifestations = excluded.reaction_manifestations, recorded_date = excluded.recorded_date,
    source_updated_at = excluded.source_updated_at, imported_at = now(),
    raw_resource = excluded.raw_resource, raw_record_sha256 = excluded.raw_record_sha256
  where public.fhir_allergy_intolerances.source_updated_at <= excluded.source_updated_at;
end;
$$;

create or replace function app_private.upsert_fhir_condition(
  p_source public.fhir_integration_sources, p_resident_id uuid, p_record jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.fhir_conditions(
    organization_id, facility_id, source_id, resident_id, fhir_resource_id,
    code_display, code, code_system, clinical_status, verification_status, category,
    onset_date, abatement_date, recorded_date, source_updated_at, raw_resource, raw_record_sha256
  ) values (
    p_source.organization_id, p_source.facility_id, p_source.id, p_resident_id,
    p_record->>'fhirResourceId', p_record->>'codeDisplay', nullif(p_record->>'code', ''),
    nullif(p_record->>'codeSystem', ''), nullif(p_record->>'clinicalStatus', ''),
    nullif(p_record->>'verificationStatus', ''), nullif(p_record->>'category', ''),
    nullif(p_record->>'onsetDate', '')::timestamptz, nullif(p_record->>'abatementDate', '')::timestamptz,
    nullif(p_record->>'recordedDate', '')::timestamptz, (p_record->>'sourceUpdatedAt')::timestamptz,
    coalesce(p_record->'raw', '{}'::jsonb), encode(extensions.digest(convert_to(p_record::text, 'UTF8'), 'sha256'), 'hex')
  ) on conflict (source_id, fhir_resource_id) do update set
    resident_id = excluded.resident_id, code_display = excluded.code_display, code = excluded.code,
    code_system = excluded.code_system, clinical_status = excluded.clinical_status,
    verification_status = excluded.verification_status, category = excluded.category,
    onset_date = excluded.onset_date, abatement_date = excluded.abatement_date,
    recorded_date = excluded.recorded_date, source_updated_at = excluded.source_updated_at,
    imported_at = now(), raw_resource = excluded.raw_resource, raw_record_sha256 = excluded.raw_record_sha256
  where public.fhir_conditions.source_updated_at <= excluded.source_updated_at;
end;
$$;

create or replace function app_private.upsert_fhir_service_request(
  p_source public.fhir_integration_sources, p_resident_id uuid, p_record jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.fhir_service_requests(
    organization_id, facility_id, source_id, resident_id, fhir_resource_id,
    code_display, code, code_system, request_status, intent, priority, authored_on,
    requester_display, source_updated_at, raw_resource, raw_record_sha256
  ) values (
    p_source.organization_id, p_source.facility_id, p_source.id, p_resident_id,
    p_record->>'fhirResourceId', p_record->>'codeDisplay', nullif(p_record->>'code', ''),
    nullif(p_record->>'codeSystem', ''), nullif(p_record->>'status', ''), nullif(p_record->>'intent', ''),
    nullif(p_record->>'priority', ''), nullif(p_record->>'authoredOn', '')::timestamptz,
    nullif(p_record->>'requesterDisplay', ''), (p_record->>'sourceUpdatedAt')::timestamptz,
    coalesce(p_record->'raw', '{}'::jsonb), encode(extensions.digest(convert_to(p_record::text, 'UTF8'), 'sha256'), 'hex')
  ) on conflict (source_id, fhir_resource_id) do update set
    resident_id = excluded.resident_id, code_display = excluded.code_display, code = excluded.code,
    code_system = excluded.code_system, request_status = excluded.request_status, intent = excluded.intent,
    priority = excluded.priority, authored_on = excluded.authored_on, requester_display = excluded.requester_display,
    source_updated_at = excluded.source_updated_at, imported_at = now(),
    raw_resource = excluded.raw_resource, raw_record_sha256 = excluded.raw_record_sha256
  where public.fhir_service_requests.source_updated_at <= excluded.source_updated_at;
end;
$$;

create or replace function app_private.upsert_fhir_document_reference(
  p_source public.fhir_integration_sources, p_resident_id uuid, p_record jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.fhir_document_references(
    organization_id, facility_id, source_id, resident_id, fhir_resource_id,
    type_display, doc_status, doc_type_code, content_url, content_content_type, context_start,
    source_updated_at, raw_resource, raw_record_sha256
  ) values (
    p_source.organization_id, p_source.facility_id, p_source.id, p_resident_id,
    p_record->>'fhirResourceId', nullif(p_record->>'typeDisplay', ''), nullif(p_record->>'status', ''),
    nullif(p_record->>'typeCode', ''), nullif(p_record->>'contentUrl', ''),
    nullif(p_record->>'contentType', ''), nullif(p_record->>'contextStart', '')::timestamptz,
    (p_record->>'sourceUpdatedAt')::timestamptz, coalesce(p_record->'raw', '{}'::jsonb),
    encode(extensions.digest(convert_to(p_record::text, 'UTF8'), 'sha256'), 'hex')
  ) on conflict (source_id, fhir_resource_id) do update set
    resident_id = excluded.resident_id, type_display = excluded.type_display, doc_status = excluded.doc_status,
    doc_type_code = excluded.doc_type_code, content_url = excluded.content_url,
    content_content_type = excluded.content_content_type, context_start = excluded.context_start,
    source_updated_at = excluded.source_updated_at, imported_at = now(),
    raw_resource = excluded.raw_resource, raw_record_sha256 = excluded.raw_record_sha256
  where public.fhir_document_references.source_updated_at <= excluded.source_updated_at;
end;
$$;

revoke all on function app_private.upsert_fhir_allergy(public.fhir_integration_sources, uuid, jsonb),
  app_private.upsert_fhir_condition(public.fhir_integration_sources, uuid, jsonb),
  app_private.upsert_fhir_service_request(public.fhir_integration_sources, uuid, jsonb),
  app_private.upsert_fhir_document_reference(public.fhir_integration_sources, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Extend the drain to cover the new resource arrays. Medication loops are unchanged from
-- 20260725120000; the new clinical resources use a shared resolve-then-upsert loop via a helper.
create or replace function public.apply_fhir_integration_command(p_command_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_command app_private.integration_command_receipts%rowtype;
  v_source public.fhir_integration_sources%rowtype;
  v_record jsonb;
  v_resident_id uuid;
  v_requests integer := 0;
  v_administrations integer := 0;
  v_clinical integer := 0;
  v_exceptions integer := 0;
  v_key text;
  v_kinds text[] := array['allergies', 'conditions', 'serviceRequests', 'documentReferences'];
  v_kind text;
begin
  select * into v_command from app_private.integration_command_receipts where id = p_command_id for update;
  if v_command.id is null or v_command.command_type <> 'fhir.bundle.import' then
    raise exception 'Invalid FHIR integration command' using errcode = '22023';
  end if;
  if v_command.status = 'applied' then return coalesce(v_command.result, '{}'::jsonb); end if;
  if v_command.status not in ('accepted', 'processing') then
    raise exception 'FHIR command cannot be applied from status %', v_command.status using errcode = '55000';
  end if;
  select * into v_source from public.fhir_integration_sources
  where id = (v_command.payload->>'sourceId')::uuid
    and organization_id = v_command.organization_id and credential_id = v_command.credential_id;
  if v_source.id is null or v_source.status not in ('active', 'setup_required') then
    raise exception 'FHIR source is unavailable or not bound to this credential' using errcode = '42501';
  end if;
  update app_private.integration_command_receipts set status = 'processing', updated_at = now()
  where id = p_command_id;
  update public.fhir_integration_sources set last_sync_started_at = now(), status = 'active',
    last_error_code = null, last_error_message = null where id = v_source.id;

  for v_record in select value from jsonb_array_elements(coalesce(v_command.payload->'medicationRequests', '[]'::jsonb)) loop
    select m.resident_id into v_resident_id from public.fhir_patient_mappings m
    where m.source_id = v_source.id and m.fhir_patient_id = v_record->>'fhirPatientId' and m.status = 'active';
    if v_resident_id is null then
      v_key := 'patient:' || coalesce(nullif(v_record->>'fhirPatientId', ''), 'missing');
      insert into public.fhir_integration_exceptions(
        organization_id, facility_id, source_id, command_receipt_id, exception_key,
        exception_type, severity, summary, fhir_patient_id
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, p_command_id, v_key,
        'unmatched_patient', 'high', 'A FHIR MedicationRequest cannot be matched to a resident.',
        nullif(v_record->>'fhirPatientId', '')
      ) on conflict (source_id, exception_key) do update set
        command_receipt_id = excluded.command_receipt_id, last_seen_at = now(),
        status = 'open', resolved_at = null, resolved_by = null;
      v_exceptions := v_exceptions + 1;
      continue;
    end if;
    begin
      insert into public.fhir_medication_requests(
        organization_id, facility_id, source_id, resident_id, fhir_resource_id, rxnorm_code,
        medication_display, dosage_text, request_status, intent, authored_on, requester_display,
        source_updated_at, raw_resource, raw_record_sha256
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, v_resident_id,
        v_record->>'fhirResourceId', nullif(v_record->>'rxnormCode', ''),
        v_record->>'medicationDisplay', nullif(v_record->>'dosageText', ''),
        coalesce(nullif(v_record->>'status', ''), 'unknown'), nullif(v_record->>'intent', ''),
        nullif(v_record->>'authoredOn', '')::timestamptz, nullif(v_record->>'requesterDisplay', ''),
        (v_record->>'sourceUpdatedAt')::timestamptz, coalesce(v_record->'raw', '{}'::jsonb),
        encode(extensions.digest(convert_to(v_record::text, 'UTF8'), 'sha256'), 'hex')
      ) on conflict (source_id, fhir_resource_id) do update set
        resident_id = excluded.resident_id, rxnorm_code = excluded.rxnorm_code,
        medication_display = excluded.medication_display, dosage_text = excluded.dosage_text,
        request_status = excluded.request_status, intent = excluded.intent,
        authored_on = excluded.authored_on, requester_display = excluded.requester_display,
        source_updated_at = excluded.source_updated_at, imported_at = now(),
        raw_resource = excluded.raw_resource, raw_record_sha256 = excluded.raw_record_sha256
      where public.fhir_medication_requests.source_updated_at <= excluded.source_updated_at;
      v_requests := v_requests + 1;
    exception when others then
      v_key := 'request:' || coalesce(nullif(v_record->>'fhirResourceId', ''), encode(extensions.digest(convert_to(v_record::text, 'UTF8'), 'sha256'), 'hex'));
      insert into public.fhir_integration_exceptions(
        organization_id, facility_id, source_id, command_receipt_id, exception_key,
        exception_type, severity, summary, fhir_patient_id
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, p_command_id, left(v_key, 240),
        'invalid_resource', 'high', 'A FHIR MedicationRequest failed contract validation.',
        nullif(v_record->>'fhirPatientId', '')
      ) on conflict (source_id, exception_key) do update set last_seen_at = now(), status = 'open';
      v_exceptions := v_exceptions + 1;
    end;
  end loop;

  for v_record in select value from jsonb_array_elements(coalesce(v_command.payload->'medicationAdministrations', '[]'::jsonb)) loop
    select m.resident_id into v_resident_id from public.fhir_patient_mappings m
    where m.source_id = v_source.id and m.fhir_patient_id = v_record->>'fhirPatientId' and m.status = 'active';
    if v_resident_id is null then
      v_key := 'patient:' || coalesce(nullif(v_record->>'fhirPatientId', ''), 'missing');
      insert into public.fhir_integration_exceptions(
        organization_id, facility_id, source_id, command_receipt_id, exception_key,
        exception_type, severity, summary, fhir_patient_id
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, p_command_id, v_key,
        'unmatched_patient', 'high', 'A FHIR MedicationAdministration cannot be matched to a resident.',
        nullif(v_record->>'fhirPatientId', '')
      ) on conflict (source_id, exception_key) do update set last_seen_at = now(), status = 'open';
      v_exceptions := v_exceptions + 1;
      continue;
    end if;
    begin
      insert into public.fhir_medication_administrations(
        organization_id, facility_id, source_id, resident_id, fhir_resource_id, fhir_request_id,
        administration_status, medication_display, effective_at, performer_display,
        raw_resource, raw_record_sha256
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, v_resident_id,
        v_record->>'fhirResourceId', nullif(v_record->>'fhirRequestId', ''),
        coalesce(nullif(v_record->>'status', ''), 'unknown'), nullif(v_record->>'medicationDisplay', ''),
        (v_record->>'effectiveAt')::timestamptz, nullif(v_record->>'performerDisplay', ''),
        coalesce(v_record->'raw', '{}'::jsonb),
        encode(extensions.digest(convert_to(v_record::text, 'UTF8'), 'sha256'), 'hex')
      ) on conflict (source_id, fhir_resource_id) do nothing;
      v_administrations := v_administrations + 1;
    exception when others then
      v_key := 'administration:' || coalesce(nullif(v_record->>'fhirResourceId', ''), encode(extensions.digest(convert_to(v_record::text, 'UTF8'), 'sha256'), 'hex'));
      insert into public.fhir_integration_exceptions(
        organization_id, facility_id, source_id, command_receipt_id, exception_key,
        exception_type, severity, summary, fhir_patient_id
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, p_command_id, left(v_key, 240),
        'invalid_resource', 'urgent', 'A FHIR MedicationAdministration failed contract validation.',
        nullif(v_record->>'fhirPatientId', '')
      ) on conflict (source_id, exception_key) do update set last_seen_at = now(), status = 'open';
      v_exceptions := v_exceptions + 1;
    end;
  end loop;

  -- Clinical resource pack: allergies, conditions, service requests, document references.
  foreach v_kind in array v_kinds loop
    for v_record in select value from jsonb_array_elements(coalesce(v_command.payload->v_kind, '[]'::jsonb)) loop
      select m.resident_id into v_resident_id from public.fhir_patient_mappings m
      where m.source_id = v_source.id and m.fhir_patient_id = v_record->>'fhirPatientId' and m.status = 'active';
      if v_resident_id is null then
        v_key := v_kind || ':patient:' || coalesce(nullif(v_record->>'fhirPatientId', ''), 'missing');
        insert into public.fhir_integration_exceptions(
          organization_id, facility_id, source_id, command_receipt_id, exception_key,
          exception_type, severity, summary, fhir_patient_id
        ) values (
          v_source.organization_id, v_source.facility_id, v_source.id, p_command_id, left(v_key, 240),
          'unmatched_patient', 'high', 'A FHIR ' || v_kind || ' record cannot be matched to a resident.',
          nullif(v_record->>'fhirPatientId', '')
        ) on conflict (source_id, exception_key) do update set
          command_receipt_id = excluded.command_receipt_id, last_seen_at = now(),
          status = 'open', resolved_at = null, resolved_by = null;
        v_exceptions := v_exceptions + 1;
        continue;
      end if;
      begin
        case v_kind
          when 'allergies' then perform app_private.upsert_fhir_allergy(v_source, v_resident_id, v_record);
          when 'conditions' then perform app_private.upsert_fhir_condition(v_source, v_resident_id, v_record);
          when 'serviceRequests' then perform app_private.upsert_fhir_service_request(v_source, v_resident_id, v_record);
          when 'documentReferences' then perform app_private.upsert_fhir_document_reference(v_source, v_resident_id, v_record);
        end case;
        v_clinical := v_clinical + 1;
      exception when others then
        v_key := v_kind || ':' || coalesce(nullif(v_record->>'fhirResourceId', ''), encode(extensions.digest(convert_to(v_record::text, 'UTF8'), 'sha256'), 'hex'));
        insert into public.fhir_integration_exceptions(
          organization_id, facility_id, source_id, command_receipt_id, exception_key,
          exception_type, severity, summary, fhir_patient_id
        ) values (
          v_source.organization_id, v_source.facility_id, v_source.id, p_command_id, left(v_key, 240),
          'invalid_resource', 'high', 'A FHIR ' || v_kind || ' record failed contract validation.',
          nullif(v_record->>'fhirPatientId', '')
        ) on conflict (source_id, exception_key) do update set last_seen_at = now(), status = 'open';
        v_exceptions := v_exceptions + 1;
      end;
    end loop;
  end loop;

  update public.fhir_integration_sources set
    last_sync_completed_at = now(), last_sync_receipt_id = p_command_id, status = 'active'
  where id = v_source.id;
  update app_private.integration_command_receipts set
    status = 'applied',
    result = jsonb_build_object('requestsApplied', v_requests, 'administrationsApplied', v_administrations,
      'clinicalApplied', v_clinical, 'exceptions', v_exceptions),
    updated_at = now()
  where id = p_command_id;
  return jsonb_build_object('requestsApplied', v_requests, 'administrationsApplied', v_administrations,
    'clinicalApplied', v_clinical, 'exceptions', v_exceptions);
exception when others then
  if v_source.id is not null then
    update public.fhir_integration_sources set status = 'error',
      last_error_code = sqlstate, last_error_message = left(sqlerrm, 500) where id = v_source.id;
    insert into public.fhir_integration_exceptions(
      organization_id, facility_id, source_id, command_receipt_id, exception_key,
      exception_type, severity, summary
    ) values (
      v_source.organization_id, v_source.facility_id, v_source.id, p_command_id,
      'sync:' || p_command_id::text, 'sync_failure', 'urgent',
      'FHIR synchronization failed contract validation and was not applied.'
    ) on conflict (source_id, exception_key) do update set
      last_seen_at = now(), status = 'open', resolved_at = null, resolved_by = null;
  end if;
  if v_command.id is not null then
    update app_private.integration_command_receipts set status = 'rejected',
      result = jsonb_build_object('errorCode', sqlstate, 'message', left(sqlerrm, 500)), updated_at = now()
    where id = v_command.id;
  end if;
  return jsonb_build_object('errorCode', sqlstate, 'message', left(sqlerrm, 500));
end;
$$;
revoke all on function public.apply_fhir_integration_command(uuid) from public, anon, authenticated, service_role;
grant execute on function public.apply_fhir_integration_command(uuid) to service_role;

-- Commercial module gating for the new tables.
insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
values
  ('public', 'fhir_allergy_intolerances', 'modules.carebase'),
  ('public', 'fhir_conditions', 'modules.carebase'),
  ('public', 'fhir_service_requests', 'modules.carebase'),
  ('public', 'fhir_document_references', 'modules.carebase')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

do $$
declare v_resource record;
begin
  for v_resource in
    select resource_schema, resource_name from app_private.product_module_resources
    where resource_name in ('fhir_allergy_intolerances', 'fhir_conditions', 'fhir_service_requests', 'fhir_document_references')
  loop
    execute format('drop policy if exists product_module_entitlement on %I.%I', v_resource.resource_schema, v_resource.resource_name);
    execute format(
      'create policy product_module_entitlement on %I.%I as restrictive for all to authenticated using ((select app_private.has_product_module(%L))) with check ((select app_private.has_product_module(%L)))',
      v_resource.resource_schema, v_resource.resource_name, 'modules.carebase', 'modules.carebase'
    );
  end loop;
end
$$;

alter table public.fhir_allergy_intolerances enable row level security;
alter table public.fhir_conditions enable row level security;
alter table public.fhir_service_requests enable row level security;
alter table public.fhir_document_references enable row level security;

create policy fhir_allergies_read on public.fhir_allergy_intolerances
for select to authenticated using (app_private.clinical_record_visible(organization_id, facility_id));
create policy fhir_conditions_read on public.fhir_conditions
for select to authenticated using (app_private.clinical_record_visible(organization_id, facility_id));
create policy fhir_service_requests_read on public.fhir_service_requests
for select to authenticated using (app_private.clinical_record_visible(organization_id, facility_id));
create policy fhir_document_references_read on public.fhir_document_references
for select to authenticated using (app_private.clinical_record_visible(organization_id, facility_id));

do $$
declare t text;
begin
  foreach t in array array[
    'fhir_allergy_intolerances', 'fhir_conditions', 'fhir_service_requests', 'fhir_document_references'
  ] loop
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$$;
