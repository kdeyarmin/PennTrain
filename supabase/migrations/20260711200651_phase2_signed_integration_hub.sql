-- Phase 2 / recommendation #26: tenant-scoped API credentials and signed,
-- observable webhook delivery. Provider calls are accepted only into a
-- versioned command inbox; they never receive generic table-write access.

create extension if not exists pgcrypto with schema extensions;

create table public.integration_api_scope_definitions (
  scope_key text primary key check (scope_key ~ '^[a-z][a-z0-9_.:-]{1,99}$'),
  description text not null,
  risk_level text not null check (risk_level in ('read', 'write', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.integration_api_scope_definitions (scope_key, description, risk_level)
values
  ('events:read', 'Read versioned tenant event envelopes', 'read'),
  ('entitlements:read', 'Read effective tenant entitlements', 'read'),
  ('commands:write', 'Submit versioned commands to the lifecycle inbox', 'write'),
  ('webhooks:manage', 'Manage tenant webhook endpoints and replay delivery', 'admin')
on conflict (scope_key) do update set
  description = excluded.description,
  risk_level = excluded.risk_level,
  is_active = true;

insert into public.permission_definitions(permission_key, description, risk_level)
values
  ('integrations.api.read', 'Read integration credentials and API state', 'sensitive'),
  ('integrations.api.manage', 'Issue, rotate, and revoke integration credentials', 'privileged'),
  ('integrations.webhooks.read', 'Read webhook endpoints and delivery evidence', 'sensitive'),
  ('integrations.webhooks.manage', 'Manage, test, and replay webhook delivery', 'privileged')
on conflict (permission_key) do nothing;

insert into public.role_template_permissions(role_template_id, permission_key)
select rt.id, p.permission_key
from public.role_templates rt
cross join lateral (
  select unnest(case rt.built_in_role
    when 'platform_admin' then array[
      'integrations.api.read', 'integrations.api.manage',
      'integrations.webhooks.read', 'integrations.webhooks.manage'
    ]::text[]
    when 'org_admin' then array[
      'integrations.api.read', 'integrations.api.manage',
      'integrations.webhooks.read', 'integrations.webhooks.manage'
    ]::text[]
    else array[]::text[]
  end) permission_key
) p
where rt.built_in_role in ('platform_admin', 'org_admin')
on conflict (role_template_id, permission_key) do nothing;

create table public.integration_schema_definitions (
  id uuid primary key default gen_random_uuid(),
  schema_kind text not null check (schema_kind in ('api', 'command', 'event')),
  schema_name text not null check (schema_name ~ '^[a-z][a-z0-9_.:-]{1,149}$'),
  schema_version text not null check (schema_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([.][0-9]+)?$'),
  lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active', 'deprecated', 'retired')),
  json_schema jsonb not null default '{}'::jsonb,
  deprecated_at timestamptz,
  sunset_at timestamptz,
  replacement_schema_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schema_kind, schema_name, schema_version),
  check (sunset_at is null or deprecated_at is null or sunset_at > deprecated_at),
  check (lifecycle_status <> 'retired' or sunset_at is not null)
);

insert into public.integration_schema_definitions (
  schema_kind, schema_name, schema_version, json_schema
)
values
  ('api', 'caremetric.integration-api', '2026-07-11',
   '{"type":"object","required":["data","meta"]}'::jsonb),
  ('command', 'integration.command', '2026-07-11',
   '{"type":"object","required":["schemaVersion","commandType","payload"]}'::jsonb),
  ('event', 'integration.command.accepted', '2026-07-11',
   '{"type":"object","required":["commandId","commandType","status"]}'::jsonb),
  ('event', 'integration.test', '2026-07-11',
   '{"type":"object","required":["test","sentAt"]}'::jsonb)
on conflict (schema_kind, schema_name, schema_version) do nothing;

create or replace function app_private.integration_destination_is_obviously_safe(p_url text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_authority text;
  v_host text;
  v_ip inet;
begin
  if p_url is null or length(p_url) > 2048 or p_url !~ '^https://'
     or p_url ~ '^https://[^/?#]*@' or position('#' in p_url) > 0 then
    return false;
  end if;
  v_authority := substring(p_url from '^https://([^/?#]+)');
  if (v_authority like '[%' and v_authority !~ '^\[[0-9a-fA-F:.%]+\](:443)?$')
     or (v_authority not like '[%' and position(':' in v_authority) > 0
         and v_authority !~ ':443$') then
    return false;
  end if;
  v_host := lower(substring(p_url from '^https://(\[[^]]+\]|[^/:?#]+)'));
  v_host := trim(both '[]' from coalesce(v_host, ''));
  if v_host = '' or v_host = 'localhost' or v_host like '%.localhost'
     or v_host like '%.local' or v_host like '%.internal' then
    return false;
  end if;
  if v_host ~ '^[0-9.]+$' or position(':' in v_host) > 0 then
    begin
      v_ip := v_host::inet;
      if v_ip <<= '0.0.0.0/8'::inet or v_ip <<= '10.0.0.0/8'::inet
         or v_ip <<= '100.64.0.0/10'::inet or v_ip <<= '127.0.0.0/8'::inet
         or v_ip <<= '169.254.0.0/16'::inet or v_ip <<= '172.16.0.0/12'::inet
         or v_ip <<= '192.0.0.0/24'::inet or v_ip <<= '192.0.2.0/24'::inet
         or v_ip <<= '192.168.0.0/16'::inet or v_ip <<= '198.18.0.0/15'::inet
         or v_ip <<= '198.51.100.0/24'::inet or v_ip <<= '203.0.113.0/24'::inet
         or v_ip <<= '224.0.0.0/4'::inet or v_ip <<= '240.0.0.0/4'::inet
         or v_ip <<= '::/128'::inet or v_ip <<= '::1/128'::inet
         or v_ip <<= '100::/64'::inet or v_ip <<= '64:ff9b:1::/48'::inet
         or v_ip <<= 'fc00::/7'::inet or v_ip <<= 'fe80::/10'::inet
         or v_ip <<= '2001:2::/48'::inet or v_ip <<= '2001:10::/28'::inet
         or v_ip <<= '2001:db8::/32'::inet or v_ip <<= 'ff00::/8'::inet then
        return false;
      end if;
    exception when others then
      return false;
    end;
  end if;
  return true;
end;
$$;
revoke all on function app_private.integration_destination_is_obviously_safe(text)
  from public, anon, authenticated;

create table public.integration_api_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  key_prefix text not null unique check (key_prefix ~ '^[0-9a-f]{12}$'),
  scopes text[] not null check (cardinality(scopes) between 1 and 32),
  status text not null default 'active'
    check (status in ('active', 'rotated', 'revoked', 'expired')),
  expires_at timestamptz not null,
  rate_limit_per_minute integer not null default 120
    check (rate_limit_per_minute between 1 and 10000),
  last_used_at timestamptz,
  use_count bigint not null default 0 check (use_count >= 0),
  rotated_from_id uuid references public.integration_api_credentials(id),
  replaced_by_id uuid references public.integration_api_credentials(id),
  created_by uuid references public.profiles(id),
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (expires_at > created_at),
  check ((status = 'revoked') = (revoked_at is not null))
);
create index integration_api_credentials_org_status_idx
  on public.integration_api_credentials(organization_id, status, expires_at);

create table public.integration_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '',
  destination_url text not null
    check (app_private.integration_destination_is_obviously_safe(destination_url)),
  status text not null default 'active' check (status in ('active', 'paused', 'disabled')),
  secret_version integer not null default 1 check (secret_version > 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 20),
  timeout_ms integer not null default 10000 check (timeout_ms between 1000 and 30000),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  created_by uuid references public.profiles(id),
  disabled_by uuid references public.profiles(id),
  disabled_at timestamptz,
  disable_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);
create index integration_webhook_endpoints_dispatch_idx
  on public.integration_webhook_endpoints(status, consecutive_failures)
  where status = 'active';

create table public.integration_webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  endpoint_id uuid not null,
  event_type text not null check (event_type = '*' or event_type ~ '^[a-z][a-z0-9_.:-]{1,149}$'),
  event_schema_version text not null default '2026-07-11',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint_id, event_type, event_schema_version),
  foreign key (endpoint_id, organization_id)
    references public.integration_webhook_endpoints(id, organization_id) on delete cascade
);
create index integration_webhook_subscriptions_event_idx
  on public.integration_webhook_subscriptions(event_type, is_active)
  where is_active;

