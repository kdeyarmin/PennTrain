-- Third-pass review follow-ons after 2026080519*:
--
-- 1. Auditors are read-only for survey evidence packets everywhere else (storage INSERT,
--    SURVEY_DAY_MODE_SPEC, generate-poc-document). add/remove/assemble incorrectly allowed
--    auditor to mutate packet items and write assemble audit side-effects.
-- 2. Facility managers could issue/revoke packet guest grants (and add/remove packet items)
--    for any facility in the org without is_assigned_to_facility.
-- 3. create_credential_renewal_submission let any org facility_manager submit for any
--    employee in the tenant; review/RLS are facility-scoped.
-- 4. save_learning_path_version allocated version_number via max()+1 without a lock; concurrent
--    authors hit the unique (path_definition_id, version_number) constraint as a race failure.

-- ---------------------------------------------------------------------------
-- Survey packet item mutators: drop auditor; require FM facility assignment
-- ---------------------------------------------------------------------------

create or replace function public.add_survey_evidence_packet_item(
  p_source_type text,
  p_label text,
  p_source_id uuid default null,
  p_facility_id uuid default null,
  p_survey_day_session_id uuid default null,
  p_binder_export_job_id uuid default null,
  p_notes text default null,
  p_sort_order integer default 0,
  p_citation_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_id uuid;
  v_citation text;
begin
  if v_org is null and not public.is_platform_admin() then
    raise exception 'Organization required' using errcode = '22023';
  end if;
  if not (
    public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      or (
        public.current_role() = 'facility_manager'
        and p_facility_id is not null
        and public.is_assigned_to_facility(p_facility_id)
      )
    )
  ) then
    raise exception 'Not authorized to build survey evidence packets' using errcode = '42501';
  end if;
  if p_source_type not in ('binder_export', 'evidence_artifact', 'incident', 'work_item', 'policy', 'note') then
    raise exception 'Invalid source_type' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_label, ''))) < 1 then
    raise exception 'Label is required' using errcode = '22023';
  end if;

  v_citation := nullif(btrim(coalesce(p_citation_ref, '')), '');
  if v_citation is null then
    v_citation := (regexp_match(
      btrim(p_label),
      '(?:^|[^0-9])([0-9]+(?:\.[0-9A-Za-z]+)+(?:\([^)]+\))*)'
    ))[1];
  end if;
  if v_citation is not null and length(v_citation) > 64 then
    raise exception 'citation_ref too long' using errcode = '22023';
  end if;

  insert into public.survey_evidence_packet_items (
    organization_id, facility_id, survey_day_session_id, binder_export_job_id,
    source_type, source_id, label, notes, sort_order, citation_ref, created_by
  ) values (
    coalesce(v_org, (select organization_id from public.binder_export_jobs where id = p_binder_export_job_id)),
    p_facility_id, p_survey_day_session_id, p_binder_export_job_id,
    p_source_type, p_source_id, btrim(p_label), nullif(btrim(p_notes), ''),
    coalesce(p_sort_order, 0), v_citation, auth.uid()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select i.id into v_id from public.survey_evidence_packet_items i
    where i.organization_id = coalesce(v_org, i.organization_id)
      and i.source_type = p_source_type
      and i.source_id is not distinct from p_source_id
      and i.survey_day_session_id is not distinct from p_survey_day_session_id
    limit 1;
  end if;
  return v_id;
end;
$$;

create or replace function public.remove_survey_evidence_packet_item(p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_facility uuid;
begin
  select organization_id, facility_id into v_org, v_facility
  from public.survey_evidence_packet_items where id = p_item_id;
  if not found then return false; end if;
  if not (
    public.is_platform_admin()
    or (
      v_org = public.current_org_id()
      and (
        public.current_role() = 'org_admin'
        or (
          public.current_role() = 'facility_manager'
          and v_facility is not null
          and public.is_assigned_to_facility(v_facility)
        )
      )
    )
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  delete from public.survey_evidence_packet_items where id = p_item_id;
  return true;
end;
$$;

create or replace function public.assemble_survey_evidence_packet_manifest(
  p_survey_day_session_id uuid default null,
  p_binder_export_job_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_items jsonb;
  v_manifest jsonb;
begin
  -- Assemble writes audit_logs and survey-day side effects; keep auditor on list/read only.
  if not (
    public.is_platform_admin()
    or public.current_role() in ('org_admin', 'facility_manager')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'sourceType', i.source_type,
      'sourceId', i.source_id,
      'label', i.label,
      'notes', i.notes,
      'sortOrder', i.sort_order,
      'citationRef', i.citation_ref,
      'binderExportJobId', i.binder_export_job_id,
      'regulationKey', app_private.survey_packet_item_regulation_key(i.citation_ref, i.label)
    ) order by app_private.survey_packet_item_regulation_key(i.citation_ref, i.label) nulls last,
              i.sort_order,
              i.created_at
  ), '[]'::jsonb)
  into v_items
  from public.survey_evidence_packet_items i
  where (public.is_platform_admin() or i.organization_id = v_org)
    and (p_survey_day_session_id is null or i.survey_day_session_id = p_survey_day_session_id)
    and (p_binder_export_job_id is null or i.binder_export_job_id = p_binder_export_job_id)
    and (
      public.is_platform_admin()
      or public.current_role() = 'org_admin'
      or (
        public.current_role() = 'facility_manager'
        and i.facility_id is not null
        and public.is_assigned_to_facility(i.facility_id)
      )
    );

  v_manifest := jsonb_build_object(
    'assembledAt', now(),
    'assembledBy', auth.uid(),
    'organizationId', v_org,
    'surveyDaySessionId', p_survey_day_session_id,
    'binderExportJobId', p_binder_export_job_id,
    'itemCount', jsonb_array_length(v_items),
    'items', v_items,
    'accessControlNote', 'Packet is selection metadata + existing binder/evidence artifacts; guest grants remain explicit via evidence room.',
    'immutable', true
  );

  if p_survey_day_session_id is not null then
    begin
      perform public.record_survey_day_packet_assembled(p_survey_day_session_id);
    exception when others then
      null;
    end;
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_org, auth.uid(), 'survey_evidence_packet', coalesce(p_survey_day_session_id, p_binder_export_job_id, extensions.gen_random_uuid())::text,
    'packet_assembled', v_manifest
  );

  return v_manifest;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guest grants: facility managers must be assigned to the export's facility
-- ---------------------------------------------------------------------------

create or replace function public.issue_survey_packet_guest_grant(
  p_packet_export_id uuid,
  p_guest_label text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.survey_evidence_packet_exports%rowtype;
  v_raw text;
  v_id uuid;
begin
  select * into v_export from public.survey_evidence_packet_exports where id = p_packet_export_id;
  if not found or v_export.status <> 'ready' then
    raise exception 'Packet export not found or not ready' using errcode = 'P0002';
  end if;
  if not (
    public.is_platform_admin()
    or (
      v_export.organization_id = public.current_org_id()
      and (
        public.current_role() = 'org_admin'
        or (
          public.current_role() = 'facility_manager'
          and v_export.facility_id is not null
          and public.is_assigned_to_facility(v_export.facility_id)
        )
      )
    )
  ) then
    raise exception 'Not authorized to issue packet guest grants' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_guest_label, ''))) < 1 then
    raise exception 'Guest label is required' using errcode = '22023';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '90 days' then
    raise exception 'Guest grant expiration must be within 90 days' using errcode = '22023';
  end if;

  v_raw := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.survey_packet_guest_grants (
    organization_id, facility_id, packet_export_id, token_sha256, guest_label, expires_at, created_by
  ) values (
    v_export.organization_id, v_export.facility_id, v_export.id,
    encode(extensions.digest(convert_to(v_raw, 'utf8'), 'sha256'), 'hex'),
    btrim(p_guest_label), p_expires_at, auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_export.organization_id, auth.uid(), 'survey_packet_guest_grant', v_id::text, 'grant_issued',
    jsonb_build_object('packetExportId', p_packet_export_id, 'guestLabel', btrim(p_guest_label), 'expiresAt', p_expires_at)
  );

  return jsonb_build_object(
    'grantId', v_id,
    'token', v_raw,
    'expiresAt', p_expires_at,
    'packetExportId', p_packet_export_id
  );
