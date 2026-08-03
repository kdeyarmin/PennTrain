-- Offline documentation for UNSCHEDULED services (BACKLOG.md E5, Tier 2).
--
-- Tier 1 let a direct-care employee document a floor task while offline, but only one that was
-- already queued: OfflineServiceDraft carries a taskId and sync_offline_service_task_draft
-- resolves it against resident_service_task_instances. Care that was not on the queue -- the
-- reason unscheduled services exist as a concept at all -- had no offline path. An aide in a back
-- hallway with no signal could record a scheduled reposition and not the unscheduled one they did
-- five minutes earlier, which is precisely backwards: the unplanned care is the part nobody else
-- knows happened.
--
-- ONE RECEIPT LEDGER, NOT TWO. offline_service_draft_receipts gains a draft_kind discriminator
-- rather than being copied. Its `unique (device_id, idempotency_key)` is the guarantee the whole
-- design rests on, and it has to hold across BOTH kinds -- a device that generated the same key
-- twice for different kinds must still collide. Two tables would give two independent uniqueness
-- domains and a silently weaker promise, plus two places to look when auditing what a device sent.
--
-- AUTHORIZATION IS NOT REIMPLEMENTED. The sync function calls record_unscheduled_service, which
-- already decides who may record for which resident ("an aide can record for a resident at the
-- facility they are actively assigned to, and nowhere else"). Restating that rule here would give
-- the offline path its own copy to drift out of step with -- the same failure this program has
-- already hit twice with duplicated predicates. SECURITY DEFINER preserves auth.uid() through the
-- call, so the rule applies to the real caller exactly as it does online.
--
-- Rollback:
--   drop function public.sync_offline_unscheduled_service_draft(
--     uuid, uuid, text, timestamptz, text, integer, boolean, text);
--   alter table public.offline_service_draft_receipts
--     drop constraint offline_draft_receipt_kind_shape_check,
--     drop column draft_kind, drop column resident_id, drop column service_kind;
--   alter table public.offline_service_draft_receipts
--     alter column task_id set not null, alter column response set not null;

------------------------------------------------------------------------------------------------
-- 1. Widen the receipt ledger to carry either kind.
------------------------------------------------------------------------------------------------
alter table public.offline_service_draft_receipts
  add column if not exists draft_kind text not null default 'service_task'
    check (draft_kind in ('service_task', 'unscheduled_service')),
  add column if not exists resident_id uuid references public.residents(id) on delete cascade,
  add column if not exists service_kind text check (
    service_kind is null or length(service_kind) between 1 and 100
  );

-- Existing rows are all Tier 1 and keep their values; these two only become optional so the
-- unscheduled kind can leave them empty.
alter table public.offline_service_draft_receipts alter column task_id drop not null;
alter table public.offline_service_draft_receipts alter column response drop not null;

-- Dropping NOT NULL from two columns would otherwise let a service_task receipt be written with
-- no task and no response at all. The discriminator has to carry that weight now.
alter table public.offline_service_draft_receipts
  add constraint offline_draft_receipt_kind_shape_check check (
    (draft_kind = 'service_task'
      and task_id is not null and response is not null)
    or (draft_kind = 'unscheduled_service'
      and resident_id is not null and service_kind is not null)
  );

comment on column public.offline_service_draft_receipts.draft_kind is
  'Which offline surface produced this attempt. service_task rows carry task_id + response; '
  'unscheduled_service rows carry resident_id + service_kind. One ledger so that '
  '(device_id, idempotency_key) stays unique across both.';

------------------------------------------------------------------------------------------------
-- 2. Sync one unscheduled-service draft.
--
-- Structure mirrors sync_offline_service_task_draft deliberately, including the order of its
-- checks: device ownership is a hard failure before anything else, then the idempotency replay
-- (which must return what actually happened the first time, not assume success), then the clock
-- plausibility judgment, then the apply.
------------------------------------------------------------------------------------------------
create or replace function public.sync_offline_unscheduled_service_draft(
  p_device_id uuid,
  p_resident_id uuid,
  p_idempotency_key text,
  p_client_occurred_at timestamptz,
  p_service_kind text,
  p_duration_minutes integer default null,
  p_requires_two_staff boolean default false,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  if v_device.revoked_at is not null then
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
end $$;

comment on function public.sync_offline_unscheduled_service_draft(
  uuid, uuid, text, timestamptz, text, integer, boolean, text
) is
  'Applies one offline-captured unscheduled service, idempotent per (device, key), delegating the '
  'caller-scope rule to record_unscheduled_service. BACKLOG.md E5 Tier 2.';

revoke all on function public.sync_offline_unscheduled_service_draft(
  uuid, uuid, text, timestamptz, text, integer, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.sync_offline_unscheduled_service_draft(
  uuid, uuid, text, timestamptz, text, integer, boolean, text)
  to authenticated;
