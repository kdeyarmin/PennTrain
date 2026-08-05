-- The service_task_alerts queue gets a producer again.
--
-- THE GAP. 20260805000000 established, while arguing that public.record_resident_service_task
-- cannot be dropped, that it is "the only thing that still fills the service_task_alerts queue".
-- That is true, and it is the problem rather than a footnote: no in-repo surface calls that command
-- any more. Floor and the manager workspace both reach public.record_service_task_response
-- (useRecordResidentServiceTask kept the old name but not the old target), the offline sync path
-- calls it too, and it has never evaluated exception thresholds. So since the UI moved to the
-- successor the queue has had exactly one writer left -- a command only callers outside this
-- repository still use.
--
-- Meanwhile the read side is fully wired and has been the whole time. useListServiceTaskAlerts
-- polls it, ServiceDelivery.tsx renders an "Exception alerts" tab off it, useResolveServiceTaskAlert
-- acknowledges and resolves rows in it, record_change_of_condition_event accepts one as its
-- source_service_alert_id and acknowledges it on the way through, and invalidateServiceTasks
-- already invalidates the ["service-task-alerts"] query key after every recorded task. Every
-- facility also gets four exception rules seeded automatically (the trigger on public.facilities:
-- not_completed at 1-in-1-day to a supervisor, refusals and unavailability at 3-in-7-days, late
-- services at 3-in-7-days to QAPI), and managers can edit them through
-- public.upsert_service_exception_rule. All of that configures, displays, and resolves a queue that
-- nothing has written to.
--
-- That is the failure mode worth naming: not an error, not an empty state that looks broken, but an
-- escalation path that reads as working. A manager who configures "three refusals in seven days
-- routes to support-plan review" and then sees no alerts concludes it has not happened yet.
--
-- THE FIX. record_service_task_response calls app_private.evaluate_service_task_exception at the
-- end, exactly as the legacy command does, on the same updated row. The evaluation function itself
-- is unchanged -- the thresholds, the alert-type mapping, the severity, and the
-- on-conflict-do-nothing dedupe per (task_instance_id, alert_type) all stay as they are. This
-- restores the producer rather than designing a second one.
--
-- SO 20260805000000'S "ALERTING" BULLET IS NOW SUPERSEDED, and only that one. It listed four ways a
-- delegating shim over the successor would diverge from the legacy command; the alerting divergence
-- is closed here. The other three are untouched and still decide SG-4: completed_by_other has no
-- faithful successor response, the successor does not enforce the note or two-staff rules the legacy
-- command enforces, and it does enforce a plan-response rule the legacy command never had. The
-- function comments at the bottom of this file are rewritten accordingly, because the old ones now
-- assert something false ("called from exactly one place").
--
-- WHY completed_late HAD TO BE PART OF THIS. Wiring the call in alone would have left one of the
-- four seeded rules dead on arrival. app_private.evaluate_service_task_exception keys on the task's
-- status, and service_exception_rules.exception_status is CHECK-constrained to four of them:
-- resident_refused, resident_unavailable, not_completed, completed_late. The successor writes the
-- first three but has never written the fourth -- every response that is not a refusal, an
-- unavailability, or a non-completion maps to a flat 'completed'. The legacy command stamps
-- completed_late when the outcome is a completion recorded after scheduled_end. So the
-- 'completed_late' rule every facility is seeded with -- 3 in 7 days, routed to QAPI -- could never
-- fire for an in-repo caller no matter how many services ran late.
--
-- This is not new behaviour being invented for the status axis. The rest of the product has been
-- built around completed_late since 20260713160000 and simply never sees one: the facility
-- analytics count it in the service-completion numerator and in serviceExceptions, QAPI and the
-- dietary/calendar/complaints dashboards each report a lateServices figure off it, the resident 360
-- timeline counts it in exceptionsLast7Days, record_service_exception_follow_up accepts it as an
-- exception status, ServiceDelivery.tsx has a "Completed late" label and an amber badge for it, and
-- residentCareConflicts treats it as a more-assistance signal. Every consumer is waiting for a
-- status no current writer produces. The response axis is untouched: completion_response still
-- records what staff chose, and 20260726060100's reason for keeping the two axes separate -- "care
-- that happened stays completed even when it carried an exception" -- is exactly why lateness
-- belongs on the status and not on the response.
--
-- BUT ONLY FOR KINDS THAT HAVE A DUE WINDOW. 20260726050100 added task_kind and stated the rule on
-- the column itself: "Only scheduled_care/shift_task/weekly_task have a due window; the rest must
-- not raise missed-window alerts." Nothing on the server has ever enforced it, because nothing on
-- the server has had reason to ask. The generator gives every requirement a scheduled_start and
-- scheduled_end from its time window regardless of kind, so an as_needed service -- "No due window;
-- recorded when it happens" -- would be stamped late essentially every time it was recorded, and
-- three of those would open a QAPI alert for a service that cannot be late by definition. The late
-- stamp is therefore gated on app_private.task_kind_has_due_window, added here as the server-side
-- twin of taskKindHasDueWindow in serviceDeliveryContract.ts, whose whole stated purpose is that
-- "the seeds, the RPC, and the UI cannot drift apart". A requirement that cannot be read is treated
-- as having no due window, so a missing row can never manufacture an alert.
--
-- The legacy command keeps stamping completed_late without that gate. That is deliberate: it
-- predates task_kind entirely, and per 20260805000000 its behaviour is not this repository's to
-- change for callers it cannot enumerate. It is a fifth divergence between the two commands, and
-- it is recorded rather than fixed.
--
-- ONE CONSEQUENCE THAT IS NOT A BUG, STATED SO NOBODY DIAGNOSES IT AS ONE. ALERTS WILL APPEAR
-- IMMEDIATELY, INCLUDING FOR HISTORY. The thresholds count backwards over the rule's lookback
-- window, so a resident who already has two refusals recorded through the successor alerts on the
-- next one rather than waiting three more. That is the rule working on the record as it stands, not
-- a backfill. The seeded not_completed rule (threshold 1, lookback 1 day) alerts on every single
-- not_completed, which is what a threshold of 1 means; facilities that find it noisy should retune
-- the rule through upsert_service_exception_rule, which is the control that exists for it.
--
-- AND THE OFFLINE PATH, WHICH THE FIRST DRAFT OF THIS MIGRATION GOT WRONG. Making completed_late
-- reachable made the offline path's existing shape wrong, and it took review to see it.
-- sync_offline_service_task_draft used to call the command and then overwrite performed_at with the
-- device's own occurrence time. That was enough while the command only wrote a timestamp; it is not
-- enough now that the command also decides a status from one. Care given at 10:30 inside a
-- 09:00-11:00 window, on a device that reconnects at 14:00, would have been decided against
-- sync-time now(), stamped completed_late, counted toward the late-service threshold, and only then
-- had its performed_at corrected -- leaving a resident's service history asserting that on-time care
-- was late. This migration was originally going to note the timing as a bounded, one-directional
-- alerting nuance. That was the wrong reading: it is not an alert that is slightly eager, it is a
-- false statement on a regulatory record, and it is the same failure 20260805000000 refused a shim
-- over.
--
-- So the occurrence time is passed in rather than patched over afterwards. app_private
-- .record_service_task_response takes it, and decides the late stamp, performed_at, and the
-- thresholds from that one instant, so the three cannot disagree. The public function keeps its
-- exact signature and does not take it -- see the note above it for why that boundary matters.

