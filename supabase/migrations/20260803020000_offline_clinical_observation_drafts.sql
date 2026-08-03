-- Offline vitals capture for the caregiver charting surface (/me/residents).
--
-- WHAT THIS IS. RESIDENT_360_PROGRAM_PLAN.md Phase 4 lists offline-tolerant submission as
-- non-negotiable for a floor surface, and E5 (20260802060000_offline_service_documentation_drafts.sql)
-- already built that for scheduled service tasks. A vital sign taken in a corridor or stairwell has
-- exactly the same problem and, until this migration, exactly the wrong behaviour: the reading was
-- lost with a red toast. This is the observation counterpart of that same lane.
--
-- WHY THIS DOES NOT REIMPLEMENT record_clinical_observation. That function owns the abnormal-flag
-- derivation, the LOINC/unit handling, and app_private.assert_clinical_contributor. Duplicating any
-- of it here would let an offline reading be flagged differently from the identical reading taken
-- online -- the exact drift the service-draft migration's own header warns about. This calls it and
-- classifies what it does, nothing more.
--
-- WHY observed_at IS PASSED THROUGH UNCLAMPED, unlike sync_offline_service_task_draft's handling of
-- p_client_occurred_at. That function had to *reconstruct* an occurrence time, because
-- record_service_task_response stamps performed_at with its own now(). record_clinical_observation
-- takes p_observed_at as a first-class parameter and the caregiver types it in the dialog, so the
-- online and offline paths already agree: whatever the user entered is what is stored. Introducing a
-- plausibility clamp only on the offline path would mean the same typed timestamp is honoured when
-- online and silently altered when offline. The receipt still records client_occurred_at (the moment
-- the device queued it) separately, so the evidence trail keeps both facts.
--
-- WHY THERE IS NO 'conflict' OR 'stale' OUTCOME HERE. Those exist for service tasks because a task is
-- a single shared row someone else can document first, or that a plan revision can supersede. A vital
-- sign is an observation this caregiver personally took; nobody else can have recorded it, and it
-- cannot go stale. The outcome vocabulary is therefore deliberately narrower than the service
-- receipts' -- applied / duplicate / rejected / wipe_required -- rather than carrying two values this
-- flow can never produce.
--
-- WHY IDEMPOTENCY IS LOAD-BEARING HERE IN A WAY IT IS NOT FOR TASKS. record_service_task_response
-- refuses a task that is no longer 'scheduled', so a double-sync fails naturally. Observations have
-- no such guard: calling record_clinical_observation twice simply creates two readings, and a
-- duplicated vital sign in a chart is a clinical error, not a cosmetic one. The unique
-- (device_id, idempotency_key) below plus the replay check in the RPC is the only thing preventing
-- that, which is why the replay branch is checked before any write path.

-- ---------------------------------------------------------------------------
-- 1. Receipt table: append-only, one row per sync attempt (every outcome, not just success)
-- ---------------------------------------------------------------------------

create table public.offline_observation_draft_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.offline_device_registrations(id) on delete cascade,
  resident_id uuid not null references public.residents(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  -- When the device queued the draft. Distinct from the observation's own observed_at, which is the
  -- clinical fact and is carried on clinical_observations itself.
  client_occurred_at timestamptz not null,
  observation_type text not null check (length(observation_type) between 1 and 100),
  observation_id uuid references public.clinical_observations(id) on delete set null,
  outcome text not null check (outcome in ('applied', 'duplicate', 'rejected', 'wipe_required')),
  error_message text,
  processed_at timestamptz not null default now(),
  unique (device_id, idempotency_key)
);

comment on table public.offline_observation_draft_receipts is
  'One row per offline vitals sync attempt. Append-only; the outcome column is what the client uses '
  'to decide whether the local draft is cleared, retried, or flagged. The unique (device_id, '
  'idempotency_key) is also the only thing preventing a reconnect from double-charting a vital sign.';

create index offline_observation_draft_receipts_organization_id_idx
  on public.offline_observation_draft_receipts (organization_id);
create index offline_observation_draft_receipts_profile_id_idx
  on public.offline_observation_draft_receipts (profile_id);
create index offline_observation_draft_receipts_resident_id_idx
  on public.offline_observation_draft_receipts (resident_id);
create index offline_observation_draft_receipts_observation_id_idx
  on public.offline_observation_draft_receipts (observation_id);

alter table public.offline_observation_draft_receipts enable row level security;
revoke all on table public.offline_observation_draft_receipts from public, anon, authenticated, service_role;
grant select on table public.offline_observation_draft_receipts to authenticated;
grant all on table public.offline_observation_draft_receipts to service_role;

-- Mirrors offline_service_draft_receipts_select exactly: this is one device's sync history, not
-- resident care history. A supervisor reviewing a flagged draft works from the resident's record.
create policy offline_observation_draft_receipts_select on public.offline_observation_draft_receipts
  for select to authenticated
  using (profile_id = (select auth.uid()));

create or replace function app_private.prevent_offline_observation_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Offline observation draft receipts are append-only' using errcode = '55000';
end;
$$;

create trigger prevent_offline_observation_receipt_mutation
before update or delete on public.offline_observation_draft_receipts
for each row execute function app_private.prevent_offline_observation_receipt_mutation();

