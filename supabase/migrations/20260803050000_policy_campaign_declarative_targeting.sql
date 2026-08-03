-- Declarative role/facility targeting for policy campaigns (BACKLOG.md E4).
--
-- Targeting today is a point-in-time pick: an administrator selects employees in the assign
-- dialog and the campaign fans out to exactly those people, once. Anyone hired the next morning
-- is not on the campaign, and nothing ever notices -- the roster moved and the campaign did not.
-- For a policy every direct-care aide must sign, that is a compliance gap that widens quietly with
-- every hire and every transfer.
--
-- WHY THIS VOCABULARY. The predicates below are deliberately the ones
-- compliance_profile_mapping_rules already uses to match employees -- facility_type, worker_type,
-- job_title_pattern -- rather than a second targeting language that means almost the same thing.
-- Two vocabularies for "which employees does this apply to" is how the digest tally and the
-- escalation sweep ended up disagreeing earlier in this same PR: not because either was wrong on
-- its own, but because nothing forced them to stay in step. An administrator should learn this
-- once. The one addition is target_facility_ids, because a campaign is often scoped to named
-- facilities rather than to a facility TYPE.
--
-- WHY AN EXPLICIT MODE. targeting_mode is not redundant with "does it have predicates". A campaign
-- with no predicates is a manual campaign, and the sweep must never touch it -- if "no predicates"
-- silently meant "match everything", one missing WHERE clause would fan a manual campaign out to
-- every employee in the organization and put an unearned signature obligation on all of them. The
-- mode makes the intent explicit and the CHECK below makes a declarative campaign prove it has at
-- least one predicate, mirroring compliance_profile_mapping_predicate_check.
--
-- Rollback:
--   select cron.unschedule('materialize-policy-campaign-targets');
--   delete from app_private.system_job_definitions where job_key = 'policy-campaign-targeting';
--   drop function public.run_policy_campaign_targeting();
--   drop function public.materialize_policy_campaign_targets(uuid);
--   alter table public.policy_attestation_campaigns
--     drop constraint policy_campaign_targeting_predicate_check,
--     drop column targeting_mode, drop column target_facility_ids,
--     drop column target_facility_type, drop column target_worker_type,
--     drop column target_job_title_pattern, drop column targets_last_materialized_at;

------------------------------------------------------------------------------------------------
-- 1. The target definition.
------------------------------------------------------------------------------------------------
alter table public.policy_attestation_campaigns
  add column if not exists targeting_mode text not null default 'manual'
    check (targeting_mode in ('manual', 'declarative')),
  add column if not exists target_facility_ids uuid[],
  add column if not exists target_facility_type text
    check (target_facility_type is null or target_facility_type in ('PCH', 'ALR')),
  add column if not exists target_worker_type text
    check (target_worker_type is null
      or target_worker_type in ('regular', 'agency', 'substitute', 'volunteer')),
  add column if not exists target_job_title_pattern text,
  add column if not exists targets_last_materialized_at timestamptz;

-- A declarative campaign must actually say who it targets. Without this, targeting_mode alone
-- could be flipped to 'declarative' on a campaign with no predicates, and the sweep's "all
-- predicates null means no constraint" semantics would match the entire organization.
alter table public.policy_attestation_campaigns
  add constraint policy_campaign_targeting_predicate_check check (
    targeting_mode = 'manual'
    or target_facility_ids is not null
    or target_facility_type is not null
    or target_worker_type is not null
    or target_job_title_pattern is not null
  );

comment on column public.policy_attestation_campaigns.targeting_mode is
  'manual: the campaign fans out only to explicitly assigned employees (pre-E4 behaviour, and '
  'what the targeting sweep must never touch). declarative: membership is a rule, re-evaluated '
  'daily, so new hires and transfers are picked up.';
comment on column public.policy_attestation_campaigns.target_facility_ids is
  'Named facilities. NULL means every facility in the organization -- the predicates are ANDed '
  'and a NULL predicate is "no constraint on this dimension", not "match nothing".';
