-- CareBase product-value operating system
-- Connects the existing compliance, evidence, scheduling, admissions, reporting,
-- integration, portal, medication, offline-learning, and copilot foundations.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Shared authorization
-- ---------------------------------------------------------------------------

create or replace function app_private.assert_product_value_manager(p_facility_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.current_org_id();
  v_role text := public.current_role();
begin
  if public.is_platform_admin() then
    if p_facility_id is not null then
      select f.organization_id into v_org_id from public.facilities f where f.id = p_facility_id;
    end if;
    return v_org_id;
  end if;
  if auth.uid() is null or v_org_id is null or v_role not in ('org_admin', 'facility_manager') then
    raise exception 'Manager access is required' using errcode = '42501';
  end if;
  if p_facility_id is not null and not public.is_assigned_to_facility(p_facility_id) then
    raise exception 'Facility is outside caller scope' using errcode = '42501';
  end if;
  return v_org_id;
end;
$$;
revoke all on function app_private.assert_product_value_manager(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Configurable workflow automations
-- ---------------------------------------------------------------------------

create table public.workflow_automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete cascade,
  name text not null check (length(btrim(name)) between 3 and 160),
  description text not null default '',
  trigger_type text not null check (trigger_type in (
    'alert_created', 'incident_reported', 'training_due', 'credential_expiring',
    'inspection_gap', 'medication_exception', 'schedule_gap', 'admission_stage',
    'manual', 'scheduled'
  )),
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  state text not null default 'draft' check (state in ('draft', 'active', 'paused', 'retired')),
  run_count bigint not null default 0 check (run_count >= 0),
  last_run_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, facility_id, name)
);
create index workflow_automation_rules_active_idx
  on public.workflow_automation_rules(organization_id, facility_id, trigger_type)
  where state = 'active';

create table public.workflow_automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete cascade,
  rule_id uuid not null references public.workflow_automation_rules(id) on delete restrict,
  trigger_type text not null,
  subject_type text not null,
  subject_id uuid not null,
  context_sha256 text not null check (context_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('applied', 'skipped', 'failed')),
  action_results jsonb not null default '[]'::jsonb,
  error_message text,
  occurred_at timestamptz not null default now(),
  unique (rule_id, trigger_type, subject_id)
);
create index workflow_automation_runs_org_idx
  on public.workflow_automation_runs(organization_id, occurred_at desc);

insert into public.work_item_templates(
  organization_id, template_key, name, source_type, default_priority,
  due_interval, required_evidence_types, approval_required, escalation_after,
  default_owner_role
) values
  (null, 'automation.follow_up', 'Automated compliance follow-up', 'rule_exception',
    'normal', interval '7 days', array['completion_record'], false, interval '3 days', 'facility_manager'),
  (null, 'inspection.war_room_request', 'Inspection war-room evidence request', 'inspection',
    'high', interval '2 days', array['supporting_document'], true, interval '1 day', 'facility_manager'),
  (null, 'copilot.action_draft', 'Copilot action draft', 'rule_exception',
    'normal', interval '7 days', array['completion_record'], false, interval '3 days', 'facility_manager'),
  (null, 'medication.integration_exception', 'Medication integration exception', 'rule_exception',
    'high', interval '1 day', array['completion_record'], false, interval '4 hours', 'facility_manager')
on conflict (organization_id, template_key) do update set
  name = excluded.name, default_priority = excluded.default_priority,
  due_interval = excluded.due_interval, required_evidence_types = excluded.required_evidence_types,
  approval_required = excluded.approval_required, escalation_after = excluded.escalation_after,
  default_owner_role = excluded.default_owner_role, is_active = true, updated_at = now();

create or replace function public.save_workflow_automation_rule(
  p_rule_id uuid,
  p_facility_id uuid,
  p_name text,
  p_description text,
  p_trigger_type text,
  p_conditions jsonb,
  p_actions jsonb,
  p_state text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := app_private.assert_product_value_manager(p_facility_id);
  v_id uuid;
begin
  if p_trigger_type not in (
    'alert_created', 'incident_reported', 'training_due', 'credential_expiring',
    'inspection_gap', 'medication_exception', 'schedule_gap', 'admission_stage',
    'manual', 'scheduled'
  ) or p_state not in ('draft', 'active', 'paused', 'retired')
    or jsonb_typeof(coalesce(p_conditions, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_actions, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_actions, '[]'::jsonb)) > 10 then
    raise exception 'Automation rule is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb)) a
    where a->>'type' not in ('create_work_item', 'notify_roles')
  ) then
    raise exception 'Automation action is not allowlisted' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb)) a
    where a->>'type' = 'create_work_item' and (
      length(btrim(coalesce(a->>'title', ''))) not between 3 and 300
      or (a ? 'priority' and a->>'priority' not in ('low', 'normal', 'high', 'urgent'))
      or (a ? 'dueDays' and jsonb_typeof(a->'dueDays') <> 'number')
    )
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb)) a
    where a->>'type' = 'notify_roles' and (
      length(btrim(coalesce(a->>'title', ''))) not between 3 and 300
      or jsonb_typeof(a->'roles') <> 'array'
      or jsonb_array_length(a->'roles') not between 1 and 6
      or coalesce(a->>'link', '/app/today') !~ '^/'
    )
  ) then
    raise exception 'Automation action payload is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb)) a
    cross join lateral jsonb_array_elements_text(a->'roles') role_name
    where a->>'type' = 'notify_roles'
      and role_name not in ('org_admin', 'facility_manager', 'trainer', 'employee', 'auditor')
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb)) a
    where a->>'type' = 'create_work_item' and a ? 'dueDays'
      and ((a->>'dueDays')::numeric <> trunc((a->>'dueDays')::numeric)
        or (a->>'dueDays')::numeric not between 0 and 365)
  ) then
    raise exception 'Automation roles or due date are invalid' using errcode = '22023';
  end if;
  if p_rule_id is null then
    insert into public.workflow_automation_rules(
      organization_id, facility_id, name, description, trigger_type,
      conditions, actions, state, created_by
    ) values (
      v_org_id, p_facility_id, btrim(p_name), coalesce(btrim(p_description), ''), p_trigger_type,
      coalesce(p_conditions, '{}'::jsonb), coalesce(p_actions, '[]'::jsonb), p_state, auth.uid()
    ) returning id into v_id;
  else
    update public.workflow_automation_rules set
      facility_id = p_facility_id, name = btrim(p_name),
      description = coalesce(btrim(p_description), ''), trigger_type = p_trigger_type,
      conditions = coalesce(p_conditions, '{}'::jsonb), actions = coalesce(p_actions, '[]'::jsonb),
      state = p_state, updated_at = now()
    where id = p_rule_id and organization_id = v_org_id
    returning id into v_id;
  end if;
  if v_id is null then raise exception 'Automation rule was not found' using errcode = 'P0002'; end if;
  return v_id;
end;
$$;

