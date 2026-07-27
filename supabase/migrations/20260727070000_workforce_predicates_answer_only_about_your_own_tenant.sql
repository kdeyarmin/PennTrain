-- Four SECURITY DEFINER predicates answered questions about other tenants' staff.
--
-- A SECURITY DEFINER function bypasses RLS by definition, so any one that takes an id and does not
-- check who is asking will answer about any row in the database. Sweeping public for definer
-- functions that take a uuid, are executable by `authenticated`, and name no authorization helper at
-- all left ten candidates; probing each one -- signed in as org A's ordinary user, asking about org
-- B's rows -- separated the real ones from the ones whose authorization lives in a callee:
--
--   get_resident_administrative_packet   refused 42501  (delegates through _before_calendar ->
--                                                        _before_dietary -> _base, which checks
--                                                        admission_row_visible)
--   evaluate_feature_access              refused 42501
--   has_effective_entitlement            refused 42501
--   is_employee_assigned_to_facility     ANSWERED true
--   is_employee_access_active            ANSWERED true
--   employee_has_active_qualification    ANSWERED false
--   evaluate_duty_eligibility            ANSWERED {"outcome": "eligible", "blocks": [], ...}
--
-- The last four tell a caller in one organisation whether a named employee of another organisation
-- is employed and unsuspended, which facilities they are staffed to, which qualifications they hold,
-- and -- from evaluate_duty_eligibility's blocks and warnings -- why they would be barred from a
-- duty. That is employee PII and staffing structure across a tenant boundary. It takes a uuid the
-- caller should not have, so it is a second-step disclosure rather than an open door; a 122-bit id
-- is not an authorization control, and this product's stated posture is that the checks are.
--
-- WHY NOT SIMPLY REVOKE THE GRANT, which was the first attempt. Nothing in the client or the edge
-- functions calls any of these -- they are internal helpers, and the entire `authenticated` grant
-- looked like surface nobody needed. Revoking it breaks the product:
--
--     create policy ... using (not public.is_employee_assigned_to_facility(employee_id, facility_id));
--     set role authenticated; select ... ;
--     ERROR:  permission denied for function is_employee_assigned_to_facility
--
-- A policy is evaluated with the INVOKER's privileges, so it cannot call a function the invoker may
-- not execute. shift_assignments_update names is_employee_assigned_to_facility in its WITH CHECK,
-- so revoking would have made every manager's shift-assignment update fail with a raw permission
-- error. (The first probe of this appeared to show the opposite, because it was written
-- `using (f(...) or true)` and Postgres never evaluated the left side. The second probe, written
-- `using (not f(...))`, settled it.)
--
-- WHAT THIS DOES. Each predicate gains a scope test and returns false -- not an exception -- when
-- the subject is outside the caller's tenant. False rather than raise, deliberately: two of these
-- are reached from RLS policies, and a policy that can raise turns an authorization question into a
-- 500 for rows that merely fail to match.
--
-- The scope test is permissive when there is no interactive caller, so nothing internal changes:
-- cron and service_role paths run with auth.uid() = null (verified: it is null both with no JWT and
-- with a service_role JWT), and platform admins keep cross-tenant reach. `anon` cannot execute any
-- of the four, so the null-caller branch is not reachable from an unauthenticated request -- checked
-- rather than assumed, because that branch would otherwise be worse than the hole it closes.
--
-- Internal callers are unaffected because they all ask about their own tenant:
-- assert_duty_eligible passes auth.uid() or a same-facility evaluator; assign_employee_to_shift and
-- create_schedule_eligibility_override act on the manager's own organisation; shift_assignments_-
-- update has already constrained organization_id = current_org_id() before this predicate runs.

