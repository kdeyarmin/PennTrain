-- Scheduling and workforce: the guard nobody could execute, the auto-fill that aborted, the swap
-- that skipped the requirements, and the renewal review that refused every submission.
--
-- BACKLOG J1, J16, J17, J18, J65, J66, J69, J71, J73.
--
-- Two of these shipped to production on 2026-09-05 as regressions inside fixes, and both got past
-- a green suite for the same reason: the pgTAP that exercises them runs as the superuser, and the
-- browser role is the only role that hits the defect.

-- ---------------------------------------------------------------------------
-- J1 -- every manager edit of a shift assignment failed
-- ---------------------------------------------------------------------------
--
-- 20260905010000 (the I26 swap fix) rewrote this trigger to consult
-- app_private.shift_assignment_is_in_flight_swap, and left it SECURITY INVOKER. A trigger body
-- runs with the privileges of whoever executed the statement; `authenticated` holds no USAGE on
-- app_private and no EXECUTE on that helper, so every UPDATE of shift_assignments from the
-- browser -- the quick status change and the edit dialog on ScheduleDetail, which write the table
-- directly under shift_assignments_update -- failed with "permission denied for schema
-- app_private". Probed on production 2026-09-06: has_schema_privilege('authenticated',
-- 'app_private','USAGE') = false, has_function_privilege(...) = false.
--
-- 20260905120000, written the same day, names this exact mechanism and avoids it for incidents:
-- "this is called from BEFORE UPDATE triggers that run as the invoker, and `authenticated` has no
-- USAGE on app_private -- putting it there made every ordinary incident and violation update fail
-- with 'permission denied for schema app_private'". The scheduling trigger did not get the same
-- treatment.
--
-- SECURITY DEFINER is the fix and is also the more correct guard: the conflict search reads every
-- shift the EMPLOYEE holds, and an employee may be scheduled at a facility the acting manager
-- cannot see. Under invoker rights that cross-facility conflict was invisible and the overlap went
-- unblocked. search_path is pinned empty and every object is schema-qualified.
create or replace function public.prevent_shift_assignment_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
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

comment on function public.prevent_shift_assignment_overlap() is
  'BEFORE INSERT/UPDATE overlap guard on shift_assignments. SECURITY DEFINER because a trigger '
  'body runs as the statement''s executor and `authenticated` has no USAGE on app_private, so the '
  'in-flight-swap exemption added by 20260905010000 made every browser edit of a shift fail '
  '(BACKLOG J1) -- and because the conflict search must see shifts at facilities the acting '
  'manager cannot read. See 20260905120000, which names the same mechanism for incidents.';

-- ---------------------------------------------------------------------------
-- J17 -- auto-fill aborted on the first blocked employee instead of skipping
-- ---------------------------------------------------------------------------
--
-- The insert loop caught `unique_violation or exclusion_violation`. Postgres fires BEFORE triggers
-- in name order, so app_private.enforce_shift_assignment_eligibility runs before
-- prevent_shift_assignment_overlap and raises 23514 (check_violation) for any blocked outcome --
-- schedule_conflict for an employee who already has a manual shift that day, weekly_hours_limit
-- for a six-day pattern, insufficient_rest, employee_unavailable, an OAPSA bar, a missing
-- shift-definition credential. 23514 was not caught, so the whole statement aborted and nothing
-- was inserted, while the toast said "N skipped (already scheduled or would create an overlapping
-- shift)" and ARCHITECTURE.md said "manual entries always win". The overlap trigger's
-- exclusion_violation was in practice unreachable, because the eligibility trigger raised first.
--
-- Body reproduced from the live catalog with one changed line -- the exception list -- and a
-- skipped-reason tally so the caller can say WHY, since "skipped" now covers more than an overlap.
create or replace function public.generate_schedule_assignments(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_schedule public.schedules%rowtype;
  v_day date;
  v_pref record;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_skipped_conflict integer := 0;
  v_skipped_ineligible integer := 0;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if not found then
    raise exception 'schedule not found';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_schedule.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(v_schedule.facility_id)
    )
  ) then
    raise exception 'not authorized to edit this schedule';
  end if;

  if v_schedule.status <> 'draft' then
    raise exception 'only draft schedules can be auto-filled';
  end if;

  for v_day in select generate_series(v_schedule.period_start, v_schedule.period_end, interval '1 day')::date loop
    for v_pref in
      select distinct on (esp.employee_id)
        esp.employee_id, esp.unit_id, esp.shift_definition_id, sd.start_time, sd.end_time
      from public.employee_schedule_preferences esp
      join public.shift_definitions sd on sd.id = esp.shift_definition_id and sd.is_active
      join public.employees e on e.id = esp.employee_id and e.status = 'active'
      join public.employee_facility_assignments efa
        on efa.employee_id = esp.employee_id and efa.facility_id = esp.facility_id
      where esp.facility_id = v_schedule.facility_id
        and esp.is_active
        and extract(dow from v_day)::smallint = any (esp.days_of_week)
      order by esp.employee_id, esp.priority desc, esp.created_at
    loop
      begin
        insert into public.shift_assignments (
          organization_id, schedule_id, facility_id, employee_id, unit_id, shift_definition_id,
          shift_date, start_time, end_time, status, source
        ) values (
          v_schedule.organization_id, v_schedule.id, v_schedule.facility_id, v_pref.employee_id, v_pref.unit_id,
          v_pref.shift_definition_id, v_day, v_pref.start_time, v_pref.end_time, 'scheduled', 'auto_fill'
        );
        v_inserted := v_inserted + 1;
      exception
        when unique_violation or exclusion_violation then
          -- Already scheduled, or the overlap guard refused the row.
          v_skipped := v_skipped + 1;
          v_skipped_conflict := v_skipped_conflict + 1;
        when check_violation then
          -- BACKLOG J17: the eligibility trigger raises 23514 and fires BEFORE the overlap guard,
          -- so this is the branch that actually catches "this employee cannot work that day" --
          -- an existing shift, the weekly-hours ceiling, rest hours, availability, an OAPSA bar or
          -- a missing credential. Auto-fill skips the person and fills everyone else, which is
          -- what the toast and ARCHITECTURE.md have always promised.
          v_skipped := v_skipped + 1;
          v_skipped_ineligible := v_skipped_ineligible + 1;
      end;
    end loop;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped', v_skipped,
    'skippedConflict', v_skipped_conflict,
    'skippedIneligible', v_skipped_ineligible
  );
