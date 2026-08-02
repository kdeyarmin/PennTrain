-- Offline service documentation drafts, Tier 1 (BACKLOG.md E5, MVP).
--
-- WHAT THIS IS. A direct-care employee can lose connectivity mid-shift and still need to document
-- a scheduled task. Tier 1 covers exactly that: draft + sync + conflict rules for a task that was
-- already on the floor queue before the device went offline. It deliberately does NOT snapshot the
-- queue itself for cold-offline viewing (Tier 2, a future ticket) -- this migration only concerns
-- what happens when a device that already has a task in view submits a documentation response after
-- reconnecting.
--
-- WHY THIS DOES NOT REIMPLEMENT record_service_task_response. That function already owns the one
-- row-locked, status-checked path that turns a scheduled task into a documented one (see
-- 20260726060100_exception_documentation_and_unscheduled_services.sql lines ~47-136). Duplicating
-- its authorization, response-vocabulary, or assistance-level checks here would let the two paths
-- drift -- exactly the kind of split this program has spent several migrations closing (manager vs.
-- Floor documentation used to write different columns; see serviceDeliveryContract.ts). This
-- migration calls it and classifies what it does, nothing more.
--
-- WHY A NEW DEVICE-REGISTRATION RPC PAIR INSTEAD OF REUSING THE LEARNING ONES.
-- offline_device_registrations is already generic (organization_id/profile_id/status/wipe_required_at,
-- no course-specific column), so this reuses the TABLE. It does not reuse
-- register_offline_learning_device/revoke_offline_learning_device themselves: those names belong to
-- the course-content offline store, calling them from unrelated floor-documentation code would make a
-- revoke of one store silently read as a revoke of the other in any future audit of "why was this
-- device revoked", and the ticket for this feature is explicit that they must not be edited or
-- renamed. register_offline_service_device/revoke_offline_service_device are near-duplicates of
-- their bodies, scoped to this store's own device rows (each store generates its own AES-GCM key
-- client-side, so the two stores register two distinct rows -- distinct device_fingerprint_sha256 --
-- even on the same physical device).
--
-- WHY THE RECEIPT TABLE DOES NOT CONSTRAIN response/exception_details TO THE ENUM/OBJECT SHAPE THAT
-- resident_service_task_instances ITSELF ENFORCES. Section 6 of the ticket requires a receipt row on
-- EVERY attempt, including ones record_service_task_response rejected. If this table's own CHECK
-- constraints re-enforced the same shape, a malformed/adversarial call that record_service_task_response
-- correctly rejected as 'rejected' could then fail the receipt INSERT itself (a raw constraint
-- violation instead of a clean JSON outcome), breaking the "always insert a receipt" guarantee for
-- exactly the calls that most need one on record. Shape/enum validity is enforced where it already is
-- authoritative: client-side by assertServiceDraftAllowed, and server-side by
-- record_service_task_response's own business rule and resident_service_task_instances' column check.
--
-- WHY THIS TABLE GETS THE modules.carebase ENTITLEMENT POLICY EVEN THOUGH THE MIGRATION THIS TICKET
-- POINTS TO AS A MODEL (20260726060100) DOES NOT ADD IT TO resident_unscheduled_services. That table
-- predates it as a settled requirement only by a few days and missed the sweep other Phase 3c/4
-- tables (clinical_observations, clinical_observation_amendments, ...) already self-register into
-- (see 20260720193217_modular_product_entitlements.sql and the migrations that followed it). This
-- table reuses offline_device_registrations, which already carries this exact policy at
-- 'modules.carebase' -- leaving the receipts ungated while the device registration they depend on is
-- gated would be a new inconsistency, not a mirrored one.

-- ---------------------------------------------------------------------------
-- 1. Receipt table: append-only, one row per sync attempt (every outcome, not just success)
-- ---------------------------------------------------------------------------

create table public.offline_service_draft_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.offline_device_registrations(id) on delete cascade,
  task_id uuid not null references public.resident_service_task_instances(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  client_occurred_at timestamptz not null,
  -- Not constrained to the seven-value CompletionResponse enum or to jsonb object shape -- see the
  -- header note. assertServiceDraftAllowed (client) and record_service_task_response (server) are
  -- the two places that shape is actually authoritative.
  response text not null check (length(response) between 1 and 100),
  exception_details jsonb not null default '{}'::jsonb,
  outcome text not null check (outcome in (
    'applied', 'duplicate', 'conflict', 'stale', 'rejected', 'wipe_required'
  )),
  error_message text,
  processed_at timestamptz not null default now(),
  unique (device_id, idempotency_key)
);

comment on table public.offline_service_draft_receipts is
  'One row per offline service-documentation sync attempt (E5 Tier 1). Append-only; the outcome '
  'column is what the client uses to decide whether the local draft is cleared, retried, or flagged '
  'for human review. It is itself the evidence trail for these attempts, not a queue.';
