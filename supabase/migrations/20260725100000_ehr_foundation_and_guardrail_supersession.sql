-- EHR foundation + guardrail supersession.
--
-- CareBase was originally built with a deliberate "no-EHR guardrail": the residents
-- record was administrative/compliance-only, excluding diagnoses, medications, orders,
-- vitals, care plans, and charting. That guardrail is intentionally superseded here:
-- clinical (EHR) capability is now a first-class part of the product, built as two lanes
--   * native clinical capture (staff are the source: vitals, care plans, assessments, notes)
--   * FHIR R4 ingestion boundary (external EHR/eMAR/pharmacy is the source of truth)
--
-- This migration establishes the shared access-control, audit, consent, and capability
-- primitives every clinical domain builds on. It creates no resident-facing clinical
-- table on its own -- those arrive in the per-domain migrations that follow.

-- 1. Clinical capability feature flag. Resolves to entitled-by-default for active/trial
--    tenants (feature_definitions default_value), and can be switched off per organization
--    through the existing package/organization_entitlement_grants machinery. Clinical data
--    remains commercially gated behind modules.carebase (the residents record already is).
insert into public.feature_definitions (
  feature_key, display_name, description, value_type, default_value, is_active
) values (
  'clinical.ehr',
  'CareBase Clinical (EHR)',
  'Native and FHIR-integrated clinical records: vitals/observations, medications, allergies, diagnoses/problem list, orders, care plans, assessments, and progress notes',
  'boolean', 'true'::jsonb, true
) on conflict (feature_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  value_type = excluded.value_type,
  is_active = true,
  updated_at = now();

-- 2. Clinical permission definitions + built-in role grants (mirrors the medication
--    boundary's permission model). These are necessary-but-not-sufficient: actual row
--    access is still gated by the clinical RLS/visibility helpers below.
--
--    Deliberately NOT granted to the `employee` built-in role: by convention that role
--    carries zero organization-wide role_template_permissions (see phase2_scope_workforce
--    test 25). Employee clinical charting is authorized structurally instead -- via
--    app_private.assert_clinical_contributor and app_private.clinical_record_visible, which
--    check current_role() = 'employee' plus an active employees-table assignment to the
--    resident's facility -- never through has_effective_permission.
insert into public.permission_definitions (permission_key, description, risk_level)
values
  ('clinical.read', 'Read resident clinical records (chart, vitals, medications, allergies, diagnoses, orders, care plans, assessments, notes)', 'sensitive'),
  ('clinical.chart', 'Record native clinical data (vitals/observations, care plans, assessments, progress notes)', 'sensitive'),
  ('clinical.manage', 'Configure clinical integrations, sign/lock and amend clinical records', 'privileged')
on conflict (permission_key) do nothing;

insert into public.role_template_permissions (role_template_id, permission_key)
select rt.id, permission_key
from public.role_templates rt
cross join lateral (
  select unnest(case rt.built_in_role
    when 'platform_admin' then array['clinical.read', 'clinical.chart', 'clinical.manage']::text[]
    when 'org_admin' then array['clinical.read', 'clinical.chart', 'clinical.manage']::text[]
    when 'facility_manager' then array['clinical.read', 'clinical.chart', 'clinical.manage']::text[]
    when 'auditor' then array['clinical.read']::text[]
    else array[]::text[]
  end) permission_key
) granted
where rt.built_in_role in ('platform_admin', 'org_admin', 'facility_manager', 'auditor')
on conflict (role_template_id, permission_key) do nothing;

-- 3. Capability gate. True for service_role/platform admins, otherwise the caller's own
--    organization must hold the clinical.ehr entitlement. Used by clinical write RPCs and
--    exposed to the UI through the existing public.org_feature_enabled('clinical.ehr').
create or replace function app_private.clinical_module_enabled()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.is_platform_admin() then
    return true;
  end if;
  if auth.uid() is null then return false; end if;
  v_org := public.current_org_id();
  if v_org is null then return false; end if;
  return public.has_effective_entitlement(v_org, 'clinical.ehr', 1, now());
end;
$$;
revoke all on function app_private.clinical_module_enabled() from public, anon;
grant execute on function app_private.clinical_module_enabled() to authenticated, service_role;

-- 4. Shared clinical read-visibility helper. Native clinical records are visible to
--    platform admins, the resident's org admins/auditors, assigned facility managers, and
--    employees actively assigned to the resident's facility. Employees have NO direct RLS
--    reach to residents, so this SECURITY DEFINER helper is their only clinical read path
--    (mirrors app_private.change_event_visible).
create or replace function app_private.clinical_record_visible(p_org uuid, p_fac uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or (
      p_org = public.current_org_id()
      and (
        public.current_role() in ('org_admin', 'auditor')
        or (public.current_role() = 'facility_manager' and public.is_assigned_to_facility(p_fac))
        or (
          public.current_role() = 'employee'
          and exists (
            select 1 from public.employees e
            where e.profile_id = auth.uid() and e.status = 'active' and e.facility_id = p_fac
          )
        )
      )
    )
$$;
revoke all on function app_private.clinical_record_visible(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.clinical_record_visible(uuid, uuid) to authenticated;

-- 5. Clinical write authorization helper (mirrors assert_change_event_contributor).
--    org_admin and assigned facility_manager may chart and manage; employees may chart
--    (author) at their assigned facility only; managing operations (sign/lock, amend,
--    configure integrations) require a manager. Called from SECURITY DEFINER RPCs.
create or replace function app_private.assert_clinical_contributor(
  p_org uuid,
  p_fac uuid,
  p_manage_required boolean default false
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_employee public.employees%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.is_platform_admin() then
    return;
  end if;
  if auth.uid() is null or public.current_org_id() <> p_org then
    raise exception 'Clinical operation is outside caller scope' using errcode = '42501';
  end if;
  if not app_private.clinical_module_enabled() then
    raise exception 'Clinical capability is not enabled for this organization' using errcode = '42501';
  end if;
  if public.current_role() = 'org_admin' then
    return;
  end if;
  if public.current_role() = 'facility_manager' then
    if not public.is_assigned_to_facility(p_fac) then
      raise exception 'Clinical operation is outside caller scope' using errcode = '42501';
    end if;
    return;
  end if;
  if p_manage_required or public.current_role() <> 'employee' then
    raise exception 'Manager access is required for this clinical operation' using errcode = '42501';
  end if;
  select * into v_employee from public.employees e
  where e.profile_id = auth.uid() and e.status = 'active' and e.facility_id = p_fac;
  if v_employee.id is null then
    raise exception 'Clinical charting is outside employee facility scope' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.assert_clinical_contributor(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

-- 6. Append-only guard for clinical evidence (amendments, history, signed records).
create or replace function app_private.prevent_clinical_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Clinical evidence records are append-only' using errcode = '55000';
end;
$$;
revoke all on function app_private.prevent_clinical_evidence_mutation()
  from public, anon, authenticated;

-- 7. Clinical access log -- HIPAA read/access auditing. The write-audit trigger
--    (public.audit_log_trigger) captures INSERT/UPDATE/DELETE but never SELECT, so
--    PHI reads are logged explicitly through public.log_clinical_access. Kept in
--    app_private; auditors read it through a SECURITY DEFINER RPC, never directly.
create table app_private.clinical_access_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete set null,
  resident_id uuid not null references public.residents(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  access_kind text not null check (access_kind in ('view_chart', 'view_domain', 'export', 'print')),
  clinical_domain text check (clinical_domain in (
    'summary', 'medications', 'allergies', 'conditions', 'orders',
    'vitals_observations', 'care_plans', 'assessments', 'progress_notes'
  )),
  minimum_necessary_reason text,
  correlation_id text,
  accessed_at timestamptz not null default now()
);
create index clinical_access_log_resident_idx
  on app_private.clinical_access_log(resident_id, accessed_at desc);
create index clinical_access_log_org_idx
  on app_private.clinical_access_log(organization_id, accessed_at desc);
revoke all on table app_private.clinical_access_log from public, anon, authenticated;
grant select, insert on table app_private.clinical_access_log to service_role;

create or replace function public.log_clinical_access(
  p_resident_id uuid,
  p_access_kind text,
  p_clinical_domain text default null,
  p_minimum_necessary_reason text default null,
  p_correlation_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_res public.residents%rowtype;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  if not app_private.clinical_record_visible(v_res.organization_id, v_res.facility_id) then
    raise exception 'Clinical access is outside caller scope' using errcode = '42501';
  end if;
  if p_access_kind not in ('view_chart', 'view_domain', 'export', 'print') then
    raise exception 'Invalid clinical access kind' using errcode = '22023';
  end if;
  insert into app_private.clinical_access_log (
    organization_id, facility_id, resident_id, actor_profile_id, actor_role,
    access_kind, clinical_domain, minimum_necessary_reason, correlation_id
  ) values (
    v_res.organization_id, v_res.facility_id, v_res.id, auth.uid(), public.current_role(),
    p_access_kind, nullif(p_clinical_domain, ''),
    nullif(btrim(p_minimum_necessary_reason), ''), nullif(p_correlation_id, '')
  );
end;
$$;
revoke all on function public.log_clinical_access(uuid, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.log_clinical_access(uuid, text, text, text, text) to authenticated;

-- 8. Resident-level clinical consent posture (HIPAA minimum-necessary / consent tracking).
alter table public.residents
  add column if not exists clinical_data_consent text not null default 'not_recorded'
    check (clinical_data_consent in ('not_recorded', 'granted', 'restricted', 'revoked'));
comment on column public.residents.clinical_data_consent is
  'Resident/representative consent posture for storing and sharing clinical (EHR) data. Supports HIPAA minimum-necessary and consent tracking; defaults not_recorded.';

-- 9. Guardrail supersession. The historical "no-EHR guardrail" lives as source comments in
--    prior (append-only) migrations; record the authoritative, current posture as a stored
--    table comment.
comment on table public.residents is
  'Resident master record. Originally administrative/compliance-only under a deliberate "no-EHR guardrail"; that guardrail was intentionally superseded 2026-07 when clinical (EHR) capability was added to the product. Clinical data now lives in dedicated native clinical_* and FHIR fhir_* tables, gated by the clinical.ehr entitlement and clinical RLS/visibility helpers. See docs/HIPAA_CLINICAL_DATA.md.';
