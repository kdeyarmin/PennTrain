-- Reuse one authorized caller snapshot without changing the control-plane response,
-- target operationality, effective windows, or existing own-grant visibility.
create or replace function public.get_enterprise_scope_control_plane()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or public.current_role() is null then
    raise exception 'An active authenticated profile is required'
      using errcode = '42501';
  end if;

  -- Materialize the caller's grants before applying scope predicates to the
  -- control-plane rows. Repeating the six-way permission join for each target
  -- repeats the same caller membership and permission lookup.
  with effective_access as materialized (
    select * from public.get_effective_access(now())
  ), permission_scopes as materialized (
    select distinct a.permission_key, a.scope_type, a.scope_id
    from effective_access a
    where a.permission_key in ('enterprise.scope.read', 'enterprise.scope.manage')
      -- Retain the resolver's active-profile/subscription predicate independently
      -- of the entry gate; effectiveAccess below keeps its existing read model.
      and exists (
        select 1 from public.profiles p where p.id = auth.uid() and p.is_active
          and (p.role = 'platform_admin' or exists (
            select 1 from public.organizations o where o.id = p.organization_id
              and o.subscription_status not in ('suspended', 'canceled')
          ))
      )
  ), platform_management as materialized (
    select exists (
      select 1 from permission_scopes a
      where a.permission_key = 'enterprise.scope.manage'
        and app_private.scope_contains(a.scope_type, a.scope_id, 'platform', null, now())
    ) as allowed
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'portfolios', (
        select count(*) from public.enterprise_portfolios p
        where exists (
          select 1 from permission_scopes a where a.permission_key = 'enterprise.scope.read'
            and app_private.scope_contains(a.scope_type, a.scope_id, 'portfolio', p.id, now())
        )
      ),
      'regions', (
        select count(*) from public.enterprise_regions r
        where exists (
          select 1 from permission_scopes a where a.permission_key = 'enterprise.scope.read'
            and app_private.scope_contains(a.scope_type, a.scope_id, 'region', r.id, now())
        )
      ),
      'organizations', (
        select count(*) from public.enterprise_organization_memberships m
        where m.effective_from <= now() and (m.effective_to is null or m.effective_to > now())
          and exists (
            select 1 from permission_scopes a where a.permission_key = 'enterprise.scope.read'
              and app_private.scope_contains(a.scope_type, a.scope_id, 'organization', m.organization_id, now())
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
            or exists (
              select 1 from permission_scopes a where a.permission_key = 'enterprise.scope.read'
                and app_private.scope_contains(a.scope_type, a.scope_id, m.scope_type,
                  coalesce(m.portfolio_id, m.region_id, m.organization_id, m.facility_id), now())
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
          (select allowed from platform_management)
          or (e.organization_id is not null and exists (
            select 1 from permission_scopes a where a.permission_key = 'enterprise.scope.manage'
              and app_private.scope_contains(a.scope_type, a.scope_id, 'organization', e.organization_id, now())
          ))
        )
    ), '[]'::jsonb),
    'effectiveAccess', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.permission_key, a.scope_type)
      from effective_access a
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- CREATE OR REPLACE preserves the existing owner and authenticated-only EXECUTE ACL.
