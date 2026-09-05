-- The SCORM bridge finished the course, and the course had no certificate (I20).
--
-- `bridge_learning_runtime_completion` ran from an AFTER INSERT trigger on
-- learning_runtime_commits. When a vendor package reported completion it set
-- `course_assignments.status = 'completed'` itself and wrote an employee_training_records row by
-- hand. Three things follow, and each is worse than the last.
--
--   1. NO CERTIFICATE. Issuance lives in `complete_course_assignment` -- the certificate row, its
--      credential number, the examination score it prints, the provider snapshot, the expiry. The
--      bridge wrote none of it. A learner who finished a packaged course was marked complete with
--      nothing to show a surveyor, and the assignment being `completed` is exactly what stops
--      them completing it properly afterwards.
--   2. A COMPREHENSIVE COURSE COULD NOT FINISH AT ALL. `require_comprehensive_self_completion` is
--      a BEFORE UPDATE trigger on course_assignments with no privileged bypass, so the bridge's
--      UPDATE raised check_violation on any comprehensive version. Since 20260810161000 the
--      wrapper deliberately lets that abort the transaction rather than swallowing it -- correct,
--      and it means the learner's commit failed with "Could not save learning progress" and the
--      package result was lost. Every retry did the same.
--   3. THE COURSE ENDED FROM THE MIDDLE. A package is one block. Reporting it done completed the
--      whole assignment, skipping every quiz, attestation and applied response after it. (The
--      bridge's one guard covered quizzes and nothing else.)
--
-- Removed rather than reduced. There is nothing left for it to record: `commit_learning_runtime_state`
-- already sets `learning_runtime_sessions.state = 'completed'`, and that row is the package's
-- result -- durable, per assignment, readable by the learner under runtime_sessions_select and by
-- the completion RPC. A second copy on course_progress.learning_tools would be worse than none:
-- the course player rewrites that column wholesale from its own in-memory notes and confidence
-- map on every progress save, so a server-written key there is one keystroke from being erased.
--
-- What replaces it is the requirement that makes deferring safe: `complete_course_assignment`
-- refuses a course whose version carries a package step until a runtime session for that
-- assignment has reported completion. Without it, deferring would just mean the package could be
-- skipped. With it, the learner works the package, reaches the end of the course, and completes it
-- the same way as any other -- through the one path that issues the certificate.
--
-- The training-record write the bridge did is not ported: complete_course_assignment writes that
-- record itself, from the same course and the same employee, alongside the certificate that
-- evidences it. One writer, or the two drift.
--
-- Rollback: recreate both functions from 20260801160000 and 20260810161000 and re-add the trigger.
-- The completion gate below is independent and can stay either way.

drop trigger if exists trg_bridge_learning_runtime_completion on public.learning_runtime_commits;
drop function if exists public.trg_bridge_learning_runtime_completion();
drop function if exists public.bridge_learning_runtime_completion(uuid);

-- complete_course_assignment, spliced from the deployed body: the package gate is the only
-- change, and it sits in the evidence-gate block beside the quiz and attestation rules.
CREATE OR REPLACE FUNCTION public.complete_course_assignment(p_assignment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_assignment public.course_assignments%rowtype;
  v_is_self boolean;
  v_was_completed boolean;
  v_course record;
  v_progress record;
  v_record_id uuid;
  v_certificate_id uuid;
  v_certificate_number text;
  v_min_seconds numeric;
  v_expires_at timestamptz;
  v_exam_score numeric;
  v_provider record;
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

  -- Pacing gates stay scoped to a learner's own first transition: they exist to stop somebody
  -- clicking through their own training, and applying them to a manager recording an in-person
  -- class on a non-comprehensive course would break a legitimate flow. A replay of an
  -- already-valid completion skips them so a missing certificate can be repaired without
  -- rewriting evidence dates.
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

  end if;

  -- Evidence gates are wider on purpose. require_comprehensive_self_completion() already holds
  -- progress, the final step, applied responses and seat time against EVERY completer of a
  -- comprehensive version, whoever calls this. What it does not check is the two things this
  -- course's certificate actually claims: that the examination was passed and the attestation
  -- signed. Leaving those inside the self-only branch let an authorized org admin, facility
  -- manager or trainer call this RPC directly and mint a certificate -- and a DIABETES-EDU
  -- renewal record -- for a learner who failed the exam and signed nothing. The management UI
  -- hides Mark Complete for comprehensive versions, but a hidden button is not a boundary.
  --
  -- Scoped to comprehensive versions rather than all courses so manager-recorded completions of
  -- ordinary courses keep working exactly as before.
  if not v_was_completed and (
    v_is_self
    or exists (
      select 1 from public.course_versions cv
      where cv.id = v_assignment.course_version_id
        and cv.content_standard = 'comprehensive'
    )
  ) then
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

    -- The attestation is the last requirement before a certificate exists, and it is a
    -- requirement of the same rank as passing the examination: no signature, no certificate.
    if exists (
      select 1
      from public.course_blocks cb
      where cb.course_version_id = v_assignment.course_version_id
        and cb.block_type = 'attestation'
        and not exists (
          select 1
          from public.course_learner_attestations la
          where la.course_assignment_id = p_assignment_id
            and la.course_block_id = cb.id
        )
    ) then
      raise exception 'This course requires a signed learner attestation before it can be marked complete.'
        using errcode = 'check_violation', hint = 'Open the attestation step, read the statement, and sign it.';
    end if;

    -- A vendor package is content, and until 20260905200000 nothing here knew that. The SCORM
    -- bridge completed the assignment itself the moment the package reported done -- from a middle
    -- block, with no certificate, and (on a comprehensive version) by tripping a trigger that
    -- aborted the learner's commit. That bridge is gone. This is the requirement that makes its
    -- removal safe: a course version carrying a package step is not complete until a runtime
    -- session for THIS assignment has reported completion.
    if exists (
      select 1 from public.course_blocks cb
      where cb.course_version_id = v_assignment.course_version_id
        and cb.block_type = 'scorm'
    ) and exists (
      select 1 from public.learning_packages lp
      where lp.course_version_id = v_assignment.course_version_id
        and lp.validation_status = 'accepted'
    -- Read from the COMMIT ledger, not from learning_runtime_sessions.state: a session is one row
    -- per package+assignment and start_learning_runtime_session reactivates it on every launch, so
    -- state flips back to 'active' the moment a learner reopens a package they already finished.
    -- Commits are append-only, so a reported completion stays reported.
    ) and not exists (
      select 1
      from public.learning_runtime_commits lrc
      join public.learning_runtime_sessions lrs on lrs.id = lrc.runtime_session_id
      join public.learning_packages lp on lp.id = lrs.package_id
      where lrs.assignment_id = p_assignment_id
        and lp.course_version_id = v_assignment.course_version_id
        and lp.validation_status = 'accepted'
        and lrc.completion_status = 'completed'
    ) then
      raise exception 'This course includes a training package that has to report completion before the course can be marked complete.'
        using errcode = 'check_violation',
              hint = 'Open the package step, work through it to the end, and let it report completion.';
    end if;
  end if;

  perform set_config('app.privileged_write', 'on', true);

  -- Best examination score on this assignment: what the certificate prints and what the
  -- regulatory training record stores. Knowledge checks are formative and never counted.
  select max(qa.score_percent) into v_exam_score
  from public.quiz_attempts qa
  join public.quizzes qz on qz.id = qa.quiz_id
  join public.course_blocks cb on cb.id = qz.course_block_id
  where qa.assignment_id = p_assignment_id
    and cb.course_version_id = v_assignment.course_version_id
    and qz.quiz_kind = 'final_exam'
    and qa.passed = true;

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

  -- A recurring course's certificate carries the same expiry the requirement does, so the
  -- learner's own certificate list and the public verification page agree with the compliance
  -- dashboard instead of showing a document that never expires.
  v_expires_at := case
    when v_course.recurrence_interval_days is null then null
    else coalesce(v_assignment.completed_at, now()) + make_interval(days => v_course.recurrence_interval_days)
  end;

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
    v_expires_at
  )
  on conflict (course_assignment_id) do nothing
  returning id, credential_number into v_certificate_id, v_certificate_number;

  if v_certificate_id is null then
    select id, credential_number into v_certificate_id, v_certificate_number
    from public.certificates
    where course_assignment_id = p_assignment_id;
  end if;

  if v_certificate_id is null then
    raise exception 'certificate reconciliation failed for assignment %', p_assignment_id;
  end if;

  -- The renewal bridge. Written after the certificate exists so the requirement row can carry
  -- the certificate number an inspector would ask for, and only on the first transition so a
  -- replay never moves the annual clock forward.
  if not v_was_completed and v_course.renewal_training_type_id is not null then
    select p.provider_full_name, p.credential into v_provider
    from public.course_provider_profiles p
    where p.course_id = v_course.id;

    select id into v_record_id
    from public.employee_training_records
    where employee_id = v_assignment.employee_id
      and training_type_id = v_course.renewal_training_type_id
    order by due_date desc nulls last, completion_date desc nulls last, created_at desc
    limit 1
    for update;

    if v_record_id is not null then
      update public.employee_training_records
      set completion_date = public.pa_today(),
          status = 'compliant',
          completion_method = 'online',
          training_provider = coalesce(v_provider.provider_full_name, 'CareMetric CareBase Training Suite'),
          trainer_name = v_provider.provider_full_name,
          trainer_credentials = v_provider.credential,
          certificate_number = v_certificate_number,
          score = v_exam_score,
          hours = round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
          notes = 'Auto-recorded on completion of course "' || v_course.title || '".'
      where id = v_record_id;
    else
      insert into public.employee_training_records (
        organization_id, facility_id, employee_id, training_type_id,
        completion_date, status, hours, completion_method, training_provider,
        trainer_name, trainer_credentials, certificate_number, score, notes
      )
      values (
        v_assignment.organization_id,
        v_assignment.facility_id,
        v_assignment.employee_id,
        v_course.renewal_training_type_id,
        public.pa_today(),
        'compliant',
        round(coalesce(v_course.estimated_duration_minutes, 0) / 60.0, 2),
        'online',
        coalesce(v_provider.provider_full_name, 'CareMetric CareBase Training Suite'),
        v_provider.provider_full_name,
        v_provider.credential,
        v_certificate_number,
        v_exam_score,
        'Auto-recorded on completion of course "' || v_course.title || '".'
      );
    end if;
  end if;

  if not v_was_completed then
    perform public.recalculate_compliance_core(v_assignment.organization_id);
  end if;
end;
$function$

;

revoke all on function public.complete_course_assignment(uuid) from public, anon;
grant execute on function public.complete_course_assignment(uuid) to authenticated, service_role;
