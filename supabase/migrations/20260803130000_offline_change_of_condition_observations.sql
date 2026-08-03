-- Offline change-of-condition monitoring observations (BACKLOG.md E5, Tier 3 -- closes the row).
--
-- WHAT THIS COVERS. A change-of-condition event carries monitoring instructions and a frequency --
-- "check every two hours for 24 hours". That cadence is the whole point of the record: it is the
-- evidence that a resident whose condition changed was actually watched. An aide walking that
-- cadence is in resident rooms and back hallways, which is exactly where facility wifi is worst, and
-- an observation that cannot be filed at the bedside is either lost or written up later from memory.
-- Tiers 1 and 2 gave the floor queue and unscheduled care an offline path; the monitoring cadence
-- had none.
--
-- WHY MONITORING OBSERVATIONS AND NOT NEW EVENTS. create_resident_change_event is deliberately
-- excluded from the offline path. It is not a documentation call -- it opens a regulatory workflow,
-- creating a compliance item with its own due date, optionally an incident, follow-ups, and a
-- significant-change reassessment. It also has no idempotency or duplicate rule of its own: two
-- aides who both find the same resident on the floor, both offline, produce two events on sync, and
-- therefore two compliance items and two incidents for one fall. Deduplicating regulatory records
-- after the fact is materially worse than the aide getting a plain "you are offline" and telling a
-- supervisor in person -- which is what the initial identification of a change of condition actually
-- requires anyway. Monitoring entries have the opposite shape: append-only, one per observation,
-- with no shared slot two people can contend for.
--
-- AUTHORIZATION IS NOT REIMPLEMENTED, same as Tier 2. add_change_event_monitoring owns the rule
-- (app_private.assert_change_event_contributor: an employee may record only on an event assigned to
-- them, at their own active facility; managers are scoped to their facility). SECURITY DEFINER
-- preserves auth.uid() through the call, so the rule applies to the real caller exactly as online.
--
-- Rollback (only valid while no change_observation receipt exists; dropping the column would
-- otherwise destroy the only server-side record of those attempts, and this table is append-only
-- precisely so that cannot happen quietly):
--   drop function public.sync_offline_change_observation_draft(
--     uuid, uuid, text, timestamptz, text, text, boolean);
--   drop index if exists public.offline_service_draft_receipts_change_event_id_idx;
--   alter table public.offline_service_draft_receipts
--     drop constraint offline_draft_receipt_kind_shape_check,
--     drop constraint offline_service_draft_receipts_draft_kind_check,
--     drop column change_event_id;
--   alter table public.offline_service_draft_receipts
--     add constraint offline_service_draft_receipts_draft_kind_check
--       check (draft_kind in ('service_task', 'unscheduled_service')),
--     add constraint offline_draft_receipt_kind_shape_check check (
--       (draft_kind = 'service_task' and task_id is not null and response is not null)
--       or (draft_kind = 'unscheduled_service' and resident_id is not null and service_kind is not null));
--   -- Section 3 below needs no rollback: it re-tests the same revoked-device state through columns
--   -- every writer already sets together, so reverting it would only restore a weaker check.

------------------------------------------------------------------------------------------------
-- 1. A third kind on the same ledger.
--
-- Still one table, for the reason Tier 2 gave: `unique (device_id, idempotency_key)` is the promise
-- the whole design rests on, and it has to hold across every kind a device can generate. A third
-- table would be a third independent uniqueness domain and a third place to look when auditing what
-- a device sent.
------------------------------------------------------------------------------------------------
alter table public.offline_service_draft_receipts
  drop constraint offline_service_draft_receipts_draft_kind_check;

alter table public.offline_service_draft_receipts
  add constraint offline_service_draft_receipts_draft_kind_check
    check (draft_kind in ('service_task', 'unscheduled_service', 'change_observation'));

-- on delete cascade matches this table's other parent references (task_id, resident_id) rather than
-- resident_change_monitoring_entries' `on delete restrict` on the same event. In practice the two
-- behave identically here: prevent_offline_service_draft_receipt_mutation blocks the row delete a
-- cascade would perform, so either spelling makes deleting the parent event fail. Matching the
-- table's own convention keeps the three kinds readable as one thing.
--
-- ONE KNOWN EDGE, SHARED WITH BOTH OTHER TIERS. This foreign key is checked when the receipt is
-- written, which is after the outcome has been decided -- so a caller that fabricates an event id
-- that exists nowhere gets a raw FK violation instead of the clean 'rejected' receipt the header of
-- 20260802060000 promises on every attempt. task_id and resident_id have carried exactly this
-- property since Tiers 1 and 2 shipped, and it is not reachable from the client: an id only enters a
-- draft by being read from the server first, and these three parents cannot practically be deleted
-- (monitoring entries reference the event `on delete restrict`, and this table's own append-only
-- trigger blocks the cascade). The failure is also not lossy -- the client marks the draft `error`
-- and keeps it. Left matching the other two rather than diverging for one kind; worth closing across
-- all three tiers together if it is ever closed at all.
alter table public.offline_service_draft_receipts
  add column if not exists change_event_id uuid
    references public.resident_change_events(id) on delete cascade;