create or replace function app_private.execute_workflow_automation_rule(
  p_rule public.workflow_automation_rules,
  p_facility_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_context jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action jsonb;
  v_results jsonb := '[]'::jsonb;
  v_existing public.workflow_automation_runs%rowtype;
  v_work_id uuid;
  v_template_id uuid;
  v_index integer := 0;
  v_due_days integer;
  v_target_roles text[];
begin
  select * into v_existing
  from public.workflow_automation_runs r
  where r.rule_id = p_rule.id
    and r.trigger_type = p_rule.trigger_type
    and r.subject_id = p_subject_id;
  if found then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'originalOutcome', v_existing.outcome,
      'actions', v_existing.action_results
    );
  end if;
  if p_rule.conditions <> '{}'::jsonb and not coalesce(p_context, '{}'::jsonb) @> p_rule.conditions then
    insert into public.workflow_automation_runs(
      organization_id, facility_id, rule_id, trigger_type, subject_type, subject_id,
      context_sha256, outcome, action_results
    ) values (
      p_rule.organization_id, p_facility_id, p_rule.id, p_rule.trigger_type,
      p_subject_type, p_subject_id,
      encode(extensions.digest(convert_to(coalesce(p_context, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex'),
      'skipped', '[]'::jsonb
    ) on conflict (rule_id, trigger_type, subject_id) do nothing;
    return jsonb_build_object('outcome', 'skipped', 'actions', v_results);
  end if;
  select t.id into v_template_id from public.work_item_templates t
  where t.template_key = 'automation.follow_up' and t.organization_id is null and t.is_active limit 1;
  for v_action in select value from jsonb_array_elements(p_rule.actions) loop
    v_index := v_index + 1;
    if v_action->>'type' = 'create_work_item' and p_facility_id is null then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'type', 'create_work_item', 'outcome', 'skipped', 'reason', 'facility_required'
      ));
    elsif v_action->>'type' = 'create_work_item' then
      v_due_days := least(greatest(coalesce((v_action->>'dueDays')::integer, 7), 0), 365);
      insert into public.work_items(
        organization_id, facility_id, template_id, source_type, source_id,
        deduplication_key, title, description, priority, due_at, created_by
      ) values (
        p_rule.organization_id, p_facility_id, v_template_id, 'automation', p_subject_id,
        concat('automation:', p_rule.id, ':', p_subject_id, ':', v_index),
        left(coalesce(nullif(v_action->>'title', ''), p_rule.name), 300),
        left(coalesce(v_action->>'description', p_rule.description), 5000),
        case when v_action->>'priority' in ('low', 'normal', 'high', 'urgent') then v_action->>'priority' else 'normal' end,
        now() + make_interval(days => v_due_days), null
      ) on conflict (organization_id, deduplication_key) do update set updated_at = now()
      returning id into v_work_id;
      insert into public.work_item_history(
        organization_id, facility_id, work_item_id, event_type, resulting_state, reason
      ) values (
        p_rule.organization_id, p_facility_id, v_work_id, 'created', 'open',
        concat('Workflow automation: ', p_rule.name)
      ) on conflict do nothing;
      v_results := v_results || jsonb_build_array(jsonb_build_object('type', 'create_work_item', 'workItemId', v_work_id));
    elsif v_action->>'type' = 'notify_roles' then
      select coalesce(array_agg(value), array['org_admin']::text[]) into v_target_roles
      from jsonb_array_elements_text(coalesce(v_action->'roles', '["org_admin"]'::jsonb)) value;
      insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
      select p_rule.organization_id, p.id, 'automation_action_due',
        left(coalesce(nullif(v_action->>'title', ''), p_rule.name), 300),
        left(coalesce(v_action->>'body', p_rule.description), 5000),
        coalesce(nullif(v_action->>'link', ''), '/app/today')
      from public.profiles p
      where p.organization_id = p_rule.organization_id and p.is_active and p.role = any(v_target_roles);
      v_results := v_results || jsonb_build_array(jsonb_build_object('type', 'notify_roles', 'roles', to_jsonb(v_target_roles)));
    end if;
  end loop;
  insert into public.workflow_automation_runs(
    organization_id, facility_id, rule_id, trigger_type, subject_type, subject_id,
    context_sha256, outcome, action_results
  ) values (
    p_rule.organization_id, p_facility_id, p_rule.id, p_rule.trigger_type,
    p_subject_type, p_subject_id,
    encode(extensions.digest(convert_to(coalesce(p_context, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex'),
    'applied', v_results
  ) on conflict (rule_id, trigger_type, subject_id) do nothing;
  update public.workflow_automation_rules set run_count = run_count + 1, last_run_at = now(), updated_at = now()
  where id = p_rule.id;
  return jsonb_build_object('outcome', 'applied', 'actions', v_results);
end;
$$;
revoke all on function app_private.execute_workflow_automation_rule(public.workflow_automation_rules, uuid, text, uuid, jsonb)
  from public, anon, authenticated;

create or replace function app_private.dispatch_workflow_automation_event(
  p_organization_id uuid,
  p_facility_id uuid,
  p_trigger_type text,
  p_subject_type text,
  p_subject_id uuid,
  p_context jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.workflow_automation_rules%rowtype;
  v_count integer := 0;
  v_error text;
begin
  for v_rule in
    select * from public.workflow_automation_rules r
    where r.organization_id = p_organization_id and r.state = 'active'
      and r.trigger_type = p_trigger_type
      and (r.facility_id is null or r.facility_id = p_facility_id)
  loop
    begin
      perform app_private.execute_workflow_automation_rule(
        v_rule, p_facility_id, p_subject_type, p_subject_id, coalesce(p_context, '{}'::jsonb)
      );
    exception when others then
      v_error := sqlerrm;
      insert into public.workflow_automation_runs(
        organization_id, facility_id, rule_id, trigger_type, subject_type, subject_id,
        context_sha256, outcome, action_results, error_message
      ) values (
        v_rule.organization_id, p_facility_id, v_rule.id, v_rule.trigger_type,
        p_subject_type, p_subject_id,
        encode(extensions.digest(convert_to(coalesce(p_context, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex'),
        'failed', '[]'::jsonb, left(v_error, 1000)
      ) on conflict (rule_id, trigger_type, subject_id) do nothing;
    end;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function app_private.dispatch_workflow_automation_event(uuid, uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.run_workflow_automation_now(
  p_rule_id uuid,
  p_facility_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_context jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_rule public.workflow_automation_rules%rowtype; v_org uuid;
begin
  v_org := app_private.assert_product_value_manager(p_facility_id);
  select * into v_rule from public.workflow_automation_rules where id = p_rule_id and organization_id = v_org;
  if not found then raise exception 'Automation rule not found' using errcode = 'P0002'; end if;
  if v_rule.facility_id is not null and p_facility_id is distinct from v_rule.facility_id then
    raise exception 'Automation rule is bound to a different facility' using errcode = '42501';
  end if;
  return app_private.execute_workflow_automation_rule(
    v_rule, coalesce(p_facility_id, v_rule.facility_id), left(p_subject_type, 80), p_subject_id,
    coalesce(p_context, '{}'::jsonb)
  );
end;
$$;

create or replace function app_private.capture_alert_automation_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.facility_id is not null then
    perform app_private.dispatch_workflow_automation_event(
      new.organization_id, new.facility_id, 'alert_created', 'alert', new.id,
      jsonb_build_object('severity', new.severity, 'status', new.status)
    );
  end if;
  return new;
end;
$$;
create trigger capture_alert_automation_event after insert on public.alerts
for each row execute function app_private.capture_alert_automation_event();

create or replace function app_private.capture_incident_automation_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.dispatch_workflow_automation_event(
    new.organization_id, new.facility_id, 'incident_reported', 'incident', new.id,
    jsonb_build_object('severity', new.severity, 'status', new.status, 'incidentType', new.incident_type)
  );
  return new;
end;
$$;
create trigger capture_incident_automation_event after insert on public.incidents
for each row execute function app_private.capture_incident_automation_event();

create or replace function app_private.capture_medication_automation_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.dispatch_workflow_automation_event(
    new.organization_id, new.facility_id, 'medication_exception', 'medication_exception', new.id,
    jsonb_build_object('severity', new.severity, 'status', new.status, 'exceptionType', new.exception_type)
  );
  return new;
end;
$$;
create trigger capture_medication_automation_event after insert on public.medication_integration_exceptions
for each row execute function app_private.capture_medication_automation_event();

create or replace function app_private.capture_admission_automation_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.stage is distinct from new.stage then
    perform app_private.dispatch_workflow_automation_event(
      new.organization_id, new.facility_id, 'admission_stage', 'admission_prospect', new.id,
      jsonb_build_object('priorStage', old.stage, 'newStage', new.stage)
    );
  end if;
  return new;
end;
$$;
create trigger capture_admission_automation_event after update of stage on public.admission_prospects
for each row execute function app_private.capture_admission_automation_event();

-- ---------------------------------------------------------------------------
-- Inspection war rooms
-- ---------------------------------------------------------------------------

create table public.inspection_war_rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  name text not null check (length(btrim(name)) between 3 and 200),
  inspection_type text not null default 'routine' check (inspection_type in ('routine', 'complaint', 'follow_up', 'mock', 'licensure', 'other')),
  status text not null default 'planning' check (status in ('planning', 'active', 'submitted', 'closed', 'canceled')),
  starts_at timestamptz not null default now(),
  target_response_at timestamptz,
  lead_profile_id uuid references public.profiles(id) on delete set null,
  evidence_collection_id uuid references public.evidence_collections(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inspection_war_rooms_facility_idx on public.inspection_war_rooms(facility_id, status, starts_at desc);

create table public.inspection_war_room_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  war_room_id uuid not null references public.inspection_war_rooms(id) on delete cascade,
  request_number integer not null check (request_number > 0),
  title text not null check (length(btrim(title)) between 3 and 300),
  citation_ref text,
  description text,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  priority text not null default 'high' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'ready', 'submitted', 'accepted', 'closed', 'canceled')),
  work_item_id uuid references public.work_items(id) on delete set null,
  evidence_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (war_room_id, request_number)
);
create index inspection_war_room_requests_queue_idx
  on public.inspection_war_room_requests(war_room_id, status, due_at);

create or replace function public.create_inspection_war_room(
  p_facility_id uuid,
  p_name text,
  p_inspection_type text,
  p_target_response_at timestamptz,
  p_lead_profile_id uuid,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid := app_private.assert_product_value_manager(p_facility_id); v_id uuid;
begin
  if p_lead_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_lead_profile_id and p.organization_id = v_org and p.is_active
  ) then
    raise exception 'Inspection lead is outside organization scope' using errcode = '42501';
  end if;
  insert into public.inspection_war_rooms(
    organization_id, facility_id, name, inspection_type, target_response_at,
    lead_profile_id, notes, created_by
  ) values (
    v_org, p_facility_id, btrim(p_name), p_inspection_type, p_target_response_at,
    p_lead_profile_id, nullif(btrim(p_notes), ''), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.add_inspection_war_room_request(
  p_war_room_id uuid,
  p_title text,
  p_citation_ref text,
  p_description text,
  p_owner_profile_id uuid,
  p_priority text,
  p_due_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.inspection_war_rooms%rowtype;
  v_request_id uuid;
  v_work_id uuid;
  v_template_id uuid;
  v_number integer;
begin
  select * into v_room from public.inspection_war_rooms where id = p_war_room_id for update;
  if not found then raise exception 'Inspection war room not found' using errcode = 'P0002'; end if;
  perform app_private.assert_product_value_manager(v_room.facility_id);
  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id and p.organization_id = v_room.organization_id and p.is_active
  ) then
    raise exception 'Inspection request owner is outside organization scope' using errcode = '42501';
  end if;
  select coalesce(max(request_number), 0) + 1 into v_number
  from public.inspection_war_room_requests where war_room_id = v_room.id;
  select id into v_template_id from public.work_item_templates
  where template_key = 'inspection.war_room_request' and organization_id is null and is_active limit 1;
  insert into public.work_items(
    organization_id, facility_id, template_id, source_type, source_id,
    deduplication_key, title, description, owner_profile_id, priority, due_at, created_by
  ) values (
    v_room.organization_id, v_room.facility_id, v_template_id, 'inspection_war_room', v_room.id,
    concat('inspection-war-room:', v_room.id, ':', v_number),
    btrim(p_title), nullif(btrim(p_description), ''), p_owner_profile_id,
    p_priority, p_due_at, auth.uid()
  ) returning id into v_work_id;
  insert into public.work_item_history(
    organization_id, facility_id, work_item_id, event_type, resulting_state, actor_profile_id, reason
  ) values (
    v_room.organization_id, v_room.facility_id, v_work_id, 'created', 'open', auth.uid(),
    concat('Inspection war-room request ', v_number)
  );
  insert into public.inspection_war_room_requests(
    organization_id, facility_id, war_room_id, request_number, title, citation_ref,
    description, owner_profile_id, priority, due_at, work_item_id, created_by
  ) values (
    v_room.organization_id, v_room.facility_id, v_room.id, v_number, btrim(p_title),
    nullif(btrim(p_citation_ref), ''), nullif(btrim(p_description), ''),
    p_owner_profile_id, p_priority, p_due_at, v_work_id, auth.uid()
  ) returning id into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.update_inspection_war_room_request(
  p_request_id uuid,
  p_status text,
  p_evidence_note text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.inspection_war_room_requests%rowtype;
begin
  select * into v_request from public.inspection_war_room_requests where id = p_request_id;
  if not found then raise exception 'Inspection request not found' using errcode = 'P0002'; end if;
  perform app_private.assert_product_value_manager(v_request.facility_id);
  if p_status not in ('open', 'in_progress', 'ready', 'submitted', 'accepted', 'closed', 'canceled') then
    raise exception 'Invalid inspection request state' using errcode = '22023';
  end if;
  update public.inspection_war_room_requests set status = p_status,
    evidence_note = nullif(btrim(p_evidence_note), ''), updated_at = now() where id = p_request_id;
  if v_request.work_item_id is not null and p_status in ('in_progress', 'closed', 'canceled') then
    update public.work_items set
      state = case when p_status = 'in_progress' then 'in_progress' when p_status = 'closed' then 'pending_approval' else 'canceled' end,
      updated_at = now()
    where id = v_request.work_item_id and state not in ('closed', 'canceled');
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Implementation and migration center
-- ---------------------------------------------------------------------------

create table public.implementation_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 3 and 160),
  status text not null default 'planning' check (status in ('planning', 'in_progress', 'ready', 'live', 'paused')),
  target_go_live_date date,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  source_systems jsonb not null default '[]'::jsonb check (jsonb_typeof(source_systems) = 'array'),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.implementation_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.implementation_projects(id) on delete cascade,
  task_key text not null,
  category text not null check (category in ('organization', 'data', 'compliance', 'communications', 'integrations', 'training', 'validation', 'launch')),
  title text not null,
  description text,
  required boolean not null default true,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'blocked', 'complete', 'not_applicable')),
  owner_profile_id uuid references public.profiles(id) on delete set null,
  due_date date,
  evidence_note text,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, task_key),
  check ((status = 'complete') = (completed_at is not null))
);
create index implementation_tasks_queue_idx on public.implementation_tasks(project_id, status, due_date);

create or replace function public.initialize_implementation_project(
  p_name text,
  p_target_go_live_date date,
  p_owner_profile_id uuid,
  p_source_systems jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid := app_private.assert_product_value_manager(null); v_id uuid;
begin
  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id and p.organization_id = v_org and p.is_active
  ) then
    raise exception 'Implementation owner is outside organization scope' using errcode = '42501';
  end if;
  insert into public.implementation_projects(
    organization_id, name, status, target_go_live_date, owner_profile_id, source_systems, created_by
  ) values (
    v_org, btrim(p_name), 'in_progress', p_target_go_live_date, p_owner_profile_id,
    coalesce(p_source_systems, '[]'::jsonb), auth.uid()
  ) returning id into v_id;
  insert into public.implementation_tasks(organization_id, project_id, task_key, category, title, description, due_date)
  select v_org, v_id, x.task_key, x.category, x.title, x.description,
    case when p_target_go_live_date is null then null else p_target_go_live_date - x.days_before end
  from (values
    ('org-profile', 'organization', 'Confirm organization and facility profiles', 'Verify license type, capacity, contacts, and facility access.', 45),
    ('roster-import', 'data', 'Import and reconcile the workforce roster', 'Resolve duplicates, unmapped facilities, and rejected rows.', 40),
    ('resident-import', 'data', 'Import resident and admission records', 'Validate census, room assignments, and assessment due dates.', 35),
    ('rule-pack', 'compliance', 'Approve the applicable compliance rule pack', 'Confirm jurisdiction, facility type, and effective dates.', 30),
    ('notification-test', 'communications', 'Prove email, SMS, and push delivery', 'Run provider tests, verify consent, and review failures.', 25),
    ('integration-test', 'integrations', 'Connect and reconcile external systems', 'Test HRIS, payroll, eMAR, SSO, API, and webhook connections in scope.', 20),
    ('training-launch', 'training', 'Assign launch training and manager practice', 'Complete sandbox workflows and role-specific learning.', 15),
    ('report-validation', 'validation', 'Reconcile reports, binders, and evidence', 'Compare sampled outputs with source records before launch.', 10),
    ('security-readiness', 'validation', 'Verify MFA, roles, exports, and recovery', 'Confirm privileged access and operational recovery steps.', 7),
    ('go-live', 'launch', 'Approve production go-live', 'Record owners, support coverage, cutover, and success criteria.', 0)
  ) as x(task_key, category, title, description, days_before);
  return v_id;
end;
$$;

create or replace function public.update_implementation_task(
  p_task_id uuid,
  p_status text,
  p_owner_profile_id uuid,
  p_due_date date,
  p_evidence_note text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_task public.implementation_tasks%rowtype;
begin
  select * into v_task from public.implementation_tasks where id = p_task_id;
  if not found then raise exception 'Implementation task not found' using errcode = 'P0002'; end if;
  perform app_private.assert_product_value_manager(null);
  if v_task.organization_id <> public.current_org_id() and not public.is_platform_admin() then
    raise exception 'Implementation task is outside caller scope' using errcode = '42501';
  end if;
  if p_status not in ('not_started', 'in_progress', 'blocked', 'complete', 'not_applicable') then
    raise exception 'Implementation task status is invalid' using errcode = '22023';
  end if;
  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id and p.organization_id = v_task.organization_id and p.is_active
  ) then
    raise exception 'Implementation task owner is outside organization scope' using errcode = '42501';
  end if;
  update public.implementation_tasks set
    status = p_status, owner_profile_id = p_owner_profile_id, due_date = p_due_date,
    evidence_note = nullif(btrim(p_evidence_note), ''),
    completed_at = case when p_status = 'complete' then coalesce(completed_at, now()) else null end,
    completed_by = case when p_status = 'complete' then auth.uid() else null end,
    updated_at = now()
  where id = p_task_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduled reports and customer-controlled value measurement
-- ---------------------------------------------------------------------------

create table public.customer_value_baselines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  hourly_admin_cost numeric(10,2) not null default 0 check (hourly_admin_cost >= 0),
  legacy_monthly_software_cost numeric(12,2) not null default 0 check (legacy_monthly_software_cost >= 0),
  retired_tools jsonb not null default '[]'::jsonb check (jsonb_typeof(retired_tools) = 'array'),
  time_saving_assumptions jsonb not null default '{"report_export_minutes":0,"mock_inspection_minutes":0,"course_completion_admin_minutes":0,"closed_work_item_minutes":0,"portal_message_minutes":0}'::jsonb,
  notes text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function app_private.next_report_schedule_run(
  p_frequency text,
  p_time_zone text,
  p_after timestamptz
) returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local_after timestamp without time zone;
  v_local_next timestamp without time zone;
begin
  if length(coalesce(p_time_zone, '')) not between 1 and 100 then
    raise exception 'Report time zone is invalid' using errcode = '22023';
  end if;
  begin
    v_local_after := p_after at time zone p_time_zone;
  exception when invalid_parameter_value then
    raise exception 'Report time zone is invalid' using errcode = '22023';
  end;
  case p_frequency
    when 'daily' then v_local_next := date_trunc('day', v_local_after) + interval '1 day 7 hours';
    when 'weekly' then v_local_next := date_trunc('week', v_local_after) + interval '1 week 7 hours';
    when 'monthly' then v_local_next := date_trunc('month', v_local_after) + interval '1 month 7 hours';
    else raise exception 'Unsupported report frequency' using errcode = '22023';
  end case;
  return v_local_next at time zone p_time_zone;
end;
$$;
revoke all on function app_private.next_report_schedule_run(text,text,timestamptz) from public, anon, authenticated;

create or replace function public.save_report_schedule(
  p_report_definition_id uuid,
  p_frequency text,
  p_delivery_mode text,
  p_audience jsonb,
  p_time_zone text default 'America/New_York'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_product_value_manager(null);
  v_definition public.saved_report_definitions%rowtype;
  v_cron text;
  v_next timestamptz;
  v_id uuid;
begin
  select * into v_definition from public.saved_report_definitions
  where id = p_report_definition_id and organization_id = v_org;
  if not found or v_definition.current_version_id is null then
    raise exception 'A published saved report is required' using errcode = 'P0002';
  end if;
  if p_delivery_mode <> 'in_app' then
    raise exception 'Unsupported report delivery mode' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_audience, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_audience->'roles', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_audience->'roles', '[]'::jsonb)) not between 1 and 5 then
    raise exception 'Report audience is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_audience->'roles') role_name
    where role_name not in ('org_admin', 'facility_manager', 'trainer', 'employee', 'auditor')
  ) then
    raise exception 'Report audience role is invalid' using errcode = '22023';
  end if;
  case p_frequency
    when 'daily' then v_cron := '0 7 * * *';
    when 'weekly' then v_cron := '0 7 * * 1';
    when 'monthly' then v_cron := '0 7 1 * *';
    else raise exception 'Unsupported report frequency' using errcode = '22023';
  end case;
  v_next := app_private.next_report_schedule_run(p_frequency, p_time_zone, now());
  insert into public.report_schedules(
    organization_id, report_definition_id, report_version_id, cron_expression,
    time_zone, delivery_mode, audience, retention_days, enabled, next_run_at, created_by
  ) values (
    v_org, v_definition.id, v_definition.current_version_id, v_cron,
    p_time_zone, p_delivery_mode, coalesce(p_audience, '{}'::jsonb),
    v_definition.retention_days, true, v_next, auth.uid()
  ) returning id into v_id;
  update public.saved_report_definitions set schedule_enabled = true, updated_at = now()
  where id = v_definition.id;
  return v_id;
end;
$$;

create or replace function public.set_report_schedule_enabled(p_schedule_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_schedule public.report_schedules%rowtype;
begin
  select * into v_schedule from public.report_schedules where id = p_schedule_id;
  if not found then raise exception 'Report schedule not found' using errcode = 'P0002'; end if;
  perform app_private.assert_product_value_manager(null);
  if v_schedule.organization_id <> public.current_org_id() and not public.is_platform_admin() then
    raise exception 'Report schedule is outside caller scope' using errcode = '42501';
  end if;
  update public.report_schedules set enabled = p_enabled,
    next_run_at = case when p_enabled then coalesce(next_run_at, now() + interval '1 day') else next_run_at end
  where id = p_schedule_id;
  return true;
end;
$$;

create or replace function public.process_due_report_schedules()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.report_schedules%rowtype;
  v_definition public.saved_report_definitions%rowtype;
  v_roles text[];
  v_processed integer := 0;
  v_next timestamptz;
begin
  for v_schedule in
    select * from public.report_schedules s
    where s.enabled and s.next_run_at is not null and s.next_run_at <= now()
    order by s.next_run_at
    for update skip locked
  loop
    select * into v_definition from public.saved_report_definitions where id = v_schedule.report_definition_id;
    select coalesce(array_agg(value), array['org_admin','facility_manager']::text[])
      into v_roles
    from jsonb_array_elements_text(coalesce(v_schedule.audience->'roles', '["org_admin","facility_manager"]'::jsonb)) value;
    insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
    select v_schedule.organization_id, p.id, 'report_subscription_ready',
      left(concat('Scheduled report ready: ', v_definition.name), 300),
      'Open the saved CareBase report with your current permissions. The link contains no exported resident or employee data.',
      concat('/app/reports?saved=', v_definition.id)
    from public.profiles p
    where p.organization_id = v_schedule.organization_id and p.is_active and p.role = any(v_roles);
    v_next := app_private.next_report_schedule_run(
      case v_schedule.cron_expression
        when '0 7 * * 1' then 'weekly'
        when '0 7 1 * *' then 'monthly'
        else 'daily'
      end,
      v_schedule.time_zone,
      greatest(now(), v_schedule.next_run_at)
    );
    update public.report_schedules set last_run_at = now(), next_run_at = v_next where id = v_schedule.id;
    v_processed := v_processed + 1;
  end loop;
  return v_processed;
end;
$$;
revoke all on function public.process_due_report_schedules() from public, anon, authenticated;
grant execute on function public.process_due_report_schedules() to service_role;

select cron.schedule(
  'process-carebase-report-subscriptions',
  '*/15 * * * *',
  $$select public.process_due_report_schedules();$$
);

create or replace function public.save_customer_value_baseline(
  p_hourly_admin_cost numeric,
  p_legacy_monthly_software_cost numeric,
  p_retired_tools jsonb,
  p_time_saving_assumptions jsonb,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid := app_private.assert_product_value_manager(null); v_id uuid;
begin
  if jsonb_typeof(coalesce(p_retired_tools, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_retired_tools, '[]'::jsonb)) > 20
     or jsonb_typeof(coalesce(p_time_saving_assumptions, '{}'::jsonb)) <> 'object'
     or coalesce(p_hourly_admin_cost, 0) not between 0 and 10000
     or coalesce(p_legacy_monthly_software_cost, 0) not between 0 and 10000000 then
    raise exception 'Value baseline must use structured assumptions' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_retired_tools, '[]'::jsonb)) tool
    where jsonb_typeof(tool) <> 'string' or length(btrim(tool #>> '{}')) not between 1 and 120
  ) or exists (
    select 1 from jsonb_each(coalesce(p_time_saving_assumptions, '{}'::jsonb)) assumption
    where assumption.key not in (
      'report_export_minutes', 'mock_inspection_minutes', 'course_completion_admin_minutes',
      'closed_work_item_minutes', 'portal_message_minutes'
    ) or jsonb_typeof(assumption.value) <> 'number'
  ) then
    raise exception 'Value baseline contains an unsupported assumption' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_each(coalesce(p_time_saving_assumptions, '{}'::jsonb)) assumption
    where (assumption.value #>> '{}')::numeric not between 0 and 10080
  ) then
    raise exception 'Value baseline assumption is outside the supported range' using errcode = '22023';
  end if;
  insert into public.customer_value_baselines(
    organization_id, hourly_admin_cost, legacy_monthly_software_cost,
    retired_tools, time_saving_assumptions, notes, updated_by
  ) values (
    v_org, greatest(coalesce(p_hourly_admin_cost, 0), 0),
    greatest(coalesce(p_legacy_monthly_software_cost, 0), 0),
    coalesce(p_retired_tools, '[]'::jsonb), coalesce(p_time_saving_assumptions, '{}'::jsonb),
    nullif(btrim(p_notes), ''), auth.uid()
  ) on conflict (organization_id) do update set
    hourly_admin_cost = excluded.hourly_admin_cost,
    legacy_monthly_software_cost = excluded.legacy_monthly_software_cost,
    retired_tools = excluded.retired_tools,
    time_saving_assumptions = excluded.time_saving_assumptions,
    notes = excluded.notes, updated_by = auth.uid(), updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_customer_value_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_baseline public.customer_value_baselines%rowtype;
  v_reports integer;
  v_mock_inspections integer;
  v_courses integer;
  v_closed_work integer;
  v_portal_messages integer;
  v_minutes numeric := 0;
begin
  if not public.is_platform_admin() and (v_org is null or public.current_role() not in ('org_admin', 'facility_manager', 'auditor')) then
    raise exception 'Value dashboard access denied' using errcode = '42501';
  end if;
  if public.is_platform_admin() and v_org is null then
    return jsonb_build_object('configured', false, 'reason', 'Select an organization to view customer value.');
  end if;
  select * into v_baseline from public.customer_value_baselines where organization_id = v_org;
  select count(*) into v_reports from public.product_events
    where organization_id = v_org and event_name in ('report_exported', 'payroll_exported') and occurred_at >= now() - interval '30 days';
  select count(*) into v_mock_inspections from public.product_events
    where organization_id = v_org and event_name = 'mock_inspection_completed' and occurred_at >= now() - interval '30 days';
  select count(*) into v_courses from public.course_assignments
    where organization_id = v_org and completed_at >= now() - interval '30 days';
  select count(*) into v_closed_work from public.work_items
    where organization_id = v_org and closed_at >= now() - interval '30 days';
  select count(*) into v_portal_messages from public.resident_portal_messages
    where organization_id = v_org and created_at >= now() - interval '30 days';
  if v_baseline.id is not null then
    v_minutes :=
      v_reports * coalesce((v_baseline.time_saving_assumptions->>'report_export_minutes')::numeric, 0)
      + v_mock_inspections * coalesce((v_baseline.time_saving_assumptions->>'mock_inspection_minutes')::numeric, 0)
      + v_courses * coalesce((v_baseline.time_saving_assumptions->>'course_completion_admin_minutes')::numeric, 0)
      + v_closed_work * coalesce((v_baseline.time_saving_assumptions->>'closed_work_item_minutes')::numeric, 0)
      + v_portal_messages * coalesce((v_baseline.time_saving_assumptions->>'portal_message_minutes')::numeric, 0);
  end if;
  return jsonb_build_object(
    'configured', v_baseline.id is not null,
    'periodDays', 30,
    'activity', jsonb_build_object(
      'reportExports', v_reports, 'mockInspections', v_mock_inspections,
      'courseCompletions', v_courses, 'closedWorkItems', v_closed_work,
      'portalMessages', v_portal_messages
    ),
    'estimatedHoursSaved', round(v_minutes / 60.0, 1),
    'estimatedLaborValue', round((v_minutes / 60.0) * coalesce(v_baseline.hourly_admin_cost, 0), 2),
    'retiredSoftwareMonthlyCost', coalesce(v_baseline.legacy_monthly_software_cost, 0),
    'retiredTools', coalesce(v_baseline.retired_tools, '[]'::jsonb),
    'assumptions', coalesce(v_baseline.time_saving_assumptions, '{}'::jsonb),
    'method', 'Customer-entered time and cost assumptions multiplied by recorded CareBase outcomes.',
    'generatedAt', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Staffing and admissions intelligence
-- ---------------------------------------------------------------------------

create or replace function public.get_staffing_optimization_snapshot(
  p_facility_id uuid,
  p_from date default current_date,
  p_through date default current_date + 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_schedule_id uuid;
  v_workload jsonb := '{}'::jsonb;
  v_open_shifts integer;
  v_time_off integer;
  v_pending_swaps integer;
  v_blocked integer;
begin
  v_org := app_private.assert_product_value_manager(p_facility_id);
  if p_through < p_from or p_through > p_from + 120 then
    raise exception 'Staffing forecast window is invalid' using errcode = '22023';
  end if;
  select s.id into v_schedule_id from public.schedules s
  where s.facility_id = p_facility_id and s.period_end >= p_from and s.period_start <= p_through
  order by case s.status when 'published' then 0 else 1 end, s.period_start limit 1;
  if v_schedule_id is not null then v_workload := public.get_schedule_service_workload(v_schedule_id); end if;
  select count(*) into v_open_shifts from public.open_shift_opportunities o
    where o.facility_id = p_facility_id and o.shift_date between p_from and p_through
      and o.status = 'open';
  select count(*) into v_time_off from public.workforce_time_off_requests r
    where r.facility_id = p_facility_id and r.status = 'pending'
      and r.starts_at::date <= p_through and r.ends_at::date >= p_from;
  select count(*) into v_pending_swaps from public.shift_swap_requests s
    where s.facility_id = p_facility_id and s.status = 'pending';
  select count(*) into v_blocked from public.schedule_eligibility_decisions d
    where d.facility_id = p_facility_id and d.outcome = 'blocked'
      and d.evaluated_at >= now() - interval '30 days';
  return jsonb_build_object(
    'facilityId', p_facility_id, 'from', p_from, 'through', p_through,
    'scheduleId', v_schedule_id, 'workload', v_workload,
    'openShifts', v_open_shifts, 'pendingTimeOff', v_time_off,
    'pendingSwaps', v_pending_swaps, 'recentBlockedAssignments', v_blocked,
    'recommendations', coalesce((
      select jsonb_agg(value)
      from jsonb_array_elements(jsonb_build_array(
        case when v_open_shifts > 0 then jsonb_build_object('priority', 'high', 'title', concat(v_open_shifts, ' open shifts need qualified coverage'), 'href', '/app/schedule') end,
        case when v_time_off > 0 then jsonb_build_object('priority', 'normal', 'title', concat(v_time_off, ' time-off requests await decisions'), 'href', '/app/workforce-operations') end,
        case when v_blocked > 0 then jsonb_build_object('priority', 'high', 'title', concat(v_blocked, ' assignment attempts were blocked by qualification rules'), 'href', '/app/workforce-operations') end
      )) value
      where value <> 'null'::jsonb
    ), '[]'::jsonb),
    'generatedAt', now()
  );
end;
$$;

create or replace function public.get_admissions_intelligence_snapshot(p_facility_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org uuid := public.current_org_id();
begin
  if not public.is_platform_admin() and (v_org is null or public.current_role() not in ('org_admin', 'facility_manager', 'auditor')) then
    raise exception 'Admissions intelligence access denied' using errcode = '42501';
  end if;
  if p_facility_id is not null and not public.is_platform_admin() and not public.is_assigned_to_facility(p_facility_id) then
    raise exception 'Facility is outside caller scope' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pipeline', jsonb_build_object(
      'active', (select count(*) from public.admission_prospects p where p.organization_id = v_org and (p_facility_id is null or p.facility_id = p_facility_id) and p.stage in ('prospect','applicant','approved','waitlisted','reserved')),
      'admitted30Days', (select count(*) from public.admission_prospects p where p.organization_id = v_org and (p_facility_id is null or p.facility_id = p_facility_id) and p.stage = 'admitted' and p.updated_at >= now() - interval '30 days'),
      'lost30Days', (select count(*) from public.admission_prospects p where p.organization_id = v_org and (p_facility_id is null or p.facility_id = p_facility_id) and p.stage in ('lost','declined') and p.updated_at >= now() - interval '30 days'),
      'expected30Days', (select count(*) from public.admission_prospects p where p.organization_id = v_org and (p_facility_id is null or p.facility_id = p_facility_id) and p.expected_move_in_date between current_date and current_date + 30)
    ),
    'occupancy', jsonb_build_object(
      'occupiedBeds', (select count(*) from public.facility_beds b where b.organization_id = v_org and (p_facility_id is null or b.facility_id = p_facility_id) and b.status = 'occupied'),
      'availableBeds', (select count(*) from public.facility_beds b where b.organization_id = v_org and (p_facility_id is null or b.facility_id = p_facility_id) and b.status = 'available'),
      'reservedBeds', (select count(*) from public.facility_beds b where b.organization_id = v_org and (p_facility_id is null or b.facility_id = p_facility_id) and b.status = 'reserved')
    ),
    'referralSources', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.admitted desc, x.inquiries desc) from (
        select coalesce(r.name, 'Direct inquiry') as source,
          count(*) as inquiries,
          count(*) filter (where p.stage = 'admitted') as admitted,
          round(100.0 * count(*) filter (where p.stage = 'admitted') / nullif(count(*), 0), 1) as conversion_percent
        from public.admission_prospects p
        left join public.referral_sources r on r.id = p.referral_source_id
        where p.organization_id = v_org and (p_facility_id is null or p.facility_id = p_facility_id)
        group by coalesce(r.name, 'Direct inquiry')
        order by admitted desc, inquiries desc limit 10
      ) x
    ), '[]'::jsonb),
    'generatedAt', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Offline learner mode
-- ---------------------------------------------------------------------------

create or replace function public.register_offline_learning_device(
  p_device_public_key text,
  p_device_fingerprint_sha256 text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_profile public.profiles%rowtype; v_id uuid;
begin
  select * into v_profile from public.profiles where id = auth.uid() and is_active;
  if not found or v_profile.role <> 'employee' or p_device_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
     or length(p_device_public_key) not between 16 and 4000 then
    raise exception 'Offline device registration is invalid' using errcode = '42501';
  end if;
  insert into public.offline_device_registrations(
    organization_id, profile_id, device_public_key, device_fingerprint_sha256, role_at_registration, status
  ) values (
    v_profile.organization_id, v_profile.id, p_device_public_key, p_device_fingerprint_sha256, 'employee', 'active'
  ) on conflict (profile_id, device_fingerprint_sha256) do update set
    device_public_key = excluded.device_public_key, status = 'active',
    revoked_at = null, wipe_required_at = null
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.prepare_offline_course_bundle(
  p_device_id uuid,
  p_assignment_id uuid,
  p_encrypted_content_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.offline_device_registrations%rowtype;
  v_assignment public.course_assignments%rowtype;
  v_course public.courses%rowtype;
  v_version public.course_versions%rowtype;
  v_bundle jsonb;
  v_hash text;
  v_manifest_version integer;
  v_manifest_id uuid;
begin
  if length(coalesce(p_encrypted_content_key, '')) not between 16 and 4000 then
    raise exception 'Encrypted offline content key is invalid' using errcode = '22023';
  end if;
  select * into v_device from public.offline_device_registrations where id = p_device_id;
  if not found or v_device.profile_id <> auth.uid() or v_device.status <> 'active' or v_device.wipe_required_at is not null then
    raise exception 'Offline device is unavailable' using errcode = '42501';
  end if;
  select a.* into v_assignment from public.course_assignments a
  join public.employees e on e.id = a.employee_id
  where a.id = p_assignment_id and e.profile_id = auth.uid() and a.status in ('assigned','in_progress','overdue');
  if not found or v_assignment.organization_id <> v_device.organization_id then
    raise exception 'Course assignment is outside caller identity' using errcode = '42501';
  end if;
  select * into v_course from public.courses where id = v_assignment.course_id;
  select * into v_version from public.course_versions where id = v_assignment.course_version_id and status = 'published';
  if not found then raise exception 'Published course version is unavailable' using errcode = '55000'; end if;
  select jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', v_assignment.id,
      'dueDate', v_assignment.due_date,
      'status', v_assignment.status,
      'serverBaseVersion', coalesce((
        select extract(epoch from cp.updated_at)::integer
        from public.course_progress cp
        where cp.assignment_id = v_assignment.id
      ), 0)
    ),
    'course', jsonb_build_object('id', v_course.id, 'title', v_course.title, 'description', v_course.description, 'category', v_course.category),
    'version', jsonb_build_object('id', v_version.id, 'versionNumber', v_version.version_number, 'title', v_version.title, 'description', v_version.description),
    'blocks', coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'type', b.block_type, 'sortOrder', b.sort_order, 'title', b.title,
      'body', b.body, 'videoUrl', b.video_url,
      'quiz', case when q.id is null then null else jsonb_build_object(
        'id', q.id, 'title', q.title, 'passingScorePercent', q.passing_score_percent,
        'questions', coalesce((select jsonb_agg(jsonb_build_object(
          'id', qq.id, 'questionText', qq.question_text, 'questionType', qq.question_type,
          'sortOrder', qq.sort_order, 'points', qq.points,
          'answers', coalesce((select jsonb_agg(jsonb_build_object('id', qa.id, 'answerText', qa.answer_text, 'sortOrder', qa.sort_order) order by qa.sort_order)
            from public.quiz_answers qa where qa.question_id = qq.id), '[]'::jsonb)
        ) order by qq.sort_order) from public.quiz_questions qq where qq.quiz_id = q.id), '[]'::jsonb)
      ) end
    ) order by b.sort_order), '[]'::jsonb)
  ) into v_bundle
  from public.course_blocks b left join public.quizzes q on q.course_block_id = b.id
  where b.course_version_id = v_version.id;
  v_hash := encode(extensions.digest(convert_to(v_bundle::text, 'UTF8'), 'sha256'), 'hex');
  select coalesce(max(manifest_version), 0) + 1 into v_manifest_version
  from public.offline_content_manifests where device_id = p_device_id and course_version_id = v_version.id;
  update public.offline_content_manifests set withdrawn_at = now()
  where device_id = p_device_id and course_version_id = v_version.id and withdrawn_at is null;
  insert into public.offline_content_manifests(
    organization_id, profile_id, device_id, course_version_id, manifest_version,
    content_sha256, encrypted_content_key, allowlisted_assets, expires_at
  ) values (
    v_device.organization_id, v_device.profile_id, v_device.id, v_version.id, v_manifest_version,
    v_hash, left(p_encrypted_content_key, 4000),
    coalesce((select jsonb_agg(jsonb_build_object('type', b.block_type, 'url', b.video_url))
      from public.course_blocks b where b.course_version_id = v_version.id and b.video_url is not null), '[]'::jsonb),
    now() + interval '30 days'
  ) returning id into v_manifest_id;
  return jsonb_build_object(
    'manifestId', v_manifest_id, 'manifestVersion', v_manifest_version,
    'contentSha256', v_hash, 'expiresAt', now() + interval '30 days', 'bundle', v_bundle
  );
end;
$$;

create or replace function public.revoke_offline_learning_device(p_device_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.offline_device_registrations set status = 'revoked', revoked_at = now(), wipe_required_at = now()
  where id = p_device_id and profile_id = auth.uid();
  if not found then raise exception 'Offline device not found' using errcode = 'P0002'; end if;
  update public.offline_content_manifests set withdrawn_at = now()
  where device_id = p_device_id and withdrawn_at is null;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Designated-person portal 2.0
-- ---------------------------------------------------------------------------

alter table public.resident_portal_grants drop constraint resident_portal_grants_permissions_check;
alter table public.resident_portal_grants add constraint resident_portal_grants_permissions_check check (
  cardinality(permissions) between 1 and 6
  and permissions <@ array['schedule', 'finance', 'documents', 'messages', 'requests', 'payments']::text[]
);

create table public.resident_portal_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  grant_id uuid not null references public.resident_portal_grants(id) on delete cascade,
  resident_id uuid not null references public.residents(id) on delete cascade,
  request_type text not null check (request_type in ('service_request', 'document_request', 'payment_question', 'schedule_change', 'general')),
  subject text not null check (length(btrim(subject)) between 3 and 200),
  detail text not null check (length(btrim(detail)) between 3 and 5000),
  status text not null default 'submitted' check (status in ('submitted', 'acknowledged', 'in_progress', 'resolved', 'declined')),
  assigned_to uuid references public.profiles(id) on delete set null,
  facility_response text,
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resident_portal_requests_queue_idx on public.resident_portal_requests(facility_id, status, created_at);

create table public.resident_portal_schedule_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  grant_id uuid not null references public.resident_portal_grants(id) on delete cascade,
  resident_id uuid not null references public.residents(id) on delete cascade,
  calendar_event_id uuid not null references public.resident_service_calendar_events(id) on delete cascade,
  response text not null check (response in ('confirmed', 'needs_change', 'cannot_attend')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (grant_id, calendar_event_id)
);

create table public.resident_payment_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  resident_id uuid not null references public.residents(id) on delete cascade,
  provider_name text not null,
  secure_url text not null check (secure_url ~ '^https://'),
  amount_due numeric(12,2) check (amount_due is null or amount_due >= 0),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'used', 'expired', 'revoked')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resident_payment_links_active_idx on public.resident_payment_links(resident_id, expires_at desc) where status = 'active';

create or replace function public.post_resident_portal_request(
  p_token text,
  p_request_type text,
  p_subject text,
  p_detail text,
  p_request_fingerprint_sha256 text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_grant public.resident_portal_grants%rowtype; v_id uuid;
begin
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if v_grant.id is null or v_grant.accepted_terms_at is null or not ('requests' = any(v_grant.permissions)) then
    raise exception 'Portal request access denied' using errcode = '42501';
  end if;
  if p_request_fingerprint_sha256 is not null and p_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Portal request fingerprint is invalid' using errcode = '22023';
  end if;
  insert into public.resident_portal_requests(
    organization_id, facility_id, grant_id, resident_id, request_type, subject, detail
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    p_request_type, btrim(p_subject), btrim(p_detail)
  ) returning id into v_id;
  insert into public.notifications(organization_id, profile_id, notification_type, title, body, link)
  select v_grant.organization_id, p.id, 'resident_portal_request',
    'New designated-person portal request', left(btrim(p_subject), 300),
    concat('/app/residents/', v_grant.resident_id)
  from public.profiles p
  where p.organization_id = v_grant.organization_id and p.is_active and p.role in ('org_admin', 'facility_manager');
  insert into public.resident_portal_access_events(
    organization_id, facility_id, grant_id, resident_id, event_type, request_fingerprint_sha256
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    'request_submitted', p_request_fingerprint_sha256
  );
  return v_id;
end;
$$;

create or replace function public.respond_resident_portal_schedule_event(
  p_token text,
  p_calendar_event_id uuid,
  p_response text,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_grant public.resident_portal_grants%rowtype; v_id uuid;
begin
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if v_grant.id is null or v_grant.accepted_terms_at is null or not ('schedule' = any(v_grant.permissions))
     or not exists (select 1 from public.resident_service_calendar_events e where e.id = p_calendar_event_id and e.resident_id = v_grant.resident_id)
     or p_response not in ('confirmed', 'needs_change', 'cannot_attend') then
    raise exception 'Schedule response is outside portal scope' using errcode = '42501';
  end if;
  insert into public.resident_portal_schedule_responses(
    organization_id, facility_id, grant_id, resident_id, calendar_event_id, response, note
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    p_calendar_event_id, p_response, nullif(btrim(p_note), '')
  ) on conflict (grant_id, calendar_event_id) do update set
    response = excluded.response, note = excluded.note, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.save_resident_payment_link(
  p_resident_id uuid,
  p_provider_name text,
  p_secure_url text,
  p_amount_due numeric,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_resident public.residents%rowtype; v_id uuid;
begin
  v_resident := app_private.assert_resident_portal_manager(p_resident_id);
  if length(btrim(coalesce(p_provider_name, ''))) not between 2 and 120
     or length(coalesce(p_secure_url, '')) not between 12 and 2000
     or p_secure_url !~ '^https://'
     or p_expires_at <= now() or p_expires_at > now() + interval '90 days' then
    raise exception 'Payment link is invalid' using errcode = '22023';
  end if;
  update public.resident_payment_links set status = 'revoked', updated_at = now()
  where resident_id = p_resident_id and status = 'active';
  insert into public.resident_payment_links(
    organization_id, facility_id, resident_id, provider_name, secure_url,
    amount_due, expires_at, created_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id, btrim(p_provider_name),
    p_secure_url, p_amount_due, p_expires_at, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.authorize_resident_portal_document_download(
  p_token text,
  p_shared_document_id uuid,
  p_request_fingerprint_sha256 text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.resident_portal_grants%rowtype;
  v_shared public.resident_portal_shared_documents%rowtype;
  v_document public.resident_documents%rowtype;
begin
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  select * into v_shared from public.resident_portal_shared_documents where id = p_shared_document_id;
  if v_grant.id is null or v_grant.accepted_terms_at is null or not ('documents' = any(v_grant.permissions))
     or v_shared.id is null or v_shared.grant_id <> v_grant.id or v_shared.withdrawn_at is not null then
    raise exception 'Portal document access denied' using errcode = '42501';
  end if;
  select * into v_document from public.resident_documents where id = v_shared.document_id;
  if v_document.id is null or v_document.resident_id <> v_grant.resident_id
     or v_document.storage_bucket is null or v_document.storage_path is null then
    raise exception 'Portal document is unavailable' using errcode = 'P0002';
  end if;
  if p_request_fingerprint_sha256 is not null and p_request_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Portal request fingerprint is invalid' using errcode = '22023';
  end if;
  insert into public.resident_portal_access_events(
    organization_id, facility_id, grant_id, resident_id, event_type, request_fingerprint_sha256
  ) values (
    v_grant.organization_id, v_grant.facility_id, v_grant.id, v_grant.resident_id,
    'document_downloaded', p_request_fingerprint_sha256
  );
  return jsonb_build_object(
    'authorized', true, 'bucket', v_document.storage_bucket, 'path', v_document.storage_path,
    'fileName', v_document.file_name, 'fileType', v_document.file_type
  );
end;
$$;

-- Extend the existing snapshot without exposing unpermissioned data.
create or replace function public.get_resident_portal_experience(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_grant public.resident_portal_grants%rowtype; v_snapshot jsonb; v_requests jsonb := '[]'::jsonb; v_payment jsonb := 'null'::jsonb;
begin
  v_snapshot := public.get_resident_portal_snapshot(p_token, null);
  if v_snapshot->>'accessStatus' <> 'active' then return v_snapshot; end if;
  v_grant := app_private.find_active_resident_portal_grant(p_token);
  if 'requests' = any(v_grant.permissions) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'requestType', r.request_type, 'subject', r.subject, 'detail', r.detail,
      'status', r.status, 'facilityResponse', r.facility_response, 'createdAt', r.created_at
    ) order by r.created_at desc), '[]'::jsonb) into v_requests
    from public.resident_portal_requests r where r.grant_id = v_grant.id;
  end if;
  if 'payments' = any(v_grant.permissions) then
    select coalesce(to_jsonb(x), 'null'::jsonb) into v_payment from (
      select p.id, p.provider_name as "providerName", p.secure_url as "secureUrl",
        p.amount_due as "amountDue", p.expires_at as "expiresAt"
      from public.resident_payment_links p
      where p.resident_id = v_grant.resident_id and p.status = 'active' and p.expires_at > now()
      order by p.created_at desc limit 1
    ) x;
  end if;
  return v_snapshot || jsonb_build_object('requests', v_requests, 'payment', v_payment);
end;
$$;

-- ---------------------------------------------------------------------------
-- Medication exception ownership and SLA
-- ---------------------------------------------------------------------------

alter table public.medication_integration_exceptions
  add column owner_profile_id uuid references public.profiles(id) on delete set null,
  add column due_at timestamptz,
  add column service_level_minutes integer not null default 1440 check (service_level_minutes between 15 and 10080),
  add column escalated_at timestamptz,
  add column linked_work_item_id uuid references public.work_items(id) on delete set null;

create index medication_exception_owner_queue_idx
  on public.medication_integration_exceptions(owner_profile_id, status, due_at)
  where status in ('open', 'acknowledged');

create or replace function public.assign_medication_integration_exception(
  p_exception_id uuid,
  p_owner_profile_id uuid,
  p_due_at timestamptz,
  p_service_level_minutes integer default 1440,
  p_create_work_item boolean default true
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exception public.medication_integration_exceptions%rowtype;
  v_template_id uuid;
  v_work_id uuid;
begin
  select * into v_exception from public.medication_integration_exceptions where id = p_exception_id for update;
  if not found then raise exception 'Medication exception not found' using errcode = 'P0002'; end if;
  perform app_private.assert_medication_scope(v_exception.organization_id, v_exception.facility_id, 'medications.integration.manage');
  if p_owner_profile_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_owner_profile_id and p.organization_id = v_exception.organization_id and p.is_active
  ) then
    raise exception 'Medication exception owner is outside organization scope' using errcode = '42501';
  end if;
  if p_due_at is null or p_due_at <= now() or p_service_level_minutes not between 15 and 10080 then
    raise exception 'Medication exception service level is invalid' using errcode = '22023';
  end if;
  if p_create_work_item and v_exception.linked_work_item_id is null then
    select id into v_template_id from public.work_item_templates
    where template_key = 'medication.integration_exception' and organization_id is null and is_active limit 1;
    insert into public.work_items(
      organization_id, facility_id, template_id, source_type, source_id, deduplication_key,
      title, description, owner_profile_id, priority, due_at, created_by
    ) values (
      v_exception.organization_id, v_exception.facility_id, v_template_id,
      'medication_exception', v_exception.id, concat('medication-exception:', v_exception.id),
      concat('Medication integration: ', replace(v_exception.exception_type, '_', ' ')),
      v_exception.summary, p_owner_profile_id,
      case when v_exception.severity = 'urgent' then 'urgent' when v_exception.severity = 'high' then 'high' else 'normal' end,
      p_due_at, auth.uid()
    ) returning id into v_work_id;
    insert into public.work_item_history(
      organization_id, facility_id, work_item_id, event_type, resulting_state, actor_profile_id, reason
    ) values (
      v_exception.organization_id, v_exception.facility_id, v_work_id, 'created', 'open', auth.uid(),
      'Medication integration exception assigned'
    );
  else v_work_id := v_exception.linked_work_item_id;
  end if;
  if v_work_id is not null then
    update public.work_items set owner_profile_id = p_owner_profile_id, due_at = p_due_at, updated_at = now()
    where id = v_work_id and organization_id = v_exception.organization_id and state not in ('closed', 'canceled');
  end if;
  update public.medication_integration_exceptions set
    owner_profile_id = p_owner_profile_id, due_at = p_due_at,
    service_level_minutes = p_service_level_minutes, linked_work_item_id = v_work_id,
    status = case when status = 'open' then 'acknowledged' else status end, updated_at = now()
  where id = p_exception_id;
  return v_work_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Governed copilot action drafts
-- ---------------------------------------------------------------------------

create table public.copilot_action_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  intent text not null,
  title text not null check (length(btrim(title)) between 3 and 300),
  source_response_id uuid,
  proposed_actions jsonb not null check (jsonb_typeof(proposed_actions) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'executed')),
  review_note text,
  created_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index copilot_action_drafts_queue_idx on public.copilot_action_drafts(organization_id, status, created_at desc);

create or replace function public.create_copilot_action_draft(
  p_facility_id uuid,
  p_intent text,
  p_title text,
  p_source_response_id uuid,
  p_proposed_actions jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid := app_private.assert_product_value_manager(p_facility_id); v_id uuid;
begin
  if jsonb_typeof(coalesce(p_proposed_actions, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_proposed_actions, '[]'::jsonb)) not between 1 and 20 then
    raise exception 'Copilot action draft is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_proposed_actions) action
    where jsonb_typeof(action) <> 'object'
      or length(btrim(coalesce(action->>'title', ''))) not between 3 and 300
      or (action ? 'priority' and action->>'priority' not in ('low', 'normal', 'high', 'urgent'))
      or (action ? 'dueDays' and jsonb_typeof(action->'dueDays') <> 'number')
  ) then
    raise exception 'Copilot action payload is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_proposed_actions) action
    where action ? 'dueDays' and (
      (action->>'dueDays')::numeric <> trunc((action->>'dueDays')::numeric)
      or (action->>'dueDays')::numeric not between 0 and 365
    )
  ) then
    raise exception 'Copilot action due date is invalid' using errcode = '22023';
  end if;
  insert into public.copilot_action_drafts(
    organization_id, facility_id, intent, title, source_response_id, proposed_actions, created_by
  ) values (
    v_org, p_facility_id, left(p_intent, 100), btrim(p_title), p_source_response_id,
    p_proposed_actions, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.review_copilot_action_draft(
  p_draft_id uuid,
  p_decision text,
  p_review_note text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.copilot_action_drafts%rowtype;
  v_action jsonb;
  v_template_id uuid;
  v_work_id uuid;
  v_work_ids jsonb := '[]'::jsonb;
  v_index integer := 0;
begin
  select * into v_draft from public.copilot_action_drafts where id = p_draft_id for update;
  if not found then raise exception 'Copilot draft not found' using errcode = 'P0002'; end if;
  perform app_private.assert_product_value_manager(v_draft.facility_id);
  if v_draft.status <> 'draft' or p_decision not in ('approve', 'reject') or length(btrim(coalesce(p_review_note, ''))) < 5 then
    raise exception 'Copilot draft review is invalid' using errcode = '22023';
  end if;
  if p_decision = 'reject' then
    update public.copilot_action_drafts set status = 'rejected', review_note = btrim(p_review_note),
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() where id = v_draft.id;
    return jsonb_build_object('status', 'rejected', 'workItemIds', v_work_ids);
  end if;
  select id into v_template_id from public.work_item_templates
    where template_key = 'copilot.action_draft' and organization_id is null and is_active limit 1;
  for v_action in select value from jsonb_array_elements(v_draft.proposed_actions) loop
    v_index := v_index + 1;
    insert into public.work_items(
      organization_id, facility_id, template_id, source_type, source_id, deduplication_key,
      title, description, priority, due_at, created_by
    ) values (
      v_draft.organization_id, v_draft.facility_id, v_template_id, 'copilot_draft', v_draft.id,
      concat('copilot-draft:', v_draft.id, ':', v_index),
      left(coalesce(nullif(v_action->>'title', ''), concat(v_draft.title, ' - action ', v_index)), 300),
      left(coalesce(v_action->>'description', v_action->>'detail', ''), 5000),
      case when v_action->>'priority' in ('low', 'normal', 'high', 'urgent') then v_action->>'priority' else 'normal' end,
      now() + make_interval(days => least(greatest(coalesce((v_action->>'dueDays')::integer, 7), 0), 365)),
      auth.uid()
    ) returning id into v_work_id;
    insert into public.work_item_history(
      organization_id, facility_id, work_item_id, event_type, resulting_state, actor_profile_id, reason
    ) values (
      v_draft.organization_id, v_draft.facility_id, v_work_id, 'created', 'open', auth.uid(),
      concat('Approved governed copilot draft: ', btrim(p_review_note))
    );
    v_work_ids := v_work_ids || jsonb_build_array(v_work_id);
  end loop;
  update public.copilot_action_drafts set status = 'executed', review_note = btrim(p_review_note),
    reviewed_by = auth.uid(), reviewed_at = now(), executed_at = now(), updated_at = now()
  where id = v_draft.id;
  return jsonb_build_object('status', 'executed', 'workItemIds', v_work_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- Consolidated workspace read model
-- ---------------------------------------------------------------------------

create or replace function public.get_product_value_workspace(p_facility_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org uuid := public.current_org_id();
begin
  if not public.is_platform_admin() and (v_org is null or public.current_role() not in ('org_admin', 'facility_manager', 'auditor')) then
    raise exception 'Product value workspace access denied' using errcode = '42501';
  end if;
  if p_facility_id is not null and not public.is_platform_admin() and not public.is_assigned_to_facility(p_facility_id) then
    raise exception 'Facility is outside caller scope' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'automations', coalesce((select jsonb_agg(to_jsonb(r) order by r.updated_at desc)
      from public.workflow_automation_rules r where r.organization_id = v_org and (p_facility_id is null or r.facility_id is null or r.facility_id = p_facility_id)), '[]'::jsonb),
    'automationRuns', coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at desc) from (
      select * from public.workflow_automation_runs r where r.organization_id = v_org
      and (p_facility_id is null or r.facility_id = p_facility_id) order by r.occurred_at desc limit 20
    ) x), '[]'::jsonb),
    'warRooms', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select w.*, coalesce((select jsonb_agg(to_jsonb(q) order by q.request_number) from public.inspection_war_room_requests q where q.war_room_id = w.id), '[]'::jsonb) as requests
      from public.inspection_war_rooms w where w.organization_id = v_org and (p_facility_id is null or w.facility_id = p_facility_id)
    ) x), '[]'::jsonb),
    'implementationProjects', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select p.*, coalesce((select jsonb_agg(to_jsonb(t) order by t.category, t.created_at) from public.implementation_tasks t where t.project_id = p.id), '[]'::jsonb) as tasks
      from public.implementation_projects p where p.organization_id = v_org
    ) x), '[]'::jsonb),
    'reportSchedules', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'reportDefinitionId', s.report_definition_id, 'name', d.name,
      'cronExpression', s.cron_expression, 'timeZone', s.time_zone, 'deliveryMode', s.delivery_mode,
      'audience', s.audience, 'enabled', s.enabled, 'nextRunAt', s.next_run_at, 'lastRunAt', s.last_run_at
    ) order by s.created_at desc) from public.report_schedules s join public.saved_report_definitions d on d.id = s.report_definition_id where s.organization_id = v_org), '[]'::jsonb),
    'integration', jsonb_build_object(
      'credentials', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'scopes', c.scopes, 'status', c.status, 'expiresAt', c.expires_at, 'lastUsedAt', c.last_used_at) order by c.created_at desc) from public.integration_api_credentials c where c.organization_id = v_org), '[]'::jsonb),
      'endpoints', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'status', e.status, 'consecutiveFailures', e.consecutive_failures, 'lastSuccessAt', e.last_success_at, 'lastFailureAt', e.last_failure_at) order by e.created_at desc) from public.integration_webhook_endpoints e where e.organization_id = v_org), '[]'::jsonb),
      'deliveryFailures', (select count(*) from public.integration_webhook_deliveries d where d.organization_id = v_org and d.status in ('retry', 'dead_letter'))
    ),
    'portalRequests', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select r.* from public.resident_portal_requests r where r.organization_id = v_org and (p_facility_id is null or r.facility_id = p_facility_id) order by r.created_at desc limit 50
    ) x), '[]'::jsonb),
    'medicationExceptions', coalesce((select jsonb_agg(to_jsonb(x) order by x.last_seen_at desc) from (
      select e.* from public.medication_integration_exceptions e
      where e.organization_id = v_org and (p_facility_id is null or e.facility_id = p_facility_id)
        and e.status not in ('resolved', 'dismissed')
      order by e.last_seen_at desc limit 50
    ) x), '[]'::jsonb),
    'copilotDrafts', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from public.copilot_action_drafts d where d.organization_id = v_org and (p_facility_id is null or d.facility_id = p_facility_id)), '[]'::jsonb),
    'offline', jsonb_build_object(
      'activeDevices', (select count(*) from public.offline_device_registrations d where d.organization_id = v_org and d.status = 'active' and d.wipe_required_at is null),
      'activeManifests', (select count(*) from public.offline_content_manifests m where m.organization_id = v_org and m.withdrawn_at is null and m.expires_at > now()),
      'syncConflicts', (select count(*) from public.offline_sync_receipts r where r.organization_id = v_org and r.outcome = 'conflict')
    ),
    'generatedAt', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS, immutability, grants, and notification types
