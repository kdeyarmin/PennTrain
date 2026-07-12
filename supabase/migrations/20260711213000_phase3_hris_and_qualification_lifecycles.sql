create extension if not exists pgcrypto with schema extensions;

insert into public.permission_definitions(permission_key, description, risk_level)
values
  ('workforce.import.manage', 'Configure and reconcile governed HRIS imports', 'privileged'),
  ('qualifications.read', 'Read effective qualification and certification evidence', 'standard'),
  ('qualifications.manage', 'Approve, suspend, and revoke workforce qualifications', 'privileged'),
  ('credentials.renewal.review', 'Review extracted employee credential renewals', 'privileged'),
  ('training.sessions.manage', 'Manage instructor-led capacity, attendance, and completion', 'privileged'),
  ('scheduling.eligibility.read', 'Evaluate and explain workforce scheduling eligibility', 'standard'),
  ('scheduling.eligibility.override', 'Grant bounded scheduling eligibility overrides', 'privileged'),
  ('scheduling.self_service.manage', 'Configure employee scheduling self-service policy', 'privileged')
on conflict (permission_key) do update set
  description = excluded.description,
  risk_level = excluded.risk_level;

insert into public.role_template_permissions(role_template_id, permission_key)
select rt.id, p.permission_key
from public.role_templates rt
cross join lateral (
  select unnest(case rt.built_in_role
    when 'platform_admin' then array[
      'workforce.import.manage', 'qualifications.read', 'qualifications.manage',
      'credentials.renewal.review', 'training.sessions.manage',
      'scheduling.eligibility.read', 'scheduling.eligibility.override',
      'scheduling.self_service.manage'
    ]::text[]
    when 'org_admin' then array[
      'workforce.import.manage', 'qualifications.read', 'qualifications.manage',
      'credentials.renewal.review', 'training.sessions.manage',
      'scheduling.eligibility.read', 'scheduling.eligibility.override',
      'scheduling.self_service.manage'
    ]::text[]
    when 'facility_manager' then array[
      'qualifications.read', 'qualifications.manage',
      'credentials.renewal.review', 'training.sessions.manage',
      'scheduling.eligibility.read', 'scheduling.eligibility.override'
    ]::text[]
    when 'trainer' then array[
      'qualifications.read', 'training.sessions.manage',
      'scheduling.eligibility.read'
    ]::text[]
    else array[]::text[]
  end) permission_key
) p
where rt.built_in_role in ('platform_admin', 'org_admin', 'facility_manager', 'trainer')
on conflict (role_template_id, permission_key) do nothing;

create table public.hris_source_systems (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  display_name text not null check (length(btrim(display_name)) between 2 and 200),
  provider_type text not null check (provider_type in ('generic_csv', 'sftp', 'api', 'webhook')),
  import_mode text not null default 'delta' check (import_mode in ('delta', 'full')),
  mapping_version integer not null default 1 check (mapping_version > 0),
  mapping_config jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping_config) = 'object'),
  adapter_config jsonb not null default '{}'::jsonb check (jsonb_typeof(adapter_config) = 'object'),
  schedule_cron text,
  status text not null default 'pilot' check (status in ('pilot', 'active', 'paused', 'revoked')),
  last_cursor text,
  last_reconciled_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_key)
);
create trigger set_updated_at before update on public.hris_source_systems
for each row execute function public.set_updated_at();

create table public.hris_import_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_system_id uuid not null references public.hris_source_systems(id) on delete restrict,
  request_id text not null check (length(btrim(request_id)) between 8 and 200),
  import_mode text not null check (import_mode in ('delta', 'full')),
  mapping_version integer not null check (mapping_version > 0),
  source_cursor text,
  source_checksum_sha256 text check (source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'staging' check (status in (
    'staging', 'validated', 'blocked', 'applying', 'applied', 'reconciled', 'failed', 'canceled'
  )),
  source_count integer check (source_count >= 0),
  staged_count integer not null default 0 check (staged_count >= 0),
  applied_count integer not null default 0 check (applied_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  resume_after_row integer not null default 0 check (resume_after_row >= 0),
  reconciliation jsonb not null default '{}'::jsonb,
  correlation_id text not null default gen_random_uuid()::text,
  started_by uuid references public.profiles(id),
  validated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system_id, request_id)
);
create index hris_import_runs_source_created_idx
on public.hris_import_runs(source_system_id, created_at desc);
create trigger set_updated_at before update on public.hris_import_runs
for each row execute function public.set_updated_at();

create table public.hris_identity_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_system_id uuid not null references public.hris_source_systems(id) on delete restrict,
  external_person_id text not null check (length(btrim(external_person_id)) between 1 and 300),
  external_employment_id text not null check (length(btrim(external_employment_id)) between 1 and 300),
  person_id uuid not null references public.workforce_people(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  source_checksum_sha256 text check (source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create unique index hris_identity_links_active_person_uidx
on public.hris_identity_links(source_system_id, external_person_id)
where effective_to is null;
create unique index hris_identity_links_active_employment_uidx
on public.hris_identity_links(source_system_id, external_employment_id)
where effective_to is null;

create table public.hris_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.hris_import_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_system_id uuid not null references public.hris_source_systems(id) on delete restrict,
  row_number integer not null check (row_number > 0),
  external_person_id text,
  external_employment_id text,
  source_payload_sha256 text not null check (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  validation_status text not null default 'pending' check (validation_status in ('pending', 'valid', 'invalid')),
  match_status text not null default 'unmatched' check (match_status in (
    'unmatched', 'external_link', 'candidate', 'ambiguous', 'new_person'
  )),
  candidate_employee_ids uuid[] not null default array[]::uuid[],
  merge_decision text check (merge_decision in ('create', 'link', 'skip', 'reject')),
  decided_employee_id uuid references public.employees(id) on delete restrict,
  decision_reason text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  apply_status text not null default 'pending' check (apply_status in ('pending', 'applied', 'skipped', 'rejected', 'failed')),
  applied_employee_id uuid references public.employees(id) on delete restrict,
  applied_lifecycle_event_id uuid references public.employment_lifecycle_events(id) on delete restrict,
  error_codes text[] not null default array[]::text[],
  error_detail text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_run_id, row_number)
);
create index hris_import_rows_run_status_idx
on public.hris_import_rows(import_run_id, apply_status, row_number);
create trigger set_updated_at before update on public.hris_import_rows
for each row execute function public.set_updated_at();

create table public.hris_import_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_run_id uuid not null references public.hris_import_runs(id) on delete cascade,
  import_row_id uuid references public.hris_import_rows(id) on delete cascade,
  exception_code text not null,
  severity text not null check (severity in ('warning', 'blocking')),
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'accepted', 'dismissed')),
  resolution text,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index hris_import_exceptions_open_uidx
on public.hris_import_exceptions(import_run_id, import_row_id, exception_code)
where status = 'open';

