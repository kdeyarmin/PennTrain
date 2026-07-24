-- Per-facility clinical enablement.
--
-- M0 gated clinical capability at the organization level (clinical.ehr). This adds a
-- per-facility switch so an organization can enable EHR/clinical charting for some facilities
-- and not others. Defaults on (true) so existing behavior is unchanged; disabling a facility
-- blocks new native charting and clinical-integration configuration there, while previously
-- captured records stay readable.

alter table public.facilities
  add column if not exists clinical_enabled boolean not null default true;
comment on column public.facilities.clinical_enabled is
  'Per-facility EHR/clinical capability switch. Defaults true; when false, native clinical charting and clinical-integration configuration are blocked at this facility (existing records remain readable).';

create or replace function app_private.facility_clinical_enabled(p_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select f.clinical_enabled from public.facilities f where f.id = p_facility_id), false);
$$;
revoke all on function app_private.facility_clinical_enabled(uuid) from public, anon;
grant execute on function app_private.facility_clinical_enabled(uuid) to authenticated, service_role;

-- Re-define the native charting write gate to also require the facility switch (adds the
-- facility check to the M0 definition; all other behavior is unchanged).
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
  if not app_private.facility_clinical_enabled(p_fac) then
    raise exception 'Clinical capability is not enabled for this facility' using errcode = '42501';
  end if;
  -- SECURITY DEFINER charting bypasses the restrictive product_module_entitlement RLS on the
  -- clinical tables, so enforce the CareBase module here too (the read path already checks it).
  if not app_private.has_product_module('modules.carebase') then
    raise exception 'The CareBase module is not entitled for this organization' using errcode = '42501';
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

-- Also require the facility switch for clinical-integration (FHIR) configuration.
create or replace function app_private.assert_clinical_integration_scope(
  p_organization_id uuid, p_facility_id uuid, p_permission_key text
) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() and (
    public.current_org_id() is distinct from p_organization_id
    or not public.is_assigned_to_facility(p_facility_id)
    or not app_private.facility_clinical_enabled(p_facility_id)
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

-- Admin toggle: enable/disable clinical capability for a facility.
create or replace function public.set_facility_clinical_enabled(p_facility_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.facilities where id = p_facility_id;
  if v_org is null then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  if not public.is_platform_admin() and (
    public.current_org_id() is distinct from v_org
    or public.current_role() is distinct from 'org_admin'
  ) then
    raise exception 'Only an organization administrator can change facility clinical enablement' using errcode = '42501';
  end if;
  update public.facilities set clinical_enabled = p_enabled, updated_at = now() where id = p_facility_id;
  return p_enabled;
end;
$$;
revoke all on function public.set_facility_clinical_enabled(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_facility_clinical_enabled(uuid, boolean) to authenticated;
