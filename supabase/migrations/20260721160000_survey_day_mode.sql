-- Survey Day Mode (E19). A durable, facility-scoped survey-day workspace that composes existing
-- primitives (entrance-conference checklist, compliance binder jobs, evidence collections, staff
-- readiness) without creating a second binder, evidence store, checklist definition system, or guest
-- access mechanism. Activation/refresh/closure are durable audit events; the mode is gated behind the
-- org-scoped `survey_day_mode` feature flag and the CareBase product module.

-- ---------------------------------------------------------------------------------------------------
-- Feature flag definition (org-scoped; default off; enable per organization for pilot rollout).
-- ---------------------------------------------------------------------------------------------------
insert into public.feature_definitions (feature_key, display_name, value_type, default_value, is_active)
values ('survey_day_mode', 'Survey Day Mode', 'boolean', 'false'::jsonb, true)
on conflict (feature_key) do nothing;

-- ---------------------------------------------------------------------------------------------------
-- Event metadata safety: reject token / contact / free-form document-content keys from event metadata.
-- ---------------------------------------------------------------------------------------------------
create or replace function app_private.survey_day_metadata_is_safe(p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_metadata is null
    or (jsonb_typeof(p_metadata) = 'object'
        and not exists (
          select 1
          from jsonb_object_keys(p_metadata) as k(key)
          where lower(k.key) ~ '(token|secret|password|email|phone|ssn|dob|birth|address|narrative|contact|document|content)'
        ));
$$;
revoke all on function app_private.survey_day_metadata_is_safe(jsonb) from public, anon;
grant execute on function app_private.survey_day_metadata_is_safe(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- Tables.
-- ---------------------------------------------------------------------------------------------------
create table public.survey_day_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'closed', 'expired')),
  activated_by uuid not null references public.profiles(id),
  activated_at timestamptz not null default now(),
  last_refreshed_at timestamptz not null default now(),
  source_watermarks jsonb not null default '{}'::jsonb,
  pinned_binder_job_id uuid references public.binder_export_jobs(id) on delete set null,
  pinned_evidence_collection_id uuid references public.evidence_collections(id) on delete set null,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one active session per facility; concurrent activations converge idempotently.
create unique index survey_day_sessions_active_facility_uidx
  on public.survey_day_sessions (facility_id) where status = 'active';
create index survey_day_sessions_org_idx on public.survey_day_sessions (organization_id, facility_id, status);

create table public.survey_day_checklist_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.survey_day_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  entrance_conference_item_id uuid references public.entrance_conference_items(id) on delete set null,
  -- Activation-time snapshots; immutable after insert (see drift-guard trigger below).
  prompt text not null,
  category text not null,
  data_source text not null,
  item_types text[],
  sort_order integer not null default 0,
  source_watermark timestamptz,
  disposition text check (disposition in ('ready', 'provided', 'not_requested', 'needs_follow_up')),
  disposition_note text,
  disposition_by uuid references public.profiles(id),
  disposition_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, entrance_conference_item_id)
);
create index survey_day_checklist_items_session_idx on public.survey_day_checklist_items (session_id, sort_order);

create table public.survey_day_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.survey_day_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  event_type text not null check (event_type in (
    'activated', 'checks_refreshed', 'checklist_disposition_recorded',
    'binder_requested', 'binder_pinned', 'binder_downloaded',
    'evidence_collection_opened', 'staff_roster_opened',
    'closed', 'expired'
  )),
  metadata jsonb not null default '{}'::jsonb check (app_private.survey_day_metadata_is_safe(metadata)),
  occurred_at timestamptz not null default now()
);
create index survey_day_events_session_idx on public.survey_day_events (session_id, occurred_at desc);

-- ---------------------------------------------------------------------------------------------------
-- Immutability + updated_at maintenance.
-- ---------------------------------------------------------------------------------------------------
create trigger set_survey_day_sessions_updated_at
  before update on public.survey_day_sessions
  for each row execute function public.set_updated_at();
create trigger set_survey_day_checklist_items_updated_at
  before update on public.survey_day_checklist_items
  for each row execute function public.set_updated_at();

