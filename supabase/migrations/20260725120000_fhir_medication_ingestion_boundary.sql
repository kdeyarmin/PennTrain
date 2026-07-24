-- FHIR R4 ingestion boundary -- Lane A, first resource pair (medications).
--
-- Extends the read-only integration pattern (medication boundary + Phase 2 signed hub) to
-- ingest FHIR R4 MedicationRequest / MedicationAdministration resources from an external
-- EHR/pharmacy. The fhir-ingest edge function maps a FHIR Bundle into normalized records and
-- submits them through the existing versioned command inbox (accept_integration_command, no
-- change needed -- fhir.bundle.import rides commands:write at the base envelope version); this
-- migration owns the boundary tables, the FHIR Patient<->resident crosswalk, the idempotent
-- apply processor, the exception queue, and a freshness watchdog. CareBase never becomes the
-- clinical source of truth; write-back is out of scope.
--
-- Dedicated fhir_medication_* tables (not the eMAR external_medication_* tables) keep the two
-- lanes independent -- the external_medication_* source_id is composite-FK-bound to
-- medication_integration_sources, and the resident clinical chart unions both lanes read-side.

-- Documented command contract (payload is normalized by the edge function's FHIR mapper).
insert into public.integration_schema_definitions(schema_kind, schema_name, schema_version, json_schema)
values (
  'command', 'fhir.bundle.import', '2026-07-25',
  '{"type":"object","required":["sourceId","medicationRequests","medicationAdministrations"]}'::jsonb
) on conflict (schema_kind, schema_name, schema_version) do nothing;

-- Reuse the clinical permission family for the integration admin surface.
insert into public.permission_definitions(permission_key, description, risk_level)
values
  ('clinical.integration.read', 'Read external clinical (FHIR) synchronization health and normalized records', 'sensitive'),
  ('clinical.integration.manage', 'Configure external clinical (FHIR) sources, patient mappings, and exceptions', 'privileged')
on conflict (permission_key) do nothing;

insert into public.role_template_permissions(role_template_id, permission_key)
select rt.id, permission_key
from public.role_templates rt
cross join lateral (
  select unnest(case rt.built_in_role
    when 'platform_admin' then array['clinical.integration.read', 'clinical.integration.manage']::text[]
    when 'org_admin' then array['clinical.integration.read', 'clinical.integration.manage']::text[]
    when 'facility_manager' then array['clinical.integration.read', 'clinical.integration.manage']::text[]
    when 'auditor' then array['clinical.integration.read']::text[]
    else array[]::text[]
  end) permission_key
) granted
where rt.built_in_role in ('platform_admin', 'org_admin', 'facility_manager', 'auditor')
on conflict (role_template_id, permission_key) do nothing;

create table public.fhir_integration_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  credential_id uuid references public.integration_api_credentials(id) on delete restrict,
  name text not null check (length(btrim(name)) between 2 and 120),
  vendor_name text not null check (length(btrim(vendor_name)) between 2 and 120),
  fhir_base_url text check (fhir_base_url is null or fhir_base_url ~ '^https://'),
  external_facility_id text not null check (length(btrim(external_facility_id)) between 1 and 200),
  supported_resources text[] not null default array[
    'MedicationRequest', 'MedicationAdministration'
  ]::text[],
  status text not null default 'setup_required'
    check (status in ('setup_required', 'active', 'paused', 'error', 'disabled')),
  freshness_threshold_minutes integer not null default 60
    check (freshness_threshold_minutes between 5 and 1440),
  last_sync_started_at timestamptz,
  last_sync_completed_at timestamptz,
  last_sync_receipt_id uuid,
  last_error_code text,
  last_error_message text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, vendor_name, external_facility_id),
  unique (id, organization_id, facility_id)
);
create index fhir_integration_sources_health_idx
  on public.fhir_integration_sources(facility_id, status, last_sync_completed_at);

create table public.fhir_patient_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  resident_id uuid not null references public.residents(id) on delete restrict,
  fhir_patient_id text not null check (length(btrim(fhir_patient_id)) between 1 and 200),
  fhir_patient_identifier jsonb,
  status text not null default 'active' check (status in ('active', 'inactive')),
  mapped_by uuid references public.profiles(id) on delete set null,
  mapped_at timestamptz not null default now(),
  unique (source_id, fhir_patient_id),
  unique (source_id, resident_id),
  foreign key (source_id, organization_id, facility_id)
    references public.fhir_integration_sources(id, organization_id, facility_id) on delete cascade
);
create index fhir_patient_mappings_resident_idx
  on public.fhir_patient_mappings(resident_id, status);