create index if not exists offline_service_draft_receipts_change_event_id_idx
  on public.offline_service_draft_receipts (change_event_id);

alter table public.offline_service_draft_receipts
  drop constraint offline_draft_receipt_kind_shape_check;

alter table public.offline_service_draft_receipts
  add constraint offline_draft_receipt_kind_shape_check check (
    (draft_kind = 'service_task'
      and task_id is not null and response is not null)
    or (draft_kind = 'unscheduled_service'
      and resident_id is not null and service_kind is not null)
    or (draft_kind = 'change_observation'
      and change_event_id is not null)
  );

-- WHAT THIS COLUMN SET DELIBERATELY OMITS: the observation text itself. Tier 2 made the same call
-- for its note, and here it matters more. This table is append-only -- update and delete both raise
-- -- so anything written into it is permanent. An observation that syncs as 'rejected' or 'stale'
-- never becomes part of the resident's record at all; copying its clinical text into a ledger that
-- can never be corrected or removed would create a second, permanent, unreachable copy of exactly
-- the content the resident's own record deliberately does not have. The receipt records that an
-- attempt happened, against which event, and what the server decided. The observation lives in
-- resident_change_monitoring_entries when it applies, and nowhere on the server when it does not.
comment on column public.offline_service_draft_receipts.change_event_id is
  'The change-of-condition event a change_observation attempt was filed against. The observation '
  'text itself is deliberately not stored here -- see 20260803130000. BACKLOG.md E5 Tier 3.';

comment on column public.offline_service_draft_receipts.draft_kind is
  'Which offline surface produced this attempt. service_task rows carry task_id + response; '
  'unscheduled_service rows carry resident_id + service_kind; change_observation rows carry '
  'change_event_id. One ledger so that (device_id, idempotency_key) stays unique across all three.';

------------------------------------------------------------------------------------------------
-- 2. Sync one monitoring observation.
--
-- Same order of checks as Tiers 1 and 2 -- device ownership as a hard failure, then the idempotency
-- replay returning the ORIGINAL outcome, then the clock judgment, then the apply.
------------------------------------------------------------------------------------------------
create or replace function public.sync_offline_change_observation_draft(
  p_device_id uuid,
  p_event_id uuid,
  p_idempotency_key text,
  p_client_observed_at timestamptz,
  p_observations text,
  p_action_taken text default null,
  p_supervisor_notified boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.offline_device_registrations%rowtype;
  v_existing public.offline_service_draft_receipts%rowtype;
  v_receipt public.offline_service_draft_receipts%rowtype;
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
  select * into v_existing from public.offline_service_draft_receipts
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

  insert into public.offline_service_draft_receipts (
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
end $$;

comment on function public.sync_offline_change_observation_draft(
  uuid, uuid, text, timestamptz, text, text, boolean
) is
  'Applies one offline-captured change-of-condition monitoring observation, idempotent per '
  '(device, key), delegating the caller-scope rule to add_change_event_monitoring. An event closed '
  'while the device was offline returns ''stale'' rather than ''rejected'', because the observation '
  'is real and needs a human, not a retry. BACKLOG.md E5 Tier 3.';

revoke all on function public.sync_offline_change_observation_draft(
  uuid, uuid, text, timestamptz, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.sync_offline_change_observation_draft(
  uuid, uuid, text, timestamptz, text, text, boolean)
  to authenticated;

------------------------------------------------------------------------------------------------
-- 3. Align Tier 2's revoked-device check with Tier 1's and Tier 3's.
--
-- sync_offline_unscheduled_service_draft tested only `revoked_at is not null`. Every writer of
-- offline_device_registrations sets status, revoked_at and wipe_required_at in the same statement,
-- so no currently-reachable state distinguishes the two spellings and this changes no behaviour
-- today. It is worth a migration anyway: a revoked-device check that a later, unrelated change can
-- silently defeat by moving one column and not another is a security boundary held together by
-- coincidence. Body below is the LIVE definition with exactly that one line replaced -- every other
-- line is byte-identical to what is deployed.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_offline_unscheduled_service_draft(p_device_id uuid, p_resident_id uuid, p_idempotency_key text, p_client_occurred_at timestamp with time zone, p_service_kind text, p_duration_minutes integer DEFAULT NULL::integer, p_requires_two_staff boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_device public.offline_device_registrations%rowtype;
  v_existing public.offline_service_draft_receipts%rowtype;
  v_receipt public.offline_service_draft_receipts%rowtype;
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
  select * into v_existing from public.offline_service_draft_receipts
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

  insert into public.offline_service_draft_receipts (
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
