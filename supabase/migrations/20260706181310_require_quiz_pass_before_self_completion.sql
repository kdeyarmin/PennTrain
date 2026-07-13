-- Forward-fix (review finding): complete_course_assignment() never checks that the course's quiz
-- blocks were actually passed before marking the assignment (and downstream compliance record)
-- "compliant" -- the quiz-pass gate exists only in TakeCourse.tsx's client-side `canAdvance` logic.
--
-- Opening a quiz-gated course's page alone creates a course_progress row with started_at=now(), no
-- quiz interaction required. Since the RPC itself only checks authorization and a minimum-seat-time
-- heuristic against course_progress.started_at, an employee can open a quiz-gated compliance course
-- (e.g. medication administration), wait out the seat-time floor, then call
-- `rpc('complete_course_assignment', {p_assignment_id})` directly -- skipping every lesson and never
-- attempting any quiz. The assignment flips to 'completed', a 'compliant' employee_training_records
-- row is auto-created, and the employee can then legitimately call issue_certificate() (it only
-- requires the assignment to be status='completed') to mint a real, publicly verifiable
-- certificate for a course whose competency check they never passed.
--
-- Fix: when v_is_self (a learner completing their OWN assignment -- the only path this whole
-- integrity control section already gates), also require every quiz block under the assignment's
-- course_version_id to have at least one quiz_attempts row with passed=true for this assignment.
-- Mirrors the existing seat-time check's scope and error style exactly; an admin/trainer completing
-- a paper/in-person session on someone else's behalf is unaffected, same as the seat-time gate.
create or replace function public.complete_course_assignment(p_assignment_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_org uuid; v_emp uuid; v_course_id uuid; v_course_version_id uuid; v_is_self boolean;
  v_course record; v_progress record; v_record_id uuid; v_min_seconds numeric;
begin
  select organization_id, employee_id, course_id, course_version_id
    into v_org, v_emp, v_course_id, v_course_version_id
  from public.course_assignments where id = p_assignment_id;
  if v_org is null then
    raise exception 'assignment % not found', p_assignment_id using errcode = 'no_data_found';
  end if;

  v_is_self := public.owns_employee(v_emp);
  if not (
    public.is_platform_admin()
    or (v_org = public.current_org_id() and public."current_role"() in ('org_admin','facility_manager','trainer'))
    or v_is_self
  ) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  select * into v_course from public.courses where id = v_course_id;

  -- Completion-integrity control: a learner completing their OWN assignment must have had the
  -- course open for a minimum stretch of time proportional to its nominal length (10%, floor 60
  -- seconds), so a 12-hour course clicked through in 90 seconds cannot become defensible survey
  -- evidence. Only gates the self-completion path (v_is_self) -- an admin/trainer completing a
  -- paper/in-person session on someone else's behalf supplies its own out-of-band evidence.
  if v_is_self then
    select * into v_progress from public.course_progress where assignment_id = p_assignment_id;
    v_min_seconds := greatest(60, round(coalesce(v_course.estimated_duration_minutes, 0)::numeric * 60 * 0.10));
    if v_progress.started_at is null then
      raise exception 'This course has not been started yet -- open it and work through at least one lesson before marking it complete.'
        using errcode = 'check_violation';
    end if;
    if extract(epoch from (now() - v_progress.started_at)) < v_min_seconds then
      raise exception 'This course needs to stay open for at least % minute(s) before it can be marked complete -- % minute(s) have elapsed so far.',
        ceil(v_min_seconds / 60.0), floor(extract(epoch from (now() - v_progress.started_at)) / 60.0)
        using errcode = 'check_violation', hint = 'Continue through the course content, then try again.';
    end if;

    if exists (
      select 1 from public.course_blocks cb
      where cb.course_version_id = v_course_version_id
        and cb.block_type = 'quiz'
        and not exists (
          select 1 from public.quizzes qz
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
  update public.course_assignments
     set status = 'completed', completed_at = now()
   where id = p_assignment_id;

  -- LMS-compliance bridge: if this course satisfies a specific annual-hours training type, record
  -- (or refresh) the matching employee_training_records row -- "find current record, else insert",
  -- mirroring the manual-entry UI's findCurrentRecord pattern (EmployeeDetail.tsx/TrainingMatrix.tsx)
  -- rather than accumulating a duplicate row per completion.
  if v_course.training_type_id is not null then
    select id into v_record_id from public.employee_training_records
    where employee_id = v_emp and training_type_id = v_course.training_type_id
    order by due_date desc nulls last, completion_date desc nulls last, created_at desc
    limit 1;

    if v_record_id is not null then
      update public.employee_training_records
      set completion_date = current_date,
          status = 'compliant',
          completion_method = 'online',
          training_provider = 'CareMetric CareBase LMS',
          hours = round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
          notes = 'Auto-recorded on completion of course "' || v_course.title || '".'
      where id = v_record_id;
    else
      insert into public.employee_training_records (
        organization_id, facility_id, employee_id, training_type_id,
        completion_date, status, hours, completion_method, training_provider, notes
      )
      select v_org, e.facility_id, v_emp, v_course.training_type_id,
        current_date, 'compliant', round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
        'online', 'CareMetric CareBase LMS', 'Auto-recorded on completion of course "' || v_course.title || '".'
      from public.employees e where e.id = v_emp;
    end if;
  end if;

  perform public.recalculate_compliance_core(v_org);
end;
$function$;
revoke all on function public.complete_course_assignment(uuid) from public, anon;
grant execute on function public.complete_course_assignment(uuid) to authenticated;
