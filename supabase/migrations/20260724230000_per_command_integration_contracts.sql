-- PT-003: per-command integration inbox contracts.
--
-- The integration gateway used to hard-code scope 'commands:write' and schema
-- version '2026-07-11' for every command, while medication.snapshot.import is
-- registered at '2026-07-14' with the least-privilege scope 'medications:write'
-- and public.apply_medication_integration_command only applies '2026-07-14'
-- receipts. Either pairing failed one side, so medication/eMAR snapshot import
-- was impossible through the gateway. The gateway now derives each command's
-- version and scope per command (see PHASE2_INTEGRATION_COMMAND_CONTRACTS in
-- supabase/functions/_shared/phase2Integration.ts).
--
-- This migration aligns the database half of that contract:
--   * public.integration_schema_definitions (schema_kind = 'command') is the
--     source of truth for command versions. A registered command must be
--     submitted at one of its active registered versions, and the rejection
--     names the expected version. Unregistered command types keep the generic
--     baseline envelope version '2026-07-11', so existing commands
--     (e.g. workforce.lifecycle.sync) are unaffected.
--   * 'commands:write' remains the superset scope accepted for every command;
--     commands with a declared least-privilege scope (medication.snapshot.import
--     -> 'medications:write') also accept that scope. Keep the case expression
--     below in sync with PHASE2_INTEGRATION_COMMAND_CONTRACTS.
--   * Previously a medication.snapshot.import receipt could be accepted at
--     '2026-07-11' and then wedge, because the apply function refuses that
--     version; that pairing is now rejected at acceptance time.
--
-- Credential status/expiry checks, idempotent receipts, replay-conflict
-- detection (errcode 23505 on an idempotency key reused with different
-- content), and accepted-event emission are unchanged from
-- 20260714210309_medication_integration_boundary.sql.
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
  v_command_scope text := case p_command_type
    when 'medication.snapshot.import' then 'medications:write'
    else null
  end;
  v_registered_versions text[];
  v_expected_version text;
begin
  select * into v_credential from public.integration_api_credentials
  where id = p_credential_id and status = 'active' and expires_at > now();
  if not found or not (
    'commands:write' = any(v_credential.scopes)
    or (v_command_scope is not null and v_command_scope = any(v_credential.scopes))
  ) then
    raise exception 'Credential is not authorized for this command' using errcode = '42501';
  end if;
  select array_agg(d.schema_version order by d.schema_version desc)
    into v_registered_versions
  from public.integration_schema_definitions d
  where d.schema_kind = 'command' and d.schema_name = p_command_type
    and d.lifecycle_status = 'active';
  v_expected_version := coalesce(v_registered_versions[1], '2026-07-11');
  if not (p_schema_version = any(coalesce(v_registered_versions, array['2026-07-11']))) then
    raise exception 'Command % requires schema version %', p_command_type, v_expected_version
      using errcode = '22023';
  end if;
  if p_request_sha256 !~ '^[0-9a-f]{64}$'
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
