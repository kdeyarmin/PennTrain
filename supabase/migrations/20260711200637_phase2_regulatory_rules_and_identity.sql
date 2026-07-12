-- Phase 2: governed regulatory rules and enterprise identity lifecycle.
--
-- This migration deliberately keeps enforceable rules immutable, separates
-- authors from approvers, retains every fixture/shadow decision, and makes the
-- provider subject UUID (not an email address) authoritative for identity.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Governed regulatory rule packs
-- ---------------------------------------------------------------------------

create table public.regulatory_rule_packs (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique check (rule_key ~ '^[a-z0-9][a-z0-9_.-]{2,99}$'),
  name text not null check (length(btrim(name)) between 3 and 200),
  description text,
  owner_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.regulatory_rule_packs
  for each row execute function public.set_updated_at();

create table public.regulatory_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_pack_id uuid not null references public.regulatory_rule_packs(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  state text not null default 'draft' check (state in (
    'draft', 'review', 'approved', 'shadow', 'active', 'superseded', 'withdrawn'
  )),
  jurisdiction_code text not null check (length(btrim(jurisdiction_code)) between 2 and 50),
  authority_name text not null check (length(btrim(authority_name)) between 2 and 300),
  citation text not null check (length(btrim(citation)) between 2 and 500),
  source_uri text,
  source_checksum_sha256 text not null check (source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  applicability jsonb not null default '{}'::jsonb check (jsonb_typeof(applicability) = 'object'),
  calculation_parameters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(calculation_parameters) = 'object'),
  effective_from date not null,
  effective_to date,
  supersedes_version_id uuid references public.regulatory_rule_versions(id) on delete restrict,
  content_checksum_sha256 text not null check (content_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  release_notes text not null check (length(btrim(release_notes)) > 0),
  authored_by uuid not null references public.profiles(id),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  review_notes text,
  approved_at timestamptz,
  shadow_started_at timestamptz,
  activated_at timestamptz,
  superseded_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.profiles(id),
  withdrawal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_pack_id, version_number),
  unique (rule_pack_id, content_checksum_sha256),
  check (effective_to is null or effective_to >= effective_from),
  check (supersedes_version_id is null or supersedes_version_id <> id),
  check (reviewed_by is null or reviewed_by <> authored_by),
  check ((state = 'draft') or (submitted_by is not null and submitted_at is not null)),
  check ((state not in ('approved', 'shadow', 'active', 'superseded')) or
    (reviewed_by is not null and approved_at is not null)),
  check ((state <> 'shadow') or shadow_started_at is not null),
  check ((state <> 'active') or activated_at is not null),
  check ((state <> 'superseded') or superseded_at is not null),
  check ((state <> 'withdrawn') or
    (withdrawn_at is not null and withdrawn_by is not null and length(btrim(withdrawal_reason)) > 0))
);

create unique index regulatory_rule_versions_one_active_idx
  on public.regulatory_rule_versions(rule_pack_id)
  where state = 'active';
create index regulatory_rule_versions_historic_idx
  on public.regulatory_rule_versions(rule_pack_id, effective_from desc, version_number desc)
  where state in ('active', 'superseded');
create index regulatory_rule_versions_state_idx
  on public.regulatory_rule_versions(state, updated_at desc);

create trigger set_updated_at before update on public.regulatory_rule_versions
  for each row execute function public.set_updated_at();

create table public.regulatory_rule_golden_fixtures (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid not null references public.regulatory_rule_versions(id) on delete restrict,
  fixture_key text not null check (fixture_key ~ '^[a-z0-9][a-z0-9_.-]{1,99}$'),
  facility_type text not null check (facility_type in ('PCH', 'ALR')),
  workforce_profile_key text not null,
  boundary_date date not null,
  input_payload jsonb not null check (jsonb_typeof(input_payload) = 'object'),
  expected_result jsonb not null,
  fixture_checksum_sha256 text not null check (fixture_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (rule_version_id, fixture_key),
  unique (rule_version_id, fixture_checksum_sha256)
);

create table public.regulatory_rule_fixture_runs (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid not null references public.regulatory_rule_versions(id) on delete restrict,
  fixture_id uuid not null references public.regulatory_rule_golden_fixtures(id) on delete restrict,
  engine_version text not null,
  actual_result_checksum_sha256 text not null
    check (actual_result_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  passed boolean not null,
  failure_detail text,
  executed_at timestamptz not null default now(),
  executed_by uuid references public.profiles(id),
  request_id text not null,
  unique (fixture_id, engine_version, request_id)
);

create index regulatory_rule_fixture_runs_latest_idx
  on public.regulatory_rule_fixture_runs(fixture_id, executed_at desc, id desc);

create table public.regulatory_rule_shadow_runs (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid not null references public.regulatory_rule_versions(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  facility_type text not null check (facility_type in ('PCH', 'ALR')),
  baseline_version_id uuid references public.regulatory_rule_versions(id) on delete restrict,
  cohort_started_at timestamptz not null,
  cohort_ended_at timestamptz not null,
  evaluated_count integer not null check (evaluated_count >= 0),
  difference_count integer not null check (difference_count >= 0 and difference_count <= evaluated_count),
  engine_version text not null,
  result_checksum_sha256 text not null check (result_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz not null default now(),
  recorded_by uuid references public.profiles(id),
  request_id text not null,
  created_at timestamptz not null default now(),
  unique (rule_version_id, organization_id, request_id),
  check (cohort_ended_at >= cohort_started_at)
);

create index regulatory_rule_shadow_runs_activation_idx
  on public.regulatory_rule_shadow_runs(rule_version_id, cohort_started_at, completed_at);

create table public.regulatory_rule_shadow_differences (
  id uuid primary key default gen_random_uuid(),
  shadow_run_id uuid not null references public.regulatory_rule_shadow_runs(id) on delete restrict,
  subject_reference text not null,
  baseline_result jsonb,
  candidate_result jsonb,
  difference_checksum_sha256 text not null check (difference_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (shadow_run_id, subject_reference),
  unique (shadow_run_id, difference_checksum_sha256)
);

create table public.regulatory_rule_shadow_reconciliations (
  id uuid primary key default gen_random_uuid(),
  difference_id uuid not null references public.regulatory_rule_shadow_differences(id) on delete restrict,
  resolution text not null check (resolution in ('expected_change', 'baseline_defect', 'candidate_defect')),
  rationale text not null check (length(btrim(rationale)) >= 10),
  evidence_checksum_sha256 text not null check (evidence_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  reconciled_by uuid not null references public.profiles(id),
  reconciled_at timestamptz not null default now(),
  unique (difference_id)
);

-- ---------------------------------------------------------------------------
-- Verified enterprise identity and SCIM lifecycle
-- ---------------------------------------------------------------------------

create table public.organization_identity_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  domain text not null check (
    domain = lower(domain)
    and domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'revoked')),
  verification_challenge_sha256 text not null
    check (verification_challenge_sha256 ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revocation_reason text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain),
  -- Automated DNS verification has no profile actor; verified_by is populated
  -- when an AAL2 administrator performs the same check interactively.
  check ((verification_status <> 'verified') or verified_at is not null),
  check ((verification_status <> 'revoked') or
    (revoked_at is not null and revoked_by is not null and length(btrim(revocation_reason)) > 0))
);

create index organization_identity_domains_org_idx
  on public.organization_identity_domains(organization_id, verification_status);
create trigger set_updated_at before update on public.organization_identity_domains
  for each row execute function public.set_updated_at();

create table public.organization_sso_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  identity_domain_id uuid not null references public.organization_identity_domains(id) on delete restrict,
  provider text not null check (provider in ('saml', 'oidc')),
  provider_connection_id text not null,
  display_name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'pilot', 'active', 'suspended', 'revoked')),
  metadata_url text,
  issuer text,
  default_role text not null default 'employee'
    check (default_role in ('org_admin', 'facility_manager', 'trainer', 'employee', 'auditor')),
  jit_membership_enabled boolean not null default false,
  jit_membership_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(jit_membership_policy) = 'object'),
  require_aal2 boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_connection_id)
);

create index organization_sso_connections_org_idx
  on public.organization_sso_connections(organization_id, status);
create trigger set_updated_at before update on public.organization_sso_connections
  for each row execute function public.set_updated_at();

create table public.identity_subject_links (
  identity_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sso_connection_id uuid not null references public.organization_sso_connections(id) on delete restrict,
  provider_subject text not null check (length(btrim(provider_subject)) > 0),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  link_method text not null check (link_method in ('sso_subject', 'scim', 'admin_verified')),
  linked_by uuid references public.profiles(id),
  linked_at timestamptz not null default now(),
  last_authenticated_at timestamptz,
  unlinked_at timestamptz,
  unlink_reason text,
  unique (sso_connection_id, provider_subject),
  unique (sso_connection_id, profile_id)
);

create index identity_subject_links_profile_idx on public.identity_subject_links(profile_id);

create table public.identity_security_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  privileged_roles text[] not null default array['org_admin', 'facility_manager']::text[],
  sensitive_operations text[] not null default array[
    'regulatory_rule_approval', 'regulatory_rule_activation', 'identity_admin',
    'session_revocation', 'break_glass', 'scim_credential_rotation',
    'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
    'billing_admin', 'integration_admin'
  ]::text[],
  require_aal2 boolean not null default true,
  max_privileged_session_minutes integer not null default 480
    check (max_privileged_session_minutes between 5 and 480),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not ('platform_admin' = any(privileged_roles))),
  -- Tenant policy may strengthen the baseline (additional roles/operations or
  -- a shorter session window) but cannot turn off the program-wide privileged
  -- MFA boundary after an administrator has used AAL2 once to edit the row.
  constraint identity_security_policy_mfa_floor check (
    require_aal2
    and privileged_roles @> array['org_admin', 'facility_manager']::text[]
    and sensitive_operations @> array[
      'regulatory_rule_approval', 'regulatory_rule_activation', 'identity_admin',
      'session_revocation', 'break_glass', 'scim_credential_rotation',
      'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
      'billing_admin', 'integration_admin'
    ]::text[]
  )
);

create trigger set_updated_at before update on public.identity_security_policies
  for each row execute function public.set_updated_at();

create table public.identity_break_glass_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  target_profile_id uuid not null references public.profiles(id) on delete restrict,
  requested_by uuid not null references public.profiles(id),
  approved_by uuid not null references public.profiles(id),
  reason text not null check (length(btrim(reason)) >= 20),
  ticket_reference text not null check (length(btrim(ticket_reference)) >= 3),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revocation_reason text,
  evidence_checksum_sha256 text not null check (evidence_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (requested_by <> approved_by),
  check (expires_at > granted_at and expires_at <= granted_at + interval '4 hours'),
  check ((revoked_at is null) = (revoked_by is null)),
  check ((revoked_at is null) or length(btrim(revocation_reason)) > 0)
);

create index identity_break_glass_org_idx
  on public.identity_break_glass_events(organization_id, granted_at desc);

