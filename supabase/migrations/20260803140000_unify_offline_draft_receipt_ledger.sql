-- Unify the offline draft receipt ledger (BACKLOG.md item 8, decided 2026-08-03).
--
-- THE DECISION, RESTATED. 20260803090000 argued for one receipt ledger and then
-- 20260803110000 added a second table anyway (offline_observation_draft_receipts), on the
-- grounds that its outcome vocabulary (applied/duplicate/rejected/wipe_required) is
-- narrower than the service ledger's (which also allows conflict/stale) and the vitals
-- lane can never produce the two values it excludes. That reasoning motivated a split, not
-- a rename -- and it did not resolve the actual problem: `unique (device_id,
-- idempotency_key)` is the promise the whole offline design rests on, and a second table is
-- a second, independent uniqueness domain plus a second place to look when auditing what a
-- device sent. Decided: rename the deployed table to a lane-neutral name, then widen it to
-- carry the vitals lane as a fourth draft_kind, exactly as 20260803130000 (E5 Tier 3)
-- already did for change-of-condition observations rather than opening a THIRD table.
-- Every kind keeps its own outcome subset by construction (each sync function only ever
-- writes the outcomes its own apply path can produce); the table's outcome CHECK is already
-- the union of all of them, so widening it costs nothing.
--
-- WHY THIS IS LARGER THAN A RENAME. plpgsql resolves table names at parse time when the
-- function body is compiled, so renaming the relation breaks every deployed function that
-- reads or writes it on its next call. Three functions reference it by name:
-- sync_offline_service_task_draft, sync_offline_unscheduled_service_draft (both from
-- 20260802060000/20260803090000) and sync_offline_change_observation_draft
-- (20260803130000, merged after this row was scoped). All three are reproduced below with
-- only the table-name references substituted -- everything else, including every comment,
-- is byte-identical to the LIVE definition, the same discipline 20260727010100 established
-- for editing a deployed function body safely. sync_offline_clinical_observation_draft
-- (20260803110000) is a genuine rewrite, not a substitution: it moves from its own table to
-- a fourth draft_kind on this one.
--
-- WHAT REPOINTS AUTOMATICALLY VS. WHAT DOES NOT. Indexes, the unique constraint, both
-- triggers, the guard function and the RLS policies all repoint by OID under `alter table
-- ... rename` -- Postgres tracks them by OID, not by the name they were created with, so
-- none of them stop working. Their NAMES still say offline_service_draft_receipts_* until
-- renamed explicitly, which this migration also does, since naming is the entire point of
-- the exercise. Two registry tables are the opposite: they key on the NAME as data, not as
-- a Postgres object reference, so leaving them unrewritten would silently drop the table out
-- of both the entitlement-resource catalogue (product_module_resources) and the audit
-- coverage report (audit_entity_manifest) -- modular_product_entitlements.test.sql's "every
-- classified resource resolves to a real table" ratchet exists precisely to catch that.
--
-- SAFETY CHECK BEFORE ANYTHING ELSE. The merge below folds two independent uniqueness
-- domains into one. Both lanes have only ever minted idempotency keys with
-- crypto.randomUUID() client-side, so a real (device_id, idempotency_key) collision across
-- the two tables is not expected -- but "not expected" is not "impossible", and this
-- migration would rather fail loudly before touching data than silently let one receipt
-- shadow another. See the DO block immediately below.
--
-- ROLLBACK. Not a blind drop-and-lose-data operation: this migration deletes no column
-- values, only relocates them, and the merged table is append-only for ordinary writes. To
-- reverse (only meaningful before any *new* clinical_observation-kind rows have synced
-- through the widened table, since those never existed in the old shape):
--   create table public.offline_observation_draft_receipts (... original 20260803110000 shape ...);
--   insert into public.offline_observation_draft_receipts (
--     id, organization_id, profile_id, device_id, resident_id, idempotency_key,
--     client_occurred_at, observation_type, observation_id, outcome, error_message, processed_at
--   )
--   select id, organization_id, profile_id, device_id, resident_id, idempotency_key,
--     client_occurred_at, observation_type, observation_id, outcome, error_message, processed_at
--   from public.offline_draft_receipts where draft_kind = 'clinical_observation';
--   -- then delete those rows from offline_draft_receipts, drop the columns/constraints this
--   -- migration added, restore sync_offline_clinical_observation_draft's original body, rename
--   -- the table and its indexes/constraints/triggers/function back, and restore both registry
--   -- rows. Not attempted here: a rollback this involved wants the same scrutiny as the forward
--   -- migration, at the time it is actually needed, not a pre-written script that has never run.

