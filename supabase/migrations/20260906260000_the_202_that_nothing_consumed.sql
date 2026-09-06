-- The 202 that nothing consumed, the grace window nothing read, and the residue of a removed
-- feature (RELEASE_READINESS_PLAN.md section 4.3 -- Integrations, and Exclusion-screening residue).
--
-- Six defects, all of the same family: a promise the product makes and does not keep.
--
--   1. `accept_integration_command` accepted ANY command type matching the name pattern, filed a
--      receipt, emitted `integration.command.accepted` and answered 202. Only two types are ever
--      drained (`fhir.bundle.import`, `medication.snapshot.import`); everything else sat in
--      `accepted` forever. A 202 nothing will act on is a lie to the partner.
--   2. Nothing told the partner what happened at APPLY time. The apply functions write the outcome
--      onto the receipt and no event was emitted, so a rejected bundle looked identical to an
--      accepted one from outside. `get_integration_command_receipt` and its `GET /v1/commands/:id`
--      route are the read side; the two new events are the push side.
--   3. `rotate_integration_webhook_secret` writes `previous_vault_secret_id` and
--      `previous_valid_until` and NOTHING read them, so the 15-minute grace window did not exist --
--      contrary to the rotation dialog, which tells the operator to hand the new secret over
--      "before the old one stops being accepted".
--   4. An endpoint that has been dead for weeks kept its queue: `consecutive_failures` only ever
--      counted up. The dispatch index is `(status, consecutive_failures) where status = 'active'`,
--      which is the shape of an auto-disable that was never written.
--   5. A single event subscription could not be switched off, and no endpoint -- auto-disabled or
--      switched off by a person -- could be switched back on.
--   6. An identity domain registered and never verified blocked the real owner permanently:
--      `domain` is globally unique and only the holding organization can revoke.
--
-- Plus the seeded rows that still name exclusion screening as a product requirement.
-- 20260906020000 removed the subsystem and reached its code; these are the seeded rows it did not.
--
-- Every existing function below is patched from pg_get_functiondef with a guarded replace, so the
-- live body is what is edited and nothing else in it can drift.

------------------------------------------------------------------------------------------------
-- 1. A command type nothing consumes is refused, not accepted
------------------------------------------------------------------------------------------------

