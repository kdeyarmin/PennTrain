-- Governed automation versions and no-write simulation.
--
-- Rules already have an allowlisted execution engine, pause/retire states, and immutable run receipts.
-- This adds the two controls needed before expanding no-code use: every saved rule version is retained,
-- and a manager can prove whether conditions match and what actions would be attempted without creating
-- work or notifications.

create table public.workflow_automation_rule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete cascade,
  rule_id uuid not null references public.workflow_automation_rules(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (rule_id, version_number)
);
create index workflow_automation_rule_versions_org_idx
  on public.workflow_automation_rule_versions(organization_id, rule_id, version_number desc);

alter table public.workflow_automation_rule_versions enable row level security;
create policy workflow_automation_rule_versions_select on public.workflow_automation_rule_versions
for select to authenticated using (
  public.is_platform_admin()
  or (
    organization_id = public.current_org_id()
    and (
      public.current_role() in ('org_admin', 'auditor')
      or (public.current_role() = 'facility_manager'
        and (facility_id is null or public.is_assigned_to_facility(facility_id)))
    )
  )
);
revoke all on public.workflow_automation_rule_versions from public, anon, authenticated;
grant select on public.workflow_automation_rule_versions to authenticated;

create or replace function app_private.prevent_workflow_automation_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Automation rule versions are immutable; save a new rule version instead.' using errcode = '55000';
end;
$$;

create trigger workflow_automation_rule_versions_immutable
before update or delete on public.workflow_automation_rule_versions
for each row execute function app_private.prevent_workflow_automation_version_mutation();

create or replace function app_private.capture_workflow_automation_rule_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  if tg_op = 'UPDATE'
     and new.name is not distinct from old.name
     and new.description is not distinct from old.description
     and new.trigger_type is not distinct from old.trigger_type
     and new.conditions is not distinct from old.conditions
     and new.actions is not distinct from old.actions
     and new.state is not distinct from old.state
     and new.facility_id is not distinct from old.facility_id then
    return new;
  end if;

  select coalesce(max(v.version_number), 0) + 1 into v_next
  from public.workflow_automation_rule_versions v
  where v.rule_id = new.id;

  insert into public.workflow_automation_rule_versions(
    organization_id, facility_id, rule_id, version_number, snapshot, created_by
  ) values (
    new.organization_id,
    new.facility_id,
    new.id,
    v_next,
    jsonb_build_object(
      'name', new.name,
      'description', new.description,
      'triggerType', new.trigger_type,
      'conditions', new.conditions,
      'actions', new.actions,
      'state', new.state,
      'savedAt', now()
    ),
    coalesce(auth.uid(), new.created_by)
  );
  return new;
end;
$$;

create trigger workflow_automation_rules_capture_version
after insert or update on public.workflow_automation_rules
for each row execute function app_private.capture_workflow_automation_rule_version();

-- Backfill one baseline version for rules that predate the version trigger.
insert into public.workflow_automation_rule_versions(
  organization_id, facility_id, rule_id, version_number, snapshot, created_by, created_at
)
select
  r.organization_id,
  r.facility_id,
  r.id,
  1,
  jsonb_build_object(
    'name', r.name,
    'description', r.description,
    'triggerType', r.trigger_type,
    'conditions', r.conditions,
    'actions', r.actions,
    'state', r.state,
    'savedAt', r.updated_at
  ),
  r.created_by,
  r.updated_at
from public.workflow_automation_rules r
where not exists (
  select 1 from public.workflow_automation_rule_versions v where v.rule_id = r.id
);

create or replace function public.simulate_workflow_automation_rule(
  p_rule_id uuid,
  p_facility_id uuid,
  p_context jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_product_value_manager(p_facility_id);
  v_rule public.workflow_automation_rules%rowtype;
  v_action jsonb;
  v_actions jsonb := '[]'::jsonb;
  v_matches boolean;
begin
  if jsonb_typeof(coalesce(p_context, '{}'::jsonb)) <> 'object'
     or length(coalesce(p_context, '{}'::jsonb)::text) > 50000 then
    raise exception 'Simulation context is invalid or too large' using errcode = '22023';
  end if;

  select * into v_rule
  from public.workflow_automation_rules r
  where r.id = p_rule_id
    and r.organization_id = v_org
    and (r.facility_id is null or r.facility_id = p_facility_id);
  if not found then
    raise exception 'Automation rule was not found in this scope' using errcode = 'P0002';
  end if;

  v_matches := v_rule.conditions = '{}'::jsonb
    or coalesce(p_context, '{}'::jsonb) @> v_rule.conditions;

  for v_action in select value from jsonb_array_elements(v_rule.actions) loop
    v_actions := v_actions || jsonb_build_array(
      jsonb_build_object(
        'type', v_action ->> 'type',
        'wouldAttempt', v_matches,
        'wouldCreateWork', v_matches and v_action ->> 'type' = 'create_work_item' and p_facility_id is not null,
        'wouldNotify', v_matches and v_action ->> 'type' = 'notify_roles',
        'reason', case
          when not v_matches then 'conditions_not_matched'
          when v_action ->> 'type' = 'create_work_item' and p_facility_id is null then 'facility_required'
          else 'eligible'
        end,
        'payload', v_action
      )
    );
  end loop;

  return jsonb_build_object(
    'ruleId', v_rule.id,
    'ruleName', v_rule.name,
    'ruleState', v_rule.state,
    'conditions', v_rule.conditions,
    'context', coalesce(p_context, '{}'::jsonb),
    'conditionsMatch', v_matches,
    'actions', v_actions,
    'writesPerformed', false,
    'simulatedAt', now()
  );
end;
$$;

revoke all on function public.simulate_workflow_automation_rule(uuid, uuid, jsonb) from public, anon;
grant execute on function public.simulate_workflow_automation_rule(uuid, uuid, jsonb) to authenticated, service_role;