create table public.identity_session_revocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  source text not null check (source in ('administrator', 'scim', 'break_glass', 'security_response', 'system')),
  reason text not null check (length(btrim(reason)) >= 5),
  external_request_id text,
  requested_by uuid references public.profiles(id),
  revoked_session_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(revoked_session_ids) = 'array'),
  revoked_session_count integer not null check (revoked_session_count >= 0),
  profile_deactivated boolean not null,
  evidence_checksum_sha256 text not null check (evidence_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz not null default now(),
  unique (source, external_request_id)
);

create index identity_session_revocations_profile_idx
  on public.identity_session_revocations(profile_id, revoked_at desc);

create table public.scim_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_key uuid not null default gen_random_uuid() unique,
  display_name text not null,
  provider text not null,
  status text not null default 'pilot' check (status in ('pilot', 'active', 'suspended', 'revoked')),
  default_facility_id uuid not null references public.facilities(id) on delete restrict,
  credential_salt text not null check (credential_salt ~ '^[0-9a-f]{32,128}$'),
  credential_hash_sha256 text not null check (credential_hash_sha256 ~ '^[0-9a-f]{64}$'),
  credential_hint text not null check (length(credential_hint) between 2 and 12),
  last_rotated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, display_name)
);

create index scim_connections_org_idx on public.scim_connections(organization_id, status);
create trigger set_updated_at before update on public.scim_connections
  for each row execute function public.set_updated_at();

create table public.scim_group_mappings (
  id uuid primary key default gen_random_uuid(),
  scim_connection_id uuid not null references public.scim_connections(id) on delete cascade,
  external_group_id text not null,
  facility_id uuid references public.facilities(id) on delete restrict,
  app_role text not null default 'employee'
    check (app_role in ('org_admin', 'facility_manager', 'trainer', 'employee', 'auditor')),
  job_title text,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  unique (scim_connection_id, external_group_id)
);

create index scim_group_mappings_resolution_idx
  on public.scim_group_mappings(scim_connection_id, priority, external_group_id);

create table public.scim_subject_links (
  identity_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  scim_connection_id uuid not null references public.scim_connections(id) on delete restrict,
  external_subject_id text not null check (length(btrim(external_subject_id)) > 0),
  user_name text not null,
  employee_id uuid not null references public.employees(id) on delete restrict,
  profile_id uuid references public.profiles(id) on delete restrict,
  lifecycle_state text not null default 'active'
    check (lifecycle_state in ('active', 'suspended', 'deprovisioned')),
  last_request_id text not null,
  suspended_at timestamptz,
  deprovisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scim_connection_id, external_subject_id),
  unique (scim_connection_id, employee_id),
  check ((lifecycle_state <> 'suspended') or suspended_at is not null),
  check ((lifecycle_state <> 'deprovisioned') or deprovisioned_at is not null)
);

create index scim_subject_links_employee_idx on public.scim_subject_links(employee_id);
create trigger set_updated_at before update on public.scim_subject_links
  for each row execute function public.set_updated_at();

create table public.scim_request_receipts (
  id uuid primary key default gen_random_uuid(),
  scim_connection_id uuid not null references public.scim_connections(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id text not null check (length(btrim(request_id)) between 8 and 200),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  operation text not null check (operation in ('create', 'update', 'suspend', 'deprovision')),
  external_subject_id text not null,
  status text not null default 'processing' check (status in ('processing', 'applied', 'rejected')),
  response_body jsonb,
  identity_id uuid references public.scim_subject_links(identity_id) on delete restrict,
  employee_id uuid references public.employees(id) on delete restrict,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (scim_connection_id, request_id)
);

create index scim_request_receipts_external_idx
  on public.scim_request_receipts(scim_connection_id, external_subject_id, created_at desc);

-- Supabase SAML accounts intentionally do not participate in email identity
-- linking and may share an email with a password account. Profiles therefore
-- use the auth UUID as identity and keep email as a non-unique attribute.
alter table public.profiles drop constraint if exists profiles_email_key;
create index if not exists profiles_email_lookup_idx on public.profiles(lower(email));

-- Replace the legacy auth-user projection with a fail-closed SSO-aware
-- projection. For an SSO user, is_sso_user and sso_provider_id are trusted Auth
-- columns; raw_app_meta_data is not used to choose tenant or role. An active,
-- verified, explicitly JIT-enabled connection is mandatory.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_connection public.organization_sso_connections;
  v_organization_id uuid;
  v_role text;
  v_provider_id text;
begin
  if new.is_sso_user then
    if new.email is null
       or coalesce(new.raw_app_meta_data ->> 'provider', '')
          !~ '^sso:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'SSO user is missing an authoritative provider or email'
        using errcode = '42501';
    end if;
    v_provider_id := substr(new.raw_app_meta_data ->> 'provider', 5);
    select c.* into v_connection
    from public.organization_sso_connections c
    join public.organization_identity_domains d on d.id = c.identity_domain_id
    where c.provider = 'saml'
      and c.provider_connection_id = v_provider_id
      and c.status = 'active'
      and c.jit_membership_enabled
      and coalesce((c.jit_membership_policy ->> 'allowNewUsers')::boolean, true)
      and d.verification_status = 'verified'
      and d.domain = lower(split_part(new.email, '@', 2));
    if v_connection.id is null then
      raise exception 'SSO provider is not approved for JIT membership on this verified domain'
        using errcode = '42501';
    end if;
    v_organization_id := v_connection.organization_id;
    v_role := v_connection.default_role;
  else
    v_organization_id := nullif(new.raw_app_meta_data ->> 'organization_id', '')::uuid;
    v_role := coalesce(new.raw_app_meta_data ->> 'role', 'employee');
  end if;

  insert into public.profiles (
    id, email, first_name, last_name, role, organization_id
  ) values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    v_role,
    v_organization_id
  ) on conflict (id) do nothing;

  -- Migration 31's profile-provisioning trigger owns the effective scope
  -- membership and matching built-in grant for every profile, including SSO
  -- JIT users. Keeping that write in one adapter prevents duplicate/overlapping
  -- memberships when this auth trigger inserts the profile.
  return new;
end;
$function$;

-- auth.identities.provider_id is the immutable SAML NameID and provider is
-- `sso:<provider uuid>`. Linking happens only from that signed Auth record,
-- never by searching for an email address.
create or replace function public.link_sso_auth_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user auth.users;
  v_connection public.organization_sso_connections;
  v_provider_id text;
begin
  if new.provider not like 'sso:%' then
    return new;
  end if;
  select * into v_user from auth.users where id = new.user_id;
  if not coalesce(v_user.is_sso_user, false)
     or coalesce(v_user.raw_app_meta_data ->> 'provider', '') <> new.provider then
    raise exception 'SSO identity is not bound to an SSO Auth user'
      using errcode = '42501';
  end if;
  v_provider_id := substr(new.provider, 5);
  select c.* into v_connection
  from public.organization_sso_connections c
  join public.organization_identity_domains d on d.id = c.identity_domain_id
  where c.provider_connection_id = v_provider_id
    and c.status = 'active'
    and c.jit_membership_enabled
    and d.verification_status = 'verified'
    and d.domain = lower(split_part(v_user.email, '@', 2));
  if v_connection.id is null then
    raise exception 'SSO identity has no approved verified-domain connection'
      using errcode = '42501';
  end if;
  insert into public.identity_subject_links (
    organization_id, sso_connection_id, provider_subject, profile_id,
    link_method, linked_by
  ) values (
    v_connection.organization_id, v_connection.id, new.provider_id, new.user_id,
    'sso_subject', null
  ) on conflict (sso_connection_id, provider_subject) do nothing;
  return new;
end;
$function$;

drop trigger if exists phase2_link_sso_auth_identity on auth.identities;
create trigger phase2_link_sso_auth_identity
after insert on auth.identities
for each row execute function public.link_sso_auth_identity();

-- ---------------------------------------------------------------------------
-- Integrity guards
-- ---------------------------------------------------------------------------

create or replace function public.guard_regulatory_rule_version()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_superseded_pack_id uuid;
  v_transition_allowed boolean;
begin
  if new.supersedes_version_id is not null then
    select rule_pack_id into v_superseded_pack_id
    from public.regulatory_rule_versions
    where id = new.supersedes_version_id;
    if v_superseded_pack_id is distinct from new.rule_pack_id then
      raise exception 'superseded version must belong to the same rule pack'
        using errcode = '23514';
    end if;
  end if;

  new.content_checksum_sha256 := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'rulePackId', new.rule_pack_id,
      'version', new.version_number,
      'jurisdiction', new.jurisdiction_code,
      'authority', new.authority_name,
      'citation', new.citation,
      'sourceUri', new.source_uri,
      'sourceChecksum', new.source_checksum_sha256,
      'applicability', new.applicability,
      'parameters', new.calculation_parameters,
      'effectiveFrom', new.effective_from,
      'effectiveTo', new.effective_to,
      'supersedes', new.supersedes_version_id,
      'releaseNotes', new.release_notes
    )::text,
    'utf8'
  ), 'sha256'), 'hex');

  if tg_op = 'UPDATE' then
    if old.state <> 'draft' and (
      new.rule_pack_id,
      new.version_number,
      new.jurisdiction_code,
      new.authority_name,
      new.citation,
      new.source_uri,
      new.source_checksum_sha256,
      new.applicability,
      new.calculation_parameters,
      new.effective_from,
      new.effective_to,
      new.supersedes_version_id,
      new.release_notes,
      new.authored_by
    ) is distinct from (
      old.rule_pack_id,
      old.version_number,
      old.jurisdiction_code,
      old.authority_name,
      old.citation,
      old.source_uri,
      old.source_checksum_sha256,
      old.applicability,
      old.calculation_parameters,
      old.effective_from,
      old.effective_to,
      old.supersedes_version_id,
      old.release_notes,
      old.authored_by
    ) then
      raise exception 'approved regulatory rule content is immutable'
        using errcode = '55000';
    end if;

    if new.state is distinct from old.state then
      if coalesce(current_setting('app.regulatory_rule_transition', true), '') <> 'on' then
        raise exception 'regulatory rule state changes require a governed transition RPC'
          using errcode = '42501';
      end if;
      v_transition_allowed := (old.state, new.state) in (
        ('draft', 'review'),
        ('review', 'draft'),
        ('review', 'approved'),
        ('approved', 'shadow'),
        ('approved', 'withdrawn'),
        ('shadow', 'active'),
        ('shadow', 'withdrawn'),
        ('active', 'superseded'),
        ('active', 'withdrawn')
      );
      if not v_transition_allowed then
        raise exception 'invalid regulatory rule transition: % -> %', old.state, new.state
          using errcode = '23514';
      end if;
    end if;
  end if;

  if new.reviewed_by is not null and new.reviewed_by = new.authored_by then
    raise exception 'a rule author cannot approve their own version'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

create trigger guard_regulatory_rule_version
before insert or update on public.regulatory_rule_versions
for each row execute function public.guard_regulatory_rule_version();

