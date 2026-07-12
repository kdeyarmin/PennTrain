-- Phase 1 operational recovery and evidence governance.
--
-- This forward migration completes the recovery behavior around the audit and
-- job-control primitives introduced earlier in Phase 1. It deliberately keeps
-- worker state in app_private and exposes only narrow, role-checked commands.

-- ---------------------------------------------------------------------------
-- Audit integrity version 2, immutability, retention, holds, and archives
-- ---------------------------------------------------------------------------

alter table app_private.audit_entity_manifest
  add column retention_days integer not null default 2555
    check (retention_days between 30 and 36500),
  add column archive_after_days integer not null default 365
    check (archive_after_days between 1 and 36500),
  add column legal_hold_eligible boolean not null default true,
  add column review_owner text not null default 'security-and-compliance',
  add constraint audit_manifest_archive_before_retention_check
    check (archive_after_days <= retention_days);

update app_private.audit_entity_manifest
set retention_days = case when contains_regulated_data then 2555 else 1095 end,
    archive_after_days = case when contains_regulated_data then 365 else 180 end,
    legal_hold_eligible = true;

create or replace function app_private.compute_audit_event_hash(p_log public.audit_logs)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
begin
  return pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.concat_ws(
          E'\x1f',
          p_log.id::text,
          coalesce(p_log.organization_id::text, ''),
          coalesce(p_log.facility_id::text, ''),
          coalesce(p_log.actor_profile_id::text, ''),
          coalesce(p_log.actor_subject_id, ''),
          p_log.entity_type,
          coalesce(p_log.entity_id, ''),
          p_log.action,
          pg_catalog.to_char(
            p_log.created_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US'
          ),
          coalesce(p_log.request_id, ''),
          coalesce(p_log.correlation_id, ''),
          coalesce(p_log.source, ''),
          coalesce(p_log.reason, ''),
          coalesce(p_log.ip_address, ''),
          coalesce(p_log.old_values::text, ''),
          coalesce(p_log.new_values::text, ''),
          coalesce(p_log.metadata::text, '{}')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
end;
$function$;

revoke all on function app_private.compute_audit_event_hash(public.audit_logs)
  from public, anon, authenticated;

create or replace function app_private.finalize_audit_hash_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.hash_version := 2;
  new.event_hash := app_private.compute_audit_event_hash(new);
  return new;
end;
$function$;

revoke all on function app_private.finalize_audit_hash_v2()
  from public, anon, authenticated;

-- PostgreSQL orders same-timing triggers by name, so this runs after
-- ensure_audit_event_context and includes its normalized/redacted values.
drop trigger if exists zz_finalize_audit_hash_v2 on public.audit_logs;
create trigger zz_finalize_audit_hash_v2
before insert on public.audit_logs
for each row execute function app_private.finalize_audit_hash_v2();

update public.audit_logs as a
set hash_version = 2,
    event_hash = app_private.compute_audit_event_hash(a);

create or replace function app_private.prevent_audit_log_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'Audit evidence is append-only; export and archive it instead of mutating it'
    using errcode = '55000';
end;
$function$;

revoke all on function app_private.prevent_audit_log_mutation()
  from public, anon, authenticated;

drop trigger if exists prevent_audit_log_mutation on public.audit_logs;
create trigger prevent_audit_log_mutation
before update or delete on public.audit_logs
for each row execute function app_private.prevent_audit_log_mutation();

revoke update, delete, truncate on table public.audit_logs from service_role;
grant select, insert on table public.audit_logs to service_role;

create table app_private.audit_legal_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  facility_id uuid references public.facilities(id),
  reason text not null check (length(trim(reason)) between 8 and 2000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid not null references public.profiles(id),
  released_at timestamptz,
  released_by uuid references public.profiles(id),
  release_reason text,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (
    (released_at is null and released_by is null and release_reason is null)
    or (released_at is not null and released_by is not null and length(trim(release_reason)) >= 8)
  )
);

create index audit_legal_holds_active_idx
  on app_private.audit_legal_holds(organization_id, facility_id, starts_at)
  where released_at is null;

create table app_private.audit_archive_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  range_start timestamptz not null,
  range_end timestamptz not null,
  row_count bigint not null check (row_count >= 0),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'planned'
    check (status in ('planned', 'exported', 'verified', 'failed')),
  legal_hold_applies boolean not null default false,
  storage_bucket text,
  storage_path text,
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  exported_at timestamptz,
  verified_at timestamptz,
  last_error text,
  check (range_end > range_start),
  check (
    status not in ('exported', 'verified')
    or (storage_bucket is not null and storage_path is not null and exported_at is not null)
  )
);

create table app_private.audit_integrity_issues (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('audit_event', 'manifest_table')),
  subject_key text not null,
  issue_type text not null check (issue_type in ('hash_mismatch', 'missing_context', 'missing_trigger')),
  expected_hash text,
  observed_hash text,
  details jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index audit_integrity_issues_open_uidx
  on app_private.audit_integrity_issues(subject_type, subject_key, issue_type)
  where resolved_at is null;

alter table app_private.audit_legal_holds enable row level security;
alter table app_private.audit_archive_batches enable row level security;
alter table app_private.audit_integrity_issues enable row level security;
revoke all on table app_private.audit_legal_holds,
  app_private.audit_archive_batches,
  app_private.audit_integrity_issues
  from public, anon, authenticated;
grant select, insert, update, delete on table app_private.audit_legal_holds,
  app_private.audit_archive_batches,
  app_private.audit_integrity_issues
  to service_role;