------------------------------------------------------------------------------------------------
-- 0. Refuse to proceed if the merge would collide.
------------------------------------------------------------------------------------------------
do $$
declare
  v_collisions int;
begin
  select count(*) into v_collisions
  from public.offline_service_draft_receipts s
  join public.offline_observation_draft_receipts o
    on o.device_id = s.device_id and o.idempotency_key = s.idempotency_key;
  if v_collisions > 0 then
    raise exception
      'offline_service_draft_receipts and offline_observation_draft_receipts share % '
      '(device_id, idempotency_key) pair(s); merging would violate the unified unique '
      'constraint. Resolve the collision before re-running this migration.', v_collisions;
  end if;
end $$;

------------------------------------------------------------------------------------------------
-- 1. Rename the table, and everything on it whose name says "service" as data rather than
--    resolving by OID -- see the header note on what does and does not need this step.
------------------------------------------------------------------------------------------------
alter table public.offline_service_draft_receipts rename to offline_draft_receipts;

alter index offline_service_draft_receipts_organization_id_idx
  rename to offline_draft_receipts_organization_id_idx;
alter index offline_service_draft_receipts_profile_id_idx
  rename to offline_draft_receipts_profile_id_idx;
alter index offline_service_draft_receipts_task_id_idx
  rename to offline_draft_receipts_task_id_idx;
alter index offline_service_draft_receipts_change_event_id_idx
  rename to offline_draft_receipts_change_event_id_idx;

alter table public.offline_draft_receipts
  rename constraint offline_service_draft_receipts_device_id_idempotency_key_key
  to offline_draft_receipts_device_id_idempotency_key_key;

-- Foreign keys are the one class `alter table ... rename` truly leaves untouched -- not because
-- they resolve any differently (they repoint by OID exactly like everything else here), but
-- because Postgres never renames a constraint just because the table wearing it was renamed.
-- Caught by regenerating database.types.ts against this migration: the generator reads
-- constraint names verbatim, so every one of these would otherwise keep reading
-- "offline_service_draft_receipts_*_fkey" in generated client types forever.
alter table public.offline_draft_receipts
  rename constraint offline_service_draft_receipts_organization_id_fkey
  to offline_draft_receipts_organization_id_fkey;
alter table public.offline_draft_receipts
  rename constraint offline_service_draft_receipts_profile_id_fkey
  to offline_draft_receipts_profile_id_fkey;
alter table public.offline_draft_receipts
  rename constraint offline_service_draft_receipts_device_id_fkey
  to offline_draft_receipts_device_id_fkey;
alter table public.offline_draft_receipts
  rename constraint offline_service_draft_receipts_task_id_fkey
  to offline_draft_receipts_task_id_fkey;
alter table public.offline_draft_receipts
  rename constraint offline_service_draft_receipts_resident_id_fkey
  to offline_draft_receipts_resident_id_fkey;
alter table public.offline_draft_receipts
  rename constraint offline_service_draft_receipts_change_event_id_fkey
  to offline_draft_receipts_change_event_id_fkey;

alter trigger prevent_offline_service_draft_receipt_mutation
  on public.offline_draft_receipts rename to prevent_offline_draft_receipt_mutation;
alter trigger prevent_offline_service_draft_receipt_truncate
  on public.offline_draft_receipts rename to prevent_offline_draft_receipt_truncate;
alter function app_private.prevent_offline_service_draft_receipt_mutation()
  rename to prevent_offline_draft_receipt_mutation;

alter policy offline_service_draft_receipts_select on public.offline_draft_receipts
  rename to offline_draft_receipts_select;

------------------------------------------------------------------------------------------------
-- 2. Widen: a fourth draft_kind for the vitals lane, reusing resident_id (already present for
--    unscheduled_service) and adding the two columns unique to a clinical observation.
------------------------------------------------------------------------------------------------
alter table public.offline_draft_receipts
  add column if not exists observation_type text check (
    observation_type is null or length(observation_type) between 1 and 100
  ),
  add column if not exists observation_id uuid references public.clinical_observations(id) on delete set null;

