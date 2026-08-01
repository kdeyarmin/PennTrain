-- B4: Bridge SCORM/xAPI runtime completion → course assignment + training record / hour bucket.
--
-- When a learning_runtime session first reaches completionStatus=completed, write the same
-- compliance evidence that complete_course_assignment writes for ordinary courses:
--   * course_assignments.status = completed
--   * employee_training_records row when courses.training_type_id is set
--   * recalculate_compliance_core for hour buckets (§2600.65)
--
-- SCORM/xAPI packages are the assessment surface for standards packages, so the seat-time gate
-- used by self-service complete_course_assignment does not apply. Quiz blocks, when present
-- on the same course version, still must be passed before the assignment is marked complete.
--
-- Idempotent: only runs when the session transitions into completed (not on later commits).

create or replace function public.bridge_learning_runtime_completion(
  p_runtime_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session public.learning_runtime_sessions%rowtype;
  v_assignment public.course_assignments%rowtype;
  v_course record;
  v_record_id uuid;
  v_hours numeric(6,2);
begin
  select * into v_session
  from public.learning_runtime_sessions
  where id = p_runtime_session_id;

  if not found then
    raise exception 'Runtime session % not found', p_runtime_session_id using errcode = 'P0002';
  end if;

  select * into v_assignment
  from public.course_assignments
  where id = v_session.assignment_id;

  if not found then
    return null;
  end if;

  -- Quiz integrity: if this course version still has unpassed quiz blocks, leave the runtime
  -- session completed but do not flip the assignment or write a training record yet.
  if exists (
    select 1
    from public.course_blocks cb
    where cb.course_version_id = v_assignment.course_version_id
      and cb.block_type = 'quiz'
      and not exists (
        select 1
        from public.quizzes qz
        join public.quiz_attempts qa on qa.quiz_id = qz.id
        where qz.course_block_id = cb.id
          and qa.assignment_id = v_assignment.id
          and qa.passed = true
      )
  ) then
    return null;
  end if;

  select c.*
  into v_course
  from public.courses c
  where c.id = v_assignment.course_id;

  perform set_config('app.privileged_write', 'on', true);

  if v_assignment.status is distinct from 'completed' then
    update public.course_assignments
    set status = 'completed',
        completed_at = coalesce(completed_at, now())
    where id = v_assignment.id;
  end if;

  if v_course.training_type_id is null then
    return null;
  end if;

  v_hours := round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2);

  select id into v_record_id
  from public.employee_training_records
  where employee_id = v_assignment.employee_id
    and training_type_id = v_course.training_type_id
  order by due_date desc nulls last, completion_date desc nulls last, created_at desc
  limit 1;

  if v_record_id is not null then
    update public.employee_training_records
    set completion_date = current_date,
        status = 'compliant',
        completion_method = 'online',
        training_provider = 'CareMetric CareBase Training Suite',
        hours = v_hours,
        notes = case
          when notes is null or notes = '' then
            'Auto-recorded from SCORM/xAPI runtime session ' || v_session.id::text ||
            ' on course "' || v_course.title || '".'
          when position(v_session.id::text in notes) > 0 then
            notes
          else
            notes || E'\nAuto-recorded from SCORM/xAPI runtime session ' || v_session.id::text || '.'
        end
    where id = v_record_id;
  else
    insert into public.employee_training_records (
      organization_id, facility_id, employee_id, training_type_id,
      completion_date, status, hours, completion_method, training_provider, notes
    )
    select
      v_assignment.organization_id,
      e.facility_id,
      v_assignment.employee_id,
      v_course.training_type_id,
      current_date,
      'compliant',
      v_hours,
      'online',
      'CareMetric CareBase Training Suite',
      'Auto-recorded from SCORM/xAPI runtime session ' || v_session.id::text ||
        ' on course "' || v_course.title || '".'
    from public.employees e
    where e.id = v_assignment.employee_id
    returning id into v_record_id;
  end if;

  perform public.recalculate_compliance_core(v_assignment.organization_id);

  return v_record_id;
end;
$function$;

revoke all on function public.bridge_learning_runtime_completion(uuid) from public, anon;
grant execute on function public.bridge_learning_runtime_completion(uuid) to authenticated;

comment on function public.bridge_learning_runtime_completion(uuid) is
  'B4: On SCORM/xAPI runtime completion, complete the assignment and upsert employee_training_records / hour buckets when the course maps to a training_type. Quiz blocks still gate assignment completion.';

-- Hook into commit path: only on first transition to completed.
create or replace function public.commit_learning_runtime_state(
  p_runtime_session_id uuid,
  p_idempotency_key text,
  p_sequence_number integer,
  p_state jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.learning_runtime_sessions%rowtype;
  v_id uuid;
  v_hash text;
  v_was_active boolean;
begin
  select * into v_session
  from public.learning_runtime_sessions
  where id = p_runtime_session_id
  for update;

  if not found or v_session.state <> 'active' or v_session.expires_at <= now() then
    raise exception 'Runtime session is not active' using errcode = '55000';
  end if;

  if not (
    coalesce(auth.jwt()->>'role', '') = 'service_role'
    or exists (
      select 1 from public.employees e
      where e.id = v_session.employee_id and e.profile_id = auth.uid()
    )
  ) then
    raise exception 'Runtime session is outside caller identity' using errcode = '42501';
  end if;

  select id into v_id
  from public.learning_runtime_commits
  where runtime_session_id = v_session.id
    and idempotency_key = p_idempotency_key;
  if found then
    return v_id;
  end if;

  if p_sequence_number <> coalesce(
    (select max(sequence_number) + 1 from public.learning_runtime_commits where runtime_session_id = v_session.id),
    1
  ) then
    raise exception 'Runtime commit sequence conflict' using errcode = '40001';
  end if;

  v_hash := encode(extensions.digest(convert_to(p_state::text, 'utf8'), 'sha256'), 'hex');
  v_was_active := v_session.state = 'active';

  insert into public.learning_runtime_commits (
    organization_id, runtime_session_id, idempotency_key, sequence_number,
    score_raw, score_min, score_max, progress_measure, completion_status, success_status,
    suspend_data, session_time_seconds, raw_state, state_sha256
  )
  values (
    v_session.organization_id, v_session.id, p_idempotency_key, p_sequence_number,
    nullif(p_state->>'scoreRaw', '')::numeric,
    nullif(p_state->>'scoreMin', '')::numeric,
    nullif(p_state->>'scoreMax', '')::numeric,
    nullif(p_state->>'progress', '')::numeric,
    p_state->>'completionStatus',
    p_state->>'successStatus',
    p_state->>'suspendData',
    nullif(p_state->>'sessionTimeSeconds', '')::integer,
    p_state,
    v_hash
  )
  returning id into v_id;

  update public.learning_runtime_sessions
  set last_commit_at = now(),
      state = case when p_state->>'completionStatus' = 'completed' then 'completed' else state end
  where id = v_session.id;

  -- B4: first transition into completed → assignment + training record bridge.
  if v_was_active and p_state->>'completionStatus' = 'completed' then
    begin
      perform public.bridge_learning_runtime_completion(v_session.id);
    exception
      when others then
        raise warning 'bridge_learning_runtime_completion failed for %: %', v_session.id, SQLERRM;
    end;
  end if;

  return v_id;
end;
$$;

revoke all on function public.commit_learning_runtime_state(uuid, text, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_learning_runtime_state(uuid, text, integer, jsonb)
  to authenticated;

comment on function public.commit_learning_runtime_state(uuid, text, integer, jsonb) is
  'Records an ordered SCORM/xAPI runtime commit. On first completion, bridges into course assignment + training records (B4).';