comment on column public.policy_attestation_campaigns.target_job_title_pattern is
  'ILIKE pattern matched against employees.job_title, the same dimension '
  'compliance_profile_mapping_rules.job_title_pattern matches on.';

------------------------------------------------------------------------------------------------
-- 2. Materialize one campaign's targets.
--
-- SECURITY DEFINER because the cron worker below has no JWT and no RLS context, but the
-- authorization is asserted explicitly rather than assumed: an end user must be an administrator
-- of the campaign's own organization AND hold the Compliance module, which is the same pair
-- submit_policy_knowledge_check asserts. A no-JWT caller is the cron/service context and is
-- allowed, exactly as run_shift_handoff_escalations does it -- the grant is the real boundary.
--
-- Idempotent by construction: policy_attestations_campaign_employee_uk makes a re-run a no-op for
-- anyone already on the campaign, so this can run daily forever without duplicating an
-- obligation or resetting someone's pending signature.
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
  end if;

  if v_campaign.targeting_mode <> 'declarative' then
    return 0;
  end if;

  -- Predicates are ANDed; a NULL predicate constrains nothing. Only ACTIVE employees are
  -- enrolled -- a terminated employee cannot sign, and enrolling them would put a permanently
  -- pending obligation on the campaign's completion report.
  insert into public.policy_attestations (
    organization_id, facility_id, employee_id, campaign_id, policy_document_version_id
  )
  select
    e.organization_id, e.facility_id, e.id, v_campaign.id, v_campaign.policy_document_version_id
  from public.employees e
  join public.facilities f on f.id = e.facility_id
  where e.organization_id = v_campaign.organization_id
    and e.status = 'active'
    and (v_campaign.target_facility_ids is null
      or e.facility_id = any(v_campaign.target_facility_ids))
    and (v_campaign.target_facility_type is null
      or f.facility_type = v_campaign.target_facility_type)
    and (v_campaign.target_worker_type is null
      or e.worker_type = v_campaign.target_worker_type)
    and (v_campaign.target_job_title_pattern is null
      or e.job_title ilike v_campaign.target_job_title_pattern)
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
  'on it. Idempotent; a manual campaign returns 0 untouched. BACKLOG.md E4.';

revoke all on function public.materialize_policy_campaign_targets(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.materialize_policy_campaign_targets(uuid)
  to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 3. The daily re-evaluation.
--
-- This is the half that makes targeting declarative rather than merely expressive. Without it the
-- rule is still evaluated once, at authoring time, and the roster drifts away from it exactly as
-- before -- the campaign would just describe its staleness more precisely.
------------------------------------------------------------------------------------------------
create or replace function public.run_policy_campaign_targeting()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_campaign_id uuid;
  v_total integer := 0;
begin
  if auth.uid() is not null and coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  for v_campaign_id in
    select c.id from public.policy_attestation_campaigns c
    join public.organizations o on o.id = c.organization_id
    where c.targeting_mode = 'declarative'
      and o.subscription_status not in ('suspended', 'canceled')
    order by c.created_at
  loop
    v_total := v_total + public.materialize_policy_campaign_targets(v_campaign_id);
  end loop;
  return v_total;
end;
$function$;

revoke all on function public.run_policy_campaign_targeting()
  from public, anon, authenticated, service_role;
grant execute on function public.run_policy_campaign_targeting() to service_role;

-- 11:00 UTC, half an hour ahead of the plan-of-correction sweep, so a newly enrolled employee has
-- an attestation row before the reminder sweep at 12:00 looks for ones coming due.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'materialize-policy-campaign-targets';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'materialize-policy-campaign-targets',
    '0 11 * * *',
    'select public.run_policy_campaign_targeting()'
  );
end
$$;

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values
  ('policy-campaign-targeting', 'Policy campaign targeting',
   'Re-evaluates declarative policy campaigns so new hires and transfers are enrolled. Silence '
   'here means the roster drifts away from the campaign and nobody is told.',
   'sql_cron', 'materialize-policy-campaign-targets',
   interval '1 day', interval '30 hours', true, 'manual', '/admin/system-jobs')
on conflict (job_key) do nothing;
