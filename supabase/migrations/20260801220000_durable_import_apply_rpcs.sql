-- Durable import apply RPCs (BACKLOG D3 completion).
-- Four SECURITY DEFINER functions callable only by service_role (the durable
-- import cron worker). They mirror the business rules from the interactive RPCs
-- but replace auth.uid() with NULL (import is system-applied, not a human
-- reviewer) and validate entity ownership against the explicit p_organization_id
-- parameter instead of deriving scope from the caller's JWT.
--
-- Decision rationale: dedicated import-apply RPCs are the correct path.
-- Table-level INSERT/UPDATE grants on incidents / employee_credentials /
-- facility_rooms were explicitly revoked and must remain so. The interactive
-- RPCs (save_training_record, save_employee_credential, create_room_with_beds,
-- create_incident_atomic) are unchanged for authenticated callers.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. import_apply_training_record
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.import_apply_training_record(
  p_organization_id uuid,
  p_record_id uuid,
  p_payload jsonb
)
returns public.employee_training_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.employee_training_records%rowtype;
  v_candidate public.employee_training_records%rowtype;
  v_result public.employee_training_records%rowtype;
  v_employee public.employees%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'import_apply_training_record is restricted to service_role' using errcode = '42501';
  end if;
  if p_organization_id is null then
    raise exception 'p_organization_id is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_payload, 'null'::jsonb)) <> 'object' then
    raise exception 'training record payload must be an object' using errcode = '22023';
  end if;

  if p_record_id is not null then
    select * into v_existing
    from public.employee_training_records
    where id = p_record_id
    for update;
    if not found then
      raise exception 'training record not found' using errcode = 'P0002';
    end if;
    -- Verify the existing record belongs to the caller's organization
    if v_existing.organization_id is distinct from p_organization_id then
      raise exception 'training record is outside import scope' using errcode = '42501';
    end if;
    v_candidate := jsonb_populate_record(v_existing, p_payload);
    v_candidate.id := v_existing.id;
    v_candidate.created_at := v_existing.created_at;
    if v_candidate.employee_id is distinct from v_existing.employee_id
       or v_candidate.training_type_id is distinct from v_existing.training_type_id then
      raise exception 'training record identity fields cannot be changed' using errcode = '22023';
    end if;
  else
    v_candidate := jsonb_populate_record(null::public.employee_training_records, p_payload);
    v_candidate.id := extensions.gen_random_uuid();
    v_candidate.status := coalesce(v_candidate.status, 'missing');
    v_candidate.document_required := coalesce(v_candidate.document_required, false);
    v_candidate.created_at := now();
  end if;

  select * into v_employee
  from public.employees
  where id = v_candidate.employee_id;
  if not found or v_employee.status = 'terminated' then
    raise exception 'active employee not found' using errcode = '23503';
  end if;
  if v_employee.organization_id is distinct from p_organization_id then
    raise exception 'employee is outside import scope' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.training_types t
    where t.id = v_candidate.training_type_id
      and (t.organization_id is null or t.organization_id = v_employee.organization_id)
  ) then
    raise exception 'training type is outside the employee organization' using errcode = '23514';
  end if;

  v_candidate.organization_id := v_employee.organization_id;
  v_candidate.facility_id := v_employee.facility_id;
  v_candidate.updated_at := now();
  -- Import is system-applied: no human reviewer, verified_by_profile_id stays NULL
  v_candidate.verified_by_profile_id := null;
  v_candidate.verified_at := now();

  if p_record_id is null then
    insert into public.employee_training_records
    select (v_candidate).*
    returning * into v_result;
  else
    update public.employee_training_records r set
      employee_id = v_candidate.employee_id,
      training_type_id = v_candidate.training_type_id,
      completion_date = v_candidate.completion_date,
      due_date = v_candidate.due_date,
      status = v_candidate.status,
      trainer_name = v_candidate.trainer_name,
      trainer_credentials = v_candidate.trainer_credentials,
      training_provider = v_candidate.training_provider,
      certificate_number = v_candidate.certificate_number,
      score = v_candidate.score,
      hours = v_candidate.hours,
      notes = v_candidate.notes,
      document_required = v_candidate.document_required,
      completion_method = v_candidate.completion_method,
      verified_by_profile_id = v_candidate.verified_by_profile_id,
      verified_at = v_candidate.verified_at,
      approval_status = v_candidate.approval_status,
      review_comments = v_candidate.review_comments,
      external_certificate_document_id = v_candidate.external_certificate_document_id,
      updated_at = v_candidate.updated_at
    where r.id = p_record_id
    returning * into v_result;
  end if;
  return v_result;