-- A resident_id index never existed on this table (the service/unscheduled kinds' fixed-slot
-- and idempotency lookups both go through device_id + idempotency_key or task_id, not
-- resident_id) but offline_observation_draft_receipts_resident_id_idx did, on the table this
-- migration is about to fold in and drop. Recreated here so a query scoped to one resident's
-- sync history keeps the index it had.
create index if not exists offline_draft_receipts_resident_id_idx
  on public.offline_draft_receipts (resident_id);
create index if not exists offline_draft_receipts_observation_id_idx
  on public.offline_draft_receipts (observation_id);

alter table public.offline_draft_receipts
  drop constraint offline_service_draft_receipts_draft_kind_check;
alter table public.offline_draft_receipts
  add constraint offline_draft_receipts_draft_kind_check
    check (draft_kind in (
      'service_task', 'unscheduled_service', 'change_observation', 'clinical_observation'
    ));

alter table public.offline_draft_receipts
  drop constraint offline_draft_receipt_kind_shape_check;
alter table public.offline_draft_receipts
  add constraint offline_draft_receipts_kind_shape_check check (
    (draft_kind = 'service_task'
      and task_id is not null and response is not null)
    or (draft_kind = 'unscheduled_service'
      and resident_id is not null and service_kind is not null)
    or (draft_kind = 'change_observation'
      and change_event_id is not null)
    or (draft_kind = 'clinical_observation'
      and resident_id is not null and observation_type is not null)
  );

comment on table public.offline_draft_receipts is
  'One row per offline documentation sync attempt, across every offline lane (service_task, '
  'unscheduled_service, change_observation, clinical_observation) -- one ledger so unique '
  '(device_id, idempotency_key) holds across all of them, and so there is one place to audit '
  'what a device sent. Append-only; the outcome column is what the client uses to decide '
  'whether the local draft is cleared, retried, or flagged for human review. Formerly '
  'offline_service_draft_receipts, renamed and widened by 20260803140000 (BACKLOG.md item 8).';
comment on column public.offline_draft_receipts.draft_kind is
  'Which offline surface produced this attempt. service_task rows carry task_id + response; '
  'unscheduled_service rows carry resident_id + service_kind; change_observation rows carry '
  'change_event_id; clinical_observation rows carry resident_id + observation_type. One '
  'ledger so (device_id, idempotency_key) stays unique across all four.';