create table public.certification_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  qualification_key text not null check (qualification_key ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  name text not null,
  description text,
  separation_of_duties boolean not null default true,
  renewal_window_days integer not null default 90 check (renewal_window_days between 0 and 730),
  default_validity_days integer check (default_validity_days between 1 and 3650),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index certification_definitions_global_uidx
on public.certification_definitions(qualification_key) where organization_id is null;
create unique index certification_definitions_org_uidx
on public.certification_definitions(organization_id, qualification_key) where organization_id is not null;
create trigger set_updated_at before update on public.certification_definitions
for each row execute function public.set_updated_at();

create table public.certification_definition_versions (
  id uuid primary key default gen_random_uuid(),
  certification_definition_id uuid not null references public.certification_definitions(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  lifecycle_state text not null default 'draft' check (lifecycle_state in ('draft', 'published', 'superseded', 'retired')),
  criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(criteria) = 'object'),
  criteria_checksum_sha256 text not null check (criteria_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  effective_from timestamptz,
  effective_to timestamptz,
  authored_by uuid not null references public.profiles(id),
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (certification_definition_id, version_number),
  check (effective_to is null or effective_from is not null and effective_to > effective_from)
);

create table public.certification_checklist_items (
  id uuid primary key default gen_random_uuid(),
  certification_version_id uuid not null references public.certification_definition_versions(id) on delete cascade,
  item_key text not null,
  prompt text not null,
  evidence_required boolean not null default true,
  signature_required boolean not null default false,
  sort_order integer not null default 0,
  unique (certification_version_id, item_key)
);

create table public.assessor_qualifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  certification_definition_id uuid not null references public.certification_definitions(id) on delete cascade,
  assessor_profile_id uuid not null references public.profiles(id) on delete cascade,
  effective_from timestamptz not null,
  effective_to timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  approved_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create unique index assessor_qualifications_active_uidx
on public.assessor_qualifications(certification_definition_id, assessor_profile_id)
where effective_to is null;

create table public.certification_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  certification_version_id uuid not null references public.certification_definition_versions(id) on delete restrict,
  assessor_profile_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'passed', 'failed', 'voided')),
  observed_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  decision_reason text,
  assessor_signature_sha256 text check (assessor_signature_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_checksum_sha256 text check (evidence_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.certification_attempts
for each row execute function public.set_updated_at();

create table public.certification_attempt_items (
  id uuid primary key default gen_random_uuid(),
  certification_attempt_id uuid not null references public.certification_attempts(id) on delete cascade,
  checklist_item_id uuid not null references public.certification_checklist_items(id) on delete restrict,
  result text not null check (result in ('met', 'not_met', 'not_applicable')),
  evidence jsonb not null default '{}'::jsonb,
  evidence_checksum_sha256 text check (evidence_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (certification_attempt_id, checklist_item_id)
);

create table public.employee_qualifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  certification_definition_id uuid not null references public.certification_definitions(id) on delete restrict,
  certification_version_id uuid not null references public.certification_definition_versions(id) on delete restrict,
  source_attempt_id uuid references public.certification_attempts(id) on delete restrict,
  state text not null check (state in ('active', 'expired', 'suspended', 'revoked', 'superseded')),
  issued_at timestamptz not null,
  effective_from timestamptz not null,
  expires_at timestamptz,
  renewal_window_opens_at timestamptz,
  effective_to timestamptz,
  state_reason text,
  approved_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > effective_from),
  check (effective_to is null or effective_to > effective_from)
);
create unique index employee_qualifications_active_uidx
on public.employee_qualifications(employee_id, certification_definition_id)
where effective_to is null and state in ('active', 'suspended');
create index employee_qualifications_effective_idx
on public.employee_qualifications(employee_id, effective_from, effective_to, state);
create trigger set_updated_at before update on public.employee_qualifications
for each row execute function public.set_updated_at();

create table public.qualification_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_qualification_id uuid not null references public.employee_qualifications(id) on delete restrict,
  event_type text not null check (event_type in ('issued', 'renewed', 'suspended', 'restored', 'revoked', 'expired', 'superseded')),
  prior_state text,
  resulting_state text not null,
  reason text not null,
  actor_profile_id uuid references public.profiles(id),
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table public.credential_renewal_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  credential_id uuid references public.employee_credentials(id) on delete restrict,
  credential_document_id uuid not null references public.employee_credential_documents(id) on delete restrict,
  credential_type text not null,
  status text not null default 'uploaded' check (status in (
    'uploaded', 'scanning', 'quarantined', 'extracted', 'needs_review', 'approved', 'rejected'
  )),
  scan_status text not null default 'pending' check (scan_status in ('pending', 'clean', 'malicious', 'failed')),
  scan_provider text,
  scan_evidence jsonb not null default '{}'::jsonb,
  extraction_provider text,
  extraction_model text,
  extracted_fields jsonb not null default '{}'::jsonb,
  extraction_confidence jsonb not null default '{}'::jsonb,
  human_confirmed_fields jsonb not null default '{}'::jsonb,
  submitted_by uuid references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_reason text,
  approved_credential_id uuid references public.employee_credentials(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'approved' or reviewed_by is not null and reviewed_at is not null)
);
create index credential_renewal_queue_idx
on public.credential_renewal_submissions(organization_id, status, created_at);
create trigger set_updated_at before update on public.credential_renewal_submissions
for each row execute function public.set_updated_at();