-- Commercial gating, matching offline_device_registrations and the clinical tables this feeds.
-- Registered as a CareBase resource and given the standard restrictive policy through the same
-- self-registration loop every other gated table uses, rather than a hand-named one-off.
insert into app_private.product_module_resources (resource_schema, resource_name, module_key)
values ('public', 'offline_observation_draft_receipts', 'modules.carebase')
on conflict (resource_schema, resource_name) do update set module_key = excluded.module_key;

do $$
declare v_resource record;
begin
  for v_resource in
    select resource_schema, resource_name from app_private.product_module_resources
    where resource_name = 'offline_observation_draft_receipts'
  loop
    execute format('drop policy if exists product_module_entitlement on %I.%I',
      v_resource.resource_schema, v_resource.resource_name);
    execute format(
      'create policy product_module_entitlement on %I.%I as restrictive for all to authenticated using ((select app_private.has_product_module(%L))) with check ((select app_private.has_product_module(%L)))',
      v_resource.resource_schema, v_resource.resource_name, 'modules.carebase', 'modules.carebase'
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Sync RPC
-- ---------------------------------------------------------------------------

create or replace function public.sync_offline_clinical_observation_draft(
  p_device_id uuid,
  p_resident_id uuid,
  p_idempotency_key text,
  p_client_occurred_at timestamptz,
  p_observation_type text,
  p_observed_at timestamptz,
  p_value_numeric numeric default null,
  p_value_secondary numeric default null,
  p_value_text text default null,
  p_unit text default null,
  p_custom_label text default null,
  p_loinc_code text default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.offline_device_registrations%rowtype;
  v_existing public.offline_observation_draft_receipts%rowtype;
  v_resident public.residents%rowtype;
  v_observation_id uuid;
  v_outcome text;
  v_error_message text;
begin
  -- Device-ownership boundary first, as a hard failure rather than a soft outcome: a device_id that
  -- does not exist, or belongs to another profile, is a caller passing an id it has no claim to --
  -- not "my device was revoked" (that is the wipe_required branch). Mirrors
  -- sync_offline_service_task_draft's own ownership check.
  select * into v_device from public.offline_device_registrations where id = p_device_id for update;
  if not found or v_device.profile_id <> auth.uid() then
    raise exception 'Offline device is outside caller identity' using errcode = '42501';
  end if;

  -- Replay before any write path, so a retry whose receipt already exists can never collide with the
  -- unique constraint or chart the reading a second time. As with the service lane, a replay returns
  -- what actually happened the first time: reporting a blanket 'duplicate' over a 'rejected' receipt
  -- would tell the client the reading was stored and it would delete the only local copy of one that
  -- never applied.
  select * into v_existing from public.offline_observation_draft_receipts
  where device_id = p_device_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'receiptId', v_existing.id,
      'observationId', v_existing.observation_id,
      'outcome', case
        when v_existing.outcome in ('applied', 'duplicate') then 'duplicate'
        else v_existing.outcome
      end,
      'errorMessage', v_existing.error_message
    );
  end if;

  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;

  if v_device.status <> 'active' or v_device.wipe_required_at is not null then
    -- This IS my device, but its offline access was turned off since the draft was queued. No
    -- attempt against record_clinical_observation is made; nothing is charted.
    v_outcome := 'wipe_required';
    v_error_message := null;
  else
    begin
      v_observation_id := public.record_clinical_observation(
        p_resident_id, p_observation_type, p_observed_at,
        p_value_numeric, p_value_secondary, p_value_text, p_unit,
        p_custom_label, p_loinc_code, p_note
      );
      v_outcome := 'applied';
      v_error_message := null;
    exception
      -- Authorization (caller scope, facility clinical switch, module entitlement) and validation
      -- (unknown observation type, no value supplied) errors from record_clinical_observation.
      -- Neither is a state the local draft can recover from by itself, so both are terminal for it.
      when insufficient_privilege then
        v_outcome := 'rejected';
        v_error_message := sqlerrm;
      when others then
        v_outcome := 'rejected';
        v_error_message := sqlerrm;
    end;
  end if;

  insert into public.offline_observation_draft_receipts(
    organization_id, profile_id, device_id, resident_id, idempotency_key, client_occurred_at,
    observation_type, observation_id, outcome, error_message
  ) values (
    v_resident.organization_id, auth.uid(), p_device_id, p_resident_id, p_idempotency_key,
    p_client_occurred_at, p_observation_type, v_observation_id, v_outcome, v_error_message
  ) returning * into v_existing;

  return jsonb_build_object(
    'receiptId', v_existing.id,
    'observationId', v_existing.observation_id,
    'outcome', v_outcome,
    'errorMessage', v_error_message
  );
end;
$$;

revoke all on function public.sync_offline_clinical_observation_draft(
  uuid, uuid, text, timestamptz, text, timestamptz, numeric, numeric, text, text, text, text, text
) from public, anon, service_role;
grant execute on function public.sync_offline_clinical_observation_draft(
  uuid, uuid, text, timestamptz, text, timestamptz, numeric, numeric, text, text, text, text, text
) to authenticated;