comment on column public.offline_draft_receipts.observation_type is
  'Set only on clinical_observation rows -- the vitals type the device attempted (e.g. '
  '''blood_pressure'', ''weight''). Mirrors clinical_observations.observation_type.';
comment on column public.offline_draft_receipts.observation_id is
  'Set only on clinical_observation rows once applied -- the resulting clinical_observations '
  'row, so a client that syncs long after the reading was taken can still learn whether the '
  'server flagged it critical. Null for a rejected/wipe_required attempt: nothing was charted.';

------------------------------------------------------------------------------------------------
-- 3. Move offline_observation_draft_receipts' rows in as clinical_observation-kind receipts,
--    then retire the table. Collision-free per the DO block in section 0.
------------------------------------------------------------------------------------------------
insert into public.offline_draft_receipts (
  id, organization_id, profile_id, device_id, idempotency_key, client_occurred_at,
  exception_details, outcome, error_message, processed_at,
  draft_kind, resident_id, observation_type, observation_id
)
select
  id, organization_id, profile_id, device_id, idempotency_key, client_occurred_at,
  '{}'::jsonb, outcome, error_message, processed_at,
  'clinical_observation', resident_id, observation_type, observation_id
from public.offline_observation_draft_receipts;

-- Drops the table's own two triggers, RLS policy and indexes along with it (all owned by the
-- table); the guard function below is a separate object and is not.
drop table public.offline_observation_draft_receipts;
drop function if exists app_private.prevent_offline_observation_receipt_mutation();

-- Name-keyed registry rows: repointing by OID does not apply to these two, and a stale row
-- pointing at a dropped table is exactly what modular_product_entitlements.test.sql's "every
-- classified resource resolves to a real table" ratchet exists to catch.
update app_private.product_module_resources
  set resource_name = 'offline_draft_receipts'
  where resource_schema = 'public' and resource_name = 'offline_service_draft_receipts';
delete from app_private.product_module_resources
  where resource_schema = 'public' and resource_name = 'offline_observation_draft_receipts';

update app_private.audit_entity_manifest
  set table_name = 'offline_draft_receipts',
      rationale = 'Append-only receipt of every offline documentation sync attempt across all '
        'four lanes (outcome + server message on every row); the table is itself the evidence '
        'trail, so a row trigger would duplicate it. Reachable from a resident via task_id, '
        'resident_id, or observation_id depending on draft_kind. Formerly '
        'offline_service_draft_receipts; unified with offline_observation_draft_receipts by '
        '20260803140000 (BACKLOG.md item 8).',
      updated_at = now()
  where table_name = 'offline_service_draft_receipts';
delete from app_private.audit_entity_manifest
  where table_name = 'offline_observation_draft_receipts';

------------------------------------------------------------------------------------------------
-- 4. sync_offline_clinical_observation_draft: rewritten to target the unified table as a
--    fourth draft_kind. This is the one genuine rewrite in this migration -- every other sync
--    function below is table-name substitution only. Logic is otherwise unchanged from the
--    LIVE definition: same device-ownership hard failure, same replay-before-any-write
--    ordering, same wipe precedence over the replay, same outcome vocabulary (this lane still
--    cannot produce conflict or stale -- nothing here changes that; the table simply now
--    permits values other draft_kinds use).
------------------------------------------------------------------------------------------------
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
  v_existing public.offline_draft_receipts%rowtype;
  v_receipt public.offline_draft_receipts%rowtype;
  v_resident public.residents%rowtype;
  v_observation_id uuid;
  v_outcome text;
  v_error_message text;
  v_wipe boolean;
begin
  -- Device-ownership boundary first, as a hard failure rather than a soft outcome: a device_id that
  -- does not exist, or belongs to another profile, is a caller passing an id it has no claim to --
  -- not "my device was revoked" (that is the wipe_required branch). Mirrors
  -- sync_offline_service_task_draft's own ownership check.
  select * into v_device from public.offline_device_registrations where id = p_device_id for update;
  if not found or v_device.profile_id <> auth.uid() then
    raise exception 'Offline device is outside caller identity' using errcode = '42501';
  end if;

  -- Current revocation state, resolved BEFORE the replay branch because it has to dominate it. If
  -- the first attempt committed a receipt but its response was lost, and the device was revoked
  -- before the retry, replaying the stored outcome would tell the client 'applied' or 'rejected' --
  -- and the client only wipes the shared offline store on 'wipe_required'. A rejected draft would
  -- then sit on a revoked device still holding resident PHI, and an applied one would clear that
  -- single draft while ignoring the wipe entirely. A revocation is about the device, not about any
  -- one attempt, so it outranks whatever the ledger remembers.
  v_wipe := v_device.status <> 'active' or v_device.wipe_required_at is not null;

  -- Replay before any write path, so a retry whose receipt already exists can never collide with the
  -- unique constraint or chart the reading a second time. As with the service lane, a replay returns
  -- what actually happened the first time: reporting a blanket 'duplicate' over a 'rejected' receipt
  -- would tell the client the reading was stored and it would delete the only local copy of one that
  -- never applied.
  --
  -- Scoped to this draft_kind, unlike the service lane's shared lookup: the unique constraint spans
  -- all four kinds, but this lane's client only understands {applied, duplicate, rejected,
  -- wipe_required} -- the vocabulary its own retired table's CHECK constraint used to guarantee.
  -- Without this filter, a device_id/idempotency_key collision with another kind's row (astronomically
  -- unlikely with crypto.randomUUID() keys, but not structurally prevented by the shared constraint)
  -- could hand this lane's client a 'conflict' or 'stale' outcome it has no case for.
  select * into v_existing from public.offline_draft_receipts
  where device_id = p_device_id and idempotency_key = p_idempotency_key
    and draft_kind = 'clinical_observation';
  if found then
    return jsonb_build_object(
      'receiptId', v_existing.id,
      'observationId', v_existing.observation_id,
      -- Server-derived, returned rather than recomputed: a reading that syncs long after it was
      -- taken still has to be able to stop a human, and the client holds no copy of the thresholds.
      'abnormalFlag', (
        select o.abnormal_flag from public.clinical_observations o
        where o.id = v_existing.observation_id and not o.entered_in_error
      ),
      'outcome', case
        when v_wipe then 'wipe_required'
        when v_existing.outcome in ('applied', 'duplicate') then 'duplicate'
        else v_existing.outcome
      end,
      -- The stored error belonged to the earlier attempt; on a wipe it would only misdirect a
      -- caregiver toward a validation problem instead of the revocation that now matters.
      'errorMessage', case when v_wipe then null else v_existing.error_message end
    );
  end if;

  -- The scoped lookup above only rules out a replay of THIS lane's own prior attempt; the shared
  -- unique constraint still spans all four kinds, so the same key could belong to someone else's
  -- kind instead. Checked here, before record_clinical_observation runs, rather than left for the
  -- receipt insert below to discover via a raw unique_violation: catching it there (see that
  -- insert's own exception block, kept as a defensive backstop) would still leave a vitals reading
  -- charted with no receipt to show for it, since a caught exception only unwinds the sub-block it
  -- occurred in, not record_clinical_observation's already-committed effects earlier in this call.
  -- The device row's own `for update` lock above already serializes concurrent calls for this
  -- device, so this check and the insert cannot race against a same-device caller of another kind.
  if exists (
    select 1 from public.offline_draft_receipts
    where device_id = p_device_id and idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object(
      'receiptId', null,
      'observationId', null,
      'abnormalFlag', null,
      'outcome', 'rejected',
      'errorMessage', 'This sync key was already used by a different offline draft.'
    );
  end if;

  -- Existence only -- nothing is read off this row for scoping (see the receipt insert below). It is
  -- still load-bearing: offline_draft_receipts.resident_id carries a foreign key, so a bogus id
  -- would abort the receipt insert with a raw constraint violation instead of the clean JSON outcome
  -- every other failure path returns, breaking the always-write-a-receipt guarantee.
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;

  if v_wipe then
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
      -- Neither is a state the local draft can recover from by itself, so both are terminal for it
      -- and land on the same outcome -- unlike sync_offline_service_task_draft, where the branches
      -- genuinely differ (conflict / stale / duplicate), there is nothing here to tell apart.
      when others then
        v_outcome := 'rejected';
        v_error_message := sqlerrm;
    end;
  end if;

  -- Scoped from the device row, which was proven to belong to the caller above -- not from the
  -- resident, whose id is caller-supplied. Sourcing organization_id from p_resident_id would let a
  -- caller holding another tenant's resident UUID stamp that foreign org onto a row in their own
  -- sync history. Nothing reads this column across tenants today, so this is consistency rather than
  -- a live hole -- but it is the same rule sync_offline_service_task_draft already follows, and the
  -- reason it follows it.
  begin
    insert into public.offline_draft_receipts(
      organization_id, profile_id, device_id, draft_kind, resident_id, idempotency_key,
      client_occurred_at, observation_type, observation_id, outcome, error_message
    ) values (
      v_device.organization_id, v_device.profile_id, v_device.id, 'clinical_observation',
      p_resident_id, p_idempotency_key,
      p_client_occurred_at, p_observation_type, v_observation_id, v_outcome, v_error_message
    ) returning * into v_receipt;
  exception
    -- Defensive backstop, not the primary defense -- the cross-kind existence check above already
    -- returns before record_clinical_observation runs for a key any other kind is using, and the
    -- device row's `for update` lock closes the race window between that check and this insert. If
    -- this branch is ever reached anyway, "always return a clean outcome, never a raw constraint
    -- violation" is this function's own guarantee (see the resident-lookup comment above), so it
    -- applies here too.
    when unique_violation then
      return jsonb_build_object(
        'receiptId', null,
        'observationId', null,
        'abnormalFlag', null,
        'outcome', 'rejected',
        'errorMessage', 'This sync key was already used by a different offline draft.'
      );
  end;

  -- Both sibling sync RPCs stamp this (sync_offline_service_task_draft, sync_offline_learning_action);
  -- without it a device that only ever syncs vitals reads as never-synced.
  update public.offline_device_registrations set last_sync_at = now() where id = v_device.id;

  return jsonb_build_object(
    'receiptId', v_receipt.id,
    'observationId', v_receipt.observation_id,
    'abnormalFlag', (
      select o.abnormal_flag from public.clinical_observations o
      where o.id = v_receipt.observation_id and not o.entered_in_error
    ),
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

------------------------------------------------------------------------------------------------
-- 5. The three remaining sync functions: LIVE definitions, table-name references substituted,
--    every other line byte-identical. Same technique 20260727010100 established for editing a
--    deployed function body safely.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_offline_service_task_draft(p_device_id uuid, p_task_id uuid, p_idempotency_key text, p_client_occurred_at timestamp with time zone, p_response text, p_exception_details jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_device public.offline_device_registrations%rowtype;
  v_existing public.offline_draft_receipts%rowtype;
  v_receipt public.offline_draft_receipts%rowtype;
  v_task_status text;
  v_task_recorded_by uuid;
  v_outcome text;
  v_error_message text;
  -- The device's own occurrence time, once validated as plausible -- see below -- or null when it is
  -- not to be trusted. Computed once, ahead of the record_service_task_response call, so both the
  -- 'applied' branch (uses it) and the receipt insert (always stores the raw p_client_occurred_at
  -- regardless, per the header note on why the receipt table does not validate its own columns) stay
  -- in sync with the same judgment of the same input.
  v_performed_at timestamptz;
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
  --
  -- The replay must return what actually happened the first time, not assume it succeeded: if the
  -- server committed a conflict/stale/rejected/wipe_required receipt but the response was lost before
  -- the client received it, the client's retry has to see that same non-applied outcome again so the
  -- draft stays block-and-flagged for a human. Returning a blanket 'duplicate' here would tell the
  -- client the note was recorded and it would delete the only local copy of one that never actually
  -- applied. 'duplicate' is only correct when the first attempt really did succeed (an 'applied'
  -- receipt) or was itself already classified a duplicate.
  select * into v_existing from public.offline_draft_receipts
  where device_id = p_device_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'receiptId', v_existing.id,
      'outcome', case
        when v_existing.outcome in ('applied', 'duplicate') then 'duplicate'
        else v_existing.outcome
      end,
      'errorMessage', v_existing.error_message
    );
  end if;

  -- A client-supplied timestamp is never trusted blindly. A few minutes of future drift is normal
  -- clock skew between an offline device and the server; anything beyond that is more likely a wrong
  -- device clock than a real occurrence time still to come. On the other end, this store's own
  -- unsynced-draft purge ceilings (offlineServiceDraftCache.ts UNSYNCED_PURGE_AFTER_MS /
  -- NEEDS_REVIEW_PURGE_AFTER_MS) mean a legitimate draft is purged from the device well within 7 days,
  -- so a value far older than that is far more likely bad input (a stuck clock, a bug, an adversarial
  -- call) than a genuinely ancient offline queue. An implausible value simply is not trusted for
  -- performed_at below -- it never blocks the sync itself, since the response is still real care.
  v_performed_at := case
    when p_client_occurred_at is not null
      and p_client_occurred_at <= now() + interval '5 minutes'
      and p_client_occurred_at >= now() - interval '30 days'
    then p_client_occurred_at
  end;

  if v_device.status <> 'active' or v_device.wipe_required_at is not null then
    -- This IS my device, but its offline access was turned off since the draft was queued. No
    -- attempt against record_service_task_response is made; nothing about the task changes.
    v_outcome := 'wipe_required';
    v_error_message := null;
  else
    begin
      perform public.record_service_task_response(p_task_id, p_response, coalesce(p_exception_details, '{}'::jsonb), null);
      -- record_service_task_response always stamps performed_at with its own now() -- correct for the
      -- online/Floor path it primarily serves, wrong here: a draft synced hours or days after
      -- reconnecting would otherwise attribute care to the reconnect moment instead of when it was
      -- actually given. resident timelines, recent-exception analytics, and service history all read
      -- this column directly (resident_360_timeline.sql, the exceptionsLast7Days lookback in the same
      -- migration, support_plan_service_task_automation.sql's rule lookback, ...), so getting the day
      -- or shift wrong here is not cosmetic. Overwrite it with the device's own occurrence time --
      -- already validated as a plausible timestamp above, into v_performed_at -- rather than
      -- reimplementing any part of record_service_task_response's own row-lock/status-check path (see
      -- header note).
      if v_performed_at is not null then
        update public.resident_service_task_instances
        set performed_at = v_performed_at
        where id = p_task_id;
      end if;
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

  insert into public.offline_draft_receipts(
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_offline_unscheduled_service_draft(p_device_id uuid, p_resident_id uuid, p_idempotency_key text, p_client_occurred_at timestamp with time zone, p_service_kind text, p_duration_minutes integer DEFAULT NULL::integer, p_requires_two_staff boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_device public.offline_device_registrations%rowtype;
  v_existing public.offline_draft_receipts%rowtype;
  v_receipt public.offline_draft_receipts%rowtype;
  v_outcome text;
  v_error_message text;
  v_occurred_at timestamptz;
begin
  -- A device_id that does not exist, or belongs to another profile, is not "my revoked device" --
  -- it is a caller passing an id it has no claim to. Same boundary, same hard failure, as Tier 1.
  select * into v_device from public.offline_device_registrations where id = p_device_id for update;
  if not found or v_device.profile_id <> auth.uid() then
    raise exception 'Offline device is outside caller identity' using errcode = '42501';
  end if;

  -- Checked before anything that would insert, including the revoked branch below, so a retry
  -- whose receipt already exists can never collide with the unique constraint. The replay returns
  -- the ORIGINAL outcome: reporting a blanket 'duplicate' for a first attempt that was actually
  -- rejected would tell the client the care was recorded, and it would delete the only local copy
  -- of a note that never applied.
  select * into v_existing from public.offline_draft_receipts
  where device_id = p_device_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'receiptId', v_existing.id,
      'outcome', case
        when v_existing.outcome in ('applied', 'duplicate') then 'duplicate'
        else v_existing.outcome
      end,
      'errorMessage', v_existing.error_message
    );
  end if;

  -- Aligned with Tier 1/Tier 3 (20260803130000): wipe_required_at is the column that means "this
  -- device must wipe", and pairing it with the status check still holds if a future path ever moves
  -- only one of the three. Every writer sets all three together today, so this changes no outcome
  -- that is currently reachable -- it removes a way for a later change to silently defeat the check.
  if v_device.status <> 'active' or v_device.wipe_required_at is not null then
    v_outcome := 'wipe_required';
    v_error_message := 'This device''s offline access was revoked.';
  else
    -- Same judgment as Tier 1: a few minutes of future drift is ordinary clock skew between an
    -- offline device and the server, and the client's own purge ceilings mean a legitimate draft
    -- never survives 7 days on the device. An implausible value is not trusted for occurred_at,
    -- but never blocks the sync -- the care itself really happened.
    v_occurred_at := case
      when p_client_occurred_at is null then null
      when p_client_occurred_at > now() + interval '15 minutes' then null
      when p_client_occurred_at < now() - interval '7 days' then null
      else p_client_occurred_at
    end;

    begin
      -- record_unscheduled_service owns the "may this caller record for this resident" rule and
      -- raises 42501/P0002 when the answer is no. Catching it here turns an authorization failure
      -- into a rejected receipt rather than an exception, so the client can block-and-flag the
      -- draft for a human instead of retrying forever.
      perform public.record_unscheduled_service(
        p_resident_id, p_service_kind, v_occurred_at,
        p_duration_minutes, coalesce(p_requires_two_staff, false), p_note
      );
      v_outcome := 'applied';
    exception when others then
      v_outcome := 'rejected';
      v_error_message := left(sqlerrm, 500);
    end;
  end if;

  insert into public.offline_draft_receipts (
    organization_id, profile_id, device_id, draft_kind, resident_id, service_kind,
    idempotency_key, client_occurred_at, exception_details, outcome, error_message
  ) values (
    v_device.organization_id, v_device.profile_id, p_device_id, 'unscheduled_service',
    p_resident_id, p_service_kind, p_idempotency_key,
    coalesce(p_client_occurred_at, now()), '{}'::jsonb, v_outcome, v_error_message
  )
  returning * into v_receipt;

  return jsonb_build_object(
    'receiptId', v_receipt.id,
    'outcome', v_receipt.outcome,
    'errorMessage', v_receipt.error_message
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_offline_change_observation_draft(p_device_id uuid, p_event_id uuid, p_idempotency_key text, p_client_observed_at timestamp with time zone, p_observations text, p_action_taken text DEFAULT NULL::text, p_supervisor_notified boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_device public.offline_device_registrations%rowtype;
  v_existing public.offline_draft_receipts%rowtype;
  v_receipt public.offline_draft_receipts%rowtype;
  v_event_status text;
  v_outcome text;
  v_error_message text;
  v_observed_at timestamptz;
begin
  -- A device_id that does not exist, or belongs to another profile, is not "my revoked device" --
  -- it is a caller passing an id it has no claim to. Same boundary, same hard failure, as Tiers 1-2.
  select * into v_device from public.offline_device_registrations where id = p_device_id for update;
  if not found or v_device.profile_id <> auth.uid() then
    raise exception 'Offline device is outside caller identity' using errcode = '42501';
  end if;

  -- Before anything that inserts, so a retry whose receipt already exists cannot collide with the
  -- unique constraint. The replay returns what actually happened the first time: telling the client
  -- 'duplicate' for an attempt that was really rejected would have it delete the only local copy of
  -- an observation that never applied.
  select * into v_existing from public.offline_draft_receipts
  where device_id = p_device_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'receiptId', v_existing.id,
      'outcome', case
        when v_existing.outcome in ('applied', 'duplicate') then 'duplicate'
        else v_existing.outcome
      end,
      'errorMessage', v_existing.error_message
    );
  end if;

  -- Tier 1's spelling, not Tier 2's. Every writer of this table today sets status/revoked_at/
  -- wipe_required_at together, so the three tests are currently equivalent -- but wipe_required_at is
  -- the column that actually means "this device must wipe", and pairing it with the status check is
  -- the one that still holds if a future path ever moves only one of them.
  if v_device.status <> 'active' or v_device.wipe_required_at is not null then
    v_outcome := 'wipe_required';
    v_error_message := 'This device''s offline access was revoked.';
  else
    -- CLAMPED, NOT NULLED -- the one place this differs from Tiers 1 and 2, and it is forced by the
    -- column: resident_change_monitoring_entries.observed_at is NOT NULL. Passing null for an
    -- implausible client clock would fail the insert and turn a real bedside observation into a
    -- 'rejected' receipt over a device-clock problem the aide has no way to see or fix. Falling back
    -- to now() is the same value the online path would have written, and the raw client value is
    -- still recorded on the receipt below, so a wrong clock stays visible in the ledger rather than
    -- being silently adopted as the observation time.
    --
    -- The window matches Tier 2's rather than Tier 1's wider -30 days: 7 days is the figure actually
    -- derived from the client's own purge ceiling (offlineServiceDraftCache.ts
    -- NEEDS_REVIEW_PURGE_AFTER_MS), so a legitimate draft never survives long enough to need more.
    v_observed_at := case
      when p_client_observed_at is null then now()
      when p_client_observed_at > now() + interval '15 minutes' then now()
      when p_client_observed_at < now() - interval '7 days' then now()
      else p_client_observed_at
    end;

    begin
      perform public.add_change_event_monitoring(
        p_event_id, v_observed_at, p_observations,
        p_action_taken, coalesce(p_supervisor_notified, false)
      );
      v_outcome := 'applied';
    exception
      -- add_change_event_monitoring raises 22023 for two different situations in one condition: the
      -- event is closed, or the observation text is too short. They are not the same failure. A
      -- closed event means the server moved on while the device was offline and a real observation
      -- can no longer be filed -- that is 'stale', and the aide needs to take it to a supervisor
      -- rather than see "this couldn't be submitted". Text that is too short is a client-side bug or
      -- a tampered record, which is 'rejected'. The sub-transaction this block implies has already
      -- rolled back and released the row lock, so the status is re-read fresh rather than trusted
      -- from before the call -- the same reason Tier 1 re-reads the task after its own failure.
      when invalid_parameter_value then
        v_error_message := left(sqlerrm, 500);
        select status into v_event_status
        from public.resident_change_events where id = p_event_id;
        if v_event_status = 'closed' then
          v_outcome := 'stale';
          v_error_message := 'This change-of-condition event was closed before the observation synced.';
        else
          v_outcome := 'rejected';
        end if;
      -- Caller scope (42501 from assert_change_event_contributor), a missing event (P0002), or
      -- anything else this migration did not anticipate. None is recoverable by retrying, and all of
      -- them still owe the caller a receipt rather than a raw error.
      --
      -- There is deliberately no 'conflict' branch. Conflict means another person took the single
      -- slot this draft was for -- a task documented once, in Tier 1. Monitoring entries are
      -- append-only and every observation is its own row, so a second observer never displaces this
      -- one; they simply both exist, which is the correct record of two people looking.
      when others then
        v_outcome := 'rejected';
        v_error_message := left(sqlerrm, 500);
    end;
  end if;

  insert into public.offline_draft_receipts (
    organization_id, profile_id, device_id, draft_kind, change_event_id,
    idempotency_key, client_occurred_at, exception_details, outcome, error_message
  ) values (
    v_device.organization_id, v_device.profile_id, p_device_id, 'change_observation',
    p_event_id, p_idempotency_key,
    coalesce(p_client_observed_at, now()), '{}'::jsonb, v_outcome, v_error_message
  )
  returning * into v_receipt;

  update public.offline_device_registrations set last_sync_at = now() where id = v_device.id;

  return jsonb_build_object(
    'receiptId', v_receipt.id,
    'outcome', v_receipt.outcome,
    'errorMessage', v_receipt.error_message
  );
end $function$
;
