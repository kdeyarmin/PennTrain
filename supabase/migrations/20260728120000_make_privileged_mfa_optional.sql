-- Make the privileged-role MFA login requirement opt-in instead of a default floor.
--
-- Previously `get_my_mfa_policy()` treated the *absence* of a tenant
-- `identity_security_policies` row as "MFA required" for the org_admin and
-- facility_manager roles (`coalesce(v_policy.require_aal2, true)`). Because no
-- organization is provisioned with an identity-security-policy row by default,
-- every privileged user was hard-gated behind authenticator enrollment
-- (`MfaPolicyGate`) before any protected page could render.
--
-- This flips the default to opt-in: with no configured tenant policy, MFA is
-- optional and the login gate stays out of the way. Organizations that *do*
-- want to require it keep full control -- inserting an `identity_security_policies`
-- row (still constrained to `require_aal2 = true` by
-- `identity_security_policy_mfa_floor`) re-enables the gate, and the
-- platform_admin operator role remains MFA-mandatory. The per-operation step-up
-- checks (`identity_operation_requires_aal2` / `identity_assurance_is_current`)
-- are intentionally left unchanged, so genuinely irreversible admin actions
-- still demand a fresh AAL2 session where a policy is configured.
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
begin
  if v_role is null then return jsonb_build_object('required', false); end if;
  if v_role = 'platform_admin' then
    return jsonb_build_object('required', true, 'role', v_role, 'maxSessionMinutes', 480);
  end if;
  select * into v_policy from public.identity_security_policies
  where organization_id = public.current_org_id();
  return jsonb_build_object(
    'required', coalesce(v_policy.require_aal2, false)
      and v_role = any(coalesce(v_policy.privileged_roles,
        array['org_admin','facility_manager']::text[])),
    'role', v_role,
    'maxSessionMinutes', coalesce(v_policy.max_privileged_session_minutes, 480)
  );
end;
$function$;