create or replace function public.guard_regulatory_fixture()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_state text;
begin
  select state into v_state
  from public.regulatory_rule_versions
  where id = coalesce(new.rule_version_id, old.rule_version_id);
  if v_state is distinct from 'draft' then
    raise exception 'golden fixtures are immutable after review begins'
      using errcode = '55000';
  end if;
  if tg_op <> 'DELETE' then
    new.fixture_checksum_sha256 := encode(extensions.digest(convert_to(
      jsonb_build_object(
        'versionId', new.rule_version_id,
        'fixtureKey', new.fixture_key,
        'facilityType', new.facility_type,
        'workforceProfile', new.workforce_profile_key,
        'boundaryDate', new.boundary_date,
        'input', new.input_payload,
        'expected', new.expected_result
      )::text,
      'utf8'
    ), 'sha256'), 'hex');
  end if;
  return coalesce(new, old);
end;
$function$;

create trigger guard_regulatory_fixture
before insert or update or delete on public.regulatory_rule_golden_fixtures
for each row execute function public.guard_regulatory_fixture();

create or replace function public.prevent_append_only_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$function$;

create trigger regulatory_fixture_runs_append_only
before update or delete on public.regulatory_rule_fixture_runs
for each row execute function public.prevent_append_only_evidence_mutation();
create trigger regulatory_shadow_runs_append_only
before update or delete on public.regulatory_rule_shadow_runs
for each row execute function public.prevent_append_only_evidence_mutation();
create trigger regulatory_shadow_differences_append_only
before update or delete on public.regulatory_rule_shadow_differences
for each row execute function public.prevent_append_only_evidence_mutation();
create trigger regulatory_shadow_reconciliations_append_only
before update or delete on public.regulatory_rule_shadow_reconciliations
for each row execute function public.prevent_append_only_evidence_mutation();
create trigger identity_session_revocations_append_only
before update or delete on public.identity_session_revocations
for each row execute function public.prevent_append_only_evidence_mutation();

create or replace function public.guard_identity_evidence_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' or coalesce(current_setting('app.identity_evidence_write', true), '') <> 'on' then
    raise exception '% may only change through its governed RPC', tg_table_name
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

create trigger identity_break_glass_guard
before update or delete on public.identity_break_glass_events
for each row execute function public.guard_identity_evidence_update();
create trigger scim_receipts_guard
before update or delete on public.scim_request_receipts
for each row execute function public.guard_identity_evidence_update();
create trigger scim_subject_links_no_delete
before delete on public.scim_subject_links
for each row execute function public.prevent_append_only_evidence_mutation();

create or replace function public.validate_enterprise_identity_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_org_id uuid;
  v_status text;
begin
  if tg_table_name = 'organization_sso_connections' then
    select organization_id, verification_status into v_org_id, v_status
    from public.organization_identity_domains where id = new.identity_domain_id;
    if v_org_id is distinct from new.organization_id then
      raise exception 'SSO connection and verified domain must belong to the same organization'
        using errcode = '23514';
    end if;
    if new.status in ('pilot', 'active') and v_status is distinct from 'verified' then
      raise exception 'SSO connection cannot be enabled for an unverified domain'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'scim_connections' then
    select organization_id into v_org_id from public.facilities where id = new.default_facility_id;
    if v_org_id is distinct from new.organization_id then
      raise exception 'SCIM default facility must belong to the connection organization'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'scim_group_mappings' and new.facility_id is not null then
    select c.organization_id into v_org_id
    from public.scim_connections c where c.id = new.scim_connection_id;
    if not exists (
      select 1 from public.facilities f
      where f.id = new.facility_id and f.organization_id = v_org_id
    ) then
      raise exception 'SCIM group facility must belong to the connection organization'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

create trigger validate_sso_connection_scope
before insert or update on public.organization_sso_connections
for each row execute function public.validate_enterprise_identity_scope();
create trigger validate_scim_connection_scope
before insert or update on public.scim_connections
for each row execute function public.validate_enterprise_identity_scope();
create trigger validate_scim_group_scope
before insert or update on public.scim_group_mappings
for each row execute function public.validate_enterprise_identity_scope();

create or replace function public.validate_identity_subject_link()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_profile_org uuid;
  v_connection_org uuid;
  v_domain text;
  v_domain_status text;
  v_email text;
begin
  select p.organization_id, p.email into v_profile_org, v_email
  from public.profiles p where p.id = new.profile_id;
  select c.organization_id, d.domain, d.verification_status
    into v_connection_org, v_domain, v_domain_status
  from public.organization_sso_connections c
  join public.organization_identity_domains d on d.id = c.identity_domain_id
  where c.id = new.sso_connection_id;

  if v_profile_org is distinct from new.organization_id
     or v_connection_org is distinct from new.organization_id then
    raise exception 'identity subject, profile, and SSO connection must share one organization'
      using errcode = '23514';
  end if;
  if v_domain_status is distinct from 'verified' then
    raise exception 'identity subjects may only link through a verified domain'
      using errcode = '42501';
  end if;
  if lower(split_part(v_email, '@', 2)) is distinct from v_domain then
    raise exception 'profile email domain is not verified for this SSO connection'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

create trigger validate_identity_subject_link
before insert or update on public.identity_subject_links
for each row execute function public.validate_identity_subject_link();

-- ---------------------------------------------------------------------------
-- MFA/AAL2 enforcement and regulatory workflow RPCs
-- ---------------------------------------------------------------------------

