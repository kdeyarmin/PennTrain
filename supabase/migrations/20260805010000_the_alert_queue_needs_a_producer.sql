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
-- TWO CONSEQUENCES THAT ARE NOT BUGS, STATED SO NOBODY DIAGNOSES THEM AS ONE.
--
--   * ALERTS WILL APPEAR IMMEDIATELY, INCLUDING FOR HISTORY. The thresholds count backwards over
--     the rule's lookback window, so a resident who already has two refusals recorded through the
--     successor alerts on the next one rather than waiting three more. That is the rule working on
--     the record as it stands, not a backfill. The seeded not_completed rule (threshold 1, lookback
--     1 day) alerts on every single not_completed, which is what a threshold of 1 means; facilities
--     that find it noisy should retune the rule through upsert_service_exception_rule, which is the
--     control that exists for it.
--   * THE OFFLINE PATH EVALUATES AGAINST SYNC TIME. sync_offline_service_task_draft calls this
--     function and then overwrites performed_at with the device's own occurrence time, so the
--     evaluation inside this call still sees performed_at = now(). A draft that occurred outside the
--     rule's lookback but syncs inside it is therefore counted. Reordering that would mean either
--     changing this function's signature or reimplementing its row-lock/status-check path, which
--     20260802060000 explicitly declines to do, and the error is bounded (a device purges unsynced
--     drafts within days) and one-directional: it can raise an alert a strictly-corrected timeline
--     would not, never suppress one it would. For a queue a human acknowledges, raising is the safe
--     direction. Recorded in the backlog rather than worked around here.

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

-- Unchanged from 20260726060100 apart from the two additions marked below. Reproduced in full
-- because create or replace cannot patch a body; the authorization, plan-response validation, and
-- assistance-level rules are byte-for-byte the same.
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
declare
  v_task public.resident_service_task_instances%rowtype;
  v_requirement public.resident_service_requirements%rowtype;
  v_employee public.employees%rowtype;
  v_is_manager boolean;
  v_status text;
  v_level text;
  v_details jsonb := coalesce(p_exception_details, '{}'::jsonb);
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
  if v_status = 'completed'
    and now() > v_task.scheduled_end
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
    performed_at = now(),
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

-- create or replace preserves the existing ACL, so the 20260726060100 grants to authenticated and
-- service_role carry over untouched. Restated as an assertion rather than an assumption.
do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.record_service_task_response(uuid,text,jsonb,uuid)',
    'EXECUTE'
  ) then
    raise exception 'record_service_task_response lost its authenticated grant during replace';
  end if;
end $$;

comment on function public.record_service_task_response(uuid, text, jsonb, uuid) is
  'The service-outcome command every in-repo surface uses (Floor, the manager workspace, and the '
  'offline sync path). Writes the status and the structured completion response, stamps '
  'completed_late for kinds that have a due window, and evaluates the facility''s exception rules '
  'so public.service_task_alerts has a producer -- see 20260805010000.';

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
