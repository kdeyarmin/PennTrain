-- Real "kill switch" for a suspended/canceled organization: current_org_id() is the schema's
-- single tenant-scoping choke point (used as `organization_id = current_org_id()` across ~70
-- migration files' RLS policies). Making it return null for a suspended org's members causes
-- every one of those policies to fail closed for that org, with zero per-table policy changes.
-- is_platform_admin() is always OR'd first in real policies, so platform_admin is unaffected.
create or replace function public.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.organization_id
  from public.profiles p
  left join public.organizations o on o.id = p.organization_id
  where p.id = auth.uid()
    and coalesce(o.subscription_status, 'active') <> 'suspended';
$$;

comment on function public.current_org_id() is
  'Returns the caller''s organization_id, or null if that organization is suspended (fails closed on every
   RLS policy shaped organization_id = current_org_id()) or the caller has no profile row. platform_admin
   access is unaffected since is_platform_admin() short-circuits the OR in every real policy first.';

-- Facility/employee plan-limit enforcement -- organizations.max_facilities/max_users have existed since
-- the tenancy schema landed but were never enforced (pure display-only counters vs. limits in the UI).
-- platform_admin bypasses, matching the existing protect_organization_subscription_fields() convention.
create or replace function public.enforce_facility_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max integer;
  v_count integer;
begin
  if public.is_platform_admin() then
    return new;
  end if;
  select max_facilities into v_max from public.organizations where id = new.organization_id;
  if v_max is null then
    return new;
  end if;
  select count(*) into v_count from public.facilities where organization_id = new.organization_id;
  if v_count >= v_max then
    raise exception 'This organization has reached its plan limit of % facilities.', v_max
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger enforce_facility_limit before insert on public.facilities
  for each row execute function public.enforce_facility_limit();

create or replace function public.enforce_employee_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max integer;
  v_count integer;
begin
  if public.is_platform_admin() then
    return new;
  end if;
  select max_users into v_max from public.organizations where id = new.organization_id;
  if v_max is null then
    return new;
  end if;
  select count(*) into v_count from public.employees where organization_id = new.organization_id;
  if v_count >= v_max then
    raise exception 'This organization has reached its plan limit of % employees.', v_max
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger enforce_employee_limit before insert on public.employees
  for each row execute function public.enforce_employee_limit();