end;
$$;

create or replace function public.revoke_survey_packet_guest_grant(
  p_grant_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.survey_packet_guest_grants%rowtype;
begin
  select * into v_grant from public.survey_packet_guest_grants where id = p_grant_id for update;
  if not found then return false; end if;
  if not (
    public.is_platform_admin()
    or (
      v_grant.organization_id = public.current_org_id()
      and (
        public.current_role() = 'org_admin'
        or (
          public.current_role() = 'facility_manager'
          and v_grant.facility_id is not null
          and public.is_assigned_to_facility(v_grant.facility_id)
        )
      )
    )
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Revocation reason required' using errcode = '22023';
  end if;
  update public.survey_packet_guest_grants
  set revoked_at = now(), revoked_by = auth.uid(), revocation_reason = btrim(p_reason)
  where id = p_grant_id and revoked_at is null;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Credential renewal: facility managers stay in their assigned facilities
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_credential_renewal_submission(
  p_employee_id uuid,
  p_credential_id uuid,
  p_credential_document_id uuid,
  p_credential_type text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_employee public.employees%rowtype;
  v_id uuid;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.employee_credential_documents d
    where d.id = p_credential_document_id and d.employee_id = p_employee_id
      and (p_credential_id is null or d.credential_id = p_credential_id)
      and d.file_size between 1 and 10485760
      and lower(d.file_type) in ('application/pdf', 'image/jpeg', 'image/png')
  ) then
    raise exception 'Credential document must be a supported employee-owned file under 10 MB'
      using errcode = '23514';
  end if;
  if not coalesce((
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.id = v_employee.profile_id)
    or public.is_platform_admin()
    or (
      public.current_org_id() = v_employee.organization_id
      and (
        public.current_role() = 'org_admin'
        or (
          public.current_role() = 'facility_manager'
          and v_employee.facility_id is not null
          and public.is_assigned_to_facility(v_employee.facility_id)
        )
      )
    )
  ), false) then
    raise exception 'Credential renewal submission is outside caller scope' using errcode = '42501';
  end if;
  insert into public.credential_renewal_submissions(
    organization_id, facility_id, employee_id, credential_id,
    credential_document_id, credential_type, submitted_by
  ) values (
    v_employee.organization_id, v_employee.facility_id, v_employee.id,
    p_credential_id, p_credential_document_id, p_credential_type,
    app_private.current_actor_profile_id()
  ) returning id into v_id;
  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Learning path version numbers: serialize max()+1 per definition
-- ---------------------------------------------------------------------------

create or replace function public.save_learning_path_version(
  p_name text,
  p_definition jsonb,
  p_description text default null,
  p_path_definition_id uuid default null,
  p_version_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_definition_id uuid := p_path_definition_id;
  v_version_id uuid := p_version_id;
  v_number integer;
  v_steps jsonb;
  v_step jsonb;
  v_keys text[] := array[]::text[];
  v_prerequisite text;
begin
  if v_org is null then
    raise exception 'A learning path belongs to an organization' using errcode = '42501';
  end if;
  perform app_private.assert_content_permission(v_org, 'content.studio.author');

  if length(btrim(coalesce(p_name, ''))) < 3 then
    raise exception 'Give the path a name of at least three characters' using errcode = '22023';
  end if;
  if jsonb_typeof(p_definition) <> 'object' or jsonb_typeof(p_definition -> 'steps') <> 'array' then
    raise exception 'A path definition is an object with a steps array' using errcode = '22023';
  end if;

  v_steps := p_definition -> 'steps';
  if jsonb_array_length(v_steps) = 0 then
    raise exception 'A path with no steps assigns nobody anything' using errcode = '22023';
  end if;

  for v_step in select value from jsonb_array_elements(v_steps) loop
    if coalesce(btrim(v_step ->> 'key'), '') = '' then
      raise exception 'Every step needs a key' using errcode = '22023';
    end if;
    if v_step ->> 'key' = any(v_keys) then
      raise exception 'Duplicate step key %', v_step ->> 'key' using errcode = '22023';
    end if;
    v_keys := v_keys || (v_step ->> 'key');
  end loop;

  for v_step in select value from jsonb_array_elements(v_steps) loop
    for v_prerequisite in
      select value from jsonb_array_elements_text(coalesce(v_step -> 'prerequisites', '[]'::jsonb))
    loop
      if not (v_prerequisite = any(v_keys)) then
        raise exception 'Step % requires %, which is not a step in this path',
          v_step ->> 'key', v_prerequisite using errcode = '22023';
      end if;
      if v_prerequisite = v_step ->> 'key' then
        raise exception 'Step % cannot require itself', v_prerequisite using errcode = '22023';
      end if;
    end loop;
  end loop;

  if v_definition_id is null then
    insert into public.learning_path_definitions(organization_id, name, description, created_by)
    values (v_org, btrim(p_name), p_description, auth.uid())
    returning id into v_definition_id;
  else
    update public.learning_path_definitions
    set name = btrim(p_name), description = p_description, updated_at = now()
    where id = v_definition_id and organization_id = v_org;
    if not found then
      raise exception 'Learning path not found in this organization' using errcode = 'P0002';
    end if;
  end if;

  if v_version_id is not null then
    update public.learning_path_versions
    set definition = p_definition,
        definition_sha256 = encode(extensions.digest(convert_to(p_definition::text, 'utf8'), 'sha256'), 'hex')
    where id = v_version_id
      and organization_id = v_org
      and path_definition_id = v_definition_id
      and state = 'draft';
    if not found then
      raise exception 'Only a draft version of this path can be edited' using errcode = '55000';
    end if;
    return v_version_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('learning_path_version:' || v_definition_id::text, 0));

  select coalesce(max(version_number), 0) + 1 into v_number
  from public.learning_path_versions where path_definition_id = v_definition_id;

  insert into public.learning_path_versions(
    path_definition_id, organization_id, version_number, state, definition, definition_sha256
  ) values (
    v_definition_id, v_org, v_number, 'draft', p_definition,
    encode(extensions.digest(convert_to(p_definition::text, 'utf8'), 'sha256'), 'hex')
  ) returning id into v_version_id;

  return v_version_id;
end;
$$;