comment on column public.offline_service_draft_receipts.outcome is
  'applied/duplicate clear the local draft immediately. conflict/stale/rejected keep it, '
  'clearly labeled, until a human dismisses it or the purge ceiling hits (block-and-flag, no merge). '
  'wipe_required means the device itself is no longer trusted; the client wipes its local store.';

create index offline_service_draft_receipts_organization_id_idx
  on public.offline_service_draft_receipts (organization_id);
create index offline_service_draft_receipts_profile_id_idx
  on public.offline_service_draft_receipts (profile_id);
create index offline_service_draft_receipts_task_id_idx
  on public.offline_service_draft_receipts (task_id);
-- device_id alone is already the leading column of the (device_id, idempotency_key) unique index
-- above, so a separate single-column index would only duplicate it (same reasoning
-- 20260801071629_add_indexes_for_unindexed_foreign_keys.sql applied to offline_device_registrations
-- and its own unique(profile_id, device_fingerprint_sha256)).

alter table public.offline_service_draft_receipts enable row level security;
revoke all on table public.offline_service_draft_receipts from public, anon, authenticated, service_role;
grant select on table public.offline_service_draft_receipts to authenticated;
grant all on table public.offline_service_draft_receipts to service_role;

-- A profile sees only receipts for devices it registered itself. There is no manager/admin
-- broadening here (unlike resident_unscheduled_services' facility-visibility policy) because this
-- table is about ONE device's sync history, not resident care history -- a supervisor reviewing a
-- flagged conflict works from the resident's actual record, not from another person's local receipts.
create policy offline_service_draft_receipts_select on public.offline_service_draft_receipts
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- Append-only, mirroring offline_sync_receipts' own immutability (app_private.prevent_phase4_evidence_mutation
-- is left untouched -- its name and message are specifically about the Phase 4 learning tables, and
-- reusing it here would misdescribe what actually failed to a future reader of a Postgres error log).
create or replace function app_private.prevent_offline_service_draft_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Offline service draft receipts are append-only' using errcode = '55000';
end;
$$;

create trigger prevent_offline_service_draft_receipt_mutation
  before update or delete on public.offline_service_draft_receipts
  for each row execute function app_private.prevent_offline_service_draft_receipt_mutation();
create trigger prevent_offline_service_draft_receipt_truncate
  before truncate on public.offline_service_draft_receipts
  for each statement execute function app_private.prevent_offline_service_draft_receipt_mutation();

-- Commercial module entitlement: this is resident-service-documentation infrastructure, the same
-- pillar as resident_service_task_instances/resident_service_requirements and the
-- offline_device_registrations row this table hangs off of. See header note.
insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
values ('public', 'offline_service_draft_receipts', 'modules.carebase')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

create policy product_module_entitlement on public.offline_service_draft_receipts
  as restrictive for all to authenticated
  using ((select app_private.has_product_module('modules.carebase')))
  with check ((select app_private.has_product_module('modules.carebase')));

-- Audit manifest: this table IS the append-only evidence of every sync attempt (outcome and server
-- message on every row, not just successes) -- a generic audit_log_trigger on top would duplicate
-- exactly what it already records, the same reasoning support_plan_proposals earned 'domain_evidence'
-- for in 20260726260000. 'not_required' here because the evidence is the receipt rows themselves,
-- not a separate audit_logs write.
insert into app_private.audit_entity_manifest (table_name, audit_mode, contains_regulated_data, rationale)
values (
  'offline_service_draft_receipts',
  'not_required',
  true,
  'Append-only receipt of every offline documentation sync attempt (outcome + server message on '
  'every row); the table is itself the evidence trail, so a row trigger would duplicate it. '
  'Reachable from a resident via task_id. Added by 20260802030000 (BACKLOG.md E5 Tier 1).'
)
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Device registration, scoped to this store (near-duplicates of
--    register_offline_learning_device / revoke_offline_learning_device -- see header note)
-- ---------------------------------------------------------------------------

