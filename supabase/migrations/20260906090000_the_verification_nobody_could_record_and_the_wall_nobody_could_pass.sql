-- The verification nobody could record, the wall a demo tenant could not pass, and three clocks
-- that disagreed about a plan of correction.
--
-- BACKLOG J13, J14, J15 and J60.
--
-- J13. `approve_incident_investigation` refuses while any completed corrective action has an empty
-- `verification_notes`, and the client stage engine blocks closure on the same column. Nothing
-- writes it. The Complete button sends `{status, completed_date}`, the corrective-action form has
-- no notes field, and the only writers in the repository are for `work_orders.verification_notes`,
-- a different table. So an incident with a completed corrective action can never be approved,
-- `enforce_incident_final_report_before_close` will not let it close without approval, and its
-- work item never leaves the queue. The only escape was cancelling every action, which erases the
-- record of the corrective work. This adds the writer, and the two columns that make a
-- verification a verification rather than a free-text field: who, and when.
--
-- J14. `identity_operation_requires_aal2` never looked at `organizations.is_demo`, while
-- `get_my_mfa_policy` does -- so a demo tenant is told MFA is not required at sign-in and is then
-- refused at every privileged button with "A fresh AAL2 session is required for operation
-- workforce_admin". A demo manager who was never asked to enrol an authenticator cannot approve a
-- work item, run Survey Day, triage a confidential report or apply a lifecycle case: the flows a
-- sales demo exists to show.
--
-- The second half is that `workforce_admin` had become one label over two very different bars.
-- Unmasking a confidential reporter is irreversible and belongs behind step-up. Approving a work
-- item, retiming one, running the Survey Day checklist and moving an employee between facilities
-- are what an operational manager does all day. They are now `operational_admin`, which is NOT in
-- the default sensitive-operations baseline, so an operational manager is no longer held to the
-- identity-administrator bar; a tenant that wants them there adds the operation to its own
-- `identity_security_policies` row. The reveal gets its own operation and stays in the baseline,
-- and every existing tenant policy that listed `workforce_admin` gains it.
--
-- J15. The `violation:<id>` work item was created with `due_at = poc_due_date::timestamptz`. The
-- repository's own `pa_midnight` comment says what that is: "NOT p_day::timestamptz, which reads
-- the day as midnight UTC -- 20:00 the previous evening here." So the queue called a plan of
-- correction overdue at 20:01 Eastern the evening BEFORE its deadline and escalated it inside
-- fifteen minutes, while `run_plan_of_correction_escalations` called the same POC overdue a day
-- later. And the item was registered by an AFTER INSERT trigger only, so correcting the due date
-- on the violation moved neither clock. The due instant is now the end of the Pennsylvania day the
-- POC is due, and a change to `poc_due_date` re-registers the item.
--
-- J60. `update_work_item_assignment` never cleared `escalated_at`, so an item a manager had
-- deliberately retimed stayed "Escalated" in the queue for ever and was never re-escalated when
-- the new date passed.

-- ---------------------------------------------------------------------------
-- J13 -- a corrective action can be verified
-- ---------------------------------------------------------------------------

alter table public.corrective_actions
  add column if not exists verified_by uuid references public.profiles(id),
  add column if not exists verified_at timestamptz;

comment on column public.corrective_actions.verification_notes is
  'What the verifier checked and found. Written by verify_corrective_action. '
  'approve_incident_investigation refuses while a completed action has this empty, and the client '
  'stage engine blocks closure on the same column -- before BACKLOG J13 nothing wrote it.';
comment on column public.corrective_actions.verified_by is
  'The profile that verified the completed corrective action. BACKLOG J13.';
comment on column public.corrective_actions.verified_at is
  'When the completed corrective action was verified. BACKLOG J13.';

create or replace function public.verify_corrective_action(
  p_action_id uuid,
  p_verification_notes text,
  p_completed_on date default null
)
returns public.corrective_actions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_action public.corrective_actions%rowtype;
  v_notes text := nullif(btrim(coalesce(p_verification_notes, '')), '');
  v_completed date;