create or replace function app_private.task_kind_has_due_window(p_task_kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- Null-safe on purpose: an unknown or unreadable kind has no due window, so it cannot be late and
  -- cannot raise a missed-window alert. Mirrors taskKindHasDueWindow in serviceDeliveryContract.ts;
  -- the two lists must stay identical.
  select coalesce(p_task_kind in ('scheduled_care', 'shift_task', 'weekly_task'), false);
$$;

revoke all on function app_private.task_kind_has_due_window(text)
  from public, anon, authenticated, service_role;

comment on function app_private.task_kind_has_due_window(text) is
  'Server-side twin of taskKindHasDueWindow (serviceDeliveryContract.ts). Only scheduled_care, '
  'shift_task, and weekly_task have a due window, so only they can be recorded late or raise a '
  'missed-window alert. Null or unrecognized kinds answer false.';

-- The implementation moves to app_private so it can take an occurrence time, and the public
-- signature does not change at all -- see the OFFLINE section of the header for why it needed one.
--
-- WHY THE PARAMETER IS NOT ON THE PUBLIC FUNCTION. public.record_service_task_response is granted to
-- authenticated. A caller-supplied performed_at on that surface would let any employee backdate care
-- -- in particular, backdate it inside a window it missed and erase its own completed_late stamp,
-- which is precisely the record this migration exists to start keeping. Today they cannot: the
-- public path always stamps now(). Keeping the parameter in app_private, revoked from every role,
-- means only a SECURITY DEFINER function that has already established whose device it is and
-- whether the timestamp is plausible can supply one. That is sync_offline_service_task_draft, and
-- it is the only caller.
--
-- Body is 20260726060100's, unchanged apart from the three additions marked below. Reproduced in
-- full because create or replace cannot patch a body; the authorization, plan-response validation,
-- and assistance-level rules are byte-for-byte the same.
create or replace function app_private.record_service_task_response(
  p_task_id uuid,
  p_response text,
  p_exception_details jsonb default '{}'::jsonb,
  p_second_employee_id uuid default null,
  -- ADDED. When the care actually happened, for a caller that knows better than now() and has
  -- already validated it. Null means now(), which is every online caller.
  p_performed_at timestamptz default null
)
returns public.resident_service_task_instances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.resident_service_task_instances%rowtype;
  v_requirement public.resident_service_requirements%rowtype;
  v_employee public.employees%rowtype;
  v_is_manager boolean;
  v_status text;
  v_level text;
  v_details jsonb := coalesce(p_exception_details, '{}'::jsonb);
  -- ADDED. One instant used for the late decision, the stored performed_at, and therefore the
  -- threshold evaluation that reads it -- so the three can never disagree.
  v_performed_at timestamptz := coalesce(p_performed_at, now());
begin
  select * into v_task from public.resident_service_task_instances where id = p_task_id for update;
  if not found then raise exception 'Service task not found' using errcode = 'P0002'; end if;
  if v_task.status <> 'scheduled' then
    raise exception 'Only scheduled service tasks can be recorded' using errcode = '55000';
  end if;
  if jsonb_typeof(v_details) <> 'object' then
    raise exception 'Exception details must be an object' using errcode = '22023';
  end if;

  select * into v_requirement from public.resident_service_requirements where id = v_task.requirement_id;

  -- Same authorization shape as record_resident_service_task: a manager at the facility, or the
  -- employee the task belongs to.
  select * into v_employee from public.employees e where e.profile_id = auth.uid() and e.status = 'active';
  v_is_manager := public.is_platform_admin()
    or (
      public.current_org_id() = v_task.organization_id
      and public.current_role() in ('org_admin', 'facility_manager')
      and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(v_task.facility_id))
    );
  if not v_is_manager and (
    v_employee.id is null
    or v_employee.facility_id <> v_task.facility_id
    or (v_task.assigned_employee_id is not null and v_task.assigned_employee_id <> v_employee.id)
  ) then
    raise exception 'Service task is outside caller scope' using errcode = '42501';
  end if;

  -- The plan decides which responses this service accepts. Offering a response the plan does not
  -- allow -- a resident refusal on a manager review, say -- would record something that cannot have
  -- happened.
  if v_requirement.id is not null
    and not (p_response = any(v_requirement.acceptable_completion_responses)) then
    raise exception 'Response % is not accepted for this service', p_response using errcode = '22023';
  end if;

  v_status := case p_response
    when 'resident_refused' then 'resident_refused'
    when 'resident_unavailable' then 'resident_unavailable'
    when 'not_completed' then 'not_completed'
    else 'completed'
  end;

  -- ADDED. Lateness is a fact about delivery, so it lands on the status the way the legacy command
  -- has always recorded it, leaving completion_response to say what staff actually chose. Gated on
  -- the requirement's kind: a service with no due window cannot be late, and stamping one would
  -- feed the seeded completed_late -> QAPI rule with services that were never late. See header.
  --
  -- Decided against v_performed_at, not now(): "late" is a claim about when the care happened, and
  -- for an offline draft those are different instants. Deciding it from now() would record care
  -- given inside its window as late purely because the device reconnected after it -- a false
  -- statement on a resident's service history, not a scheduling nuance.
  if v_status = 'completed'
    and v_performed_at > v_task.scheduled_end
    and app_private.task_kind_has_due_window(v_requirement.task_kind) then
    v_status := 'completed_late';
  end if;

  v_level := nullif(btrim(coalesce(v_details->>'assistance_level', '')), '');
  if p_response <> 'completed_with_more_assistance' then
    v_level := null;
  elsif v_level is null then
    raise exception 'Recording extra assistance requires the level that was needed' using errcode = '22023';
  end if;

  update public.resident_service_task_instances set
    status = v_status,
    completion_response = p_response,
    exception_details = v_details,
    documented_assistance_level = v_level,
    -- ADDED. Was now(). Identical for every online caller, since v_performed_at defaults to it;
    -- for the offline path this is what removes the post-hoc overwrite that used to follow this
    -- call, and with it the window where the row said one thing and the device knew another.
    performed_at = v_performed_at,
    recorded_by_profile_id = auth.uid(),
    completed_by_employee_id = coalesce(v_employee.id, completed_by_employee_id),
    second_employee_id = coalesce(p_second_employee_id, second_employee_id),
    supervisor_notified = coalesce((v_details->>'supervisor_notified')::boolean, false),
    supervisor_notified_at = case
      when coalesce((v_details->>'supervisor_notified')::boolean, false) then now()
      else supervisor_notified_at end,
    note = nullif(btrim(coalesce(v_details->>'note', '')), ''),
    updated_at = now()
  where id = v_task.id
  returning * into v_task;

  -- ADDED. The reason this migration exists. Same call, same updated row, and same position at the
  -- end of the command as in record_resident_service_task, so the two writers of an exception status
  -- evaluate the facility's rules identically. Insert is deduped per (task_instance_id, alert_type),
  -- so a caller that retries cannot double-alert.
  perform app_private.evaluate_service_task_exception(v_task);

  return v_task;