create table public.integration_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  endpoint_id uuid not null,
  event_id uuid not null,
  event_sequence bigint not null check (event_sequence > 0),
  event_type text not null,
  event_schema_version text not null,
  correlation_id text not null,
  payload jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'delivered', 'dead_letter', 'canceled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  last_http_status integer,
  last_error_code text,
  last_error_message text,
  replay_count integer not null default 0 check (replay_count >= 0),
  replay_of_delivery_id uuid references public.integration_webhook_deliveries(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint_id, event_id, replay_count),
  foreign key (endpoint_id, organization_id)
    references public.integration_webhook_endpoints(id, organization_id) on delete cascade,
  check ((status = 'processing' and locked_at is not null) or status <> 'processing')
);
create index integration_webhook_deliveries_claim_idx
  on public.integration_webhook_deliveries(available_at, created_at)
  where status in ('pending', 'retry');
create index integration_webhook_deliveries_org_status_idx
  on public.integration_webhook_deliveries(organization_id, status, created_at desc);

create table public.integration_webhook_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_id uuid not null references public.integration_webhook_deliveries(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  request_timestamp bigint not null,
  request_signature_version integer not null check (request_signature_version > 0),
  response_http_status integer,
  response_sha256 text check (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('delivered', 'retry', 'dead_letter')),
  error_code text,
  error_message text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  unique (delivery_id, attempt_number)
);
create index integration_webhook_attempts_org_created_idx
  on public.integration_webhook_delivery_attempts(organization_id, created_at desc);

create or replace function app_private.prevent_integration_attempt_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Integration delivery attempts are append-only evidence'
    using errcode = '55000';
end;
$$;
revoke all on function app_private.prevent_integration_attempt_mutation()
  from public, anon, authenticated;
create trigger prevent_integration_attempt_mutation
before update or delete on public.integration_webhook_delivery_attempts
for each row execute function app_private.prevent_integration_attempt_mutation();

