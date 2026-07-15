-- Phase 1 platform trust foundation:
--   * structured, correlated, checksummed audit evidence with facility scope
--   * an explicit audit coverage manifest
--   * a shared job registry/run ledger and platform-admin control-plane RPC
--
-- Keep worker-only state in a non-exposed schema. Public RPCs below are the
-- narrow API surface for Edge Functions and the platform administration UI.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;

-- ---------------------------------------------------------------------------
-- Audit integrity and request context
-- ---------------------------------------------------------------------------

alter table public.audit_logs
  add column if not exists facility_id uuid,
  add column if not exists actor_subject_id text,
  add column if not exists request_id text,
  add column if not exists correlation_id text,
  add column if not exists source text,
  add column if not exists reason text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists hash_version smallint not null default 1,
  add column if not exists event_hash text;

create index if not exists audit_logs_facility_idx
  on public.audit_logs(facility_id, created_at desc)
  where facility_id is not null;
create index if not exists audit_logs_request_idx
  on public.audit_logs(request_id)
  where request_id is not null;
create index if not exists audit_logs_correlation_idx
  on public.audit_logs(correlation_id, created_at)
  where correlation_id is not null;
create unique index if not exists audit_logs_event_hash_uidx
  on public.audit_logs(event_hash)
  where event_hash is not null;