create or replace function app_private.assert_phase3_admin(
  p_organization_id uuid,
  p_permission_key text,
  p_facility_id uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role', '') = 'service_role' then return; end if;
  if auth.uid() is null then
    raise exception 'An authenticated administrator is required' using errcode = '42501';
  end if;
  perform public.assert_identity_assurance('workforce_admin');
  if public.is_platform_admin() then return; end if;
  if public.current_org_id() <> p_organization_id then
    raise exception 'Phase 3 administration is outside the caller tenant' using errcode = '42501';
  end if;
  if public.current_role() = 'org_admin' then return; end if;
  if p_facility_id is not null and public.has_effective_permission(
    p_permission_key, 'facility', p_facility_id, now()
  ) then return; end if;
  if public.has_effective_permission(
    p_permission_key, 'organization', p_organization_id, now()
  ) then return; end if;
  raise exception 'Required Phase 3 permission is missing: %', p_permission_key
    using errcode = '42501';
end;
$$;
revoke all on function app_private.assert_phase3_admin(uuid, text, uuid)
from public, anon, authenticated, service_role;

create or replace function public.create_hris_import_run(
  p_source_system_id uuid,
  p_request_id text,
  p_import_mode text default null,
  p_source_cursor text default null,
  p_source_checksum_sha256 text default null,
  p_source_count integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.hris_source_systems%rowtype;
  v_id uuid;
begin
  select * into v_source from public.hris_source_systems where id = p_source_system_id;
  if not found or v_source.status not in ('pilot', 'active') then
    raise exception 'Active HRIS source system not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_phase3_admin(v_source.organization_id, 'workforce.import.manage');
  if p_source_checksum_sha256 is not null and p_source_checksum_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid source checksum' using errcode = '22023';
  end if;
  insert into public.hris_import_runs(
    organization_id, source_system_id, request_id, import_mode, mapping_version,
    source_cursor, source_checksum_sha256, source_count, started_by
  ) values (
    v_source.organization_id, v_source.id, btrim(p_request_id),
    coalesce(p_import_mode, v_source.import_mode), v_source.mapping_version,
    p_source_cursor, p_source_checksum_sha256, p_source_count,
    app_private.current_actor_profile_id()
  )
  on conflict (source_system_id, request_id) do update set
    request_id = excluded.request_id
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.stage_hris_import_row(
  p_import_run_id uuid,
  p_row_number integer,
  p_external_person_id text,
  p_external_employment_id text,
  p_source_payload_sha256 text,
  p_normalized_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.hris_import_runs%rowtype;
  v_existing public.hris_import_rows%rowtype;
  v_id uuid;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only a trusted import adapter may stage HRIS rows' using errcode = '42501';
  end if;
  select * into v_run from public.hris_import_runs where id = p_import_run_id for update;
  if not found or v_run.status <> 'staging' then
    raise exception 'HRIS run is not accepting staged rows' using errcode = '55000';
  end if;
  if p_source_payload_sha256 !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_normalized_payload) <> 'object' then
    raise exception 'Invalid normalized HRIS row' using errcode = '22023';
  end if;
  select * into v_existing from public.hris_import_rows
  where import_run_id = p_import_run_id and row_number = p_row_number;
  if found then
    if v_existing.source_payload_sha256 <> p_source_payload_sha256
       or v_existing.normalized_payload <> p_normalized_payload then
      raise exception 'Resumed HRIS row conflicts with retained content' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  insert into public.hris_import_rows(
    import_run_id, organization_id, source_system_id, row_number,
    external_person_id, external_employment_id, source_payload_sha256,
    normalized_payload
  ) values (
    v_run.id, v_run.organization_id, v_run.source_system_id, p_row_number,
    nullif(btrim(p_external_person_id), ''), nullif(btrim(p_external_employment_id), ''),
    p_source_payload_sha256, p_normalized_payload
  ) returning id into v_id;
  update public.hris_import_runs set staged_count = staged_count + 1 where id = v_run.id;
  return v_id;
end;
$$;

create or replace function public.validate_hris_import_run(p_import_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.hris_import_runs%rowtype;
  v_row public.hris_import_rows%rowtype;
  v_link public.hris_identity_links%rowtype;
  v_candidates uuid[];
  v_errors text[];
  v_review integer := 0;
  v_invalid integer := 0;
begin
  select * into v_run from public.hris_import_runs where id = p_import_run_id for update;
  if not found then raise exception 'HRIS run not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(v_run.organization_id, 'workforce.import.manage');
  if v_run.status not in ('staging', 'validated', 'blocked') then
    raise exception 'HRIS run cannot be revalidated in state %', v_run.status using errcode = '55000';
  end if;
  delete from public.hris_import_exceptions where import_run_id = v_run.id and status = 'open';
  for v_row in select * from public.hris_import_rows where import_run_id = v_run.id order by row_number for update
  loop
    v_errors := array[]::text[];
    if coalesce(v_row.normalized_payload->>'facilityId', '') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or not exists (
         select 1 from public.facilities f
         where f.id = (v_row.normalized_payload->>'facilityId')::uuid
           and f.organization_id = v_run.organization_id
       ) then v_errors := array_append(v_errors, 'invalid_facility'); end if;
    if length(btrim(coalesce(v_row.normalized_payload->>'firstName', ''))) = 0 then
      v_errors := array_append(v_errors, 'first_name_required');
    end if;
    if length(btrim(coalesce(v_row.normalized_payload->>'lastName', ''))) = 0 then
      v_errors := array_append(v_errors, 'last_name_required');
    end if;
    if length(btrim(coalesce(v_row.normalized_payload->>'jobTitle', ''))) = 0 then
      v_errors := array_append(v_errors, 'job_title_required');
    end if;

    select * into v_link from public.hris_identity_links l
    where l.source_system_id = v_run.source_system_id
      and l.effective_to is null
      and (l.external_person_id = v_row.external_person_id
        or l.external_employment_id = v_row.external_employment_id)
    order by l.created_at limit 1;
    if found then
      v_candidates := array[v_link.employee_id];
      update public.hris_import_rows set
        validation_status = case when cardinality(v_errors) = 0 then 'valid' else 'invalid' end,
        match_status = 'external_link', candidate_employee_ids = v_candidates,
        merge_decision = case when cardinality(v_errors) = 0 then 'link' else null end,
        decided_employee_id = case when cardinality(v_errors) = 0 then v_link.employee_id else null end,
        decision_reason = case when cardinality(v_errors) = 0 then 'Authoritative external identity link' else null end,
        error_codes = v_errors
      where id = v_row.id;
    else
      select coalesce(array_agg(e.id order by e.created_at, e.id), array[]::uuid[])
      into v_candidates
      from public.employees e
      where e.organization_id = v_run.organization_id and (
        (nullif(v_row.normalized_payload->>'employeeNumber', '') is not null
          and e.employee_number = v_row.normalized_payload->>'employeeNumber')
        or (nullif(v_row.normalized_payload->>'email', '') is not null
          and lower(e.email) = lower(v_row.normalized_payload->>'email'))
      );
      update public.hris_import_rows set
        validation_status = case when cardinality(v_errors) = 0 then 'valid' else 'invalid' end,
        match_status = case cardinality(v_candidates)
          when 0 then 'new_person' when 1 then 'candidate' else 'ambiguous' end,
        candidate_employee_ids = v_candidates,
        merge_decision = case when cardinality(v_errors) = 0 and cardinality(v_candidates) = 0 then 'create' else null end,
        decided_employee_id = null,
        decision_reason = case when cardinality(v_errors) = 0 and cardinality(v_candidates) = 0
          then 'No deterministic duplicate candidate' else null end,
        error_codes = v_errors
      where id = v_row.id;
      if cardinality(v_candidates) > 0 and cardinality(v_errors) = 0 then
        insert into public.hris_import_exceptions(
          organization_id, import_run_id, import_row_id, exception_code, severity, details
        ) values (
          v_run.organization_id, v_run.id, v_row.id,
          case when cardinality(v_candidates) = 1 then 'merge_decision_required' else 'ambiguous_match' end,
          'blocking', jsonb_build_object('candidateEmployeeIds', v_candidates)
        );
        v_review := v_review + 1;
      end if;
    end if;
    if cardinality(v_errors) > 0 then
      insert into public.hris_import_exceptions(
        organization_id, import_run_id, import_row_id, exception_code, severity, details
      ) values (
        v_run.organization_id, v_run.id, v_row.id, 'validation_failed', 'blocking',
        jsonb_build_object('errorCodes', v_errors)
      );
      v_invalid := v_invalid + 1;
    end if;
  end loop;
  update public.hris_import_runs set
    status = case when v_invalid > 0 or v_review > 0 then 'blocked' else 'validated' end,
    review_count = v_review, rejected_count = v_invalid, validated_at = now()
  where id = v_run.id;
  return jsonb_build_object(
    'runId', v_run.id, 'status', case when v_invalid > 0 or v_review > 0 then 'blocked' else 'validated' end,
    'stagedCount', v_run.staged_count, 'invalidCount', v_invalid, 'reviewCount', v_review
  );
end;
$$;

create or replace function public.set_hris_import_row_decision(
  p_import_row_id uuid,
  p_decision text,
  p_employee_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.hris_import_rows%rowtype;
begin
  select * into v_row from public.hris_import_rows where id = p_import_row_id for update;
  if not found then raise exception 'HRIS import row not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(v_row.organization_id, 'workforce.import.manage');
  if v_row.validation_status <> 'valid' or p_decision not in ('create', 'link', 'skip', 'reject') then
    raise exception 'Invalid HRIS merge decision' using errcode = '22023';
  end if;
  if p_decision = 'link' and (
    p_employee_id is null or not p_employee_id = any(v_row.candidate_employee_ids)
  ) then
    raise exception 'Linked employee must be an explicit duplicate candidate' using errcode = '23514';
  end if;
  if p_decision <> 'link' and p_employee_id is not null then
    raise exception 'Only link decisions accept an employee id' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A merge decision reason is required' using errcode = '22023';
  end if;
  update public.hris_import_rows set
    merge_decision = p_decision, decided_employee_id = p_employee_id,
    decision_reason = btrim(p_reason), decided_by = auth.uid(), decided_at = now()
  where id = p_import_row_id;
  update public.hris_import_exceptions set
    status = 'resolved', resolution = btrim(p_reason), resolved_by = auth.uid(), resolved_at = now()
  where import_row_id = p_import_row_id and status = 'open';
  return true;
end;
$$;

create or replace function public.apply_hris_import_batch(
  p_import_run_id uuid,
  p_batch_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.hris_import_runs%rowtype;
  v_row public.hris_import_rows%rowtype;
  v_employee public.employees%rowtype;
  v_employee_id uuid;
  v_person_id uuid;
  v_event_id uuid;
  v_status text;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('hris-import:' || p_import_run_id::text, 0));
  select * into v_run from public.hris_import_runs where id = p_import_run_id for update;
  if not found then raise exception 'HRIS run not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(v_run.organization_id, 'workforce.import.manage');
  if exists (
    select 1 from public.hris_import_rows
    where import_run_id = v_run.id and validation_status <> 'valid'
  ) or exists (
    select 1 from public.hris_import_rows
    where import_run_id = v_run.id and merge_decision is null
  ) then
    raise exception 'Every valid HRIS row requires a deterministic decision' using errcode = '55000';
  end if;
  update public.hris_import_runs set status = 'applying' where id = v_run.id;
  for v_row in
    select * from public.hris_import_rows
    where import_run_id = v_run.id and apply_status = 'pending'
    order by row_number
    limit least(greatest(p_batch_size, 1), 1000)
    for update skip locked
  loop
    begin
      v_event_id := null;
      if v_row.merge_decision in ('skip', 'reject') then
        update public.hris_import_rows set
          apply_status = case when v_row.merge_decision = 'skip' then 'skipped' else 'rejected' end,
          applied_at = now()
        where id = v_row.id;
        v_skipped := v_skipped + 1;
        continue;
      end if;
      if v_row.merge_decision = 'create' then
        insert into public.employees(
          organization_id, facility_id, employee_number, first_name, last_name,
          email, phone, hire_date, job_title, department, status
        ) values (
          v_run.organization_id, (v_row.normalized_payload->>'facilityId')::uuid,
          nullif(v_row.normalized_payload->>'employeeNumber', ''),
          btrim(v_row.normalized_payload->>'firstName'), btrim(v_row.normalized_payload->>'lastName'),
          nullif(v_row.normalized_payload->>'email', ''), nullif(v_row.normalized_payload->>'phone', ''),
          nullif(v_row.normalized_payload->>'hireDate', '')::date,
          btrim(v_row.normalized_payload->>'jobTitle'), nullif(v_row.normalized_payload->>'department', ''),
          case when v_row.normalized_payload->>'status' in ('active','inactive','terminated','on_leave')
            then v_row.normalized_payload->>'status' else 'active' end
        ) returning id into v_employee_id;
      else
        v_employee_id := v_row.decided_employee_id;
        select * into v_employee from public.employees where id = v_employee_id for update;
        if v_employee.organization_id <> v_run.organization_id then
          raise exception 'HRIS decision crossed tenant boundary' using errcode = '42501';
        end if;
        update public.employees set
          employee_number = coalesce(nullif(v_row.normalized_payload->>'employeeNumber', ''), employee_number),
          first_name = btrim(v_row.normalized_payload->>'firstName'),
          last_name = btrim(v_row.normalized_payload->>'lastName'),
          email = coalesce(nullif(v_row.normalized_payload->>'email', ''), email),
          phone = coalesce(nullif(v_row.normalized_payload->>'phone', ''), phone),
          job_title = btrim(v_row.normalized_payload->>'jobTitle'),
          department = coalesce(nullif(v_row.normalized_payload->>'department', ''), department)
        where id = v_employee_id;
        if v_employee.facility_id <> (v_row.normalized_payload->>'facilityId')::uuid then
          v_event_id := public.apply_employee_lifecycle_transition(
            v_employee_id, 'transfer', current_date,
            (v_row.normalized_payload->>'facilityId')::uuid,
            'HRIS import ' || v_run.request_id
          );
        end if;
        v_status := coalesce(v_row.normalized_payload->>'status', v_employee.status);
        if v_status = 'terminated' and v_employee.status <> 'terminated' then
          v_event_id := public.apply_employee_lifecycle_transition(
            v_employee_id, 'terminate', current_date, null,
            'HRIS import ' || v_run.request_id
          );
        elsif v_status = 'on_leave' and v_employee.status = 'active' then
          v_event_id := public.apply_employee_lifecycle_transition(
            v_employee_id, 'leave', current_date, null,
            'HRIS import ' || v_run.request_id
          );
        elsif v_status = 'active' and v_employee.status = 'on_leave' then
          v_event_id := public.apply_employee_lifecycle_transition(
            v_employee_id, 'return', current_date, null,
            'HRIS import ' || v_run.request_id
          );
        end if;
      end if;
      select person_id into v_person_id from public.workforce_employee_links
      where employee_id = v_employee_id and effective_to is null
      order by effective_from desc limit 1;
      insert into public.hris_identity_links(
        organization_id, source_system_id, external_person_id,
        external_employment_id, person_id, employee_id, source_checksum_sha256
      ) values (
        v_run.organization_id, v_run.source_system_id,
        coalesce(v_row.external_person_id, 'row-person:' || v_row.id),
        coalesce(v_row.external_employment_id, 'row-employment:' || v_row.id),
        v_person_id, v_employee_id, v_row.source_payload_sha256
      ) on conflict do nothing;
      update public.hris_import_rows set
        apply_status = 'applied', applied_employee_id = v_employee_id,
        applied_lifecycle_event_id = v_event_id, applied_at = now()
      where id = v_row.id;
      v_applied := v_applied + 1;
    exception when others then
      update public.hris_import_rows set
        apply_status = 'failed', error_detail = sqlstate || ': ' || sqlerrm
      where id = v_row.id;
      v_failed := v_failed + 1;
    end;
  end loop;
  update public.hris_import_runs r set
    applied_count = (select count(*) from public.hris_import_rows x where x.import_run_id = r.id and x.apply_status = 'applied'),
    rejected_count = (select count(*) from public.hris_import_rows x where x.import_run_id = r.id and x.apply_status in ('rejected','failed')),
    resume_after_row = coalesce((select max(x.row_number) from public.hris_import_rows x where x.import_run_id = r.id and x.apply_status <> 'pending'), 0),
    status = case
      when exists (select 1 from public.hris_import_rows x where x.import_run_id = r.id and x.apply_status = 'pending') then 'applying'
      when exists (select 1 from public.hris_import_rows x where x.import_run_id = r.id and x.apply_status = 'failed') then 'failed'
      else 'applied' end,
    completed_at = case when not exists (
      select 1 from public.hris_import_rows x where x.import_run_id = r.id and x.apply_status = 'pending'
    ) then now() else null end
  where r.id = v_run.id;
  return jsonb_build_object('runId', v_run.id, 'applied', v_applied, 'skipped', v_skipped, 'failed', v_failed);
end;
$$;

create or replace function public.employee_has_active_qualification(
  p_employee_id uuid,
  p_qualification_key text,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employee_qualifications q
    join public.certification_definitions d on d.id = q.certification_definition_id
    where q.employee_id = p_employee_id
      and d.qualification_key = p_qualification_key
      and q.state = 'active'
      and q.effective_from <= p_at
      and (q.effective_to is null or q.effective_to > p_at)
      and (q.expires_at is null or q.expires_at > p_at)
  );
$$;

create or replace function public.approve_certification_attempt(
  p_attempt_id uuid,
  p_decision text,
  p_reason text,
  p_assessor_signature_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.certification_attempts%rowtype;
  v_version public.certification_definition_versions%rowtype;
  v_definition public.certification_definitions%rowtype;
  v_qualification_id uuid;
  v_expiry timestamptz;
begin
  select * into v_attempt from public.certification_attempts where id = p_attempt_id for update;
  if not found then raise exception 'Certification attempt not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(v_attempt.organization_id, 'qualifications.manage', v_attempt.facility_id);
  if v_attempt.status not in ('in_progress', 'submitted') or p_decision not in ('passed', 'failed') then
    raise exception 'Invalid certification decision transition' using errcode = '55000';
  end if;
  if auth.uid() <> v_attempt.assessor_profile_id then
    raise exception 'Only the assigned qualified assessor may decide this attempt' using errcode = '42501';
  end if;
  select * into v_version from public.certification_definition_versions
  where id = v_attempt.certification_version_id;
  select * into v_definition from public.certification_definitions
  where id = v_version.certification_definition_id;
  if v_version.lifecycle_state <> 'published'
     or v_version.effective_from is null or v_version.effective_from > v_attempt.observed_at
     or (v_version.effective_to is not null and v_version.effective_to <= v_attempt.observed_at) then
    raise exception 'Attempt did not use an effective published checklist version' using errcode = '23514';
  end if;
  if v_definition.separation_of_duties and exists (
    select 1 from public.employees e
    where e.id = v_attempt.employee_id and e.profile_id = auth.uid()
  ) then
    raise exception 'Self-assessment is prohibited for this certification' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.assessor_qualifications a
    where a.certification_definition_id = v_definition.id
      and a.assessor_profile_id = auth.uid()
      and a.effective_from <= v_attempt.observed_at
      and (a.effective_to is null or a.effective_to > v_attempt.observed_at)
  ) then
    raise exception 'Assessor was not qualified at observation time' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.certification_checklist_items i
    left join public.certification_attempt_items ai
      on ai.checklist_item_id = i.id and ai.certification_attempt_id = v_attempt.id
    where i.certification_version_id = v_version.id
      and (ai.id is null
        or i.evidence_required and ai.evidence = '{}'::jsonb
        or i.signature_required and ai.signed_at is null)
  ) then
    raise exception 'Required checklist evidence or signature is missing' using errcode = '23514';
  end if;
  if p_assessor_signature_sha256 !~ '^[0-9a-f]{64}$' or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Signed decision evidence and reason are required' using errcode = '22023';
  end if;
  update public.certification_attempts set
    status = p_decision, decided_at = now(), decision_reason = btrim(p_reason),
    assessor_signature_sha256 = p_assessor_signature_sha256,
    evidence_checksum_sha256 = encode(extensions.digest(convert_to(jsonb_build_object(
      'attemptId', id, 'versionChecksum', v_version.criteria_checksum_sha256,
      'decision', p_decision, 'reason', btrim(p_reason),
      'signature', p_assessor_signature_sha256
    )::text, 'utf8'), 'sha256'), 'hex')
  where id = v_attempt.id;
  if p_decision = 'failed' then return null; end if;
  v_expiry := case when v_definition.default_validity_days is null then null
    else v_attempt.observed_at + make_interval(days => v_definition.default_validity_days) end;
  update public.employee_qualifications set
    state = 'superseded', effective_to = now(), state_reason = 'Superseded by certification attempt ' || v_attempt.id
  where employee_id = v_attempt.employee_id
    and certification_definition_id = v_definition.id
    and effective_to is null;
  insert into public.employee_qualifications(
    organization_id, facility_id, employee_id, certification_definition_id,
    certification_version_id, source_attempt_id, state, issued_at,
    effective_from, expires_at, renewal_window_opens_at, approved_by
  ) values (
    v_attempt.organization_id, v_attempt.facility_id, v_attempt.employee_id,
    v_definition.id, v_version.id, v_attempt.id, 'active', now(),
    v_attempt.observed_at, v_expiry,
    case when v_expiry is null then null else v_expiry - make_interval(days => v_definition.renewal_window_days) end,
    auth.uid()
  ) returning id into v_qualification_id;
  insert into public.qualification_lifecycle_events(
    organization_id, employee_qualification_id, event_type, resulting_state,
    reason, actor_profile_id, evidence
  ) values (
    v_attempt.organization_id, v_qualification_id, 'issued', 'active',
    btrim(p_reason), auth.uid(), jsonb_build_object(
      'attemptId', v_attempt.id, 'criteriaChecksum', v_version.criteria_checksum_sha256
    )
  );
  insert into public.notifications(
    organization_id, profile_id, notification_type, title, body, link
  )
  select v_attempt.organization_id, e.profile_id, 'qualification_changed',
    'Qualification approved', v_definition.name || ' is active.', '/app/credentials'
  from public.employees e where e.id = v_attempt.employee_id and e.profile_id is not null;
  return v_qualification_id;
end;
$$;

create or replace function public.set_employee_qualification_state(
  p_qualification_id uuid,
  p_state text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.employee_qualifications%rowtype;
  v_event text;
begin
  select * into v_row from public.employee_qualifications where id = p_qualification_id for update;
  if not found then raise exception 'Qualification not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(v_row.organization_id, 'qualifications.manage', v_row.facility_id);
  if p_state not in ('active', 'suspended', 'revoked') or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Invalid qualification state transition' using errcode = '22023';
  end if;
  if v_row.state = 'revoked' or v_row.effective_to is not null then
    raise exception 'Terminal qualification evidence cannot be reopened' using errcode = '55000';
  end if;
  v_event := case p_state when 'active' then 'restored' when 'suspended' then 'suspended' else 'revoked' end;
  update public.employee_qualifications set
    state = p_state,
    effective_to = case when p_state = 'revoked' then now() else null end,
    state_reason = btrim(p_reason)
  where id = v_row.id;
  insert into public.qualification_lifecycle_events(
    organization_id, employee_qualification_id, event_type, prior_state,
    resulting_state, reason, actor_profile_id
  ) values (
    v_row.organization_id, v_row.id, v_event, v_row.state,
    p_state, btrim(p_reason), auth.uid()
  );
  return true;
end;
$$;

create or replace function public.create_credential_renewal_submission(
  p_employee_id uuid,
  p_credential_id uuid,
  p_credential_document_id uuid,
  p_credential_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
  if not (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.id = v_employee.profile_id)
    or public.is_platform_admin()
    or public.current_org_id() = v_employee.organization_id and public.current_role() in ('org_admin','facility_manager')
  ) then
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
$$;

create or replace function public.record_credential_renewal_extraction(
  p_submission_id uuid,
  p_scan_status text,
  p_scan_provider text,
  p_scan_evidence jsonb,
  p_extraction_provider text,
  p_extraction_model text,
  p_extracted_fields jsonb,
  p_confidence jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only the trusted document processor may record extraction' using errcode = '42501';
  end if;
  if p_scan_status not in ('clean', 'malicious', 'failed') then
    raise exception 'Invalid malware scan result' using errcode = '22023';
  end if;
  update public.credential_renewal_submissions set
    scan_status = p_scan_status, scan_provider = nullif(btrim(p_scan_provider), ''),
    scan_evidence = coalesce(p_scan_evidence, '{}'::jsonb),
    extraction_provider = nullif(btrim(p_extraction_provider), ''),
    extraction_model = nullif(btrim(p_extraction_model), ''),
    extracted_fields = case when p_scan_status = 'clean' then coalesce(p_extracted_fields, '{}'::jsonb) else '{}'::jsonb end,
    extraction_confidence = case when p_scan_status = 'clean' then coalesce(p_confidence, '{}'::jsonb) else '{}'::jsonb end,
    status = case when p_scan_status = 'clean' then 'needs_review' else 'quarantined' end
  where id = p_submission_id and status in ('uploaded', 'scanning');
  if not found then raise exception 'Submission is not awaiting extraction' using errcode = '55000'; end if;
  return true;
end;
$$;

create or replace function public.review_credential_renewal_submission(
  p_submission_id uuid,
  p_decision text,
  p_confirmed_fields jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.credential_renewal_submissions%rowtype;
  v_credential_id uuid;
begin
  select * into v_submission from public.credential_renewal_submissions
  where id = p_submission_id for update;
  if not found then raise exception 'Credential renewal submission not found' using errcode = 'P0002'; end if;
  perform app_private.assert_phase3_admin(
    v_submission.organization_id, 'credentials.renewal.review', v_submission.facility_id
  );
  if v_submission.status <> 'needs_review' or v_submission.scan_status <> 'clean'
     or p_decision not in ('approve', 'reject')
     or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Credential renewal is not ready for a human decision' using errcode = '55000';
  end if;
  if auth.uid() = v_submission.submitted_by then
    raise exception 'Credential renewal requires an independent reviewer' using errcode = '42501';
  end if;
  if p_decision = 'reject' then
    update public.credential_renewal_submissions set
      status = 'rejected', human_confirmed_fields = coalesce(p_confirmed_fields, '{}'::jsonb),
      reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason)
    where id = v_submission.id;
    return null;
  end if;
  if jsonb_typeof(p_confirmed_fields) <> 'object'
     or length(btrim(coalesce(p_confirmed_fields->>'issuingAuthority', ''))) = 0
     or coalesce(p_confirmed_fields->>'expirationDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Human-confirmed issuer and expiration date are required' using errcode = '22023';
  end if;
  if v_submission.credential_id is null then
    insert into public.employee_credentials(
      organization_id, facility_id, employee_id, credential_type,
      credential_label, issuing_authority, credential_number, issue_date,
      expiration_date, status, verification_method, verified_by_profile_id, verified_at
    ) values (
      v_submission.organization_id, v_submission.facility_id, v_submission.employee_id,
      v_submission.credential_type, nullif(p_confirmed_fields->>'credentialLabel', ''),
      btrim(p_confirmed_fields->>'issuingAuthority'), nullif(p_confirmed_fields->>'credentialNumber', ''),
      nullif(p_confirmed_fields->>'issueDate', '')::date,
      (p_confirmed_fields->>'expirationDate')::date,
      case when (p_confirmed_fields->>'expirationDate')::date > current_date then 'compliant' else 'expired' end,
      'human_reviewed_ocr', auth.uid(), now()
    ) returning id into v_credential_id;
  else
    update public.employee_credentials set
      issuing_authority = btrim(p_confirmed_fields->>'issuingAuthority'),
      credential_number = nullif(p_confirmed_fields->>'credentialNumber', ''),
      issue_date = nullif(p_confirmed_fields->>'issueDate', '')::date,
      expiration_date = (p_confirmed_fields->>'expirationDate')::date,
      status = case when (p_confirmed_fields->>'expirationDate')::date > current_date then 'compliant' else 'expired' end,
      verification_method = 'human_reviewed_ocr',
      verified_by_profile_id = auth.uid(), verified_at = now()
    where id = v_submission.credential_id and employee_id = v_submission.employee_id
    returning id into v_credential_id;
    if v_credential_id is null then
      raise exception 'Credential does not belong to the submitted employee' using errcode = '23514';
    end if;
  end if;
  update public.credential_renewal_submissions set
    status = 'approved', human_confirmed_fields = p_confirmed_fields,
    reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason),
    approved_credential_id = v_credential_id
  where id = v_submission.id;
  insert into public.notifications(
    organization_id, profile_id, notification_type, title, body, link
  )
  select v_submission.organization_id, e.profile_id, 'credential_renewal_changed',
    'Credential renewal approved', 'Your reviewed credential renewal is now effective.',
    '/app/credentials'
  from public.employees e where e.id = v_submission.employee_id and e.profile_id is not null;
  return v_credential_id;
end;
$$;

create or replace function app_private.prevent_phase3_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Phase 3 evidence is append-only' using errcode = '55000';
end;
$$;
revoke all on function app_private.prevent_phase3_evidence_mutation()
from public, anon, authenticated, service_role;

create trigger prevent_hris_identity_link_mutation
before update or delete on public.hris_identity_links
for each row execute function app_private.prevent_phase3_evidence_mutation();
create trigger prevent_qualification_event_mutation
before update or delete on public.qualification_lifecycle_events
for each row execute function app_private.prevent_phase3_evidence_mutation();

create or replace function app_private.guard_phase3_governance_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'certification_definitions' and exists (
    select 1 from public.certification_definition_versions v
    where v.certification_definition_id = old.id and v.lifecycle_state <> 'draft'
  ) then
    raise exception 'Published certification definitions must be retired, not deleted'
      using errcode = '55000';
  end if;
  if tg_table_name = 'assessor_qualifications' then
    raise exception 'Assessor authority is effective-dated and cannot be deleted'
      using errcode = '55000';
  end if;
  return old;
end;
$$;
revoke all on function app_private.guard_phase3_governance_delete()
from public, anon, authenticated, service_role;
create trigger guard_certification_definition_delete
before delete on public.certification_definitions
for each row execute function app_private.guard_phase3_governance_delete();
create trigger guard_assessor_qualification_delete
before delete on public.assessor_qualifications
for each row execute function app_private.guard_phase3_governance_delete();

alter table public.hris_source_systems enable row level security;
alter table public.hris_import_runs enable row level security;
alter table public.hris_identity_links enable row level security;
alter table public.hris_import_rows enable row level security;
alter table public.hris_import_exceptions enable row level security;
alter table public.certification_definitions enable row level security;
alter table public.certification_definition_versions enable row level security;
alter table public.certification_checklist_items enable row level security;
alter table public.assessor_qualifications enable row level security;
alter table public.certification_attempts enable row level security;
alter table public.certification_attempt_items enable row level security;
alter table public.employee_qualifications enable row level security;
alter table public.qualification_lifecycle_events enable row level security;
alter table public.credential_renewal_submissions enable row level security;

create policy hris_source_systems_select on public.hris_source_systems
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);
create policy hris_source_systems_manage on public.hris_source_systems
for all to authenticated using (
  (select public.identity_assurance_is_current('workforce_admin'))
  and ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and ((select public.current_role()) = 'org_admin'
      or public.has_effective_permission('workforce.import.manage', 'organization', organization_id, now()))
  ))
) with check (
  (select public.identity_assurance_is_current('workforce_admin'))
  and ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and ((select public.current_role()) = 'org_admin'
      or public.has_effective_permission('workforce.import.manage', 'organization', organization_id, now()))
  ))
);
create policy hris_import_runs_select on public.hris_import_runs
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);
create policy hris_identity_links_select on public.hris_identity_links
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);
create policy hris_import_rows_select on public.hris_import_rows
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);
create policy hris_import_exceptions_select on public.hris_import_exceptions
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);