create or replace function public.identity_operation_requires_aal2(p_operation text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_role text := public.current_role();
  v_org_id uuid := public.current_org_id();
  v_policy public.identity_security_policies%rowtype;
begin
  if v_role = 'platform_admin' then
    return p_operation = any(array[
      'regulatory_rule_approval', 'regulatory_rule_activation', 'identity_admin',
      'session_revocation', 'break_glass', 'scim_credential_rotation',
      'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
      'billing_admin', 'integration_admin'
    ]::text[]);
  end if;
  select * into v_policy
  from public.identity_security_policies
  where organization_id = v_org_id;
  if not found then
    return v_role = any(array['org_admin', 'facility_manager']::text[])
      and p_operation = any(array[
        'regulatory_rule_approval', 'regulatory_rule_activation', 'identity_admin',
        'session_revocation', 'break_glass', 'scim_credential_rotation',
        'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
        'billing_admin', 'integration_admin'
      ]::text[]);
  end if;
  return v_policy.require_aal2
    and v_role = any(v_policy.privileged_roles)
    and p_operation = any(v_policy.sensitive_operations);
end;
$function$;

create or replace function public.identity_assurance_is_current(p_operation text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_max_minutes integer := 480;
  v_issued_at timestamptz;
  v_session_started_at timestamptz;
  v_session_id text;
begin
  if coalesce(v_claims ->> 'role', '') = 'service_role' then
    return true;
  end if;
  if not public.identity_operation_requires_aal2(p_operation) then
    return true;
  end if;
  if coalesce(v_claims ->> 'aal', 'aal1') <> 'aal2'
     or coalesce(v_claims ->> 'iat', '') !~ '^[0-9]+([.][0-9]+)?$' then
    return false;
  end if;

  if public.current_role() <> 'platform_admin' then
    select p.max_privileged_session_minutes
    into v_max_minutes
    from public.identity_security_policies p
    where p.organization_id = public.current_org_id();
    v_max_minutes := coalesce(v_max_minutes, 480);
  end if;

  v_issued_at := to_timestamp((v_claims ->> 'iat')::double precision);
  v_session_id := nullif(v_claims ->> 'session_id', '');
  if v_session_id is not null and v_session_id !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  if v_session_id ~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    select s.created_at
    into v_session_started_at
    from auth.sessions s
    where s.id = v_session_id::uuid
      and s.user_id = auth.uid();
    if not found then
      return false;
    end if;
  end if;

  -- A real Auth session is measured from its original creation time so normal
  -- JWT refreshes cannot silently extend privileged access. Signed test
  -- contexts without a session_id claim are bounded by their token iat; a
  -- claimed session that was revoked or belongs to someone else fails closed.
  v_session_started_at := coalesce(v_session_started_at, v_issued_at);
  return v_session_started_at >= now() - make_interval(mins => v_max_minutes)
    and v_issued_at <= now() + interval '5 minutes';
exception when others then
  return false;
end;
$function$;

create or replace function public.assert_identity_assurance(p_operation text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.identity_assurance_is_current(p_operation) then
    raise exception 'A fresh AAL2 session is required for operation %', p_operation
      using errcode = '42501';
  end if;
end;
$function$;

create or replace function public.require_platform_rule_admin(p_operation text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator access is required'
      using errcode = '42501';
  end if;
  perform public.assert_identity_assurance(p_operation);
end;
$function$;

create or replace function public.submit_regulatory_rule_version(p_version_id uuid)
returns public.regulatory_rule_versions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.regulatory_rule_versions;
begin
  perform public.require_platform_rule_admin('regulatory_rule_approval');
  select * into v_row from public.regulatory_rule_versions where id = p_version_id for update;
  if v_row.id is null then
    raise exception 'regulatory rule version not found' using errcode = 'P0002';
  end if;
  if v_row.state <> 'draft' then
    raise exception 'only draft rule versions may be submitted' using errcode = '22023';
  end if;
  if v_row.authored_by <> auth.uid() then
    raise exception 'only the recorded author may submit this rule version'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.regulatory_rule_golden_fixtures f
    where f.rule_version_id = p_version_id
  ) then
    raise exception 'at least one golden fixture is required before review'
      using errcode = '23514';
  end if;
  perform set_config('app.regulatory_rule_transition', 'on', true);
  update public.regulatory_rule_versions
  set state = 'review', submitted_by = auth.uid(), submitted_at = now()
  where id = p_version_id returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.approve_regulatory_rule_version(
  p_version_id uuid,
  p_review_notes text
)
returns public.regulatory_rule_versions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.regulatory_rule_versions;
begin
  perform public.require_platform_rule_admin('regulatory_rule_approval');
  if length(btrim(coalesce(p_review_notes, ''))) < 10 then
    raise exception 'review notes must explain the approval'
      using errcode = '22023';
  end if;
  select * into v_row from public.regulatory_rule_versions where id = p_version_id for update;
  if v_row.id is null or v_row.state <> 'review' then
    raise exception 'rule version must be in review before approval'
      using errcode = '22023';
  end if;
  if v_row.authored_by = auth.uid() then
    raise exception 'a rule author cannot approve their own version'
      using errcode = '42501';
  end if;
  perform set_config('app.regulatory_rule_transition', 'on', true);
  update public.regulatory_rule_versions
  set state = 'approved', reviewed_by = auth.uid(), review_notes = btrim(p_review_notes),
      approved_at = now()
  where id = p_version_id returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.start_regulatory_rule_shadow(p_version_id uuid)
returns public.regulatory_rule_versions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.regulatory_rule_versions;
begin
  perform public.require_platform_rule_admin('regulatory_rule_activation');
  select * into v_row from public.regulatory_rule_versions where id = p_version_id for update;
  if v_row.id is null or v_row.state <> 'approved' then
    raise exception 'only approved rule versions may enter shadow mode'
      using errcode = '22023';
  end if;
  perform set_config('app.regulatory_rule_transition', 'on', true);
  update public.regulatory_rule_versions
  set state = 'shadow', shadow_started_at = now()
  where id = p_version_id returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.record_regulatory_fixture_result(
  p_fixture_id uuid,
  p_engine_version text,
  p_actual_result jsonb,
  p_request_id text,
  p_failure_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_fixture public.regulatory_rule_golden_fixtures;
  v_actual_hash text;
  v_expected_hash text;
  v_id uuid;
  v_existing public.regulatory_rule_fixture_runs%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    perform public.require_platform_rule_admin('regulatory_rule_activation');
  end if;
  select * into v_fixture from public.regulatory_rule_golden_fixtures where id = p_fixture_id;
  if v_fixture.id is null then
    raise exception 'golden fixture not found' using errcode = 'P0002';
  end if;
  v_actual_hash := encode(extensions.digest(convert_to(p_actual_result::text, 'utf8'), 'sha256'), 'hex');
  v_expected_hash := encode(extensions.digest(convert_to(v_fixture.expected_result::text, 'utf8'), 'sha256'), 'hex');
  insert into public.regulatory_rule_fixture_runs (
    rule_version_id, fixture_id, engine_version, actual_result_checksum_sha256,
    passed, failure_detail, executed_by, request_id
  ) values (
    v_fixture.rule_version_id, p_fixture_id, btrim(p_engine_version), v_actual_hash,
    v_actual_hash = v_expected_hash, p_failure_detail, auth.uid(), btrim(p_request_id)
  )
  on conflict (fixture_id, engine_version, request_id) do nothing
  returning id into v_id;
  if v_id is null then
    select * into v_existing from public.regulatory_rule_fixture_runs
    where fixture_id = p_fixture_id
      and engine_version = btrim(p_engine_version)
      and request_id = btrim(p_request_id);
    if v_existing.actual_result_checksum_sha256 is distinct from v_actual_hash then
      raise exception 'fixture request id was reused with a different result'
        using errcode = '23505';
    end if;
    v_id := v_existing.id;
  end if;
  return v_id;
end;
$function$;

create or replace function public.record_regulatory_shadow_run(
  p_rule_version_id uuid,
  p_organization_id uuid,
  p_facility_type text,
  p_baseline_version_id uuid,
  p_cohort_started_at timestamptz,
  p_cohort_ended_at timestamptz,
  p_evaluated_count integer,
  p_engine_version text,
  p_request_id text,
  p_differences jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_run_id uuid;
  v_difference_count integer;
  v_item jsonb;
  v_checksum text;
  v_version public.regulatory_rule_versions%rowtype;
  v_existing public.regulatory_rule_shadow_runs%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    perform public.require_platform_rule_admin('regulatory_rule_activation');
  end if;
  select * into v_version
  from public.regulatory_rule_versions
  where id = p_rule_version_id;
  if v_version.id is null or v_version.state <> 'shadow' then
    raise exception 'rule version must be in shadow mode' using errcode = '22023';
  end if;
  if jsonb_typeof(p_differences) <> 'array' then
    raise exception 'differences must be an array' using errcode = '22023';
  end if;
  v_difference_count := jsonb_array_length(p_differences);
  if p_evaluated_count <= 0 or p_evaluated_count < v_difference_count then
    raise exception 'shadow runs require a positive evaluated count not smaller than differences'
      using errcode = '22023';
  end if;
  if p_cohort_started_at < v_version.shadow_started_at
     or p_cohort_ended_at < p_cohort_started_at
     or p_cohort_ended_at > now() then
    raise exception 'shadow cohort timestamps must fall within the actual shadow period'
      using errcode = '22007';
  end if;
  if not exists (
    select 1 from public.facilities f
    where f.organization_id = p_organization_id
      and f.facility_type = p_facility_type
  ) then
    raise exception 'shadow facility type is not represented by the pilot organization'
      using errcode = '23514';
  end if;
  if p_baseline_version_id is null or not exists (
    select 1 from public.regulatory_rule_versions baseline
    where baseline.id = p_baseline_version_id
      and baseline.rule_pack_id = v_version.rule_pack_id
      and baseline.state in ('active', 'superseded')
  ) then
    raise exception 'shadow run requires an active or superseded baseline from the same rule pack'
      using errcode = '23514';
  end if;
  v_checksum := encode(extensions.digest(convert_to(jsonb_build_object(
    'version', p_rule_version_id, 'organization', p_organization_id,
    'facilityType', p_facility_type, 'baseline', p_baseline_version_id,
    'startedAt', p_cohort_started_at, 'endedAt', p_cohort_ended_at,
    'evaluated', p_evaluated_count, 'engine', p_engine_version,
    'differences', p_differences
  )::text, 'utf8'), 'sha256'), 'hex');
  insert into public.regulatory_rule_shadow_runs (
    rule_version_id, organization_id, facility_type, baseline_version_id,
    cohort_started_at, cohort_ended_at, evaluated_count, difference_count,
    engine_version, result_checksum_sha256, recorded_by, request_id
  ) values (
    p_rule_version_id, p_organization_id, p_facility_type, p_baseline_version_id,
    p_cohort_started_at, p_cohort_ended_at, p_evaluated_count, v_difference_count,
    btrim(p_engine_version), v_checksum, auth.uid(), btrim(p_request_id)
  )
  on conflict (rule_version_id, organization_id, request_id) do nothing
  returning id into v_run_id;
  if v_run_id is null then
    select * into v_existing from public.regulatory_rule_shadow_runs
    where rule_version_id = p_rule_version_id
      and organization_id = p_organization_id
      and request_id = btrim(p_request_id);
    if v_existing.result_checksum_sha256 is distinct from v_checksum then
      raise exception 'shadow request id was reused with different run content'
        using errcode = '23505';
    end if;
    v_run_id := v_existing.id;
    return v_run_id;
  end if;
  for v_item in select value from jsonb_array_elements(p_differences) loop
    insert into public.regulatory_rule_shadow_differences (
      shadow_run_id, subject_reference, baseline_result, candidate_result,
      difference_checksum_sha256
    ) values (
      v_run_id,
      btrim(v_item ->> 'subjectReference'),
      v_item -> 'baselineResult',
      v_item -> 'candidateResult',
      encode(extensions.digest(convert_to(v_item::text, 'utf8'), 'sha256'), 'hex')
    );
  end loop;
  return v_run_id;
end;
$function$;

create or replace function public.reconcile_regulatory_shadow_difference(
  p_difference_id uuid,
  p_resolution text,
  p_rationale text,
  p_evidence_checksum_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  perform public.require_platform_rule_admin('regulatory_rule_activation');
  insert into public.regulatory_rule_shadow_reconciliations (
    difference_id, resolution, rationale, evidence_checksum_sha256, reconciled_by
  ) values (
    p_difference_id, p_resolution, btrim(p_rationale), p_evidence_checksum_sha256, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.activate_regulatory_rule_version(p_version_id uuid)
returns public.regulatory_rule_versions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.regulatory_rule_versions;
  v_active_id uuid;
  v_org_count integer;
  v_facility_type_count integer;
  v_shadow_started timestamptz;
begin
  perform public.require_platform_rule_admin('regulatory_rule_activation');
  select * into v_row from public.regulatory_rule_versions where id = p_version_id for update;
  if v_row.id is null or v_row.state <> 'shadow' then
    raise exception 'only a shadow rule version may be activated' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.regulatory_rule_golden_fixtures f
    left join lateral (
      select r.passed from public.regulatory_rule_fixture_runs r
      where r.fixture_id = f.id order by r.executed_at desc, r.id desc limit 1
    ) latest on true
    where f.rule_version_id = p_version_id
      and coalesce(latest.passed, false) = false
  ) or not exists (
    select 1 from public.regulatory_rule_golden_fixtures f where f.rule_version_id = p_version_id
  ) then
    raise exception 'all golden fixtures must have a passing latest run before activation'
      using errcode = '23514';
  end if;
  select count(distinct organization_id), count(distinct facility_type), min(cohort_started_at)
    into v_org_count, v_facility_type_count, v_shadow_started
  from public.regulatory_rule_shadow_runs
  where rule_version_id = p_version_id;
  if coalesce(v_org_count, 0) < 2 or coalesce(v_facility_type_count, 0) < 2
     or v_row.shadow_started_at is null
     or v_row.shadow_started_at > now() - interval '30 days'
     or v_shadow_started < v_row.shadow_started_at then
    raise exception 'activation requires 30 days of shadow evidence across two organizations and facility types'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.regulatory_rule_shadow_differences d
    join public.regulatory_rule_shadow_runs r on r.id = d.shadow_run_id
    left join public.regulatory_rule_shadow_reconciliations x on x.difference_id = d.id
    where r.rule_version_id = p_version_id
      and (x.id is null or x.resolution = 'candidate_defect')
  ) then
    raise exception 'every shadow difference must be reconciled without a candidate defect'
      using errcode = '23514';
  end if;

  select id into v_active_id from public.regulatory_rule_versions
  where rule_pack_id = v_row.rule_pack_id and state = 'active' for update;
  if v_active_id is not null and v_row.supersedes_version_id is distinct from v_active_id then
    raise exception 'candidate must explicitly supersede the currently active version'
      using errcode = '23514';
  end if;
  perform set_config('app.regulatory_rule_transition', 'on', true);
  if v_active_id is not null then
    update public.regulatory_rule_versions
    set state = 'superseded', superseded_at = now()
    where id = v_active_id;
  end if;
  update public.regulatory_rule_versions
  set state = 'active', activated_at = now()
  where id = p_version_id returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.withdraw_regulatory_rule_version(
  p_version_id uuid,
  p_reason text
)
returns public.regulatory_rule_versions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.regulatory_rule_versions;
begin
  perform public.require_platform_rule_admin('regulatory_rule_activation');
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'withdrawal reason must be at least 10 characters' using errcode = '22023';
  end if;
  select * into v_row from public.regulatory_rule_versions where id = p_version_id for update;
  if v_row.state not in ('approved', 'shadow', 'active') then
    raise exception 'rule version cannot be withdrawn from state %', v_row.state
      using errcode = '22023';
  end if;
  perform set_config('app.regulatory_rule_transition', 'on', true);
  update public.regulatory_rule_versions
  set state = 'withdrawn', withdrawn_at = now(), withdrawn_by = auth.uid(),
      withdrawal_reason = btrim(p_reason)
  where id = p_version_id returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.get_regulatory_rule_snapshot(
  p_rule_key text,
  p_as_of date
)
returns table (
  rule_version_id uuid,
  version_number integer,
  jurisdiction_code text,
  authority_name text,
  citation text,
  source_uri text,
  source_checksum_sha256 text,
  applicability jsonb,
  calculation_parameters jsonb,
  effective_from date,
  effective_to date,
  content_checksum_sha256 text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select v.id, v.version_number, v.jurisdiction_code, v.authority_name,
    v.citation, v.source_uri, v.source_checksum_sha256, v.applicability,
    v.calculation_parameters, v.effective_from, v.effective_to,
    v.content_checksum_sha256
  from public.regulatory_rule_packs p
  join public.regulatory_rule_versions v on v.rule_pack_id = p.id
  where p.rule_key = p_rule_key
    and (
      v.state in ('active', 'superseded')
      or (
        v.state = 'withdrawn'
        and v.activated_at is not null
        and p_as_of < v.withdrawn_at::date
      )
    )
    and v.effective_from <= p_as_of
    and (v.effective_to is null or v.effective_to >= p_as_of)
  order by v.effective_from desc, v.version_number desc
  limit 1;
$function$;

create or replace function public.get_regulatory_rule_control_plane()
returns table (
  rule_pack_id uuid,
  rule_key text,
  rule_name text,
  version_id uuid,
  version_number integer,
  state text,
  jurisdiction_code text,
  effective_from date,
  author_profile_id uuid,
  reviewer_profile_id uuid,
  golden_fixture_count bigint,
  passing_fixture_count bigint,
  shadow_organization_count bigint,
  unresolved_difference_count bigint,
  activation_ready boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.id, p.rule_key, p.name, v.id, v.version_number, v.state,
    v.jurisdiction_code, v.effective_from, v.authored_by, v.reviewed_by,
    coalesce(f.fixture_count, 0), coalesce(f.passing_count, 0),
    coalesce(s.organization_count, 0), coalesce(s.unresolved_count, 0),
    v.state = 'shadow'
      and coalesce(f.fixture_count, 0) > 0
      and f.fixture_count = f.passing_count
      and coalesce(s.organization_count, 0) >= 2
      and coalesce(s.facility_type_count, 0) >= 2
      and coalesce(s.oldest_cohort, now()) <= now() - interval '30 days'
      and coalesce(s.unresolved_count, 0) = 0
  from public.regulatory_rule_packs p
  join public.regulatory_rule_versions v on v.rule_pack_id = p.id
  left join lateral (
    select count(*) as fixture_count,
      count(*) filter (where coalesce(latest.passed, false)) as passing_count
    from public.regulatory_rule_golden_fixtures fixture
    left join lateral (
      select run.passed from public.regulatory_rule_fixture_runs run
      where run.fixture_id = fixture.id
      order by run.executed_at desc, run.id desc limit 1
    ) latest on true
    where fixture.rule_version_id = v.id
  ) f on true
  left join lateral (
    select count(distinct run.organization_id) as organization_count,
      count(distinct run.facility_type) as facility_type_count,
      min(run.cohort_started_at) as oldest_cohort,
      count(diff.id) filter (
        where reconciliation.id is null or reconciliation.resolution = 'candidate_defect'
      ) as unresolved_count
    from public.regulatory_rule_shadow_runs run
    left join public.regulatory_rule_shadow_differences diff on diff.shadow_run_id = run.id
    left join public.regulatory_rule_shadow_reconciliations reconciliation
      on reconciliation.difference_id = diff.id
    where run.rule_version_id = v.id
  ) s on true
  where public.is_platform_admin() or v.state in ('active', 'superseded');
$function$;

-- ---------------------------------------------------------------------------
-- Verified-domain, SSO, recovery, and session-revocation RPCs
-- ---------------------------------------------------------------------------

create or replace function public.require_identity_administrator(
  p_organization_id uuid,
  p_operation text default 'identity_admin'
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not (
    public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = p_organization_id
    )
  ) then
    raise exception 'identity administrator access is required'
      using errcode = '42501';
  end if;
  perform public.assert_identity_assurance(p_operation);
end;
$function$;

create or replace function public.register_identity_domain(
  p_organization_id uuid,
  p_domain text,
  p_verification_challenge_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_domain public.organization_identity_domains%rowtype;
begin
  perform public.require_identity_administrator(p_organization_id, 'identity_admin');
  select * into v_domain
  from public.organization_identity_domains
  where domain = lower(btrim(p_domain))
  for update;
  if v_domain.id is not null then
    if v_domain.organization_id <> p_organization_id then
      raise exception 'identity domain is unavailable' using errcode = '23505';
    end if;
    if v_domain.verification_status = 'verified' then
      raise exception 'identity domain is already verified' using errcode = '55000';
    end if;
    -- Rotating a lost pending proof, or restarting verification after a
    -- revocation, always returns to pending. Attached SSO connections remain
    -- suspended until a fresh trusted DNS proof succeeds and an operator
    -- explicitly promotes them again.
    update public.organization_identity_domains
    set verification_challenge_sha256 = lower(btrim(p_verification_challenge_sha256)),
        verification_status = 'pending',
        verified_at = null,
        verified_by = null,
        revoked_at = null,
        revoked_by = null,
        revocation_reason = null,
        created_by = auth.uid()
    where id = v_domain.id
    returning * into v_domain;
    return v_domain.id;
  end if;
  insert into public.organization_identity_domains (
    organization_id, domain, verification_challenge_sha256, created_by
  ) values (
    p_organization_id, lower(btrim(p_domain)), lower(btrim(p_verification_challenge_sha256)), auth.uid()
  ) returning * into v_domain;
  return v_domain.id;
end;
$function$;

create or replace function public.verify_identity_domain(
  p_domain_id uuid,
  p_observed_challenge_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_domain public.organization_identity_domains;
begin
  select * into v_domain
  from public.organization_identity_domains where id = p_domain_id for update;
  if v_domain.id is null then
    raise exception 'identity domain not found' using errcode = 'P0002';
  end if;
  -- Only the trusted DNS verifier may attest control. An administrator who
  -- registered a caller-chosen challenge hash cannot self-verify it.
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'trusted DNS verifier access is required' using errcode = '42501';
  end if;
  if lower(btrim(p_observed_challenge_sha256)) <> v_domain.verification_challenge_sha256 then
    return false;
  end if;
  update public.organization_identity_domains
  set verification_status = 'verified', verified_at = now(),
      verified_by = case
        when exists (select 1 from public.profiles p where p.id = auth.uid())
          then auth.uid()
        else v_domain.created_by
      end,
      revoked_at = null, revoked_by = null, revocation_reason = null
  where id = p_domain_id;
  return true;
end;
$function$;

create or replace function public.revoke_identity_domain(
  p_domain_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_domain public.organization_identity_domains;
  v_link record;
begin
  select * into v_domain
  from public.organization_identity_domains where id = p_domain_id for update;
  if v_domain.id is null then
    raise exception 'identity domain not found' using errcode = 'P0002';
  end if;
  perform public.require_identity_administrator(v_domain.organization_id, 'identity_admin');
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'domain revocation reason must be at least 10 characters'
      using errcode = '22023';
  end if;
  update public.organization_identity_domains
  set verification_status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
      revocation_reason = btrim(p_reason)
  where id = p_domain_id;
  update public.organization_sso_connections
  set status = 'suspended'
  where identity_domain_id = p_domain_id and status in ('pilot', 'active');
  for v_link in
    select distinct link.profile_id, (link.profile_id = auth.uid()) as actor_last
    from public.identity_subject_links link
    join public.organization_sso_connections connection
      on connection.id = link.sso_connection_id
    where connection.identity_domain_id = p_domain_id
      and link.unlinked_at is null
    order by actor_last
  loop
    perform public.revoke_identity_sessions(
      v_link.profile_id,
      'Verified SSO domain revoked: ' || btrim(p_reason),
      'security_response',
      'domain:' || p_domain_id::text || ':profile:' || v_link.profile_id::text,
      true
    );
  end loop;
  return true;
end;
$function$;

create or replace function public.link_sso_identity_subject(
  p_sso_connection_id uuid,
  p_provider_subject text,
  p_profile_id uuid,
  p_link_method text default 'admin_verified'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid;
  v_identity_id uuid;
begin
  select organization_id into v_org_id
  from public.organization_sso_connections where id = p_sso_connection_id;
  if v_org_id is null then
    raise exception 'SSO connection not found' using errcode = 'P0002';
  end if;
  perform public.require_identity_administrator(v_org_id, 'identity_admin');
  -- The caller must choose an explicit profile and immutable provider subject.
  -- Email is checked only as verified-domain evidence by the row trigger; it is
  -- never used to discover or silently link an account.
  insert into public.identity_subject_links (
    organization_id, sso_connection_id, provider_subject, profile_id,
    link_method, linked_by
  ) values (
    v_org_id, p_sso_connection_id, btrim(p_provider_subject), p_profile_id,
    p_link_method, auth.uid()
  ) returning identity_id into v_identity_id;
  return v_identity_id;
end;
$function$;

create or replace function public.grant_identity_break_glass(
  p_target_profile_id uuid,
  p_requested_by uuid,
  p_reason text,
  p_ticket_reference text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid;
  v_id uuid;
  v_hash text;
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform administrator may approve break-glass access'
      using errcode = '42501';
  end if;
  perform public.assert_identity_assurance('break_glass');
  select organization_id into v_org_id from public.profiles where id = p_target_profile_id;
  if not found or not exists (
    select 1 from public.profiles requester
    where requester.id = p_requested_by
      and requester.organization_id is not distinct from v_org_id
  ) then
    raise exception 'break-glass requester and target must exist in the same organization'
      using errcode = '23514';
  end if;
  if p_requested_by = auth.uid() then
    raise exception 'break-glass requests require a separate approver'
      using errcode = '42501';
  end if;
  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'organizationId', v_org_id, 'targetProfileId', p_target_profile_id,
    'requestedBy', p_requested_by, 'approvedBy', auth.uid(),
    'reason', btrim(p_reason), 'ticket', btrim(p_ticket_reference),
    'expiresAt', p_expires_at
  )::text, 'utf8'), 'sha256'), 'hex');
  insert into public.identity_break_glass_events (
    organization_id, target_profile_id, requested_by, approved_by, reason,
    ticket_reference, expires_at, evidence_checksum_sha256
  ) values (
    v_org_id, p_target_profile_id, p_requested_by, auth.uid(), btrim(p_reason),
    btrim(p_ticket_reference), p_expires_at, v_hash
  ) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.revoke_identity_break_glass(
  p_event_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id
  from public.identity_break_glass_events where id = p_event_id;
  perform public.require_identity_administrator(v_org_id, 'break_glass');
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'revocation reason is required' using errcode = '22023';
  end if;
  perform set_config('app.identity_evidence_write', 'on', true);
  update public.identity_break_glass_events
  set revoked_at = now(), revoked_by = auth.uid(), revocation_reason = btrim(p_reason)
  where id = p_event_id and revoked_at is null;
  return found;
end;
$function$;

create or replace function public.revoke_identity_sessions(
  p_profile_id uuid,
  p_reason text,
  p_source text,
  p_external_request_id text default null,
  p_deactivate_profile boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid;
  v_existing_id uuid;
  v_session_ids jsonb;
  v_session_count integer;
  v_id uuid;
  v_hash text;
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  select organization_id into v_org_id from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if not v_is_service then
    perform public.require_identity_administrator(v_org_id, 'session_revocation');
    if p_source not in ('administrator', 'break_glass', 'security_response') then
      raise exception 'interactive administrators cannot claim a system revocation source'
        using errcode = '42501';
    end if;
  end if;
  if p_external_request_id is not null then
    select id into v_existing_id
    from public.identity_session_revocations
    where source = p_source and external_request_id = p_external_request_id;
    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  select coalesce(jsonb_agg(s.id order by s.id), '[]'::jsonb), count(*)::integer
    into v_session_ids, v_session_count
  from auth.sessions s where s.user_id = p_profile_id;
  delete from auth.sessions where user_id = p_profile_id;

  if p_deactivate_profile then
    perform public.admin_update_profile(
      p_user_id => p_profile_id,
      p_is_active => false
    );
  end if;
  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'organizationId', v_org_id, 'profileId', p_profile_id, 'source', p_source,
    'reason', btrim(p_reason), 'externalRequestId', p_external_request_id,
    'sessionIds', v_session_ids, 'profileDeactivated', p_deactivate_profile
  )::text, 'utf8'), 'sha256'), 'hex');
  insert into public.identity_session_revocations (
    organization_id, profile_id, source, reason, external_request_id,
    requested_by, revoked_session_ids, revoked_session_count,
    profile_deactivated, evidence_checksum_sha256
  ) values (
    v_org_id, p_profile_id, p_source, btrim(p_reason), p_external_request_id,
    app_private.current_actor_profile_id(), v_session_ids, v_session_count,
    p_deactivate_profile, v_hash
  ) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.rotate_scim_connection_credential(
  p_connection_id uuid
)
returns table (connection_key uuid, credential_secret text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid;
  v_connection_key uuid;
  v_salt text := encode(extensions.gen_random_bytes(16), 'hex');
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash text;
begin
  select c.organization_id, c.connection_key
  into v_org_id, v_connection_key
  from public.scim_connections c
  where c.id = p_connection_id;
  if v_org_id is null then
    raise exception 'SCIM connection not found' using errcode = 'P0002';
  end if;
  perform public.require_identity_administrator(v_org_id, 'scim_credential_rotation');
  v_hash := encode(
    extensions.digest(convert_to(v_salt || ':' || v_secret, 'utf8'), 'sha256'),
    'hex'
  );
  update public.scim_connections
  set credential_salt = v_salt,
      credential_hash_sha256 = v_hash,
      credential_hint = right(v_secret, 6),
      last_rotated_at = now()
  where id = p_connection_id;
  return query select v_connection_key, v_secret;
end;
$function$;

create or replace function public.create_scim_connection(
  p_organization_id uuid,
  p_display_name text,
  p_provider text,
  p_default_facility_id uuid
)
returns table (connection_id uuid, connection_key uuid, credential_secret text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_salt text := encode(extensions.gen_random_bytes(16), 'hex');
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash text;
begin
  perform public.require_identity_administrator(p_organization_id, 'scim_credential_rotation');
  v_hash := encode(
    extensions.digest(convert_to(v_salt || ':' || v_secret, 'utf8'), 'sha256'),
    'hex'
  );
  return query
    insert into public.scim_connections (
      organization_id, display_name, provider, default_facility_id,
      credential_salt, credential_hash_sha256, credential_hint, created_by
    ) values (
      p_organization_id, btrim(p_display_name), btrim(p_provider), p_default_facility_id,
      v_salt, v_hash, right(v_secret, 6), auth.uid()
    ) returning id, scim_connections.connection_key, v_secret;
end;
$function$;

create or replace function public.get_scim_auth_material(p_connection_key uuid)
returns table (
  connection_id uuid,
  organization_id uuid,
  connection_status text,
  credential_salt text,
  credential_hash_sha256 text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.id, c.organization_id, c.status, c.credential_salt, c.credential_hash_sha256
  from public.scim_connections c
  where c.connection_key = p_connection_key;
$function$;

create or replace function public.get_identity_control_plane()
returns table (
  organization_id uuid,
  verified_domain_count bigint,
  active_sso_connection_count bigint,
  active_scim_connection_count bigint,
  privileged_profile_count bigint,
  privileged_profiles_without_mfa bigint,
  open_break_glass_count bigint,
  revocations_last_30_days bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  select o.id,
    (select count(*) from public.organization_identity_domains d
      where d.organization_id = o.id and d.verification_status = 'verified'),
    (select count(*) from public.organization_sso_connections s
      where s.organization_id = o.id and s.status in ('pilot', 'active')),
    (select count(*) from public.scim_connections c
      where c.organization_id = o.id and c.status in ('pilot', 'active')),
    (select count(*) from public.profiles p
      where p.organization_id = o.id and p.is_active
        and p.role in ('org_admin', 'facility_manager')),
    (select count(*) from public.profiles p
      where p.organization_id = o.id and p.is_active
        and p.role in ('org_admin', 'facility_manager')
        and not exists (
          select 1 from auth.mfa_factors factor
          where factor.user_id = p.id and factor.status = 'verified'
        )),
    (select count(*) from public.identity_break_glass_events b
      where b.organization_id = o.id and b.revoked_at is null and b.expires_at > now()),
    (select count(*) from public.identity_session_revocations r
      where r.organization_id = o.id and r.revoked_at >= now() - interval '30 days')
  from public.organizations o
  where public.is_platform_admin() or o.id = public.current_org_id();
$function$;

create or replace function public.get_scim_connection_registry()
returns table (
  connection_id uuid,
  organization_id uuid,
  connection_key uuid,
  display_name text,
  provider text,
  status text,
  default_facility_id uuid,
  credential_hint text,
  last_rotated_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.id, c.organization_id, c.connection_key, c.display_name, c.provider,
    c.status, c.default_facility_id, c.credential_hint, c.last_rotated_at, c.created_at
  from public.scim_connections c
  where public.is_platform_admin()
     or (
       public.current_role() = 'org_admin'
       and c.organization_id = public.current_org_id()
     );
$function$;

-- The only SCIM mutation entry point. A provider subject creates a new
-- workforce identity; it is never matched to an existing person by email.
-- Status changes delegate to the governed employee lifecycle RPC from P2.3.
create or replace function public.apply_scim_change(
  p_connection_id uuid,
  p_request_id text,
  p_payload_sha256 text,
  p_operation text,
  p_external_subject_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_connection public.scim_connections;
  v_receipt public.scim_request_receipts;
  v_link public.scim_subject_links;
  v_employee public.employees;
  v_mapping public.scim_group_mappings;
  v_groups text[] := array[]::text[];
  v_user_name text;
  v_email_domain text;
  v_first_name text;
  v_last_name text;
  v_job_title text;
  v_employee_number text;
  v_facility_id uuid;
  v_role text := 'employee';
  v_response jsonb;
  v_lifecycle_event_id uuid;
  v_error_code text;
  v_error_message text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'SCIM changes require the trusted service role'
      using errcode = '42501';
  end if;
  if p_operation not in ('create', 'update', 'suspend', 'deprovision') then
    raise exception 'unsupported SCIM operation' using errcode = '22023';
  end if;
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid SCIM payload checksum' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_request_id, ''))) not between 8 and 200 then
    raise exception 'invalid SCIM request id' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_external_subject_id, ''))) = 0 then
    raise exception 'external SCIM subject is required' using errcode = '22023';
  end if;

  select * into v_connection
  from public.scim_connections where id = p_connection_id for update;
  if v_connection.id is null or v_connection.status not in ('pilot', 'active') then
    raise exception 'SCIM connection is unavailable' using errcode = '42501';
  end if;

  insert into public.scim_request_receipts (
    scim_connection_id, organization_id, request_id, payload_sha256,
    operation, external_subject_id
  ) values (
    p_connection_id, v_connection.organization_id, btrim(p_request_id),
    p_payload_sha256, p_operation, btrim(p_external_subject_id)
  ) on conflict (scim_connection_id, request_id) do nothing
  returning * into v_receipt;

  if v_receipt.id is null then
    select * into v_receipt from public.scim_request_receipts
    where scim_connection_id = p_connection_id and request_id = btrim(p_request_id)
    for update;
    if v_receipt.payload_sha256 <> p_payload_sha256
       or v_receipt.operation <> p_operation
       or v_receipt.external_subject_id <> btrim(p_external_subject_id) then
      raise exception 'SCIM replay key was reused with a different request'
        using errcode = '23505';
    end if;
    if v_receipt.status in ('applied', 'rejected') then
      return coalesce(v_receipt.response_body, '{}'::jsonb) || jsonb_build_object(
        'replayed', true, 'receiptId', v_receipt.id
      );
    end if;
  end if;

  begin
    v_user_name := lower(btrim(p_payload ->> 'userName'));
    v_first_name := btrim(coalesce(
      p_payload -> 'name' ->> 'givenName', p_payload ->> 'firstName', ''
    ));
    v_last_name := btrim(coalesce(
      p_payload -> 'name' ->> 'familyName', p_payload ->> 'lastName', ''
    ));
    v_job_title := btrim(coalesce(p_payload ->> 'jobTitle', 'Employee'));
    v_employee_number := nullif(btrim(p_payload ->> 'employeeNumber'), '');
    if v_user_name !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
      raise exception 'SCIM userName must be an email on a verified tenant domain'
        using errcode = '22023';
    end if;
    v_email_domain := split_part(v_user_name, '@', 2);
    if not exists (
      select 1 from public.organization_identity_domains d
      where d.organization_id = v_connection.organization_id
        and d.domain = v_email_domain
        and d.verification_status = 'verified'
    ) then
      raise exception 'SCIM userName domain is not verified for this organization'
        using errcode = '42501';
    end if;
    if p_operation in ('create', 'update') and (
      length(v_first_name) = 0 or length(v_last_name) = 0
    ) then
      raise exception 'SCIM create/update requires givenName and familyName'
        using errcode = '22023';
    end if;

    if jsonb_typeof(coalesce(p_payload -> 'groups', '[]'::jsonb)) <> 'array' then
      raise exception 'SCIM groups must be an array' using errcode = '22023';
    end if;
    select coalesce(array_agg(group_id), array[]::text[]) into v_groups
    from (
      select case jsonb_typeof(value)
        when 'string' then value #>> '{}'
        when 'object' then coalesce(value ->> 'value', value ->> 'id')
        else null
      end as group_id
      from jsonb_array_elements(coalesce(p_payload -> 'groups', '[]'::jsonb))
    ) groups where group_id is not null;

    select mapping.* into v_mapping
    from public.scim_group_mappings mapping
    where mapping.scim_connection_id = p_connection_id
      and mapping.external_group_id = any(v_groups)
    order by mapping.priority, mapping.external_group_id
    limit 1;
    v_facility_id := coalesce(v_mapping.facility_id, v_connection.default_facility_id);
    v_role := coalesce(v_mapping.app_role, 'employee');
    v_job_title := coalesce(nullif(v_mapping.job_title, ''), v_job_title);

    select * into v_link
    from public.scim_subject_links
    where scim_connection_id = p_connection_id
      and external_subject_id = btrim(p_external_subject_id)
    for update;

    if p_operation = 'create' and v_link.identity_id is null then
      insert into public.employees (
        organization_id, facility_id, employee_number, first_name, last_name,
        email, hire_date, job_title, status
      ) values (
        v_connection.organization_id, v_facility_id, v_employee_number,
        v_first_name, v_last_name, v_user_name, current_date, v_job_title, 'active'
      ) returning * into v_employee;

      insert into public.scim_subject_links (
        organization_id, scim_connection_id, external_subject_id, user_name,
        employee_id, lifecycle_state, last_request_id
      ) values (
        v_connection.organization_id, p_connection_id, btrim(p_external_subject_id),
        v_user_name, v_employee.id, 'active', btrim(p_request_id)
      ) returning * into v_link;
    elsif v_link.identity_id is null then
      raise exception 'SCIM subject does not exist; create it before %', p_operation
        using errcode = 'P0002';
    end if;

    if p_operation in ('create', 'update') then
      update public.employees
      set first_name = v_first_name,
          last_name = v_last_name,
          email = v_user_name,
          employee_number = coalesce(v_employee_number, employee_number),
          job_title = v_job_title
      where id = v_link.employee_id
      returning * into v_employee;

      if v_employee.status = 'terminated' then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'rehire', current_date, v_facility_id,
          'SCIM provider reactivated the authoritative subject'
        );
      elsif v_employee.status = 'on_leave' then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'return', current_date, v_facility_id,
          'SCIM provider returned the authoritative subject from leave'
        );
      elsif v_employee.status = 'inactive' then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'hire', current_date, v_facility_id,
          'SCIM provider activated an authoritative subject without an active episode'
        );
      elsif v_link.lifecycle_state = 'suspended' then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'restore_access', current_date, null,
          'SCIM provider restored the authoritative subject access'
        );
        if v_employee.facility_id is distinct from v_facility_id then
          v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
            v_employee.id, 'transfer', current_date, v_facility_id,
            'SCIM group mapping changed the authoritative facility scope'
          );
        end if;
      elsif v_employee.facility_id is distinct from v_facility_id then
        v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
          v_employee.id, 'transfer', current_date, v_facility_id,
          'SCIM group mapping changed the authoritative facility scope'
        );
      end if;
      update public.scim_subject_links
      set user_name = v_user_name, lifecycle_state = 'active',
          suspended_at = null, deprovisioned_at = null,
          last_request_id = btrim(p_request_id)
      where identity_id = v_link.identity_id returning * into v_link;
    elsif p_operation = 'suspend' then
      v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
        v_link.employee_id, 'suspend_access', current_date, null,
        'SCIM provider suspended the authoritative subject'
      );
      update public.scim_subject_links
      set lifecycle_state = 'suspended', suspended_at = now(),
          last_request_id = btrim(p_request_id)
      where identity_id = v_link.identity_id returning * into v_link;
    elsif p_operation = 'deprovision' then
      v_lifecycle_event_id := public.apply_employee_lifecycle_transition(
        v_link.employee_id, 'terminate', current_date, null,
        'SCIM provider deprovisioned the authoritative subject'
      );
      update public.scim_subject_links
      set lifecycle_state = 'deprovisioned', deprovisioned_at = now(),
          last_request_id = btrim(p_request_id)
      where identity_id = v_link.identity_id returning * into v_link;
    end if;

    if v_link.profile_id is not null then
      if p_operation in ('suspend', 'deprovision') then
        perform public.revoke_identity_sessions(
          v_link.profile_id,
          format('SCIM %s for external subject %s', p_operation, p_external_subject_id),
          'scim',
          p_connection_id::text || ':' || btrim(p_request_id),
          true
        );
      else
        perform public.admin_update_profile(
          p_user_id => v_link.profile_id,
          p_role => v_role,
          p_is_active => true,
          p_email => v_user_name,
          p_first_name => v_first_name,
          p_last_name => v_last_name
        );
        delete from public.facility_assignments where profile_id = v_link.profile_id;
        if v_role in ('facility_manager', 'trainer', 'employee') then
          insert into public.facility_assignments(profile_id, facility_id)
          values (v_link.profile_id, v_facility_id)
          on conflict (profile_id, facility_id) do nothing;
        end if;
      end if;
    end if;

    v_response := jsonb_build_object(
      'ok', true,
      'replayed', false,
      'receiptId', v_receipt.id,
      'identityId', v_link.identity_id,
      'employeeId', v_link.employee_id,
      'profileId', v_link.profile_id,
      'lifecycleEventId', v_lifecycle_event_id,
      'status', v_link.lifecycle_state
    );
    perform set_config('app.identity_evidence_write', 'on', true);
    update public.scim_request_receipts
    set status = 'applied', response_body = v_response,
        identity_id = v_link.identity_id, employee_id = v_link.employee_id,
        completed_at = now()
    where id = v_receipt.id;
    return v_response;
  exception when others then
    get stacked diagnostics v_error_code = returned_sqlstate, v_error_message = message_text;
    v_response := jsonb_build_object(
      'ok', false,
      'replayed', false,
      'receiptId', v_receipt.id,
      'errorCode', v_error_code,
      'error', v_error_message
    );
    perform set_config('app.identity_evidence_write', 'on', true);
    update public.scim_request_receipts
    set status = 'rejected', response_body = v_response,
        error_code = v_error_code, completed_at = now()
    where id = v_receipt.id;
    return v_response;
  end;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Structured audit coverage and append-only domain evidence classification
-- ---------------------------------------------------------------------------

-- Phase 2 introduces salted credential digests and DNS challenge digests.
-- Keep those verifier materials out of the shared audit payload while still
-- retaining who changed the surrounding control-plane record and when.
create or replace function app_private.redact_audit_json(p_value jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_value is null then
    return null;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    select coalesce(
      jsonb_object_agg(
        e.key,
        case
          when lower(e.key) ~ '(^|_)(password|secret|auth_token|access_token|refresh_token|token_hash|checkin_pin_hash|api_key|encrypted_password|credential_hash|verification_challenge|salt)($|_)'
            then '"[REDACTED]"'::jsonb
          else app_private.redact_audit_json(e.value)
        end
      ),
      '{}'::jsonb
    )
    into v_result
    from jsonb_each(p_value) as e;
    return v_result;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    select coalesce(
      jsonb_agg(app_private.redact_audit_json(a.value) order by a.ordinality),
      '[]'::jsonb
    )
    into v_result
    from jsonb_array_elements(p_value) with ordinality as a(value, ordinality);
    return v_result;
  end if;

  return p_value;
end;
$function$;

revoke all on function app_private.redact_audit_json(jsonb)
from public, anon, authenticated;

insert into app_private.audit_entity_manifest (
  table_name, audit_mode, contains_regulated_data, rationale
)
select table_name, audit_mode, contains_regulated_data, rationale
from (values
  ('regulatory_rule_packs', 'row_trigger', false, 'Governed regulatory rule ownership'),
  ('regulatory_rule_versions', 'row_trigger', false, 'Immutable regulatory rule approval state'),
  ('regulatory_rule_golden_fixtures', 'row_trigger', false, 'Deterministic regulatory test inputs'),
  ('regulatory_rule_fixture_runs', 'domain_evidence', false, 'Append-only deterministic execution evidence'),
  ('regulatory_rule_shadow_runs', 'domain_evidence', true, 'Append-only tenant shadow evaluation evidence'),
  ('regulatory_rule_shadow_differences', 'domain_evidence', true, 'Append-only shadow variance evidence'),
  ('regulatory_rule_shadow_reconciliations', 'domain_evidence', true, 'Retained human reconciliation evidence'),
  ('organization_identity_domains', 'row_trigger', false, 'Verified tenant identity-domain control'),
  ('organization_sso_connections', 'row_trigger', false, 'Tenant SSO connection policy'),
  ('identity_subject_links', 'row_trigger', true, 'Immutable enterprise identity linkage'),
  ('identity_security_policies', 'row_trigger', false, 'Tenant privileged-session policy'),
  ('identity_break_glass_events', 'domain_evidence', true, 'Append-only emergency-access evidence'),
  ('identity_session_revocations', 'domain_evidence', true, 'Append-only session-revocation evidence'),
  ('scim_connections', 'row_trigger', true, 'SCIM connection and credential-rotation control'),
  ('scim_group_mappings', 'row_trigger', true, 'SCIM group-to-workforce policy'),
  ('scim_subject_links', 'domain_evidence', true, 'Retained SCIM subject lifecycle evidence'),
  ('scim_request_receipts', 'domain_evidence', true, 'Idempotent SCIM request and response evidence')
) as v(table_name, audit_mode, contains_regulated_data, rationale)
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

do $audit_triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'regulatory_rule_packs', 'regulatory_rule_versions',
    'regulatory_rule_golden_fixtures', 'organization_identity_domains',
    'organization_sso_connections', 'identity_subject_links',
    'identity_security_policies', 'scim_connections', 'scim_group_mappings'
  ] loop
    execute format(
      'create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()',
      v_table
    );
  end loop;
end;
$audit_triggers$;

-- ---------------------------------------------------------------------------
-- RLS and explicit Data API / RPC privileges
-- ---------------------------------------------------------------------------

alter table public.regulatory_rule_packs enable row level security;
alter table public.regulatory_rule_versions enable row level security;
alter table public.regulatory_rule_golden_fixtures enable row level security;
alter table public.regulatory_rule_fixture_runs enable row level security;
alter table public.regulatory_rule_shadow_runs enable row level security;
alter table public.regulatory_rule_shadow_differences enable row level security;
alter table public.regulatory_rule_shadow_reconciliations enable row level security;
alter table public.organization_identity_domains enable row level security;
alter table public.organization_sso_connections enable row level security;
alter table public.identity_subject_links enable row level security;
alter table public.identity_security_policies enable row level security;
alter table public.identity_break_glass_events enable row level security;
alter table public.identity_session_revocations enable row level security;
alter table public.scim_connections enable row level security;
alter table public.scim_group_mappings enable row level security;
alter table public.scim_subject_links enable row level security;
alter table public.scim_request_receipts enable row level security;

create policy regulatory_rule_packs_select on public.regulatory_rule_packs
for select to authenticated using (
  (select public.is_platform_admin())
  or exists (
    select 1 from public.regulatory_rule_versions v
    where v.rule_pack_id = regulatory_rule_packs.id
      and v.state in ('active', 'superseded')
  )
);
create policy regulatory_rule_packs_insert on public.regulatory_rule_packs
for insert to authenticated with check (
  (select public.is_platform_admin()) and owner_profile_id = (select auth.uid())
);
create policy regulatory_rule_packs_update on public.regulatory_rule_packs
for update to authenticated using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy regulatory_rule_versions_select on public.regulatory_rule_versions
for select to authenticated using (
  (select public.is_platform_admin()) or state in ('active', 'superseded')
);
create policy regulatory_rule_versions_insert on public.regulatory_rule_versions
for insert to authenticated with check (
  (select public.is_platform_admin())
  and state = 'draft'
  and authored_by = (select auth.uid())
);
create policy regulatory_rule_versions_update_draft on public.regulatory_rule_versions
for update to authenticated using (
  (select public.is_platform_admin()) and state = 'draft'
) with check (
  (select public.is_platform_admin()) and state = 'draft'
);

create policy regulatory_rule_golden_fixtures_select
on public.regulatory_rule_golden_fixtures for select to authenticated using (
  exists (
    select 1 from public.regulatory_rule_versions v
    where v.id = regulatory_rule_golden_fixtures.rule_version_id
      and ((select public.is_platform_admin()) or v.state in ('active', 'superseded'))
  )
);
create policy regulatory_rule_golden_fixtures_manage
on public.regulatory_rule_golden_fixtures for all to authenticated using (
  (select public.is_platform_admin()) and exists (
    select 1 from public.regulatory_rule_versions v
    where v.id = regulatory_rule_golden_fixtures.rule_version_id and v.state = 'draft'
  )
) with check (
  (select public.is_platform_admin())
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.regulatory_rule_versions v
    where v.id = regulatory_rule_golden_fixtures.rule_version_id and v.state = 'draft'
  )
);

create policy regulatory_fixture_runs_select on public.regulatory_rule_fixture_runs
for select to authenticated using ((select public.is_platform_admin()));
create policy regulatory_shadow_runs_select on public.regulatory_rule_shadow_runs
for select to authenticated using ((select public.is_platform_admin()));
create policy regulatory_shadow_differences_select on public.regulatory_rule_shadow_differences
for select to authenticated using ((select public.is_platform_admin()));
create policy regulatory_shadow_reconciliations_select
on public.regulatory_rule_shadow_reconciliations
for select to authenticated using ((select public.is_platform_admin()));

create policy identity_domains_select on public.organization_identity_domains
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);
create policy sso_connections_select on public.organization_sso_connections
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);
create policy sso_connections_manage on public.organization_sso_connections
for all to authenticated using (
  (select public.identity_assurance_is_current('identity_admin'))
  and (
    (select public.is_platform_admin())
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) = 'org_admin'
    )
  )
) with check (
  (select public.identity_assurance_is_current('identity_admin'))
  and (
    (select public.is_platform_admin())
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) = 'org_admin'
    )
  )
);
create policy identity_subject_links_select on public.identity_subject_links
for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'auditor')
  )
  or profile_id = (select auth.uid())
);
create policy identity_security_policies_select on public.identity_security_policies
for select to authenticated using (
  (select public.is_platform_admin()) or organization_id = (select public.current_org_id())
);
create policy identity_security_policies_manage on public.identity_security_policies
for all to authenticated using (
  (select public.identity_assurance_is_current('identity_admin'))
  and (
    (select public.is_platform_admin())
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) = 'org_admin'
    )
  )
) with check (
  (select public.identity_assurance_is_current('identity_admin'))
  and (
    (select public.is_platform_admin())
    or (
      organization_id = (select public.current_org_id())
      and (select public.current_role()) = 'org_admin'
    )
  )
);
create policy identity_break_glass_select on public.identity_break_glass_events
for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'auditor')
  )
  or target_profile_id = (select auth.uid())
);
create policy identity_session_revocations_select on public.identity_session_revocations
for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'auditor')
  )
  or profile_id = (select auth.uid())
);
create policy scim_group_mappings_select on public.scim_group_mappings
for select to authenticated using (
  exists (
    select 1 from public.scim_connections c
    where c.id = scim_group_mappings.scim_connection_id
      and (
        (select public.is_platform_admin())
        or c.organization_id = (select public.current_org_id())
      )
  )
);
create policy scim_group_mappings_manage on public.scim_group_mappings
for all to authenticated using (
  (select public.identity_assurance_is_current('scim_credential_rotation'))
  and exists (
    select 1 from public.scim_connections c
    where c.id = scim_group_mappings.scim_connection_id
      and (
        (select public.is_platform_admin())
        or (
          c.organization_id = (select public.current_org_id())
          and (select public.current_role()) = 'org_admin'
        )
      )
  )
) with check (
  (select public.identity_assurance_is_current('scim_credential_rotation'))
  and exists (
    select 1 from public.scim_connections c
    where c.id = scim_group_mappings.scim_connection_id
      and (
        (select public.is_platform_admin())
        or (
          c.organization_id = (select public.current_org_id())
          and (select public.current_role()) = 'org_admin'
        )
      )
  )
);
create policy scim_subject_links_select on public.scim_subject_links
for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'auditor')
  )
  or profile_id = (select auth.uid())
);
create policy scim_request_receipts_select on public.scim_request_receipts
for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'auditor')
  )
);