create or replace function app_private.redact_audit_json(p_value jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_value is null then
    return null;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    select coalesce(
      jsonb_object_agg(
        e.key,
        case
          when lower(e.key) ~ '(^|_)(password|secret|auth_token|access_token|refresh_token|token_hash|checkin_pin_hash|api_key|encrypted_password)($|_)'
            then '"[REDACTED]"'::jsonb
          else app_private.redact_audit_json(e.value)
        end
      ),
      '{}'::jsonb
    )
    into v_result
    from jsonb_each(p_value) as e;
    return v_result;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    select coalesce(
      jsonb_agg(app_private.redact_audit_json(a.value) order by a.ordinality),
      '[]'::jsonb
    )
    into v_result
    from jsonb_array_elements(p_value) with ordinality as a(value, ordinality);
    return v_result;
  end if;

  return p_value;
end;
$$;

revoke all on function app_private.redact_audit_json(jsonb)
  from public, anon, authenticated;

create or replace function app_private.ensure_audit_event_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := '{}'::jsonb;
  v_claims jsonb := '{}'::jsonb;
begin
  begin
    v_headers := coalesce(
      nullif(current_setting('request.headers', true), '')::jsonb,
      '{}'::jsonb
    );
  exception when others then
    v_headers := '{}'::jsonb;
  end;

  begin
    v_claims := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
  exception when others then
    v_claims := '{}'::jsonb;
  end;

  new.id := coalesce(new.id, gen_random_uuid());
  new.created_at := coalesce(new.created_at, clock_timestamp());
  new.actor_subject_id := coalesce(new.actor_subject_id, nullif(v_claims->>'sub', ''));
  new.request_id := coalesce(
    nullif(new.request_id, ''),
    nullif(current_setting('app.request_id', true), ''),
    nullif(v_headers->>'x-request-id', ''),
    'db:' || pg_catalog.txid_current()::text
  );
  new.correlation_id := coalesce(
    nullif(new.correlation_id, ''),
    nullif(current_setting('app.correlation_id', true), ''),
    nullif(v_headers->>'x-correlation-id', ''),
    new.request_id
  );
  new.source := coalesce(
    nullif(new.source, ''),
    nullif(current_setting('app.audit_source', true), ''),
    case when new.actor_subject_id is null then 'system' else 'api' end
  );
  new.reason := coalesce(
    nullif(new.reason, ''),
    nullif(current_setting('app.audit_reason', true), '')
  );
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'assurance_level', nullif(v_claims->>'aal', ''),
      'jwt_role', nullif(v_claims->>'role', '')
    ));
  new.old_values := app_private.redact_audit_json(new.old_values);
  new.new_values := app_private.redact_audit_json(new.new_values);

  if new.ip_address is null then
    new.ip_address := nullif(
      split_part(
        coalesce(v_headers->>'x-forwarded-for', v_headers->>'cf-connecting-ip', ''),
        ',',
        1
      ),
      ''
    );
  end if;

  new.hash_version := 1;
  new.event_hash := encode(
    extensions.digest(
      convert_to(
        concat_ws(
          '|',
          new.id::text,
          coalesce(new.organization_id::text, ''),
          coalesce(new.facility_id::text, ''),
          coalesce(new.actor_subject_id, ''),
          new.entity_type,
          coalesce(new.entity_id, ''),
          new.action,
          new.created_at::text,
          coalesce(new.request_id, ''),
          coalesce(new.correlation_id, ''),
          coalesce(new.old_values::text, ''),
          coalesce(new.new_values::text, '')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  return new;
end;
$$;

revoke all on function app_private.ensure_audit_event_context()
  from public, anon, authenticated;

drop trigger if exists ensure_audit_event_context on public.audit_logs;
create trigger ensure_audit_event_context
before insert on public.audit_logs
for each row execute function app_private.ensure_audit_event_context();

-- Backfill a deterministic integrity checksum for historical evidence. Existing
-- payloads are not rewritten; redaction applies to new evidence from this point.
update public.audit_logs
set
  actor_subject_id = coalesce(actor_subject_id, actor_profile_id::text),
  request_id = coalesce(request_id, 'legacy:' || id::text),
  correlation_id = coalesce(correlation_id, 'legacy:' || id::text),
  source = coalesce(source, 'legacy'),
  event_hash = coalesce(
    event_hash,
    encode(
      extensions.digest(
        convert_to(
          concat_ws(
            '|',
            id::text,
            coalesce(organization_id::text, ''),
            '',
            coalesce(actor_profile_id::text, ''),
            entity_type,
            coalesce(entity_id, ''),
            action,
            created_at::text,
            'legacy:' || id::text,
            'legacy:' || id::text,
            coalesce(old_values::text, ''),
            coalesce(new_values::text, '')
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  )
where event_hash is null
   or request_id is null
   or correlation_id is null
   or source is null;

alter table public.audit_logs
  alter column request_id set not null,
  alter column correlation_id set not null,
  alter column source set not null,
  alter column event_hash set not null;

-- Replace the table-specific branches in the legacy trigger with a row-shape
-- driven implementation. This supports any table with an id/key and optional
-- organization/facility columns, while preserving the existing action naming.
create or replace function public.audit_log_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_org_id uuid;
  v_facility_id uuid;
  v_actor_id uuid;
  v_entity_id text;
  v_action text;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_action := lower(tg_op);
  v_action := case v_action
    when 'insert' then 'created'
    when 'update' then 'updated'
    when 'delete' then 'deleted'
    else 'unknown'
  end;

  if coalesce(v_row->>'organization_id', '') ~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    v_org_id := (v_row->>'organization_id')::uuid;
  elsif tg_table_name = 'organizations' then
    v_org_id := (v_row->>'id')::uuid;
  end if;

  if coalesce(v_row->>'facility_id', '') ~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    v_facility_id := (v_row->>'facility_id')::uuid;
  elsif tg_table_name = 'facilities' then
    v_facility_id := (v_row->>'id')::uuid;
  end if;

  -- Some regulated lifecycle tables carry employee_id or profile_id rather
  -- than duplicating facility_id. Resolve that scope at write time so a
  -- facility manager can inspect the audit event without gaining org-wide
  -- access. A profile is expected to map to one employee; a deterministic
  -- first match keeps malformed legacy duplicates from broadening access.
  if v_facility_id is null
     and coalesce(v_row->>'employee_id', '') ~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    select e.facility_id, e.organization_id
    into v_facility_id, v_org_id
    from public.employees e
    where e.id = (v_row->>'employee_id')::uuid;
  elsif v_facility_id is null
     and coalesce(v_row->>'profile_id', '') ~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    select e.facility_id, e.organization_id
    into v_facility_id, v_org_id
    from public.employees e
    where e.profile_id = (v_row->>'profile_id')::uuid
    order by e.created_at, e.id
    limit 1;
  end if;

  if v_org_id is null and v_facility_id is not null then
    select f.organization_id
    into v_org_id
    from public.facilities as f
    where f.id = v_facility_id;
  end if;

  v_entity_id := coalesce(
    nullif(v_row->>'id', ''),
    nullif(v_row->>'key', ''),
    nullif(v_row->>'slug', ''),
    'tx:' || pg_catalog.txid_current()::text
  );

  select p.id
  into v_actor_id
  from public.profiles as p
  where p.id = auth.uid();

  insert into public.audit_logs (
    organization_id,
    facility_id,
    actor_profile_id,
    actor_subject_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  )
  values (
    v_org_id,
    v_facility_id,
    v_actor_id,
    auth.uid()::text,
    tg_table_name,
    v_entity_id,
    tg_table_name || '_' || v_action,
    case when tg_op <> 'INSERT' then to_jsonb(old) else null end,
    case when tg_op <> 'DELETE' then to_jsonb(new) else null end
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.audit_log_trigger()
  from public, anon, authenticated;

create table app_private.audit_entity_manifest (
  table_schema text not null default 'public',
  table_name text primary key,
  audit_mode text not null
    check (audit_mode in ('row_trigger', 'domain_evidence', 'access_log', 'not_required')),
  contains_regulated_data boolean not null default false,
  rationale text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_private.audit_entity_manifest enable row level security;
revoke all on table app_private.audit_entity_manifest
  from public, anon, authenticated;
grant select, insert, update, delete on table app_private.audit_entity_manifest
  to service_role;

insert into app_private.audit_entity_manifest (
  table_name,
  audit_mode,
  contains_regulated_data,
  rationale
)
select
  t.tablename,
  'not_required',
  false,
  'Classified during Phase 1 audit coverage review'
from pg_catalog.pg_tables as t
where t.schemaname = 'public'
  and t.tablename <> 'audit_logs'
on conflict (table_name) do nothing;

-- Preserve every existing row-audited domain in the manifest.
update app_private.audit_entity_manifest as m
set
  audit_mode = 'row_trigger',
  contains_regulated_data = true,
  rationale = 'Existing regulated or administrative row audit'
where exists (
  select 1
  from pg_catalog.pg_trigger as tr
  join pg_catalog.pg_proc as p on p.oid = tr.tgfoid
  where tr.tgrelid = to_regclass(format('%I.%I', m.table_schema, m.table_name))
    and not tr.tgisinternal
    and p.proname = 'audit_log_trigger'
);

-- Close the highest-risk direct-write gaps identified in the repository audit.
update app_private.audit_entity_manifest
set
  audit_mode = 'row_trigger',
  contains_regulated_data = table_name not in ('packages'),
  rationale = 'Phase 1 sensitive configuration, workforce, or scheduling coverage'
where table_name in (
  'profiles',
  'training_types',
  'organization_settings',
  'packages',
  'alerts',
  'employee_facility_assignments',
  'employee_schedule_preferences',
  'employee_training_hour_buckets',
  'facility_assignments',
  'facility_units',
  'schedules',
  'shift_assignments',
  'shift_definitions'
);

-- High-volume or immutable evidence tables provide their own lifecycle/access
-- evidence and intentionally do not create a second audit row per state change.
update app_private.audit_entity_manifest
set
  audit_mode = 'domain_evidence',
  contains_regulated_data = true,
  rationale = case table_name
    when 'notification_deliveries'
      then 'Provider attempts and callbacks are immutable delivery evidence'
    when 'notifications'
      then 'User notification state is captured by delivery evidence'
    when 'exclusion_list_entries'
      then 'Immutable source snapshots and import runs are the evidence boundary'
    when 'certificate_lifecycle_events'
      then 'Append-only certificate issuance events are the evidence boundary'
    when 'certificate_pdf_jobs'
      then 'Durable PDF job state is reconciled through the worker control plane'
    else 'Dedicated immutable domain lifecycle evidence'
  end
where table_name in (
  'notification_deliveries',
  'notifications',
  'exclusion_list_entries',
  'certificate_lifecycle_events',
  'certificate_pdf_jobs',
  'course_ai_generations',
  'resident_assessment_ai_generations'
);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles',
    'training_types',
    'organization_settings',
    'packages',
    'alerts',
    'employee_facility_assignments',
    'employee_schedule_preferences',
    'employee_training_hour_buckets',
    'facility_assignments',
    'facility_units',
    'schedules',
    'shift_assignments',
    'shift_definitions'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('drop trigger if exists audit_log on public.%I', v_table);
      execute format(
        'create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()',
        v_table
      );
    end if;
  end loop;
end;
$$;

-- Facility managers may now read only evidence carrying a facility scope they
-- are assigned to. Organization administrators and auditors retain org scope.
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select
on public.audit_logs
for select
to authenticated
using (
  public.is_platform_admin()
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or (
        (select public.current_role()) = 'facility_manager'
        and facility_id is not null
        and public.is_assigned_to_facility(facility_id)
      )
    )
  )
);

revoke insert, update, delete on table public.audit_logs
  from public, anon, authenticated;
grant select on table public.audit_logs to authenticated;
revoke all on table public.audit_logs from anon;

create or replace function public.get_audit_coverage()
returns table (
  table_name text,
  audit_mode text,
  contains_regulated_data boolean,
  has_required_trigger boolean,
  rationale text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may inspect audit coverage'
      using errcode = '42501';
  end if;

  return query
  select
    m.table_name,
    m.audit_mode,
    m.contains_regulated_data,
    case
      when m.audit_mode <> 'row_trigger' then true
      else exists (
        select 1
        from pg_catalog.pg_trigger as tr
        join pg_catalog.pg_proc as p on p.oid = tr.tgfoid
        where tr.tgrelid = to_regclass(format('%I.%I', m.table_schema, m.table_name))
          and not tr.tgisinternal
          and p.proname = 'audit_log_trigger'
      )
    end,
    m.rationale
  from app_private.audit_entity_manifest as m
  order by m.contains_regulated_data desc, m.table_name;
end;
$$;

revoke all on function public.get_audit_coverage()
  from public, anon;
grant execute on function public.get_audit_coverage()
  to authenticated;

create or replace function public.get_audit_export_manifest(
  p_from timestamptz,
  p_to timestamptz,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'A valid half-open audit interval is required';
  end if;

  if p_to - p_from > interval '366 days' then
    raise exception 'Audit export manifests are limited to 366 days';
  end if;

  if public.is_platform_admin() then
    v_org_id := p_organization_id;
  elsif public.current_role() in ('org_admin', 'auditor') then
    v_org_id := public.current_org_id();
    if p_organization_id is not null and p_organization_id <> v_org_id then
      raise exception 'Cannot export another organization audit manifest'
        using errcode = '42501';
    end if;
  else
    raise exception 'Not authorized to export audit manifests'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'schemaVersion', 1,
    'organizationId', v_org_id,
    'from', p_from,
    'to', p_to,
    'rowCount', count(*),
    'firstEventAt', min(a.created_at),
    'lastEventAt', max(a.created_at),
    'sha256', encode(
      extensions.digest(
        convert_to(
          coalesce(string_agg(a.event_hash, '' order by a.created_at, a.id), ''),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    'generatedAt', statement_timestamp()
  )
  into v_result
  from public.audit_logs as a
  where a.created_at >= p_from
    and a.created_at < p_to
    and (v_org_id is null or a.organization_id = v_org_id);

  return v_result;
end;
$$;

revoke all on function public.get_audit_export_manifest(timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.get_audit_export_manifest(timestamptz, timestamptz, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Shared operational job control plane
-- ---------------------------------------------------------------------------

create table app_private.system_job_definitions (
  job_key text primary key,
  display_name text not null,
  description text not null,
  execution_kind text not null
    check (execution_kind in ('sql_cron', 'edge_cron', 'worker', 'external')),
  cron_job_name text unique,
  expected_interval interval not null,
  freshness_sla interval not null,
  is_critical boolean not null default false,
  is_active boolean not null default true,
  retry_mode text not null default 'automatic'
    check (retry_mode in ('automatic', 'manual', 'none')),
  operator_route text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_private.system_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null
    references app_private.system_job_definitions(job_key) on delete restrict,
  correlation_id text not null,
  trigger_type text not null default 'scheduled'
    check (trigger_type in ('scheduled', 'manual', 'retry', 'backfill', 'webhook')),
  status text not null default 'running'
    check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_heartbeat_at timestamptz not null default now(),
  attempted_count bigint not null default 0 check (attempted_count >= 0),
  succeeded_count bigint not null default 0 check (succeeded_count >= 0),
  failed_count bigint not null default 0 check (failed_count >= 0),
  cursor jsonb,
  result jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  provider_request_id text,
  retry_count integer not null default 0 check (retry_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_key, correlation_id),
  check (
    (status in ('queued', 'running') and finished_at is null)
    or (status in ('succeeded', 'partial', 'failed', 'cancelled') and finished_at is not null)
  )
);

create index system_job_runs_job_started_idx
  on app_private.system_job_runs(job_key, started_at desc);
create index system_job_runs_active_idx
  on app_private.system_job_runs(status, last_heartbeat_at)
  where status in ('queued', 'running');

alter table app_private.system_job_definitions enable row level security;
alter table app_private.system_job_runs enable row level security;
revoke all on table app_private.system_job_definitions, app_private.system_job_runs
  from public, anon, authenticated;
grant select, insert, update, delete
  on table app_private.system_job_definitions, app_private.system_job_runs
  to service_role;

insert into app_private.system_job_definitions (
  job_key,
  display_name,
  description,
  execution_kind,
  cron_job_name,
  expected_interval,
  freshness_sla,
  is_critical,
  retry_mode,
  operator_route
)
values
  (
    'compliance-recalculation',
    'Compliance recalculation',
    'Recalculates employee compliance requirements and alerts',
    'sql_cron',
    'recalculate-compliance-nightly',
    interval '1 day',
    interval '30 hours',
    true,
    'manual',
    '/admin/system-jobs'
  ),
  (
    'incident-notifications',
    'Incident notification recalculation',
    'Reconciles incident notification deadlines and escalation state',
    'sql_cron',
    'recalculate-incident-notifications-hourly',
    interval '1 hour',
    interval '2 hours',
    true,
    'manual',
    '/admin/system-jobs'
  ),
  (
    'notification-dispatch',
    'Notification dispatch',
    'Claims and dispatches pending email and SMS deliveries',
    'edge_cron',
    'dispatch-notification-deliveries',
    interval '15 minutes',
    interval '45 minutes',
    true,
    'automatic',
    '/admin/notifications'
  ),
  (
    'alert-escalation',
    'Alert escalation',
    'Escalates unactioned compliance alerts',
    'sql_cron',
    'escalate-unactioned-alerts',
    interval '1 day',
    interval '30 hours',
    true,
    'manual',
    '/admin/system-jobs'
  ),
  (
    'monday-digest',
    'Monday digest',
    'Queues the weekly administrator digest',
    'sql_cron',
    'send-monday-digest',
    interval '7 days',
    interval '8 days',
    false,
    'manual',
    '/admin/system-jobs'
  ),
  (
    'policy-reminders',
    'Policy attestation reminders',
    'Queues outstanding policy attestation reminders',
    'sql_cron',
    'send-policy-attestation-reminders',
    interval '1 day',
    interval '30 hours',
    false,
    'manual',
    '/admin/system-jobs'
  ),
  (
    'exclusion-screening',
    'Monthly exclusion screening',
    'Refreshes source snapshots and screens active employee rosters',
    'edge_cron',
    'monthly-exclusion-screening',
    interval '31 days',
    interval '35 days',
    true,
    'manual',
    '/admin/exclusion-screening'
  ),
  (
    'course-status-recalculation',
    'Training assignment status recalculation',
    'Reconciles employee training assignment due and overdue states',
    'sql_cron',
    'recalculate-course-assignment-statuses-nightly',
    interval '1 day',
    interval '30 hours',
    true,
    'manual',
    '/admin/system-jobs'
  ),
  (
    'course-continuation-reminders',
    'Training continuation reminders',
    'Queues reminders for employees with in-progress training',
    'sql_cron',
    'course-continuation-reminders-daily',
    interval '1 day',
    interval '30 hours',
    false,
    'manual',
    '/admin/system-jobs'
  ),
  (
    'resident-compliance-recalculation',
    'Resident compliance recalculation',
    'Reconciles resident compliance registry state',
    'sql_cron',
    'recalculate-resident-compliance-nightly',
    interval '1 day',
    interval '30 hours',
    true,
    'manual',
    '/admin/system-jobs'
  ),
  (
    'heygen-status-polling',
    'HeyGen status polling',
    'Reconciles asynchronous course-video generation state',
    'edge_cron',
    'poll-heygen-video-statuses',
    interval '5 minutes',
    interval '20 minutes',
    false,
    'automatic',
    '/admin/ai-generations'
  ),
  (
    'certificate-pdf-generation',
    'Certificate PDF generation',
    'Claims, renders, stores, and reconciles certificate PDF artifacts',
    'worker',
    null,
    interval '15 minutes',
    interval '30 minutes',
    true,
    'automatic',
    '/admin/system-jobs'
  )
on conflict (job_key) do update
set
  display_name = excluded.display_name,
  description = excluded.description,
  execution_kind = excluded.execution_kind,
  cron_job_name = excluded.cron_job_name,
  expected_interval = excluded.expected_interval,
  freshness_sla = excluded.freshness_sla,
  is_critical = excluded.is_critical,
  retry_mode = excluded.retry_mode,
  operator_route = excluded.operator_route,
  updated_at = now();

create or replace function public.begin_system_job(
  p_job_key text,
  p_correlation_id text,
  p_trigger_type text default 'scheduled',
  p_provider_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if nullif(trim(p_correlation_id), '') is null then
    raise exception 'A correlation id is required';
  end if;

  insert into app_private.system_job_runs (
    job_key,
    correlation_id,
    trigger_type,
    provider_request_id
  )
  values (
    p_job_key,
    p_correlation_id,
    p_trigger_type,
    p_provider_request_id
  )
  on conflict (job_key, correlation_id) do update
  set
    status = 'running',
    started_at = now(),
    finished_at = null,
    last_heartbeat_at = now(),
    attempted_count = 0,
    succeeded_count = 0,
    failed_count = 0,
    cursor = null,
    result = app_private.system_job_runs.result
      || jsonb_strip_nulls(jsonb_build_object(
        'previousTerminalStatus', app_private.system_job_runs.status,
        'previousErrorCode', app_private.system_job_runs.error_code,
        'previousErrorMessage', app_private.system_job_runs.error_message
      )),
    error_code = null,
    error_message = null,
    provider_request_id = coalesce(
      excluded.provider_request_id,
      app_private.system_job_runs.provider_request_id
    ),
    retry_count = app_private.system_job_runs.retry_count + 1,
    updated_at = now()
  where app_private.system_job_runs.status in ('failed', 'partial', 'cancelled')
  returning id into v_run_id;

  if v_run_id is null then
    select r.id
    into v_run_id
    from app_private.system_job_runs as r
    where r.job_key = p_job_key
      and r.correlation_id = p_correlation_id;
  end if;

  return v_run_id;
end;
$$;

revoke all on function public.begin_system_job(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_system_job(text, text, text, text)
  to service_role;

create or replace function public.heartbeat_system_job(
  p_run_id uuid,
  p_attempted_count bigint default null,
  p_succeeded_count bigint default null,
  p_failed_count bigint default null,
  p_cursor jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app_private.system_job_runs
  set
    last_heartbeat_at = now(),
    attempted_count = coalesce(p_attempted_count, attempted_count),
    succeeded_count = coalesce(p_succeeded_count, succeeded_count),
    failed_count = coalesce(p_failed_count, failed_count),
    cursor = coalesce(p_cursor, cursor),
    updated_at = now()
  where id = p_run_id
    and status = 'running';

  if not found then
    raise exception 'Running system job not found';
  end if;
end;
$$;

revoke all on function public.heartbeat_system_job(uuid, bigint, bigint, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.heartbeat_system_job(uuid, bigint, bigint, bigint, jsonb)
  to service_role;

create or replace function public.finish_system_job(
  p_run_id uuid,
  p_status text,
  p_attempted_count bigint default 0,
  p_succeeded_count bigint default 0,
  p_failed_count bigint default 0,
  p_result jsonb default '{}'::jsonb,
  p_error_code text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('succeeded', 'partial', 'failed', 'cancelled') then
    raise exception 'Invalid terminal job status';
  end if;

  update app_private.system_job_runs
  set
    status = p_status,
    finished_at = now(),
    last_heartbeat_at = now(),
    attempted_count = greatest(coalesce(p_attempted_count, 0), 0),
    succeeded_count = greatest(coalesce(p_succeeded_count, 0), 0),
    failed_count = greatest(coalesce(p_failed_count, 0), 0),
    result = coalesce(p_result, '{}'::jsonb),
    error_code = p_error_code,
    error_message = left(p_error_message, 2000),
    updated_at = now()
  where id = p_run_id
    and status in ('queued', 'running');

  if not found then
    -- A duplicate finalization is safe when it agrees with the stored terminal
    -- state, but a conflicting replay must be visible.
    if not exists (
      select 1
      from app_private.system_job_runs
      where id = p_run_id
        and status = p_status
    ) then
      raise exception 'System job not found or already finished differently';
    end if;
  end if;
end;
$$;

revoke all on function public.finish_system_job(uuid, text, bigint, bigint, bigint, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_system_job(uuid, text, bigint, bigint, bigint, jsonb, text, text)
  to service_role;

create or replace function public.get_system_job_control_plane()
returns table (
  job_key text,
  display_name text,
  description text,
  schedule text,
  execution_kind text,
  is_critical boolean,
  retry_mode text,
  operator_route text,
  last_status text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_expected_at timestamptz,
  last_duration_ms bigint,
  attempted_count bigint,
  succeeded_count bigint,
  failed_count bigint,
  error_message text,
  is_stale boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may inspect system jobs'
      using errcode = '42501';
  end if;

  return query
  with job_state as (
    select
      d.*,
      c.schedule,
      own.status as own_status,
      own.started_at as own_started_at,
      own.finished_at as own_finished_at,
      own.attempted_count as own_attempted_count,
      own.succeeded_count as own_succeeded_count,
      own.failed_count as own_failed_count,
      own.error_message as own_error_message,
      own_success.started_at as own_success_at,
      cron_run.status as cron_status,
      cron_run.start_time as cron_started_at,
      cron_run.end_time as cron_finished_at,
      cron_run.return_message as cron_error_message,
      cron_success.start_time as cron_success_at
    from app_private.system_job_definitions as d
    left join cron.job as c
      on c.jobname = d.cron_job_name
    left join lateral (
      select r.*
      from app_private.system_job_runs as r
      where r.job_key = d.job_key
      order by r.started_at desc
      limit 1
    ) as own on true
    left join lateral (
      select r.started_at
      from app_private.system_job_runs as r
      where r.job_key = d.job_key
        and r.status = 'succeeded'
      order by r.started_at desc
      limit 1
    ) as own_success on true
    left join lateral (
      select cr.status, cr.start_time, cr.end_time, cr.return_message
      from cron.job_run_details as cr
      where cr.jobid = c.jobid
      order by cr.runid desc
      limit 1
    ) as cron_run on true
    left join lateral (
      select cr.start_time
      from cron.job_run_details as cr
      where cr.jobid = c.jobid
        and cr.status = 'succeeded'
      order by cr.runid desc
      limit 1
    ) as cron_success on true
    where d.is_active
  ),
  resolved as (
    select
      s.*,
      case
        when coalesce(s.own_started_at, '-infinity'::timestamptz)
           >= coalesce(s.cron_started_at, '-infinity'::timestamptz)
          then s.own_status
        else s.cron_status
      end as resolved_status,
      greatest(s.own_started_at, s.cron_started_at) as resolved_started_at,
      case
        when coalesce(s.own_started_at, '-infinity'::timestamptz)
           >= coalesce(s.cron_started_at, '-infinity'::timestamptz)
          then s.own_finished_at
        else s.cron_finished_at
      end as resolved_finished_at,
      greatest(s.own_success_at, s.cron_success_at) as resolved_success_at,
      case
        when coalesce(s.own_started_at, '-infinity'::timestamptz)
           >= coalesce(s.cron_started_at, '-infinity'::timestamptz)
          then s.own_error_message
        when s.cron_status <> 'succeeded' then s.cron_error_message
        else null
      end as resolved_error_message
    from job_state as s
  )
  select
    r.job_key,
    r.display_name,
    r.description,
    r.schedule,
    r.execution_kind,
    r.is_critical,
    r.retry_mode,
    r.operator_route,
    coalesce(r.resolved_status, 'never') as last_status,
    r.resolved_started_at as last_attempt_at,
    r.resolved_success_at as last_success_at,
    case
      when r.cron_job_name is not null
        then r.resolved_success_at + r.expected_interval
      else null
    end as next_expected_at,
    case
      when r.resolved_started_at is not null and r.resolved_finished_at is not null
        then (extract(epoch from (r.resolved_finished_at - r.resolved_started_at)) * 1000)::bigint
      else null
    end as last_duration_ms,
    case
      when coalesce(r.own_started_at, '-infinity'::timestamptz)
         >= coalesce(r.cron_started_at, '-infinity'::timestamptz)
        then r.own_attempted_count
      else null
    end as attempted_count,
    case
      when coalesce(r.own_started_at, '-infinity'::timestamptz)
         >= coalesce(r.cron_started_at, '-infinity'::timestamptz)
        then r.own_succeeded_count
      else null
    end as succeeded_count,
    case
      when coalesce(r.own_started_at, '-infinity'::timestamptz)
         >= coalesce(r.cron_started_at, '-infinity'::timestamptz)
        then r.own_failed_count
      else null
    end as failed_count,
    r.resolved_error_message as error_message,
    case
      when r.cron_job_name is null then
        r.resolved_status in ('queued', 'running')
        and r.resolved_started_at + r.freshness_sla < now()
      else
        r.resolved_success_at is null
        or r.resolved_success_at + r.freshness_sla < now()
    end as is_stale
  from resolved as r
  order by
    case
      when r.cron_job_name is null then
        r.resolved_status in ('queued', 'running')
        and r.resolved_started_at + r.freshness_sla < now()
      else
        r.resolved_success_at is null
        or r.resolved_success_at + r.freshness_sla < now()
    end desc,
    r.is_critical desc,
    r.display_name;
end;
$$;

revoke all on function public.get_system_job_control_plane()
  from public, anon;
grant execute on function public.get_system_job_control_plane()
  to authenticated;

-- Extend the existing count-only health payload without breaking current keys.
create or replace function public.get_platform_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may view platform health'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'orgsByStatus', (
      select coalesce(jsonb_object_agg(subscription_status, cnt), '{}'::jsonb)
      from (
        select subscription_status, count(*) as cnt
        from public.organizations
        group by subscription_status
      ) as s
    ),
    'notificationDeliveriesPending', (
      select count(*)
      from public.notification_deliveries
      where status = 'pending'
    ),
    'notificationDeliveriesFailed', (
      select count(*)
      from public.notification_deliveries
      where status = 'failed'
    ),
    'aiGenerationsPending', (
      (
        select count(*)
        from public.course_ai_generations
        where status = 'pending'
          and created_at > now() - interval '30 days'
      )
      + (
        select count(*)
        from public.resident_assessment_ai_generations
        where status = 'pending'
          and created_at > now() - interval '30 days'
      )
    ),
    'aiGenerationsFailed', (
      (
        select count(*)
        from public.course_ai_generations
        where status = 'failed'
          and created_at > now() - interval '30 days'
      )
      + (
        select count(*)
        from public.resident_assessment_ai_generations
        where status = 'failed'
          and created_at > now() - interval '30 days'
      )
    ),
    'heygenJobsInProgress', (
      select count(*)
      from public.course_blocks
      where body->'heygen'->>'status' is not null
        and body->'heygen'->>'status' not in ('completed', 'failed')
    ),
    'systemJobsStale', (
      select count(*)
      from public.get_system_job_control_plane()
      where is_stale
    ),
    'systemJobsFailed', (
      select count(*)
      from public.get_system_job_control_plane()
      where last_status in ('failed', 'partial')
    ),
    'auditCoverageMissing', (
      select count(*)
      from public.get_audit_coverage()
      where not has_required_trigger
    ),
    'totalFacilities', (select count(*) from public.facilities),
    'totalEmployees', (select count(*) from public.employees),
    'totalCourses', (select count(*) from public.courses)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_platform_health()
  from public, anon;
grant execute on function public.get_platform_health()
  to authenticated;

-- Give each Edge invocation a durable correlation id that is shared by the
-- audit trail, job ledger, and provider logs.
select cron.unschedule('poll-heygen-video-statuses')
where exists (
  select 1
  from cron.job
  where jobname = 'poll-heygen-video-statuses'
);

select cron.schedule(
  'poll-heygen-video-statuses',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/poll-heygen-video-statuses',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Correlation-Id', gen_random_uuid()::text,
         'X-CareMetric-Cron-Secret', coalesce(
           (
             select decrypted_secret
             from vault.decrypted_secrets
             where name = 'cron_shared_secret'
             limit 1
           ),
           ''
         )
       ),
       body := '{}'::jsonb
     ); $$
);