create policy certification_definitions_select on public.certification_definitions
for select to authenticated using (
  organization_id is null or (select public.is_platform_admin())
  or organization_id = (select public.current_org_id())
);
create policy certification_definitions_manage on public.certification_definitions
for all to authenticated using (
  organization_id is not null
  and (select public.identity_assurance_is_current('workforce_admin'))
  and ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and ((select public.current_role()) = 'org_admin'
      or public.has_effective_permission('qualifications.manage', 'organization', organization_id, now()))
  ))
) with check (
  organization_id is not null
  and (select public.identity_assurance_is_current('workforce_admin'))
  and ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and ((select public.current_role()) = 'org_admin'
      or public.has_effective_permission('qualifications.manage', 'organization', organization_id, now()))
  ))
);
create policy certification_versions_select on public.certification_definition_versions
for select to authenticated using (
  exists (
    select 1 from public.certification_definitions d
    where d.id = certification_definition_id
  )
);
create policy certification_versions_manage on public.certification_definition_versions
for all to authenticated using (
  lifecycle_state = 'draft' and exists (
    select 1 from public.certification_definitions d
    where d.id = certification_definition_id and d.organization_id is not null
      and ((select public.is_platform_admin()) or d.organization_id = (select public.current_org_id()))
      and (select public.identity_assurance_is_current('workforce_admin'))
  )
) with check (
  lifecycle_state in ('draft', 'published') and exists (
    select 1 from public.certification_definitions d
    where d.id = certification_definition_id and d.organization_id is not null
      and ((select public.is_platform_admin()) or d.organization_id = (select public.current_org_id()))
      and (select public.identity_assurance_is_current('workforce_admin'))
  )
);
create policy certification_checklist_select on public.certification_checklist_items
for select to authenticated using (
  exists (
    select 1 from public.certification_definition_versions v
    where v.id = certification_version_id
  )
);
create policy certification_checklist_manage on public.certification_checklist_items
for all to authenticated using (
  exists (
    select 1 from public.certification_definition_versions v
    join public.certification_definitions d on d.id = v.certification_definition_id
    where v.id = certification_version_id and v.lifecycle_state = 'draft'
      and d.organization_id is not null
      and ((select public.is_platform_admin()) or d.organization_id = (select public.current_org_id()))
      and (select public.identity_assurance_is_current('workforce_admin'))
  )
) with check (
  exists (
    select 1 from public.certification_definition_versions v
    join public.certification_definitions d on d.id = v.certification_definition_id
    where v.id = certification_version_id and v.lifecycle_state = 'draft'
      and d.organization_id is not null
      and ((select public.is_platform_admin()) or d.organization_id = (select public.current_org_id()))
      and (select public.identity_assurance_is_current('workforce_admin'))
  )
);
create policy assessor_qualifications_select on public.assessor_qualifications
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
  or assessor_profile_id = (select auth.uid())
);
create policy assessor_qualifications_manage on public.assessor_qualifications
for all to authenticated using (
  (select public.identity_assurance_is_current('workforce_admin'))
  and ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager')
  ))
) with check (
  (select public.identity_assurance_is_current('workforce_admin'))
  and ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager')
  ))
);
create policy certification_attempts_select on public.certification_attempts
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
  or employee_id in (select e.id from public.employees e where e.profile_id = (select auth.uid()))
);
create policy certification_attempts_manage on public.certification_attempts
for insert to authenticated with check (
  status = 'in_progress'
  and ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()))
  and (
    assessor_profile_id = (select auth.uid())
    or (select public.identity_assurance_is_current('workforce_admin'))
  )
);
create policy certification_attempts_update on public.certification_attempts
for update to authenticated using (
  status in ('in_progress', 'submitted')
  and assessor_profile_id = (select auth.uid())
) with check (
  status in ('in_progress', 'submitted')
  and assessor_profile_id = (select auth.uid())
);
create policy certification_attempt_items_select on public.certification_attempt_items
for select to authenticated using (
  exists (select 1 from public.certification_attempts a where a.id = certification_attempt_id)
);
create policy certification_attempt_items_manage on public.certification_attempt_items
for all to authenticated using (
  exists (
    select 1 from public.certification_attempts a
    where a.id = certification_attempt_id and a.assessor_profile_id = (select auth.uid())
      and a.status in ('in_progress', 'submitted')
  )
) with check (
  exists (
    select 1 from public.certification_attempts a
    where a.id = certification_attempt_id and a.assessor_profile_id = (select auth.uid())
      and a.status in ('in_progress', 'submitted')
  )
);
create policy employee_qualifications_select on public.employee_qualifications
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
  or employee_id in (select e.id from public.employees e where e.profile_id = (select auth.uid()))
);
create policy qualification_events_select on public.qualification_lifecycle_events
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
  or exists (
    select 1 from public.employee_qualifications q
    join public.employees e on e.id = q.employee_id
    where q.id = employee_qualification_id and e.profile_id = (select auth.uid())
  )
);
create policy credential_renewal_select on public.credential_renewal_submissions
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
  or employee_id in (select e.id from public.employees e where e.profile_id = (select auth.uid()))
);

