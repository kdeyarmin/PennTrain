-- Approving a shift swap always fails, because it defers a constraint that no longer exists.
--
-- THE FINDING. `public.decide_shift_swap` runs
--
--     set constraints shift_assignments_employee_id_shift_date_key deferred;
--
-- immediately before the paired UPDATE that trades the two assignments. That constraint was
-- dropped by `20260731053000_wave2_practicum_duty_and_split_shifts.sql` when split shifts were
-- allowed, so the statement raises `42704 constraint "..." does not exist` and every approval
-- fails. Reproduced on a clean replay on 2026-09-04. The reject path returns before this line, so
-- rejecting a swap has always worked and approving one has not worked since 2026-07-31.
--
-- Two things kept it invisible. Nothing in this repository called `decide_shift_swap` from a test
-- -- the pgTAP suites assert that `list_shift_swap_candidates` exists and stop there, and no
-- browser journey covers a manager approving a swap. And the failure is a runtime error inside a
-- plpgsql body, so typecheck, `deno check` and `db lint` cannot see it: the constraint name is
-- resolved when the statement executes, never when the function is created.
--
-- WHY DELETING THE LINE IS NOT THE WHOLE FIX. `set constraints` was there for a real reason. The
-- swap moves two rows in one statement, and while row A is being handed to employee B, employee B
-- still holds row B. Under the old unique constraint that intermediate state was a violation,
-- hence the deferral. The constraint is gone, but two BEFORE ... FOR EACH ROW triggers now guard
-- the same ground and see that same intermediate state:
--
--   * `app_private.enforce_shift_assignment_eligibility` (20260713221000), which raises 23514
--     `schedule_conflict`, and
--   * `public.prevent_shift_assignment_overlap` (20260706181410), which raises 23P01.
--
-- So a same-day swap -- two aides trading a shift, the ordinary case -- would trade one error for
-- another. This was not hypothetical: the pgTAP file added with this migration reproduced exactly
-- that when the `set constraints` line was removed on its own.
--
-- THE RULE ALREADY EXISTS; ONE TRIGGER JUST NEVER LEARNED IT. `enforce_shift_assignment_eligibility`
-- has carried an in-flight-swap exemption since it was written: it lets a row through when
-- `source = 'swap'` and a still-`pending` swap request decided by this caller already carries BOTH
-- eligibility decision ids and names this assignment. That is a precise description of "the swap
-- has already been validated and is mid-write", and it is honest because `decide_shift_swap`
-- evaluates `evaluate_schedule_eligibility` for BOTH employees -- against the shift each is taking,
-- passing `array[v_a.id, v_b.id]` as `p_exclude_assignment_ids`, i.e. the POST-swap question --
-- and raises 23514 before touching a row if either side is blocked. The overlap trigger asks a
-- mid-statement question that no consistent state ever has to answer, and it simply never learned
-- the exemption.
--
-- This migration therefore does three things: drops the dead `set constraints`, lifts that
-- exemption into one helper, and has both triggers call it. A GUC bypass was written first and
-- thrown away -- the data-shaped predicate cannot be left switched on, needs no discipline at the
-- call site, and keeps one rule instead of two that can drift.
--
-- The helper is SECURITY DEFINER deliberately. `prevent_shift_assignment_overlap` runs with
-- invoker rights, so reading `shift_swap_requests` as the manager would be subject to RLS and the
-- exemption would silently depend on the caller's row visibility. Owner rights make both triggers
-- answer identically.
--
-- Rollback: restore `decide_shift_swap` from 20260804150000 and the two trigger functions from
-- 20260713221000 / 20260706181410, then drop the helper. That restores a function that cannot
-- succeed, so there is no reason to.