-- ONE definition of "the inbox will act on this", used by the acceptance check and by the drain
-- that does the acting. Two lists is how the original defect happened: the gateway's list was
-- "anything that looks like a command name" and the drain's was two literals.
create or replace function app_private.integration_command_is_consumable(p_command_type text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select p_command_type in ('fhir.bundle.import', 'medication.snapshot.import');
$$;

revoke all on function app_private.integration_command_is_consumable(text) from public, anon, authenticated;
grant execute on function app_private.integration_command_is_consumable(text) to service_role;

comment on function app_private.integration_command_is_consumable(text) is
  'The command types app_private.drain_integration_command_inbox applies. public.accept_integration_command refuses everything else rather than answering 202 for a command nothing will ever act on.';

do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef(
    'public.accept_integration_command(uuid, text, text, text, text, jsonb, text)'::regprocedure);
  v_old := $old$  if not (p_schema_version = any(coalesce(v_registered_versions, array['2026-07-11']))) then
    raise exception 'Command % requires schema version %', p_command_type, v_expected_version
      using errcode = '22023';
  end if;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'accept_integration_command no longer contains the schema-version anchor this migration patches';
  end if;
  v_new := $patch$  if not (p_schema_version = any(coalesce(v_registered_versions, array['2026-07-11']))) then
    raise exception 'Command % requires schema version %', p_command_type, v_expected_version
      using errcode = '22023';
  end if;
  -- The inbox drains two command types. Accepting any other one filed a receipt that nothing
  -- would ever read and answered the partner 202. Refused at the door instead, naming what is
  -- accepted, so an integration built against a command this product does not implement fails
  -- on its first call rather than looking healthy forever.
  if not app_private.integration_command_is_consumable(p_command_type) then
    raise exception 'Command type % is not accepted by this API; accepted command types are fhir.bundle.import and medication.snapshot.import', p_command_type
      using errcode = '22023';
  end if;$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

------------------------------------------------------------------------------------------------
-- 2. The apply-time outcome, pushed and readable
------------------------------------------------------------------------------------------------

insert into public.integration_schema_definitions (
  schema_kind, schema_name, schema_version, lifecycle_status
)
values
  ('event', 'integration.command.applied', '2026-07-11', 'active'),
  ('event', 'integration.command.rejected', '2026-07-11', 'active')
on conflict do nothing;

-- The event carries the receipt id, the command type, the terminal status and -- for a failure --
-- the SQLSTATE. It deliberately does NOT carry the apply function's `message`, which is a
-- truncated sqlerrm and can quote row content: an event is fanned out to every subscribed endpoint
-- for the tenant, while the message is readable only through GET /v1/commands/:id, which is scoped
-- to the credential's own organization.
create or replace function app_private.emit_integration_command_outcome_event(
  p_receipt_id uuid,
  p_event_type text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare v_receipt app_private.integration_command_receipts%rowtype;
begin
  select * into v_receipt from app_private.integration_command_receipts where id = p_receipt_id;
  if not found then return; end if;
  insert into app_private.integration_event_log (
    organization_id, event_type, event_schema_version, correlation_id,
    causation_id, actor_subject, payload
  ) values (
    v_receipt.organization_id, p_event_type, '2026-07-11', v_receipt.correlation_id,
    v_receipt.id::text, 'api_credential:' || v_receipt.credential_id,
    jsonb_build_object(
      'commandId', v_receipt.id,
      'commandType', v_receipt.command_type,
      'status', p_status,
      'errorCode', v_receipt.result->>'errorCode'
    )
  );
end;
$$;

revoke all on function app_private.emit_integration_command_outcome_event(uuid, text, text)
  from public, anon, authenticated;
grant execute on function app_private.emit_integration_command_outcome_event(uuid, text, text) to service_role;

do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('app_private.drain_integration_command_inbox(integer)'::regprocedure);

  -- (a) one definition of the consumable set, shared with the acceptance check above.
  v_old := $old$    where r.command_type in ('fhir.bundle.import', 'medication.snapshot.import')$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'drain_integration_command_inbox no longer selects on a literal command-type list';
  end if;
  v_def := replace(v_def, v_old, $patch$    where app_private.integration_command_is_consumable(r.command_type)$patch$);

  -- (b) the terminal outcomes become events. The transient-retry branch deliberately emits
  --     nothing: it is not an outcome, and a partner does not need to watch us retry a deadlock.
  v_old := $old$        else
          v_rejected := v_rejected + 1;
        end if;
      else
        v_applied := v_applied + 1;
      end if;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'drain_integration_command_inbox no longer contains the outcome-accounting anchor';
  end if;
  v_def := replace(v_def, v_old, $patch$        else
          v_rejected := v_rejected + 1;
          perform app_private.emit_integration_command_outcome_event(
            v_row.id, 'integration.command.rejected', 'rejected');
        end if;
      else
        v_applied := v_applied + 1;
        perform app_private.emit_integration_command_outcome_event(
          v_row.id, 'integration.command.applied', 'applied');
      end if;$patch$);

  v_old := $old$          else
            update app_private.integration_command_receipts
            set status = 'dead_letter', updated_at = now()
            where id = v_row.id;
            v_dead := v_dead + 1;
          end if;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'drain_integration_command_inbox no longer contains the transient dead-letter anchor';
  end if;
  v_def := replace(v_def, v_old, $patch$          else
            update app_private.integration_command_receipts
            set status = 'dead_letter', updated_at = now()
            where id = v_row.id;
            v_dead := v_dead + 1;
            perform app_private.emit_integration_command_outcome_event(
              v_row.id, 'integration.command.rejected', 'dead_letter');
          end if;$patch$);

  v_old := $old$      where id = v_row.id;
      v_dead := v_dead + 1;
    end;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'drain_integration_command_inbox no longer contains the exception dead-letter anchor';
  end if;
  v_def := replace(v_def, v_old, $patch$      where id = v_row.id;
      v_dead := v_dead + 1;
      perform app_private.emit_integration_command_outcome_event(
        v_row.id, 'integration.command.rejected', 'dead_letter');
    end;$patch$);

  execute v_def;
end
$do$;

-- The read side of the same fact. GET /v1/commands/:id in supabase/functions/integration-api
-- calls this; there was no way at all for a partner to ask what became of a command it submitted.
create or replace function public.get_integration_command_receipt(
  p_credential_id uuid,
  p_command_id uuid
)
returns table(
  command_id uuid,
  command_type text,
  schema_version text,
  command_status text,
  correlation_id text,
  result jsonb,
  submitted_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare v_org_id uuid;
begin
  -- Same authorization shape as list_integration_events: the credential must be live and hold a
  -- write scope, and it can only read receipts inside its own tenant. Organization rather than
  -- credential id on purpose -- rotating a key mints a new credential row, and a partner should
  -- not lose sight of a command because it rotated between submit and poll.
  select c.organization_id into v_org_id
  from public.integration_api_credentials c
  where c.id = p_credential_id and c.status = 'active' and c.expires_at > now()
    and ('commands:write' = any(c.scopes) or 'medications:write' = any(c.scopes));
  if v_org_id is null then
    raise exception 'Credential cannot read command receipts' using errcode = '42501';
  end if;
  return query
  select r.id, r.command_type, r.schema_version, r.status, r.correlation_id,
    coalesce(r.result, '{}'::jsonb), r.created_at, r.updated_at
  from app_private.integration_command_receipts r
  where r.id = p_command_id and r.organization_id = v_org_id;
end;
$$;

revoke all on function public.get_integration_command_receipt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_integration_command_receipt(uuid, uuid) to service_role;

------------------------------------------------------------------------------------------------
-- 3. The rotation grace window that was written and never read
------------------------------------------------------------------------------------------------

-- The claim adds the previous secret while it is still inside its window. Changing the return type
-- means drop and recreate; the body is 20260711200651's, taken from the live catalog, with one
-- join and one column added.
drop function if exists public.claim_integration_webhook_deliveries(integer, uuid, uuid, integer);

create function public.claim_integration_webhook_deliveries(
  p_batch_size integer default 50,
  p_endpoint_id uuid default null,
  p_delivery_id uuid default null,
  p_stale_after_seconds integer default 300
)
returns table(
  delivery_id uuid, organization_id uuid, endpoint_id uuid, destination_url text, event_id uuid,
  request_body jsonb, plaintext_signing_secret text, previous_signing_secret text,
  attempt_number integer, max_attempts integer, timeout_ms integer, correlation_id text,
  event_schema_version text
)
language sql
security definer
set search_path to ''
as $function$
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
    v.decrypted_secret,
    -- The half of rotation that existed only as two columns: while the previous secret is still
    -- inside its window the dispatcher signs with BOTH, so a consumer that has not switched over
    -- yet keeps verifying. Outside the window this is null and only the current secret is sent.
    case when s.previous_valid_until > now() then prev.decrypted_secret end,
    c.attempt_count, c.max_attempts, e.timeout_ms,
    c.correlation_id, c.event_schema_version
  from claimed c
  join public.integration_webhook_endpoints e on e.id = c.endpoint_id
  join app_private.integration_endpoint_secrets s on s.endpoint_id = c.endpoint_id
  join vault.decrypted_secrets v on v.id = s.vault_secret_id
  left join vault.decrypted_secrets prev on prev.id = s.previous_vault_secret_id;
$function$;

revoke all on function public.claim_integration_webhook_deliveries(integer, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_integration_webhook_deliveries(integer, uuid, uuid, integer)
  to service_role;

------------------------------------------------------------------------------------------------
-- 4. A dead endpoint switches itself off
------------------------------------------------------------------------------------------------

do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef(
    'public.complete_integration_webhook_delivery(uuid, integer, boolean, integer, text, text, text, boolean, integer, bigint)'::regprocedure);
  v_old := $old$  update public.integration_webhook_endpoints
  set last_success_at = case when v_outcome = 'delivered' then now() else last_success_at end,
      last_failure_at = case when v_outcome <> 'delivered' then now() else last_failure_at end,
      consecutive_failures = case when v_outcome = 'delivered' then 0 else consecutive_failures + 1 end,
      updated_at = now()
  where id = v_delivery.endpoint_id;
  return v_outcome;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'complete_integration_webhook_delivery no longer contains the endpoint-counter anchor';
  end if;
  v_new := $patch$  update public.integration_webhook_endpoints
  set last_success_at = case when v_outcome = 'delivered' then now() else last_success_at end,
      last_failure_at = case when v_outcome <> 'delivered' then now() else last_failure_at end,
      consecutive_failures = case when v_outcome = 'delivered' then 0 else consecutive_failures + 1 end,
      updated_at = now()
  where id = v_delivery.endpoint_id;
  -- An endpoint that has refused twenty-five attempts in a row without a single success is not
  -- having a bad afternoon: it is gone. Until now nothing ever acted on the counter, so a deleted
  -- consumer kept a queue growing behind it forever and every tick spent its budget on a URL that
  -- would never answer. Disabled rather than deleted, with the count in the reason, and
  -- public.reactivate_integration_webhook_endpoint is the way back once the endpoint is fixed.
  -- Queued deliveries are left alone: the claim already skips a non-active endpoint, so they wait
  -- rather than being thrown away, and reactivating resumes them.
  update public.integration_webhook_endpoints
  set status = 'disabled', disabled_at = now(),
      disable_reason = 'Automatically disabled after ' || consecutive_failures
        || ' consecutive delivery failures',
      updated_at = now()
  where id = v_delivery.endpoint_id
    and status = 'active'
    and consecutive_failures >= 25;
  return v_outcome;$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

------------------------------------------------------------------------------------------------
-- 5. One subscription off, and an endpoint back on
------------------------------------------------------------------------------------------------

create or replace function public.set_integration_webhook_subscription(
  p_endpoint_id uuid,
  p_event_type text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare v_endpoint public.integration_webhook_endpoints%rowtype;
begin
  select * into v_endpoint from public.integration_webhook_endpoints where id = p_endpoint_id;
  if not found then raise exception 'Endpoint not found' using errcode = 'P0002'; end if;
  perform app_private.assert_integration_admin(v_endpoint.organization_id, 'integrations.webhooks.manage');
  update public.integration_webhook_subscriptions
  set is_active = p_is_active, updated_at = now()
  where endpoint_id = p_endpoint_id and event_type = p_event_type;
  if not found then
    raise exception 'Subscription not found on this endpoint' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_integration_webhook_subscription(uuid, text, boolean) from public, anon;
grant execute on function public.set_integration_webhook_subscription(uuid, text, boolean)
  to authenticated, service_role;

-- deactivate_integration_webhook_endpoint shipped with no counterpart, so switching an endpoint
-- off -- by hand or, now, automatically -- was a one-way door. Deliberately narrower than the
-- deactivate: it clears the disable record and lets the queue drain, and it cannot resurrect the
-- deliveries a deliberate deactivation canceled.
create or replace function public.reactivate_integration_webhook_endpoint(p_endpoint_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare v_endpoint public.integration_webhook_endpoints%rowtype;
begin
  select * into v_endpoint from public.integration_webhook_endpoints
  where id = p_endpoint_id for update;
  if not found then raise exception 'Endpoint not found' using errcode = 'P0002'; end if;
  perform app_private.assert_integration_admin(v_endpoint.organization_id, 'integrations.webhooks.manage');
  if v_endpoint.status = 'active' then
    raise exception 'Endpoint is already active' using errcode = '55000';
  end if;
  update public.integration_webhook_endpoints
  set status = 'active', consecutive_failures = 0,
      disabled_at = null, disabled_by = null, disable_reason = null, updated_at = now()
  where id = p_endpoint_id;
end;
$$;

revoke all on function public.reactivate_integration_webhook_endpoint(uuid) from public, anon;
grant execute on function public.reactivate_integration_webhook_endpoint(uuid)
  to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 6. An unverified domain claim expires
------------------------------------------------------------------------------------------------

do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.register_identity_domain(uuid, text, text)'::regprocedure);
  v_old := $old$    if v_domain.organization_id <> p_organization_id then
      raise exception 'identity domain is unavailable' using errcode = '23505';
    end if;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'register_identity_domain no longer contains the cross-tenant refusal this migration patches';
  end if;
  v_new := $patch$    if v_domain.organization_id <> p_organization_id then
      -- A claim nobody ever verified is not ownership; it is an assertion. `domain` is globally
      -- unique and only the holding organization can revoke its own row, so a typo or a squat left
      -- the real owner locked out of their own domain permanently, with no path but a database
      -- edit. It expires instead: ninety days pending, never verified, and nothing depending on
      -- it, and the next registrant may take it -- with the takeover written to the audit log so
      -- the previous holder's loss is a record and not a mystery. A VERIFIED domain is still
      -- refused, and so is a pending one inside the window or one an SSO connection points at.
      if v_domain.verification_status = 'pending'
         and v_domain.verified_at is null
         and v_domain.created_at <= now() - interval '90 days'
         and not exists (
           select 1 from public.organization_sso_connections c
           where c.identity_domain_id = v_domain.id
         ) then
        insert into public.audit_logs (
          organization_id, actor_profile_id, actor_subject_id, entity_type, entity_id,
          action, source, request_id, correlation_id, reason, old_values, new_values
        ) values (
          p_organization_id, auth.uid(), auth.uid()::text,
          'organization_identity_domains', v_domain.id::text,
          'identity_domain_claim_released', 'rpc',
          'identity-domain-release:' || v_domain.id, v_domain.id::text,
          'Unverified claim expired after 90 days',
          jsonb_build_object(
            'organizationId', v_domain.organization_id,
            'domain', v_domain.domain,
            'claimedAt', v_domain.created_at
          ),
          jsonb_build_object('organizationId', p_organization_id, 'domain', v_domain.domain)
        );
        v_token := 'cmt-verify-' || encode(extensions.gen_random_bytes(24), 'hex');
        update public.organization_identity_domains
        set organization_id = p_organization_id,
            verification_challenge = v_token,
            verification_challenge_sha256 = encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
            verification_status = 'pending',
            verified_at = null,
            verified_by = null,
            revoked_at = null,
            revoked_by = null,
            revocation_reason = null,
            created_by = coalesce(auth.uid(), v_domain.created_by)
        where id = v_domain.id
        returning * into v_domain;
        return jsonb_build_object(
          'domainId', v_domain.id, 'domain', v_domain.domain,
          'challenge', v_token, 'status', v_domain.verification_status, 'rotated', true
        );
      end if;
      raise exception 'identity domain is unavailable' using errcode = '23505';
    end if;$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

------------------------------------------------------------------------------------------------
-- 7. Exclusion-screening residue (I32)
------------------------------------------------------------------------------------------------
-- 20260906020000 removed the subsystem and said what that gives up. These are the seeded rows it
-- did not reach: copy that still sells the feature, or names it as something this product does.
-- Pennsylvania still requires background checks -- OAPSA (6 Pa.C.S. Ch. 5) and the Act 34/73/33
-- clearances -- and the product still tracks them, so the REQUIREMENT stays. What goes is the
-- claim that federal exclusion-list screening is part of it.

-- The Help Center still published the FAQ describing the Pending Review queue and the manual
-- rescan, for a console that no longer exists.
delete from public.help_articles
where article_type = 'faq'
  and title = 'What is Exclusion Screening, and why do some matches turn out to be false positives?';

-- The mandatory baseline requirement. The KEY is left alone: `workforce.background_screening` is
-- referenced by every tenant's resolved compliance profile and renaming it is a data migration
-- across live rows, not a copy change. The label and the evidence type are what a user reads, and
-- both now say what the product actually collects -- an OAPSA suitability determination and the
-- Act 34/73/33 clearances -- rather than a screening result nothing produces. The baseline
-- trigger permits this: it refuses only weakening (mandatory, hours, renewal, evidence), and none
-- of those change.
update public.compliance_profile_requirements r
set label = 'Background checks and suitability determination',
    rule = jsonb_set(r.rule, '{evidenceType}', '"background-clearance"'::jsonb),
    updated_at = now()
from public.compliance_profile_definitions p
where p.id = r.profile_definition_id
  and p.is_mandatory_baseline
  and r.requirement_key = 'workforce.background_screening';

update public.compliance_profile_definitions
set description = 'Minimum evidence and background-check controls applied to every active employee',
    updated_at = now()
where code = 'mandatory-baseline'
  and description = 'Minimum evidence and screening controls applied to every active employee';

-- The Survey Day entrance conference asked the facility to produce documentation for a check the
-- product no longer performs, in front of a surveyor. Deactivated rather than deleted:
-- entrance_conference_items is seeded platform-wide (organization_id is null) and a tenant may
-- have observations recorded against the prompt.
update public.entrance_conference_items
set is_active = false, updated_at = now()
where organization_id is null
  and prompt = 'Federal/state exclusion list screening completed and documented'
  and is_active;

-- The Workforce module description is what PackageEntitlementTermCard prints when a platform
-- admin builds a commercial package, so this string sold the feature into contracts. The frontend
-- half of the same sentence (lib/productModules.ts) was fixed with the removal; this row was not.
update public.feature_definitions
set description = 'Credentialing, competencies, background checks, scheduling, and practicums',
    updated_at = now()
where feature_key = 'modules.workforce'
  and description = 'Credentialing, competencies, background and exclusion screening, scheduling, and practicums';
