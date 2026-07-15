-- A deliberately read-only medication integration boundary. CareBase receives
-- normalized snapshots from a credentialed external eMAR, but it never
-- prescribes, changes an order, or records an administration as the source of
-- truth. Imports travel through the existing versioned command inbox.

insert into public.integration_api_scope_definitions(scope_key, description, risk_level)
values ('medications:write', 'Submit external eMAR snapshots to the medication boundary', 'write')
on conflict (scope_key) do update set description = excluded.description, is_active = true;

insert into public.integration_schema_definitions(
  schema_kind, schema_name, schema_version, json_schema
) values (
  'command', 'medication.snapshot.import', '2026-07-14',
  '{"type":"object","required":["sourceId","orders","administrations"]}'::jsonb
) on conflict (schema_kind, schema_name, schema_version) do nothing;

-- Keep the generic command contract backward-compatible while allowing the
-- medication-specific schema and least-privilege credential scope.
create or replace function public.accept_integration_command(
  p_credential_id uuid,
  p_idempotency_key text,
  p_request_sha256 text,
  p_command_type text,
  p_schema_version text,
  p_payload jsonb,
  p_correlation_id text
)
returns table(command_id uuid, command_status text, was_duplicate boolean, correlation_id text)
language plpgsql security definer set search_path = '' as $$
declare
  v_credential public.integration_api_credentials%rowtype;
  v_receipt app_private.integration_command_receipts%rowtype;
  v_medication_command boolean := p_command_type = 'medication.snapshot.import';
begin
  select * into v_credential from public.integration_api_credentials
  where id = p_credential_id and status = 'active' and expires_at > now();
  if not found or not (
    'commands:write' = any(v_credential.scopes)
    or (v_medication_command and 'medications:write' = any(v_credential.scopes))
  ) then
    raise exception 'Credential is not authorized for this command' using errcode = '42501';
  end if;
  if not (
      p_schema_version = '2026-07-11'
      or (v_medication_command and p_schema_version = '2026-07-14')
    ) or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or nullif(trim(p_correlation_id), '') is null
    or length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception 'Invalid versioned command envelope' using errcode = '22023';
  end if;
  insert into app_private.integration_command_receipts(
    organization_id, credential_id, idempotency_key, request_sha256,
    command_type, schema_version, payload, correlation_id
  ) values (
    v_credential.organization_id, p_credential_id, p_idempotency_key,
    p_request_sha256, p_command_type, p_schema_version,
    coalesce(p_payload, '{}'::jsonb), left(p_correlation_id, 200)
  ) on conflict (credential_id, idempotency_key) do nothing
  returning * into v_receipt;
  if v_receipt.id is null then
    select * into v_receipt from app_private.integration_command_receipts
    where credential_id = p_credential_id and idempotency_key = p_idempotency_key;
    if v_receipt.request_sha256 <> p_request_sha256 then
      raise exception 'Idempotency key was reused with different command content' using errcode = '23505';
    end if;
    return query select v_receipt.id, v_receipt.status, true, v_receipt.correlation_id;
    return;
  end if;
  insert into app_private.integration_event_log(
    organization_id, event_type, event_schema_version, correlation_id,
    causation_id, actor_subject, payload
  ) values (
    v_credential.organization_id, 'integration.command.accepted', '2026-07-11',
    v_receipt.correlation_id, v_receipt.id::text, 'api_credential:' || p_credential_id,
    jsonb_build_object('commandId', v_receipt.id, 'commandType', p_command_type, 'status', 'accepted')
  );
  return query select v_receipt.id, v_receipt.status, false, v_receipt.correlation_id;
end;
$$;

insert into public.permission_definitions(permission_key, description, risk_level)
values
  ('medications.integration.read', 'Read external medication synchronization health and normalized records', 'sensitive'),
  ('medications.integration.manage', 'Configure external medication sources, resident mappings, and exceptions', 'privileged')
on conflict (permission_key) do nothing;

insert into public.role_template_permissions(role_template_id, permission_key)
select rt.id, permission_key
from public.role_templates rt
cross join lateral (
  select unnest(case rt.built_in_role
    when 'platform_admin' then array['medications.integration.read', 'medications.integration.manage']::text[]
    when 'org_admin' then array['medications.integration.read', 'medications.integration.manage']::text[]
    when 'facility_manager' then array['medications.integration.read', 'medications.integration.manage']::text[]
    when 'auditor' then array['medications.integration.read']::text[]
    else array[]::text[]
  end) permission_key
) granted
where rt.built_in_role in ('platform_admin', 'org_admin', 'facility_manager', 'auditor')
on conflict (role_template_id, permission_key) do nothing;