end;
$function$;

comment on function public.generate_schedule_assignments(uuid) is
  'Auto-fills a draft schedule from every employee''s recurring pattern. Skips -- never aborts on '
  '-- a day the employee cannot work: the eligibility trigger raises check_violation (23514) and '
  'fires before the overlap guard, so before BACKLOG J17 one manual shift on a pattern day failed '
  'the entire run and inserted nothing. The two skip counters say which rule refused.';

-- ---------------------------------------------------------------------------
-- J18 -- swap approval skipped the shift definition's own requirements
-- ---------------------------------------------------------------------------
--
-- decide_shift_swap asked public.evaluate_schedule_eligibility -- the BASE engine -- with empty
-- requirement arrays, and both row triggers return early for an in-flight swap, so nothing
-- evaluated the shift definition's required qualifications/credentials/training, the
-- minimum_rest_hours rule or the availability window. A medication-pass shift could be handed to
-- someone without the credential its definition requires, or to someone finishing an overnight two
-- hours earlier. claim_open_shift already passes the opportunity's requirement arrays; the swap
-- passed none.
--
-- public.evaluate_shift_assignment_eligibility is the wrapper that reads
-- shift_eligibility_requirements and service_workload_profiles, converts outside_availability into
-- a hard block and enforces the rest rule. It returns the same shape, so only the two calls move.
create or replace function public.decide_shift_swap(
  p_swap_request_id uuid,
  p_approve boolean,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
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
  if not found or v_swap.status <> 'pending' then
    raise exception 'Shift swap is not pending' using errcode = '55000';
  end if;
  perform app_private.assert_phase3_admin(v_swap.organization_id, 'scheduling.self_service.manage', v_swap.facility_id);
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Decision reason is required' using errcode = '22023'; end if;
  if not p_approve then
    -- BACKLOG J18 (P3 tail): rejection stays available after the window lapses. The expiry test
    -- used to sit in the guard above, so a request nobody answered in time could not be refused
    -- either -- it stayed 'pending' in the manager's queue for ever. Only APPROVAL needs a live
    -- request; refusing a stale one is how the queue gets cleared.
    update public.shift_swap_requests set status = 'rejected', decided_by = auth.uid(),
      decided_at = now(), decision_reason = btrim(p_reason) where id = v_swap.id;
    return true;
  end if;
  if v_swap.expires_at <= now() then
    raise exception 'Shift swap is not pending' using errcode = '55000';
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
  --
  -- BACKLOG J18: through public.evaluate_shift_assignment_eligibility -- the WRAPPER -- not the
  -- base engine. The base engine takes requirement arrays as arguments and this call site passed
  -- three empty ones, so the shift definition's own required qualifications, credentials and
  -- training, the minimum_rest_hours rule and the availability window were never part of the
  -- question. The wrapper reads shift_eligibility_requirements and service_workload_profiles for
  -- the shift being taken and turns outside_availability into a hard block. claim_open_shift has
  -- always passed the opportunity's requirements; the swap was the one path that passed none, so
  -- a medication-pass shift could be swapped to somebody without the credential its definition
  -- requires, or onto the back of an overnight that ended two hours earlier.
  v_a_result := public.evaluate_shift_assignment_eligibility(
    v_a.employee_id, v_b.facility_id, v_b.unit_id, v_b.shift_definition_id,
    v_b_start, v_b_end, array[v_a.id, v_b.id]
  );
  v_b_result := public.evaluate_shift_assignment_eligibility(
    v_b.employee_id, v_a.facility_id, v_a.unit_id, v_a.shift_definition_id,
    v_a_start, v_a_end, array[v_a.id, v_b.id]
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
    eligibility_decision_id = case id when v_a.id then v_a_decision else v_b_decision end,
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
$function$;

comment on function public.decide_shift_swap(uuid, boolean, text) is
  'Approves or rejects a shift swap. Approval evaluates BOTH employees against the shift each is '
  'taking through evaluate_shift_assignment_eligibility -- the wrapper, so the shift definition''s '
  'required qualifications, credentials and training, minimum rest hours and availability are all '
  'part of the question (BACKLOG J18; the base engine was previously asked with three empty '
  'requirement arrays while both row guards stood down for the in-flight swap). Rejection is '
  'allowed after the request expires, so a stale queue can be cleared.';

-- ---------------------------------------------------------------------------
-- J65, J69 -- a transfer left the employee behind at the old facility
-- ---------------------------------------------------------------------------
--
-- The transfer branch of apply_employee_lifecycle_transition updates employees.facility_id; the
-- sync trigger then demotes the old employee_facility_assignments row to non-primary and upserts
-- the new one, and never deletes the old. Source-facility schedule preferences stay active. So the
-- next draft at the OLD facility auto-fills the transferred employee back in (the auto-fill joins
-- preferences to assignments, both of which still exist) and the candidate picker grades them
-- eligible.
--
-- Separately (J69) employee_credentials.facility_id keeps the old facility, while the
-- credential-documents storage write policy requires the path's facility to equal the EMPLOYEE's
-- current facility and the table trigger requires it to equal the CREDENTIAL's stamped facility.
-- After a transfer those two disagree and the employee's own renewal upload is refused by RLS with
-- a raw storage error. Re-stamping the credential makes both predicates true again and keeps the
-- reverse-joining read policy working for the new facility's managers.
--
-- Implemented as an AFTER UPDATE trigger on employees rather than inside the 700-line lifecycle
-- function, so it also covers a facility change made by any other writer -- which is the point:
-- every one of these defects was a writer that did not know about a table it should have carried.
create or replace function app_private.realign_employee_facility_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.facility_id is not distinct from old.facility_id then
    return new;
  end if;

  -- The employee is no longer schedulable at the facility they left.
  delete from public.employee_facility_assignments
  where employee_id = new.id and facility_id = old.facility_id;

  update public.employee_schedule_preferences
  set is_active = false, updated_at = now()
  where employee_id = new.id and facility_id = old.facility_id and is_active;

  -- The credential's facility is what both halves of the document-upload gate compare against.
  update public.employee_credentials
  set facility_id = new.facility_id, updated_at = now()
  where employee_id = new.id and facility_id = old.facility_id;

  -- The OAPSA profile is filed per facility and the maintenance job alerts on it; without this it
  -- keeps alerting the facility the employee has left.
  update public.employee_background_check_profiles
  set facility_id = new.facility_id, updated_at = now()
  where employee_id = new.id and facility_id = old.facility_id;

  return new;
end;
$function$;

revoke all on function app_private.realign_employee_facility_scope() from public, anon, authenticated;

drop trigger if exists realign_employee_facility_scope on public.employees;
create trigger realign_employee_facility_scope
after update of facility_id on public.employees
for each row
when (new.facility_id is distinct from old.facility_id)
execute function app_private.realign_employee_facility_scope();

comment on function app_private.realign_employee_facility_scope() is
  'Carries the per-facility rows an employee owns to their new facility on a transfer: the source '
  'facility assignment is removed and its schedule preferences deactivated (BACKLOG J65 -- the '
  'next draft at the old facility auto-filled the transferred employee back in), and the '
  'credential and OAPSA-profile facility stamps follow the employee (BACKLOG J69 -- the storage '
  'write policy compares the path to the EMPLOYEE''s facility while the table trigger compares it '
  'to the CREDENTIAL''s, so after a transfer the employee''s own renewal upload was refused).';

-- ---------------------------------------------------------------------------
-- J66, J32 -- the employee shift workspace showed shifts nobody had published
-- ---------------------------------------------------------------------------
--
-- shift_assignments_select's employee branch requires the parent schedule to be `published`, and
-- /me/schedule says "Only published shifts are shown". get_my_shift_workspace is SECURITY DEFINER
-- and joined no schedule at all, so /me/shift showed a draft shift and offered "Report call-off"
-- on it -- and record_shift_call_off checked only ownership, so an employee could call off a shift
-- their manager had not published, which wrote an approved absence and opened a high-priority
-- unfilled-shift work item.
--
-- The same function's residentServiceTasks subquery joined no residents (J32), so a hospitalised
-- or discharged resident's assigned tasks kept counting as due for the aide -- the half of I15
-- that the Floor queue's fix did not reach.
--
-- Body reproduced from the live catalog; the two subqueries gain a join each and nothing else
-- changes.
create or replace function public.get_my_shift_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_employee public.employees%rowtype; v_shift jsonb; v_result jsonb;
begin
  select * into v_employee from public.employees where profile_id = auth.uid() limit 1;
  if not found then return jsonb_build_object('employee', null, 'currentOrNextShift', null, 'handoffItems', '[]'::jsonb, 'residentServiceTasks', '[]'::jsonb, 'workItems', '[]'::jsonb, 'notifications', '[]'::jsonb, 'openShiftOffers', '[]'::jsonb, 'timeOffRequests', '[]'::jsonb, 'upcomingShifts', '[]'::jsonb); end if;
  select to_jsonb(s) into v_shift from (
    select sa.*, f.name as facility_name, u.name as unit_name, sd.name as shift_name
    from public.shift_assignments sa
    join public.schedules sch on sch.id = sa.schedule_id and sch.status = 'published'
    join public.facilities f on f.id=sa.facility_id left join public.facility_units u on u.id=sa.unit_id left join public.shift_definitions sd on sd.id=sa.shift_definition_id
    where sa.employee_id=v_employee.id
      and (sa.shift_date + sa.end_time + case when sa.end_time <= sa.start_time then interval '1 day' else interval '0' end) >= public.pa_now()
      and sa.status in ('scheduled','confirmed') order by sa.shift_date, sa.start_time limit 1
  ) s;
  select jsonb_build_object(
    'employee', jsonb_build_object('id', v_employee.id, 'name', btrim(v_employee.first_name || ' ' || v_employee.last_name), 'status', v_employee.status),
    'currentOrNextShift', v_shift,
    'handoffItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.priority desc, x.created_at desc) from (select id, category, priority, narrative, requires_acknowledgement, status, created_at, linked_work_item_id from public.shift_report_entries where facility_id = coalesce((v_shift->>'facility_id')::uuid, v_employee.facility_id) and status in ('open','carried_forward') limit 20) x), '[]'::jsonb),
    'residentServiceTasks', coalesce((select jsonb_agg(to_jsonb(x) order by x.scheduled_start) from (select t.id, t.resident_id, t.service_name, t.scheduled_start, t.scheduled_end, t.status from public.resident_service_task_instances t join public.residents r on r.id = t.resident_id and r.status in ('active','temporarily_out') where t.assigned_employee_id = v_employee.id and t.scheduled_start >= now() - interval '4 hours' and t.scheduled_start < now() + interval '16 hours' and t.status not in ('completed','completed_late','completed_by_other','superseded') limit 20) x), '[]'::jsonb),
    'workItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.due_at) from (select id, title, priority, due_at, state, source_type, source_id from public.work_items where owner_profile_id = auth.uid() and state not in ('closed','canceled') order by due_at limit 20) x), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id, notification_type, title, body, link, created_at from public.notifications where profile_id=auth.uid() and read_at is null order by created_at desc limit 10) x), '[]'::jsonb),
    'openShiftOffers', coalesce((select jsonb_agg(to_jsonb(x) order by x.shift_date, x.start_time) from (select o.id, o.facility_id, o.shift_date, o.start_time, o.end_time, o.status from public.open_shift_opportunities o where o.organization_id=v_employee.organization_id and o.status='open' and o.shift_date >= public.pa_today() and (o.facility_id = v_employee.facility_id or exists (select 1 from public.employee_facility_assignments efa where efa.employee_id = v_employee.id and efa.facility_id = o.facility_id)) order by o.shift_date, o.start_time limit 10) x), '[]'::jsonb),
    'timeOffRequests', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from (select id, request_type, starts_at, ends_at, status, absence_category from public.workforce_time_off_requests where employee_id=v_employee.id order by starts_at desc limit 10) x), '[]'::jsonb),
    'upcomingShifts', coalesce((select jsonb_agg(to_jsonb(x) order by x.shift_date, x.start_time) from (select sa.id, sa.shift_date, sa.start_time, sa.end_time, sa.status, f.name as facility_name, u.name as unit_name, sd.name as shift_name from public.shift_assignments sa join public.schedules sch on sch.id = sa.schedule_id and sch.status = 'published' join public.facilities f on f.id=sa.facility_id left join public.facility_units u on u.id=sa.unit_id left join public.shift_definitions sd on sd.id=sa.shift_definition_id where sa.employee_id=v_employee.id and sa.shift_date >= public.pa_today() order by sa.shift_date, sa.start_time limit 7) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

comment on function public.get_my_shift_workspace() is
  'The employee shift dashboard payload. Both shift queries join a PUBLISHED schedule, matching '
  'shift_assignments_select''s employee branch and what /me/schedule promises -- this definer RPC '
  'joined no schedule, so a draft shift appeared with a call-off button on it (BACKLOG J66). '
  'residentServiceTasks joins residents and shows only active or temporarily-out residents, the '
  'half of I15 the Floor queue''s fix did not reach (BACKLOG J32). openShiftOffers is scoped to '
  'the facilities the employee is actually assigned to. residentServiceTasks excludes the whole '
  'completed family and superseded, so a documented task leaves the due list however it was '
  'completed; the exception statuses stay, because they still need attention.';

-- ---------------------------------------------------------------------------
-- J66, J73 -- the call-off guard, and the open-shift queue finally gets a producer
-- ---------------------------------------------------------------------------
--
-- record_shift_call_off checked ownership and nothing else, so it accepted a completed or no-show
-- shift months old and rewrote it to called_off with an approved absence; and with the workspace
-- showing draft shifts it accepted those too.
--
-- J73: nothing anywhere inserted into open_shift_opportunities -- no UI, no RPC, no migration, no
-- edge function -- while /me/schedule advertises "claim eligible openings" and
-- /app/workforce-operations has an "Open-shift claims" decision card. Both ends of the queue
-- existed and it could never fill. A call-off is exactly the event that creates one, and the
-- work item this function already opens is the manager's side of the same fact.
create or replace function public.record_shift_call_off(
  p_shift_assignment_id uuid,
  p_category text,
  p_reason text,
  p_partial_starts_at timestamp with time zone default null,
  p_partial_ends_at timestamp with time zone default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_shift public.shift_assignments%rowtype;
  v_emp public.employees%rowtype;
  v_schedule public.schedules%rowtype;
  v_policy public.schedule_eligibility_policies%rowtype;
  v_req uuid;
  v_work uuid;
  v_template uuid;
  v_is_self boolean;
  -- The true instants, built through pa_midnight so they are Pennsylvania wall-clock rather than
  -- `date + time` read as UTC. The legacy `date + time` expressions below are left exactly as they
  -- were: they feed columns whose existing rows were written that way.
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_claim_deadline timestamptz;
  v_quals text[];
  v_creds text[];
  v_training uuid[];
begin
  if p_category not in ('illness','family_emergency','transportation','bereavement','jury_duty','weather','personal','other') then raise exception 'Invalid call-off category' using errcode='22023'; end if;
  select * into v_shift from public.shift_assignments where id = p_shift_assignment_id for update;
  if not found then raise exception 'Shift not found' using errcode='P0002'; end if;
  select * into v_emp from public.employees where id = v_shift.employee_id;
  v_is_self := v_emp.profile_id is not null and v_emp.profile_id = auth.uid();
  if not coalesce((public.is_platform_admin() or v_is_self or (v_shift.organization_id = public.current_org_id() and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(v_shift.facility_id))), false) then
    raise exception 'Not authorized to call off this shift' using errcode='42501';
  end if;

  -- BACKLOG J66. Ownership was the only check this function made, so it accepted a shift that had
  -- already been completed, marked no-show, cancelled or called off once already -- months in the
  -- past -- and rewrote its status, filed an APPROVED absence against it and opened a
  -- high-priority "Unfilled shift" work item for a shift that was worked.
  if v_shift.status not in ('scheduled','confirmed') then
    raise exception 'Only a scheduled or confirmed shift can be called off' using errcode='22023';
  end if;

  v_start_ts := public.pa_midnight(v_shift.shift_date) + v_shift.start_time;
  v_end_ts := public.pa_midnight(v_shift.shift_date) + v_shift.end_time
    + case when v_shift.end_time <= v_shift.start_time then interval '1 day' else interval '0' end;
  if v_end_ts < now() then
    raise exception 'That shift has already ended' using errcode='22023';
  end if;

  -- BACKLOG J66. shift_assignments_select's employee branch requires the parent schedule to be
  -- published, and /me/schedule says so; a definer RPC must not let an employee act on a draft
  -- their manager has not released. A manager may still call one off on their behalf.
  select * into v_schedule from public.schedules where id = v_shift.schedule_id;
  if v_is_self and not public.is_platform_admin() and coalesce(v_schedule.status, 'draft') <> 'published' then
    raise exception 'That shift has not been published yet' using errcode='22023';
  end if;

  insert into public.workforce_time_off_requests(organization_id, facility_id, employee_id, request_type, absence_category, starts_at, ends_at, status, reason, shift_assignment_id, requested_by, idempotency_key)
  values(v_shift.organization_id, v_shift.facility_id, v_shift.employee_id, case when p_partial_starts_at is null then 'call_off' else 'partial_shift_absence' end, p_category,
    coalesce(p_partial_starts_at, v_shift.shift_date + v_shift.start_time), coalesce(p_partial_ends_at, v_shift.shift_date + v_shift.end_time + case when v_shift.end_time <= v_shift.start_time then interval '1 day' else interval '0' end),
    'approved', nullif(btrim(p_reason), ''), v_shift.id, auth.uid(), 'call-off:' || v_shift.id::text)
  on conflict do nothing returning id into v_req;
  if v_req is null then select id into v_req from public.workforce_time_off_requests where shift_assignment_id = v_shift.id and request_type in ('call_off','partial_shift_absence') order by created_at desc limit 1; end if;
  update public.shift_assignments set status = 'called_off', updated_at = now(), notes = concat_ws(E'\n', notes, 'Call-off: ' || coalesce(nullif(btrim(p_reason), ''), p_category)) where id = v_shift.id;
  select id into v_template from public.work_item_templates where (organization_id = v_shift.organization_id or organization_id is null) and template_key = 'daily_ops.unfilled_shift' order by organization_id nulls last limit 1;
  insert into public.work_items(organization_id, facility_id, template_id, source_type, source_id, deduplication_key, title, description, owner_profile_id, priority, due_at, created_by)
  values(v_shift.organization_id, v_shift.facility_id, v_template, 'rule_exception', v_req, 'call-off:' || v_shift.id::text, 'Unfilled shift after call-off', coalesce(nullif(btrim(p_reason), ''), p_category), null, 'high', now() + interval '30 minutes', auth.uid())
  on conflict (organization_id, deduplication_key) do update set updated_at = now() returning id into v_work;
  insert into public.work_item_history(organization_id, facility_id, work_item_id, event_type, resulting_state, actor_profile_id, reason, evidence)
  values(v_shift.organization_id, v_shift.facility_id, v_work, 'created', 'open', auth.uid(), 'Call-off created unfilled-shift work', jsonb_build_object('shiftAssignmentId', v_shift.id, 'requestId', v_req));

  -- BACKLOG J73. Nothing anywhere inserted an open_shift_opportunities row -- not a UI, an RPC, a
  -- migration or an edge function -- while /me/schedule advertises claimable openings and
  -- /app/workforce-operations carries an "Open-shift claims" decision card. claim_open_shift,
  -- decide_open_shift_claim, the waitlist and the RLS for all of it shipped around a queue that
  -- could never fill. A full-shift call-off is exactly the event that opens one; the work item
  -- above is the same fact on the manager's side.
  --
  -- A PARTIAL absence does not open one: the shift is still covered for the rest of its length,
  -- and the opportunity row has no way to express a fragment.
  if p_partial_starts_at is null
     and coalesce(v_schedule.status, 'draft') = 'published'
     and coalesce(auth.uid(), v_emp.profile_id) is not null
     and not exists (
       select 1 from public.open_shift_opportunities o
       where o.schedule_id = v_shift.schedule_id
         and o.facility_id = v_shift.facility_id
         and o.shift_date = v_shift.shift_date
         and o.start_time = v_shift.start_time
         and o.unit_id is not distinct from v_shift.unit_id
         and o.status in ('draft','open')
     )
  then
    -- The same three arrays evaluate_shift_assignment_eligibility builds for a direct assignment,
    -- because claim_open_shift enforces the OPPORTUNITY's arrays, not the shift definition's.
    select
      coalesce(array_agg(distinct q) filter (where q is not null), array[]::text[]),
      coalesce(array_agg(distinct c) filter (where c is not null), array[]::text[]),
      coalesce(array_agg(distinct t) filter (where t is not null), array[]::uuid[])
    into v_quals, v_creds, v_training
    from public.shift_eligibility_requirements r
    left join lateral unnest(r.required_qualification_keys) q on true
    left join lateral unnest(r.required_credential_types) c on true
    left join lateral unnest(r.required_training_type_ids) t on true
    where r.facility_id = v_shift.facility_id
      and r.shift_definition_id = v_shift.shift_definition_id
      and r.is_active;

    select
      array(select distinct x from unnest(v_quals || coalesce(w.required_qualification_keys, array[]::text[])) x),
      array(select distinct x from unnest(v_creds || coalesce(w.required_credential_types, array[]::text[])) x)
    into v_quals, v_creds
    from public.service_workload_profiles w
    where w.facility_id = v_shift.facility_id
      and w.shift_definition_id = v_shift.shift_definition_id
      and w.unit_id is not distinct from v_shift.unit_id;

    select * into v_policy from public.schedule_eligibility_policies where organization_id = v_shift.organization_id;
    -- Claimable until the policy's lead time before the shift starts, but never so far in the past
    -- that a same-day call-off posts an opening nobody can take, and never past the shift's end.
    v_claim_deadline := least(
      v_end_ts,
      greatest(
        v_start_ts - coalesce(v_policy.claim_deadline_hours, 4) * interval '1 hour',
        now() + interval '30 minutes'
      )
    );

    insert into public.open_shift_opportunities(
      organization_id, schedule_id, facility_id, unit_id, shift_definition_id,
      shift_date, start_time, end_time, slots,
      required_qualification_keys, required_credential_types, required_training_type_ids,
      status, claim_deadline, created_by
    ) values (
      v_shift.organization_id, v_shift.schedule_id, v_shift.facility_id, v_shift.unit_id,
      v_shift.shift_definition_id, v_shift.shift_date, v_shift.start_time, v_shift.end_time, 1,
      coalesce(v_quals, array[]::text[]), coalesce(v_creds, array[]::text[]),
      coalesce(v_training, array[]::uuid[]),
      'open', v_claim_deadline, coalesce(auth.uid(), v_emp.profile_id)
    );
  end if;

  return v_req;
end;
$function$;

comment on function public.record_shift_call_off(uuid, text, text, timestamptz, timestamptz) is
  'Records a call-off, opens the manager''s unfilled-shift work item, and posts the opening to the '
  'claim queue. Refuses a shift that is not scheduled or confirmed, one that has already ended, '
  'and an employee acting on a schedule their manager has not published -- ownership was the only '
  'check it made (BACKLOG J66). The open_shift_opportunities insert is that queue''s first '
  'producer: claim_open_shift, decide_open_shift_claim, the waitlist, the employee "Open shifts" '
  'card and the manager decision card all shipped around a queue nothing could fill (BACKLOG J73). '
  'A partial absence posts no opening -- the shift is still covered for the rest of its length.';

-- ---------------------------------------------------------------------------
-- J16 -- credential renewal review refused every submission
-- ---------------------------------------------------------------------------
--
-- 20260905340000 widened the scan_status check to admit 'not_scanned', made
-- record_credential_renewal_extraction route not_scanned to `needs_review`, and changed the worker
-- to send `not_scanned` because "there is no malware scanner in this product". It never redefined
-- this function, whose gate is still `scan_status <> 'clean'`. Nothing writes 'clean' any more, so
-- every submission reaches needs_review/not_scanned and the human decision is refused with
-- "Credential renewal is not ready for a human decision" -- while the inbox enables Approve and
-- Reject for exactly that state. Employee uploads from /me/credentials land in a queue nobody can
-- clear.
--
-- Body reproduced from the live catalog with the gate widened and nothing else changed.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'review_credential_renewal_submission';

  if v_def is null then
    raise exception 'review_credential_renewal_submission is missing';
  end if;
  if position('v_submission.scan_status <> ''clean''' in v_def) = 0 then
    raise exception 'review_credential_renewal_submission no longer carries the clean-only gate; re-read it before patching';
  end if;

  v_def := replace(
    v_def,
    'v_submission.scan_status <> ''clean''',
    'v_submission.scan_status not in (''clean'', ''not_scanned'')'
  );
  execute v_def;
end $$;

comment on function public.review_credential_renewal_submission(uuid, text, jsonb, text) is
  'Human decision on an OCR-extracted credential renewal. Accepts scan_status ''clean'' OR '
  '''not_scanned'': 20260905340000 made the worker write not_scanned (there is no malware scanner '
  'in this product) and routed it to needs_review, but left this gate clean-only, so every '
  'submission was refused with "not ready for a human decision" while the inbox offered the '
  'buttons. BACKLOG J16.';

-- ---------------------------------------------------------------------------
-- J71 -- a lapsed provisional period barred an employee whose clearances were on file
-- ---------------------------------------------------------------------------
--
-- The bar was purely `provisional_start_date + provisional_max_days < today`; nothing read
-- employee_credentials. The form says "Once the window ends without the clearances on file, this
-- employee is blocked", the alert says "Without the required clearances on file by then", and the
-- schedule label says "provisional period ended without clearances" -- so a manager who files the
-- clearances and never blanks the provisional start date gets a non-obvious block that only an
-- AAL2 override can lift. The provisional period exists to bridge the wait for the clearances;
-- once they are compliant it is over, whatever the dates say.
--
-- Act 34 (state criminal history) is required of everyone. Act 73 (FBI fingerprint) is required
-- only when the employee has not been a Pennsylvania resident for two years, which is exactly what
-- employee_background_check_profiles.pa_resident_two_years records.
create or replace function public.oapsa_duty_status(p_employee_id uuid, p_as_of date default null)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  -- Returned rather than raised, and shaped the same whether or not a profile exists, so a caller
  -- can render the countdown as easily as it can read the bar. `bar` is null when the employee may
  -- work; `daysRemaining` is large-and-meaningless when no provisional period is running, which is
  -- what lets the callers test it without first testing for null.
  select jsonb_build_object(
    'bar', case
      when p.suitability_determination = 'not_suitable' then 'not_suitable'
      when p.provisional_start_date is not null
        and p.provisional_max_days is not null
        and (p.provisional_start_date + p.provisional_max_days) < coalesce(p_as_of, public.pa_today())
        and not p.clearances_on_file
        then 'provisional_expired'
      else null
    end,
    'suitabilityDetermination', coalesce(p.suitability_determination, 'pending'),
    'clearancesOnFile', p.clearances_on_file,
    'expiresOn', case
      when p.provisional_start_date is not null and p.provisional_max_days is not null
        then p.provisional_start_date + p.provisional_max_days
      else null
    end,
    'daysRemaining', case
      when p.clearances_on_file then 2147483647
      when p.provisional_start_date is not null and p.provisional_max_days is not null
        then (p.provisional_start_date + p.provisional_max_days) - coalesce(p_as_of, public.pa_today())
      else 2147483647
    end
  )
  from (
    select
      bp.suitability_determination,
      bp.provisional_start_date,
      bp.provisional_max_days,
      -- BACKLOG J71: the provisional window ends when the clearances arrive, which is what every
      -- surface already tells the manager it means.
      coalesce(
        exists (
          select 1 from public.employee_credentials c
          where c.employee_id = p_employee_id
            and c.credential_type = 'act34_criminal_history'
            and c.status = 'compliant'
        )
        and (
          coalesce(bp.pa_resident_two_years, true)
          or exists (
            select 1 from public.employee_credentials c
            where c.employee_id = p_employee_id
              and c.credential_type = 'act73_fbi_fingerprint'
              and c.status = 'compliant'
          )
        ),
        false
      ) as clearances_on_file
    from public.employee_background_check_profiles bp
    where bp.employee_id = p_employee_id
    union all
    select null::text, null::date, null::integer, false
    limit 1
  ) p;
$function$;

comment on function public.oapsa_duty_status(uuid, date) is
  'OAPSA provisional-employment status for one employee. The provisional bar lifts when the '
  'clearances are ON FILE -- a compliant Act 34, plus a compliant Act 73 when the profile says the '
  'employee has not been a Pennsylvania resident for two years -- not only when someone blanks the '
  'provisional dates. Before BACKLOG J71 the bar was purely arithmetic on the dates, so an '
  'employee whose clearances had arrived was blocked from every shift and only an AAL2 override '
  'could lift it, contradicting the form, the alert and the schedule label.';

-- ---------------------------------------------------------------------------
-- J73 (consumer half) -- what the claim path actually checks
-- ---------------------------------------------------------------------------
--
-- record_shift_call_off above gives open_shift_opportunities its first producer, which makes
-- claim_open_shift a live path for the first time. It called public.evaluate_schedule_eligibility
-- -- the BASE engine -- with the opportunity row's three requirement arrays, which is the same
-- under-check J18 found in the swap: the base engine does not read shift_eligibility_requirements
-- or service_workload_profiles, does not turn `outside_availability` into a hard block, and does
-- not enforce minimum_rest_hours. An employee could claim an opening onto the back of the
-- overnight they had just finished.
--
-- The claim now goes through public.evaluate_shift_assignment_eligibility, the same wrapper a
-- direct assignment and a swap use. The opportunity's own arrays are still enforced on top, so a
-- manager-authored opening that asks for more than its shift definition keeps asking for it.

create or replace function app_private.merge_eligibility_results(p_base jsonb, p_extra jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_blocks text[];
  v_warnings text[];
  v_overrides text[];
begin
  if p_extra is null then return p_base; end if;
  if p_base is null then return p_extra; end if;

  v_blocks := array(select distinct x from unnest(
    array(select jsonb_array_elements_text(coalesce(p_base->'hardBlocks', '[]'::jsonb)))
    || array(select jsonb_array_elements_text(coalesce(p_extra->'hardBlocks', '[]'::jsonb)))
  ) x order by x);
  v_warnings := array(select distinct x from unnest(
    array(select jsonb_array_elements_text(coalesce(p_base->'warnings', '[]'::jsonb)))
    || array(select jsonb_array_elements_text(coalesce(p_extra->'warnings', '[]'::jsonb)))
  ) x order by x);
  v_overrides := array(select distinct x from unnest(
    array(select jsonb_array_elements_text(coalesce(p_base->'appliedOverrideIds', '[]'::jsonb)))
    || array(select jsonb_array_elements_text(coalesce(p_extra->'appliedOverrideIds', '[]'::jsonb)))
  ) x order by x);

  return p_base
    || jsonb_build_object(
      'hardBlocks', to_jsonb(v_blocks),
      'warnings', to_jsonb(v_warnings),
      'appliedOverrideIds', to_jsonb(v_overrides),
      'outcome', case
        when cardinality(v_blocks) > 0 then 'blocked'
        when cardinality(v_warnings) > 0 or cardinality(v_overrides) > 0 then 'warning'
        else 'eligible'
      end
    );
end;
$$;

comment on function app_private.merge_eligibility_results(jsonb, jsonb) is
  'Unions two schedule-eligibility verdicts and recomputes the outcome, so a caller can enforce '
  'requirements from two sources -- the shift definition through '
  'evaluate_shift_assignment_eligibility, and an open-shift opportunity''s own arrays -- without '
  'either set being silently dropped. BACKLOG J73.';

revoke all on function app_private.merge_eligibility_results(jsonb, jsonb)
  from public, anon, authenticated;

do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'claim_open_shift';

  if v_def is null then
    raise exception 'claim_open_shift is missing';
  end if;

  v_old := 'v_result := public.evaluate_schedule_eligibility(
    v_employee.id, v_open.facility_id, v_starts, v_ends,
    v_open.required_qualification_keys, v_open.required_credential_types,
    v_open.required_training_type_ids, array[]::uuid[]
  );';

  v_new := 'v_result := public.evaluate_shift_assignment_eligibility(
    v_employee.id, v_open.facility_id, v_open.unit_id, v_open.shift_definition_id,
    v_starts, v_ends, array[]::uuid[]
  );
  if coalesce(cardinality(v_open.required_qualification_keys), 0)
     + coalesce(cardinality(v_open.required_credential_types), 0)
     + coalesce(cardinality(v_open.required_training_type_ids), 0) > 0 then
    v_result := app_private.merge_eligibility_results(v_result, public.evaluate_schedule_eligibility(
      v_employee.id, v_open.facility_id, v_starts, v_ends,
      v_open.required_qualification_keys, v_open.required_credential_types,
      v_open.required_training_type_ids, array[]::uuid[]
    ));
  end if;';

  if position(v_old in v_def) = 0 then
    raise exception 'claim_open_shift no longer contains the base-engine eligibility call this migration patches';
  end if;

  execute replace(v_def, v_old, v_new);
end;
$$;

comment on function public.claim_open_shift(uuid) is
  'An employee claims an open shift. Eligibility goes through '
  'evaluate_shift_assignment_eligibility -- the same wrapper a direct assignment and a swap use -- '
  'so the shift definition''s required qualifications, credentials and training, the availability '
  'window and minimum_rest_hours are all part of the question; the opportunity row''s own arrays '
  'are then enforced on top. It previously asked the base engine with the opportunity''s arrays '
  'alone, which read neither shift_eligibility_requirements nor the rest rule. BACKLOG J73.';
