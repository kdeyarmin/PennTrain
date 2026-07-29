-- Restore privileged MFA login as the default for real tenants; keep demo orgs password-only.
--
-- 20260728120000 flipped `get_my_mfa_policy()` so the *absence* of an
-- `identity_security_policies` row meant MFA was optional. That unblocked local
-- `demo123` admin logins, but it also left every real production tenant soft-open
-- until someone remembered to insert a policy row.
--
-- Production posture: privileged customer roles (org_admin / facility_manager)
-- require AAL2 by default. Demo/sandbox orgs (`organizations.is_demo`) stay
-- exempt so seeded Sunrise accounts and the self-serve demo keep working with
-- password only. platform_admin remains always mandatory. Per-operation step-up
-- (`identity_operation_requires_aal2`) is unchanged.
--
-- Also: let facility managers read integration credential *metadata* (name,
-- scopes, status, key_prefix) so the medication source dialog can offer a
-- picker instead of a raw UUID. Secrets are never stored on this table.

create or replace function public.get_my_mfa_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_policy public.identity_security_policies%rowtype;
  v_role text := public.current_role();
  v_org uuid := public.current_org_id();
  v_is_demo boolean := false;
begin
  if v_role is null then return jsonb_build_object('required', false); end if;
  if v_role = 'platform_admin' then
    return jsonb_build_object('required', true, 'role', v_role, 'maxSessionMinutes', 480);
  end if;

  -- Seeded / self-serve demo tenants stay password-only so local and guest demos
  -- are usable without enrolling an authenticator for every admin@* account.
  if v_org is not null then
    select o.is_demo into v_is_demo from public.organizations o where o.id = v_org;
    if coalesce(v_is_demo, false) then
      return jsonb_build_object(
        'required', false,
        'role', v_role,
        'maxSessionMinutes', 480
      );
    end if;
  end if;

  select * into v_policy from public.identity_security_policies
  where organization_id = v_org;
  return jsonb_build_object(
    'required', coalesce(v_policy.require_aal2, true)
      and v_role = any(coalesce(v_policy.privileged_roles,
        array['org_admin','facility_manager']::text[])),
    'role', v_role,
    'maxSessionMinutes', coalesce(v_policy.max_privileged_session_minutes, 480)
  );
end;
$function$;

-- Facility managers configure eMAR sources; they need to see which credentials
-- carry medications:write without being able to issue/rotate secrets.
insert into public.role_template_permissions(role_template_id, permission_key)
select rt.id, 'integrations.api.read'
from public.role_templates rt
where rt.built_in_role = 'facility_manager'
on conflict (role_template_id, permission_key) do nothing;

drop policy if exists integration_api_credentials_read on public.integration_api_credentials;
create policy integration_api_credentials_read
  on public.integration_api_credentials for select to authenticated
  using ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id()) and (
      (select public.current_role()) in ('org_admin', 'facility_manager')
      or public.has_effective_permission('integrations.api.read', 'organization', organization_id, now())
    )
  ));
