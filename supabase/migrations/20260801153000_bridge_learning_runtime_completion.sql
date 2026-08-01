-- Bridge governed learning runtime completion into the existing course-completion path.
--
-- A completed SCORM/xAPI runtime session should finalize the course assignment through the same
-- atomic, idempotent RPC the manual "Mark Training Complete" button uses, so certificate issuance,
-- compliance credits, and annual-hours recalculation stay on one path.

create or replace function public.complete_course_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_assignment public.course_assignments%rowtype;
  v_is_self boolean;
  v_was_completed boolean;
  v_course record;
  v_progress record;
  v_record_id uuid;
  v_certificate_id uuid;
  v_min_seconds numeric;
begin
  -- This row lock is the concurrency boundary: only one transaction can transition and
  -- issue for an assignment at a time. Replays wait, then reuse the committed certificate.
  select ca.* into v_assignment
  from public.course_assignments ca
  where ca.id = p_assignment_id
  for update of ca;

  if v_assignment.id is null then
    raise exception 'assignment % not found', p_assignment_id using errcode = 'no_data_found';
  end if;

  v_is_self := public.owns_employee(v_assignment.employee_id);
  if not (
    public.is_platform_admin()
    or (
      v_assignment.organization_id = public.current_org_id()
      and (
        public."current_role"() = 'org_admin'
        or (
          public."current_role"() in ('facility_manager', 'trainer')
          and public.is_assigned_to_facility(v_assignment.facility_id)
        )
      )
    )
    or v_is_self
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  v_was_completed := v_assignment.status = 'completed';
  select * into v_course from public.courses where id = v_assignment.course_id;

  -- Integrity gates apply only to an employee's first transition. A replay of an already-valid
  -- completion must be able to repair a missing certificate without rewriting evidence dates.
  if v_is_self and not v_was_completed then
    select * into v_progress
    from public.course_progress
    where assignment_id = p_assignment_id;

    v_min_seconds := greatest(
      60,
      round(coalesce(v_course.estimated_duration_minutes, 0)::numeric * 60 * 0.10)
    );

    if v_progress.started_at is null then
      raise exception 'This course has not been started yet -- open it and work through at least one lesson before marking it complete.'
        using errcode = 'check_violation';
    end if;

    if extract(epoch from (now() - v_progress.started_at)) < v_min_seconds then
      raise exception 'This course needs to stay open for at least % minute(s) before it can be marked complete -- % minute(s) have elapsed so far.',
        ceil(v_min_seconds / 60.0),
        floor(extract(epoch from (now() - v_progress.started_at)) / 60.0)
        using errcode = 'check_violation', hint = 'Continue through the training content, then try again.';
    end if;

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
            and qa.assignment_id = p_assignment_id
            and qa.passed = true
        )
    ) then
      raise exception 'This course has one or more quizzes that must be passed before it can be marked complete.'
        using errcode = 'check_violation', hint = 'Take (and pass) every quiz in this course, then try again.';
    end if;
  end if;

  perform set_config('app.privileged_write', 'on', true);

  if not v_was_completed then
    update public.course_assignments
    set status = 'completed', completed_at = now()
    where id = p_assignment_id;

    -- The compliance bridge is transition-only. A retry must never move the evidence's
    -- completion date forward or add annual hours a second time.
    if v_course.training_type_id is not null then
      select id into v_record_id
      from public.employee_training_records
      where employee_id = v_assignment.employee_id
        and training_type_id = v_course.training_type_id
      order by due_date desc nulls last, completion_date desc nulls last, created_at desc
      limit 1
      for update;

      if v_record_id is not null then
        update public.employee_training_records
        set completion_date = public.pa_today(),
            status = 'compliant',
            completion_method = 'online',
            training_provider = 'CareMetric CareBase Training Suite',
            hours = round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
            notes = 'Auto-recorded on completion of course "' || v_course.title || '".'
        where id = v_record_id;
      else
        insert into public.employee_training_records (
          organization_id, facility_id, employee_id, training_type_id,
          completion_date, status, hours, completion_method, training_provider, notes
        )
        values (
          v_assignment.organization_id,
          v_assignment.facility_id,
          v_assignment.employee_id,
          v_course.training_type_id,
          public.pa_today(),
          'compliant',
          round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
          'online',
          'CareMetric CareBase Training Suite',
          'Auto-recorded on completion of course "' || v_course.title || '".'
        );
      end if;
    end if;
  end if;

  insert into public.certificates (
    organization_id, facility_id, employee_id, course_id, course_assignment_id,
    issued_at, expires_at
  )
  values (
    v_assignment.organization_id,
    v_assignment.facility_id,
    v_assignment.employee_id,
    v_assignment.course_id,
    v_assignment.id,
    coalesce(v_assignment.completed_at, now()),
    null
  )
  on conflict (course_assignment_id) do nothing
  returning id into v_certificate_id;

  if v_certificate_id is null then
    select id into v_certificate_id
    from public.certificates
    where course_assignment_id = p_assignment_id;
  end if;

  if v_certificate_id is null then
    raise exception 'certificate reconciliation failed for assignment %', p_assignment_id;
  end if;

  if not v_was_completed then
    perform public.recalculate_compliance_core(v_assignment.organization_id);
  end if;
end;
$function$;

revoke all on function public.complete_course_assignment(uuid) from public, anon;
grant execute on function public.complete_course_assignment(uuid) to authenticated;

create or replace function public.bridge_learning_runtime_completion(p_runtime_session_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.learning_runtime_sessions%rowtype;
begin
  select *
  into v_session
  from public.learning_runtime_sessions
  where id = p_runtime_session_id;

  if not found then
    raise exception 'Runtime session not found' using errcode = 'P0002';
  end if;

  if v_session.state <> 'completed' then
    raise exception 'Runtime session is not completed' using errcode = '55000';
  end if;

  if not (
    coalesce(auth.jwt()->>'role', '') = 'service_role'
    or exists (
      select 1
      from public.employees e
      where e.id = v_session.employee_id
        and e.profile_id = auth.uid()
    )
  ) then
    raise exception 'Runtime session is outside caller identity' using errcode = '42501';
  end if;

  perform public.complete_course_assignment(v_session.assignment_id);
  return v_session.assignment_id;
end;
$$;

revoke all on function public.bridge_learning_runtime_completion(uuid) from public, anon;
grant execute on function public.bridge_learning_runtime_completion(uuid) to authenticated;

comment on function public.bridge_learning_runtime_completion(uuid) is
  'Finalizes a completed learning runtime session through complete_course_assignment so runtime '
  'packages issue certificates and compliance credits on the same idempotent path as manual completion.';
