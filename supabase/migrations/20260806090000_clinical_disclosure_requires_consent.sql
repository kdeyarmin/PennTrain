-- Clinical disclosure requires clinical_data_consent = 'granted'.
--
-- Charting stays ungated (treatment/operations documentation). Outbound disclosure does not:
-- FHIR write-back, organization export of clinical/FHIR resident rows, and the designated-person
-- portal's document share/download (plus schedule preparation instructions) all consult the
-- posture. Counsel cleared this binding 2026-08; see docs/HIPAA_CLINICAL_DATA.md.

comment on column public.residents.clinical_data_consent is
  'Resident/representative consent posture for disclosing clinical (EHR) data outside treatment/operations charting. Outbound paths (FHIR write-back, organization clinical export, designated-person portal documents/prep instructions) require granted. Charting deliberately does not. Values: not_recorded | granted | restricted | revoked.';

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function app_private.clinical_disclosure_allowed(p_consent text)
returns boolean
language sql
immutable
as $$
  select p_consent = 'granted';
$$;

revoke all on function app_private.clinical_disclosure_allowed(text) from public, anon, authenticated;

create or replace function app_private.assert_clinical_disclosure_allowed(p_resident_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_consent text;
begin
  select clinical_data_consent into v_consent
  from public.residents
  where id = p_resident_id;
  if v_consent is null then
    raise exception 'Resident not found' using errcode = 'P0002';
  end if;
  if not app_private.clinical_disclosure_allowed(v_consent) then
    raise exception
      'Clinical disclosure requires granted clinical data consent (current posture: %)',
      v_consent
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.assert_clinical_disclosure_allowed(uuid)
  from public, anon, authenticated;

-- Manager-facing setter so the posture is not only a seed default.
create or replace function public.set_resident_clinical_data_consent(
  p_resident_id uuid,
  p_consent text,
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.residents%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_consent not in ('not_recorded', 'granted', 'restricted', 'revoked') then
    raise exception 'Invalid clinical data consent posture' using errcode = '22023';
  end if;
  select * into v_res from public.residents where id = p_resident_id;
  if v_res.id is null then
    raise exception 'Resident not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_clinical_contributor(v_res.organization_id, v_res.facility_id, true);
  if v_res.clinical_data_consent = p_consent then
    return p_consent;
  end if;
  if p_consent in ('restricted', 'revoked') and (v_reason is null or length(v_reason) < 3) then
    raise exception 'A reason is required when restricting or revoking clinical disclosure consent'
      using errcode = '22023';
  end if;
  update public.residents
  set clinical_data_consent = p_consent, updated_at = now()
  where id = p_resident_id;
  -- residents carry the standard audit_log_trigger; no separate clinical_access_log kind for
  -- consent posture changes (that log is reserved for PHI read/export/print).
  return p_consent;
end;
$$;

revoke all on function public.set_resident_clinical_data_consent(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.set_resident_clinical_data_consent(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. FHIR write-back
-- ---------------------------------------------------------------------------

create or replace function public.queue_clinical_observation_writeback(p_observation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_obs public.clinical_observations%rowtype;
  v_map public.fhir_patient_mappings%rowtype;
  v_source public.fhir_integration_sources%rowtype;
  v_payload jsonb;
  v_id uuid;
begin
  select * into v_obs from public.clinical_observations where id = p_observation_id;
  if v_obs.id is null then raise exception 'Observation not found' using errcode = 'P0002'; end if;
  if v_obs.entered_in_error then raise exception 'A retracted observation cannot be written back' using errcode = '55000'; end if;
  perform app_private.assert_clinical_integration_scope(v_obs.organization_id, v_obs.facility_id, 'clinical.integration.writeback');
  perform app_private.assert_clinical_disclosure_allowed(v_obs.resident_id);

  select m.* into v_map from public.fhir_patient_mappings m
  join public.fhir_integration_sources s on s.id = m.source_id
  where m.resident_id = v_obs.resident_id and m.status = 'active'
    and s.facility_id = v_obs.facility_id and s.writeback_enabled and s.status = 'active'
  order by m.mapped_at desc limit 1;
  if v_map.id is null then
    raise exception 'No write-back-enabled FHIR source with a patient mapping for this resident' using errcode = '42501';
  end if;
  select * into v_source from public.fhir_integration_sources where id = v_map.source_id;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'resourceType', 'Observation',
    'status', 'final',
    'code', jsonb_build_object(
      'coding', case when v_obs.loinc_code is not null
        then jsonb_build_array(jsonb_build_object('system', 'http://loinc.org', 'code', v_obs.loinc_code)) else null end,
      'text', replace(v_obs.observation_type, '_', ' ')),
    'subject', jsonb_build_object('reference', 'Patient/' || v_map.fhir_patient_id),
    'effectiveDateTime', v_obs.observed_at,
    'component', case
      when v_obs.observation_type = 'blood_pressure' and v_obs.value_secondary is not null then jsonb_build_array(
        jsonb_build_object(
          'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
            'system', 'http://loinc.org', 'code', '8480-6', 'display', 'Systolic blood pressure'))),
          'valueQuantity', jsonb_build_object('value', v_obs.value_numeric,
            'unit', v_obs.unit, 'system', 'http://unitsofmeasure.org', 'code', v_obs.unit)),
        jsonb_build_object(
          'code', jsonb_build_object('coding', jsonb_build_array(jsonb_build_object(
            'system', 'http://loinc.org', 'code', '8462-4', 'display', 'Diastolic blood pressure'))),
          'valueQuantity', jsonb_build_object('value', v_obs.value_secondary,
            'unit', v_obs.unit, 'system', 'http://unitsofmeasure.org', 'code', v_obs.unit)))
      else null end,
    'valueQuantity', case
      when v_obs.value_numeric is not null
        and not (v_obs.observation_type = 'blood_pressure' and v_obs.value_secondary is not null)
      then jsonb_build_object(
        'value', v_obs.value_numeric, 'unit', v_obs.unit,
        'system', 'http://unitsofmeasure.org', 'code', v_obs.unit) else null end,
    'valueString', case when v_obs.value_numeric is null then v_obs.value_text else null end,
    'note', case when v_obs.note is not null then jsonb_build_array(jsonb_build_object('text', v_obs.note)) else null end
  ));

  insert into public.fhir_writeback_queue(
    organization_id, facility_id, source_id, resident_id, fhir_patient_id,
    resource_type, origin_kind, origin_id, fhir_payload, target_url, created_by
  ) values (
    v_obs.organization_id, v_obs.facility_id, v_source.id, v_obs.resident_id, v_map.fhir_patient_id,
    'Observation', 'clinical_observation', v_obs.id, v_payload,
    nullif(v_source.fhir_base_url, '') , auth.uid()
  ) on conflict (origin_kind, origin_id) do update set
    fhir_payload = excluded.fhir_payload, status = 'pending', attempts = 0,
    last_error = null, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.claim_fhir_writeback_batch(
  p_limit integer default 20, p_stale_after_seconds integer default 300
)
returns setof public.fhir_writeback_queue language plpgsql security definer set search_path = '' as $$
begin
  -- Rows whose resident no longer has granted disclosure consent are marked skipped so they
  -- do not sit pending forever (mirrors the writeback_enabled revoke path, but terminal).
  update public.fhir_writeback_queue w
  set status = 'skipped',
      last_error = left('clinical_data_consent does not allow disclosure', 500),
      updated_at = now()
  where w.status in ('pending', 'in_flight')
    and not exists (
      select 1 from public.residents r
      where r.id = w.resident_id and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
    );

  return query
  update public.fhir_writeback_queue q set status = 'in_flight', attempts = q.attempts + 1, updated_at = now()
  where q.id in (
    select w.id from public.fhir_writeback_queue w
    where w.target_url is not null and (
      w.status = 'pending'
      or (w.status = 'in_flight'
          and w.updated_at < now() - make_interval(secs => greatest(coalesce(p_stale_after_seconds, 300), 30)))
    )
    and exists (
      select 1 from public.fhir_integration_sources s
      where s.id = w.source_id and s.writeback_enabled and s.status = 'active'
    )
    and exists (
      select 1 from public.residents r
      where r.id = w.resident_id and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
    )
    order by w.created_at limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update of w skip locked
  )
  returning q.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Organization export — omit non-granted clinical/FHIR resident rows