create table app_private.integration_api_credential_hashes (
  credential_id uuid primary key references public.integration_api_credentials(id) on delete cascade,
  secret_sha256 text not null unique check (secret_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table app_private.integration_credential_use_events (
  id bigint generated always as identity primary key,
  credential_id uuid not null references public.integration_api_credentials(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  required_scope text,
  correlation_id text,
  used_at timestamptz not null default now()
);
create index integration_credential_use_events_credential_idx
  on app_private.integration_credential_use_events(credential_id, used_at desc);

create table app_private.integration_rate_limit_windows (
  credential_id uuid not null references public.integration_api_credentials(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (credential_id, window_started_at)
);

create table app_private.integration_command_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  credential_id uuid not null references public.integration_api_credentials(id) on delete restrict,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  command_type text not null check (command_type ~ '^[a-z][a-z0-9_.:-]{1,149}$'),
  schema_version text not null,
  payload jsonb not null,
  correlation_id text not null,
  status text not null default 'accepted'
    check (status in ('accepted', 'processing', 'applied', 'rejected', 'dead_letter')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (credential_id, idempotency_key)
);
create index integration_command_receipts_org_created_idx
  on app_private.integration_command_receipts(organization_id, created_at desc);

create table app_private.integration_event_log (
  sequence_number bigint generated always as identity primary key,
  event_id uuid not null unique default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.:-]{1,149}$'),
  event_schema_version text not null,
  occurred_at timestamptz not null default now(),
  correlation_id text not null,
  causation_id text,
  actor_subject text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index integration_event_log_tenant_cursor_idx
  on app_private.integration_event_log(organization_id, sequence_number);

create table app_private.integration_endpoint_secrets (
  endpoint_id uuid primary key references public.integration_webhook_endpoints(id) on delete cascade,
  vault_secret_id uuid not null,
  previous_vault_secret_id uuid,
  previous_valid_until timestamptz,
  secret_version integer not null default 1,
  rotated_at timestamptz not null default now()
);

alter table app_private.integration_api_credential_hashes enable row level security;
alter table app_private.integration_credential_use_events enable row level security;
alter table app_private.integration_rate_limit_windows enable row level security;
alter table app_private.integration_command_receipts enable row level security;
alter table app_private.integration_event_log enable row level security;
alter table app_private.integration_endpoint_secrets enable row level security;
revoke all on table app_private.integration_api_credential_hashes,
  app_private.integration_credential_use_events,
  app_private.integration_rate_limit_windows,
  app_private.integration_command_receipts,
  app_private.integration_event_log,
  app_private.integration_endpoint_secrets from public, anon, authenticated;
grant select, insert on table app_private.integration_api_credential_hashes,
  app_private.integration_credential_use_events,
  app_private.integration_event_log to service_role;
grant select, insert, update, delete on table app_private.integration_rate_limit_windows
  to service_role;
grant select, insert, update on table app_private.integration_command_receipts,
  app_private.integration_endpoint_secrets to service_role;

create or replace function app_private.assert_integration_admin(
  p_organization_id uuid,
  p_permission_key text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_permission_key not in ('integrations.api.manage', 'integrations.webhooks.manage') then
    raise exception 'Unknown integration administration permission'
      using errcode = '22023';
  end if;
  if auth.uid() is null then
    if coalesce(auth.jwt()->>'role', '') = 'service_role' then return; end if;
    raise exception 'An authenticated administrator is required' using errcode = '42501';
  end if;
  perform public.assert_identity_assurance('integration_admin');
  if public.is_platform_admin() then return; end if;
  if public.current_org_id() <> p_organization_id or not (
    public.current_role() = 'org_admin'
    or public.has_effective_permission(p_permission_key, 'organization', p_organization_id, now())
  ) then
    raise exception 'Integration administration is outside caller scope' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.assert_integration_admin(uuid, text)
  from public, anon, authenticated;

create or replace function app_private.validate_integration_scopes(p_scopes text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_scopes is null or cardinality(p_scopes) = 0
     or exists (
       select 1 from unnest(p_scopes) s
       where not exists (
         select 1 from public.integration_api_scope_definitions d
         where d.scope_key = s and d.is_active
       )
     ) then
    raise exception 'One or more integration scopes are invalid' using errcode = '22023';
  end if;
end;
$$;
revoke all on function app_private.validate_integration_scopes(text[])
  from public, anon, authenticated;

create or replace function public.issue_integration_api_credential(
  p_organization_id uuid,
  p_name text,
  p_scopes text[],
  p_expires_at timestamptz,
  p_rate_limit_per_minute integer default 120
)
returns table (
  credential_id uuid,
  key_prefix text,
  plaintext_key text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_prefix text := encode(extensions.gen_random_bytes(6), 'hex');
  v_plaintext text;
begin
  perform app_private.assert_integration_admin(p_organization_id, 'integrations.api.manage');
  perform app_private.validate_integration_scopes(p_scopes);
  if not (
    public.evaluate_feature_access(
      p_organization_id, 'integrations.api', 1, now()
    )->>'allowed'
  )::boolean then
    raise exception 'Integration API is not entitled and released for this organization'
      using errcode = '42501';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '2 years' then
    raise exception 'Credential expiry must be within the next two years' using errcode = '22023';
  end if;
  v_plaintext := 'cmt_live_' || v_prefix || '.' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.integration_api_credentials (
    id, organization_id, name, key_prefix, scopes, expires_at,
    rate_limit_per_minute, created_by
  ) values (
    v_id, p_organization_id, trim(p_name), v_prefix,
    array(select distinct s from unnest(p_scopes) s order by s),
    p_expires_at, p_rate_limit_per_minute, auth.uid()
  );
  insert into app_private.integration_api_credential_hashes (credential_id, secret_sha256)
  values (v_id, encode(extensions.digest(convert_to(v_plaintext, 'UTF8'), 'sha256'), 'hex'));
  insert into public.audit_logs (
    organization_id, actor_profile_id, actor_subject_id, entity_type, entity_id,
    action, source, request_id, correlation_id, new_values
  ) values (
    p_organization_id, auth.uid(), auth.uid()::text, 'integration_api_credentials', v_id::text,
    'integration_credential_issued', 'rpc', 'credential:' || v_id,
    'credential:' || v_id, jsonb_build_object('name', trim(p_name), 'scopes', p_scopes,
      'expiresAt', p_expires_at, 'keyPrefix', v_prefix)
  );
  return query select v_id, v_prefix, v_plaintext, p_expires_at;
end;
$$;

create or replace function public.rotate_integration_api_credential(
  p_credential_id uuid,
  p_expires_at timestamptz default null
)
returns table (
  credential_id uuid,
  key_prefix text,
  plaintext_key text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.integration_api_credentials%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_prefix text := encode(extensions.gen_random_bytes(6), 'hex');
  v_plaintext text;
  v_expiry timestamptz;
begin
  select * into v_old from public.integration_api_credentials
  where id = p_credential_id for update;
  if not found then raise exception 'Credential not found' using errcode = 'P0002'; end if;
  perform app_private.assert_integration_admin(v_old.organization_id, 'integrations.api.manage');
  if v_old.status <> 'active' or v_old.expires_at <= now() then
    raise exception 'Only an active credential can be rotated' using errcode = '55000';
  end if;
  v_expiry := coalesce(p_expires_at, v_old.expires_at);
  if v_expiry <= now() or v_expiry > now() + interval '2 years' then
    raise exception 'Credential expiry must be within the next two years' using errcode = '22023';
  end if;
  v_plaintext := 'cmt_live_' || v_prefix || '.' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.integration_api_credentials (
    id, organization_id, name, key_prefix, scopes, expires_at,
    rate_limit_per_minute, rotated_from_id, created_by
  ) values (
    v_new_id, v_old.organization_id, v_old.name, v_prefix, v_old.scopes,
    v_expiry, v_old.rate_limit_per_minute, v_old.id, auth.uid()
  );
  insert into app_private.integration_api_credential_hashes (credential_id, secret_sha256)
  values (v_new_id, encode(extensions.digest(convert_to(v_plaintext, 'UTF8'), 'sha256'), 'hex'));
  update public.integration_api_credentials
  set status = 'rotated', replaced_by_id = v_new_id, updated_at = now()
  where id = v_old.id;
  insert into public.audit_logs (
    organization_id, actor_profile_id, actor_subject_id, entity_type, entity_id,
    action, source, request_id, correlation_id, old_values, new_values
  ) values (
    v_old.organization_id, auth.uid(), auth.uid()::text, 'integration_api_credentials', v_old.id::text,
    'integration_credential_rotated', 'rpc', 'credential-rotation:' || v_new_id,
    'credential-rotation:' || v_new_id,
    jsonb_build_object('keyPrefix', v_old.key_prefix),
    jsonb_build_object('replacementCredentialId', v_new_id, 'keyPrefix', v_prefix)
  );
  return query select v_new_id, v_prefix, v_plaintext, v_expiry;
end;
$$;

create or replace function public.revoke_integration_api_credential(
  p_credential_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.integration_api_credentials%rowtype;
begin
  select * into v_row from public.integration_api_credentials
  where id = p_credential_id for update;
  if not found then raise exception 'Credential not found' using errcode = 'P0002'; end if;
  perform app_private.assert_integration_admin(v_row.organization_id, 'integrations.api.manage');
  if nullif(trim(p_reason), '') is null then
    raise exception 'A revocation reason is required' using errcode = '22023';
  end if;
  if v_row.status = 'revoked' then return; end if;
  update public.integration_api_credentials
  set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
      revocation_reason = left(trim(p_reason), 500), updated_at = now()
  where id = p_credential_id;
  insert into public.audit_logs (
    organization_id, actor_profile_id, actor_subject_id, entity_type, entity_id,
    action, source, request_id, correlation_id, new_values
  ) values (
    v_row.organization_id, auth.uid(), auth.uid()::text, 'integration_api_credentials', v_row.id::text,
    'integration_credential_revoked', 'rpc', 'credential-revocation:' || v_row.id,
    'credential-revocation:' || v_row.id, jsonb_build_object('reason', left(trim(p_reason), 500))
  );
end;
$$;

create or replace function public.authenticate_integration_api_credential(
  p_secret_sha256 text,
  p_required_scope text default null,
  p_correlation_id text default null
)
returns table (
  credential_id uuid,
  organization_id uuid,
  scopes text[],
  rate_limit_per_minute integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_credential public.integration_api_credentials%rowtype;
begin
  select c.* into v_credential
  from app_private.integration_api_credential_hashes h
  join public.integration_api_credentials c on c.id = h.credential_id
  where h.secret_sha256 = p_secret_sha256
  for update of c;
  if not found or v_credential.status <> 'active' or v_credential.expires_at <= now()
     or (p_required_scope is not null and not (p_required_scope = any(v_credential.scopes))) then
    return;
  end if;
  if not (
    public.evaluate_feature_access(
      v_credential.organization_id, 'integrations.api', 1, now()
    )->>'allowed'
  )::boolean then
    return;
  end if;
  update public.integration_api_credentials
  set last_used_at = now(), use_count = use_count + 1, updated_at = now()
  where id = v_credential.id;
  insert into app_private.integration_credential_use_events (
    credential_id, organization_id, required_scope, correlation_id
  ) values (
    v_credential.id, v_credential.organization_id, p_required_scope,
    left(nullif(p_correlation_id, ''), 200)
  );
  return query select v_credential.id, v_credential.organization_id,
    v_credential.scopes, v_credential.rate_limit_per_minute, v_credential.expires_at;
end;
$$;

create or replace function public.consume_integration_rate_limit(
  p_credential_id uuid,
  p_cost integer default 1
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_window timestamptz := date_trunc('minute', clock_timestamp());
  v_count integer;
begin
  if p_cost < 1 or p_cost > 100 then raise exception 'Invalid rate-limit cost'; end if;
  select c.rate_limit_per_minute into v_limit
  from public.integration_api_credentials c
  where c.id = p_credential_id and c.status = 'active' and c.expires_at > now();
  if v_limit is null then return query select false, 0, v_window + interval '1 minute'; return; end if;
  insert into app_private.integration_rate_limit_windows (
    credential_id, window_started_at, request_count
  ) values (p_credential_id, v_window, p_cost)
  on conflict (credential_id, window_started_at) do update
    set request_count = app_private.integration_rate_limit_windows.request_count + excluded.request_count
  returning request_count into v_count;
  return query select v_count <= v_limit, greatest(v_limit - v_count, 0),
    v_window + interval '1 minute';
end;
$$;

create or replace function public.accept_integration_command(
  p_credential_id uuid,
  p_idempotency_key text,
  p_request_sha256 text,
  p_command_type text,
  p_schema_version text,
  p_payload jsonb,
  p_correlation_id text
)
returns table (
  command_id uuid,
  command_status text,
  was_duplicate boolean,
  correlation_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential public.integration_api_credentials%rowtype;
  v_receipt app_private.integration_command_receipts%rowtype;
begin
  select * into v_credential from public.integration_api_credentials
  where id = p_credential_id and status = 'active' and expires_at > now();
  if not found or not ('commands:write' = any(v_credential.scopes)) then
    raise exception 'Credential is not authorized for commands' using errcode = '42501';
  end if;
  if p_schema_version <> '2026-07-11' or p_request_sha256 !~ '^[0-9a-f]{64}$'
     or nullif(trim(p_correlation_id), '') is null then
    raise exception 'Invalid versioned command envelope' using errcode = '22023';
  end if;
  insert into app_private.integration_command_receipts (
    organization_id, credential_id, idempotency_key, request_sha256,
    command_type, schema_version, payload, correlation_id
  ) values (
    v_credential.organization_id, p_credential_id, left(p_idempotency_key, 200),
    p_request_sha256, p_command_type, p_schema_version, coalesce(p_payload, '{}'::jsonb),
    left(p_correlation_id, 200)
  ) on conflict (credential_id, idempotency_key) do nothing
  returning * into v_receipt;
  if v_receipt.id is null then
    select * into v_receipt from app_private.integration_command_receipts
    where credential_id = p_credential_id and idempotency_key = p_idempotency_key;
    if v_receipt.request_sha256 <> p_request_sha256 then
      raise exception 'Idempotency key was reused with different command content'
        using errcode = '23505';
    end if;
    return query select v_receipt.id, v_receipt.status, true, v_receipt.correlation_id;
    return;
  end if;
  insert into app_private.integration_event_log (
    organization_id, event_type, event_schema_version, correlation_id,
    causation_id, actor_subject, payload
  ) values (
    v_credential.organization_id, 'integration.command.accepted', '2026-07-11',
    v_receipt.correlation_id, v_receipt.id::text, 'api_credential:' || p_credential_id,
    jsonb_build_object('commandId', v_receipt.id, 'commandType', p_command_type,
      'status', 'accepted')
  );
  return query select v_receipt.id, v_receipt.status, false, v_receipt.correlation_id;
end;
$$;

create or replace function public.list_integration_events(
  p_credential_id uuid,
  p_after_sequence bigint default 0,
  p_limit integer default 100
)
returns table (
  sequence_number bigint,
  event_id uuid,
  event_type text,
  event_schema_version text,
  occurred_at timestamptz,
  correlation_id text,
  causation_id text,
  payload jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org_id uuid;
begin
  select c.organization_id into v_org_id
  from public.integration_api_credentials c
  where c.id = p_credential_id and c.status = 'active' and c.expires_at > now()
    and 'events:read' = any(c.scopes);
  if v_org_id is null then raise exception 'Credential cannot read events' using errcode = '42501'; end if;
  return query
  select e.sequence_number, e.event_id, e.event_type, e.event_schema_version,
    e.occurred_at, e.correlation_id, e.causation_id, e.payload
  from app_private.integration_event_log e
  where e.organization_id = v_org_id and e.sequence_number > greatest(p_after_sequence, 0)
  order by e.sequence_number
  limit least(greatest(p_limit, 1), 200);
end;
$$;

create or replace function app_private.fan_out_integration_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_envelope jsonb;
begin
  v_envelope := jsonb_build_object(
    'schemaVersion', new.event_schema_version,
    'eventId', new.event_id,
    'eventType', new.event_type,
    'occurredAt', new.occurred_at,
    'organizationId', new.organization_id,
    'correlationId', new.correlation_id,
    'causationId', new.causation_id,
    'data', new.payload
  );
  insert into public.integration_webhook_deliveries (
    organization_id, endpoint_id, event_id, event_sequence, event_type,
    event_schema_version, correlation_id, payload, payload_sha256, max_attempts
  )
  select
    s.organization_id, s.endpoint_id, new.event_id, new.sequence_number,
    new.event_type, new.event_schema_version, new.correlation_id, v_envelope,
    encode(extensions.digest(convert_to(v_envelope::text, 'UTF8'), 'sha256'), 'hex'),
    e.max_attempts
  from public.integration_webhook_subscriptions s
  join public.integration_webhook_endpoints e on e.id = s.endpoint_id
  where s.organization_id = new.organization_id
    and s.is_active and e.status = 'active'
    and (s.event_type = '*' or s.event_type = new.event_type)
    and s.event_schema_version = new.event_schema_version
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function app_private.fan_out_integration_event()
  from public, anon, authenticated;
create trigger fan_out_integration_event
after insert on app_private.integration_event_log
for each row execute function app_private.fan_out_integration_event();

create or replace function public.create_integration_webhook_endpoint(
  p_organization_id uuid,
  p_name text,
  p_destination_url text,
  p_event_types text[],
  p_description text default ''
)
returns table (
  endpoint_id uuid,
  plaintext_signing_secret text,
  secret_version integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint_id uuid := gen_random_uuid();
  v_secret text := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
  v_vault_id uuid;
begin
  perform app_private.assert_integration_admin(p_organization_id, 'integrations.webhooks.manage');
  if not (
    public.evaluate_feature_access(
      p_organization_id, 'integrations.webhooks', 1, now()
    )->>'allowed'
  )::boolean then
    raise exception 'Integration webhooks are not entitled and released for this organization'
      using errcode = '42501';
  end if;
  if not app_private.integration_destination_is_obviously_safe(p_destination_url)
     or cardinality(p_event_types) between 1 and 50 is not true
     or exists (select 1 from unnest(p_event_types) t
       where t <> '*' and t !~ '^[a-z][a-z0-9_.:-]{1,149}$') then
    raise exception 'Invalid webhook endpoint contract' using errcode = '22023';
  end if;
  select vault.create_secret(
    v_secret, 'integration_webhook_' || v_endpoint_id,
    'CareMetric Train tenant webhook signing secret'
  ) into v_vault_id;
  insert into public.integration_webhook_endpoints (
    id, organization_id, name, description, destination_url, created_by
  ) values (
    v_endpoint_id, p_organization_id, trim(p_name), coalesce(p_description, ''),
    p_destination_url, auth.uid()
  );
  insert into app_private.integration_endpoint_secrets (
    endpoint_id, vault_secret_id
  ) values (v_endpoint_id, v_vault_id);
  insert into public.integration_webhook_subscriptions (
    organization_id, endpoint_id, event_type, created_by
  ) select p_organization_id, v_endpoint_id, distinct_type, auth.uid()
    from (select distinct unnest(p_event_types) as distinct_type) x;
  return query select v_endpoint_id, v_secret, 1;
end;
$$;

create or replace function public.rotate_integration_webhook_secret(p_endpoint_id uuid)
returns table (
  endpoint_id uuid,
  plaintext_signing_secret text,
  secret_version integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint public.integration_webhook_endpoints%rowtype;
  v_secrets app_private.integration_endpoint_secrets%rowtype;
  v_secret text := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
  v_vault_id uuid;
  v_version integer;
begin
  select * into v_endpoint from public.integration_webhook_endpoints
  where id = p_endpoint_id for update;
  if not found then raise exception 'Endpoint not found' using errcode = 'P0002'; end if;
  perform app_private.assert_integration_admin(v_endpoint.organization_id, 'integrations.webhooks.manage');
  select s.* into v_secrets from app_private.integration_endpoint_secrets s
  where s.endpoint_id = p_endpoint_id for update;
  v_version := v_endpoint.secret_version + 1;
  select vault.create_secret(
    v_secret, 'integration_webhook_' || p_endpoint_id || '_v' || v_version,
    'Rotated CareMetric Train tenant webhook signing secret'
  ) into v_vault_id;
  update app_private.integration_endpoint_secrets s
  set previous_vault_secret_id = vault_secret_id,
      previous_valid_until = now() + interval '15 minutes',
      vault_secret_id = v_vault_id, secret_version = v_version, rotated_at = now()
  where s.endpoint_id = p_endpoint_id;
  update public.integration_webhook_endpoints e
  set secret_version = v_version, updated_at = now()
  where e.id = p_endpoint_id;
  return query select p_endpoint_id, v_secret, v_version;
end;
$$;

create or replace function public.deactivate_integration_webhook_endpoint(
  p_endpoint_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_endpoint public.integration_webhook_endpoints%rowtype;
begin
  select * into v_endpoint from public.integration_webhook_endpoints
  where id = p_endpoint_id for update;
  if not found then raise exception 'Endpoint not found' using errcode = 'P0002'; end if;
  perform app_private.assert_integration_admin(v_endpoint.organization_id, 'integrations.webhooks.manage');
  if nullif(trim(p_reason), '') is null then raise exception 'Disable reason required'; end if;
  update public.integration_webhook_endpoints
  set status = 'disabled', disabled_at = now(), disabled_by = auth.uid(),
      disable_reason = left(trim(p_reason), 500), updated_at = now()
  where id = p_endpoint_id;
  update public.integration_webhook_deliveries
  set status = 'canceled', locked_at = null, updated_at = now()
  where endpoint_id = p_endpoint_id and status in ('pending', 'retry', 'processing');
end;
$$;

create or replace function public.enqueue_integration_test_delivery(
  p_endpoint_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint public.integration_webhook_endpoints%rowtype;
  v_event app_private.integration_event_log%rowtype;
  v_delivery_id uuid;
  v_envelope jsonb;
begin
  select * into v_endpoint from public.integration_webhook_endpoints
  where id = p_endpoint_id and status = 'active';
  if not found then raise exception 'Active endpoint not found' using errcode = 'P0002'; end if;
  perform app_private.assert_integration_admin(v_endpoint.organization_id, 'integrations.webhooks.manage');
  insert into app_private.integration_event_log (
    organization_id, event_type, event_schema_version, correlation_id,
    actor_subject, payload
  ) values (
    v_endpoint.organization_id, 'integration.test', '2026-07-11',
    'integration-test:' || gen_random_uuid(), coalesce(auth.uid()::text, 'service_role'),
    jsonb_build_object('test', true, 'sentAt', now(), 'payload', coalesce(p_payload, '{}'::jsonb))
  ) returning * into v_event;
  select d.id into v_delivery_id from public.integration_webhook_deliveries d
  where d.endpoint_id = p_endpoint_id and d.event_id = v_event.event_id;
  if v_delivery_id is null then
    v_envelope := jsonb_build_object(
      'schemaVersion', v_event.event_schema_version, 'eventId', v_event.event_id,
      'eventType', v_event.event_type, 'occurredAt', v_event.occurred_at,
      'organizationId', v_event.organization_id, 'correlationId', v_event.correlation_id,
      'data', v_event.payload
    );
    insert into public.integration_webhook_deliveries (
      organization_id, endpoint_id, event_id, event_sequence, event_type,
      event_schema_version, correlation_id, payload, payload_sha256, max_attempts
    ) values (
      v_endpoint.organization_id, p_endpoint_id, v_event.event_id,
      v_event.sequence_number, v_event.event_type, v_event.event_schema_version,
      v_event.correlation_id, v_envelope,
      encode(extensions.digest(convert_to(v_envelope::text, 'UTF8'), 'sha256'), 'hex'),
      v_endpoint.max_attempts
    ) returning id into v_delivery_id;
  end if;
  return v_delivery_id;
end;
$$;

create or replace function public.replay_integration_webhook_delivery(
  p_delivery_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.integration_webhook_deliveries%rowtype;
  v_replay_id uuid;
  v_next_replay_count integer;
begin
  select * into v_delivery from public.integration_webhook_deliveries
  where id = p_delivery_id for update;
  if not found then raise exception 'Delivery not found' using errcode = 'P0002'; end if;
  perform app_private.assert_integration_admin(v_delivery.organization_id, 'integrations.webhooks.manage');
  if nullif(trim(p_reason), '') is null then raise exception 'Replay reason required'; end if;
  if v_delivery.status not in ('dead_letter', 'delivered', 'canceled') then
    raise exception 'Only terminal deliveries can be replayed' using errcode = '55000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_delivery.endpoint_id::text || ':' || v_delivery.event_id::text, 0)
  );
  select coalesce(max(d.replay_count), 0) + 1 into v_next_replay_count
  from public.integration_webhook_deliveries d
  where d.endpoint_id = v_delivery.endpoint_id and d.event_id = v_delivery.event_id;
  insert into public.integration_webhook_deliveries (
    organization_id, endpoint_id, event_id, event_sequence, event_type,
    event_schema_version, correlation_id, payload, payload_sha256, max_attempts,
    replay_count, replay_of_delivery_id
  ) values (
    v_delivery.organization_id, v_delivery.endpoint_id, v_delivery.event_id,
    v_delivery.event_sequence, v_delivery.event_type, v_delivery.event_schema_version,
    v_delivery.correlation_id, v_delivery.payload, v_delivery.payload_sha256,
    v_delivery.max_attempts, v_next_replay_count,
    coalesce(v_delivery.replay_of_delivery_id, v_delivery.id)
  ) returning id into v_replay_id;
  insert into public.audit_logs (
    organization_id, actor_profile_id, actor_subject_id, entity_type, entity_id,
    action, source, request_id, correlation_id, new_values
  ) values (
    v_delivery.organization_id, auth.uid(), auth.uid()::text,
    'integration_webhook_deliveries', p_delivery_id::text,
    'integration_webhook_replayed', 'rpc', 'webhook-replay:' || p_delivery_id,
    v_delivery.correlation_id, jsonb_build_object('reason', left(trim(p_reason), 500))
  );
  return v_replay_id;
end;
$$;

create or replace function public.claim_integration_webhook_deliveries(
  p_batch_size integer default 50,
  p_endpoint_id uuid default null,
  p_delivery_id uuid default null,
  p_stale_after_seconds integer default 300
)
returns table (
  delivery_id uuid,
  organization_id uuid,
  endpoint_id uuid,
  destination_url text,
  event_id uuid,
  request_body jsonb,
  plaintext_signing_secret text,
  attempt_number integer,
  max_attempts integer,
  timeout_ms integer,
  correlation_id text,
  event_schema_version text
)
language sql
security definer
set search_path = ''
as $$
  with stale_leases as materialized (
    select d.*
    from public.integration_webhook_deliveries d
    join public.integration_webhook_endpoints e on e.id = d.endpoint_id
    where d.status = 'processing'
      and d.locked_at <= now() - pg_catalog.make_interval(
        secs => least(greatest(p_stale_after_seconds, 30), 3600)
      )
      and e.status = 'active'
      and (p_endpoint_id is null or d.endpoint_id = p_endpoint_id)
      and (p_delivery_id is null or d.id = p_delivery_id)
    order by d.locked_at, d.created_at
    limit least(greatest(p_batch_size, 1), 100)
    for update of d skip locked
  ), abandoned_attempts as (
    insert into public.integration_webhook_delivery_attempts (
      organization_id, delivery_id, attempt_number, request_timestamp,
      request_signature_version, outcome, error_code, error_message
    )
    select
      s.organization_id, s.id, s.attempt_count,
      greatest(extract(epoch from s.locked_at)::bigint, 0), 1,
      case when s.attempt_count < s.max_attempts then 'retry' else 'dead_letter' end,
      'worker_lease_expired',
      'The dispatcher lease expired before the worker recorded an outcome'
    from stale_leases s
    on conflict (delivery_id, attempt_number) do nothing
    returning delivery_id
  ), exhausted_stale_leases as (
    update public.integration_webhook_deliveries d
    set status = 'dead_letter', locked_at = null, dead_lettered_at = now(),
        last_error_code = 'worker_lease_expired',
        last_error_message = 'The final dispatcher lease expired before completion',
        updated_at = now()
    from stale_leases s
    where d.id = s.id and s.attempt_count >= s.max_attempts
    returning d.id
  ), candidates as (
    select d.id
    from public.integration_webhook_deliveries d
    join public.integration_webhook_endpoints e on e.id = d.endpoint_id
    where (
        (d.status in ('pending', 'retry') and d.available_at <= now())
        or exists (
          select 1 from stale_leases s
          where s.id = d.id and s.attempt_count < s.max_attempts
        )
      )
      and e.status = 'active'
      and (public.evaluate_feature_access(
        d.organization_id, 'integrations.webhooks', 1, now()
      )->>'allowed')::boolean
      and (p_endpoint_id is null or d.endpoint_id = p_endpoint_id)
      and (p_delivery_id is null or d.id = p_delivery_id)
    order by d.available_at, d.created_at
    limit least(greatest(p_batch_size, 1), 100)
    for update of d skip locked
  ), claimed as (
    update public.integration_webhook_deliveries d
    set status = 'processing', attempt_count = d.attempt_count + 1,
        locked_at = now(), updated_at = now()
    from candidates c where d.id = c.id
    returning d.*
  )
  select c.id, c.organization_id, c.endpoint_id, e.destination_url, c.event_id, c.payload,
    v.decrypted_secret, c.attempt_count, c.max_attempts, e.timeout_ms,
    c.correlation_id, c.event_schema_version
  from claimed c
  join public.integration_webhook_endpoints e on e.id = c.endpoint_id
  join app_private.integration_endpoint_secrets s on s.endpoint_id = c.endpoint_id
  join vault.decrypted_secrets v on v.id = s.vault_secret_id;
$$;

create or replace function public.complete_integration_webhook_delivery(
  p_delivery_id uuid,
  p_attempt_number integer,
  p_success boolean,
  p_http_status integer,
  p_response_sha256 text,
  p_error_code text,
  p_error_message text,
  p_retryable boolean,
  p_duration_ms integer,
  p_request_timestamp bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.integration_webhook_deliveries%rowtype;
  v_outcome text;
  v_next timestamptz;
begin
  select * into v_delivery from public.integration_webhook_deliveries
  where id = p_delivery_id for update;
  if not found or v_delivery.status <> 'processing'
     or v_delivery.attempt_count <> p_attempt_number then
    raise exception 'Delivery attempt is not current' using errcode = '55000';
  end if;
  if p_success then
    v_outcome := 'delivered';
  elsif p_retryable and v_delivery.attempt_count < v_delivery.max_attempts then
    v_outcome := 'retry';
    v_next := now() + least(interval '6 hours',
      interval '15 seconds' * power(2::numeric, least(v_delivery.attempt_count - 1, 10)));
  else
    v_outcome := 'dead_letter';
  end if;
  insert into public.integration_webhook_delivery_attempts (
    organization_id, delivery_id, attempt_number, request_timestamp,
    request_signature_version, response_http_status, response_sha256,
    outcome, error_code, error_message, duration_ms
  ) values (
    v_delivery.organization_id, p_delivery_id, p_attempt_number,
    p_request_timestamp, 1, p_http_status, p_response_sha256, v_outcome,
    left(p_error_code, 100), left(p_error_message, 1000), p_duration_ms
  ) on conflict (delivery_id, attempt_number) do nothing;
  update public.integration_webhook_deliveries
  set status = v_outcome,
      available_at = coalesce(v_next, available_at),
      locked_at = null,
      delivered_at = case when v_outcome = 'delivered' then now() else delivered_at end,
      dead_lettered_at = case when v_outcome = 'dead_letter' then now() else null end,
      last_http_status = p_http_status,
      last_error_code = case when v_outcome = 'delivered' then null else left(p_error_code, 100) end,
      last_error_message = case when v_outcome = 'delivered' then null else left(p_error_message, 1000) end,
      updated_at = now()
  where id = p_delivery_id;
  update public.integration_webhook_endpoints
  set last_success_at = case when v_outcome = 'delivered' then now() else last_success_at end,
      last_failure_at = case when v_outcome <> 'delivered' then now() else last_failure_at end,
      consecutive_failures = case when v_outcome = 'delivered' then 0 else consecutive_failures + 1 end,
      updated_at = now()
  where id = v_delivery.endpoint_id;
  return v_outcome;
end;
$$;

create or replace function public.get_integration_control_plane(
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
  if public.is_platform_admin() then
    v_org_id := p_organization_id;
  elsif public.current_role() = 'org_admin'
     or public.has_effective_permission(
       'integrations.webhooks.read', 'organization', public.current_org_id(), now()
     ) then
    v_org_id := public.current_org_id();
    if p_organization_id is not null and p_organization_id <> v_org_id then
      raise exception 'Cannot inspect another organization integration state' using errcode = '42501';
    end if;
  else
    raise exception 'Integration control plane requires an administrator' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'schemaVersion', 1,
    'organizationId', v_org_id,
    'generatedAt', now(),
    'summary', jsonb_build_object(
      'activeCredentials', (select count(*) from public.integration_api_credentials c
        where (v_org_id is null or c.organization_id = v_org_id)
          and c.status = 'active' and c.expires_at > now()),
      'activeEndpoints', (select count(*) from public.integration_webhook_endpoints e
        where (v_org_id is null or e.organization_id = v_org_id) and e.status = 'active'),
      'pendingDeliveries', (select count(*) from public.integration_webhook_deliveries d
        where (v_org_id is null or d.organization_id = v_org_id) and d.status in ('pending','retry','processing')),
      'deadLetters', (select count(*) from public.integration_webhook_deliveries d
        where (v_org_id is null or d.organization_id = v_org_id) and d.status = 'dead_letter')
    ),
    'endpoints', coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'organizationId', e.organization_id, 'name', e.name,
      'destinationUrl', e.destination_url, 'status', e.status,
      'secretVersion', e.secret_version, 'lastSuccessAt', e.last_success_at,
      'lastFailureAt', e.last_failure_at, 'consecutiveFailures', e.consecutive_failures,
      'subscriptions', (select coalesce(jsonb_agg(s.event_type order by s.event_type), '[]'::jsonb)
        from public.integration_webhook_subscriptions s where s.endpoint_id = e.id and s.is_active)
    ) order by e.name) from public.integration_webhook_endpoints e
      where v_org_id is null or e.organization_id = v_org_id), '[]'::jsonb),
    'recentDeliveryFailures', coalesce((select jsonb_agg(x.row_value order by x.created_at desc)
      from (select d.created_at, jsonb_build_object(
        'deliveryId', d.id, 'endpointId', d.endpoint_id, 'eventType', d.event_type,
        'status', d.status, 'attemptCount', d.attempt_count,
        'lastHttpStatus', d.last_http_status, 'lastErrorCode', d.last_error_code,
        'lastErrorMessage', d.last_error_message, 'createdAt', d.created_at
      ) row_value from public.integration_webhook_deliveries d
      where (v_org_id is null or d.organization_id = v_org_id)
        and d.status in ('retry','dead_letter')
      order by d.created_at desc limit 50) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- Register the shared dispatcher without scheduling provider-specific SQL.
-- run-system-job invokes the Edge worker with this stable key.
insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, expected_interval,
  freshness_sla, is_critical, retry_mode, operator_route
)
values (
  'integration-webhook-dispatch', 'Integration webhook dispatch',
  'Signs and delivers versioned tenant integration events', 'edge_cron',
  interval '5 minutes', interval '20 minutes', true, 'automatic',
  '/admin/integrations'
)
on conflict (job_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  execution_kind = excluded.execution_kind,
  expected_interval = excluded.expected_interval,
  freshness_sla = excluded.freshness_sla,
  is_critical = excluded.is_critical,
  retry_mode = excluded.retry_mode,
  operator_route = excluded.operator_route,
  updated_at = now();

-- The durable job definition supplies monitoring and manual replay; pg_cron
-- is the production trigger that actually drains the delivery queue. The
-- shared secret is read from Vault at execution time and never stored here.
select cron.unschedule('integration-webhook-dispatch')
where exists (
  select 1 from cron.job where jobname = 'integration-webhook-dispatch'
);

select cron.schedule(
  'integration-webhook-dispatch',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/dispatch-integration-webhooks',
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
       body := jsonb_build_object('batchSize', 50)
     ); $$
);

alter table public.integration_api_scope_definitions enable row level security;
alter table public.integration_schema_definitions enable row level security;
alter table public.integration_api_credentials enable row level security;
alter table public.integration_webhook_endpoints enable row level security;
alter table public.integration_webhook_subscriptions enable row level security;
alter table public.integration_webhook_deliveries enable row level security;
alter table public.integration_webhook_delivery_attempts enable row level security;

create policy integration_api_scope_definitions_read
  on public.integration_api_scope_definitions for select to authenticated using (true);
create policy integration_schema_definitions_read
  on public.integration_schema_definitions for select to authenticated
  using (lifecycle_status <> 'retired' or (select public.is_platform_admin()));
create policy integration_api_credentials_read
  on public.integration_api_credentials for select to authenticated
  using ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id()) and (
      (select public.current_role()) = 'org_admin'
      or public.has_effective_permission('integrations.api.read', 'organization', organization_id, now()))));
create policy integration_webhook_endpoints_read
  on public.integration_webhook_endpoints for select to authenticated
  using ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id()) and (
      (select public.current_role()) = 'org_admin'
      or public.has_effective_permission('integrations.webhooks.read', 'organization', organization_id, now()))));
create policy integration_webhook_subscriptions_read
  on public.integration_webhook_subscriptions for select to authenticated
  using ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id()) and (
      (select public.current_role()) = 'org_admin'
      or public.has_effective_permission('integrations.webhooks.read', 'organization', organization_id, now()))));
create policy integration_webhook_deliveries_read
  on public.integration_webhook_deliveries for select to authenticated
  using ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id()) and (
      (select public.current_role()) = 'org_admin'
      or public.has_effective_permission('integrations.webhooks.read', 'organization', organization_id, now()))));
create policy integration_webhook_delivery_attempts_read
  on public.integration_webhook_delivery_attempts for select to authenticated
  using ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id()) and (
      (select public.current_role()) = 'org_admin'
      or public.has_effective_permission('integrations.webhooks.read', 'organization', organization_id, now()))));

revoke all on table public.integration_api_scope_definitions,
  public.integration_schema_definitions, public.integration_api_credentials,
  public.integration_webhook_endpoints, public.integration_webhook_subscriptions,
  public.integration_webhook_deliveries, public.integration_webhook_delivery_attempts
  from public, anon, authenticated;
grant select on table public.integration_api_scope_definitions,
  public.integration_api_credentials, public.integration_webhook_endpoints,
  public.integration_webhook_subscriptions, public.integration_webhook_deliveries,
  public.integration_webhook_delivery_attempts to authenticated;
grant select on table public.integration_schema_definitions to authenticated;
grant select, insert, update, delete on table public.integration_api_scope_definitions,
  public.integration_schema_definitions, public.integration_api_credentials,
  public.integration_webhook_endpoints, public.integration_webhook_subscriptions,
  public.integration_webhook_deliveries
  to service_role;
grant select, insert on table public.integration_webhook_delivery_attempts
  to service_role;

revoke all on function public.issue_integration_api_credential(uuid, text, text[], timestamptz, integer),
  public.rotate_integration_api_credential(uuid, timestamptz),
  public.revoke_integration_api_credential(uuid, text),
  public.create_integration_webhook_endpoint(uuid, text, text, text[], text),
  public.rotate_integration_webhook_secret(uuid),
  public.deactivate_integration_webhook_endpoint(uuid, text),
  public.enqueue_integration_test_delivery(uuid, jsonb),
  public.replay_integration_webhook_delivery(uuid, text),
  public.get_integration_control_plane(uuid)
  from public, anon;
grant execute on function public.issue_integration_api_credential(uuid, text, text[], timestamptz, integer),
  public.rotate_integration_api_credential(uuid, timestamptz),
  public.revoke_integration_api_credential(uuid, text),
  public.create_integration_webhook_endpoint(uuid, text, text, text[], text),
  public.rotate_integration_webhook_secret(uuid),
  public.deactivate_integration_webhook_endpoint(uuid, text),
  public.enqueue_integration_test_delivery(uuid, jsonb),
  public.replay_integration_webhook_delivery(uuid, text),
  public.get_integration_control_plane(uuid)
  to authenticated, service_role;

revoke all on function public.authenticate_integration_api_credential(text, text, text),
  public.consume_integration_rate_limit(uuid, integer),
  public.accept_integration_command(uuid, text, text, text, text, jsonb, text),
  public.list_integration_events(uuid, bigint, integer),
  public.claim_integration_webhook_deliveries(integer, uuid, uuid, integer),
  public.complete_integration_webhook_delivery(uuid, integer, boolean, integer, text, text, text, boolean, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.authenticate_integration_api_credential(text, text, text),
  public.consume_integration_rate_limit(uuid, integer),
  public.accept_integration_command(uuid, text, text, text, text, jsonb, text),
  public.list_integration_events(uuid, bigint, integer),
  public.claim_integration_webhook_deliveries(integer, uuid, uuid, integer),
  public.complete_integration_webhook_delivery(uuid, integer, boolean, integer, text, text, text, boolean, integer, bigint)
  to service_role;

insert into app_private.audit_entity_manifest (
  table_name, audit_mode, contains_regulated_data, rationale
)
values
  ('integration_api_scope_definitions', 'not_required', false, 'Static API scope catalog'),
  ('integration_schema_definitions', 'row_trigger', false, 'Version and deprecation contract'),
  ('integration_api_credentials', 'domain_evidence', false, 'Issue, use, rotate, and revoke evidence is command based'),
  ('integration_webhook_endpoints', 'row_trigger', false, 'Tenant destination configuration'),
  ('integration_webhook_subscriptions', 'row_trigger', false, 'Tenant event subscription configuration'),
  ('integration_webhook_deliveries', 'domain_evidence', false, 'Durable delivery and replay evidence'),
  ('integration_webhook_delivery_attempts', 'domain_evidence', false, 'Immutable signed delivery attempt evidence')
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

create trigger set_updated_at before update on public.integration_schema_definitions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.integration_api_credentials
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.integration_webhook_endpoints
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.integration_webhook_subscriptions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.integration_webhook_deliveries
  for each row execute function public.set_updated_at();

create trigger audit_log after insert or update or delete on public.integration_schema_definitions
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.integration_webhook_endpoints
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.integration_webhook_subscriptions
  for each row execute function public.audit_log_trigger();
