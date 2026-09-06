-- Workforce: the handoff an auditor could acknowledge, the absence that approved itself, and the
-- credential notification that sent the employee to a page their role cannot open.
--
-- BACKLOG J74 (P3 tail, Workforce / scheduling): K2, K3, K5.
--
-- Every patch below is applied with pg_get_functiondef() + a guarded replace() rather than a fresh
-- `create or replace`, because each of these three bodies was already edited earlier in this
-- session (20260906070000 for the call-off guards, 20260906140000 for the facility predicates) and
-- a rewrite from any file that ever defined them would silently revert those fixes.

-- ---------------------------------------------------------------------------
-- K3 -- any org member, including an auditor, could acknowledge a shift handoff
-- ---------------------------------------------------------------------------
--
-- acknowledge_shift_report_entry is SECURITY DEFINER and its only gate was
-- `is_platform_admin() or organization_id = current_org_id()`. Acknowledging a handoff entry is a
-- clinical act -- it is the record that the oncoming shift received the information, and
-- shift_report_acknowledgements is what the escalation job and the inbox read to decide an entry
-- has been picked up. An auditor (read-only by design), a trainer at another building, or any
-- employee of the tenant with no connection to that facility could write it, and the entry would
-- then read as handed over to a person who was never on the floor.
--
-- The predicate used here is the one create_shift_report_entry already applies to WRITING an
-- entry: platform admin; org_admin in the tenant; facility_manager or trainer assigned to that
-- facility; or someone whose own employee record serves that facility
-- (is_own_employee_assigned_to_facility reads employee_facility_assignments, so the aide who works
-- a second site is admitted -- the point 20260906140000 made). Whoever may write a handoff entry
-- may acknowledge one; nobody else may. auditor is in none of those arms.
do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.acknowledge_shift_report_entry(uuid)'::regprocedure);
  v_old := $old$  if not (public.is_platform_admin() or v.organization_id = public.current_org_id()) then raise exception 'Not authorized' using errcode='42501'; end if;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'acknowledge_shift_report_entry no longer contains the org-wide gate this migration patches';
  end if;
  v_new := $patch$  if not coalesce((
    public.is_platform_admin()
    or (
      v.organization_id = public.current_org_id()
      and (
        public.current_role() = 'org_admin'
        or (
          public.current_role() in ('facility_manager', 'trainer')
          and public.is_assigned_to_facility(v.facility_id)
        )
        or public.is_own_employee_assigned_to_facility(v.facility_id)
      )
    )
  ), false) then
    raise exception 'Not authorized to acknowledge this shift report entry' using errcode='42501';
  end if;$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

comment on function public.acknowledge_shift_report_entry(uuid) is
  'Records that the caller received a shift handoff entry. Scoped to the people who work the shift '
  '-- platform admin, org_admin, a facility_manager/trainer assigned to the facility, or an '
  'employee whose facility assignments include it -- the same set create_shift_report_entry admits '
  'as authors. An auditor is deliberately excluded: acknowledgement is a clinical act, not a read.';

-- ---------------------------------------------------------------------------
-- K2 -- a self-service call-off approved its own absence
-- ---------------------------------------------------------------------------
--
-- 20260906070000 gave record_shift_call_off the two guards it was missing (status must be
-- scheduled/confirmed, the shift must not already have ended, and an employee cannot call off a
-- shift on an unpublished schedule). What it left is the third half of the same finding: the
-- absence row is inserted with status 'approved', so an employee calling off their own shift
-- writes an APPROVED workforce_time_off_requests row with no manager anywhere in the loop. The
-- manager's own queue reads `status = 'pending'` (useWorkforceSelfServiceQueues), so the one row
-- that most needs a decision -- was this absence excused? -- was the one row the queue never
-- showed.
--
-- Only the SELF-SERVICE path changes. A manager or platform admin recording a call-off on
-- somebody's behalf IS the decision, so that row stays 'approved'; making them approve their own
-- entry a second time would be noise. decide_time_off_request already handles either row, and the
-- work_items row this function opens is matched by it on source_id, so the manager's decision
-- lands in work_item_history as well.
--
-- The operational half is unchanged and deliberately so: the shift still becomes 'called_off', the
-- unfilled-shift work item still opens, and the open-shift opportunity is still posted. The shift
-- is uncovered whether or not the absence is later excused; only the HR verdict is now a decision
-- somebody makes.
do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef(
    'public.record_shift_call_off(uuid, text, text, timestamptz, timestamptz)'::regprocedure);
  v_old := $old$    'approved', nullif(btrim(p_reason), ''), v_shift.id, auth.uid(), 'call-off:' || v_shift.id::text)$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'record_shift_call_off no longer inserts the absence row this migration patches';
  end if;
  v_new := $patch$    case when v_is_self and not public.is_platform_admin() then 'pending' else 'approved' end,
    nullif(btrim(p_reason), ''), v_shift.id, auth.uid(), 'call-off:' || v_shift.id::text)$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

comment on function public.record_shift_call_off(uuid, text, text, timestamptz, timestamptz) is
  'Records a call-off against a scheduled or confirmed shift that has not ended, on a published '
  'schedule when the caller is the employee. Marks the shift called_off, opens the unfilled-shift '
  'work item, and posts an open-shift opportunity for a full-shift absence. The absence row is '
  'pending when the employee filed it themselves -- the manager decides it in the self-service '
  'queue -- and approved when a manager or platform admin filed it, because that call IS the '
  'decision.';

-- ---------------------------------------------------------------------------
-- K5 -- credential notifications sent employees to a manager-only route
-- ---------------------------------------------------------------------------
--
-- Both of these notify the EMPLOYEE (e.profile_id) and hard-code '/app/credentials'. That route is
-- ProtectedRoute-gated to org_admin / facility_manager / auditor, so the person the message is
-- addressed to is the one person who cannot open it: ProtectedRoute redirects them away from their
-- own approved renewal. /me/credentials is the same record on the employee's side of the product,
-- and it is where the renewal was uploaded from in the first place.
--
-- The link is chosen from the RECIPIENT's role rather than hard-coded to /me/credentials, because
-- these rows also reach staff who hold a manager profile and an employee record at once; sending
-- them to an employee-only route would just move the redirect.
do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef(
    'public.review_credential_renewal_submission(uuid, text, jsonb, text)'::regprocedure);
  v_old := $old$    'Credential renewal approved', 'Your reviewed credential renewal is now effective.',
    '/app/credentials'
  from public.employees e where e.id = v_submission.employee_id and e.profile_id is not null;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'review_credential_renewal_submission no longer emits the notification this migration patches';
  end if;
  v_new := $patch$    'Credential renewal approved', 'Your reviewed credential renewal is now effective.',
    case when p.role = 'employee' then '/me/credentials' else '/app/credentials' end
  from public.employees e
  join public.profiles p on p.id = e.profile_id
  where e.id = v_submission.employee_id and e.profile_id is not null;$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef(
    'public.approve_certification_attempt(uuid, text, text, text)'::regprocedure);
  v_old := $old$    'Qualification approved', v_definition.name || ' is active.', '/app/credentials'
  from public.employees e where e.id = v_attempt.employee_id and e.profile_id is not null;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'approve_certification_attempt no longer emits the notification this migration patches';
  end if;
  v_new := $patch$    'Qualification approved', v_definition.name || ' is active.',
    case when p.role = 'employee' then '/me/credentials' else '/app/credentials' end
  from public.employees e
  join public.profiles p on p.id = e.profile_id
  where e.id = v_attempt.employee_id and e.profile_id is not null;$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;