create or replace function app_private.shift_assignment_is_in_flight_swap(
  p_assignment_id uuid,
  p_source text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_source = 'swap' and exists (
    select 1
    from public.shift_swap_requests r
    where r.status = 'pending'
      and r.decided_by = auth.uid()
      and r.requester_decision_id is not null
      and r.target_decision_id is not null
      and (r.requester_assignment_id = p_assignment_id or r.target_assignment_id = p_assignment_id)
  );
$$;

revoke all on function app_private.shift_assignment_is_in_flight_swap(uuid, text)
  from public, anon, authenticated;

comment on function app_private.shift_assignment_is_in_flight_swap(uuid, text) is
  'True while decide_shift_swap is mid-write on this assignment: the swap is still pending, this '
  'caller decided it, and both eligibility decisions are already recorded -- so the post-swap '
  'state has been validated and the row-level guards must not judge the intermediate one. Shared '
  'by enforce_shift_assignment_eligibility and prevent_shift_assignment_overlap so the two cannot '
  'drift. See 20260905010000.';

-- ---------------------------------------------------------------------------
-- The overlap guard learns the exemption the eligibility guard already had
-- ---------------------------------------------------------------------------

create or replace function public.prevent_shift_assignment_overlap()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_new_start timestamp;
  v_new_end timestamp;
  v_conflict record;
begin
  if new.status = 'called_off' then
    return new;
  end if;

  -- An approved swap writes both rows in one statement; between them, the shift being handed over
  -- is still held by its previous owner. decide_shift_swap has already asked the post-swap
  -- question for both employees with both rows excluded, so this row's intermediate state is not
  -- one this guard should judge. Same predicate the eligibility trigger uses.
  if tg_op = 'UPDATE'
     and app_private.shift_assignment_is_in_flight_swap(new.id, new.source)
  then
    return new;
  end if;

  v_new_start := new.shift_date::timestamp + new.start_time;
  v_new_end := case
    when new.end_time > new.start_time then new.shift_date::timestamp + new.end_time
    else (new.shift_date + 1)::timestamp + new.end_time
  end;

  select sa.id, sa.shift_date into v_conflict
  from public.shift_assignments sa
  where sa.employee_id = new.employee_id
    and sa.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and sa.status <> 'called_off'
    and sa.shift_date between new.shift_date - 1 and new.shift_date + 1
    and (
      sa.shift_date::timestamp + sa.start_time,
      case when sa.end_time > sa.start_time then sa.shift_date::timestamp + sa.end_time
           else (sa.shift_date + 1)::timestamp + sa.end_time end
    ) overlaps (v_new_start, v_new_end)
  limit 1;

  if v_conflict.id is not null then
    raise exception 'employee % already has an overlapping shift on %', new.employee_id, v_conflict.shift_date
      using errcode = 'exclusion_violation';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_shift_assignment_overlap() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The eligibility guard keeps its behaviour and calls the shared predicate
-- ---------------------------------------------------------------------------

create or replace function app_private.enforce_shift_assignment_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_starts timestamptz;
  v_ends timestamptz;
  v_decision_id uuid;
begin
  if tg_op = 'UPDATE'
    and new.employee_id = old.employee_id and new.facility_id = old.facility_id
    and new.unit_id is not distinct from old.unit_id
    and new.shift_definition_id is not distinct from old.shift_definition_id
    and new.shift_date = old.shift_date and new.start_time = old.start_time and new.end_time = old.end_time then
    return new;
  end if;
  -- Unchanged rule, now expressed once (see the helper's comment).
  if app_private.shift_assignment_is_in_flight_swap(new.id, new.source) then
    return new;
  end if;
  v_starts := new.shift_date + new.start_time;
  v_ends := new.shift_date + new.end_time
    + case when new.end_time <= new.start_time then interval '1 day' else interval '0' end;
  v_result := public.evaluate_shift_assignment_eligibility(
    new.employee_id, new.facility_id, new.unit_id, new.shift_definition_id,
    v_starts, v_ends,
    case when tg_op = 'UPDATE' then array[new.id] else array[]::uuid[] end
  );
  if v_result->>'outcome' = 'blocked' then
    raise exception 'Shift assignment blocked by eligibility: %', v_result->'hardBlocks' using errcode = '23514';
  end if;
  v_decision_id := app_private.persist_schedule_eligibility_decision(
    new.employee_id, new.facility_id, 'manager_assignment', 'shift', new.id,
    v_starts, v_ends, v_result
  );
  new.eligibility_decision_id := v_decision_id;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The approval itself: the dead `set constraints` is simply gone
-- ---------------------------------------------------------------------------

create or replace function public.decide_shift_swap(
  p_swap_request_id uuid,
  p_approve boolean,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_swap public.shift_swap_requests%rowtype;
  v_a public.shift_assignments%rowtype;
  v_b public.shift_assignments%rowtype;
  v_a_start timestamptz; v_a_end timestamptz; v_b_start timestamptz; v_b_end timestamptz;
  v_a_result jsonb; v_b_result jsonb;
  v_a_decision uuid; v_b_decision uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('shift-swap:' || p_swap_request_id::text, 0));
  select * into v_swap from public.shift_swap_requests where id = p_swap_request_id for update;
  if not found or v_swap.status <> 'pending' or v_swap.expires_at <= now() then
    raise exception 'Shift swap is not pending' using errcode = '55000';
  end if;
  perform app_private.assert_phase3_admin(v_swap.organization_id, 'scheduling.self_service.manage', v_swap.facility_id);
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Decision reason is required' using errcode = '22023'; end if;
  if not p_approve then
    update public.shift_swap_requests set status = 'rejected', decided_by = auth.uid(),
      decided_at = now(), decision_reason = btrim(p_reason) where id = v_swap.id;
    return true;
  end if;
  select * into v_a from public.shift_assignments where id = v_swap.requester_assignment_id for update;
  select * into v_b from public.shift_assignments where id = v_swap.target_assignment_id for update;
  if v_a.employee_id <> v_swap.requester_employee_id or v_b.employee_id <> v_swap.target_employee_id
     or v_a.status not in ('scheduled','confirmed') or v_b.status not in ('scheduled','confirmed') then
    raise exception 'Shift assignments changed after swap request' using errcode = '55000';
  end if;
  v_a_start := v_a.shift_date + v_a.start_time;
  v_a_end := v_a.shift_date + v_a.end_time + case when v_a.end_time <= v_a.start_time then interval '1 day' else interval '0' end;
  v_b_start := v_b.shift_date + v_b.start_time;
  v_b_end := v_b.shift_date + v_b.end_time + case when v_b.end_time <= v_b.start_time then interval '1 day' else interval '0' end;
  -- Both sides are asked the POST-swap question, with the two rows being moved excluded. This is
  -- the check the row triggers' mid-statement view cannot make, and the reason their in-flight
  -- exemption is safe.
  v_a_result := public.evaluate_schedule_eligibility(
    v_a.employee_id, v_b.facility_id, v_b_start, v_b_end,
    array[]::text[], array[]::text[], array[]::uuid[], array[v_a.id,v_b.id]
  );
  v_b_result := public.evaluate_schedule_eligibility(
    v_b.employee_id, v_a.facility_id, v_a_start, v_a_end,
    array[]::text[], array[]::text[], array[]::uuid[], array[v_a.id,v_b.id]
  );
  v_a_decision := app_private.persist_schedule_eligibility_decision(
    v_a.employee_id, v_b.facility_id, 'shift_swap', 'swap', v_swap.id, v_b_start, v_b_end, v_a_result
  );
  v_b_decision := app_private.persist_schedule_eligibility_decision(
    v_b.employee_id, v_a.facility_id, 'shift_swap', 'swap', v_swap.id, v_a_start, v_a_end, v_b_result
  );
  if v_a_result->>'outcome' = 'blocked' or v_b_result->>'outcome' = 'blocked' then
    raise exception 'Swap eligibility is blocked' using errcode = '23514';
  end if;
  -- Recorded BEFORE the paired update on purpose: both decision ids and `decided_by` are what the
  -- in-flight-swap predicate reads, and `status` stays 'pending' until the shifts have moved.
  update public.shift_swap_requests set
    requester_decision_id = v_a_decision, target_decision_id = v_b_decision,
    decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(p_reason)
  where id = v_swap.id;
  update public.shift_assignments set
    employee_id = case id when v_a.id then v_b.employee_id else v_a.employee_id end,
    source = 'swap', notes = concat_ws(E'\n', nullif(notes,''), '[approved swap ' || v_swap.id || '] ' || btrim(p_reason))
  where id in (v_a.id, v_b.id);
  update public.shift_swap_requests set
    status = 'approved'
  where id = v_swap.id;
  insert into public.notifications(
    organization_id, profile_id, notification_type, title, body, link
  )
  select v_swap.organization_id, e.profile_id, 'shift_swap_changed',
    'Shift swap approved', 'The approved swap is reflected in your schedule.',
    '/app/my-schedule'
  from public.employees e
  where e.id in (v_swap.requester_employee_id, v_swap.target_employee_id)
    and e.profile_id is not null;
  return true;
end;
$$;