end $$;

revoke all on function app_private.record_service_task_response(uuid, text, jsonb, uuid, timestamptz)
  from public, anon, authenticated, service_role;

comment on function app_private.record_service_task_response(uuid, text, jsonb, uuid, timestamptz) is
  'The service-outcome implementation. Identical to the public command except that it accepts the '
  'instant the care happened, which decides the completed_late stamp, is stored as performed_at, '
  'and is therefore what the exception thresholds count. Revoked from every role on purpose: a '
  'caller-supplied performed_at on a surface granted to authenticated would let an employee backdate '
  'care out of its own missed window. Only a SECURITY DEFINER function that has already checked '
  'device ownership and timestamp plausibility may pass one -- today that is exactly '
  'public.sync_offline_service_task_draft. See 20260805010000.';

-- The public signature is untouched, so the 20260726060100 grants to authenticated and service_role
-- carry over and no PostgREST caller sees a different surface. Restated as an assertion rather than
-- an assumption, and it now also proves the wrapper below did not accidentally change the arity.
create or replace function public.record_service_task_response(
  p_task_id uuid,
  p_response text,
  p_exception_details jsonb default '{}'::jsonb,
  p_second_employee_id uuid default null
)
returns public.resident_service_task_instances
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No occurrence time: an online caller is documenting care as it happens, so now() is the truth
  -- and there is nothing for a client to assert about when it happened. plpgsql rather than sql
  -- deliberately -- a sql body returning a composite would either not match this signature or,
  -- written as (...).*, call the implementation once per column.
  return app_private.record_service_task_response(
    p_task_id, p_response, p_exception_details, p_second_employee_id, null
  );