create table public.fhir_medication_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  resident_id uuid not null references public.residents(id) on delete restrict,
  fhir_resource_id text not null check (length(btrim(fhir_resource_id)) between 1 and 200),
  rxnorm_code text,
  medication_display text not null check (length(btrim(medication_display)) between 1 and 300),
  dosage_text text,
  request_status text not null check (request_status in (
    'active', 'on-hold', 'cancelled', 'completed', 'stopped', 'draft', 'unknown'
  )),
  intent text,
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
create index fhir_medication_requests_resident_idx
  on public.fhir_medication_requests(resident_id, request_status, source_updated_at desc);

create table public.fhir_medication_administrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  resident_id uuid not null references public.residents(id) on delete restrict,
  fhir_resource_id text not null check (length(btrim(fhir_resource_id)) between 1 and 200),
  fhir_request_id text,
  administration_status text not null check (administration_status in (
    'in-progress', 'not-done', 'on-hold', 'completed', 'entered-in-error', 'stopped', 'unknown'
  )),
  medication_display text,
  effective_at timestamptz not null,
  performer_display text,
  imported_at timestamptz not null default now(),
  raw_resource jsonb not null,
  raw_record_sha256 text not null check (raw_record_sha256 ~ '^[0-9a-f]{64}$'),
  unique (source_id, fhir_resource_id),
  foreign key (source_id, organization_id, facility_id)
    references public.fhir_integration_sources(id, organization_id, facility_id) on delete cascade
);
create index fhir_medication_administrations_resident_idx
  on public.fhir_medication_administrations(resident_id, effective_at desc);

create table public.fhir_integration_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  command_receipt_id uuid,
  exception_key text not null check (length(btrim(exception_key)) between 1 and 240),
  exception_type text not null check (exception_type in (
    'unmatched_patient', 'invalid_resource', 'unsupported_code_system', 'stale_source', 'sync_failure'
  )),
  severity text not null default 'high' check (severity in ('info', 'medium', 'high', 'urgent')),
  summary text not null check (length(btrim(summary)) between 3 and 500),
  fhir_patient_id text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, exception_key),
  foreign key (source_id, organization_id, facility_id)
    references public.fhir_integration_sources(id, organization_id, facility_id) on delete cascade,
  check ((status in ('resolved', 'dismissed')) = (resolved_at is not null))
);
create index fhir_integration_exceptions_queue_idx
  on public.fhir_integration_exceptions(facility_id, status, severity, last_seen_at desc);

-- External administration evidence is append-only (reuses the M0 clinical guard).
create trigger prevent_fhir_medication_administration_mutation
  before update or delete on public.fhir_medication_administrations
  for each row execute function app_private.prevent_clinical_evidence_mutation();

create trigger set_updated_at before update on public.fhir_integration_sources
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.fhir_integration_exceptions
  for each row execute function public.set_updated_at();