create table public.medication_integration_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  credential_id uuid references public.integration_api_credentials(id) on delete restrict,
  name text not null check (length(btrim(name)) between 2 and 120),
  vendor_name text not null check (length(btrim(vendor_name)) between 2 and 120),
  external_facility_id text not null check (length(btrim(external_facility_id)) between 1 and 200),
  status text not null default 'setup_required'
    check (status in ('setup_required', 'active', 'paused', 'error', 'disabled')),
  freshness_threshold_minutes integer not null default 60
    check (freshness_threshold_minutes between 5 and 1440),
  last_sync_started_at timestamptz,
  last_sync_completed_at timestamptz,
  last_sync_receipt_id uuid,
  last_error_code text,
  last_error_message text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, vendor_name, external_facility_id),
  unique (id, organization_id, facility_id)
);
create index medication_integration_sources_health_idx
  on public.medication_integration_sources(facility_id, status, last_sync_completed_at);

create table public.medication_resident_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  resident_id uuid not null references public.residents(id) on delete restrict,
  external_resident_id text not null check (length(btrim(external_resident_id)) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'inactive')),
  mapped_by uuid references public.profiles(id) on delete set null,
  mapped_at timestamptz not null default now(),
  unique (source_id, external_resident_id),
  unique (source_id, resident_id),
  foreign key (source_id, organization_id, facility_id)
    references public.medication_integration_sources(id, organization_id, facility_id) on delete cascade
);
create index medication_resident_mappings_resident_idx
  on public.medication_resident_mappings(resident_id, status);

create table public.external_medication_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  resident_id uuid not null references public.residents(id) on delete restrict,
  external_order_id text not null check (length(btrim(external_order_id)) between 1 and 200),
  medication_display text not null check (length(btrim(medication_display)) between 1 and 300),
  directions text,
  schedule_display text,
  order_status text not null check (order_status in ('active', 'held', 'discontinued', 'completed', 'unknown')),
  effective_from timestamptz,
  effective_through timestamptz,
  source_updated_at timestamptz not null,
  imported_at timestamptz not null default now(),
  raw_record_sha256 text not null check (raw_record_sha256 ~ '^[0-9a-f]{64}$'),
  unique (source_id, external_order_id),
  foreign key (source_id, organization_id, facility_id)
    references public.medication_integration_sources(id, organization_id, facility_id) on delete cascade,
  check (effective_through is null or effective_from is null or effective_through >= effective_from)
);
create index external_medication_orders_resident_idx
  on public.external_medication_orders(resident_id, order_status, source_updated_at desc);

create table public.external_medication_administration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  resident_id uuid not null references public.residents(id) on delete restrict,
  external_order_id text,
  external_event_id text not null check (length(btrim(external_event_id)) between 1 and 200),
  administration_status text not null check (administration_status in (
    'administered', 'refused', 'held', 'missed', 'late', 'not_available', 'documented_in_error'
  )),
  scheduled_at timestamptz,
  occurred_at timestamptz not null,
  administered_by_display text,
  source_note text,
  imported_at timestamptz not null default now(),
  raw_record_sha256 text not null check (raw_record_sha256 ~ '^[0-9a-f]{64}$'),
  unique (source_id, external_event_id),
  foreign key (source_id, organization_id, facility_id)
    references public.medication_integration_sources(id, organization_id, facility_id) on delete cascade
);
create index external_medication_administration_resident_idx
  on public.external_medication_administration_events(resident_id, occurred_at desc);
create index external_medication_administration_exception_idx
  on public.external_medication_administration_events(facility_id, administration_status, occurred_at desc)
  where administration_status <> 'administered';

create table public.medication_integration_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source_id uuid not null,
  command_receipt_id uuid,
  exception_key text not null check (length(btrim(exception_key)) between 1 and 240),
  exception_type text not null check (exception_type in (
    'unmatched_resident', 'invalid_order', 'invalid_administration', 'stale_source', 'sync_failure'
  )),
  severity text not null default 'high' check (severity in ('info', 'medium', 'high', 'urgent')),
  summary text not null check (length(btrim(summary)) between 3 and 500),
  external_resident_id text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, exception_key),
  foreign key (source_id, organization_id, facility_id)
    references public.medication_integration_sources(id, organization_id, facility_id) on delete cascade,
  check ((status in ('resolved', 'dismissed')) = (resolved_at is not null))
);
create index medication_integration_exceptions_queue_idx
  on public.medication_integration_exceptions(facility_id, status, severity, last_seen_at desc);