end $$;

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.record_service_task_response(uuid,text,jsonb,uuid)',
    'EXECUTE'
  ) then
    raise exception 'record_service_task_response lost its authenticated grant during replace';
  end if;
  if has_function_privilege(
    'authenticated',
    'app_private.record_service_task_response(uuid,text,jsonb,uuid,timestamptz)',
    'EXECUTE'
  ) then
    raise exception 'the occurrence-time implementation must not be reachable by authenticated';
  end if;
end $$;

comment on function public.record_service_task_response(uuid, text, jsonb, uuid) is
  'The service-outcome command every online in-repo surface uses (Floor and the manager workspace). '
  'A thin wrapper over app_private.record_service_task_response that supplies no occurrence time, '
  'because an online caller is documenting care as it happens: the implementation writes the status '
  'and the structured completion response, stamps completed_late for kinds that have a due window, '
  'and evaluates the facility''s exception rules so public.service_task_alerts has a producer. The '
  'occurrence-time parameter is deliberately absent from this signature -- see 20260805010000.';

-- 20260805000000 recorded both of these as "the only" alert path. That stopped being true above,
-- and a reason that quietly goes stale is the thing that migration was written to prevent.
comment on function app_private.evaluate_service_task_exception(public.resident_service_task_instances) is
  'Threshold evaluation behind public.service_task_alerts. Called at the end of both writers of an '
  'exception status: public.record_service_task_response (every in-repo surface, wired in '
  '20260805010000) and public.record_resident_service_task (the superseded command retained for '
  'out-of-repo callers, backlog SG-4). Inserts are deduped per (task_instance_id, alert_type).';