end;
$$;

revoke all on function public.import_apply_training_record(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_apply_training_record(uuid, uuid, jsonb)
  to service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. import_apply_employee_credential
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.import_apply_employee_credential(
  p_organization_id uuid,
  p_credential_id uuid,
  p_payload jsonb
)
returns public.employee_credentials
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.employee_credentials%rowtype;
  v_employee public.employees%rowtype;
  v_result public.employee_credentials%rowtype;
  v_employee_id uuid;
  v_status text;
  v_type text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'import_apply_employee_credential is restricted to service_role' using errcode = '42501';
  end if;
  if p_organization_id is null then
    raise exception 'p_organization_id is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_payload, 'null'::jsonb)) <> 'object' then
    raise exception 'credential payload must be an object' using errcode = '22023';
  end if;

  if p_credential_id is not null then
    select * into v_existing from public.employee_credentials
    where id = p_credential_id for update;
    if not found then raise exception 'Credential not found' using errcode = 'P0002'; end if;
    -- Verify org scope
    if v_existing.organization_id is distinct from p_organization_id then
      raise exception 'credential is outside import scope' using errcode = '42501';
    end if;
    if p_payload ? 'employee_id'
       and (p_payload ->> 'employee_id')::uuid is distinct from v_existing.employee_id then
      raise exception 'Credential cannot be reassigned' using errcode = '23514';
    end if;
    v_employee_id := v_existing.employee_id;
    v_type := case when p_payload ? 'credential_type'
      then p_payload ->> 'credential_type' else v_existing.credential_type end;
    v_status := case when p_payload ? 'status'
      then p_payload ->> 'status' else v_existing.status end;
  else
    v_employee_id := nullif(p_payload ->> 'employee_id', '')::uuid;
    v_type := nullif(btrim(p_payload ->> 'credential_type'), '');
    v_status := coalesce(nullif(p_payload ->> 'status', ''), 'missing');
  end if;

  select * into v_employee from public.employees where id = v_employee_id;
  if not found then raise exception 'Employee not found' using errcode = '23503'; end if;
  if v_employee.organization_id is distinct from p_organization_id then
    raise exception 'employee is outside import scope' using errcode = '42501';
  end if;
  if v_type is null then raise exception 'Credential type is required' using errcode = '22023'; end if;
  if v_status not in ('compliant','due_soon','expired','missing','not_applicable') then
    raise exception 'Invalid credential status' using errcode = '22023';
  end if;

  if p_credential_id is null then
    insert into public.employee_credentials(
      organization_id, facility_id, employee_id, credential_type, credential_label,
      issuing_authority, credential_number, issue_date, expiration_date,
      last_verified_date, warning_days, status, verification_method,
      verified_by_profile_id, verified_at, notes, citation_topic_id
    ) values (
      v_employee.organization_id, v_employee.facility_id, v_employee.id, v_type,
      nullif(p_payload ->> 'credential_label', ''),
      nullif(p_payload ->> 'issuing_authority', ''),
      nullif(p_payload ->> 'credential_number', ''),
      nullif(p_payload ->> 'issue_date', '')::date,
      nullif(p_payload ->> 'expiration_date', '')::date,
      case when v_status = 'missing' then null else public.pa_today() end,
      coalesce(nullif(p_payload ->> 'warning_days', '')::integer, 90), v_status,
      case when v_status = 'missing' then null else nullif(p_payload ->> 'verification_method', '') end,
      -- Import is system-applied: no human reviewer
      null,
      case when v_status = 'missing' then null else now() end,
      nullif(p_payload ->> 'notes', ''),
      nullif(p_payload ->> 'citation_topic_id', '')::uuid
    ) returning * into v_result;
  else
    update public.employee_credentials c set
      credential_type = v_type,
      credential_label = case when p_payload ? 'credential_label' then nullif(p_payload ->> 'credential_label', '') else c.credential_label end,
      issuing_authority = case when p_payload ? 'issuing_authority' then nullif(p_payload ->> 'issuing_authority', '') else c.issuing_authority end,
      credential_number = case when p_payload ? 'credential_number' then nullif(p_payload ->> 'credential_number', '') else c.credential_number end,
      issue_date = case when p_payload ? 'issue_date' then nullif(p_payload ->> 'issue_date', '')::date else c.issue_date end,
      expiration_date = case when p_payload ? 'expiration_date' then nullif(p_payload ->> 'expiration_date', '')::date else c.expiration_date end,
      warning_days = case when p_payload ? 'warning_days' then (p_payload ->> 'warning_days')::integer else c.warning_days end,
      status = v_status,
      verification_method = case
        when v_status = 'missing' then null
        when p_payload ? 'verification_method' then nullif(p_payload ->> 'verification_method', '')
        else c.verification_method end,
      last_verified_date = case when v_status = 'missing' then null else public.pa_today() end,
      -- Import is system-applied: no human reviewer
      verified_by_profile_id = null,
      verified_at = case when v_status = 'missing' then null else now() end,
      notes = case when p_payload ? 'notes' then nullif(p_payload ->> 'notes', '') else c.notes end,
      citation_topic_id = case when p_payload ? 'citation_topic_id' then nullif(p_payload ->> 'citation_topic_id', '')::uuid else c.citation_topic_id end,
      updated_at = now()
    where c.id = p_credential_id
    returning * into v_result;
  end if;
  return v_result;
end;
$$;

revoke all on function public.import_apply_employee_credential(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_apply_employee_credential(uuid, uuid, jsonb)
  to service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. import_apply_room_with_beds
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.import_apply_room_with_beds(
  p_organization_id uuid,
  p_facility_id uuid,
  p_building_name text,
  p_unit_name text,
  p_room_number text,
  p_room_type text,
  p_bed_count integer,
  p_gender_restriction text default 'none'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facility public.facilities%rowtype;
  v_building uuid;
  v_unit uuid;
  v_room uuid;
  i integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'import_apply_room_with_beds is restricted to service_role' using errcode = '42501';
  end if;
  if p_organization_id is null then
    raise exception 'p_organization_id is required' using errcode = '22023';
  end if;

  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  -- Validate facility belongs to the explicit organization — no assert_admission_manager
  if v_facility.organization_id is distinct from p_organization_id then
    raise exception 'facility is outside import scope' using errcode = '42501';
  end if;

  if p_room_type not in ('private', 'semi_private', 'shared', 'suite', 'studio', 'other')
    or p_gender_restriction not in ('none', 'female', 'male', 'compatibility_review')
    or p_bed_count not between 1 and 8
    or length(btrim(coalesce(p_building_name, ''))) < 1
    or length(btrim(coalesce(p_room_number, ''))) < 1 then
    raise exception 'Invalid room inventory' using errcode = '22023';
  end if;

  insert into public.facility_buildings(
    organization_id, facility_id, name, licensed_capacity
  ) values (
    v_facility.organization_id, v_facility.id, btrim(p_building_name), 0
  )
  on conflict (facility_id, name) do update
  set updated_at = now()
  returning id into v_building;

  if nullif(btrim(p_unit_name), '') is not null then
    insert into public.residential_units(
      organization_id, facility_id, building_id, name
    ) values (
      v_facility.organization_id, v_facility.id, v_building, btrim(p_unit_name)
    )
    on conflict (building_id, name) do update set updated_at = now()
    returning id into v_unit;
  end if;

  insert into public.facility_rooms(
    organization_id, facility_id, building_id, residential_unit_id,
    room_number, room_type, gender_restriction
  ) values (
    v_facility.organization_id, v_facility.id, v_building, v_unit,
    btrim(p_room_number), p_room_type, p_gender_restriction
  )
  on conflict (facility_id, room_number) do update
  set room_type = excluded.room_type,
      residential_unit_id = excluded.residential_unit_id,
      gender_restriction = excluded.gender_restriction,
      updated_at = now()
  returning id into v_room;

  for i in 1..p_bed_count loop
    insert into public.facility_beds(
      organization_id, facility_id, room_id, bed_label
    ) values (
      v_facility.organization_id, v_facility.id, v_room,
      case when p_bed_count = 1 then 'A' else chr(64 + i) end
    ) on conflict (room_id, bed_label) do nothing;
  end loop;

  return v_room;
end;
$$;

revoke all on function public.import_apply_room_with_beds(uuid, uuid, text, text, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.import_apply_room_with_beds(uuid, uuid, text, text, text, text, integer, text)
  to service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. import_apply_incident
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.import_apply_incident(
  p_organization_id uuid,
  p_facility_id uuid,
  p_incident_type text,
  p_occurred_at timestamptz,
  p_resident_id uuid,
  p_resident_identifier_snapshot text,
  p_location_detail text,
  p_narrative text,
  p_severity text,
  p_idempotency_key text
)
returns public.incidents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.incidents%rowtype;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'import_apply_incident is restricted to service_role' using errcode = '42501';
  end if;
  if p_organization_id is null then
    raise exception 'p_organization_id is required' using errcode = '22023';
  end if;
  if v_key is null or length(v_key) not between 8 and 200 then
    raise exception 'An idempotency key between 8 and 200 characters is required' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_narrative, ''))) < 10 then
    raise exception 'Incident narrative must contain at least 10 characters' using errcode = '22023';
  end if;

  -- Validate facility belongs to the organization
  if not exists (
    select 1 from public.facilities f
    where f.id = p_facility_id and f.organization_id = p_organization_id
  ) then
    raise exception 'facility is outside import scope' using errcode = '42501';
  end if;

  -- Validate resident if provided
  if p_resident_id is not null then
    if not exists (
      select 1 from public.residents r
      where r.id = p_resident_id
        and r.organization_id = p_organization_id
        and r.facility_id = p_facility_id
    ) then
      raise exception 'resident is outside import scope' using errcode = '42501';
    end if;
  end if;

  -- Advisory lock + idempotency check
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':incident:' || v_key, 0));
  select * into v_incident
  from public.incidents
  where organization_id = p_organization_id and idempotency_key = v_key;
  if found then return v_incident; end if;

  insert into public.incidents(
    organization_id, facility_id, incident_type, occurred_at, reported_by_profile_id,
    resident_id, resident_identifier, resident_identifier_snapshot, location_detail,
    narrative, severity, idempotency_key
  ) values (
    p_organization_id, p_facility_id, p_incident_type, p_occurred_at,
    -- Import is system-applied: no human reporter
    null,
    p_resident_id,
    coalesce(p_resident_id::text, nullif(btrim(p_resident_identifier_snapshot), '')),
    nullif(btrim(p_resident_identifier_snapshot), ''),
    nullif(btrim(p_location_detail), ''),
    btrim(p_narrative), p_severity, v_key
  ) returning * into v_incident;

  return v_incident;
end;
$$;

revoke all on function public.import_apply_incident(uuid, uuid, text, timestamptz, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.import_apply_incident(uuid, uuid, text, timestamptz, uuid, text, text, text, text, text)
  to service_role;
