-- Give the offline receipt ledger a lane-neutral name (BACKLOG.md open question 8).
--
-- WHAT WAS WRONG WITH THE NAME. offline_service_draft_receipts was accurate when it held one kind
-- of thing. It now holds three, and the newest -- change_observation, added by 20260803130000 --
-- points at a resident_change_events row. That is clinical, PHI-linked evidence sitting behind a
-- name that says "service lane", and the register recorded it as the sharper half of the problem:
-- a reader auditing where clinical offline attempts are recorded would not think to look here.
--
-- WHY A RENAME AND NOT A NEW TABLE. The rows are append-only evidence of what devices sent. Copying
-- them into a differently-named table and dropping the original would rewrite that evidence's
-- identity for no reason; `alter table ... rename` keeps the OID, the data, the indexes, the
-- constraints, the policies and the triggers exactly as they are, and changes only the label.
--
-- WHAT A RENAME DOES NOT CARRY, WHICH IS THE WHOLE RISK.
--
--   1. app_private.product_module_resources.resource_name and
--      app_private.audit_entity_manifest.table_name key on the NAME, not the OID. Left alone, the
--      table silently drops out of modules.carebase entitlement enforcement and out of the audit
--      coverage report -- it would not error, it would simply stop being governed, which is the
--      worst way for this to fail.
--   2. The three sync functions embed the table name in their bodies. PL/pgSQL resolves that at
--      execution, so every offline sync would start raising "relation does not exist" the moment
--      this deployed. They are recreated below from their LIVE definitions with only the table
--      name substituted -- every other line asserted byte-identical before this file was written.
--
-- WHAT IS DELIBERATELY NOT IN THIS MIGRATION. offline_observation_draft_receipts is still a second
-- ledger. Absorbing it is the other half of open question 8 and it is a data migration between two
-- append-only PHI tables plus a fourth sync function to retarget -- a different kind of change from
-- a rename, and one that deserves its own reviewable diff. This half stands on its own: it fixes
-- the naming problem for the three kinds already here, and it leaves the surviving table neutrally
-- named so that absorbing the fourth kind becomes a plain widening rather than a widening plus a
-- rename.
--
-- Index and constraint names are left as they are. Renaming them would be pure churn in a file
-- whose risk should stay concentrated in the two registry rows and the three function bodies.
--
-- Rollback:
--   alter table public.offline_draft_receipts rename to offline_service_draft_receipts;
--   update app_private.product_module_resources set resource_name = 'offline_service_draft_receipts'
--     where resource_schema = 'public' and resource_name = 'offline_draft_receipts';
--   update app_private.audit_entity_manifest set table_name = 'offline_service_draft_receipts'
--     where table_name = 'offline_draft_receipts';
--   -- then recreate the three sync functions against the old name.

------------------------------------------------------------------------------------------------
-- 1. The rename itself.
------------------------------------------------------------------------------------------------
alter table public.offline_service_draft_receipts rename to offline_draft_receipts;

comment on table public.offline_draft_receipts is
  'One row per offline documentation sync attempt, for every kind a device can produce -- '
  'service_task, unscheduled_service and change_observation. Append-only; the outcome column is '
  'what the client uses to decide whether the local draft is cleared, retried, or flagged for '
  'human review. It is itself the evidence trail for these attempts, not a queue. Named for the '
  'ledger it is rather than the lane it started as (BACKLOG.md open question 8).';

------------------------------------------------------------------------------------------------
-- 2. The two registries that key on the name rather than the OID.
--
-- Asserted rather than assumed: if either update matches no row the table has quietly fallen out
-- of entitlement enforcement or audit coverage, and failing the migration is far better than
-- discovering that from a coverage report months later.
------------------------------------------------------------------------------------------------
update app_private.product_module_resources
set resource_name = 'offline_draft_receipts'
where resource_schema = 'public' and resource_name = 'offline_service_draft_receipts';

do $$
begin
  if not exists (
    select 1 from app_private.product_module_resources
    where resource_schema = 'public' and resource_name = 'offline_draft_receipts'
  ) then
    raise exception 'Renamed ledger is not registered in product_module_resources; it would lose modules.carebase entitlement enforcement';
  end if;
end $$;

update app_private.audit_entity_manifest
set table_name = 'offline_draft_receipts',
    rationale = 'Append-only receipt of every offline documentation sync attempt, across all draft '
      'kinds (outcome + server message on every row); the table is itself the evidence trail, so a '
      'row trigger would duplicate it. Renamed from offline_service_draft_receipts by '
      '20260803140000.',
    updated_at = now()
where table_name = 'offline_service_draft_receipts';

do $$
begin
  if not exists (
    select 1 from app_private.audit_entity_manifest where table_name = 'offline_draft_receipts'
  ) then
    raise exception 'Renamed ledger is missing from audit_entity_manifest; it would drop out of the audit coverage report';
  end if;
end $$;

------------------------------------------------------------------------------------------------
-- 3. The three sync functions, which embed the old name.
--
-- Bodies below are the deployed definitions with the table name substituted on the four lines that
-- mention it; every other line was asserted byte-identical to what is live before this file was
-- written, so this section changes no behaviour whatsoever.
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
$function$;

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
end $function$;

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
end $function$;
------------------------------------------------------------------------------------------------
-- 4. The append-only guard, which now misdescribes what it protects.
--
-- 20260802060000 refused to reuse app_private.prevent_phase4_evidence_mutation for exactly this
-- reason -- "its name and message are specifically about the Phase 4 learning tables, and reusing
-- it here would misdescribe what actually failed to a future reader of a Postgres error log."
-- After the rename that objection applies to this guard's own name and message, so the same
-- standard is applied to it rather than left as the one exception.
--
-- Renamed rather than recreated: triggers bind to the function by OID, so both existing triggers
-- follow the rename with no drop/create and no window in which the table is unprotected.
------------------------------------------------------------------------------------------------
alter function app_private.prevent_offline_service_draft_receipt_mutation()
  rename to prevent_offline_draft_receipt_mutation;

create or replace function app_private.prevent_offline_draft_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Offline draft receipts are append-only' using errcode = '55000';
end;
$$;
