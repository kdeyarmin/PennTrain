-- Build the caller's visible membership set once per SELECT instead of repeating
-- the full permission join for every grant and again for its embedded membership.
-- This is an RLS implementation helper, not an alternate public data endpoint.
create function app_private.readable_enterprise_scope_membership_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with caller as materialized (
    select auth.uid() as profile_id
    where auth.uid() is not null
      and public.current_sms_mfa_satisfied()
      and public.current_impersonation_session_live()
  ), permission_scopes as materialized (
    select distinct a.scope_type, a.scope_id
    from public.get_effective_access(now()) a
    where a.permission_key = 'enterprise.scope.read'
      and exists (
        select 1 from public.profiles p join caller c on c.profile_id = p.id
        where p.is_active and (p.role = 'platform_admin' or exists (
          select 1 from public.organizations o where o.id = p.organization_id
            and o.subscription_status not in ('suspended', 'canceled')
        ))
      )
  )
  select m.id
  from public.enterprise_scope_memberships m
  cross join caller c
  where m.profile_id = c.profile_id
    or exists (
      select 1 from permission_scopes a
      where app_private.scope_contains(a.scope_type, a.scope_id, m.scope_type,
        coalesce(m.portfolio_id, m.region_id, m.organization_id, m.facility_id), now())
    );
$$;

revoke all on function app_private.readable_enterprise_scope_membership_ids()
  from public, anon, authenticated, service_role;
grant execute on function app_private.readable_enterprise_scope_membership_ids() to authenticated;

-- Both tables keep their existing restrictive SMS-MFA and impersonation policies.
-- The helper also preserves those gates formerly inherited by the grant policy's
-- nested membership SELECT. Own rows retain their original history visibility:
-- only the caller's authorizing grants, not the listed rows, need a current window.
alter policy enterprise_scope_memberships_select on public.enterprise_scope_memberships
  using (id in (select app_private.readable_enterprise_scope_membership_ids()));
alter policy enterprise_access_grants_select on public.enterprise_access_grants
  using (membership_id in (select app_private.readable_enterprise_scope_membership_ids()));

-- Match the enterprise-scope control plane's local authority snapshot. Preserve
-- the workforce response and every target/own-person/effective-date predicate.
create or replace function public.get_workforce_compliance_control_plane()
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

  with permission_scopes as materialized (
    select distinct a.permission_key, a.scope_type, a.scope_id
    from public.get_effective_access(now()) a
    where a.permission_key in (
      'workforce.lifecycle.read', 'workforce.lifecycle.manage',
      'workforce.compliance.read', 'workforce.compliance.manage', 'workforce.evidence.read'
    )
      and exists (
        select 1 from public.profiles p where p.id = auth.uid() and p.is_active
          and (p.role = 'platform_admin' or exists (
            select 1 from public.organizations o where o.id = p.organization_id
              and o.subscription_status not in ('suspended', 'canceled')
          ))
      )
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'people', (
        select count(*) from public.workforce_people p
        where p.profile_id = auth.uid() or exists (
          select 1 from permission_scopes a where a.permission_key = 'workforce.lifecycle.read'
            and app_private.scope_contains(a.scope_type, a.scope_id, 'organization', p.organization_id, now())
        )
      ),
      'activeEpisodes', (
        select count(*) from public.employment_episodes e
        where e.episode_status = 'active' and exists (
          select 1 from permission_scopes a where a.permission_key = 'workforce.lifecycle.read'
            and app_private.scope_contains(a.scope_type, a.scope_id, 'facility', e.facility_id, now())
        )
      ),
      'openAccessSuspensions', (
        select count(*) from public.employee_access_suspensions s
        where s.effective_to is null and exists (
          select 1 from permission_scopes a where a.permission_key = 'workforce.lifecycle.read'
            and app_private.scope_contains(a.scope_type, a.scope_id, 'facility', s.facility_id, now())
        )
      ),
      'activeComplianceAssignments', (
        select count(*) from public.employee_compliance_profile_assignments c
        where c.effective_from <= public.pa_today()
          and (c.effective_to is null or c.effective_to > public.pa_today())
          and exists (
            select 1 from permission_scopes a where a.permission_key = 'workforce.compliance.read'
              and app_private.scope_contains(a.scope_type, a.scope_id, 'facility', c.facility_id, now())
          )
      )
    ),
    'workforceExceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'employeeId', e.employee_id, 'code', e.exception_code,
        'details', e.details, 'status', e.status, 'createdAt', e.created_at
      ) order by e.created_at)
      from public.workforce_backfill_exceptions e
      join public.employees employee on employee.id = e.employee_id
      where e.status = 'open' and exists (
        select 1 from permission_scopes a where a.permission_key = 'workforce.lifecycle.manage'
          and app_private.scope_contains(a.scope_type, a.scope_id, 'facility', employee.facility_id, now())
      )
    ), '[]'::jsonb),
    'complianceExceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'employeeId', e.employee_id, 'code', e.exception_code,
        'details', e.details, 'status', e.status, 'createdAt', e.created_at
      ) order by e.created_at)
      from public.compliance_profile_resolution_exceptions e
      where e.status = 'open' and exists (
        select 1 from permission_scopes a where a.permission_key = 'workforce.compliance.manage'
          and app_private.scope_contains(a.scope_type, a.scope_id, 'facility', e.facility_id, now())
      )
    ), '[]'::jsonb),
    'recentTransitions', coalesce((
      select jsonb_agg(to_jsonb(recent) order by recent.created_at desc)
      from (
        select e.id, e.employee_id, e.event_type, e.from_status,
          e.to_status, e.effective_on, e.reason, e.created_at
        from public.employment_lifecycle_events e
        where exists (
          select 1 from permission_scopes a where a.permission_key = 'workforce.evidence.read'
            and app_private.scope_contains(a.scope_type, a.scope_id, 'facility', e.facility_id, now())
        )
        order by e.created_at desc limit 50
      ) recent
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- CREATE OR REPLACE preserves the authenticated-only public RPC ACL and owner.
