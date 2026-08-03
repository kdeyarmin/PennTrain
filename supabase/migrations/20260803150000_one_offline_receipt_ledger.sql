-- Absorb the observation receipts into the one ledger (BACKLOG.md open question 8, second half).
--
-- 20260803090000 argued for a single ledger and widened offline_service_draft_receipts with a
-- draft_kind discriminator rather than copying it: `unique (device_id, idempotency_key)` "has to
-- hold across BOTH kinds", and two tables mean "two places to look when auditing what a device
-- sent". 20260803110000 then added offline_observation_draft_receipts as a second table anyway --
-- written before that merge, but a divergence all the same, and the register recorded it rather
-- than letting it look considered. 20260803140000 renamed the survivor lane-neutral so this could
-- be a plain widening. This is that widening.
--
-- WHY THE UNIQUENESS ARGUMENT IS NOT ACADEMIC HERE. The observation lane's own header calls its
-- unique (device_id, idempotency_key) "the only thing preventing a reconnect from double-charting a
-- vital sign". While that constraint lived in a separate table, a device could mint the same key for
-- an observation and for a service draft and collide with neither. Both lanes use
-- crypto.randomUUID(), so nothing has actually collided -- but a promise that holds by luck is not
-- the promise the header claims. After this it holds by construction.
--
-- THE OUTCOME VOCABULARY WIDENS, AND THAT IS A REAL LOSS TO ACKNOWLEDGE. The observation table
-- constrained outcome to applied/duplicate/rejected/wipe_required and argued that 'conflict' and
-- 'stale' are values its flow can never produce -- correct, and a useful thing for a CHECK to say.
-- The shared ledger permits all six, so that particular statement stops being enforced by the
-- column. It is not enforceable in a shared table without a per-kind CHECK arm, and adding one
-- would re-encode a rule the sync function already guarantees by never writing those values. The
-- shape CHECK below still pins what each kind must CARRY, which is the part that catches a
-- malformed row.
--
-- ROW MIGRATION. The move is an INSERT ... SELECT with an explicit assertion afterwards, not a
-- best-effort copy. These rows are append-only evidence of what devices sent; losing one silently
-- would be worse than failing the migration, and unlike the rename this cannot be undone by
-- renaming back.
--
-- Rollback: re-run 20260803110000's table/policy/trigger/registry block to recreate
-- offline_observation_draft_receipts, copy the draft_kind = 'clinical_observation' rows back,
-- restore sync_offline_clinical_observation_draft against it, then drop that kind from both CHECKs
-- and drop observation_type/observation_id. Only safe while no observation receipt has been written
-- since; after that the copy back is lossy, because the shared ledger permits outcomes the
-- observation table's CHECK refuses.

------------------------------------------------------------------------------------------------
-- 1. Widen the surviving ledger.
------------------------------------------------------------------------------------------------
alter table public.offline_draft_receipts
  add column if not exists observation_type text check (
    observation_type is null or length(observation_type) between 1 and 100
  ),
  add column if not exists observation_id uuid
    references public.clinical_observations(id) on delete set null;

alter table public.offline_draft_receipts
  drop constraint offline_service_draft_receipts_draft_kind_check;

alter table public.offline_draft_receipts
  add constraint offline_service_draft_receipts_draft_kind_check
    check (draft_kind in (
      'service_task', 'unscheduled_service', 'change_observation', 'clinical_observation'
    ));

alter table public.offline_draft_receipts
  drop constraint offline_draft_receipt_kind_shape_check;

alter table public.offline_draft_receipts
  add constraint offline_draft_receipt_kind_shape_check check (
    (draft_kind = 'service_task'
      and task_id is not null and response is not null)
    or (draft_kind = 'unscheduled_service'
      and resident_id is not null and service_kind is not null)
    or (draft_kind = 'change_observation'
      and change_event_id is not null)
    or (draft_kind = 'clinical_observation'
      and resident_id is not null and observation_type is not null)
  );

create index if not exists offline_draft_receipts_observation_id_idx
  on public.offline_draft_receipts (observation_id);