comment on function public.record_resident_service_task(uuid, text, text, boolean, uuid) is
  'SUPERSEDED by record_service_task_response but DELIBERATELY RETAINED -- do not drop, revoke, or '
  'reduce to a shim without reading 20260805000000 (backlog SG-4). It is still granted to '
  'authenticated, so out-of-repo callers can still reach it, and it accepts completed_by_other, '
  'which the successor''s response vocabulary cannot express and would silently record as an '
  'ordinary completion. It is no longer the only caller of '
  'app_private.evaluate_service_task_exception -- 20260805010000 gave the successor that call too -- '
  'so the alerting argument in 20260805000000 is closed; the completed_by_other and validation '
  'arguments are not. It also still stamps completed_late without checking task_kind, which the '
  'successor now does.';

-- ---------------------------------------------------------------------------
-- The shift workspace has to drop a late completion the way it drops any other
-- ---------------------------------------------------------------------------
--
-- get_my_shift_workspace builds its residentServiceTasks array -- the "Assigned resident services"
-- list and the due-count badge on MyShift.tsx -- by excluding only 'completed' and 'superseded'.
-- That was complete while the successor collapsed every completion into 'completed'. It is not any
-- more: a task documented after its due window now lands 'completed_late', stays in the array, and
-- keeps counting as due to the very employee who just documented it, until it falls out of the
-- -4h/+16h scheduled_start window on its own.
--
-- Fixed as the completed family rather than by adding one status, which also closes a gap that was
-- already there: 'completed_by_other' -- the legacy command's own outcome -- lingered the same way,
-- and only went unnoticed because no in-repo surface produces it. The three exception statuses stay
-- in the list deliberately; a refusal or a non-completion is care that still needs someone's
-- attention, which is the opposite of a completion.
--
-- Body reproduced from 20260727020000 with the one predicate changed and every other line
-- byte-identical, in that migration's own style.
CREATE OR REPLACE FUNCTION public.get_my_shift_workspace()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_employee public.employees%rowtype; v_shift jsonb; v_result jsonb;
begin
  select * into v_employee from public.employees where profile_id = auth.uid() limit 1;
  if not found then return jsonb_build_object('employee', null, 'currentOrNextShift', null, 'handoffItems', '[]'::jsonb, 'residentServiceTasks', '[]'::jsonb, 'workItems', '[]'::jsonb, 'notifications', '[]'::jsonb, 'openShiftOffers', '[]'::jsonb, 'timeOffRequests', '[]'::jsonb, 'upcomingShifts', '[]'::jsonb); end if;
  select to_jsonb(s) into v_shift from (
    select sa.*, f.name as facility_name, u.name as unit_name, sd.name as shift_name
    from public.shift_assignments sa join public.facilities f on f.id=sa.facility_id left join public.facility_units u on u.id=sa.unit_id left join public.shift_definitions sd on sd.id=sa.shift_definition_id
    where sa.employee_id=v_employee.id
      and (sa.shift_date + sa.end_time + case when sa.end_time <= sa.start_time then interval '1 day' else interval '0' end) >= public.pa_now()
      and sa.status in ('scheduled','confirmed') order by sa.shift_date, sa.start_time limit 1
  ) s;
  select jsonb_build_object(
    'employee', jsonb_build_object('id', v_employee.id, 'name', btrim(v_employee.first_name || ' ' || v_employee.last_name), 'status', v_employee.status),
    'currentOrNextShift', v_shift,
    'handoffItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.priority desc, x.created_at desc) from (select id, category, priority, narrative, requires_acknowledgement, status, created_at, linked_work_item_id from public.shift_report_entries where facility_id = coalesce((v_shift->>'facility_id')::uuid, v_employee.facility_id) and status in ('open','carried_forward') limit 20) x), '[]'::jsonb),
    'residentServiceTasks', coalesce((select jsonb_agg(to_jsonb(x) order by x.scheduled_start) from (select id, resident_id, service_name, scheduled_start, scheduled_end, status from public.resident_service_task_instances where assigned_employee_id = v_employee.id and scheduled_start >= now() - interval '4 hours' and scheduled_start < now() + interval '16 hours' and status not in ('completed','completed_late','completed_by_other','superseded') limit 20) x), '[]'::jsonb),
    'workItems', coalesce((select jsonb_agg(to_jsonb(x) order by x.due_at) from (select id, title, priority, due_at, state, source_type, source_id from public.work_items where owner_profile_id = auth.uid() and state not in ('closed','canceled') order by due_at limit 20) x), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id, notification_type, title, body, link, created_at from public.notifications where profile_id=auth.uid() and read_at is null order by created_at desc limit 10) x), '[]'::jsonb),
    'openShiftOffers', coalesce((select jsonb_agg(to_jsonb(x) order by x.shift_date, x.start_time) from (select id, facility_id, shift_date, start_time, end_time, status from public.open_shift_opportunities where organization_id=v_employee.organization_id and status='open' and shift_date >= public.pa_today() order by shift_date, start_time limit 10) x), '[]'::jsonb),
    'timeOffRequests', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from (select id, request_type, starts_at, ends_at, status, absence_category from public.workforce_time_off_requests where employee_id=v_employee.id order by starts_at desc limit 10) x), '[]'::jsonb),
    'upcomingShifts', coalesce((select jsonb_agg(to_jsonb(x) order by x.shift_date, x.start_time) from (select sa.id, sa.shift_date, sa.start_time, sa.end_time, sa.status, f.name as facility_name, u.name as unit_name, sd.name as shift_name from public.shift_assignments sa join public.facilities f on f.id=sa.facility_id left join public.facility_units u on u.id=sa.unit_id left join public.shift_definitions sd on sd.id=sa.shift_definition_id where sa.employee_id=v_employee.id and sa.shift_date >= public.pa_today() order by sa.shift_date, sa.start_time limit 7) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

comment on function public.get_my_shift_workspace() is
  'The employee shift dashboard payload. residentServiceTasks excludes the whole completed family '
  '(completed, completed_late, completed_by_other) and superseded, so a documented task leaves the '
  'due list however it was completed; the exception statuses stay, because they still need '
  'attention. See 20260805010000, which made completed_late reachable.';

-- ---------------------------------------------------------------------------
-- The offline path tells the command when the care happened
-- ---------------------------------------------------------------------------
--
-- Body reproduced from 20260803140000 with two changes and every other line byte-identical: it
-- calls the app_private implementation with its already-validated occurrence time, and the
-- performed_at overwrite that used to follow the call is gone because the call now does it.
--
-- The plausibility judgment does not move. This function still decides whether to trust
-- p_client_occurred_at (not more than 5 minutes ahead, not more than 30 days behind) and still
-- stores the raw value on the receipt either way; an untrusted timestamp simply falls back to now()
-- at the call site instead of skipping an overwrite afterwards. What changes is only that the
-- judgment now reaches the command that needs it, before it decides anything.
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
      perform app_private.record_service_task_response(
        p_task_id, p_response, coalesce(p_exception_details, '{}'::jsonb), null,
        coalesce(v_performed_at, now())
      );
      -- performed_at, the completed_late decision, and the exception thresholds now all come from
      -- the single timestamp passed above, so the overwrite that used to sit here is gone. It could
      -- only ever fix the column: the status had already been decided from sync-time now(), which
      -- recorded care given inside its window as late whenever the device reconnected after it, and
      -- the thresholds had already counted that wrong status. Passing the instant in is not a
      -- reimplementation of record_service_task_response's row-lock/status-check path -- it is what
      -- that path needed to be told, and the whole reason the correction existed (20260805010000).
      -- An implausible client timestamp still falls back to now(), exactly as it did before.
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

comment on function public.sync_offline_service_task_draft(uuid, uuid, text, timestamptz, text, jsonb) is
  'Syncs one offline service-documentation draft. Calls the app_private service-outcome '
  'implementation with the device''s own validated occurrence time, so performed_at, the '
  'completed_late stamp, and the exception thresholds are all decided from when the care actually '
  'happened rather than when the device reconnected -- see 20260805010000. Block-and-flag: '
  'conflict/stale/rejected leave the task untouched and are returned for the client to keep locally '
  'until a human dismisses them, never merged or retried automatically. An idempotency-key replay '
  'returns the outcome the first attempt actually produced (conflict/stale/rejected/wipe_required '
  'included), not a blanket duplicate -- only an originally-applied or originally-duplicate attempt '
  'replays as duplicate.';