begin
  select * into v_action from public.corrective_actions where id = p_action_id for update;
  if not found then
    raise exception 'Corrective action not found' using errcode = 'P0002';
  end if;

  -- `corrective_actions_update`, in full, rather than the incident scope that is narrower than it.
  --
  -- That policy admits org_admin and facility_manager for any action, AND a facility-scoped
  -- trainer for one backed by an inspection event or a violation -- deliberately, because a
  -- trainer owns remediation on those. `assert_incident_manager` knows only the first two, and
  -- InspectionItemDetail offers this dialog to trainers, so the page handed a trainer a control
  -- whose every submission came back 42501. A SECURITY DEFINER function that stands in for a
  -- policy has to reproduce the whole policy, including the branch that is wider than its own
  -- first instinct -- not only the branches that narrow it.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.is_platform_admin() then
    if auth.uid() is null
       or (select public.current_org_id()) is distinct from v_action.organization_id
       or not public.is_assigned_to_facility(v_action.facility_id) then
      raise exception 'Corrective action is outside caller scope' using errcode = '42501';
    end if;
    if not (
      (select public.current_role()) = any (array['org_admin', 'facility_manager'])
      or ((select public.current_role()) = 'trainer'
          and (v_action.inspection_event_id is not null or v_action.violation_id is not null))
    ) then
      raise exception 'This role may not verify corrective actions' using errcode = '42501';
    end if;
  end if;

  if v_notes is null or length(v_notes) < 10 then
    raise exception 'Record what was verified -- at least a sentence' using errcode = '22023';
  end if;

  if v_action.status = 'cancelled' then
    raise exception 'A cancelled corrective action cannot be verified' using errcode = '55000';
  end if;

  -- Completing and verifying in one step is the real workflow: the manager who signs off on the
  -- work is the one recording that it was done. An action already marked completed keeps its date.
  v_completed := coalesce(v_action.completed_date, p_completed_on, public.pa_today());
  if v_completed > public.pa_today() then
    raise exception 'A completion date cannot be in the future' using errcode = '22023';
  end if;

  update public.corrective_actions
  set status = 'completed',
      completed_date = v_completed,
      verification_notes = v_notes,
      verified_by = auth.uid(),
      verified_at = now(),
      updated_at = now()
  where id = v_action.id
  returning * into v_action;

  insert into public.audit_logs(organization_id, actor_profile_id, action, entity_type, entity_id, metadata)
  values (
    v_action.organization_id, auth.uid(), 'corrective_action.verified', 'corrective_actions',
    v_action.id::text,
    jsonb_build_object(
      'incidentId', v_action.incident_id,
      'violationId', v_action.violation_id,
      'inspectionEventId', v_action.inspection_event_id,
      'completedDate', v_action.completed_date
    )
  );

  return v_action;
end;
$function$;

comment on function public.verify_corrective_action(uuid, text, date) is
  'Marks a corrective action completed and verified, writing verification_notes, verified_by and '
  'verified_at. This is the only writer of verification_notes -- approve_incident_investigation '
  'and the client stage engine have always refused to close an incident while a completed action '
  'has it empty, and before BACKLOG J13 no code path could fill it, so such an incident could '
  'never be approved or closed.';