comment on column public.offline_draft_receipts.draft_kind is
  'Which offline surface produced this attempt. service_task rows carry task_id + response; '
  'unscheduled_service rows carry resident_id + service_kind; change_observation rows carry '
  'change_event_id; clinical_observation rows carry resident_id + observation_type. One ledger, so '
  '(device_id, idempotency_key) is unique across every kind a device can generate.';

------------------------------------------------------------------------------------------------
-- 2. Move the rows, then prove none were lost.
------------------------------------------------------------------------------------------------
-- The collision this merge could theoretically hit, checked up front so it reports itself instead
-- of surfacing as a bare 23505 from the INSERT below. Two independent uniqueness domains are being
-- folded into one, so a device that used the same key in both lanes would now be a duplicate. Both
-- lanes mint keys with crypto.randomUUID(), so this should never fire -- but "should never" is the
-- reason to say what happened rather than leave an operator staring at a constraint name.
do $$
declare
  v_collisions bigint;
begin
  select count(*) into v_collisions
  from public.offline_observation_draft_receipts o
  join public.offline_draft_receipts r
    on r.device_id = o.device_id and r.idempotency_key = o.idempotency_key;
  if v_collisions > 0 then
    raise exception 'Cannot merge the receipt ledgers: % observation receipt(s) reuse a (device_id, idempotency_key) already present in offline_draft_receipts. Re-key the observation rows before rerunning.', v_collisions;
  end if;
end $$;

insert into public.offline_draft_receipts (
  id, organization_id, profile_id, device_id, draft_kind, resident_id, idempotency_key,
  client_occurred_at, observation_type, observation_id, outcome, error_message, processed_at
)
select
  id, organization_id, profile_id, device_id, 'clinical_observation', resident_id, idempotency_key,
  client_occurred_at, observation_type, observation_id, outcome, error_message, processed_at
from public.offline_observation_draft_receipts;

do $$
declare
  v_source bigint;
  v_moved bigint;
begin
  select count(*) into v_source from public.offline_observation_draft_receipts;
  select count(*) into v_moved from public.offline_draft_receipts
   where draft_kind = 'clinical_observation';
  if v_moved <> v_source then
    raise exception 'Receipt migration lost rows: % in the source table, % landed in the ledger', v_source, v_moved;
  end if;
end $$;

