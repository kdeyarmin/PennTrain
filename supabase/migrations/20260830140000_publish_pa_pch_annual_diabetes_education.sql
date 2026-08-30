-- Publish the annual diabetes education course as ACTIVE. It is not a draft awaiting anyone's
-- approval: the qualified CDCES responsible for the course is authorizing the content, and the
-- provider and clinical-review record seeded alongside it is regulatory documentation rather than
-- a gate.
--
-- Published the same way publish_course_version() would, using the privileged-write escape hatch
-- because a migration runs with no authenticated platform_admin JWT. Both readiness triggers
-- (enforce_course_version_publish_ready and enforce_comprehensive_course_version_ready) still run
-- unconditionally and reject a version that is not actually complete, so this is a gate, not a
-- bypass. Mirrors 20260726010500 for the five standalone in-service courses.
do $publish$
begin
  perform set_config('app.privileged_write', 'on', true);

  update public.course_versions
  set status = 'published',
      published_at = coalesce(published_at, now())
  where id = 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid;

  update public.courses
  set status = 'published'
  where id = 'e92bbc28-81f7-5de2-884c-c526465647d7'::uuid;
end;
$publish$;

do $verify$
declare
  v_course_status text;
  v_version_status text;
  v_issues text[];
  v_exam_questions integer;
  v_passing integer;
  v_max_attempts integer;
  v_attestations integer;
begin
  select c.status, cv.status
    into v_course_status, v_version_status
  from public.courses c
  join public.course_versions cv on cv.id = c.current_version_id
  where c.id = 'e92bbc28-81f7-5de2-884c-c526465647d7'::uuid;

  if v_course_status is distinct from 'published' or v_version_status is distinct from 'published' then
    raise exception 'the annual diabetes education course must be published and active, found course % / version %',
      coalesce(v_course_status, 'missing'), coalesce(v_version_status, 'missing');
  end if;

  perform set_config('app.privileged_write', 'on', true);
  v_issues := public.get_comprehensive_course_version_issues('b5051e59-5029-596e-906f-fbc21a03488f'::uuid);
  perform set_config('app.privileged_write', 'off', true);

  if coalesce(array_length(v_issues, 1), 0) > 0 then
    raise exception 'the published annual diabetes education version still reports issues: %',
      array_to_string(v_issues, ' ');
  end if;

  -- The three facts the course exists to guarantee, asserted at deploy time rather than trusted:
  -- exactly thirty examination questions, 90 percent to pass, and no attempt cap.
  select count(*), max(q.passing_score_percent), max(q.max_attempts)
    into v_exam_questions, v_passing, v_max_attempts
  from public.quiz_questions qq
  join public.quizzes q on q.id = qq.quiz_id
  join public.course_blocks cb on cb.id = q.course_block_id
  where cb.course_version_id = 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid
    and q.quiz_kind = 'final_exam';

  if v_exam_questions <> 30 then
    raise exception 'the final examination must contain exactly 30 questions, found %', v_exam_questions;
  end if;
  if v_passing <> 90 then
    raise exception 'the final examination passing score must be 90 percent, found %', v_passing;
  end if;
  if v_max_attempts is not null then
    raise exception 'the final examination must allow unlimited attempts, found a cap of %', v_max_attempts;
  end if;

  select count(*) into v_attestations
  from public.course_blocks cb
  where cb.course_version_id = 'b5051e59-5029-596e-906f-fbc21a03488f'::uuid
    and cb.block_type = 'attestation';

  if v_attestations <> 1 then
    raise exception 'expected exactly one learner attestation step, found %', v_attestations;
  end if;
end;
$verify$;