-- Snapshot columns cannot drift after activation; only disposition fields may change.
create or replace function app_private.prevent_survey_day_checklist_snapshot_drift()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.prompt is distinct from old.prompt
     or new.category is distinct from old.category
     or new.data_source is distinct from old.data_source
     or new.item_types is distinct from old.item_types
     or new.sort_order is distinct from old.sort_order
     or new.entrance_conference_item_id is distinct from old.entrance_conference_item_id
     or new.session_id is distinct from old.session_id then
    raise exception 'Survey Day checklist snapshot is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger prevent_survey_day_checklist_snapshot_drift
  before update on public.survey_day_checklist_items
  for each row execute function app_private.prevent_survey_day_checklist_snapshot_drift();

-- The event stream is append-only.
create or replace function app_private.prevent_survey_day_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Survey Day events are append-only' using errcode = '55000';
end;
$$;
create trigger prevent_survey_day_event_mutation
  before update or delete on public.survey_day_events
  for each row execute function app_private.prevent_survey_day_event_mutation();

-- ---------------------------------------------------------------------------------------------------
-- Audit registration.
-- ---------------------------------------------------------------------------------------------------
-- Mutable state tables are row-audited; survey_day_events is self-auditing append-only evidence.
create trigger audit_log after insert or update or delete on public.survey_day_sessions
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.survey_day_checklist_items
  for each row execute function public.audit_log_trigger();

insert into app_private.audit_entity_manifest (table_name, audit_mode, contains_regulated_data, rationale)
values
  ('survey_day_sessions', 'row_trigger', true, 'Mutable survey-day session lifecycle (activate/refresh/pin/close) is audited.'),
  ('survey_day_checklist_items', 'row_trigger', true, 'Activation-time checklist snapshot with mutable manager disposition is audited.'),
  ('survey_day_events', 'domain_evidence', true, 'Append-only survey-day audit event stream.')
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

-- ---------------------------------------------------------------------------------------------------
-- RLS. Reads for platform admins, org admins/auditors across the org, and managers on assigned
-- facilities. All writes flow through the SECURITY DEFINER lifecycle RPCs below.
-- ---------------------------------------------------------------------------------------------------
alter table public.survey_day_sessions enable row level security;
alter table public.survey_day_checklist_items enable row level security;
alter table public.survey_day_events enable row level security;

create policy survey_day_sessions_select on public.survey_day_sessions for select to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor')
           or public.is_assigned_to_facility(facility_id)))
);
create policy survey_day_checklist_items_select on public.survey_day_checklist_items for select to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor')
           or public.is_assigned_to_facility(facility_id)))
);
create policy survey_day_events_select on public.survey_day_events for select to authenticated using (
  (select public.is_platform_admin())
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor')
           or public.is_assigned_to_facility(facility_id)))
);

revoke all on table public.survey_day_sessions from public, anon;
revoke all on table public.survey_day_checklist_items from public, anon;
revoke all on table public.survey_day_events from public, anon;
grant select on table public.survey_day_sessions to authenticated;
grant select on table public.survey_day_checklist_items to authenticated;
grant select on table public.survey_day_events to authenticated;
grant all on table public.survey_day_sessions to service_role;
grant all on table public.survey_day_checklist_items to service_role;
grant all on table public.survey_day_events to service_role;

-- ---------------------------------------------------------------------------------------------------
-- CareBase product-module classification (restrictive policy composes with the tenant policies above).
-- ---------------------------------------------------------------------------------------------------
insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
values
  ('public', 'survey_day_sessions', 'modules.carebase'),
  ('public', 'survey_day_checklist_items', 'modules.carebase'),
  ('public', 'survey_day_events', 'modules.carebase')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

do $$
declare
  v_resource record;