revoke all on table
  public.hris_source_systems, public.hris_import_runs, public.hris_identity_links,
  public.hris_import_rows, public.hris_import_exceptions,
  public.certification_definitions, public.certification_definition_versions,
  public.certification_checklist_items, public.assessor_qualifications,
  public.certification_attempts, public.certification_attempt_items,
  public.employee_qualifications, public.qualification_lifecycle_events,
  public.credential_renewal_submissions
from public, anon, authenticated, service_role;

grant select, insert, update on table public.hris_source_systems to authenticated;
grant select on table public.hris_import_runs, public.hris_identity_links,
  public.hris_import_rows, public.hris_import_exceptions to authenticated;
grant select, insert, update on table public.certification_definitions,
  public.certification_definition_versions, public.certification_checklist_items,
  public.assessor_qualifications, public.certification_attempts,
  public.certification_attempt_items to authenticated;
grant delete on table public.hris_source_systems,
  public.certification_definitions, public.certification_definition_versions,
  public.certification_checklist_items, public.assessor_qualifications,
  public.certification_attempt_items to authenticated;
grant select on table public.employee_qualifications,
  public.qualification_lifecycle_events, public.credential_renewal_submissions
to authenticated;

grant select, insert, update, delete on table
  public.hris_source_systems, public.hris_import_runs, public.hris_import_rows,
  public.hris_import_exceptions, public.certification_attempts,
  public.certification_attempt_items, public.credential_renewal_submissions