-- Remove PostgreSQL's implicit PUBLIC function execution and all broad table
-- access before adding the minimum Data API surface below.
revoke all on table
  public.regulatory_rule_packs,
  public.regulatory_rule_versions,
  public.regulatory_rule_golden_fixtures,
  public.regulatory_rule_fixture_runs,
  public.regulatory_rule_shadow_runs,
  public.regulatory_rule_shadow_differences,
  public.regulatory_rule_shadow_reconciliations,
  public.organization_identity_domains,
  public.organization_sso_connections,
  public.identity_subject_links,
  public.identity_security_policies,
  public.identity_break_glass_events,
  public.identity_session_revocations,
  public.scim_connections,
  public.scim_group_mappings,
  public.scim_subject_links,
  public.scim_request_receipts
from public, anon, authenticated, service_role;

grant select, insert, update on table public.regulatory_rule_packs to authenticated;
grant select, insert, update on table public.regulatory_rule_versions to authenticated;
grant select, insert, update, delete on table public.regulatory_rule_golden_fixtures to authenticated;
grant select on table
  public.regulatory_rule_fixture_runs,
  public.regulatory_rule_shadow_runs,
  public.regulatory_rule_shadow_differences,
  public.regulatory_rule_shadow_reconciliations,
  public.organization_identity_domains,
  public.identity_subject_links,
  public.identity_break_glass_events,
  public.identity_session_revocations,
  public.scim_subject_links,
  public.scim_request_receipts