begin
  for v_resource in
    select resource_schema, resource_name, module_key
    from app_private.product_module_resources
    where resource_name in ('survey_day_sessions', 'survey_day_checklist_items', 'survey_day_events')
    order by resource_name
  loop
    execute format('drop policy if exists product_module_entitlement on %I.%I', v_resource.resource_schema, v_resource.resource_name);
    execute format(
      'create policy product_module_entitlement on %I.%I as restrictive for all to authenticated using ((select app_private.has_product_module(%L))) with check ((select app_private.has_product_module(%L)))',
      v_resource.resource_schema, v_resource.resource_name, v_resource.module_key, v_resource.module_key
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Authorization gate shared by every survey-day command. Mirrors app_private.assert_phase5_manager
-- and additionally enforces the org-scoped survey_day_mode feature flag for non-platform callers.
-- ---------------------------------------------------------------------------------------------------
create or replace function app_private.assert_survey_day_manager(p_org uuid, p_fac uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_phase5_manager(p_org, p_fac);
  if not public.is_platform_admin() then
    if coalesce((public.evaluate_feature_access(p_org, 'survey_day_mode') ->> 'allowed')::boolean, false) is not true then
      raise exception 'Survey Day Mode is not enabled for this organization' using errcode = '42501';
    end if;
  end if;
end;
$$;
revoke all on function app_private.assert_survey_day_manager(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- Commands.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.activate_survey_day(p_facility_id uuid)
returns public.survey_day_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facility public.facilities%rowtype;
  v_org public.organizations%rowtype;
  v_session public.survey_day_sessions%rowtype;
  v_binder uuid;
  v_collection uuid;
begin
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_survey_day_manager(v_facility.organization_id, v_facility.id);
  if v_facility.facility_type not in ('PCH', 'ALR') then
    raise exception 'Survey Day Mode is limited to PCH and ALF facilities' using errcode = '22023';
  end if;
  select * into v_org from public.organizations where id = v_facility.organization_id;
  if v_org.subscription_status in ('suspended', 'canceled') then
    raise exception 'Organization subscription is not active' using errcode = '42501';
  end if;

  -- Serialize concurrent activations for the same facility so we resume rather than duplicate.
  perform pg_advisory_xact_lock(hashtextextended(p_facility_id::text, 0));
  select * into v_session from public.survey_day_sessions where facility_id = p_facility_id and status = 'active' limit 1;
  if found then return v_session; end if;

  -- Pin the latest successful single-facility binder and latest published evidence collection.
  select id into v_binder from public.binder_export_jobs
    where organization_id = v_facility.organization_id and status = 'succeeded'
      and facility_ids = array[p_facility_id]::uuid[]
    order by completed_at desc nulls last limit 1;
  select id into v_collection from public.evidence_collections
    where facility_id = p_facility_id and status = 'published'
    order by published_at desc nulls last limit 1;

  insert into public.survey_day_sessions (organization_id, facility_id, activated_by, pinned_binder_job_id, pinned_evidence_collection_id, source_watermarks)
  values (v_facility.organization_id, p_facility_id, auth.uid(), v_binder, v_collection, jsonb_build_object('activated_at', now()))
  returning * into v_session;

  insert into public.survey_day_checklist_items
    (session_id, organization_id, facility_id, entrance_conference_item_id, prompt, category, data_source, item_types, sort_order, source_watermark)
  select v_session.id, v_facility.organization_id, p_facility_id, i.id, i.prompt, i.category, i.data_source, i.item_types, i.sort_order, now()
  from public.entrance_conference_items i
  where i.is_active and (i.organization_id is null or i.organization_id = v_facility.organization_id);

  insert into public.survey_day_events (session_id, organization_id, facility_id, actor_id, event_type, metadata)
  values (v_session.id, v_facility.organization_id, p_facility_id, auth.uid(), 'activated',
          jsonb_build_object('pinnedBinder', v_binder is not null, 'pinnedCollection', v_collection is not null));

  return v_session;
end;
$$;
revoke all on function public.activate_survey_day(uuid) from public, anon;
grant execute on function public.activate_survey_day(uuid) to authenticated;

create or replace function public.refresh_survey_day(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.survey_day_sessions%rowtype;
begin
  select * into v_session from public.survey_day_sessions where id = p_session_id for update;
  if not found then raise exception 'Survey Day session not found' using errcode = 'P0002'; end if;
  perform app_private.assert_survey_day_manager(v_session.organization_id, v_session.facility_id);
  if v_session.status <> 'active' then raise exception 'Survey Day session is not active' using errcode = '22023'; end if;

  -- Rate limit: coalesce rapid refreshes without recording redundant events.
  if now() - v_session.last_refreshed_at < interval '5 seconds' then
    return jsonb_build_object('sessionId', v_session.id, 'lastRefreshedAt', v_session.last_refreshed_at, 'throttled', true);
  end if;

  update public.survey_day_sessions
    set last_refreshed_at = now(),
        source_watermarks = jsonb_build_object('refreshed_at', now())
    where id = v_session.id
    returning * into v_session;
  insert into public.survey_day_events (session_id, organization_id, facility_id, actor_id, event_type, metadata)
  values (v_session.id, v_session.organization_id, v_session.facility_id, auth.uid(), 'checks_refreshed', '{}'::jsonb);

  return jsonb_build_object('sessionId', v_session.id, 'lastRefreshedAt', v_session.last_refreshed_at, 'throttled', false);
end;
$$;
revoke all on function public.refresh_survey_day(uuid) from public, anon;
grant execute on function public.refresh_survey_day(uuid) to authenticated;

create or replace function public.set_survey_day_checklist_disposition(p_session_id uuid, p_item_id uuid, p_disposition text, p_note text)
returns public.survey_day_checklist_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.survey_day_sessions%rowtype;
  v_item public.survey_day_checklist_items%rowtype;
begin
  select * into v_session from public.survey_day_sessions where id = p_session_id for update;
  if not found then raise exception 'Survey Day session not found' using errcode = 'P0002'; end if;
  perform app_private.assert_survey_day_manager(v_session.organization_id, v_session.facility_id);
  if v_session.status <> 'active' then raise exception 'Survey Day session is not active' using errcode = '22023'; end if;
  if p_disposition is not null and p_disposition not in ('ready', 'provided', 'not_requested', 'needs_follow_up') then
    raise exception 'Invalid checklist disposition' using errcode = '22023';
  end if;

  update public.survey_day_checklist_items
    set disposition = p_disposition,
        disposition_note = nullif(btrim(coalesce(p_note, '')), ''),
        disposition_by = auth.uid(),
        disposition_at = now()
    where id = p_item_id and session_id = p_session_id
    returning * into v_item;
  if not found then raise exception 'Checklist item not found for this session' using errcode = 'P0002'; end if;

  insert into public.survey_day_events (session_id, organization_id, facility_id, actor_id, event_type, metadata)
  values (v_session.id, v_session.organization_id, v_session.facility_id, auth.uid(), 'checklist_disposition_recorded',
          jsonb_build_object('itemId', p_item_id, 'disposition', p_disposition));

  return v_item;
end;
$$;
revoke all on function public.set_survey_day_checklist_disposition(uuid, uuid, text, text) from public, anon;
grant execute on function public.set_survey_day_checklist_disposition(uuid, uuid, text, text) to authenticated;

create or replace function public.pin_survey_day_binder(p_session_id uuid, p_binder_job_id uuid)
returns public.survey_day_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.survey_day_sessions%rowtype;
  v_binder public.binder_export_jobs%rowtype;
begin
  select * into v_session from public.survey_day_sessions where id = p_session_id for update;
  if not found then raise exception 'Survey Day session not found' using errcode = 'P0002'; end if;
  perform app_private.assert_survey_day_manager(v_session.organization_id, v_session.facility_id);
  if v_session.status <> 'active' then raise exception 'Survey Day session is not active' using errcode = '22023'; end if;

  select * into v_binder from public.binder_export_jobs where id = p_binder_job_id;
  if not found
     or v_binder.organization_id <> v_session.organization_id
     or v_binder.status <> 'succeeded'
     or v_binder.facility_ids <> array[v_session.facility_id]::uuid[] then
    raise exception 'Binder does not match this session facility or is not complete' using errcode = '22023';
  end if;

  update public.survey_day_sessions set pinned_binder_job_id = p_binder_job_id where id = v_session.id returning * into v_session;
  insert into public.survey_day_events (session_id, organization_id, facility_id, actor_id, event_type, metadata)
  values (v_session.id, v_session.organization_id, v_session.facility_id, auth.uid(), 'binder_pinned', jsonb_build_object('binderJobId', p_binder_job_id));

  return v_session;
end;
$$;
revoke all on function public.pin_survey_day_binder(uuid, uuid) from public, anon;
grant execute on function public.pin_survey_day_binder(uuid, uuid) to authenticated;

create or replace function public.close_survey_day(p_session_id uuid, p_reason text)
returns public.survey_day_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.survey_day_sessions%rowtype;
begin
  select * into v_session from public.survey_day_sessions where id = p_session_id for update;
  if not found then raise exception 'Survey Day session not found' using errcode = 'P0002'; end if;
  perform app_private.assert_survey_day_manager(v_session.organization_id, v_session.facility_id);
  if v_session.status <> 'active' then raise exception 'Survey Day session is not active' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'A close reason is required' using errcode = '22023'; end if;

  update public.survey_day_sessions
    set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_reason = btrim(p_reason)
    where id = v_session.id
    returning * into v_session;
  insert into public.survey_day_events (session_id, organization_id, facility_id, actor_id, event_type, metadata)
  values (v_session.id, v_session.organization_id, v_session.facility_id, auth.uid(), 'closed', '{}'::jsonb);

  return v_session;
end;
$$;
revoke all on function public.close_survey_day(uuid, text) from public, anon;
grant execute on function public.close_survey_day(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Queries. SECURITY INVOKER so the caller's own RLS scopes every read.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.get_active_survey_day_session(p_facility_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_session public.survey_day_sessions%rowtype;
begin
  select * into v_session from public.survey_day_sessions
    where facility_id = p_facility_id and status = 'active'
    order by activated_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_session.id,
    'facilityId', v_session.facility_id,
    'status', v_session.status,
    'activatedBy', v_session.activated_by,
    'activatedByName', (select p.first_name || ' ' || p.last_name from public.profiles p where p.id = v_session.activated_by),
    'activatedAt', v_session.activated_at,
    'lastRefreshedAt', v_session.last_refreshed_at
  );
end;
$$;
revoke all on function public.get_active_survey_day_session(uuid) from public, anon;
grant execute on function public.get_active_survey_day_session(uuid) to authenticated;

create or replace function public.get_survey_day_workspace(p_session_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_session public.survey_day_sessions%rowtype;
  v_result jsonb;
begin
  select * into v_session from public.survey_day_sessions where id = p_session_id;
  if not found then raise exception 'Survey Day session not found or outside caller scope' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id,
      'organizationId', v_session.organization_id,
      'facilityId', v_session.facility_id,
      'status', v_session.status,
      'activatedBy', v_session.activated_by,
      'activatedByName', (select p.first_name || ' ' || p.last_name from public.profiles p where p.id = v_session.activated_by),
      'activatedAt', v_session.activated_at,
      'lastRefreshedAt', v_session.last_refreshed_at,
      'pinnedBinderJobId', v_session.pinned_binder_job_id,
      'pinnedEvidenceCollectionId', v_session.pinned_evidence_collection_id,
      'closedAt', v_session.closed_at,
      'closeReason', v_session.close_reason
    ),
    'checklist', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'entranceConferenceItemId', c.entrance_conference_item_id,
        'prompt', c.prompt,
        'category', c.category,
        'dataSource', c.data_source,
        'itemTypes', c.item_types,
        'sortOrder', c.sort_order,
        'disposition', c.disposition,
        'dispositionNote', c.disposition_note,
        'dispositionAt', c.disposition_at
      ) order by c.sort_order, c.prompt)
      from public.survey_day_checklist_items c where c.session_id = v_session.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.get_survey_day_workspace(uuid) from public, anon;
grant execute on function public.get_survey_day_workspace(uuid) to authenticated;

create or replace function public.get_survey_day_staff_roster(p_session_id uuid, p_search text default null, p_page integer default 1, p_page_size integer default 25)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_session public.survey_day_sessions%rowtype;
  v_facility uuid;
  v_limit integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_total integer;
  v_summary jsonb;
  v_rows jsonb;
begin
  select * into v_session from public.survey_day_sessions where id = p_session_id;
  if not found then raise exception 'Survey Day session not found or outside caller scope' using errcode = 'P0002'; end if;
  v_facility := v_session.facility_id;

  with base as (
    select
      e.id,
      e.first_name || ' ' || e.last_name as name,
      e.job_title,
      case when exists (
        select 1 from public.employee_training_records tr
        where tr.employee_id = e.id and tr.facility_id = v_facility and tr.status in ('expired', 'due_soon', 'missing')
      ) then 'attention' else 'ready' end as training_state,
      case when exists (
        select 1 from public.employee_credentials c
        where c.employee_id = e.id and c.facility_id = v_facility and c.status in ('expired', 'due_soon', 'missing')
      ) then 'attention' else 'ready' end as credential_state,
      case
        when exists (select 1 from public.employee_background_check_profiles b where b.employee_id = e.id and b.suitability_determination = 'not_suitable') then 'attention'
        when not exists (select 1 from public.employee_background_check_profiles b where b.employee_id = e.id and b.suitability_determination in ('suitable', 'suitable_with_conditions')) then 'unknown'
        else 'ready'
      end as background_state,
      case when exists (
        select 1 from public.exclusion_screening_matches m
        where m.employee_id = e.id and m.status in ('pending_review', 'confirmed_exclusion')
      ) then 'attention' else 'ready' end as exclusion_state
    from public.employees e
    where e.facility_id = v_facility
      and e.status = 'active'
      and (v_search is null or (e.first_name || ' ' || e.last_name || ' ' || coalesce(e.job_title, '')) ilike '%' || v_search || '%')
  ),
  scored as (
    select b.*,
      case when 'attention' in (training_state, credential_state, exclusion_state) or background_state <> 'ready'
           then 'attention' else 'ready' end as overall_flag
    from base b
  )
  select
    count(*)::integer,
    jsonb_build_object(
      'total', count(*),
      'ready', count(*) filter (where overall_flag = 'ready'),
      'attention', count(*) filter (where overall_flag = 'attention')
    )
  into v_total, v_summary
  from scored;

  with base as (
    select
      e.id,
      e.first_name || ' ' || e.last_name as name,
      e.job_title,
      case when exists (
        select 1 from public.employee_training_records tr
        where tr.employee_id = e.id and tr.facility_id = v_facility and tr.status in ('expired', 'due_soon', 'missing')
      ) then 'attention' else 'ready' end as training_state,
      case when exists (
        select 1 from public.employee_credentials c
        where c.employee_id = e.id and c.facility_id = v_facility and c.status in ('expired', 'due_soon', 'missing')
      ) then 'attention' else 'ready' end as credential_state,
      case
        when exists (select 1 from public.employee_background_check_profiles b where b.employee_id = e.id and b.suitability_determination = 'not_suitable') then 'attention'
        when not exists (select 1 from public.employee_background_check_profiles b where b.employee_id = e.id and b.suitability_determination in ('suitable', 'suitable_with_conditions')) then 'unknown'
        else 'ready'
      end as background_state,
      case when exists (
        select 1 from public.exclusion_screening_matches m
        where m.employee_id = e.id and m.status in ('pending_review', 'confirmed_exclusion')
      ) then 'attention' else 'ready' end as exclusion_state
    from public.employees e
    where e.facility_id = v_facility
      and e.status = 'active'
      and (v_search is null or (e.first_name || ' ' || e.last_name || ' ' || coalesce(e.job_title, '')) ilike '%' || v_search || '%')
  ),
  scored as (
    select b.*,
      case when 'attention' in (training_state, credential_state, exclusion_state) or background_state <> 'ready'
           then 'attention' else 'ready' end as overall_flag
    from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'employeeId', id,
    'name', name,
    'jobTitle', job_title,
    'trainingState', training_state,
    'credentialState', credential_state,
    'backgroundState', background_state,
    'exclusionState', exclusion_state,
    'overallFlag', overall_flag,
    'route', '/app/employees/' || id
  ) order by name, id), '[]'::jsonb)
  into v_rows
  from (select * from scored order by name, id limit v_limit offset (v_page - 1) * v_limit) page;

  return jsonb_build_object('rows', v_rows, 'count', v_total, 'summary', v_summary, 'page', v_page, 'pageSize', v_limit);