to service_role;
grant select, insert on table public.hris_identity_links,
  public.employee_qualifications, public.qualification_lifecycle_events
to service_role;

revoke all on function public.create_hris_import_run(uuid,text,text,text,text,integer),
  public.stage_hris_import_row(uuid,integer,text,text,text,jsonb),
  public.validate_hris_import_run(uuid),
  public.set_hris_import_row_decision(uuid,text,uuid,text),
  public.apply_hris_import_batch(uuid,integer),
  public.employee_has_active_qualification(uuid,text,timestamptz),
  public.approve_certification_attempt(uuid,text,text,text),
  public.set_employee_qualification_state(uuid,text,text),
  public.create_credential_renewal_submission(uuid,uuid,uuid,text),
  public.record_credential_renewal_extraction(uuid,text,text,jsonb,text,text,jsonb,jsonb),
  public.review_credential_renewal_submission(uuid,text,jsonb,text)
from public, anon, authenticated, service_role;

grant execute on function public.create_hris_import_run(uuid,text,text,text,text,integer),
  public.validate_hris_import_run(uuid),
  public.set_hris_import_row_decision(uuid,text,uuid,text),
  public.apply_hris_import_batch(uuid,integer),
  public.employee_has_active_qualification(uuid,text,timestamptz),
  public.approve_certification_attempt(uuid,text,text,text),
  public.set_employee_qualification_state(uuid,text,text),
  public.create_credential_renewal_submission(uuid,uuid,uuid,text),
  public.review_credential_renewal_submission(uuid,text,jsonb,text)