-- ---------------------------------------------------------------------------

create or replace function app_private.prevent_product_value_evidence_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Product value execution evidence is append-only' using errcode = '55000'; end;
$$;
create trigger prevent_workflow_automation_run_mutation
before update or delete on public.workflow_automation_runs
for each row execute function app_private.prevent_product_value_evidence_mutation();

do $$ declare t text; begin
  foreach t in array array[
    'workflow_automation_rules', 'workflow_automation_runs',
    'inspection_war_rooms', 'inspection_war_room_requests',
    'implementation_projects', 'implementation_tasks', 'customer_value_baselines',
    'resident_portal_requests', 'resident_portal_schedule_responses', 'resident_payment_links',
    'copilot_action_drafts'
  ] loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

create policy workflow_automation_rules_select on public.workflow_automation_rules for select to authenticated
  using ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()) and (
    (select public.current_role()) in ('org_admin','auditor')
    or (select public.current_role()) = 'facility_manager' and (facility_id is null or public.is_assigned_to_facility(facility_id))
  ));
create policy workflow_automation_runs_select on public.workflow_automation_runs for select to authenticated
  using ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()) and (
    (select public.current_role()) in ('org_admin','auditor')
    or (select public.current_role()) = 'facility_manager' and facility_id is not null and public.is_assigned_to_facility(facility_id)
  ));
