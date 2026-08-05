-- The declarative enrolment path skipped two of the three rules its own RLS policy states.
--
-- `policy_attestations_insert` (20260716221235_remediate_policy_attestation_security.sql) permits
-- an insert only when ALL of these hold for a non-platform-admin:
--
--   1. organization_id = current_org_id() and current_role() in ('org_admin','facility_manager')
--   2. public.is_assigned_to_facility(facility_id)
--   3. public.identity_assurance_is_current('policy_document_admin')
--
-- `materialize_policy_campaign_targets` is SECURITY DEFINER, so none of that policy is evaluated
-- on the rows it writes; it restates the rules itself. It restated only the first.
--
-- What that costs, concretely. `is_assigned_to_facility` returns true unconditionally for
-- org_admin and auditor, so rule 2 is a real constraint for exactly one role: facility_manager.
-- `policy_attestation_campaigns` has no facility column and its insert policy is org-scoped, so a
-- facility_manager may legitimately create a campaign with `target_facility_ids => null` -- which
-- means "every facility in the organization". Materializing it enrolled every active employee in
-- the org, including those at facilities the manager has no assignment to. The same person doing
-- the same thing one row at a time through PostgREST is refused by rule 2. A SECURITY DEFINER
-- helper is supposed to be a safer way to perform a permitted write, not a way around the
-- predicate that decides which writes are permitted.
--
-- Rule 3 leaked through a different door. Every call that arrives via
-- `create_policy_campaign_with_questions` has already passed the step-up check, because that
-- function is SECURITY INVOKER and the campaign insert it performs first is governed by
-- `policy_attestation_campaigns_write`, which requires it. But
-- `materialize_policy_campaign_targets` is granted to `authenticated` and therefore reachable
-- directly over PostgREST as a bare RPC, with no campaign insert ahead of it -- so an org_admin
-- whose privileged window had lapsed could still enrol an entire organization.
--
-- Both checks are inside the existing `auth.uid() is not null` branch, so the cron/service path
-- (`run_policy_campaign_targeting`, `spawn_due_policy_campaign_cycles`) is untouched -- it has no
-- JWT, is gated by the EXECUTE grant, and is the mechanism that keeps membership true as the
-- roster moves. Nothing about a facility_manager's authority changes what the campaign MEANS;
-- tomorrow's sweep still enrols everyone the predicate matches.
--
-- Refusing rather than silently narrowing the insert to the caller's facilities is deliberate.
-- A partial enrolment is indistinguishable from a complete one from the campaign screen, and this
-- codebase has now shipped that failure twice (see G25: a spawned cycle with nobody on it, and
-- 20260803060000's own note about a campaign that "looks manual, silently enrolling nobody"). An
-- error a facility_manager can read and act on -- ask an organization administrator -- is the
-- honest outcome.
--
-- Rollback: CREATE OR REPLACE the two-check version of `materialize_policy_campaign_targets` from
-- 20260803050000_policy_campaign_declarative_targeting.sql and drop
-- `app_private.policy_campaign_matched_employees(uuid)`.

------------------------------------------------------------------------------------------------
-- 1. The predicate, in one place.
--
-- The scope check and the insert must agree about which employees a campaign matches, or the
-- check guards a different set than the one written. Extracted rather than duplicated for that
-- reason; the body is the WHERE clause from 20260803050000 verbatim.
------------------------------------------------------------------------------------------------
create or replace function app_private.policy_campaign_matched_employees(p_campaign_id uuid)
returns table (employee_id uuid, organization_id uuid, facility_id uuid)
language sql
stable
security definer
set search_path = ''
as $function$
  -- Predicates are ANDed; a NULL predicate constrains nothing. Only ACTIVE employees match -- a
  -- terminated employee cannot sign, and enrolling them would put a permanently pending
  -- obligation on the campaign's completion report.
  select e.id, e.organization_id, e.facility_id
  from public.policy_attestation_campaigns c
  join public.employees e on e.organization_id = c.organization_id
  join public.facilities f on f.id = e.facility_id
  where c.id = p_campaign_id
    and e.status = 'active'
    and (c.target_facility_ids is null
      or e.facility_id = any(c.target_facility_ids))
    and (c.target_facility_type is null
      or f.facility_type = c.target_facility_type)
    and (c.target_worker_type is null
      or e.worker_type = c.target_worker_type)
    and (c.target_job_title_pattern is null
      or e.job_title ilike c.target_job_title_pattern);
$function$;

comment on function app_private.policy_campaign_matched_employees(uuid) is
  'The active employees a declarative policy campaign''s predicates match. Shared by '
  'materialize_policy_campaign_targets'' facility-scope check and its insert so the two cannot '
  'disagree about the target set. BACKLOG.md G33.';

revoke all on function app_private.policy_campaign_matched_employees(uuid)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 2. The materializer, with all three rules.
------------------------------------------------------------------------------------------------
create or replace function public.materialize_policy_campaign_targets(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_campaign public.policy_attestation_campaigns%rowtype;
  v_caller_role text;
  v_caller_org uuid;
  v_unscoped_facilities integer;
  v_inserted integer;
begin
  select * into v_campaign
  from public.policy_attestation_campaigns where id = p_campaign_id;
  if v_campaign.id is null then
    raise exception 'Policy campaign % not found', p_campaign_id using errcode = '23503';
  end if;

  -- An authenticated caller must be an administrator of this campaign's organization. A caller
  -- with no auth.uid() is the cron/service context; the grant below is what gates that path.
  if auth.uid() is not null then
    select p.role, p.organization_id into v_caller_role, v_caller_org
    from public.profiles p where p.id = (select auth.uid());
    if v_caller_org is distinct from v_campaign.organization_id
       or coalesce(v_caller_role, '') not in ('org_admin', 'facility_manager') then
      raise exception 'Not authorized to materialize this campaign''s targets'
        using errcode = '42501';
    end if;
    if not app_private.has_product_module('modules.compliance') then
      raise exception 'Compliance module required' using errcode = '42501';
    end if;
    -- Rule 3 of policy_attestations_insert. 'policy_document_admin' is in the program-wide
    -- baseline that identity_operation_requires_aal2 applies to org_admin and facility_manager
    -- even with no tenant identity_security_policies row (20260716221235), so this is a live
    -- requirement for every organization -- exactly as it is on the RLS policy this restates.
    if not (select public.identity_assurance_is_current('policy_document_admin')) then
      raise exception 'A fresh AAL2 session is required to enrol a policy campaign'
        using errcode = '42501';
    end if;
  end if;

  if v_campaign.targeting_mode <> 'declarative' then
    return 0;
  end if;

  -- Rule 2 of policy_attestations_insert, checked against the target set rather than one row at a
  -- time. is_assigned_to_facility() is true for every facility for org_admin and auditor, so this
  -- can only refuse a facility_manager reaching past their assignments.
  if auth.uid() is not null then
    select count(*) into v_unscoped_facilities
    from (
      select distinct m.facility_id as facility_id
      from app_private.policy_campaign_matched_employees(v_campaign.id) m
    ) matched_facilities
    where not public.is_assigned_to_facility(matched_facilities.facility_id);
    if coalesce(v_unscoped_facilities, 0) > 0 then
      raise exception 'This campaign targets employees at facilities you are not assigned to; an organization administrator must enrol it'
        using errcode = '42501';
    end if;
  end if;

  -- organization_id, facility_id, policy_document_version_id and due_date are all reassigned by
  -- the BEFORE INSERT trigger from the campaign (20260716221235); they are supplied here only
  -- because the columns are NOT NULL and the trigger runs after the row is formed.
  insert into public.policy_attestations (
    organization_id, facility_id, employee_id, campaign_id, policy_document_version_id
  )
  select
    m.organization_id, m.facility_id, m.employee_id, v_campaign.id,
    v_campaign.policy_document_version_id
  from app_private.policy_campaign_matched_employees(v_campaign.id) m
  on conflict on constraint policy_attestations_campaign_employee_uk do nothing;

  get diagnostics v_inserted = row_count;

  update public.policy_attestation_campaigns
  set targets_last_materialized_at = now()
  where id = v_campaign.id;

  return v_inserted;
end;
$function$;

comment on function public.materialize_policy_campaign_targets(uuid) is
  'Enrols every active employee matching a declarative campaign''s predicates who is not already '
  'on it. Idempotent; a manual campaign returns 0 untouched. An authenticated caller is held to '
  'all three rules policy_attestations_insert states -- role/tenant, facility assignment, and '
  'step-up assurance. BACKLOG.md E4, G33.';

-- CREATE OR REPLACE preserves the existing ACL, but re-asserting it keeps this migration
-- self-describing about who may reach the function.
revoke all on function public.materialize_policy_campaign_targets(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.materialize_policy_campaign_targets(uuid)
  to authenticated, service_role;