-- ---------------------------------------------------------------------------

create or replace function public.export_organization_table(
  p_organization_id uuid,
  p_table_name text,
  p_offset integer default 0,
  p_limit integer default 1000
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_has_id boolean;
  v_has_resident_id boolean;
  v_consent_sql text := '';
  v_order text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Only the trusted export worker may read export rows' using errcode = '42501';
  end if;
  if p_offset < 0 or p_limit not between 1 and 1000
     or not exists (
       select 1 from public.get_organization_export_catalog() c
       where c.table_name = p_table_name
     ) then
    raise exception 'Organization export table request is invalid' using errcode = '22023';
  end if;
  select exists (
    select 1 from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = p_table_name
      and a.attname = 'id' and a.attnum > 0 and not a.attisdropped
  ) into v_has_id;
  select exists (
    select 1 from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = p_table_name
      and a.attname = 'resident_id' and a.attnum > 0 and not a.attisdropped
  ) into v_has_resident_id;

  if v_has_resident_id and (
    p_table_name like 'clinical\_%' escape '\'
    or p_table_name like 'fhir\_%' escape '\'
  ) then
    v_consent_sql := $sql$
      and exists (
        select 1 from public.residents r
        where r.id = t.resident_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
      )
    $sql$;
  elsif p_table_name = 'clinical_observation_amendments' then
    v_consent_sql := $sql$
      and exists (
        select 1
        from public.clinical_observations o
        join public.residents r on r.id = o.resident_id
        where o.id = t.observation_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
      )
    $sql$;
  elsif p_table_name = 'clinical_care_plan_goals' then
    v_consent_sql := $sql$
      and exists (
        select 1
        from public.clinical_care_plans p
        join public.residents r on r.id = p.resident_id
        where p.id = t.care_plan_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
      )
    $sql$;
  elsif p_table_name = 'clinical_progress_note_versions' then
    v_consent_sql := $sql$
      and exists (
        select 1
        from public.clinical_progress_notes n
        join public.residents r on r.id = n.resident_id
        where n.id = t.note_id
          and app_private.clinical_disclosure_allowed(r.clinical_data_consent)
      )
    $sql$;
  end if;

  v_order := case when v_has_id then 't.id' else 't.ctid' end;
  return query execute format(
    'select to_jsonb(t) from public.%I t where t.organization_id = $1 %s order by %s offset $2 limit $3',
    p_table_name,
    v_consent_sql,
    v_order
  ) using p_organization_id, p_offset, p_limit;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Designated-person portal
-- ---------------------------------------------------------------------------

create or replace function public.share_resident_portal_document(
  p_grant_id uuid, p_document_id uuid, p_display_label text, p_share boolean default true
) returns void language plpgsql security definer set search_path = '' as $$
declare v_grant public.resident_portal_grants%rowtype; v_document public.resident_documents%rowtype;
begin
  select * into v_grant from public.resident_portal_grants where id = p_grant_id;
  select * into v_document from public.resident_documents where id = p_document_id;
  if v_grant.id is null or v_document.id is null or v_document.resident_id <> v_grant.resident_id
     or not ('documents' = any(v_grant.permissions)) then
    raise exception 'Document is not eligible for this portal grant' using errcode = '42501';
  end if;
  perform app_private.assert_resident_portal_manager(v_grant.resident_id);
  if p_share then
    perform app_private.assert_clinical_disclosure_allowed(v_grant.resident_id);
    insert into public.resident_portal_shared_documents(
      organization_id, facility_id, grant_id, resident_id, document_id, display_label, shared_by
    ) values (
      v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
      v_document.id, btrim(p_display_label), auth.uid()
    ) on conflict (grant_id, document_id) do update set
      display_label = excluded.display_label, withdrawn_at = null, withdrawn_by = null,
      shared_by = auth.uid(), shared_at = now();
  else
    update public.resident_portal_shared_documents set withdrawn_at = now(), withdrawn_by = auth.uid()
    where grant_id = p_grant_id and document_id = p_document_id and withdrawn_at is null;
  end if;
end;
$$;

create or replace function public.authorize_resident_portal_document_download(
  p_token text,
  p_shared_document_id uuid,
  p_request_fingerprint_sha256 text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.resident_portal_grants%rowtype;
  v_shared public.resident_portal_shared_documents%rowtype;
  v_document public.resident_documents%rowtype;
begin
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  select * into v_shared from public.resident_portal_shared_documents where id = p_shared_document_id;
  if v_grant.id is null or v_grant.accepted_terms_at is null or not ('documents' = any(v_grant.permissions))
     or v_shared.id is null or v_shared.grant_id <> v_grant.id or v_shared.withdrawn_at is not null then
    raise exception 'Portal document access denied' using errcode = '42501';
  end if;
  perform app_private.assert_clinical_disclosure_allowed(v_grant.resident_id);
  select * into v_document from public.resident_documents where id = v_shared.document_id;
  if v_document.id is null or v_document.resident_id <> v_grant.resident_id
     or v_document.storage_bucket is null or v_document.storage_path is null then
    raise exception 'Portal document is unavailable' using errcode = 'P0002';
  end if;
  if p_request_fingerprint_sha256 is not null and p_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Portal request fingerprint is invalid' using errcode = '22023';
  end if;
  insert into public.resident_portal_access_events(
    organization_id, facility_id, grant_id, resident_id, event_type, request_fingerprint_sha256
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    'document_downloaded', p_request_fingerprint_sha256
  );
  return jsonb_build_object(
    'authorized', true, 'bucket', v_document.storage_bucket, 'path', v_document.storage_path,
    'fileName', v_document.file_name, 'fileType', v_document.file_type
  );
end;
$$;

create or replace function public.get_resident_portal_snapshot(
  p_token text, p_request_fingerprint_sha256 text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_grant public.resident_portal_grants%rowtype;
  v_resident public.residents%rowtype;
  v_facility public.facilities%rowtype;
  v_disclosure_ok boolean;
  v_schedule jsonb := '[]'::jsonb;
  v_finance jsonb := 'null'::jsonb;
  v_documents jsonb := '[]'::jsonb;
  v_messages jsonb := '[]'::jsonb;
begin
  if p_request_fingerprint_sha256 is not null and p_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid request fingerprint' using errcode = '22023';
  end if;
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if v_grant.id is null then return jsonb_build_object('accessStatus', 'invalid'); end if;
  if v_grant.accepted_terms_at is null then
    return jsonb_build_object(
      'accessStatus', 'terms_required', 'termsVersion', v_grant.terms_version,
      'expiresAt', v_grant.expires_at
    );
  end if;
  select * into v_resident from public.residents where id = v_grant.resident_id;
  select * into v_facility from public.facilities where id = v_grant.facility_id;
  v_disclosure_ok := app_private.clinical_disclosure_allowed(v_resident.clinical_data_consent);
  if 'schedule' = any(v_grant.permissions) then
    select coalesce(jsonb_agg(to_jsonb(s) order by s."startsAt"), '[]'::jsonb) into v_schedule
    from (
      select e.id, e.event_type as "eventType", e.title, e.starts_at as "startsAt",
        e.ends_at as "endsAt", e.location_name as "locationName",
        e.transportation_mode as "transportationMode",
        case when v_disclosure_ok then e.preparation_instructions else null end as "preparationInstructions"
      from public.resident_service_calendar_events e
      where e.resident_id = v_grant.resident_id and e.status = 'scheduled'
        and e.starts_at >= now() and e.starts_at < now() + interval '90 days'
      order by e.starts_at limit 25
    ) s;
  end if;
  if 'finance' = any(v_grant.permissions) then
    select coalesce(to_jsonb(s), 'null'::jsonb) into v_finance from (
      select f.statement_number as "statementNumber", f.issued_on as "issuedOn",
        f.due_date as "dueDate", f.balance_due as "balanceDue",
        f.delinquent_amount as "delinquentAmount"
      from public.resident_financial_statements f where f.resident_id = v_grant.resident_id
      order by f.issued_on desc, f.created_at desc limit 1
    ) s;
  end if;
  -- Shared documents are an outbound PHI disclosure — only when consent is granted.
  if v_disclosure_ok and 'documents' = any(v_grant.permissions) then
    select coalesce(jsonb_agg(to_jsonb(d) order by d."sharedAt" desc), '[]'::jsonb) into v_documents
    from (
      select sd.id, sd.display_label as "displayLabel", rd.file_name as "fileName",
        rd.file_type as "fileType", sd.shared_at as "sharedAt"
      from public.resident_portal_shared_documents sd
      join public.resident_documents rd on rd.id = sd.document_id
      where sd.grant_id = v_grant.id and sd.withdrawn_at is null
    ) d;
  end if;
  if 'messages' = any(v_grant.permissions) then
    select coalesce(jsonb_agg(to_jsonb(m) order by m."createdAt"), '[]'::jsonb) into v_messages
    from (
      select pm.id, pm.direction, pm.body, pm.created_at as "createdAt"
      from public.resident_portal_messages pm where pm.grant_id = v_grant.id
      order by pm.created_at desc limit 50
    ) m;
  end if;
  update public.resident_portal_grants set last_accessed_at = now() where id = v_grant.id;
  insert into public.resident_portal_access_events(
    organization_id, facility_id, grant_id, resident_id, event_type, request_fingerprint_sha256
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    case when v_disclosure_ok and 'documents' = any(v_grant.permissions)
      then 'document_list_viewed' else 'view' end,
    p_request_fingerprint_sha256
  );
  return jsonb_build_object(
    'accessStatus', 'active',
    'expiresAt', v_grant.expires_at,
    'designatedPersonName', v_grant.designated_person_name,
    'relationship', v_grant.relationship_label,
    'permissions', to_jsonb(v_grant.permissions),
    'clinicalDisclosureAllowed', v_disclosure_ok,
    'clinicalDataConsent', v_resident.clinical_data_consent,
    'resident', jsonb_build_object(
      'displayName', v_resident.first_name || ' ' || v_resident.last_name,
      'room', v_resident.room
    ),
    'facility', jsonb_build_object(
      'name', v_facility.name, 'phone', v_facility.phone,
      'address', concat_ws(', ', v_facility.address, v_facility.city, v_facility.state, v_facility.zip)
    ),
    'schedule', v_schedule, 'finance', v_finance,
    'documents', v_documents, 'messages', v_messages
  );
end;
$$;