create or replace function app_private.prevent_external_medication_event_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'External medication administration evidence is append-only' using errcode = '55000';
end;
$$;
revoke all on function app_private.prevent_external_medication_event_mutation() from public, anon, authenticated;
create trigger prevent_external_medication_event_mutation
before update or delete on public.external_medication_administration_events
for each row execute function app_private.prevent_external_medication_event_mutation();

create trigger set_updated_at before update on public.medication_integration_sources
for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.medication_integration_exceptions
for each row execute function public.set_updated_at();

create or replace function app_private.assert_medication_scope(
  p_organization_id uuid, p_facility_id uuid, p_permission_key text
) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() and (
    public.current_org_id() is distinct from p_organization_id
    or not public.is_assigned_to_facility(p_facility_id)
    or not (
      public.current_role() = 'org_admin'
      or public.has_effective_permission(p_permission_key, 'facility', p_facility_id, now())
      or public.has_effective_permission(p_permission_key, 'organization', p_organization_id, now())
    )
  ) then
    raise exception 'Medication integration access denied' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.assert_medication_scope(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.save_medication_integration_source(
  p_facility_id uuid,
  p_name text,
  p_vendor_name text,
  p_external_facility_id text,
  p_credential_id uuid default null,
  p_freshness_threshold_minutes integer default 60,
  p_status text default 'setup_required',
  p_source_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_credential_org uuid;
begin
  select f.organization_id into v_org from public.facilities f where f.id = p_facility_id;
  if v_org is null then raise exception 'Facility not found'; end if;
  perform app_private.assert_medication_scope(v_org, p_facility_id, 'medications.integration.manage');
  if p_credential_id is not null then
    select c.organization_id into v_credential_org from public.integration_api_credentials c
    where c.id = p_credential_id and 'medications:write' = any(c.scopes);
    if v_credential_org is distinct from v_org then
      raise exception 'Credential is not authorized for this organization and medication scope' using errcode = '42501';
    end if;
  end if;
  if p_source_id is null then
    insert into public.medication_integration_sources(
      organization_id, facility_id, credential_id, name, vendor_name,
      external_facility_id, freshness_threshold_minutes, status, created_by
    ) values (
      v_org, p_facility_id, p_credential_id, btrim(p_name), btrim(p_vendor_name),
      btrim(p_external_facility_id), p_freshness_threshold_minutes, p_status, auth.uid()
    ) returning id into v_id;
  else
    update public.medication_integration_sources s set
      credential_id = p_credential_id, name = btrim(p_name), vendor_name = btrim(p_vendor_name),
      external_facility_id = btrim(p_external_facility_id),
      freshness_threshold_minutes = p_freshness_threshold_minutes, status = p_status
    where s.id = p_source_id and s.organization_id = v_org and s.facility_id = p_facility_id
    returning s.id into v_id;
    if v_id is null then raise exception 'Medication source not found'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.map_medication_resident(
  p_source_id uuid, p_resident_id uuid, p_external_resident_id text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_source public.medication_integration_sources%rowtype; v_resident public.residents%rowtype; v_id uuid;
begin
  select * into v_source from public.medication_integration_sources where id = p_source_id;
  select * into v_resident from public.residents where id = p_resident_id;
  if v_source.id is null or v_resident.id is null
     or v_resident.organization_id <> v_source.organization_id
     or v_resident.facility_id <> v_source.facility_id then
    raise exception 'Source and resident scope do not match' using errcode = '23503';
  end if;
  perform app_private.assert_medication_scope(v_source.organization_id, v_source.facility_id, 'medications.integration.manage');
  insert into public.medication_resident_mappings(
    organization_id, facility_id, source_id, resident_id, external_resident_id, mapped_by
  ) values (
    v_source.organization_id, v_source.facility_id, p_source_id, p_resident_id,
    btrim(p_external_resident_id), auth.uid()
  ) on conflict (source_id, external_resident_id) do update set
    resident_id = excluded.resident_id, status = 'active', mapped_by = auth.uid(), mapped_at = now()
  returning id into v_id;
  update public.medication_integration_exceptions set
    status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
    resolution_note = 'Resident mapping completed'
  where source_id = p_source_id and external_resident_id = p_external_resident_id
    and exception_type = 'unmatched_resident' and status not in ('resolved', 'dismissed');
  return v_id;
end;
$$;

create or replace function public.resolve_medication_integration_exception(
  p_exception_id uuid, p_resolution_status text, p_resolution_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_exception public.medication_integration_exceptions%rowtype;
begin
  select * into v_exception from public.medication_integration_exceptions where id = p_exception_id;
  if v_exception.id is null then raise exception 'Medication integration exception not found'; end if;
  perform app_private.assert_medication_scope(
    v_exception.organization_id, v_exception.facility_id, 'medications.integration.manage'
  );
  if p_resolution_status not in ('acknowledged', 'resolved', 'dismissed') then
    raise exception 'Invalid resolution status' using errcode = '22023';
  end if;
  update public.medication_integration_exceptions set
    status = p_resolution_status,
    resolved_at = case when p_resolution_status in ('resolved', 'dismissed') then now() else null end,
    resolved_by = case when p_resolution_status in ('resolved', 'dismissed') then auth.uid() else null end,
    resolution_note = nullif(btrim(p_resolution_note), '')
  where id = p_exception_id;
end;
$$;

create or replace function public.apply_medication_integration_command(p_command_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_command app_private.integration_command_receipts%rowtype;
  v_source public.medication_integration_sources%rowtype;
  v_record jsonb;
  v_resident_id uuid;
  v_orders integer := 0;
  v_events integer := 0;
  v_exceptions integer := 0;
  v_key text;
begin
  select * into v_command from app_private.integration_command_receipts where id = p_command_id for update;
  if v_command.id is null or v_command.command_type <> 'medication.snapshot.import'
     or v_command.schema_version <> '2026-07-14' then
    raise exception 'Invalid medication integration command' using errcode = '22023';
  end if;
  if v_command.status = 'applied' then return coalesce(v_command.result, '{}'::jsonb); end if;
  if v_command.status not in ('accepted', 'processing') then
    raise exception 'Medication command cannot be applied from status %', v_command.status using errcode = '55000';
  end if;
  select * into v_source from public.medication_integration_sources
  where id = (v_command.payload->>'sourceId')::uuid
    and organization_id = v_command.organization_id and credential_id = v_command.credential_id;
  if v_source.id is null or v_source.status not in ('active', 'setup_required') then
    raise exception 'Medication source is unavailable or not bound to this credential' using errcode = '42501';
  end if;
  update app_private.integration_command_receipts set status = 'processing', updated_at = now()
  where id = p_command_id;
  update public.medication_integration_sources set last_sync_started_at = now(), status = 'active',
    last_error_code = null, last_error_message = null where id = v_source.id;

  for v_record in select value from jsonb_array_elements(coalesce(v_command.payload->'orders', '[]'::jsonb)) loop
    select m.resident_id into v_resident_id from public.medication_resident_mappings m
    where m.source_id = v_source.id and m.external_resident_id = v_record->>'externalResidentId' and m.status = 'active';
    if v_resident_id is null then
      v_key := 'resident:' || coalesce(nullif(v_record->>'externalResidentId', ''), 'missing');
      insert into public.medication_integration_exceptions(
        organization_id, facility_id, source_id, command_receipt_id, exception_key,
        exception_type, severity, summary, external_resident_id
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, p_command_id, v_key,
        'unmatched_resident', 'high', 'External medication record cannot be matched to a resident.',
        nullif(v_record->>'externalResidentId', '')
      ) on conflict (source_id, exception_key) do update set
        command_receipt_id = excluded.command_receipt_id, last_seen_at = now(),
        status = 'open', resolved_at = null, resolved_by = null;
      v_exceptions := v_exceptions + 1;
      continue;
    end if;
    begin
      insert into public.external_medication_orders(
        organization_id, facility_id, source_id, resident_id, external_order_id,
        medication_display, directions, schedule_display, order_status,
        effective_from, effective_through, source_updated_at, raw_record_sha256
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, v_resident_id,
        v_record->>'externalOrderId', v_record->>'medicationDisplay',
        nullif(v_record->>'directions', ''), nullif(v_record->>'scheduleDisplay', ''),
        coalesce(nullif(v_record->>'status', ''), 'unknown'),
        nullif(v_record->>'effectiveFrom', '')::timestamptz,
        nullif(v_record->>'effectiveThrough', '')::timestamptz,
        (v_record->>'sourceUpdatedAt')::timestamptz,
        encode(extensions.digest(convert_to(v_record::text, 'UTF8'), 'sha256'), 'hex')
      ) on conflict (source_id, external_order_id) do update set
        resident_id = excluded.resident_id, medication_display = excluded.medication_display,
        directions = excluded.directions, schedule_display = excluded.schedule_display,
        order_status = excluded.order_status, effective_from = excluded.effective_from,
        effective_through = excluded.effective_through, source_updated_at = excluded.source_updated_at,
        imported_at = now(), raw_record_sha256 = excluded.raw_record_sha256
      where public.external_medication_orders.source_updated_at <= excluded.source_updated_at;
      v_orders := v_orders + 1;
    exception when others then
      v_key := 'order:' || coalesce(nullif(v_record->>'externalOrderId', ''), encode(extensions.digest(convert_to(v_record::text, 'UTF8'), 'sha256'), 'hex'));
      insert into public.medication_integration_exceptions(
        organization_id, facility_id, source_id, command_receipt_id, exception_key,
        exception_type, severity, summary, external_resident_id
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, p_command_id, left(v_key, 240),
        'invalid_order', 'high', 'An external medication order failed contract validation.',
        nullif(v_record->>'externalResidentId', '')
      ) on conflict (source_id, exception_key) do update set last_seen_at = now(), status = 'open';
      v_exceptions := v_exceptions + 1;
    end;
  end loop;

  for v_record in select value from jsonb_array_elements(coalesce(v_command.payload->'administrations', '[]'::jsonb)) loop
    select m.resident_id into v_resident_id from public.medication_resident_mappings m
    where m.source_id = v_source.id and m.external_resident_id = v_record->>'externalResidentId' and m.status = 'active';
    if v_resident_id is null then
      v_key := 'resident:' || coalesce(nullif(v_record->>'externalResidentId', ''), 'missing');
      insert into public.medication_integration_exceptions(
        organization_id, facility_id, source_id, command_receipt_id, exception_key,
        exception_type, severity, summary, external_resident_id
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, p_command_id, v_key,
        'unmatched_resident', 'high', 'External medication event cannot be matched to a resident.',
        nullif(v_record->>'externalResidentId', '')
      ) on conflict (source_id, exception_key) do update set last_seen_at = now(), status = 'open';
      v_exceptions := v_exceptions + 1;
      continue;
    end if;
    begin
      insert into public.external_medication_administration_events(
        organization_id, facility_id, source_id, resident_id, external_order_id,
        external_event_id, administration_status, scheduled_at, occurred_at,
        administered_by_display, source_note, raw_record_sha256
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, v_resident_id,
        nullif(v_record->>'externalOrderId', ''), v_record->>'externalEventId',
        v_record->>'status', nullif(v_record->>'scheduledAt', '')::timestamptz,
        (v_record->>'occurredAt')::timestamptz,
        nullif(v_record->>'administeredByDisplay', ''), nullif(v_record->>'note', ''),
        encode(extensions.digest(convert_to(v_record::text, 'UTF8'), 'sha256'), 'hex')
      ) on conflict (source_id, external_event_id) do nothing;
      v_events := v_events + 1;
    exception when others then
      v_key := 'administration:' || coalesce(nullif(v_record->>'externalEventId', ''), encode(extensions.digest(convert_to(v_record::text, 'UTF8'), 'sha256'), 'hex'));
      insert into public.medication_integration_exceptions(
        organization_id, facility_id, source_id, command_receipt_id, exception_key,
        exception_type, severity, summary, external_resident_id
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, p_command_id, left(v_key, 240),
        'invalid_administration', 'urgent', 'An external medication administration event failed contract validation.',
        nullif(v_record->>'externalResidentId', '')
      ) on conflict (source_id, exception_key) do update set last_seen_at = now(), status = 'open';
      v_exceptions := v_exceptions + 1;
    end;
  end loop;

  update public.medication_integration_sources set
    last_sync_completed_at = now(), last_sync_receipt_id = p_command_id,
    status = 'active'
  where id = v_source.id;
  update app_private.integration_command_receipts set
    status = 'applied',
    result = jsonb_build_object('ordersApplied', v_orders, 'eventsApplied', v_events, 'exceptions', v_exceptions),
    updated_at = now()
  where id = p_command_id;
  return jsonb_build_object('ordersApplied', v_orders, 'eventsApplied', v_events, 'exceptions', v_exceptions);
exception when others then
  if v_source.id is not null then
    update public.medication_integration_sources set status = 'error',
      last_error_code = sqlstate, last_error_message = left(sqlerrm, 500) where id = v_source.id;
    insert into public.medication_integration_exceptions(
      organization_id, facility_id, source_id, command_receipt_id, exception_key,
      exception_type, severity, summary
    ) values (
      v_source.organization_id, v_source.facility_id, v_source.id, p_command_id,
      'sync:' || p_command_id::text, 'sync_failure', 'urgent',
      'Medication synchronization failed contract validation and was not applied.'
    ) on conflict (source_id, exception_key) do update set
      last_seen_at = now(), status = 'open', resolved_at = null, resolved_by = null;
  end if;
  if v_command.id is not null then
    update app_private.integration_command_receipts set status = 'rejected',
      result = jsonb_build_object('errorCode', sqlstate, 'message', left(sqlerrm, 500)), updated_at = now()
    where id = v_command.id;
  end if;
  return jsonb_build_object('errorCode', sqlstate, 'message', left(sqlerrm, 500));
end;
$$;

create or replace function public.run_medication_integration_freshness_evaluator(
  p_now timestamptz default now()
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_source public.medication_integration_sources%rowtype; v_count integer := 0;
begin
  for v_source in select * from public.medication_integration_sources where status in ('active', 'error') loop
    if v_source.last_sync_completed_at is null
       or v_source.last_sync_completed_at < p_now - make_interval(mins => v_source.freshness_threshold_minutes) then
      insert into public.medication_integration_exceptions(
        organization_id, facility_id, source_id, exception_key, exception_type, severity, summary
      ) values (
        v_source.organization_id, v_source.facility_id, v_source.id, 'stale:source',
        'stale_source', 'urgent', 'External medication synchronization is outside its configured freshness target.'
      ) on conflict (source_id, exception_key) do update set
        last_seen_at = p_now, status = 'open', resolved_at = null, resolved_by = null;
      v_count := v_count + 1;
    else
      update public.medication_integration_exceptions set
        status = 'resolved', resolved_at = p_now, resolved_by = null,
        resolution_note = 'Automatically resolved after a fresh synchronization.'
      where source_id = v_source.id and exception_key = 'stale:source'
        and status not in ('resolved', 'dismissed');
    end if;
  end loop;
  return v_count;
end;
$$;

do $$ begin
  if exists(select 1 from cron.job where jobname = 'medication-integration-freshness') then
    perform cron.unschedule('medication-integration-freshness');
  end if;
end $$;
select cron.schedule(
  'medication-integration-freshness', '*/15 * * * *',
  'select public.run_medication_integration_freshness_evaluator();'
);

alter table public.medication_integration_sources enable row level security;
alter table public.medication_resident_mappings enable row level security;
alter table public.external_medication_orders enable row level security;
alter table public.external_medication_administration_events enable row level security;
alter table public.medication_integration_exceptions enable row level security;

create policy medication_sources_read on public.medication_integration_sources
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and (public.current_role() in ('org_admin', 'auditor')
      or public.has_effective_permission('medications.integration.read', 'facility', facility_id, now())
      or public.has_effective_permission('medications.integration.read', 'organization', organization_id, now()))
  )
);
create policy medication_mappings_read on public.medication_resident_mappings
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and public.current_role() in ('org_admin', 'auditor', 'facility_manager')
  )
);
create policy external_medication_orders_read on public.external_medication_orders
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and (public.current_role() in ('org_admin', 'auditor')
      or public.has_effective_permission('medications.integration.read', 'facility', facility_id, now()))
  )
);
create policy external_medication_events_read on public.external_medication_administration_events
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and (public.current_role() in ('org_admin', 'auditor')
      or public.has_effective_permission('medications.integration.read', 'facility', facility_id, now()))
  )
);
create policy medication_exceptions_read on public.medication_integration_exceptions
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = public.current_org_id() and public.is_assigned_to_facility(facility_id)
    and (public.current_role() in ('org_admin', 'auditor')
      or public.has_effective_permission('medications.integration.read', 'facility', facility_id, now()))
  )
);

