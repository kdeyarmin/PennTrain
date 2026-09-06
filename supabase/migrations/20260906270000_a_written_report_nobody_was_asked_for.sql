-- Safety, incidents and survey: six clocks that disagreed with the thing they were timing.
--
-- BACKLOG.md J74 (the P3 long tail), section 4.3 "Safety / incidents / survey" and "Resident care".
-- Six independent defects, each small, all in the same family: a deadline, a status or a refusal
-- that said something the rest of the product did not agree with.
--
--   1. THE 48-HOUR WRITTEN REPORT DID NOT EXIST ANYWHERE (the I10 residual). Pennsylvania's
--      reportable-incident rules require a WRITTEN report after the initial notification. The
--      product modelled the initial call -- 2 hours for four types, 24 for five, anchored on when
--      the facility knew -- and nothing at all for the report that follows it: no due date, no
--      alert, no stage, nothing on the incident file that said one was owed. A facility that made
--      every phone call on time still had a second deadline it was never told about. It is
--      modelled here as what it is: another row in incident_notification_rules, so it gets the
--      deadline, the anchor, the overdue alert and the incident-page stage that the existing
--      notifications already get, and no new mechanism is invented for it.
--
--   2. verify_work_order OVERWROTE THE DRILL CALENDAR WITH A 30-DAY DATE. Verifying a repair
--      inserts a passing inspection_event, whose AFTER INSERT trigger recalculates the item
--      through public.inspection_item_next_due_date -- the one place the roll-forward rule has
--      lived since 20260905160000. verify_work_order then overwrote that result with
--      pa_today() + inspection_interval_days and asserted 'compliant'. For a fire drill program
--      that is the exact arithmetic 20260905160000 removed: the next drill landed 30 days out
--      instead of on the last day of next month, and stayed wrong until the nightly fleet pass.
--
--   3. A MONTHLY PROGRAM READ "DUE SOON" FOR MOST OF THE MONTH. The status ladder warned at a flat
--      30 days for every schedule. On a calendar-month drill the deadline is the last day of next
--      month, so the moment that month begins the item is inside the window and stays there until
--      it is either logged or overdue -- a warning that is on for the whole cycle is not a warning.
--      The lead time is now a fraction of the item's own cadence, capped at the 30 days everything
--      slower than two months already used.
--
--   4. "MARK NOTIFIED" WAS ACCEPTED FOR A not_required NOTIFICATION. A notification stood down by a
--      not_reportable determination carries that determination and its rationale on the row. The
--      completion trigger let a client write 'completed' straight over it, recording a call to the
--      state that nobody made, on a duty a manager had decided did not exist.
--
--   5. A CANCELLED CORRECTIVE ACTION COULD BE COMPLETED. verify_corrective_action has refused this
--      since 20260906090000, but the inspection-event list writes the table directly, so the one
--      surface that did not use the RPC could still resolve cancelled work as done.
--
--   6. THE OFFLINE GUARD BLAMED A COLLEAGUE FOR A DISCHARGE (I15's refusal, section 4.3 "Resident
--      care"). assert_task_response_after_discharge raises the same SQLSTATE as
--      record_service_task_response's "only scheduled service tasks" guard, so the service lane's
--      exception ladder classified it from the task row -- still scheduled, recorded by nobody --
--      and landed on 'conflict'. The aide was told "someone else documented this while your device
--      was offline". Nobody raced them: the resident had been discharged or had died. The other
--      three offline lanes already return 'rejected' carrying the guard's own sentence; this one
--      now does too.
--
-- Every function patched here is spliced from its DEPLOYED body with a guarded replace, because
-- each of them has been amended by more than one migration and a fresh CREATE OR REPLACE written
-- from any single file would silently revert the others.

------------------------------------------------------------------------------------------------
-- 1. The 48-hour written report
------------------------------------------------------------------------------------------------
-- The initial notification and the written report that follows it are the same KIND of obligation:
-- a dated duty owed to the department, anchored on when the facility knew, that somebody has to
-- complete and evidence. incident_notification_rules already holds the first one as data with a
-- non-null citation and a source_confidence flag (20260905080000, I10). The written report is a
-- tenth, eleventh ... row in that same table, which is why nothing downstream has to change:
-- create_incident_notification_presets reads the table, determine_incident_reportability re-anchors
-- from the table on a reversal, recalculate_incident_notifications raises the overdue alert, and
-- incidentStages.ts counts it as outstanding notification work on the incident page.
alter table public.incident_notifications
  drop constraint if exists incident_notifications_notification_type_check;
alter table public.incident_notifications
  add constraint incident_notifications_notification_type_check
  check (notification_type in (
    'state_hotline', 'family_guardian', 'law_enforcement', 'licensing_agency',
    'written_report', 'other'));

-- Derived from the state-hotline rows rather than listed by hand: the written report follows the
-- initial department notification, so the set of types that owe one is exactly the set that owes a
-- call. Listing them again is how the two lists drift apart.
--
-- source_confidence is 'unverified' for the same reason I10 seeded the two-hour rows that way: this
-- repository has not read 55 Pa. Code 2600.16 / 2800.16 against the deadline, and a window nobody
-- can source is how the unsourced two-hour window got here. The row exists so the duty is visible
-- and dated; settling the number is a one-row change that must name its authority.
insert into public.incident_notification_rules (
  incident_type, notification_type, due_hours, citation, source_confidence, note
)
select
  rule.incident_type,
  'written_report',
  48,
  '55 Pa. Code 2600.16 / 2800.16 (written report window not yet confirmed against the text)',
  'unverified',
  'The written report that follows the initial department notification. Modelled as a notification '
    || 'so it carries a due date, an overdue alert and a stage on the incident file rather than '
    || 'existing only in someone''s memory. BACKLOG.md I10 residual / J74.'
from public.incident_notification_rules rule
where rule.notification_type = 'state_hotline'
  and rule.is_active
on conflict (incident_type, notification_type) do nothing;

comment on constraint incident_notifications_notification_type_check on public.incident_notifications is
  'state_hotline / licensing_agency are the department call, written_report is the report that '
  'follows it (48 hours, BACKLOG.md I10 residual), family_guardian and law_enforcement are the '
  'other required contacts, other is a facility-added one.';

------------------------------------------------------------------------------------------------
-- 2. verify_work_order stops recomputing a rule that lives somewhere else
------------------------------------------------------------------------------------------------
do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.verify_work_order(uuid, text, text)'::regprocedure);
  v_old := $old$      update public.inspection_items i set
        last_inspected_date = public.pa_today(),
        next_due_date = public.pa_today() + i.inspection_interval_days,
        status = 'compliant'
      where i.id = v.inspection_item_id;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'verify_work_order no longer contains the inspection-item overwrite this migration removes';
  end if;
  v_new := $patch$      -- The insert above fires inspection_event_rolls_item_forward, which recalculates this item --
      -- and any schedule derived from it -- through public.inspection_item_next_due_date, the one
      -- place the roll-forward rule has lived since 20260905160000. What used to sit here overwrote
      -- that result with pa_today() + inspection_interval_days and asserted 'compliant', so a
      -- verified fire-drill repair set the next drill 30 days out instead of the last day of next
      -- month and skipped a calendar month, until the nightly fleet pass corrected it. Recalculating
      -- explicitly rather than deleting the statement keeps this RPC correct on its own terms if the
      -- trigger is ever moved, and it is idempotent. BACKLOG.md J74.
      perform public.recalculate_inspection_item_compliance(v.inspection_item_id);$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

------------------------------------------------------------------------------------------------
-- 3. "Due soon" is a fraction of the cadence, not a flat month
------------------------------------------------------------------------------------------------
-- A warning window has to be shorter than the cycle it warns about. At a flat 30 days a monthly
-- drill program is inside the window from the first day of the month it is due in, so the ladder
-- reports due_soon for the whole cycle and nobody can tell an item that needs attention this week
-- from one that is simply on schedule. Half the cadence, capped at 30 days and floored at one day:
-- everything on a cadence of two months or more keeps exactly the window it has today (annual,
-- quarterly, the six-month sleeping-hours drill), and the schedules that change are precisely the
-- ones where the old window covered half the cycle or more.
create or replace function public.inspection_item_due_soon_lead_days(
  p_item_type text,
  p_interval_days integer
)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select greatest(1, least(30, (case
    -- The two calendar-rule schedules do not derive their deadline from inspection_interval_days
    -- (see public.inspection_item_next_due_date), so their real cadence is stated here rather than
    -- read from a column that is cosmetic for them.
    when p_item_type = 'fire_drill_program' then 30
    when p_item_type = 'sleeping_hours_fire_drill' then 183
    else greatest(coalesce(p_interval_days, 30), 1)
  end) / 2));
$function$;

comment on function public.inspection_item_due_soon_lead_days(text, integer) is
  'How many days before its deadline an inspection item starts reading due_soon: half its own '
  'cadence, capped at 30 days. A flat 30-day window put a calendar-month fire drill program in '
  'due_soon for its entire cycle. BACKLOG.md J74.';

revoke all on function public.inspection_item_due_soon_lead_days(text, integer)
  from public, anon, authenticated;
grant execute on function public.inspection_item_due_soon_lead_days(text, integer)
  to service_role;

do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.recalculate_inspection_item_compliance(uuid)'::regprocedure);
  v_old := $old$    when i.next_due_date <= v_pa_today + 30 then 'due_soon'$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'recalculate_inspection_item_compliance no longer contains the flat 30-day due_soon window this migration replaces';
  end if;
  v_new := $patch$    when i.next_due_date <= v_pa_today
      + public.inspection_item_due_soon_lead_days(i.item_type, i.inspection_interval_days)
      then 'due_soon'$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

------------------------------------------------------------------------------------------------
-- 4. A stood-down notification cannot be marked notified
------------------------------------------------------------------------------------------------
do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.protect_incident_notification_completion()'::regprocedure);
  v_old := $old$  elsif new.status = 'completed' then
    new.completed_at := now();
    new.completed_by_profile_id := auth.uid();$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'protect_incident_notification_completion no longer contains the completion branch this migration guards';
  end if;
  v_new := $patch$  elsif new.status = 'completed' then
    -- A not_required row is a determination, not an open task: determine_incident_reportability
    -- wrote 'Determined not reportable: <rationale>' onto it when a manager decided the event was
    -- not reportable, and the incident page badges it as settled. Completing it would record a call
    -- to the department that nobody made, on a duty a manager had decided did not exist, and would
    -- overwrite the only trace of that decision. The way back is the determination itself:
    -- determine_incident_reportability(..., 'reportable', ...) reinstates the row as pending against
    -- a deadline re-anchored to that reversal. BACKLOG.md J74.
    if old.status = 'not_required' then
      raise exception 'This notification was determined not required. Reverse the incident''s reportability determination to reinstate it before recording a notification.'
        using errcode = '55000';
    end if;
    new.completed_at := now();
    new.completed_by_profile_id := auth.uid();$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

------------------------------------------------------------------------------------------------
-- 5. A cancelled corrective action cannot be completed
------------------------------------------------------------------------------------------------
-- verify_corrective_action (20260906090000) already refuses this, and the incident and violation
-- pages go through it. The inspection-event list writes corrective_actions directly, so on that one
-- surface a cancelled action could still be resolved as done -- and any client holding the table
-- grant could do the same. The rule belongs on the table, next to the RPC's copy of it, for the
-- reason 20260905140000 gives for the discharge guards: the next writer would not know to check.
--
-- Only the cancelled -> completed jump is refused. Reinstating a cancelled action (cancelled ->
-- open / in_progress) and then completing it is a real workflow and stays open; so does cancelling
-- an action that was completed by mistake.
create or replace function public.protect_corrective_action_resolution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if current_setting('role', true) <> 'authenticated' then return new; end if;
  if old.status = 'cancelled' and new.status = 'completed' then
    raise exception 'A cancelled corrective action cannot be completed. Reopen it first if the work was actually carried out.'
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

-- 20260905180000's lesson: a function created after 20260904100000's grant sweep is re-granted to
-- anon/authenticated by the hosted image's default privileges unless it is revoked where it is
-- defined.
revoke all on function public.protect_corrective_action_resolution() from public, anon, authenticated;

comment on function public.protect_corrective_action_resolution() is
  'Refuses the cancelled -> completed transition on corrective_actions for client writes, matching '
  'verify_corrective_action''s own refusal. BACKLOG.md J74.';

drop trigger if exists protect_corrective_action_resolution on public.corrective_actions;
create trigger protect_corrective_action_resolution
before update on public.corrective_actions
for each row execute function public.protect_corrective_action_resolution();

------------------------------------------------------------------------------------------------
-- 6. The offline service lane names the real reason
------------------------------------------------------------------------------------------------
do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef(
    'public.sync_offline_service_task_draft(uuid, uuid, text, timestamptz, text, jsonb)'::regprocedure);
  v_old := $old$        if v_task_status = 'superseded' then
          v_outcome := 'stale';
        elsif v_task_recorded_by = auth.uid() then
          v_outcome := 'duplicate';
        else
          v_outcome := 'conflict';
        end if;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'sync_offline_service_task_draft no longer contains the outcome ladder this migration extends';
  end if;
  v_new := $patch$        if exists (
          select 1
          from public.resident_service_task_instances t
          join public.residents r on r.id = t.resident_id
          where t.id = p_task_id and r.status in ('discharged', 'deceased')
        ) then
          -- assert_resident_accepts_documentation / assert_task_response_after_discharge
          -- (20260905140000, I15) raise object_not_in_prerequisite_state, the SAME sqlstate as
          -- record_service_task_response's "only scheduled service tasks can be recorded" guard. So
          -- this ladder read the task row -- still 'scheduled', recorded by nobody -- fell through
          -- to the else, and the aide was told "someone else documented this while your device was
          -- offline". Nobody raced them: the resident was discharged or had died. 'rejected' is the
          -- outcome the other three offline lanes already return for this guard, it is equally
          -- block-and-flag, and it carries sqlerrm -- the guard's own sentence, which names the
          -- resident and says what to do -- to the drafts panel. BACKLOG.md J74 (I15's refusal).
          v_outcome := 'rejected';
        elsif v_task_status = 'superseded' then
          v_outcome := 'stale';
        elsif v_task_recorded_by = auth.uid() then
          v_outcome := 'duplicate';
        else
          v_outcome := 'conflict';
        end if;$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;