create policy inspection_war_rooms_select on public.inspection_war_rooms for select to authenticated
  using ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()) and ((select public.current_role()) in ('org_admin','auditor') or (select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id)));
create policy inspection_war_room_requests_select on public.inspection_war_room_requests for select to authenticated
  using ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()) and ((select public.current_role()) in ('org_admin','auditor') or (select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id)));
create policy implementation_projects_select on public.implementation_projects for select to authenticated
  using ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager','auditor'));
create policy implementation_tasks_select on public.implementation_tasks for select to authenticated
  using ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager','auditor'));
create policy customer_value_baselines_select on public.customer_value_baselines for select to authenticated
  using ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager','auditor'));
create policy resident_portal_requests_select on public.resident_portal_requests for select to authenticated
  using ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()) and ((select public.current_role()) in ('org_admin','auditor') or (select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id)));
create policy resident_portal_schedule_responses_select on public.resident_portal_schedule_responses for select to authenticated
  using ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()) and ((select public.current_role()) in ('org_admin','auditor') or (select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id)));
create policy resident_payment_links_select on public.resident_payment_links for select to authenticated
  using ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()) and ((select public.current_role()) in ('org_admin','auditor') or (select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id)));
create policy copilot_action_drafts_select on public.copilot_action_drafts for select to authenticated
  using ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()) and ((select public.current_role()) in ('org_admin','auditor') or (select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id)));