end;
$$;
revoke all on function public.get_survey_day_staff_roster(uuid, text, integer, integer) from public, anon;
grant execute on function public.get_survey_day_staff_roster(uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Watchdog: expire active sessions older than 24 hours, recording one expiry event each.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.expire_stale_survey_day_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer := 0;
  v_session public.survey_day_sessions%rowtype;
begin
  for v_session in
    select * from public.survey_day_sessions
    where status = 'active' and activated_at < now() - interval '24 hours'
    for update skip locked
  loop
    update public.survey_day_sessions set status = 'expired', closed_at = now(), close_reason = 'Automatically expired after 24 hours' where id = v_session.id;
    insert into public.survey_day_events (session_id, organization_id, facility_id, actor_id, event_type, metadata)
    values (v_session.id, v_session.organization_id, v_session.facility_id, null, 'expired', '{}'::jsonb);
    v_expired := v_expired + 1;
  end loop;
  return v_expired;
end;
$$;
revoke all on function public.expire_stale_survey_day_sessions() from public, anon, authenticated;
grant execute on function public.expire_stale_survey_day_sessions() to service_role;

select cron.unschedule('expire-stale-survey-day-sessions')
where exists (select 1 from cron.job where jobname = 'expire-stale-survey-day-sessions');
select cron.schedule('expire-stale-survey-day-sessions', '*/15 * * * *', $$select public.expire_stale_survey_day_sessions();$$);