to authenticated;
grant select, insert, update, delete on table public.organization_sso_connections to authenticated;
grant select, insert, update, delete on table public.identity_security_policies to authenticated;
grant select, insert, update, delete on table public.scim_group_mappings to authenticated;
grant select on table public.organization_identity_domains to service_role;

revoke all on function
  public.guard_regulatory_rule_version(),
  public.guard_regulatory_fixture(),
  public.prevent_append_only_evidence_mutation(),
  public.guard_identity_evidence_update(),
  public.validate_enterprise_identity_scope(),
  public.validate_identity_subject_link(),
  public.handle_new_user(),
  public.link_sso_auth_identity(),
  public.require_platform_rule_admin(text),
  public.require_identity_administrator(uuid, text)
from public, anon, authenticated, service_role;

revoke all on function public.identity_operation_requires_aal2(text) from public, anon, authenticated, service_role;
revoke all on function public.identity_assurance_is_current(text) from public, anon, authenticated, service_role;
revoke all on function public.assert_identity_assurance(text) from public, anon, authenticated, service_role;
revoke all on function public.submit_regulatory_rule_version(uuid) from public, anon, authenticated, service_role;
revoke all on function public.approve_regulatory_rule_version(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.start_regulatory_rule_shadow(uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_regulatory_fixture_result(uuid, text, jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_regulatory_shadow_run(uuid, uuid, text, uuid, timestamptz, timestamptz, integer, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.reconcile_regulatory_shadow_difference(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.activate_regulatory_rule_version(uuid) from public, anon, authenticated, service_role;
revoke all on function public.withdraw_regulatory_rule_version(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.get_regulatory_rule_snapshot(text, date) from public, anon, authenticated, service_role;
revoke all on function public.get_regulatory_rule_control_plane() from public, anon, authenticated, service_role;
revoke all on function public.register_identity_domain(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.verify_identity_domain(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.revoke_identity_domain(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.link_sso_identity_subject(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.grant_identity_break_glass(uuid, uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.revoke_identity_break_glass(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.revoke_identity_sessions(uuid, text, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.rotate_scim_connection_credential(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_scim_connection(uuid, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_scim_auth_material(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_identity_control_plane() from public, anon, authenticated, service_role;
revoke all on function public.get_scim_connection_registry() from public, anon, authenticated, service_role;
revoke all on function public.apply_scim_change(uuid, text, text, text, text, jsonb) from public, anon, authenticated, service_role;

grant execute on function
  public.identity_operation_requires_aal2(text),
  public.identity_assurance_is_current(text),
  public.assert_identity_assurance(text),
  public.submit_regulatory_rule_version(uuid),
  public.approve_regulatory_rule_version(uuid, text),
  public.start_regulatory_rule_shadow(uuid),
  public.record_regulatory_fixture_result(uuid, text, jsonb, text, text),
  public.record_regulatory_shadow_run(uuid, uuid, text, uuid, timestamptz, timestamptz, integer, text, text, jsonb),
  public.reconcile_regulatory_shadow_difference(uuid, text, text, text),
  public.activate_regulatory_rule_version(uuid),
  public.withdraw_regulatory_rule_version(uuid, text),
  public.get_regulatory_rule_snapshot(text, date),
  public.get_regulatory_rule_control_plane(),
  public.register_identity_domain(uuid, text, text),
  public.revoke_identity_domain(uuid, text),
  public.link_sso_identity_subject(uuid, text, uuid, text),
  public.grant_identity_break_glass(uuid, uuid, text, text, timestamptz),
  public.revoke_identity_break_glass(uuid, text),
  public.revoke_identity_sessions(uuid, text, text, text, boolean),
  public.rotate_scim_connection_credential(uuid),
  public.create_scim_connection(uuid, text, text, uuid),
  public.get_identity_control_plane(),
  public.get_scim_connection_registry()
to authenticated;

grant execute on function
  public.record_regulatory_fixture_result(uuid, text, jsonb, text, text),
  public.record_regulatory_shadow_run(uuid, uuid, text, uuid, timestamptz, timestamptz, integer, text, text, jsonb),
  public.verify_identity_domain(uuid, text),
  public.revoke_identity_sessions(uuid, text, text, text, boolean),
  public.get_scim_auth_material(uuid),
  public.apply_scim_change(uuid, text, text, text, text, jsonb)
to service_role;

comment on table public.regulatory_rule_versions is
  'Immutable once review begins; only governed RPCs may move the approval/shadow/activation state.';
comment on table public.identity_subject_links is
  'Provider subject plus identity_id is authoritative. Email lookup is forbidden for account linking.';
comment on table public.scim_request_receipts is
  'Append-preserved SCIM idempotency and replay evidence; provider secrets and raw payloads are never stored.';
comment on column public.scim_connections.credential_hash_sha256 is
  'Salted SHA-256 credential digest. The provider secret is never persisted.';
