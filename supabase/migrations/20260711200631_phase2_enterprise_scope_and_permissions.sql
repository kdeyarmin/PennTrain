-- Phase 2.1: enterprise hierarchy, effective scope membership, and permissions.
--
-- This is deliberately additive. Existing profiles.role and facility_assignments
-- remain the application compatibility surface while their meaning is shadowed
-- into an effective-dated model that can represent portfolio and region access.

-- Re-establish the active-profile boundary after a later subscription helper
-- migration accidentally omitted it. A disabled profile or blocked tenant must
-- resolve to no legacy role/scope even while an already-issued JWT is valid.
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  left join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
    and p.is_active
    and (
      p.role = 'platform_admin'
      or (o.id is not null and o.subscription_status not in ('suspended', 'canceled'))
    );
$$;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
    and p.is_active
    and o.subscription_status not in ('suspended', 'canceled');
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'platform_admin' and p.is_active
  );
$$;

create or replace function public.is_assigned_to_facility(target_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or public.current_role() in ('org_admin', 'auditor')
    or exists (
      select 1
      from public.facility_assignments fa
      join public.profiles p on p.id = fa.profile_id and p.is_active
      join public.facilities f on f.id = fa.facility_id
      join public.organizations o
        on o.id = f.organization_id
       and o.subscription_status not in ('suspended', 'canceled')
      where fa.profile_id = auth.uid()
        and fa.facility_id = target_facility_id
        and p.organization_id = f.organization_id
    );
$$;

revoke all on function public.current_role(), public.current_org_id(),
  public.is_platform_admin(), public.is_assigned_to_facility(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.current_role(), public.current_org_id(),
  public.is_platform_admin(), public.is_assigned_to_facility(uuid)
to authenticated;

create table public.enterprise_portfolios (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (length(trim(name)) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.enterprise_portfolios
for each row execute function public.set_updated_at();

create table public.enterprise_regions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.enterprise_portfolios(id) on delete restrict,
  code text not null check (code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (length(trim(name)) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portfolio_id, code),
  unique (id, portfolio_id)
);

create index enterprise_regions_portfolio_idx
  on public.enterprise_regions(portfolio_id, status);
create trigger set_updated_at before update on public.enterprise_regions
for each row execute function public.set_updated_at();

create table public.enterprise_organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  portfolio_id uuid not null references public.enterprise_portfolios(id) on delete restrict,
  region_id uuid not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  source text not null default 'manual'
    check (source in ('manual', 'legacy_shadow_backfill', 'import', 'scim', 'api')),
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint enterprise_org_membership_region_fk
    foreign key (region_id, portfolio_id)
    references public.enterprise_regions(id, portfolio_id) on delete restrict,
  constraint enterprise_org_membership_window_check
    check (effective_to is null or effective_to >= effective_from)
);

create index enterprise_org_membership_effective_idx
  on public.enterprise_organization_memberships(
    organization_id,
    effective_from,
    effective_to
  );
create unique index enterprise_org_membership_current_uidx
  on public.enterprise_organization_memberships(organization_id)
  where effective_to is null;

create table public.enterprise_scope_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  scope_type text not null
    check (scope_type in ('platform', 'portfolio', 'region', 'organization', 'facility')),
  portfolio_id uuid references public.enterprise_portfolios(id) on delete restrict,
  region_id uuid references public.enterprise_regions(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  facility_id uuid references public.facilities(id) on delete restrict,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  source text not null default 'manual'
    check (source in ('manual', 'legacy_shadow_backfill', 'import', 'scim', 'api')),
  legacy_role text,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint enterprise_scope_membership_window_check
    check (effective_to is null or effective_to >= effective_from),
  constraint enterprise_scope_membership_shape_check check (
    (scope_type = 'platform' and portfolio_id is null and region_id is null
      and organization_id is null and facility_id is null)
    or (scope_type = 'portfolio' and portfolio_id is not null and region_id is null
      and organization_id is null and facility_id is null)
    or (scope_type = 'region' and portfolio_id is null and region_id is not null
      and organization_id is null and facility_id is null)
    or (scope_type = 'organization' and portfolio_id is null and region_id is null
      and organization_id is not null and facility_id is null)
    or (scope_type = 'facility' and portfolio_id is null and region_id is null
      and organization_id is null and facility_id is not null)
  )
);

create index enterprise_scope_memberships_profile_effective_idx
  on public.enterprise_scope_memberships(profile_id, effective_from, effective_to);
create index enterprise_scope_memberships_org_idx
  on public.enterprise_scope_memberships(organization_id)
  where organization_id is not null;
create index enterprise_scope_memberships_facility_idx
  on public.enterprise_scope_memberships(facility_id)
  where facility_id is not null;

create table public.permission_definitions (
  permission_key text primary key
    check (permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  description text not null,
  risk_level text not null default 'standard'
    check (risk_level in ('standard', 'sensitive', 'privileged')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.permission_definitions
for each row execute function public.set_updated_at();

create table public.role_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_.-]{2,95}$'),
  name text not null check (length(trim(name)) between 1 and 160),
  description text not null default '',
  built_in_role text
    check (built_in_role is null or built_in_role in (
      'platform_admin', 'org_admin', 'facility_manager',
      'trainer', 'employee', 'auditor'
    )),
  is_system_managed boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint role_template_system_shape_check check (
    (is_system_managed and built_in_role is not null and organization_id is null)
    or (not is_system_managed and built_in_role is null)
  )
);

create unique index role_templates_builtin_role_uidx
  on public.role_templates(built_in_role)
  where built_in_role is not null;
create unique index role_templates_system_code_uidx
  on public.role_templates(code) where organization_id is null;
create unique index role_templates_org_code_uidx
  on public.role_templates(organization_id, code) where organization_id is not null;
create trigger set_updated_at before update on public.role_templates
for each row execute function public.set_updated_at();

create table public.role_template_permissions (
  role_template_id uuid not null references public.role_templates(id) on delete restrict,
  permission_key text not null
    references public.permission_definitions(permission_key) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_template_id, permission_key)
);

create table public.enterprise_access_grants (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null
    references public.enterprise_scope_memberships(id) on delete restrict,
  role_template_id uuid not null references public.role_templates(id) on delete restrict,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  source text not null default 'manual'
    check (source in ('manual', 'legacy_shadow_backfill', 'import', 'scim', 'api')),
  reason text not null default '',
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint enterprise_access_grant_window_check
    check (effective_to is null or effective_to >= effective_from)
);

create index enterprise_access_grants_membership_effective_idx
  on public.enterprise_access_grants(membership_id, effective_from, effective_to);
create unique index enterprise_access_grants_current_uidx
  on public.enterprise_access_grants(membership_id, role_template_id)
  where effective_to is null;

create table public.enterprise_scope_backfill_exceptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  exception_code text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  resolution_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint enterprise_scope_exception_resolution_check check (
    (status = 'open' and resolved_at is null)
    or (status in ('resolved', 'ignored') and resolved_at is not null)
  )
);

create unique index enterprise_scope_backfill_open_uidx
  on public.enterprise_scope_backfill_exceptions(profile_id, exception_code)
  where status = 'open';

-- Validate effective windows with trigger-time checks so no optional extension
-- is required and legacy installations can replay this migration unchanged.
create or replace function app_private.validate_enterprise_org_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.enterprise_organization_memberships as existing
    where existing.organization_id = new.organization_id
      and existing.id <> new.id
      and tstzrange(existing.effective_from, existing.effective_to, '[)')
          && tstzrange(new.effective_from, new.effective_to, '[)')
  ) then
    raise exception 'organization % already has an enterprise hierarchy membership in this window',
      new.organization_id using errcode = '23P01';
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_enterprise_org_membership()
from public, anon, authenticated, service_role;

create trigger validate_enterprise_org_membership
before insert or update on public.enterprise_organization_memberships
for each row execute function app_private.validate_enterprise_org_membership();

create or replace function app_private.validate_enterprise_scope_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid := coalesce(
    new.portfolio_id, new.region_id, new.organization_id, new.facility_id
  );
begin
  if new.scope_type = 'organization' and not exists (
    select 1 from public.profiles p
    where p.id = new.profile_id and p.organization_id = new.organization_id
  ) then
    raise exception 'profile organization does not match organization scope'
      using errcode = '23514';
  elsif new.scope_type = 'facility' and not exists (
    select 1
    from public.profiles p
    join public.facilities f on f.id = new.facility_id
    where p.id = new.profile_id and p.organization_id = f.organization_id
  ) then
    raise exception 'profile organization does not match facility scope'
      using errcode = '23514';
  end if;

  if new.scope_type = 'region' and not exists (
    select 1 from public.enterprise_regions as r
    where r.id = new.region_id and r.status = 'active'
  ) then
    raise exception 'region scope % is not active', new.region_id
      using errcode = '23514';
  elsif new.scope_type = 'facility' and not exists (
    select 1 from public.facilities as f
    where f.id = new.facility_id and f.is_active
  ) then
    raise exception 'facility scope % is not active', new.facility_id
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.enterprise_scope_memberships as existing
    where existing.profile_id = new.profile_id
      and existing.scope_type = new.scope_type
      and existing.id <> new.id
      and coalesce(
        existing.portfolio_id, existing.region_id,
        existing.organization_id, existing.facility_id,
        '00000000-0000-0000-0000-000000000000'::uuid
      ) = coalesce(v_scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and tstzrange(existing.effective_from, existing.effective_to, '[)')
          && tstzrange(new.effective_from, new.effective_to, '[)')
  ) then
    raise exception 'profile % already has this effective scope in the requested window',
      new.profile_id using errcode = '23P01';
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_enterprise_scope_membership()
from public, anon, authenticated, service_role;

create trigger validate_enterprise_scope_membership
before insert or update on public.enterprise_scope_memberships
for each row execute function app_private.validate_enterprise_scope_membership();

create or replace function app_private.scope_is_operational(
  p_scope_type text,
  p_scope_id uuid,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_scope_type
    when 'platform' then true
    when 'portfolio' then exists (
      select 1 from public.enterprise_portfolios p
      where p.id = p_scope_id and p.status = 'active'
    )
    when 'region' then exists (
      select 1
      from public.enterprise_regions r
      join public.enterprise_portfolios p on p.id = r.portfolio_id
      where r.id = p_scope_id and r.status = 'active' and p.status = 'active'
    )
    when 'organization' then exists (
      select 1
      from public.organizations o
      join public.enterprise_organization_memberships m
        on m.organization_id = o.id
       and m.effective_from <= p_at
       and (m.effective_to is null or m.effective_to > p_at)
      join public.enterprise_regions r on r.id = m.region_id and r.status = 'active'
      join public.enterprise_portfolios p
        on p.id = m.portfolio_id and p.status = 'active'
      where o.id = p_scope_id
        and o.subscription_status not in ('suspended', 'canceled')
    )
    when 'facility' then exists (
      select 1
      from public.facilities f
      join public.organizations o on o.id = f.organization_id
      where f.id = p_scope_id and f.is_active
        and o.subscription_status not in ('suspended', 'canceled')
        and app_private.scope_is_operational(
          'organization', o.id, p_at
        )
    )
    else false
  end;
$$;

revoke all on function app_private.scope_is_operational(text, uuid, timestamptz)
from public, anon, authenticated, service_role;

create or replace function app_private.scope_contains(
  p_parent_type text,
  p_parent_id uuid,
  p_child_type text,
  p_child_id uuid,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.scope_is_operational(p_parent_type, p_parent_id, p_at)
    and app_private.scope_is_operational(p_child_type, p_child_id, p_at)
    and case
    when p_parent_type = 'platform' then true
    when p_parent_type = p_child_type then p_parent_id = p_child_id
    when p_parent_type = 'portfolio' and p_child_type = 'region' then exists (
      select 1 from public.enterprise_regions r
      where r.id = p_child_id and r.portfolio_id = p_parent_id
    )
    when p_parent_type = 'portfolio' and p_child_type = 'organization' then exists (
      select 1 from public.enterprise_organization_memberships m
      where m.organization_id = p_child_id and m.portfolio_id = p_parent_id
        and m.effective_from <= p_at and (m.effective_to is null or m.effective_to > p_at)
    )
    when p_parent_type = 'portfolio' and p_child_type = 'facility' then exists (
      select 1
      from public.facilities f
      join public.enterprise_organization_memberships m
        on m.organization_id = f.organization_id
      where f.id = p_child_id and m.portfolio_id = p_parent_id
        and m.effective_from <= p_at and (m.effective_to is null or m.effective_to > p_at)
    )
    when p_parent_type = 'region' and p_child_type = 'organization' then exists (
      select 1 from public.enterprise_organization_memberships m
      where m.organization_id = p_child_id and m.region_id = p_parent_id
        and m.effective_from <= p_at and (m.effective_to is null or m.effective_to > p_at)
    )
    when p_parent_type = 'region' and p_child_type = 'facility' then exists (
      select 1
      from public.facilities f
      join public.enterprise_organization_memberships m
        on m.organization_id = f.organization_id
      where f.id = p_child_id and m.region_id = p_parent_id
        and m.effective_from <= p_at and (m.effective_to is null or m.effective_to > p_at)
    )
    when p_parent_type = 'organization' and p_child_type = 'facility' then exists (
      select 1 from public.facilities f
      where f.id = p_child_id and f.organization_id = p_parent_id
    )
    else false
  end;
$$;

revoke all on function app_private.scope_contains(text, uuid, text, uuid, timestamptz)
from public, anon, authenticated, service_role;

create or replace function app_private.profile_has_effective_permission(
  p_profile_id uuid,
  p_permission_key text,
  p_scope_type text,
  p_scope_id uuid,
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
    from public.profiles p
    join public.enterprise_scope_memberships m on m.profile_id = p.id
    join public.enterprise_access_grants g on g.membership_id = m.id
    join public.role_templates rt on rt.id = g.role_template_id and rt.is_active
    join public.role_template_permissions rtp on rtp.role_template_id = rt.id
    join public.permission_definitions pd
      on pd.permission_key = rtp.permission_key and pd.is_active
    where p.id = p_profile_id
      and p.is_active
      and (
        p.role = 'platform_admin'
        or exists (
          select 1 from public.organizations caller_org
          where caller_org.id = p.organization_id
            and caller_org.subscription_status not in ('suspended', 'canceled')
        )
      )
      and pd.permission_key = p_permission_key
      and m.effective_from <= p_at and (m.effective_to is null or m.effective_to > p_at)
      and g.effective_from <= p_at and (g.effective_to is null or g.effective_to > p_at)
      and app_private.scope_contains(
        m.scope_type,
        coalesce(m.portfolio_id, m.region_id, m.organization_id, m.facility_id),
        p_scope_type,
        p_scope_id,
        p_at
      )
  );
$$;

revoke all on function app_private.profile_has_effective_permission(
  uuid, text, text, uuid, timestamptz
) from public, anon, authenticated, service_role;

create or replace function public.has_effective_permission(
  p_permission_key text,
  p_scope_type text,
  p_scope_id uuid,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.profile_has_effective_permission(
    auth.uid(), p_permission_key, p_scope_type, p_scope_id, p_at
  );
$$;

revoke all on function public.has_effective_permission(text, text, uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.has_effective_permission(text, text, uuid, timestamptz)
to authenticated;

create or replace function app_private.assert_phase2_aal2()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role', '') = 'service_role' then
    return;
  end if;
  if auth.uid() is null or coalesce(auth.jwt()->>'aal', '') <> 'aal2' then
    raise exception 'AAL2 multi-factor authentication is required for this operation'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.assert_phase2_aal2()
from public, anon, authenticated, service_role;

create or replace function app_private.validate_enterprise_access_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.enterprise_scope_memberships%rowtype;
  v_template_org uuid;
  v_scope_id uuid;
begin
  select * into v_membership
  from public.enterprise_scope_memberships
  where id = new.membership_id;

  if v_membership.id is null then
    raise exception 'scope membership % not found', new.membership_id
      using errcode = '23503';
  end if;

  if new.effective_from < v_membership.effective_from
     or (v_membership.effective_to is not null
         and (new.effective_to is null or new.effective_to > v_membership.effective_to)) then
    raise exception 'access grant must be contained within its membership window'
      using errcode = '23514';
  end if;

  select organization_id into v_template_org
  from public.role_templates where id = new.role_template_id;
  v_scope_id := coalesce(
    v_membership.portfolio_id, v_membership.region_id,
    v_membership.organization_id, v_membership.facility_id
  );

  if v_template_org is not null and not app_private.scope_contains(
    'organization', v_template_org,
    v_membership.scope_type, v_scope_id, new.effective_from
  ) then
    raise exception 'organization role template cannot be granted outside its organization'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.enterprise_access_grants existing
    where existing.membership_id = new.membership_id
      and existing.role_template_id = new.role_template_id
      and existing.id <> new.id
      and tstzrange(existing.effective_from, existing.effective_to, '[)')
          && tstzrange(new.effective_from, new.effective_to, '[)')
  ) then
    raise exception 'role template grant overlaps an existing effective grant'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_enterprise_access_grant()
from public, anon, authenticated, service_role;

create trigger validate_enterprise_access_grant
before insert or update on public.enterprise_access_grants
for each row execute function app_private.validate_enterprise_access_grant();

-- Permission catalog and immutable built-in templates. Custom templates may be
-- added later without mutating the legacy role contract.
insert into public.permission_definitions(permission_key, description, risk_level) values
  ('enterprise.scope.read', 'Read enterprise hierarchy and effective access', 'sensitive'),
  ('enterprise.scope.manage', 'Manage hierarchy, memberships, and role grants', 'privileged'),
  ('workforce.lifecycle.read', 'Read workforce people and employment lifecycle', 'sensitive'),
  ('workforce.lifecycle.manage', 'Apply guarded workforce lifecycle transitions', 'privileged'),
  ('workforce.compliance.read', 'Read governed compliance profile resolution', 'sensitive'),
  ('workforce.compliance.manage', 'Manage compliance profiles and assignments', 'privileged'),
  ('workforce.evidence.read', 'Read immutable workforce evidence', 'sensitive'),
  ('workforce.self.read', 'Read the caller own workforce and compliance record', 'standard');

insert into public.role_templates(
  code, name, description, built_in_role, is_system_managed
) values
  ('builtin.platform_admin', 'Platform administrator', 'Global enterprise administration', 'platform_admin', true),
  ('builtin.org_admin', 'Organization administrator', 'Organization-wide workforce administration', 'org_admin', true),
  ('builtin.facility_manager', 'Facility manager', 'Assigned-facility workforce administration', 'facility_manager', true),
  ('builtin.trainer', 'Trainer', 'Assigned-facility training and compliance reader', 'trainer', true),
  ('builtin.employee', 'Employee', 'Own workforce record reader', 'employee', true),
  ('builtin.auditor', 'Auditor', 'Read-only organization evidence reviewer', 'auditor', true);

insert into public.role_template_permissions(role_template_id, permission_key)
select rt.id, permissions.permission_key
from public.role_templates rt
cross join lateral (
  select unnest(case rt.built_in_role
    when 'platform_admin' then array[
      'enterprise.scope.read', 'enterprise.scope.manage',
      'workforce.lifecycle.read', 'workforce.lifecycle.manage',
      'workforce.compliance.read', 'workforce.compliance.manage',
      'workforce.evidence.read'
    ]::text[]
    when 'org_admin' then array[
      'enterprise.scope.read', 'enterprise.scope.manage',
      'workforce.lifecycle.read', 'workforce.lifecycle.manage',
      'workforce.compliance.read', 'workforce.compliance.manage',
      'workforce.evidence.read'
    ]::text[]
    when 'facility_manager' then array[
      'enterprise.scope.read', 'workforce.lifecycle.read',
      'workforce.lifecycle.manage', 'workforce.compliance.read',
      'workforce.compliance.manage', 'workforce.evidence.read'
    ]::text[]
    when 'trainer' then array[
      'enterprise.scope.read', 'workforce.lifecycle.read',
      'workforce.compliance.read', 'workforce.evidence.read'
    ]::text[]
    when 'auditor' then array[
      'enterprise.scope.read', 'workforce.lifecycle.read',
      'workforce.compliance.read', 'workforce.evidence.read'
    ]::text[]
    else array[]::text[]
  end) as permission_key
) permissions
where rt.is_system_managed;

create or replace function app_private.protect_builtin_role_catalog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'role_templates'
     and (old.is_system_managed or coalesce(new.is_system_managed, false)) then
    raise exception 'built-in role templates are immutable'
      using errcode = '42501';
  elsif tg_table_name = 'role_template_permissions'
     and exists (
       select 1 from public.role_templates rt
       where rt.id = coalesce(old.role_template_id, new.role_template_id)
         and rt.is_system_managed
     ) then
    raise exception 'built-in role permissions are immutable'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function app_private.protect_builtin_role_catalog()
from public, anon, authenticated, service_role;

create trigger protect_builtin_role_template
before update or delete on public.role_templates
for each row execute function app_private.protect_builtin_role_catalog();
create trigger protect_builtin_role_permissions
before update or delete on public.role_template_permissions
for each row execute function app_private.protect_builtin_role_catalog();

-- Shadow each legacy organization into an isolated portfolio/region. No
-- existing tenant is broadened into a shared parent scope during migration.
insert into public.enterprise_portfolios(code, name)
select 'legacy-' || o.slug, o.name || ' Portfolio'
from public.organizations o
on conflict (code) do nothing;

insert into public.enterprise_regions(portfolio_id, code, name)
select p.id, 'legacy-default', o.name || ' Default Region'
from public.organizations o
join public.enterprise_portfolios p on p.code = 'legacy-' || o.slug
on conflict (portfolio_id, code) do nothing;

insert into public.enterprise_organization_memberships(
  organization_id, portfolio_id, region_id, effective_from, source, reason
)
select o.id, p.id, r.id, o.created_at, 'legacy_shadow_backfill',
  'One-tenant shadow hierarchy created for Phase 2 compatibility'
from public.organizations o
join public.enterprise_portfolios p on p.code = 'legacy-' || o.slug
join public.enterprise_regions r
  on r.portfolio_id = p.id and r.code = 'legacy-default'
where not exists (
  select 1 from public.enterprise_organization_memberships existing
  where existing.organization_id = o.id and existing.effective_to is null
);

insert into public.enterprise_scope_memberships(
  profile_id, scope_type, effective_from, source, legacy_role, reason
)
select p.id, 'platform', p.created_at, 'legacy_shadow_backfill', p.role,
  'Shadowed from profiles.role'
from public.profiles p
where p.role = 'platform_admin';

insert into public.enterprise_scope_memberships(
  profile_id, scope_type, organization_id, effective_from,
  source, legacy_role, reason
)
select p.id, 'organization', p.organization_id, p.created_at,
  'legacy_shadow_backfill', p.role, 'Shadowed from profiles.role'
from public.profiles p
where p.organization_id is not null
  and p.role in ('org_admin', 'auditor', 'employee');

insert into public.enterprise_scope_memberships(
  profile_id, scope_type, facility_id, effective_from,
  source, legacy_role, reason
)
select p.id, 'facility', fa.facility_id, greatest(p.created_at, fa.created_at),
  'legacy_shadow_backfill', p.role, 'Shadowed from facility_assignments'
from public.profiles p
join public.facility_assignments fa on fa.profile_id = p.id
join public.facilities f
  on f.id = fa.facility_id and f.organization_id = p.organization_id
where p.role in ('facility_manager', 'trainer');

insert into public.enterprise_access_grants(
  membership_id, role_template_id, effective_from, source, reason
)
select m.id, rt.id, m.effective_from, 'legacy_shadow_backfill',
  'Built-in template shadowed from profiles.role'
from public.enterprise_scope_memberships m
join public.role_templates rt on rt.built_in_role = m.legacy_role
where m.source = 'legacy_shadow_backfill';

-- Idempotent adapters keep the shadow model complete after this migration.
-- They intentionally own built-in role projection so SSO/JIT and normal user
-- creation cannot create duplicate memberships through provider-specific code.
create or replace function app_private.ensure_enterprise_organization_hierarchy(
  p_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations%rowtype;
  v_portfolio_id uuid;
  v_region_id uuid;
  v_code text;
begin
  select * into v_org from public.organizations where id = p_organization_id;
  if v_org.id is null then
    raise exception 'organization % not found', p_organization_id
      using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.enterprise_organization_memberships m
    where m.organization_id = p_organization_id and m.effective_to is null
  ) then
    return;
  end if;

  v_code := 'org-' || replace(p_organization_id::text, '-', '');
  insert into public.enterprise_portfolios(code, name)
  values (v_code, v_org.name || ' Portfolio')
  on conflict (code) do update set name = excluded.name
  returning id into v_portfolio_id;

  insert into public.enterprise_regions(portfolio_id, code, name)
  values (v_portfolio_id, 'default', v_org.name || ' Default Region')
  on conflict (portfolio_id, code) do update set name = excluded.name
  returning id into v_region_id;

  insert into public.enterprise_organization_memberships(
    organization_id, portfolio_id, region_id, effective_from,
    source, reason
  ) values (
    p_organization_id, v_portfolio_id, v_region_id, v_org.created_at,
    'api', 'Automatically provisioned tenant hierarchy'
  );
end;
$$;

revoke all on function app_private.ensure_enterprise_organization_hierarchy(uuid)
from public, anon, authenticated, service_role;

create or replace function app_private.provision_enterprise_organization_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.ensure_enterprise_organization_hierarchy(new.id);
  return new;
end;
$$;

revoke all on function app_private.provision_enterprise_organization_trigger()
from public, anon, authenticated, service_role;
create trigger provision_enterprise_organization
after insert on public.organizations
for each row execute function app_private.provision_enterprise_organization_trigger();

create or replace function app_private.ensure_builtin_scope_grant(
  p_profile_id uuid,
  p_role text,
  p_scope_type text,
  p_scope_id uuid,
  p_effective_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
  v_template_id uuid;
begin
  select m.id into v_membership_id
  from public.enterprise_scope_memberships m
  where m.profile_id = p_profile_id and m.scope_type = p_scope_type
    and coalesce(
      m.portfolio_id, m.region_id, m.organization_id, m.facility_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    ) = coalesce(p_scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and m.effective_to is null
  order by m.effective_from desc limit 1;

  if v_membership_id is null then
    insert into public.enterprise_scope_memberships(
      profile_id, scope_type, portfolio_id, region_id,
      organization_id, facility_id, effective_from,
      source, legacy_role, reason
    ) values (
      p_profile_id, p_scope_type,
      case when p_scope_type = 'portfolio' then p_scope_id end,
      case when p_scope_type = 'region' then p_scope_id end,
      case when p_scope_type = 'organization' then p_scope_id end,
      case when p_scope_type = 'facility' then p_scope_id end,
      p_effective_at, 'api', p_role,
      'Automatically projected from built-in profile role'
    ) returning id into v_membership_id;
  end if;

  select id into v_template_id
  from public.role_templates
  where built_in_role = p_role and is_active;
  if v_template_id is not null and not exists (
    select 1 from public.enterprise_access_grants g
    where g.membership_id = v_membership_id
      and g.role_template_id = v_template_id
      and g.effective_to is null
  ) then
    insert into public.enterprise_access_grants(
      membership_id, role_template_id, effective_from, source, reason
    ) values (
      v_membership_id, v_template_id, p_effective_at, 'api',
      'Automatically projected from built-in profile role'
    );
  end if;
  return v_membership_id;
end;
$$;

revoke all on function app_private.ensure_builtin_scope_grant(
  uuid, text, text, uuid, timestamptz
) from public, anon, authenticated, service_role;

create or replace function app_private.sync_profile_builtin_enterprise_access(
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_membership_id uuid;
  v_now timestamptz := now();
  v_facility_id uuid;
begin
  select * into v_profile from public.profiles where id = p_profile_id;
  if v_profile.id is null then
    return;
  end if;

  for v_membership_id in
    select m.id
    from public.enterprise_scope_memberships m
    where m.profile_id = p_profile_id
      and m.legacy_role is not null
      and m.effective_to is null
      and not (
        m.legacy_role = v_profile.role and (
        (v_profile.role = 'platform_admin' and m.scope_type = 'platform')
        or (v_profile.role in ('org_admin', 'auditor', 'employee')
            and m.scope_type = 'organization'
            and m.organization_id = v_profile.organization_id)
        or (v_profile.role in ('facility_manager', 'trainer')
            and m.scope_type = 'facility'
            and exists (
              select 1
              from public.facility_assignments fa
              join public.facilities f on f.id = fa.facility_id
              where fa.profile_id = p_profile_id
                and fa.facility_id = m.facility_id
                and f.organization_id = v_profile.organization_id
            ))
        )
      )
  loop
    update public.enterprise_access_grants
    set effective_to = greatest(v_now, effective_from),
        reason = case when reason = '' then 'Ended after profile role/scope change'
                      else reason || '; ended after profile role/scope change' end
    where membership_id = v_membership_id and effective_to is null;
    update public.enterprise_scope_memberships
    set effective_to = greatest(v_now, effective_from),
        reason = case when reason is null then 'Ended after profile role/scope change'
                      else reason || '; ended after profile role/scope change' end
    where id = v_membership_id;
  end loop;

  if v_profile.role = 'platform_admin' then
    perform app_private.ensure_builtin_scope_grant(
      p_profile_id, v_profile.role, 'platform', null, v_now
    );
  elsif v_profile.role in ('org_admin', 'auditor', 'employee')
        and v_profile.organization_id is not null then
    perform app_private.ensure_enterprise_organization_hierarchy(
      v_profile.organization_id
    );
    perform app_private.ensure_builtin_scope_grant(
      p_profile_id, v_profile.role, 'organization',
      v_profile.organization_id, v_now
    );
  elsif v_profile.role in ('facility_manager', 'trainer') then
    for v_facility_id in
      select fa.facility_id
      from public.facility_assignments fa
      join public.facilities f on f.id = fa.facility_id
      where fa.profile_id = p_profile_id
        and f.organization_id = v_profile.organization_id
    loop
      perform app_private.ensure_builtin_scope_grant(
        p_profile_id, v_profile.role, 'facility', v_facility_id, v_now
      );
    end loop;
  end if;
end;
$$;

revoke all on function app_private.sync_profile_builtin_enterprise_access(uuid)
from public, anon, authenticated, service_role;

create or replace function app_private.sync_profile_builtin_enterprise_access_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.sync_profile_builtin_enterprise_access(new.id);
  return new;
end;
$$;

revoke all on function app_private.sync_profile_builtin_enterprise_access_trigger()
from public, anon, authenticated, service_role;
create trigger sync_profile_builtin_enterprise_access
after insert or update of role, organization_id on public.profiles
for each row execute function app_private.sync_profile_builtin_enterprise_access_trigger();

create or replace function app_private.sync_facility_assignment_enterprise_access_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.facility_assignments%rowtype;
  v_profile public.profiles%rowtype;
  v_membership_id uuid;
  v_now timestamptz := now();
begin
  if tg_op = 'DELETE' then
    v_assignment := old;
  else
    v_assignment := new;
  end if;
  select * into v_profile from public.profiles where id = v_assignment.profile_id;
  if v_profile.id is null or v_profile.role not in ('facility_manager', 'trainer') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    for v_membership_id in
      select m.id
      from public.enterprise_scope_memberships m
      where m.profile_id = v_assignment.profile_id
        and m.scope_type = 'facility'
        and m.facility_id = v_assignment.facility_id
        and m.legacy_role is not null and m.effective_to is null
    loop
      update public.enterprise_access_grants
      set effective_to = greatest(v_now, effective_from),
          reason = case when reason = '' then 'Ended after facility assignment removal'
                        else reason || '; ended after facility assignment removal' end
      where membership_id = v_membership_id and effective_to is null;
      update public.enterprise_scope_memberships
      set effective_to = greatest(v_now, effective_from),
          reason = case when reason is null then 'Ended after facility assignment removal'
                        else reason || '; ended after facility assignment removal' end
      where id = v_membership_id;
    end loop;
  else
    perform app_private.ensure_builtin_scope_grant(
      v_assignment.profile_id, v_profile.role, 'facility',
      v_assignment.facility_id, v_now
    );
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function app_private.sync_facility_assignment_enterprise_access_trigger()
from public, anon, authenticated, service_role;
create trigger sync_facility_assignment_enterprise_access
after insert or delete on public.facility_assignments
for each row execute function app_private.sync_facility_assignment_enterprise_access_trigger();

insert into public.enterprise_scope_backfill_exceptions(
  profile_id, organization_id, exception_code, details
)
select p.id, p.organization_id, 'missing_organization_scope',
  jsonb_build_object('legacyRole', p.role)
from public.profiles p
where p.role <> 'platform_admin' and p.organization_id is null
on conflict do nothing;

insert into public.enterprise_scope_backfill_exceptions(
  profile_id, organization_id, exception_code, details
)
select p.id, p.organization_id, 'missing_facility_scope',
  jsonb_build_object('legacyRole', p.role)
from public.profiles p
where p.role in ('facility_manager', 'trainer')
  and not exists (
    select 1 from public.enterprise_scope_memberships m
    where m.profile_id = p.id and m.scope_type = 'facility'
      and m.effective_to is null
  )
on conflict do nothing;

create or replace function public.get_effective_access(
  p_at timestamptz default now()
)
returns table (
  permission_key text,
  scope_type text,
  scope_id uuid,
  role_template_code text,
  effective_from timestamptz,
  effective_to timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct
    rtp.permission_key,
    m.scope_type,
    coalesce(m.portfolio_id, m.region_id, m.organization_id, m.facility_id),
    rt.code,
    greatest(m.effective_from, g.effective_from),
    case
      when m.effective_to is null then g.effective_to
      when g.effective_to is null then m.effective_to
      else least(m.effective_to, g.effective_to)
    end
  from public.enterprise_scope_memberships m
  join public.enterprise_access_grants g on g.membership_id = m.id
  join public.role_templates rt on rt.id = g.role_template_id and rt.is_active
  join public.role_template_permissions rtp on rtp.role_template_id = rt.id
  join public.permission_definitions pd
    on pd.permission_key = rtp.permission_key and pd.is_active
  join public.profiles p on p.id = m.profile_id and p.is_active
  where m.profile_id = auth.uid()
    and m.effective_from <= p_at and (m.effective_to is null or m.effective_to > p_at)
    and g.effective_from <= p_at and (g.effective_to is null or g.effective_to > p_at)
  order by 1, 2, 3 nulls first, 4;
$$;

revoke all on function public.get_effective_access(timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.get_effective_access(timestamptz)
to authenticated;

create or replace function public.get_enterprise_scope_control_plane()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.current_role() is null then
    raise exception 'An active authenticated profile is required'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'portfolios', (
        select count(*) from public.enterprise_portfolios p
        where app_private.profile_has_effective_permission(
          auth.uid(), 'enterprise.scope.read', 'portfolio', p.id, now()
        )
      ),
      'regions', (
        select count(*) from public.enterprise_regions r
        where app_private.profile_has_effective_permission(
          auth.uid(), 'enterprise.scope.read', 'region', r.id, now()
        )
      ),
      'organizations', (
        select count(*) from public.enterprise_organization_memberships m
        where m.effective_from <= now() and (m.effective_to is null or m.effective_to > now())
          and app_private.profile_has_effective_permission(
            auth.uid(), 'enterprise.scope.read', 'organization', m.organization_id, now()
          )
      ),
      'activeGrants', (
        select count(*)
        from public.enterprise_access_grants g
        join public.enterprise_scope_memberships m on m.id = g.membership_id
        where g.effective_from <= now() and (g.effective_to is null or g.effective_to > now())
          and m.effective_from <= now() and (m.effective_to is null or m.effective_to > now())
          and (
            m.profile_id = auth.uid()
            or app_private.profile_has_effective_permission(
              auth.uid(), 'enterprise.scope.read', m.scope_type,
              coalesce(m.portfolio_id, m.region_id, m.organization_id, m.facility_id), now()
            )
          )
      )
    ),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'profileId', e.profile_id,
        'organizationId', e.organization_id,
        'code', e.exception_code,
        'details', e.details,
        'status', e.status,
        'createdAt', e.created_at
      ) order by e.created_at)
      from public.enterprise_scope_backfill_exceptions e
      where e.status = 'open'
        and (
          app_private.profile_has_effective_permission(
            auth.uid(), 'enterprise.scope.manage', 'platform', null, now()
          )
          or (e.organization_id is not null and app_private.profile_has_effective_permission(
            auth.uid(), 'enterprise.scope.manage', 'organization', e.organization_id, now()
          ))
        )
    ), '[]'::jsonb),
    'effectiveAccess', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.permission_key, a.scope_type)
      from public.get_effective_access(now()) a
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_enterprise_scope_control_plane()
from public, anon, authenticated, service_role;
grant execute on function public.get_enterprise_scope_control_plane()
to authenticated;

create or replace function public.grant_enterprise_role(
  p_profile_id uuid,
  p_scope_type text,
  p_scope_id uuid,
  p_role_template_id uuid,
  p_effective_from timestamptz default now(),
  p_effective_to timestamptz default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
  v_grant_id uuid;
  v_target_profile public.profiles%rowtype;
  v_is_service boolean := coalesce(auth.jwt()->>'role', '') = 'service_role';
begin
  perform app_private.assert_phase2_aal2();
  if p_scope_type not in ('platform', 'portfolio', 'region', 'organization', 'facility')
     or (p_scope_type = 'platform' and p_scope_id is not null)
     or (p_scope_type <> 'platform' and p_scope_id is null) then
    raise exception 'Invalid enterprise scope shape' using errcode = '22023';
  end if;
  if p_effective_to is not null and p_effective_to <= p_effective_from then
    raise exception 'Role grant effective_to must follow effective_from'
      using errcode = '22007';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Role grant reason is required' using errcode = '22023';
  end if;
  if not app_private.scope_is_operational(
    p_scope_type, p_scope_id, p_effective_from
  ) then
    raise exception 'Target enterprise scope is not operational'
      using errcode = '55000';
  end if;
  if not v_is_service and not app_private.profile_has_effective_permission(
    auth.uid(), 'enterprise.scope.manage', p_scope_type, p_scope_id, now()
  ) then
    raise exception 'Not authorized to grant this enterprise role'
      using errcode = '42501';
  end if;
  select * into v_target_profile
  from public.profiles where id = p_profile_id;
  if v_target_profile.id is null or not exists (
    select 1 from public.role_templates r
    where r.id = p_role_template_id and r.is_active
  ) then
    raise exception 'Target profile or active role template not found'
      using errcode = 'P0002';
  end if;

  if p_scope_type = 'organization'
     and v_target_profile.organization_id is distinct from p_scope_id then
    raise exception 'Target profile belongs to another organization'
      using errcode = '42501';
  elsif p_scope_type = 'facility' and not exists (
    select 1 from public.facilities f
    where f.id = p_scope_id
      and f.organization_id = v_target_profile.organization_id
  ) then
    raise exception 'Target profile does not belong to the facility organization'
      using errcode = '42501';
  elsif p_scope_type in ('platform', 'portfolio', 'region')
        and not v_is_service
        and not app_private.profile_has_effective_permission(
          auth.uid(), 'enterprise.scope.manage', 'platform', null, now()
        ) then
    raise exception 'Only platform authority may grant platform, portfolio, or region scope'
      using errcode = '42501';
  end if;

  select m.id into v_membership_id
  from public.enterprise_scope_memberships m
  where m.profile_id = p_profile_id
    and m.scope_type = p_scope_type
    and coalesce(
      m.portfolio_id, m.region_id, m.organization_id, m.facility_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    ) = coalesce(p_scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and m.effective_from <= p_effective_from
    and (
      (p_effective_to is null and m.effective_to is null)
      or (p_effective_to is not null
          and (m.effective_to is null or m.effective_to >= p_effective_to))
    )
  order by m.effective_from desc limit 1;

  if v_membership_id is null then
    insert into public.enterprise_scope_memberships(
      profile_id, scope_type, portfolio_id, region_id,
      organization_id, facility_id, effective_from, effective_to,
      source, reason, created_by
    ) values (
      p_profile_id, p_scope_type,
      case when p_scope_type = 'portfolio' then p_scope_id end,
      case when p_scope_type = 'region' then p_scope_id end,
      case when p_scope_type = 'organization' then p_scope_id end,
      case when p_scope_type = 'facility' then p_scope_id end,
      p_effective_from, p_effective_to, 'api', trim(p_reason), auth.uid()
    ) returning id into v_membership_id;
  end if;

  select g.id into v_grant_id
  from public.enterprise_access_grants g
  where g.membership_id = v_membership_id
    and g.role_template_id = p_role_template_id
    and g.effective_to is null
  order by g.effective_from desc limit 1;
  if v_grant_id is not null then
    return v_grant_id;
  end if;

  insert into public.enterprise_access_grants(
    membership_id, role_template_id, effective_from, effective_to,
    source, reason, granted_by
  ) values (
    v_membership_id, p_role_template_id, p_effective_from, p_effective_to,
    'api', trim(p_reason), auth.uid()
  ) returning id into v_grant_id;
  return v_grant_id;
end;
$$;

revoke all on function public.grant_enterprise_role(
  uuid, text, uuid, uuid, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.grant_enterprise_role(
  uuid, text, uuid, uuid, timestamptz, timestamptz, text
) to authenticated, service_role;

create or replace function public.end_enterprise_role_grant(
  p_grant_id uuid,
  p_effective_to timestamptz default now(),
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.enterprise_access_grants%rowtype;
  v_membership public.enterprise_scope_memberships%rowtype;
  v_scope_id uuid;
  v_is_service boolean := coalesce(auth.jwt()->>'role', '') = 'service_role';
begin
  perform app_private.assert_phase2_aal2();
  select * into v_grant
  from public.enterprise_access_grants where id = p_grant_id for update;
  if v_grant.id is null then
    raise exception 'enterprise access grant % not found', p_grant_id
      using errcode = 'P0002';
  end if;
  select * into v_membership
  from public.enterprise_scope_memberships where id = v_grant.membership_id;
  v_scope_id := coalesce(
    v_membership.portfolio_id, v_membership.region_id,
    v_membership.organization_id, v_membership.facility_id
  );
  if not v_is_service and not app_private.profile_has_effective_permission(
    auth.uid(), 'enterprise.scope.manage', v_membership.scope_type, v_scope_id, now()
  ) then
    raise exception 'Not authorized to end this enterprise grant'
      using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Grant end reason is required' using errcode = '22023';
  end if;
  if p_effective_to <= v_grant.effective_from then
    raise exception 'Grant end must follow its start' using errcode = '22007';
  end if;
  if v_grant.effective_to is null then
    update public.enterprise_access_grants
    set effective_to = p_effective_to,
        reason = case when reason = '' then trim(p_reason)
                      else reason || '; ' || trim(p_reason) end
    where id = p_grant_id;
  end if;
end;
$$;

revoke all on function public.end_enterprise_role_grant(uuid, timestamptz, text)
from public, anon, authenticated, service_role;
grant execute on function public.end_enterprise_role_grant(uuid, timestamptz, text)
to authenticated, service_role;

create or replace function public.upsert_enterprise_role_template(
  p_organization_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_permission_keys text[],
  p_role_template_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_role_template_id;
  v_permission text;
  v_is_service boolean := coalesce(auth.jwt()->>'role', '') = 'service_role';
begin
  perform app_private.assert_phase2_aal2();
  if p_organization_id is null then
    raise exception 'Custom role templates require an organization'
      using errcode = '22023';
  end if;
  if not v_is_service and not app_private.profile_has_effective_permission(
    auth.uid(), 'enterprise.scope.manage', 'organization', p_organization_id, now()
  ) then
    raise exception 'Not authorized to manage role templates'
      using errcode = '42501';
  end if;
  if coalesce(array_length(p_permission_keys, 1), 0) = 0 then
    raise exception 'At least one permission is required' using errcode = '22023';
  end if;
  foreach v_permission in array p_permission_keys loop
    if not exists (
      select 1 from public.permission_definitions p
      where p.permission_key = v_permission and p.is_active
    ) then
      raise exception 'Unknown or inactive permission %', v_permission
        using errcode = '22023';
    end if;
    if not v_is_service and not app_private.profile_has_effective_permission(
      auth.uid(), v_permission, 'organization', p_organization_id, now()
    ) then
      raise exception 'Cannot delegate permission % that the caller does not hold',
        v_permission using errcode = '42501';
    end if;
  end loop;

  if v_id is null then
    insert into public.role_templates(
      organization_id, code, name, description, is_system_managed, is_active
    ) values (
      p_organization_id, lower(trim(p_code)), trim(p_name),
      coalesce(p_description, ''), false, true
    ) returning id into v_id;
  else
    update public.role_templates
    set code = lower(trim(p_code)), name = trim(p_name),
        description = coalesce(p_description, '')
    where id = v_id and organization_id = p_organization_id
      and not is_system_managed;
    if not found then
      raise exception 'Mutable organization role template % not found', v_id
        using errcode = 'P0002';
    end if;
    delete from public.role_template_permissions where role_template_id = v_id;
  end if;

  insert into public.role_template_permissions(role_template_id, permission_key)
  select v_id, permission_key from unnest(p_permission_keys) permission_key
  on conflict do nothing;
  return v_id;
end;
$$;

revoke all on function public.upsert_enterprise_role_template(
  uuid, text, text, text, text[], uuid
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_enterprise_role_template(
  uuid, text, text, text, text[], uuid
) to authenticated, service_role;

-- Data API boundary. RLS is enabled before any authenticated table grants.
alter table public.enterprise_portfolios enable row level security;
alter table public.enterprise_regions enable row level security;
alter table public.enterprise_organization_memberships enable row level security;
alter table public.enterprise_scope_memberships enable row level security;
alter table public.permission_definitions enable row level security;
alter table public.role_templates enable row level security;
alter table public.role_template_permissions enable row level security;
alter table public.enterprise_access_grants enable row level security;
alter table public.enterprise_scope_backfill_exceptions enable row level security;

create policy enterprise_portfolios_select on public.enterprise_portfolios
for select to authenticated using (
  public.has_effective_permission('enterprise.scope.read', 'portfolio', id)
);

create policy enterprise_regions_select on public.enterprise_regions
for select to authenticated using (
  public.has_effective_permission('enterprise.scope.read', 'region', id)
);

create policy enterprise_org_memberships_select
on public.enterprise_organization_memberships
for select to authenticated using (
  public.has_effective_permission('enterprise.scope.read', 'organization', organization_id)
);

create policy enterprise_scope_memberships_select
on public.enterprise_scope_memberships
for select to authenticated using (
  profile_id = (select auth.uid())
  or public.has_effective_permission(
    'enterprise.scope.read', scope_type,
    coalesce(portfolio_id, region_id, organization_id, facility_id)
  )
);

create policy permission_definitions_select on public.permission_definitions
for select to authenticated using ((select public.current_role()) is not null);

create policy role_templates_select on public.role_templates
for select to authenticated using (
  organization_id is null
  or organization_id = (select public.current_org_id())
  or public.has_effective_permission('enterprise.scope.read', 'organization', organization_id)
);

create policy role_template_permissions_select
on public.role_template_permissions
for select to authenticated using (
  exists (
    select 1 from public.role_templates rt
    where rt.id = role_template_id
  )
);

create policy enterprise_access_grants_select
on public.enterprise_access_grants
for select to authenticated using (
  exists (
    select 1 from public.enterprise_scope_memberships m
    where m.id = membership_id
      and (
        m.profile_id = (select auth.uid())
        or public.has_effective_permission(
          'enterprise.scope.read', m.scope_type,
          coalesce(m.portfolio_id, m.region_id, m.organization_id, m.facility_id)
        )
      )
  )
);

create policy enterprise_scope_exceptions_select
on public.enterprise_scope_backfill_exceptions
for select to authenticated using (
  organization_id is not null
  and public.has_effective_permission(
    'enterprise.scope.manage', 'organization', organization_id
  )
  or public.has_effective_permission('enterprise.scope.manage', 'platform', null)
);
create policy enterprise_scope_exceptions_update
on public.enterprise_scope_backfill_exceptions
for update to authenticated using (
  coalesce(auth.jwt()->>'aal', '') = 'aal2' and (
    (organization_id is not null and public.has_effective_permission(
      'enterprise.scope.manage', 'organization', organization_id
    ))
    or public.has_effective_permission('enterprise.scope.manage', 'platform', null)
  )
) with check (
  coalesce(auth.jwt()->>'aal', '') = 'aal2' and (
    (organization_id is not null and public.has_effective_permission(
      'enterprise.scope.manage', 'organization', organization_id
    ))
    or public.has_effective_permission('enterprise.scope.manage', 'platform', null)
  )
);

revoke all on table public.enterprise_portfolios,
  public.enterprise_regions,
  public.enterprise_organization_memberships,
  public.enterprise_scope_memberships,
  public.permission_definitions,
  public.role_templates,
  public.role_template_permissions,
  public.enterprise_access_grants,
  public.enterprise_scope_backfill_exceptions
from public, anon, authenticated, service_role;

grant select on table public.enterprise_portfolios,
  public.enterprise_regions,
  public.enterprise_organization_memberships,
  public.enterprise_scope_memberships,
  public.permission_definitions,
  public.role_templates,
  public.role_template_permissions,
  public.enterprise_access_grants
to authenticated;
grant select, update on table public.enterprise_scope_backfill_exceptions
to authenticated;

grant select on table public.enterprise_portfolios,
  public.enterprise_regions,
  public.enterprise_organization_memberships,
  public.enterprise_scope_memberships,
  public.permission_definitions,
  public.role_templates,
  public.role_template_permissions,
  public.enterprise_access_grants,
  public.enterprise_scope_backfill_exceptions
to service_role;

-- Every mutable hierarchy/access table is represented in the Phase 1 audit
-- coverage manifest and gets the shared structured audit trigger.
insert into app_private.audit_entity_manifest(
  table_name, audit_mode, contains_regulated_data, rationale
)
select table_name, 'row_trigger', contains_regulated_data,
  'Phase 2 enterprise hierarchy and effective access governance'
from (values
  ('enterprise_portfolios', false),
  ('enterprise_regions', false),
  ('enterprise_organization_memberships', true),
  ('enterprise_scope_memberships', true),
  ('permission_definitions', false),
  ('role_templates', false),
  ('role_template_permissions', false),
  ('enterprise_access_grants', true),
  ('enterprise_scope_backfill_exceptions', true)
) as v(table_name, contains_regulated_data)
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'enterprise_portfolios', 'enterprise_regions',
    'enterprise_organization_memberships', 'enterprise_scope_memberships',
    'permission_definitions', 'role_templates', 'role_template_permissions',
    'enterprise_access_grants', 'enterprise_scope_backfill_exceptions'
  ] loop
    execute format('create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()', v_table);
  end loop;
end;
$$;