create or replace function public.create_audit_legal_hold(
  p_organization_id uuid,
  p_facility_id uuid,
  p_reason text,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_organization_id uuid := p_organization_id;
  v_facility_organization_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may create legal holds' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'A meaningful legal-hold reason is required' using errcode = '22023';
  end if;
  if p_facility_id is not null then
    select f.organization_id into v_facility_organization_id
    from public.facilities f
    where f.id = p_facility_id;
    if v_facility_organization_id is null
       or (p_organization_id is not null and v_facility_organization_id <> p_organization_id) then
      raise exception 'Facility is outside the requested organization' using errcode = '23514';
    end if;
    v_organization_id := coalesce(p_organization_id, v_facility_organization_id);
  end if;

  insert into app_private.audit_legal_holds (
    organization_id, facility_id, reason, ends_at, created_by
  ) values (
    v_organization_id, p_facility_id, trim(p_reason), p_ends_at, auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs (
    organization_id, facility_id, actor_profile_id, entity_type, entity_id,
    action, reason, new_values
  ) values (
    v_organization_id, p_facility_id, auth.uid(), 'audit_legal_holds', v_id::text,
    'audit_legal_hold_created', trim(p_reason),
    jsonb_build_object('ends_at', p_ends_at)
  );
  return v_id;
end;
$function$;

revoke all on function public.create_audit_legal_hold(uuid, uuid, text, timestamptz)
  from public, anon;
grant execute on function public.create_audit_legal_hold(uuid, uuid, text, timestamptz)
  to authenticated;

create or replace function public.release_audit_legal_hold(
  p_hold_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hold app_private.audit_legal_holds%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may release legal holds' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'A meaningful release reason is required' using errcode = '22023';
  end if;

  update app_private.audit_legal_holds
  set released_at = now(), released_by = auth.uid(), release_reason = trim(p_reason)
  where id = p_hold_id and released_at is null
  returning * into v_hold;
  if v_hold.id is null then
    raise exception 'Active legal hold not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    organization_id, facility_id, actor_profile_id, entity_type, entity_id,
    action, reason
  ) values (
    v_hold.organization_id, v_hold.facility_id, auth.uid(), 'audit_legal_holds',
    v_hold.id::text, 'audit_legal_hold_released', trim(p_reason)
  );
end;
$function$;

revoke all on function public.release_audit_legal_hold(uuid, text) from public, anon;
grant execute on function public.release_audit_legal_hold(uuid, text) to authenticated;

create or replace function public.plan_audit_archive(
  p_from timestamptz,
  p_to timestamptz,
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_manifest jsonb;
  v_id uuid;
  v_hold boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may plan audit archives' using errcode = '42501';
  end if;

  v_manifest := public.get_audit_export_manifest(p_from, p_to, p_organization_id);
  select exists (
    select 1
    from app_private.audit_legal_holds h
    where h.released_at is null
      and h.starts_at <= now()
      and (h.ends_at is null or h.ends_at > now())
      and (
        p_organization_id is null
        or h.organization_id is null
        or h.organization_id = p_organization_id
      )
  ) into v_hold;

  insert into app_private.audit_archive_batches (
    organization_id, range_start, range_end, row_count, manifest_sha256,
    legal_hold_applies, requested_by
  ) values (
    p_organization_id, p_from, p_to,
    (v_manifest->>'rowCount')::bigint,
    v_manifest->>'sha256',
    v_hold,
    auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    p_organization_id, auth.uid(), 'audit_archive_batches', v_id::text,
    'audit_archive_planned',
    jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'row_count', (v_manifest->>'rowCount')::bigint,
      'sha256', v_manifest->>'sha256',
      'legal_hold_applies', v_hold
    )
  );
  return v_id;
end;
$function$;

revoke all on function public.plan_audit_archive(timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.plan_audit_archive(timestamptz, timestamptz, uuid)
  to authenticated;

create or replace function public.reconcile_audit_integrity(p_limit integer default 10000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hash_issues integer := 0;
  v_context_issues integer := 0;
  v_trigger_issues integer := 0;
  v_open integer := 0;
begin
  if p_limit < 1 or p_limit > 100000 then
    raise exception 'p_limit must be between 1 and 100000' using errcode = '22023';
  end if;

  with bad as (
    select a.id, app_private.compute_audit_event_hash(a) as expected_hash, a.event_hash
    from public.audit_logs a
    where a.hash_version <> 2
       or a.event_hash is distinct from app_private.compute_audit_event_hash(a)
    order by a.created_at desc
    limit p_limit
  ), recorded as (
    insert into app_private.audit_integrity_issues (
      subject_type, subject_key, issue_type, expected_hash, observed_hash
    )
    select 'audit_event', b.id::text, 'hash_mismatch', b.expected_hash, b.event_hash
    from bad b
    on conflict (subject_type, subject_key, issue_type) where resolved_at is null
    do update set expected_hash = excluded.expected_hash,
                  observed_hash = excluded.observed_hash,
                  last_detected_at = now()
    returning 1
  ) select count(*) into v_hash_issues from recorded;

  with bad as (
    select a.id
    from public.audit_logs a
    where a.request_id is null or a.correlation_id is null or a.source is null
    order by a.created_at desc
    limit p_limit
  ), recorded as (
    insert into app_private.audit_integrity_issues (
      subject_type, subject_key, issue_type, details
    )
    select 'audit_event', b.id::text, 'missing_context',
      jsonb_build_object('required', jsonb_build_array('request_id', 'correlation_id', 'source'))
    from bad b
    on conflict (subject_type, subject_key, issue_type) where resolved_at is null
    do update set last_detected_at = now()
    returning 1
  ) select count(*) into v_context_issues from recorded;

  with bad as (
    select m.table_name
    from app_private.audit_entity_manifest m
    where m.audit_mode = 'row_trigger'
      and not exists (
        select 1
        from pg_catalog.pg_trigger tr
        join pg_catalog.pg_proc p on p.oid = tr.tgfoid
        where tr.tgrelid = pg_catalog.to_regclass(
          pg_catalog.format('%I.%I', m.table_schema, m.table_name)
        )
          and not tr.tgisinternal
          and p.proname = 'audit_log_trigger'
      )
  ), recorded as (
    insert into app_private.audit_integrity_issues (
      subject_type, subject_key, issue_type, details
    )
    select 'manifest_table', b.table_name, 'missing_trigger', '{}'::jsonb
    from bad b
    on conflict (subject_type, subject_key, issue_type) where resolved_at is null
    do update set last_detected_at = now()
    returning 1
  ) select count(*) into v_trigger_issues from recorded;

  update app_private.audit_integrity_issues i
  set resolved_at = now()
  where i.resolved_at is null
    and (
      (i.issue_type = 'hash_mismatch' and not exists (
        select 1 from public.audit_logs a
        where a.id::text = i.subject_key
          and (a.hash_version <> 2 or a.event_hash is distinct from app_private.compute_audit_event_hash(a))
      ))
      or (i.issue_type = 'missing_context' and not exists (
        select 1 from public.audit_logs a
        where a.id::text = i.subject_key
          and (a.request_id is null or a.correlation_id is null or a.source is null)
      ))
      or (i.issue_type = 'missing_trigger' and exists (
        select 1
        from app_private.audit_entity_manifest m
        join pg_catalog.pg_trigger tr
          on tr.tgrelid = pg_catalog.to_regclass(
            pg_catalog.format('%I.%I', m.table_schema, m.table_name)
          )
        join pg_catalog.pg_proc p on p.oid = tr.tgfoid
        where m.table_name = i.subject_key
          and not tr.tgisinternal
          and p.proname = 'audit_log_trigger'
      ))
    );

  select count(*) into v_open
  from app_private.audit_integrity_issues
  where resolved_at is null;

  return jsonb_build_object(
    'hashIssuesDetected', v_hash_issues,
    'contextIssuesDetected', v_context_issues,
    'triggerIssuesDetected', v_trigger_issues,
    'openIssues', v_open,
    'checkedAt', now()
  );
end;
$function$;

revoke all on function public.reconcile_audit_integrity(integer)
  from public, anon, authenticated;
grant execute on function public.reconcile_audit_integrity(integer) to service_role;

create or replace function public.get_audit_governance_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may inspect audit governance' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'hashVersion', 2,
    'openIntegrityIssues', (
      select count(*) from app_private.audit_integrity_issues where resolved_at is null
    ),
    'activeLegalHolds', (
      select count(*) from app_private.audit_legal_holds
      where released_at is null and (ends_at is null or ends_at > now())
    ),
    'plannedArchives', (
      select count(*) from app_private.audit_archive_batches where status = 'planned'
    ),
    'oldestHotEvidenceAt', (select min(created_at) from public.audit_logs),
    'retentionClasses', (
      select coalesce(jsonb_agg(x order by (x->>'retentionDays')::integer), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'retentionDays', retention_days,
          'archiveAfterDays', archive_after_days,
          'tableCount', count(*)
        ) as x
        from app_private.audit_entity_manifest
        group by retention_days, archive_after_days
      ) classes
    )
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.get_audit_governance_status() from public, anon;
grant execute on function public.get_audit_governance_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Job kill switches, circuit breakers, recovery actions, and measurements
-- ---------------------------------------------------------------------------

alter table app_private.system_job_definitions
  add column kill_switch_enabled boolean not null default false,
  add column kill_switch_reason text,
  add column kill_switch_changed_at timestamptz,
  add column kill_switch_changed_by uuid references public.profiles(id),
  add column max_retries integer not null default 3 check (max_retries between 0 and 20),
  add column failure_alert_threshold integer not null default 3
    check (failure_alert_threshold between 1 and 20),
  add column circuit_state text not null default 'closed'
    check (circuit_state in ('closed', 'open', 'half_open')),
  add column circuit_open_until timestamptz,
  add column last_known_good_at timestamptz,
  add column last_known_good_result jsonb not null default '{}'::jsonb;

alter table app_private.system_job_runs
  add column requested_by uuid references public.profiles(id),
  add column request_reason text,
  add column cancellation_requested_at timestamptz,
  add column cancellation_requested_by uuid references public.profiles(id),
  add column cancellation_reason text,
  add column replay_of_run_id uuid references app_private.system_job_runs(id),
  add column dead_lettered_at timestamptz,
  add column dead_letter_reason text,
  add column provider_latency_ms bigint check (provider_latency_ms is null or provider_latency_ms >= 0),
  add column retry_cost_units bigint not null default 0 check (retry_cost_units >= 0);

create unique index system_job_runs_one_effective_replay_idx
  on app_private.system_job_runs(replay_of_run_id)
  where replay_of_run_id is not null
    and status in ('queued', 'running', 'succeeded');

create or replace function public.claim_system_job_execution(
  p_job_key text,
  p_correlation_id text,
  p_trigger_type text default 'scheduled',
  p_provider_request_id text default null
)
returns table (run_id uuid, should_execute boolean, existing_status text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_definition app_private.system_job_definitions%rowtype;
  v_run app_private.system_job_runs%rowtype;
begin
  if nullif(trim(p_correlation_id), '') is null then
    raise exception 'A correlation id is required' using errcode = '22023';
  end if;
  if p_trigger_type not in ('scheduled', 'manual', 'retry', 'backfill', 'webhook') then
    raise exception 'Invalid trigger type' using errcode = '22023';
  end if;

  select * into v_definition
  from app_private.system_job_definitions d
  where d.job_key = p_job_key and d.is_active
  for update;
  if v_definition.job_key is null then
    raise exception 'Active system job not found' using errcode = 'P0002';
  end if;
  if v_definition.kill_switch_enabled then
    raise exception 'System job is disabled: %', coalesce(v_definition.kill_switch_reason, 'kill switch enabled')
      using errcode = '55000';
  end if;
  if v_definition.circuit_state = 'open' then
    if v_definition.circuit_open_until is null or v_definition.circuit_open_until > now() then
      raise exception 'System job circuit is open' using errcode = '55000';
    end if;
    update app_private.system_job_definitions
    set circuit_state = 'half_open', updated_at = now()
    where job_key = p_job_key;
    v_definition.circuit_state := 'half_open';
  end if;
  if v_definition.circuit_state = 'half_open' and exists (
    select 1
    from app_private.system_job_runs r
    where r.job_key = p_job_key
      and r.status in ('queued', 'running')
      and r.correlation_id <> left(trim(p_correlation_id), 200)
  ) then
    raise exception 'System job circuit is half-open with a trial already in progress'
      using errcode = '55000';
  end if;

  insert into app_private.system_job_runs (
    job_key, correlation_id, trigger_type, provider_request_id
  ) values (
    p_job_key, left(trim(p_correlation_id), 200), p_trigger_type,
    nullif(left(p_provider_request_id, 200), '')
  )
  on conflict (job_key, correlation_id) do nothing
  returning * into v_run;

  if v_run.id is not null then
    return query select v_run.id, true, null::text;
    return;
  end if;

  select * into v_run
  from app_private.system_job_runs r
  where r.job_key = p_job_key and r.correlation_id = left(trim(p_correlation_id), 200)
  for update;

  if v_run.status in ('queued', 'failed', 'partial', 'cancelled') then
    update app_private.system_job_runs
    set status = 'running',
        started_at = now(),
        finished_at = null,
        last_heartbeat_at = now(),
        attempted_count = 0,
        succeeded_count = 0,
        failed_count = 0,
        cursor = null,
        error_code = null,
        error_message = null,
        provider_request_id = coalesce(nullif(left(p_provider_request_id, 200), ''), provider_request_id),
        retry_count = retry_count + case when v_run.status = 'queued' then 0 else 1 end,
        updated_at = now()
    where id = v_run.id
    returning * into v_run;
    return query select v_run.id, true, v_run.status;
  else
    return query select v_run.id, false, v_run.status;
  end if;
end;
$function$;

revoke all on function public.claim_system_job_execution(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_system_job_execution(text, text, text, text)
  to service_role;

create or replace function public.begin_system_job(
  p_job_key text,
  p_correlation_id text,
  p_trigger_type text default 'scheduled',
  p_provider_request_id text default null
)
returns uuid
language sql
security definer
set search_path = ''
as $function$
  select c.run_id
  from public.claim_system_job_execution(
    p_job_key, p_correlation_id, p_trigger_type, p_provider_request_id
  ) c;
$function$;

revoke all on function public.begin_system_job(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_system_job(text, text, text, text) to service_role;

create or replace function public.is_system_job_cancellation_requested(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select r.cancellation_requested_at is not null or r.status = 'cancelled'
    from app_private.system_job_runs r
    where r.id = p_run_id
  ), true);
$function$;

revoke all on function public.is_system_job_cancellation_requested(uuid)
  from public, anon, authenticated;
grant execute on function public.is_system_job_cancellation_requested(uuid) to service_role;

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
as $function$
declare
  v_run app_private.system_job_runs%rowtype;
  v_definition app_private.system_job_definitions%rowtype;
  v_recent_failures integer;
  v_cancelled boolean;
begin
  if p_status not in ('succeeded', 'partial', 'failed', 'cancelled') then
    raise exception 'Invalid terminal job status' using errcode = '22023';
  end if;

  select * into v_run
  from app_private.system_job_runs r
  where r.id = p_run_id
  for update;
  if v_run.id is null then
    raise exception 'System job run not found' using errcode = 'P0002';
  end if;
  if v_run.status not in ('queued', 'running') then
    if v_run.status = p_status then return; end if;
    raise exception 'System job already finished differently' using errcode = '55000';
  end if;

  select * into v_definition
  from app_private.system_job_definitions d
  where d.job_key = v_run.job_key
  for update;

  v_cancelled := v_run.cancellation_requested_at is not null;

  update app_private.system_job_runs
  set status = case when cancellation_requested_at is not null then 'cancelled' else p_status end,
      finished_at = now(),
      last_heartbeat_at = now(),
      attempted_count = greatest(coalesce(p_attempted_count, 0), 0),
      succeeded_count = greatest(coalesce(p_succeeded_count, 0), 0),
      failed_count = greatest(coalesce(p_failed_count, 0), 0),
      result = coalesce(p_result, '{}'::jsonb),
      error_code = left(p_error_code, 120),
      error_message = left(p_error_message, 2000),
      dead_lettered_at = case
        when p_status = 'failed' and retry_count >= v_definition.max_retries then now()
        else dead_lettered_at
      end,
      dead_letter_reason = case
        when p_status = 'failed' and retry_count >= v_definition.max_retries
          then coalesce(left(p_error_message, 2000), 'Retry budget exhausted')
        else dead_letter_reason
      end,
      provider_latency_ms = case
        when v_definition.execution_kind in ('edge_cron', 'external') then
          greatest(
            (extract(epoch from (now() - started_at)) * 1000)::bigint,
            0
          )
        else provider_latency_ms
      end,
      retry_cost_units = greatest(retry_cost_units, retry_count::bigint),
      updated_at = now()
  where id = p_run_id;

  if p_status = 'succeeded' and not v_cancelled then
    update app_private.system_job_definitions
    set circuit_state = 'closed',
        circuit_open_until = null,
        last_known_good_at = now(),
        last_known_good_result = coalesce(p_result, '{}'::jsonb),
        updated_at = now()
    where job_key = v_run.job_key;
  elsif p_status in ('failed', 'partial') and not v_cancelled
      and v_definition.execution_kind in ('edge_cron', 'external')
      and (
        p_status = 'failed'
        or (
          coalesce(p_attempted_count, 0) > 0
          and coalesce(p_failed_count, 0)::numeric
            / nullif(coalesce(p_attempted_count, 0), 0)::numeric >= 0.5
        )
      ) then
    select count(*) into v_recent_failures
    from (
      select r.status, r.attempted_count, r.failed_count
      from app_private.system_job_runs r
      where r.job_key = v_run.job_key
        and r.finished_at is not null
      order by r.finished_at desc
      limit v_definition.failure_alert_threshold
    ) recent
    where recent.status = 'failed'
       or (
         recent.status = 'partial'
         and recent.attempted_count > 0
         and recent.failed_count::numeric
           / nullif(recent.attempted_count, 0)::numeric >= 0.5
       );

    if v_recent_failures >= v_definition.failure_alert_threshold then
      update app_private.system_job_definitions
      set circuit_state = 'open',
          circuit_open_until = now() + interval '15 minutes',
          updated_at = now()
      where job_key = v_run.job_key;
    end if;
  end if;
end;
$function$;

revoke all on function public.finish_system_job(uuid, text, bigint, bigint, bigint, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_system_job(uuid, text, bigint, bigint, bigint, jsonb, text, text)
  to service_role;

create or replace function public.request_system_job_rerun(
  p_job_key text,
  p_reason text
)
returns table (run_id uuid, correlation_id text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_definition app_private.system_job_definitions%rowtype;
  v_correlation text := gen_random_uuid()::text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may rerun system jobs' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'A meaningful rerun reason is required' using errcode = '22023';
  end if;

  select * into v_definition
  from app_private.system_job_definitions d
  where d.job_key = p_job_key and d.is_active
  for update;
  if v_definition.job_key is null or v_definition.retry_mode = 'none' then
    raise exception 'Job is not manually rerunnable' using errcode = '55000';
  end if;
  if v_definition.kill_switch_enabled then
    raise exception 'Job is disabled by its kill switch' using errcode = '55000';
  end if;
  if v_definition.circuit_state = 'open'
     and (
       v_definition.circuit_open_until is null
       or v_definition.circuit_open_until > now()
     ) then
    raise exception 'Job is disabled by its open circuit' using errcode = '55000';
  end if;
  if v_definition.circuit_state in ('open', 'half_open') and exists (
    select 1 from app_private.system_job_runs r
    where r.job_key = p_job_key and r.status in ('queued', 'running')
  ) then
    raise exception 'A provider circuit trial is already queued or running'
      using errcode = '55000';
  end if;

  insert into app_private.system_job_runs (
    job_key, correlation_id, trigger_type, status, requested_by, request_reason
  ) values (
    p_job_key, v_correlation, 'manual', 'queued', auth.uid(), trim(p_reason)
  ) returning id into run_id;
  correlation_id := v_correlation;

  insert into public.audit_logs (
    actor_profile_id, entity_type, entity_id, action, reason, new_values
  ) values (
    auth.uid(), 'system_jobs', p_job_key, 'system_job_rerun_requested', trim(p_reason),
    jsonb_build_object('run_id', run_id, 'correlation_id', v_correlation)
  );
  return next;
end;
$function$;

revoke all on function public.request_system_job_rerun(text, text) from public, anon;
grant execute on function public.request_system_job_rerun(text, text) to authenticated;

create or replace function public.request_system_job_cancellation(
  p_run_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_run app_private.system_job_runs%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may cancel system jobs' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'A meaningful cancellation reason is required' using errcode = '22023';
  end if;

  update app_private.system_job_runs
  set cancellation_requested_at = now(),
      cancellation_requested_by = auth.uid(),
      cancellation_reason = trim(p_reason),
      status = case when status = 'queued' then 'cancelled' else status end,
      finished_at = case when status = 'queued' then now() else finished_at end,
      updated_at = now()
  where id = p_run_id and status in ('queued', 'running')
  returning * into v_run;
  if v_run.id is null then
    raise exception 'Queued or running system job not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    actor_profile_id, entity_type, entity_id, action, reason, new_values
  ) values (
    auth.uid(), 'system_jobs', v_run.job_key, 'system_job_cancellation_requested',
    trim(p_reason), jsonb_build_object('run_id', v_run.id)
  );
end;
$function$;

revoke all on function public.request_system_job_cancellation(uuid, text) from public, anon;
grant execute on function public.request_system_job_cancellation(uuid, text) to authenticated;

create or replace function public.replay_system_job_dead_letter(
  p_run_id uuid,
  p_reason text
)
returns table (run_id uuid, correlation_id text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_original app_private.system_job_runs%rowtype;
  v_definition app_private.system_job_definitions%rowtype;
  v_correlation text := gen_random_uuid()::text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may replay dead letters' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'A meaningful replay reason is required' using errcode = '22023';
  end if;
  select * into v_original
  from app_private.system_job_runs r
  where r.id = p_run_id and r.dead_lettered_at is not null
  for update;
  if v_original.id is null then
    raise exception 'Dead-lettered run not found' using errcode = 'P0002';
  end if;

  -- Serialize on the original dead letter and return the canonical active or
  -- successful replay. A browser/network retry must not enqueue the same
  -- external side effect twice under two random correlation IDs.
  select r.id, r.correlation_id into run_id, correlation_id
  from app_private.system_job_runs r
  where r.replay_of_run_id = v_original.id
    and r.status in ('queued', 'running', 'succeeded')
  order by r.created_at
  limit 1;
  if run_id is not null then
    return next;
    return;
  end if;

  select * into v_definition
  from app_private.system_job_definitions d
  where d.job_key = v_original.job_key and d.is_active
  for update;
  if v_definition.job_key is null then
    raise exception 'Active system job not found' using errcode = 'P0002';
  end if;
  if v_definition.retry_mode = 'none' then
    raise exception 'Job does not permit replay' using errcode = '55000';
  end if;
  if v_definition.kill_switch_enabled then
    raise exception 'Job is disabled by its kill switch' using errcode = '55000';
  end if;
  if v_definition.circuit_state = 'open'
     and (
       v_definition.circuit_open_until is null
       or v_definition.circuit_open_until > now()
     ) then
    raise exception 'Job is disabled by its open circuit' using errcode = '55000';
  end if;
  if v_definition.circuit_state in ('open', 'half_open') and exists (
    select 1 from app_private.system_job_runs r
    where r.job_key = v_original.job_key and r.status in ('queued', 'running')
  ) then
    raise exception 'A provider circuit trial is already queued or running'
      using errcode = '55000';
  end if;

  insert into app_private.system_job_runs (
    job_key, correlation_id, trigger_type, status, requested_by, request_reason,
    replay_of_run_id, retry_count
  ) values (
    v_original.job_key, v_correlation, 'retry', 'queued', auth.uid(), trim(p_reason),
    v_original.id, v_original.retry_count + 1
  ) returning id into run_id;
  correlation_id := v_correlation;

  insert into public.audit_logs (
    actor_profile_id, entity_type, entity_id, action, reason, new_values
  ) values (
    auth.uid(), 'system_jobs', v_original.job_key, 'system_job_dead_letter_replayed',
    trim(p_reason), jsonb_build_object(
      'run_id', run_id,
      'replay_of_run_id', v_original.id,
      'correlation_id', v_correlation
    )
  );
  return next;
end;
$function$;

revoke all on function public.replay_system_job_dead_letter(uuid, text) from public, anon;
grant execute on function public.replay_system_job_dead_letter(uuid, text) to authenticated;

create or replace function public.set_system_job_kill_switch(
  p_job_key text,
  p_enabled boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may change job kill switches' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'A meaningful kill-switch reason is required' using errcode = '22023';
  end if;

  update app_private.system_job_definitions
  set kill_switch_enabled = p_enabled,
      kill_switch_reason = trim(p_reason),
      kill_switch_changed_at = now(),
      kill_switch_changed_by = auth.uid(),
      updated_at = now()
  where job_key = p_job_key;
  if not found then
    raise exception 'System job not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    actor_profile_id, entity_type, entity_id, action, reason, new_values
  ) values (
    auth.uid(), 'system_jobs', p_job_key, 'system_job_kill_switch_changed',
    trim(p_reason), jsonb_build_object('enabled', p_enabled)
  );
end;
$function$;

revoke all on function public.set_system_job_kill_switch(text, boolean, text)
  from public, anon;
grant execute on function public.set_system_job_kill_switch(text, boolean, text)
  to authenticated;

create or replace function public.get_system_job_recovery_state()
returns table (
  job_key text,
  latest_run_id uuid,
  kill_switch_enabled boolean,
  kill_switch_reason text,
  circuit_state text,
  circuit_open_until timestamptz,
  last_known_good_at timestamptz,
  last_known_good_result jsonb,
  cancellation_pending boolean,
  dead_letter_count bigint,
  latest_dead_letter_run_id uuid,
  queue_age_ms bigint,
  failure_rate_24h numeric,
  provider_latency_ms_24h bigint,
  retry_cost_units_24h bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may inspect job recovery state' using errcode = '42501';
  end if;

  return query
  select
    d.job_key,
    latest.id,
    d.kill_switch_enabled,
    d.kill_switch_reason,
    d.circuit_state,
    d.circuit_open_until,
    d.last_known_good_at,
    d.last_known_good_result,
    coalesce(latest.cancellation_requested_at is not null and latest.status = 'running', false),
    (select count(*) from app_private.system_job_runs dl
      where dl.job_key = d.job_key and dl.dead_lettered_at is not null),
    dead.id,
    case d.job_key
      when 'notification-dispatch' then (
        select (extract(epoch from (now() - min(n.created_at))) * 1000)::bigint
        from public.notification_deliveries n where n.status = 'pending'
      )
      when 'certificate-pdf-generation' then (
        select (extract(epoch from (now() - min(j.requested_at))) * 1000)::bigint
        from public.certificate_pdf_jobs j where j.status in ('pending', 'failed')
      )
      else null
    end,
    coalesce((
      select round(
        count(*) filter (where r.status in ('failed', 'partial'))::numeric
        / nullif(count(*), 0),
        4
      )
      from app_private.system_job_runs r
      where r.job_key = d.job_key and r.started_at >= now() - interval '24 hours'
    ), 0),
    case when d.job_key = 'notification-dispatch' then (
      select avg(extract(epoch from (e.received_at - a.started_at)) * 1000)::bigint
      from public.notification_provider_events e
      join public.notification_delivery_attempts a on a.id = e.attempt_id
      where e.received_at >= now() - interval '24 hours'
        and e.outcome is not null
    ) else (
      select avg(r.provider_latency_ms)::bigint
      from app_private.system_job_runs r
      where r.job_key = d.job_key
        and r.started_at >= now() - interval '24 hours'
        and r.provider_latency_ms is not null
    ) end,
    case when d.job_key = 'notification-dispatch' then (
      select count(*)::bigint
      from public.notification_delivery_attempts a
      where a.started_at >= now() - interval '24 hours' and a.attempt_number > 1
    ) else coalesce((
      select sum(r.retry_cost_units) from app_private.system_job_runs r
      where r.job_key = d.job_key and r.started_at >= now() - interval '24 hours'
    ), 0) end
  from app_private.system_job_definitions d
  left join lateral (
    select r.* from app_private.system_job_runs r
    where r.job_key = d.job_key order by r.started_at desc limit 1
  ) latest on true
  left join lateral (
    select r.id from app_private.system_job_runs r
    where r.job_key = d.job_key and r.dead_lettered_at is not null
    order by r.dead_lettered_at desc limit 1
  ) dead on true
  where d.is_active
  order by d.display_name;
end;
$function$;

revoke all on function public.get_system_job_recovery_state() from public, anon;
grant execute on function public.get_system_job_recovery_state() to authenticated;

-- Stub first so execute_registered_sql_job can be compiled before the final
-- synthetic-check body is installed below.
create or replace function public.run_phase1_synthetic_checks()
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select '{}'::jsonb;
$function$;

-- SQL cron jobs now pass through the same kill-switch/run-ledger contract as
-- Edge workers. The mapping is intentionally static; operators cannot inject SQL.
create or replace function public.execute_registered_sql_job(
  p_job_key text,
  p_correlation_id text,
  p_trigger_type text default 'scheduled'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim record;
  v_result jsonb := '{}'::jsonb;
begin
  select * into v_claim
  from public.claim_system_job_execution(
    p_job_key, p_correlation_id, p_trigger_type, null
  );
  if not coalesce(v_claim.should_execute, false) then
    return jsonb_build_object('replayed', true, 'runId', v_claim.run_id);
  end if;

  begin
    case p_job_key
      when 'compliance-recalculation' then perform public.recalculate_all_compliance();
      when 'incident-notifications' then perform public.recalculate_incident_notifications();
      when 'alert-escalation' then perform public.escalate_unactioned_alerts();
      when 'monday-digest' then perform public.send_monday_digest();
      when 'policy-reminders' then perform public.send_policy_attestation_reminders();
      when 'course-status-recalculation' then perform public.recalculate_course_assignment_statuses();
      when 'course-continuation-reminders' then perform public.queue_course_continuation_reminders();
      when 'resident-compliance-recalculation' then perform public.recalculate_resident_compliance_statuses();
      when 'audit-integrity-reconciliation' then
        v_result := public.reconcile_audit_integrity(10000);
        if coalesce((v_result ->> 'openIssues')::integer, 0) > 0 then
          perform public.finish_system_job(
            v_claim.run_id, 'failed', 1, 0, 1, v_result,
            'audit_integrity_issues',
            left('Audit integrity reconciliation found open issues: ' || v_result::text, 2000)
          );
          return v_result || jsonb_build_object(
            'runId', v_claim.run_id,
            'status', 'failed'
          );
        end if;
      when 'phase1-synthetic-health' then
        v_result := public.run_phase1_synthetic_checks();
        if coalesce((v_result ->> 'completedAssignmentsWithoutCertificate')::bigint, 0) > 0
           or coalesce((v_result ->> 'certificatePdfJobsExhausted')::bigint, 0) > 0
           or coalesce((v_result ->> 'notificationOutcomesUnknown')::bigint, 0) > 0
           or coalesce((v_result ->> 'exclusionSourcesWithoutActiveSnapshot')::bigint, 0) > 0
           or coalesce((v_result ->> 'auditIntegrityIssuesOpen')::bigint, 0) > 0
           or coalesce((v_result ->> 'auditTriggerGaps')::bigint, 0) > 0 then
          perform public.finish_system_job(
            v_claim.run_id, 'failed', 1, 0, 1, v_result,
            'synthetic_invariant_violation',
            left('Phase 1 synthetic checks found invariant violations: ' || v_result::text, 2000)
          );
          return v_result || jsonb_build_object(
            'runId', v_claim.run_id,
            'status', 'failed'
          );
        end if;
      else
        raise exception 'Job is not a registered SQL worker' using errcode = '22023';
    end case;

    perform public.finish_system_job(
      v_claim.run_id, 'succeeded', 1, 1, 0, v_result, null, null
    );
    return v_result || jsonb_build_object('runId', v_claim.run_id);
  exception when others then
    perform public.finish_system_job(
      v_claim.run_id, 'failed', 1, 0, 1, v_result,
      sqlstate, left(sqlerrm, 2000)
    );
    -- Re-raising would abort the cron transaction and roll the failed run
    -- record back with it. Keep failure evidence durable for alerting/retry.
    return jsonb_build_object(
      'runId', v_claim.run_id,
      'status', 'failed',
      'errorCode', sqlstate,
      'errorMessage', left(sqlerrm, 2000)
    );
  end;
end;
$function$;

create or replace function public.run_phase1_synthetic_checks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'completedAssignmentsWithoutCertificate', (
      select count(*) from public.course_assignments ca
      left join public.certificates c on c.course_assignment_id = ca.id
      where ca.status = 'completed' and c.id is null
    ),
    'certificatePdfJobsExhausted', (
      select count(*) from public.certificate_pdf_jobs j
      where j.status = 'failed' and j.attempt_count >= j.max_attempts
    ),
    'notificationOutcomesUnknown', (
      select count(*) from public.notification_deliveries n where n.final_outcome = 'unknown'
    ),
    'exclusionSourcesWithoutActiveSnapshot', (
      select count(*) from public.exclusion_source_state s where s.active_snapshot_id is null
    ),
    'auditIntegrityIssuesOpen', (
      select count(*) from app_private.audit_integrity_issues i where i.resolved_at is null
    ),
    'auditTriggerGaps', (
      select count(*)
      from app_private.audit_entity_manifest m
      where m.audit_mode = 'row_trigger'
        and not exists (
          select 1
          from pg_catalog.pg_trigger tr
          join pg_catalog.pg_proc p on p.oid = tr.tgfoid
          where tr.tgrelid = pg_catalog.to_regclass(
            pg_catalog.format('%I.%I', m.table_schema, m.table_name)
          )
            and not tr.tgisinternal
            and p.proname = 'audit_log_trigger'
        )
    ),
    'checkedAt', now()
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.run_phase1_synthetic_checks()
  from public, anon, authenticated;
grant execute on function public.run_phase1_synthetic_checks() to service_role;
revoke all on function public.execute_registered_sql_job(text, text, text)
  from public, anon, authenticated;
grant execute on function public.execute_registered_sql_job(text, text, text)
  to service_role;

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values
  (
    'audit-integrity-reconciliation',
    'Audit integrity reconciliation',
    'Verifies audit hashes, request context, and manifest trigger coverage',
    'sql_cron',
    'reconcile-audit-integrity-daily',
    interval '1 day', interval '30 hours', true, 'manual', '/admin/security'
  ),
  (
    'phase1-synthetic-health',
    'Phase 1 synthetic health',
    'Checks transactional and delivery invariants before users discover drift',
    'sql_cron',
    'phase1-synthetic-health',
    interval '15 minutes', interval '45 minutes', true, 'manual', '/admin/system-jobs'
  )
on conflict (job_key) do update set
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

-- Replace the direct SQL schedules with ledger-aware wrappers.
select cron.unschedule(jobname)
from cron.job
where jobname in (
  'recalculate-compliance-nightly',
  'recalculate-incident-notifications-hourly',
  'escalate-unactioned-alerts',
  'send-monday-digest',
  'send-policy-attestation-reminders',
  'recalculate-course-assignment-statuses-nightly',
  'course-continuation-reminders-daily',
  'recalculate-resident-compliance-nightly',
  'reconcile-audit-integrity-daily',
  'phase1-synthetic-health'
);

select cron.schedule('recalculate-compliance-nightly', '0 6 * * *',
  $$select public.execute_registered_sql_job('compliance-recalculation', gen_random_uuid()::text);$$);
select cron.schedule('recalculate-incident-notifications-hourly', '0 * * * *',
  $$select public.execute_registered_sql_job('incident-notifications', gen_random_uuid()::text);$$);
select cron.schedule('escalate-unactioned-alerts', '0 13 * * *',
  $$select public.execute_registered_sql_job('alert-escalation', gen_random_uuid()::text);$$);
select cron.schedule('send-monday-digest', '0 12 * * 1',
  $$select public.execute_registered_sql_job('monday-digest', gen_random_uuid()::text);$$);
select cron.schedule('send-policy-attestation-reminders', '0 12 * * *',
  $$select public.execute_registered_sql_job('policy-reminders', gen_random_uuid()::text);$$);
select cron.schedule('recalculate-course-assignment-statuses-nightly', '15 6 * * *',
  $$select public.execute_registered_sql_job('course-status-recalculation', gen_random_uuid()::text);$$);
select cron.schedule('course-continuation-reminders-daily', '0 14 * * *',
  $$select public.execute_registered_sql_job('course-continuation-reminders', gen_random_uuid()::text);$$);
select cron.schedule('recalculate-resident-compliance-nightly', '30 6 * * *',
  $$select public.execute_registered_sql_job('resident-compliance-recalculation', gen_random_uuid()::text);$$);
select cron.schedule('reconcile-audit-integrity-daily', '45 5 * * *',
  $$select public.execute_registered_sql_job('audit-integrity-reconciliation', gen_random_uuid()::text);$$);
select cron.schedule('phase1-synthetic-health', '7,22,37,52 * * * *',
  $$select public.execute_registered_sql_job('phase1-synthetic-health', gen_random_uuid()::text);$$);