revoke all on function public.verify_corrective_action(uuid, text, date) from public, anon;
grant execute on function public.verify_corrective_action(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- J14 -- the step-up wall, and who it is actually for
-- ---------------------------------------------------------------------------

create or replace function public.identity_operation_requires_aal2(p_operation text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_role text := public.current_role();
  v_org_id uuid := public.current_org_id();
  v_policy public.identity_security_policies%rowtype;
  v_is_demo boolean := false;
  v_baseline text[] := array[
    'regulatory_rule_approval', 'regulatory_rule_activation', 'identity_admin',
    'session_revocation', 'break_glass', 'scim_credential_rotation',
    'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
    'billing_admin', 'integration_admin', 'evidence_grant_revoke',
    'schedule_unpublish', 'course_unpublish', 'policy_document_admin',
    'confidential_identity_reveal'
  ]::text[];
begin
  if v_role = 'platform_admin' then
    return p_operation = any(v_baseline);
  end if;

  -- BACKLOG J14. get_my_mfa_policy exempts seeded and self-serve demo tenants from the login gate
  -- so a demo is usable without enrolling an authenticator for every admin@* account. This
  -- function did not, so the demo manager who was told MFA was not required was refused at every
  -- privileged button -- the exact flows a demo exists to show. The two gates now agree.
  if v_org_id is not null then
    select o.is_demo into v_is_demo from public.organizations o where o.id = v_org_id;
    if coalesce(v_is_demo, false) then
      return false;
    end if;
  end if;

  select * into v_policy
  from public.identity_security_policies
  where organization_id = v_org_id;

  if not found then
    return v_role = any(array['org_admin', 'facility_manager']::text[])
      and p_operation = any(v_baseline);
  end if;

  return v_policy.require_aal2
    and v_role = any(v_policy.privileged_roles)
    and p_operation = any(v_policy.sensitive_operations);
end;
$function$;

comment on function public.identity_operation_requires_aal2(text) is
  'Whether the caller''s organization requires a fresh AAL2 session for this operation. Demo '
  'organizations are exempt, matching get_my_mfa_policy -- the two gates disagreed, so a demo '
  'tenant told MFA was not required at sign-in was refused at every privileged button (BACKLOG '
  'J14). `operational_admin` is deliberately absent from the baseline: approving a work item, '
  'retiming one, running Survey Day and moving an employee between facilities are daily '
  'operational work, not identity administration. A tenant that wants them behind step-up adds '
  'the operation to its own identity_security_policies row.';

-- Keep the table's default and every existing tenant policy aligned with the baseline above.
alter table public.identity_security_policies
  alter column sensitive_operations set default array[
    'regulatory_rule_approval', 'regulatory_rule_activation', 'identity_admin',
    'session_revocation', 'break_glass', 'scim_credential_rotation',
    'enterprise_scope_admin', 'workforce_admin', 'compliance_profile_admin',
    'billing_admin', 'integration_admin', 'evidence_grant_revoke',
    'schedule_unpublish', 'course_unpublish', 'policy_document_admin',
    'confidential_identity_reveal'
  ]::text[];

update public.identity_security_policies
set sensitive_operations = array_append(sensitive_operations, 'confidential_identity_reveal'),
    updated_at = now()
where 'workforce_admin' = any(sensitive_operations)
  and not ('confidential_identity_reveal' = any(sensitive_operations));

-- The operational split. Each of these is a patch of one string in a live function body.
do $do$
declare
  v_target record;
  v_def text;
  v_old text;
  v_new text;
begin
  for v_target in
    select * from (values
      ('app_private', 'assert_content_permission', 'operational_admin'),
      ('app_private', 'assert_phase3_admin', 'operational_admin'),
      ('app_private', 'assert_phase5_manager', 'operational_admin'),
      ('public', 'add_work_item_dependency', 'operational_admin'),
      ('public', 'remove_work_item_dependency', 'operational_admin'),
      ('public', 'approve_work_item', 'operational_admin'),
      ('public', 'record_work_item_effectiveness', 'operational_admin'),
      ('public', 'update_work_item_assignment', 'operational_admin'),
      ('public', 'reveal_confidential_reporter_identity', 'confidential_identity_reveal')
    ) as t(schema_name, fn_name, operation)
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = v_target.schema_name and p.proname = v_target.fn_name;
    if v_def is null then
      raise exception '%.% is missing', v_target.schema_name, v_target.fn_name;
    end if;

    v_old := 'assert_identity_assurance(''workforce_admin'')';
    v_new := 'assert_identity_assurance(''' || v_target.operation || ''')';
    if position(v_old in v_def) = 0 then
      raise exception '%.% no longer asserts workforce_admin', v_target.schema_name, v_target.fn_name;
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end;
$do$;

-- BACKLOG J14. The wall is hit where the manager starts the work, not three screens later at
-- Apply. create_employee_lifecycle_case performed no assurance check at all, so a manager could
-- assemble a case, walk it to `ready`, and only then be told the session was not strong enough.
do $do$
declare
  v_def text;
  v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_employee_lifecycle_case';
  if v_def is null then raise exception 'public.create_employee_lifecycle_case is missing'; end if;

  if position('assert_identity_assurance' in v_def) > 0 then
    raise notice 'create_employee_lifecycle_case already asserts identity assurance; leaving it alone';
  else
    v_old := 'begin';
    if position(v_old in v_def) = 0 then
      raise exception 'create_employee_lifecycle_case has no recognisable body opener';
    end if;
    -- Only the FIRST `begin` -- the body opener -- is replaced.
    v_def := overlay(
      v_def placing 'begin' || E'\n' ||
        '  perform public.assert_identity_assurance(''operational_admin'');'
      from position(v_old in v_def) for length(v_old)
    );
    execute v_def;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- J15, J60 -- one clock for a plan of correction, and an escalation that clears
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_private' and p.proname = 'route_operational_work';
  if v_def is null then raise exception 'app_private.route_operational_work is missing'; end if;

  -- A plan of correction is due at the END of the Pennsylvania day named by poc_due_date, which is
  -- pa_midnight of the following day. `::timestamptz` read it as midnight UTC -- 20:00 the
  -- previous evening here -- so the queue called it overdue a day and four hours early.
  v_old := 'coalesce((v_new->>''poc_due_date'')::timestamptz, now() + interval ''7 days'')';
  v_new := 'coalesce(public.pa_midnight(((v_new->>''poc_due_date'')::date) + 1), now() + interval ''7 days'')';
  if position(v_old in v_def) = 0 then
    raise exception 'route_operational_work no longer computes the violation due date this migration patches';
  end if;
  v_def := replace(v_def, v_old, v_new);

  -- Same class of error on move-in readiness: it must be complete when the resident arrives, so
  -- the instant is the start of the Pennsylvania admission day, not midnight UTC of that date.
  v_old := '(v_new->>''admission_date'')::timestamptz';
  v_new := 'public.pa_midnight((v_new->>''admission_date'')::date)';
  if position(v_old in v_def) = 0 then
    raise exception 'route_operational_work no longer computes the move-in due date this migration patches';
  end if;
  v_def := replace(v_def, v_old, v_new);

  execute v_def;
end;
$do$;

comment on function app_private.route_operational_work() is
  'AFTER INSERT router that opens the automatic work item for an incident, DHS violation, '
  'inspection deficiency, credential lapse or move-in. Date-typed deadlines go through pa_midnight '
  'rather than ::timestamptz, which read a Pennsylvania calendar day as midnight UTC -- 20:00 the '
  'previous evening -- and made a plan of correction overdue the evening before it was due '
  '(BACKLOG J15).';

create or replace function app_private.reregister_violation_poc_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.poc_due_date is distinct from old.poc_due_date then
    -- BACKLOG J15. The item was registered by an AFTER INSERT trigger only, so correcting the POC
    -- deadline on the violation moved neither the queue's clock nor the escalation's. Clearing
    -- escalated_at is the same reasoning as J60: an item that has been legitimately retimed is
    -- not an escalated item, and must be able to escalate again when the NEW date passes.
    update public.work_items
    set due_at = coalesce(public.pa_midnight(new.poc_due_date + 1), due_at),
        escalated_at = null,
        updated_at = now()
    where organization_id = new.organization_id
      and deduplication_key = 'violation:' || new.id::text
      and state not in ('closed', 'canceled');
  end if;
  return new;
end;
$function$;

comment on function app_private.reregister_violation_poc_work() is
  'Re-registers the violation''s work item when its plan-of-correction deadline changes. The '
  'router that opens the item fires on INSERT only, so before BACKLOG J15 the "Correct details" '
  'form moved the POC date and left the queue and the escalation job on the old one.';

revoke all on function app_private.reregister_violation_poc_work() from public, anon, authenticated;

drop trigger if exists reregister_poc_work_on_due_date_change on public.dhs_violations;
create trigger reregister_poc_work_on_due_date_change
after update of poc_due_date on public.dhs_violations
for each row execute function app_private.reregister_violation_poc_work();

-- J60 -- a retimed item is not an escalated item.
do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'update_work_item_assignment';
  if v_def is null then raise exception 'public.update_work_item_assignment is missing'; end if;

  v_old := '      due_at = p_due_at,
      updated_at = now()';
  v_new := '      due_at = p_due_at,
      -- BACKLOG J60. A manager who retimes an item has answered the escalation; leaving the stamp
      -- kept it badged "Escalated" for ever AND stopped escalate_overdue_work_items ever raising it
      -- again, because that sweep skips rows whose escalated_at is already set.
      escalated_at = null,
      updated_at = now()';
  if position(v_old in v_def) = 0 then
    raise exception 'update_work_item_assignment no longer contains the update this migration patches';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$do$;
