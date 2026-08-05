-- A deterministic conflict must not be reported as a serialization failure (BACKLOG.md G11).
--
-- FOUND BY RUNNING IT, NOT READING IT. While driving `evaluate_learning_path` over PostgREST to
-- verify the new adaptive-path surface, the stale-state-version case never returned. Not a 4xx, not
-- a 5xx -- the request hung until the gateway gave up, and a single client request produced several
-- concurrently active backends running the same statement.
--
-- Isolated with a throwaway function that does nothing but `raise ... using errcode = <code>`:
-- `55000` returned a 500 immediately, `22023` returned a 400 immediately, and `40001` never
-- returned. PostgREST treats SQLSTATE 40001 (serialization_failure) as what it says it is -- a
-- transient conflict that a retry may resolve -- and retries the request. These four functions use
-- it for optimistic-concurrency checks whose condition is *deterministic*: the caller passed a
-- version that does not match the stored one, and it will not match on any retry either. So the
-- retry can never succeed, and the request spins instead of telling the caller what happened.
--
-- WHY THIS MATTERS BEYOND THE DORMANT SWEEP. Two of the four are already wired to live UI:
-- `decide_shift_swap` (the workforce self-service queue) and `apply_employee_lifecycle_case`. Today,
-- a manager who decides a swap that somebody else has already changed underneath them does not get
-- "shift assignments changed after swap request" -- they get a request that never comes back.
--
-- THE CHANGE, AND WHY IT IS `55000`. Each function is redeclared verbatim from its original
-- definition with exactly one substitution: `40001` becomes `55000` (object_not_in_prerequisite_state),
-- which is what this codebase already uses for "the world is not in the state this operation
-- requires" and which PostgREST returns immediately. The messages, the checks, the ordering and
-- every other behaviour are unchanged -- the blocks below were copied programmatically from the
-- original migrations rather than retyped, so the only difference is the five characters.
--
-- These are not real serialization failures. Postgres raises those itself under `repeatable read`
-- or `serializable`; nothing here is a lost update the database detected. They are precondition
-- checks the functions perform on their own, which is exactly what 55000 describes.
--
-- Rollback: redeclare the four functions from their original migrations. No schema changes.