revoke all on table public.medication_integration_sources, public.medication_resident_mappings,
  public.external_medication_orders, public.external_medication_administration_events,
  public.medication_integration_exceptions from public, anon;
grant select on table public.medication_integration_sources, public.medication_resident_mappings,
  public.external_medication_orders, public.external_medication_administration_events,
  public.medication_integration_exceptions to authenticated;
grant select, insert, update on table public.medication_integration_sources,
  public.medication_resident_mappings, public.external_medication_orders,
  public.medication_integration_exceptions to service_role;
grant select, insert on table public.external_medication_administration_events to service_role;

revoke all on function public.save_medication_integration_source(uuid, text, text, text, uuid, integer, text, uuid),
  public.map_medication_resident(uuid, uuid, text),
  public.resolve_medication_integration_exception(uuid, text, text),
  public.apply_medication_integration_command(uuid),
  public.run_medication_integration_freshness_evaluator(timestamptz) from public, anon, authenticated;
grant execute on function public.save_medication_integration_source(uuid, text, text, text, uuid, integer, text, uuid),
  public.map_medication_resident(uuid, uuid, text),
  public.resolve_medication_integration_exception(uuid, text, text) to authenticated;
grant execute on function public.apply_medication_integration_command(uuid) to service_role;
grant execute on function public.run_medication_integration_freshness_evaluator(timestamptz) to service_role;