create or replace function app_private.employee_in_caller_scope(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select auth.uid() is null                     -- cron / service_role: no interactive caller to scope
      or public.is_platform_admin()
      or exists (
        select 1 from public.employees e
        where e.id = p_employee_id
          and e.organization_id = public.current_org_id()
      )
$$;

create or replace function app_private.profile_in_caller_scope(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select auth.uid() is null
      or public.is_platform_admin()
      or exists (
        select 1 from public.profiles p
        where p.id = p_profile_id
          and p.organization_id = public.current_org_id()
      )
$$;

comment on function app_private.employee_in_caller_scope(uuid) is
  'True when the caller may be told anything about this employee. Permissive for cron/service_role '
  '(auth.uid() is null) and for platform admins; otherwise same-organisation only.';

-- The four predicates, each with its original body preserved verbatim behind the scope test.

create or replace function public.is_employee_access_active(p_employee_id uuid, p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select app_private.employee_in_caller_scope(p_employee_id) and exists (
    select 1
    from public.employees e
    left join public.profiles p on p.id = e.profile_id
    where e.id = p_employee_id
      and e.status = 'active'
      and (e.profile_id is null or p.is_active)
      and not exists (
        select 1 from public.employee_access_suspensions s
        where s.employee_id = e.id
          and s.effective_from <= p_at
          and (s.effective_to is null or s.effective_to > p_at)
      )
  );
$$;

create or replace function public.is_employee_assigned_to_facility(p_employee_id uuid, p_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select app_private.employee_in_caller_scope(p_employee_id) and exists (
    select 1 from public.employee_facility_assignments efa
    where efa.employee_id = p_employee_id and efa.facility_id = p_facility_id
  );
$$;
CREATE OR REPLACE FUNCTION public.employee_has_active_qualification(p_employee_id uuid, p_qualification_key text, p_at timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app_private.employee_in_caller_scope(p_employee_id) and exists (
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
$function$;
CREATE OR REPLACE FUNCTION public.evaluate_duty_eligibility(p_profile_id uuid, p_duty_key text, p_facility_id uuid, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rule public.duty_eligibility_rules%rowtype;
  v_profile public.profiles%rowtype;
  v_employee_id uuid;
  v_blocks text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_override public.duty_eligibility_overrides%rowtype;
  v_qualified boolean := false;
  v_key text;
  v_outcome text;
begin
  -- Out-of-tenant subjects get the same shape back with no facts in it: the blocks and warnings
  -- arrays are what would otherwise disclose another organisation's credential state.
  if not app_private.profile_in_caller_scope(p_profile_id) then
    return jsonb_build_object('dutyKey', p_duty_key, 'outcome', 'ineligible',
                              'blocks', jsonb_build_array('out_of_scope'),
                              'warnings', jsonb_build_array(), 'overrides', jsonb_build_array());
  end if;
  select * into v_profile from public.profiles where id = p_profile_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'blocked',
      'blocks', to_jsonb(array['profile_not_found']),
      'warnings', '[]'::jsonb,
      'overrideId', null
    );
  end if;

  -- Organization rule first, platform default second.
  select * into v_rule from public.duty_eligibility_rules
  where duty_key = p_duty_key and is_active
    and (organization_id = v_profile.organization_id or organization_id is null)
  order by organization_id nulls last
  limit 1;
  if not found then
    -- An unknown duty is not silently permitted; it is reported so the caller can see the rule is
    -- missing rather than assuming it passed.
    return jsonb_build_object(
      'outcome', 'warning',
      'blocks', '[]'::jsonb,
      'warnings', to_jsonb(array['no_rule_configured']),
      'overrideId', null
    );
  end if;

  if not v_profile.is_active then
    v_blocks := array_append(v_blocks, 'profile_inactive');
  end if;

  if cardinality(v_rule.accepted_roles) > 0
     and not (v_profile.role = any(v_rule.accepted_roles) or v_profile.role = 'platform_admin') then
    v_blocks := array_append(v_blocks, 'role_not_accepted');
  end if;

  if cardinality(v_rule.accepted_qualification_keys) > 0 then
    select e.id into v_employee_id
    from public.employees e
    where e.profile_id = p_profile_id and e.facility_id = p_facility_id
    limit 1;

    if v_employee_id is null then
      -- No employee record at this facility means there is nothing to check the qualification
      -- against. Reported, never treated as a pass.
      v_warnings := array_append(v_warnings, 'no_employee_record_for_qualification_check');
    else
      foreach v_key in array v_rule.accepted_qualification_keys loop
        if public.employee_has_active_qualification(v_employee_id, v_key, p_at) then
          v_qualified := true;
          exit;
        end if;
      end loop;
      if not v_qualified then
        v_blocks := array_append(v_blocks, 'qualification_missing');
      end if;
    end if;
  end if;

  -- A rule set to 'warn' still reports what it found; it just does not stop the action.
  if v_rule.enforcement = 'warn' and cardinality(v_blocks) > 0 then
    v_warnings := v_warnings || v_blocks;
    v_blocks := array[]::text[];
  end if;

  if cardinality(v_blocks) > 0 then
    select * into v_override from public.duty_eligibility_overrides o
    where o.profile_id = p_profile_id
      and o.duty_key = p_duty_key
      and o.facility_id = p_facility_id
      and o.revoked_at is null
      and o.granted_at <= p_at
      and o.expires_at > p_at
    order by o.expires_at desc
    limit 1;
    if found then
      v_warnings := v_warnings || v_blocks || array['override_applied'];
      v_blocks := array[]::text[];
    end if;
  end if;

  v_outcome := case
    when cardinality(v_blocks) > 0 then 'blocked'
    when cardinality(v_warnings) > 0 then 'warning'
    else 'eligible'
  end;

  return jsonb_build_object(
    'outcome', v_outcome,
    'blocks', to_jsonb(array(select distinct x from unnest(v_blocks) x order by x)),
    'warnings', to_jsonb(array(select distinct x from unnest(v_warnings) x order by x)),
    'overrideId', v_override.id,
    'dutyKey', p_duty_key,
    'enforcement', v_rule.enforcement
  );
end $function$;