do $$ declare t text; begin
  foreach t in array array[
    'workflow_automation_rules', 'workflow_automation_runs',
    'inspection_war_rooms', 'inspection_war_room_requests',
    'implementation_projects', 'implementation_tasks', 'customer_value_baselines',
    'resident_portal_requests', 'resident_portal_schedule_responses', 'resident_payment_links',
    'copilot_action_drafts'
  ] loop
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (
  notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued',
    'training_due_soon', 'training_expired', 'competency_recorded',
    'missing_document', 'certificate_expiring', 'practicum_due_soon', 'practicum_expired',
    'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
    'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due',
    'support_ticket_update', 'workforce_lifecycle_changed', 'training_registration_changed',
    'open_shift_claim_changed', 'shift_swap_changed', 'credential_renewal_changed',
    'qualification_changed', 'course_assignment_due_soon',
    'shift_handoff_assigned', 'shift_handoff_escalated', 'shift_handoff_resolved',
    'time_off_request_changed', 'portal_message_received', 'schedule_published',
    'announcement_published', 'manager_weekly_digest',
    'automation_action_due', 'report_subscription_ready', 'resident_portal_request'
  )
);

alter table public.resident_portal_access_events drop constraint resident_portal_access_events_event_type_check;
alter table public.resident_portal_access_events add constraint resident_portal_access_events_event_type_check check (
  event_type in (
    'terms_accepted', 'view', 'message_sent', 'document_list_viewed', 'denied', 'revoked',
    'request_submitted', 'document_downloaded', 'schedule_response'
  )
);