-- Extend the resident timeline after the medication boundary tables exist.
create or replace function public.get_resident_timeline(
  p_resident_id uuid,
  p_limit integer default 100
)
returns table(
  occurred_at timestamptz,
  event_type text,
  title text,
  status text,
  detail text,
  href text,
  source_id uuid
)
language sql stable security invoker set search_path = '' as $$
  select event.occurred_at, event.event_type, event.title, event.status,
    event.detail, event.href, event.source_id
  from (
    select i.occurred_at, 'incident'::text event_type,
      'Incident: ' || replace(i.incident_type, '_', ' ') title,
      i.status, left(i.narrative, 500) detail,
      '/app/incidents/' || i.id::text href, i.id source_id
    from public.incidents i where i.resident_id = p_resident_id
    union all
    select c.identified_at, 'change_of_condition',
      'Condition change: ' || replace(c.category, '_', ' '), c.status,
      left(c.immediate_observations, 500), '/app/change-of-condition/' || c.id::text, c.id
    from public.resident_change_events c where c.resident_id = p_resident_id
    union all
    select coalesce(s.performed_at, s.scheduled_start), 'resident_service',
      'Service: ' || s.service_name, s.status, left(s.note, 500), '/app/services', s.id
    from public.resident_service_task_instances s where s.resident_id = p_resident_id
    union all
    select co.created_at, 'complaint', 'Complaint: ' || replace(co.category, '_', ' '),
      co.status, left(co.description, 500), '/app/complaints/' || co.id::text, co.id
    from public.complaints co where co.resident_id = p_resident_id
    union all
    select rc.updated_at, 'compliance', 'Compliance: ' || replace(rc.item_type, '_', ' '),
      rc.status, left(rc.notes, 500), '/app/residents/' || rc.resident_id::text, rc.id
    from public.resident_compliance_items rc where rc.resident_id = p_resident_id
    union all
    select d.occurred_at, 'dietary', 'Dietary: ' || replace(d.event_type, '_', ' '),
      null::text, left(d.summary, 500), '/app/dietary-operations?resident=' || d.resident_id::text, d.id
    from public.dietary_operations_history d where d.resident_id = p_resident_id
    union all
    select f.created_at, 'financial', 'Financial: ' || replace(f.event_type, '_', ' '),
      null::text, left(f.summary, 500), '/app/resident-finance?resident=' || f.resident_id::text, f.id
    from public.resident_financial_history f where f.resident_id = p_resident_id
    union all
    select a.occurred_at, 'external_medication',
      'External eMAR: ' || replace(a.administration_status, '_', ' '),
      a.administration_status,
      left(coalesce(o.medication_display, 'Medication administration evidence'), 500),
      '/app/medication-integration?resident=' || a.resident_id::text, a.id
    from public.external_medication_administration_events a
    left join public.external_medication_orders o
      on o.source_id = a.source_id and o.external_order_id = a.external_order_id
    where a.resident_id = p_resident_id
  ) event
  order by event.occurred_at desc, event.source_id
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;