to authenticated;
grant execute on function public.create_hris_import_run(uuid,text,text,text,text,integer),
  public.stage_hris_import_row(uuid,integer,text,text,text,jsonb),
  public.validate_hris_import_run(uuid),
  public.apply_hris_import_batch(uuid,integer),
  public.employee_has_active_qualification(uuid,text,timestamptz),
  public.record_credential_renewal_extraction(uuid,text,text,jsonb,text,text,jsonb,jsonb)
to service_role;

insert into app_private.audit_entity_manifest(
  table_name, audit_mode, contains_regulated_data, rationale
)
select table_name, audit_mode, true, rationale
from (values
  ('hris_source_systems', 'row_trigger', 'Phase 3 HRIS source governance'),
  ('hris_import_runs', 'row_trigger', 'Resumable import reconciliation'),
  ('hris_identity_links', 'domain_evidence', 'Immutable external identity linkage'),
  ('hris_import_rows', 'row_trigger', 'Normalized import decision evidence'),
  ('hris_import_exceptions', 'row_trigger', 'Visible import exception queue'),
  ('certification_definitions', 'row_trigger', 'Qualification definition governance'),
  ('certification_definition_versions', 'row_trigger', 'Versioned certification criteria'),
  ('certification_checklist_items', 'row_trigger', 'Versioned observation checklist'),
  ('assessor_qualifications', 'row_trigger', 'Effective assessor authority'),
  ('certification_attempts', 'row_trigger', 'Signed certification decision'),
  ('certification_attempt_items', 'row_trigger', 'Observed checklist evidence'),
  ('employee_qualifications', 'row_trigger', 'Effective qualification state'),
  ('qualification_lifecycle_events', 'domain_evidence', 'Append-only qualification lifecycle'),
  ('credential_renewal_submissions', 'row_trigger', 'Human-reviewed OCR renewal evidence')
) v(table_name, audit_mode, rationale)
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'hris_source_systems', 'hris_import_runs', 'hris_import_rows',
    'hris_import_exceptions', 'certification_definitions',
    'certification_definition_versions', 'certification_checklist_items',
    'assessor_qualifications', 'certification_attempts',
    'certification_attempt_items', 'employee_qualifications',
    'credential_renewal_submissions'
  ] loop
    execute format(
      'create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()',
      v_table
    );
  end loop;
end;
$$;

comment on table public.hris_import_rows is
  'Normalized, checksummed HRIS rows. Candidate matches always require an explicit human merge decision.';
comment on table public.credential_renewal_submissions is
  'OCR and malware-scan output are suggestions only; approved state requires an authenticated independent reviewer.';