-- from 20260729223200_employee_lifecycle_cases.sql
create or replace function public.apply_employee_lifecycle_case(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.employee_lifecycle_cases%rowtype;
  v_preview jsonb;
  v_event_id uuid;
begin
  select * into v_case from public.employee_lifecycle_cases where id = p_case_id for update;
  if v_case.id is null then raise exception 'Lifecycle case not found' using errcode = 'P0002'; end if;
  if v_case.status <> 'ready' then raise exception 'Only a ready lifecycle case may be applied' using errcode = '22023'; end if;

  -- Re-preview while holding the case lock so the decision never applies against stale dependencies.
  v_preview := public.preview_employee_lifecycle_transition(
    v_case.employee_id,
    v_case.transition,
    v_case.effective_on,
    v_case.target_facility_id,
    v_case.reason
  );
  if not coalesce((v_preview ->> 'allowed')::boolean, false) then
    update public.employee_lifecycle_cases
    set status = 'blocked', preview = v_preview, previewed_at = now(), updated_at = now()
    where id = p_case_id;
    raise exception 'Lifecycle conditions changed; review the refreshed preview' using errcode = '55000';
  end if;

  v_event_id := public.apply_employee_lifecycle_transition(
    v_case.employee_id,
    v_case.transition,
    v_case.effective_on,
    v_case.target_facility_id,
    v_case.reason
  );
  update public.employee_lifecycle_cases
  set status = 'applied',
      preview = v_preview,
      previewed_at = now(),
      lifecycle_event_id = v_event_id,
      applied_by = auth.uid(),
      applied_at = now(),
      updated_at = now()
  where id = p_case_id;

  return jsonb_build_object(
    'caseId', p_case_id,
    'status', 'applied',
    'lifecycleEventId', v_event_id,
    'transition', v_case.transition,
    'preview', v_preview
  );
end;
$$;

-- from 20260711213100_phase3_training_and_compliance_scheduling.sql
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
  update public.shift_swap_requests set
    requester_decision_id = v_a_decision, target_decision_id = v_b_decision,
    decided_by = auth.uid(), decided_at = now(), decision_reason = btrim(p_reason)
  where id = v_swap.id;
  set constraints shift_assignments_employee_id_shift_date_key deferred;
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

-- from 20260712023823_phase4_standards_adaptive_offline.sql
create or replace function public.commit_learning_runtime_state(p_runtime_session_id uuid,p_idempotency_key text,p_sequence_number integer,p_state jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_session public.learning_runtime_sessions%rowtype; v_id uuid; v_hash text;
begin
  select * into v_session from public.learning_runtime_sessions where id=p_runtime_session_id for update;
  if not found or v_session.state<>'active' or v_session.expires_at<=now() then raise exception 'Runtime session is not active' using errcode='55000'; end if;
  if not (coalesce(auth.jwt()->>'role','')='service_role' or exists(select 1 from public.employees e where e.id=v_session.employee_id and e.profile_id=auth.uid())) then raise exception 'Runtime session is outside caller identity' using errcode='42501'; end if;
  select id into v_id from public.learning_runtime_commits where runtime_session_id=v_session.id and idempotency_key=p_idempotency_key;
  if found then return v_id; end if;
  if p_sequence_number <> coalesce((select max(sequence_number)+1 from public.learning_runtime_commits where runtime_session_id=v_session.id),1) then raise exception 'Runtime commit sequence conflict' using errcode='55000'; end if;
  v_hash:=encode(extensions.digest(convert_to(p_state::text,'utf8'),'sha256'),'hex');
  insert into public.learning_runtime_commits(organization_id,runtime_session_id,idempotency_key,sequence_number,score_raw,score_min,score_max,progress_measure,completion_status,success_status,suspend_data,session_time_seconds,raw_state,state_sha256)
  values(v_session.organization_id,v_session.id,p_idempotency_key,p_sequence_number,nullif(p_state->>'scoreRaw','')::numeric,nullif(p_state->>'scoreMin','')::numeric,nullif(p_state->>'scoreMax','')::numeric,nullif(p_state->>'progress','')::numeric,p_state->>'completionStatus',p_state->>'successStatus',p_state->>'suspendData',nullif(p_state->>'sessionTimeSeconds','')::integer,p_state,v_hash) returning id into v_id;
  update public.learning_runtime_sessions set last_commit_at=now(),state=case when p_state->>'completionStatus'='completed' then 'completed' else state end where id=v_session.id;
  return v_id;
end; $$;

-- from 20260712023823_phase4_standards_adaptive_offline.sql
create or replace function public.evaluate_learning_path(p_path_assignment_id uuid,p_expected_state_version integer,p_outcomes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_assignment public.learning_path_assignments%rowtype; v_version public.learning_path_versions%rowtype; v_step jsonb; v_key text; v_status text; v_reason text; v_explanation text; v_states jsonb:='{}'; v_new_version integer;
begin
  select * into v_assignment from public.learning_path_assignments where id=p_path_assignment_id for update;
  if not found then raise exception 'Learning path assignment not found' using errcode='P0002'; end if;
  if not (public.is_platform_admin() or public.current_org_id()=v_assignment.organization_id or exists(select 1 from public.employees e where e.id=v_assignment.employee_id and e.profile_id=auth.uid())) then raise exception 'Learning path is outside caller scope' using errcode='42501'; end if;
  if v_assignment.state_version<>p_expected_state_version then raise exception 'Learning path state version conflict' using errcode='55000'; end if;
  select * into v_version from public.learning_path_versions where id=v_assignment.path_version_id and state in ('published','superseded');
  if not found then raise exception 'Pinned path version is unavailable' using errcode='55000'; end if;
  v_new_version:=v_assignment.state_version+1;
  for v_step in select value from jsonb_array_elements(v_version.definition->'steps') loop
    v_key:=v_step->>'key';
    if coalesce(p_outcomes->v_key->>'completed','false')::boolean then v_status:='completed';v_reason:='outcome_complete';v_explanation:='Required outcome is complete.';
    elsif coalesce((select bool_and(coalesce(p_outcomes->p->>'completed','false')::boolean) from jsonb_array_elements_text(coalesce(v_step->'prerequisites','[]')) p),true) then v_status:='available';v_reason:='prerequisites_met';v_explanation:='All prerequisites are complete.';
    else v_status:='locked';v_reason:='prerequisite_incomplete';v_explanation:='One or more prerequisites are incomplete.'; end if;
    if coalesce(p_outcomes->v_key->>'score','')<>'' and (p_outcomes->v_key->>'score')::numeric < coalesce((v_step->>'threshold')::numeric,0) then v_status:='remediated';v_reason:='below_threshold';v_explanation:='Assessment score selected the remedial branch.'; end if;
    v_states:=v_states||jsonb_build_object(v_key,jsonb_build_object('state',v_status,'reason',v_reason,'explanation',v_explanation));
    insert into public.learning_path_transition_events(organization_id,path_assignment_id,step_key,prior_state,resulting_state,reason_code,explanation,source_outcome,state_version) values(v_assignment.organization_id,v_assignment.id,v_key,v_assignment.current_state->v_key->>'state',v_status,v_reason,v_explanation,coalesce(p_outcomes->v_key,'{}'),v_new_version);
  end loop;
  update public.learning_path_assignments set current_state=v_states,state_version=v_new_version,state=case when not exists(select 1 from jsonb_each(v_states) e where e.value->>'state' not in ('completed','skipped','waived')) then 'completed' else state end,completed_at=case when not exists(select 1 from jsonb_each(v_states) e where e.value->>'state' not in ('completed','skipped','waived')) then now() else completed_at end where id=v_assignment.id;
  return jsonb_build_object('stateVersion',v_new_version,'steps',v_states);
end; $$;