------------------------------------------------------------------------------------------------
-- 3. Retarget the fourth sync function.
--
-- Recreated from its LIVE definition (pg_get_functiondef) with four references to the absorbed
-- table substituted and 'clinical_observation' added to the receipt insert, exactly as
-- 20260803140000 did for the other three. Every other line was asserted byte-identical against the
-- live body before this file was written -- the whole point of copying the live definition rather
-- than the source migration is that the source migration is not necessarily what is deployed.
--
-- The draft_kind column defaults to 'service_task', so adding it to the insert list is not
-- cosmetic: without it every observation receipt would be written under the wrong kind and
-- immediately fail the shape CHECK widened in section 1.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_offline_clinical_observation_draft(p_device_id uuid, p_resident_id uuid, p_idempotency_key text, p_client_occurred_at timestamp with time zone, p_observation_type text, p_observed_at timestamp with time zone, p_value_numeric numeric DEFAULT NULL::numeric, p_value_secondary numeric DEFAULT NULL::numeric, p_value_text text DEFAULT NULL::text, p_unit text DEFAULT NULL::text, p_custom_label text DEFAULT NULL::text, p_loinc_code text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_device public.offline_device_registrations%rowtype;
  v_existing public.offline_draft_receipts%rowtype;
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
  select * into v_existing from public.offline_draft_receipts
  where device_id = p_device_id and idempotency_key = p_idempotency_key;
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

  -- Existence only -- nothing is read off this row for scoping (see the receipt insert below). It is
  -- still load-bearing: offline_draft_receipts.resident_id carries a foreign key, so a
  -- bogus id would abort the receipt insert with a raw constraint violation instead of the clean
  -- JSON outcome every other failure path returns, breaking the always-write-a-receipt guarantee.
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
  insert into public.offline_draft_receipts(
    organization_id, profile_id, device_id, draft_kind, resident_id, idempotency_key,
    client_occurred_at, observation_type, observation_id, outcome, error_message
  ) values (
    v_device.organization_id, v_device.profile_id, v_device.id, 'clinical_observation',
    p_resident_id, p_idempotency_key,
    p_client_occurred_at, p_observation_type, v_observation_id, v_outcome, v_error_message
  ) returning * into v_existing;

  -- Both sibling sync RPCs stamp this (sync_offline_service_task_draft, sync_offline_learning_action);
  -- without it a device that only ever syncs vitals reads as never-synced.
  update public.offline_device_registrations set last_sync_at = now() where id = v_device.id;

  return jsonb_build_object(
    'receiptId', v_existing.id,
    'observationId', v_existing.observation_id,
    'abnormalFlag', (
      select o.abnormal_flag from public.clinical_observations o
      where o.id = v_existing.observation_id and not o.entered_in_error
    ),
    'outcome', v_outcome,
    'errorMessage', v_error_message
  );
end;
$function$

;

------------------------------------------------------------------------------------------------
-- 4. Retire the absorbed ledger.
--
-- The two registries come out FIRST and with row-count assertions, for the same reason
-- 20260803140000 asserted its updates: they key on the table NAME, so nothing in Postgres links
-- them to the table being dropped. A leftover product_module_resources row would keep advertising
-- a resource that no longer exists to modules.carebase entitlement enforcement; a leftover
-- audit_entity_manifest row would keep appearing in get_audit_coverage, whose to_regclass lookup
-- quietly returns null for a dropped table. Neither would error. Both would be a governance
-- registry describing a table nobody can query.
--
-- Asserting the DELETE count rather than the post-state is the deliberate choice here: "the row is
-- gone" is also true if it was never there, which would mean this migration ran against a database
-- where the absorbed table was never registered -- itself a fact worth failing on.
------------------------------------------------------------------------------------------------
do $$
declare
  v_deleted bigint;
begin
  delete from app_private.product_module_resources
  where resource_schema = 'public' and resource_name = 'offline_observation_draft_receipts';
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'Expected exactly one product_module_resources row for the absorbed observation ledger, deleted %', v_deleted;
  end if;

  delete from app_private.audit_entity_manifest
  where table_name = 'offline_observation_draft_receipts';
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'Expected exactly one audit_entity_manifest row for the absorbed observation ledger, deleted %', v_deleted;
  end if;
end $$;

-- Takes its own indexes, its RLS policies (offline_observation_draft_receipts_select and
-- product_module_entitlement) and its two append-only triggers with it. Deliberately not `if
-- exists`: on a database where this table is already gone, something other than this migration
-- removed it and that should stop the deploy rather than pass silently.
drop table public.offline_observation_draft_receipts;

-- Only those two triggers ever called it, and both went with the table above. The surviving ledger
-- has its own guard (app_private.prevent_offline_draft_receipt_mutation), so leaving this one would
-- be an orphan whose name implies a second ledger still exists.
drop function app_private.prevent_offline_observation_receipt_mutation();

------------------------------------------------------------------------------------------------
-- 5. Say what the survivor now is.
--
-- The comment and rationale 20260803140000 wrote were accurate for three kinds and are now
-- understated. This is the only place either string records which surfaces the ledger covers, so
-- leaving them would make the merge invisible to anyone reading the schema rather than the diff.
------------------------------------------------------------------------------------------------
comment on table public.offline_draft_receipts is
  'One row per offline documentation sync attempt, for every kind a device can produce -- '
  'service_task, unscheduled_service, change_observation and clinical_observation. Append-only; '
  'the outcome column is what the client uses to decide whether the local draft is cleared, '
  'retried, or flagged for human review. It is itself the evidence trail for these attempts, not a '
  'queue. One ledger for all four kinds, so unique (device_id, idempotency_key) holds across every '
  'key a device can mint (BACKLOG.md open question 8).';

update app_private.audit_entity_manifest
set rationale = 'Append-only receipt of every offline documentation sync attempt, across all four '
      'draft kinds including vitals (outcome + server message on every row); the table is itself '
      'the evidence trail, so a row trigger would duplicate it. Absorbed '
      'offline_observation_draft_receipts by 20260803150000.',
    updated_at = now()
where table_name = 'offline_draft_receipts';