revoke all on function
  public.save_workflow_automation_rule(uuid,uuid,text,text,text,jsonb,jsonb,text),
  public.run_workflow_automation_now(uuid,uuid,text,uuid,jsonb),
  public.create_inspection_war_room(uuid,text,text,timestamptz,uuid,text),
  public.add_inspection_war_room_request(uuid,text,text,text,uuid,text,timestamptz),
  public.update_inspection_war_room_request(uuid,text,text),
  public.initialize_implementation_project(text,date,uuid,jsonb),
  public.update_implementation_task(uuid,text,uuid,date,text),
  public.save_report_schedule(uuid,text,text,jsonb,text),
  public.set_report_schedule_enabled(uuid,boolean),
  public.save_customer_value_baseline(numeric,numeric,jsonb,jsonb,text),
  public.get_customer_value_dashboard(),
  public.get_staffing_optimization_snapshot(uuid,date,date),
  public.get_admissions_intelligence_snapshot(uuid),
  public.register_offline_learning_device(text,text),
  public.prepare_offline_course_bundle(uuid,uuid,text),
  public.revoke_offline_learning_device(uuid),
  public.post_resident_portal_request(text,text,text,text,text),
  public.respond_resident_portal_schedule_event(text,uuid,text,text),
  public.save_resident_payment_link(uuid,text,text,numeric,timestamptz),
  public.authorize_resident_portal_document_download(text,uuid,text),
  public.get_resident_portal_experience(text),
  public.assign_medication_integration_exception(uuid,uuid,timestamptz,integer,boolean),
  public.create_copilot_action_draft(uuid,text,text,uuid,jsonb),
  public.review_copilot_action_draft(uuid,text,text),
  public.get_product_value_workspace(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.save_workflow_automation_rule(uuid,uuid,text,text,text,jsonb,jsonb,text),
  public.run_workflow_automation_now(uuid,uuid,text,uuid,jsonb),
  public.create_inspection_war_room(uuid,text,text,timestamptz,uuid,text),
  public.add_inspection_war_room_request(uuid,text,text,text,uuid,text,timestamptz),
  public.update_inspection_war_room_request(uuid,text,text),
  public.initialize_implementation_project(text,date,uuid,jsonb),
  public.update_implementation_task(uuid,text,uuid,date,text),
  public.save_report_schedule(uuid,text,text,jsonb,text),
  public.set_report_schedule_enabled(uuid,boolean),
  public.save_customer_value_baseline(numeric,numeric,jsonb,jsonb,text),
  public.get_customer_value_dashboard(),
  public.get_staffing_optimization_snapshot(uuid,date,date),
  public.get_admissions_intelligence_snapshot(uuid),
  public.register_offline_learning_device(text,text),
  public.prepare_offline_course_bundle(uuid,uuid,text),
  public.revoke_offline_learning_device(uuid),
  public.save_resident_payment_link(uuid,text,text,numeric,timestamptz),
  public.assign_medication_integration_exception(uuid,uuid,timestamptz,integer,boolean),
  public.create_copilot_action_draft(uuid,text,text,uuid,jsonb),
  public.review_copilot_action_draft(uuid,text,text),
  public.get_product_value_workspace(uuid)
to authenticated, service_role;

grant execute on function
  public.post_resident_portal_request(text,text,text,text,text),
  public.respond_resident_portal_schedule_event(text,uuid,text,text),
  public.authorize_resident_portal_document_download(text,uuid,text),
  public.get_resident_portal_experience(text)
to anon, authenticated, service_role;

create trigger set_updated_at before update on public.workflow_automation_rules
for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.inspection_war_rooms
for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.inspection_war_room_requests
for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.implementation_projects
for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.implementation_tasks
for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.customer_value_baselines
for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.resident_portal_requests
for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.resident_portal_schedule_responses
for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.resident_payment_links
for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.copilot_action_drafts
for each row execute function public.set_updated_at();