create or replace function public.register_offline_service_device(
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

comment on function public.register_offline_service_device(text, text) is
  'Registers (or reactivates) this device for offline service-documentation drafts. Near-duplicate of '
  'register_offline_learning_device, scoped separately so revoking one store''s device can never be '
  'mistaken for revoking the other''s in an audit trail. See offlineServiceDraftCache.ts for the '
  'client-side key/fingerprint that feeds this.';

create or replace function public.revoke_offline_service_device(p_device_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.offline_device_registrations set status = 'revoked', revoked_at = now(), wipe_required_at = now()
  where id = p_device_id and profile_id = auth.uid();
  if not found then raise exception 'Offline device not found' using errcode = 'P0002'; end if;
  return true;
end;
$$;

comment on function public.revoke_offline_service_device(uuid) is
  'Revokes this device''s offline service-documentation access. The next sync_offline_service_task_draft '
  'call from it returns outcome ''wipe_required'' and the client wipes its local drafts. Near-duplicate '
  'of revoke_offline_learning_device, minus the offline_content_manifests step -- this store never '
  'downloads content, only queues drafts, so there is no manifest to withdraw.';

revoke all on function public.register_offline_service_device(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.register_offline_service_device(text, text)
  to authenticated;

revoke all on function public.revoke_offline_service_device(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.revoke_offline_service_device(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sync: call record_service_task_response and classify what happened
-- ---------------------------------------------------------------------------

create or replace function public.sync_offline_service_task_draft(
  p_device_id uuid,
  p_task_id uuid,
  p_idempotency_key text,
  p_client_occurred_at timestamptz,
  p_response text,
  p_exception_details jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.offline_device_registrations%rowtype;
  v_existing public.offline_service_draft_receipts%rowtype;
  v_receipt public.offline_service_draft_receipts%rowtype;
  v_task_status text;
  v_task_recorded_by uuid;
  v_outcome text;
  v_error_message text;
begin
  -- Device-ownership boundary first, and as a hard failure rather than a soft outcome: a device_id
  -- that does not exist, or exists but belongs to a different profile, is not "my device that got
  -- revoked" (that is the wipe_required case below) -- it is a caller passing an id it has no claim
  -- to. Mirrors sync_offline_learning_action's own ownership check
  -- (20260712023823_phase4_standards_adaptive_offline.sql).
  select * into v_device from public.offline_device_registrations where id = p_device_id for update;
  if not found or v_device.profile_id <> auth.uid() then
    raise exception 'Offline device is outside caller identity' using errcode = '42501';
  end if;

  -- Idempotency replay is checked before anything that would insert a second row for the same
  -- (device_id, idempotency_key) pair -- including the wipe_required branch below -- so retrying a
  -- sync whose receipt already exists can never collide with the unique constraint.
  select * into v_existing from public.offline_service_draft_receipts
  where device_id = p_device_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'receiptId', v_existing.id,
      'outcome', 'duplicate',
      'errorMessage', v_existing.error_message
    );
  end if;

  if v_device.status <> 'active' or v_device.wipe_required_at is not null then
    -- This IS my device, but its offline access was turned off since the draft was queued. No
    -- attempt against record_service_task_response is made; nothing about the task changes.
    v_outcome := 'wipe_required';
    v_error_message := null;
  else
    begin
      perform public.record_service_task_response(p_task_id, p_response, coalesce(p_exception_details, '{}'::jsonb), null);
      v_outcome := 'applied';
      v_error_message := null;
    exception
      -- record_service_task_response's "only scheduled service tasks can be recorded" guard. Its own
      -- sub-transaction (this exception block's implicit savepoint) releases the row lock it took on
      -- abort, so the task is re-read fresh rather than trusting the stale row this call started with.
      when object_not_in_prerequisite_state then
        v_error_message := sqlerrm;
        select status, recorded_by_profile_id into v_task_status, v_task_recorded_by
        from public.resident_service_task_instances where id = p_task_id;
        if v_task_status = 'superseded' then
          v_outcome := 'stale';
        elsif v_task_recorded_by = auth.uid() then
          v_outcome := 'duplicate';
        else
          v_outcome := 'conflict';
        end if;
      -- Authorization (caller scope) and validation (response not accepted / missing assistance
      -- level / malformed exception_details) errors from record_service_task_response. Neither is a
      -- state the local draft can recover from by itself.
      when insufficient_privilege then
        v_outcome := 'rejected';
        v_error_message := sqlerrm;
      when invalid_parameter_value then
        v_outcome := 'rejected';
        v_error_message := sqlerrm;
      -- Anything else (task_id not found, a constraint this migration did not anticipate, ...) --
      -- fails the same way rather than propagating a raw error past the receipt this function must
      -- always write.
      when others then
        v_outcome := 'rejected';
        v_error_message := sqlerrm;
    end;
  end if;

  insert into public.offline_service_draft_receipts(
    organization_id, profile_id, device_id, task_id, idempotency_key,
    client_occurred_at, response, exception_details, outcome, error_message
  ) values (
    v_device.organization_id, v_device.profile_id, v_device.id, p_task_id, p_idempotency_key,
    p_client_occurred_at, p_response, coalesce(p_exception_details, '{}'::jsonb), v_outcome, v_error_message
  )
  returning * into v_receipt;

  update public.offline_device_registrations set last_sync_at = now() where id = v_device.id;

  return jsonb_build_object(
    'receiptId', v_receipt.id,
    'outcome', v_outcome,
    'errorMessage', v_error_message
  );
end;
$$;

comment on function public.sync_offline_service_task_draft(uuid, uuid, text, timestamptz, text, jsonb) is
  'Syncs one offline service-documentation draft. Calls record_service_task_response directly and '
  'classifies its outcome -- does not reimplement its row-lock/status-check invariant. Block-and-flag: '
  'conflict/stale/rejected leave the task untouched and are returned for the client to keep locally '
  'until a human dismisses them, never merged or retried automatically.';

revoke all on function public.sync_offline_service_task_draft(uuid, uuid, text, timestamptz, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sync_offline_service_task_draft(uuid, uuid, text, timestamptz, text, jsonb)
  to authenticated;