create or replace function app_private.assert_clinical_integration_scope(
  p_organization_id uuid, p_facility_id uuid, p_permission_key text
) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() and (
    public.current_org_id() is distinct from p_organization_id
    or not public.is_assigned_to_facility(p_facility_id)
    or not (
      public.current_role() = 'org_admin'
      or public.has_effective_permission(p_permission_key, 'facility', p_facility_id, now())
      or public.has_effective_permission(p_permission_key, 'organization', p_organization_id, now())
    )
  ) then
    raise exception 'Clinical integration access denied' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.assert_clinical_integration_scope(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.save_fhir_integration_source(
  p_facility_id uuid,
  p_name text,
  p_vendor_name text,
  p_external_facility_id text,
  p_fhir_base_url text default null,
  p_credential_id uuid default null,
  p_freshness_threshold_minutes integer default 60,
  p_status text default 'setup_required',
  p_source_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_credential_org uuid;
begin
  select f.organization_id into v_org from public.facilities f where f.id = p_facility_id;
  if v_org is null then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_clinical_integration_scope(v_org, p_facility_id, 'clinical.integration.manage');
  if p_status not in ('setup_required', 'active', 'paused', 'disabled') then
    raise exception 'Invalid source status' using errcode = '22023';
  end if;
  if p_credential_id is not null then
    select c.organization_id into v_credential_org from public.integration_api_credentials c
    where c.id = p_credential_id and 'commands:write' = any(c.scopes);
    if v_credential_org is distinct from v_org then
      raise exception 'Credential is not authorized for this organization and command scope' using errcode = '42501';
    end if;
  end if;
  if p_source_id is null then
    insert into public.fhir_integration_sources(
      organization_id, facility_id, credential_id, name, vendor_name, fhir_base_url,
      external_facility_id, freshness_threshold_minutes, status, created_by
    ) values (
      v_org, p_facility_id, p_credential_id, btrim(p_name), btrim(p_vendor_name),
      nullif(btrim(p_fhir_base_url), ''), btrim(p_external_facility_id),
      p_freshness_threshold_minutes, p_status, auth.uid()
    ) returning id into v_id;
  else
    update public.fhir_integration_sources s set
      credential_id = p_credential_id, name = btrim(p_name), vendor_name = btrim(p_vendor_name),
      fhir_base_url = nullif(btrim(p_fhir_base_url), ''), external_facility_id = btrim(p_external_facility_id),
      freshness_threshold_minutes = p_freshness_threshold_minutes, status = p_status
    where s.id = p_source_id and s.organization_id = v_org and s.facility_id = p_facility_id
    returning s.id into v_id;
    if v_id is null then raise exception 'FHIR source not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.map_fhir_patient(
  p_source_id uuid, p_resident_id uuid, p_fhir_patient_id text, p_identifier jsonb default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_source public.fhir_integration_sources%rowtype; v_resident public.residents%rowtype; v_id uuid;
begin
  select * into v_source from public.fhir_integration_sources where id = p_source_id;
  select * into v_resident from public.residents where id = p_resident_id;
  if v_source.id is null or v_resident.id is null
     or v_resident.organization_id <> v_source.organization_id
     or v_resident.facility_id <> v_source.facility_id then
    raise exception 'Source and resident scope do not match' using errcode = '23503';
  end if;
  perform app_private.assert_clinical_integration_scope(v_source.organization_id, v_source.facility_id, 'clinical.integration.manage');
  insert into public.fhir_patient_mappings(
    organization_id, facility_id, source_id, resident_id, fhir_patient_id, fhir_patient_identifier, mapped_by
  ) values (
    v_source.organization_id, v_source.facility_id, p_source_id, p_resident_id,
    btrim(p_fhir_patient_id), p_identifier, auth.uid()
  ) on conflict (source_id, fhir_patient_id) do update set
    resident_id = excluded.resident_id, fhir_patient_identifier = excluded.fhir_patient_identifier,
    status = 'active', mapped_by = auth.uid(), mapped_at = now()
  returning id into v_id;
  update public.fhir_integration_exceptions set
    status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
    resolution_note = 'Patient mapping completed'
  where source_id = p_source_id and fhir_patient_id = btrim(p_fhir_patient_id)
    and exception_type = 'unmatched_patient' and status not in ('resolved', 'dismissed');
  return v_id;
end;
$$;

create or replace function public.resolve_fhir_integration_exception(
  p_exception_id uuid, p_resolution_status text, p_resolution_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_exception public.fhir_integration_exceptions%rowtype;
begin
  select * into v_exception from public.fhir_integration_exceptions where id = p_exception_id;
  if v_exception.id is null then raise exception 'FHIR integration exception not found' using errcode = 'P0002'; end if;
  perform app_private.assert_clinical_integration_scope(
    v_exception.organization_id, v_exception.facility_id, 'clinical.integration.manage'
  );
  if p_resolution_status not in ('acknowledged', 'resolved', 'dismissed') then
    raise exception 'Invalid resolution status' using errcode = '22023';
  end if;
  update public.fhir_integration_exceptions set
    status = p_resolution_status,
    resolved_at = case when p_resolution_status in ('resolved', 'dismissed') then now() else null end,
    resolved_by = case when p_resolution_status in ('resolved', 'dismissed') then auth.uid() else null end,
    resolution_note = nullif(btrim(p_resolution_note), '')
  where id = p_exception_id;
end;
$$;

-- Idempotent apply: drain one accepted fhir.bundle.import receipt into the boundary tables.
create or replace function public.apply_fhir_integration_command(p_command_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_command app_private.integration_command_receipts%rowtype;
  v_source public.fhir_integration_sources%rowtype;
  v_record jsonb;
  v_resident_id uuid;
  v_requests integer := 0;
  v_administrations integer := 0;
  v_exceptions integer := 0;
  v_key text;
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

  update public.fhir_integration_sources set
    last_sync_completed_at = now(), last_sync_receipt_id = p_command_id, status = 'active'
  where id = v_source.id;
  update app_private.integration_command_receipts set
    status = 'applied',
    result = jsonb_build_object('requestsApplied', v_requests, 'administrationsApplied', v_administrations, 'exceptions', v_exceptions),
    updated_at = now()
  where id = p_command_id;
  return jsonb_build_object('requestsApplied', v_requests, 'administrationsApplied', v_administrations, 'exceptions', v_exceptions);
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

create or replace function public.run_fhir_integration_freshness_evaluator(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare v_source public.fhir_integration_sources%rowtype; v_count integer := 0;
begin
  for v_source in select * from public.fhir_integration_sources where status in ('active', 'error') loop
    if v_source.last_sync_completed_at is null
       or v_source.last_sync_completed_at < p_now - make_interval(mins => v_source.freshness_threshold_minutes) then
      insert into public.fhir_integration_exceptions(
        organization_id, facility_id, source_id, exception_key, exception_type, severity, summary
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, 'stale:source',
        'stale_source', 'urgent', 'External clinical (FHIR) synchronization is outside its configured freshness target.'
      ) on conflict (source_id, exception_key) do update set
        last_seen_at = p_now, status = 'open', resolved_at = null, resolved_by = null;
      v_count := v_count + 1;
    else
      update public.fhir_integration_exceptions set
        status = 'resolved', resolved_at = p_now, resolved_by = null,
        resolution_note = 'Automatically resolved after a fresh synchronization.'
      where source_id = v_source.id and exception_key = 'stale:source'
        and status not in ('resolved', 'dismissed');
    end if;
  end loop;
  return v_count;
end;
$$;

do $$ begin
  if exists(select 1 from cron.job where jobname = 'fhir-integration-freshness') then
    perform cron.unschedule('fhir-integration-freshness');
  end if;
end $$;
select cron.schedule(
  'fhir-integration-freshness', '*/15 * * * *',
  'select public.run_fhir_integration_freshness_evaluator();'
);

-- Commercial module gating for the new tables (CareBase).
insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
values
  ('public', 'fhir_integration_sources', 'modules.carebase'),
  ('public', 'fhir_patient_mappings', 'modules.carebase'),
  ('public', 'fhir_medication_requests', 'modules.carebase'),
  ('public', 'fhir_medication_administrations', 'modules.carebase'),
  ('public', 'fhir_integration_exceptions', 'modules.carebase')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

do $$
declare v_resource record;
begin
  for v_resource in
    select resource_schema, resource_name from app_private.product_module_resources
    where resource_name in (
      'fhir_integration_sources', 'fhir_patient_mappings', 'fhir_medication_requests',
      'fhir_medication_administrations', 'fhir_integration_exceptions'
    )
  loop
    execute format('drop policy if exists product_module_entitlement on %I.%I',
      v_resource.resource_schema, v_resource.resource_name);
    execute format(
      'create policy product_module_entitlement on %I.%I as restrictive for all to authenticated using ((select app_private.has_product_module(%L))) with check ((select app_private.has_product_module(%L)))',
      v_resource.resource_schema, v_resource.resource_name, 'modules.carebase', 'modules.carebase'
    );
  end loop;
end
$$;

alter table public.fhir_integration_sources enable row level security;
alter table public.fhir_patient_mappings enable row level security;
alter table public.fhir_medication_requests enable row level security;
alter table public.fhir_medication_administrations enable row level security;
alter table public.fhir_integration_exceptions enable row level security;

create policy fhir_sources_read on public.fhir_integration_sources
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and (public.current_role() in ('org_admin', 'auditor')
      or public.has_effective_permission('clinical.integration.read', 'facility', facility_id, now())
      or public.has_effective_permission('clinical.integration.read', 'organization', organization_id, now()))
  )
);
create policy fhir_patient_mappings_read on public.fhir_patient_mappings
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and public.current_role() in ('org_admin', 'auditor', 'facility_manager')
  )
);
create policy fhir_medication_requests_read on public.fhir_medication_requests
for select to authenticated using (app_private.clinical_record_visible(organization_id, facility_id));
create policy fhir_medication_administrations_read on public.fhir_medication_administrations
for select to authenticated using (app_private.clinical_record_visible(organization_id, facility_id));
create policy fhir_exceptions_read on public.fhir_integration_exceptions
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and (public.current_role() in ('org_admin', 'auditor')
      or public.has_effective_permission('clinical.integration.read', 'facility', facility_id, now()))
  )
);

do $$
declare t text;
begin
  foreach t in array array[
    'fhir_integration_sources', 'fhir_patient_mappings', 'fhir_medication_requests',
    'fhir_medication_administrations', 'fhir_integration_exceptions'
  ] loop
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$$;

revoke all on function public.save_fhir_integration_source(uuid, text, text, text, text, uuid, integer, text, uuid),
  public.map_fhir_patient(uuid, uuid, text, jsonb),
  public.resolve_fhir_integration_exception(uuid, text, text),
  public.apply_fhir_integration_command(uuid),
  public.run_fhir_integration_freshness_evaluator(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.save_fhir_integration_source(uuid, text, text, text, text, uuid, integer, text, uuid),
  public.map_fhir_patient(uuid, uuid, text, jsonb),
  public.resolve_fhir_integration_exception(uuid, text, text) to authenticated;
grant execute on function public.apply_fhir_integration_command(uuid),
  public.run_fhir_integration_freshness_evaluator(timestamptz) to service_role;
