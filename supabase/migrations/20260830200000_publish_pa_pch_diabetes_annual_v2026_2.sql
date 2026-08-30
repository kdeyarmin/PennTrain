-- Publish the video-led v2026.2 of the annual diabetes course and make it the version learners
-- receive.
--
-- The gate this waited on has cleared. 20260830190000 wired the twelve HeyGen ids on with a null
-- video_url and status 'processing'; poll-heygen-video-statuses has since re-hosted every MP4 into
-- the course-videos bucket and written the URLs, so the twelve "add a finished video URL before
-- publishing" issues that version reported are gone. This migration records that finished state
-- rather than waiting for it again, so the chain reaches the same end point on a fresh replay.
-- Both readiness triggers still run unconditionally here and reject a version that is not actually
-- complete, so the privileged-write flag satisfies the platform-admin role check and nothing else.
--
-- estimated_duration_minutes STAYS 240. The course credits four hours; v2026.2 delivers the same
-- curriculum in sixty minutes of designed step time, and that difference is carried by the
-- credited_duration_rationale on the version (20260830170000) and the compliance-credit exemption
-- on the course (20260830180000), both recorded and audited. Moving the catalog duration to 60
-- would silently drop employee_training_records.hours from 4.00 to 1.00 for everyone who completes
-- after this, which is the opposite of the decision that was made.
--
-- Learners already part-way through v2026.1 are unaffected: course_assignments pin
-- course_version_id, so an in-flight assignment keeps serving the written version it started on,
-- with the four-hour engagement gate it was assigned under. Only assignments created after this
-- point get the sixty-minute video version.
--
-- No compliance crosswalk moves with it. course_compliance_credits is scoped to
-- course_version_id, so a course that carried one would need its row moved in this same step or
-- the credit would be silently dropped -- the trap scripts/heygen/scripts/README.md describes and
-- 20260726060000 is the pattern for. This course deliberately carries none (it advances renewal
-- through courses.renewal_training_type_id, not annual hours), which the verification below
-- asserts rather than assumes.

do $publish$
declare
  v_course_id uuid;
  v_version_id uuid;
  v_rehosted integer;
begin
  select c.id, cv.id into v_course_id, v_version_id
  from public.courses c
  join public.course_versions cv on cv.course_id = c.id and cv.version_label = '2026.2'
  where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL';

  if v_version_id is null then
    raise exception 'v2026.2 of PA-PCH-DIABETES-ANNUAL is missing; 20260830160000 must run first';
  end if;

  perform set_config('app.privileged_write', 'on', true);

  -- Record the finished state the poller reached in production rather than depending on it.
  -- 20260724040747 sets out why and this follows it: a live HeyGen job and cron run can only ever
  -- happen once, against the original project, so a migration that waited for them would never
  -- publish on a fresh replay -- CI, a preview branch, a local reset -- and the chain would diverge
  -- from production. The path written here is the one poll-heygen-video-statuses derives, keyed by
  -- block id, so this is a no-op against the project where the re-host already ran.
  --
  -- The documented limitation carries over unchanged: SQL migrations have no binary payload, so
  -- these rows replay everywhere but the MP4s exist only in the project they were uploaded to.
  -- useCourseVideoUrl() re-derives a signed URL from the configured project's course-videos
  -- bucket, so elsewhere the block reads as unavailable rather than playing.
  update public.course_blocks cb
  set video_url = coalesce(
        cb.video_url,
        'storage://course-videos/system/' || cb.id::text || '.mp4'
      ),
      body = cb.body || jsonb_build_object(
        'heygen',
        coalesce(cb.body -> 'heygen', '{}'::jsonb) || jsonb_build_object('status', 'completed')
      )
  where cb.course_version_id = v_version_id
    and cb.block_type = 'video';

  select count(*) into v_rehosted
  from public.course_blocks cb
  where cb.course_version_id = v_version_id
    and cb.block_type = 'video'
    and cb.video_url is not null;

  if v_rehosted <> 12 then
    raise exception 'v2026.2 must carry 12 video blocks with a URL, found %', v_rehosted;
  end if;

  update public.course_versions
  set status = 'published',
      published_at = coalesce(published_at, now())
  where id = v_version_id;

  update public.courses
  set current_version_id = v_version_id
  where id = v_course_id;

  perform set_config('app.privileged_write', 'off', true);
end;
$publish$;

do $verify$
declare
  v_course_id uuid;
  v_version_id uuid;
  v_label text;
  v_duration integer;
  v_designed integer;
  v_issues text[];
  v_exam_questions integer;
  v_passing integer;
  v_max_attempts integer;
  v_attestations integer;
  v_crosswalks integer;
begin
  select c.id, c.current_version_id, cv.version_label, c.estimated_duration_minutes
    into v_course_id, v_version_id, v_label, v_duration
  from public.courses c
  join public.course_versions cv on cv.id = c.current_version_id
  where c.catalog_code = 'PA-PCH-DIABETES-ANNUAL';

  if v_label is distinct from '2026.2' then
    raise exception 'the video version must be the one learners receive, found %', coalesce(v_label, 'missing');
  end if;

  if v_duration <> 240 then
    raise exception 'the course must still credit 240 minutes after publishing v2, found %', v_duration;
  end if;

  v_designed := public.get_course_version_designed_minutes(v_version_id);
  if v_designed is distinct from 60 then
    raise exception 'v2026.2 must deliver 60 designed minutes, found %', v_designed;
  end if;

  perform set_config('app.privileged_write', 'on', true);
  v_issues := public.get_comprehensive_course_version_issues(v_version_id);
  perform set_config('app.privileged_write', 'off', true);

  if coalesce(array_length(v_issues, 1), 0) > 0 then
    raise exception 'the published v2026.2 still reports issues: %', array_to_string(v_issues, ' ');
  end if;

  -- The same three guarantees 20260830140000 asserted for v2026.1, re-asserted for the version
  -- that now actually serves learners. A content rebuild is exactly where they could slip.
  select count(*), max(q.passing_score_percent), max(q.max_attempts)
    into v_exam_questions, v_passing, v_max_attempts
  from public.quiz_questions qq
  join public.quizzes q on q.id = qq.quiz_id
  join public.course_blocks cb on cb.id = q.course_block_id
  where cb.course_version_id = v_version_id and q.quiz_kind = 'final_exam';

  if v_exam_questions <> 30 then
    raise exception 'the published examination must carry exactly 30 questions, found %', v_exam_questions;
  end if;

  if v_passing is distinct from 90 then
    raise exception 'the published examination must pass at 90 percent, found %', coalesce(v_passing, -1);
  end if;

  if v_max_attempts is not null then
    raise exception 'the published examination must allow unlimited attempts, found a cap of %', v_max_attempts;
  end if;

  select count(*) into v_attestations
  from public.course_blocks cb
  where cb.course_version_id = v_version_id and cb.block_type = 'attestation';

  if v_attestations <> 1 then
    raise exception 'the published version must carry exactly one attestation block, found %', v_attestations;
  end if;

  -- If this course ever gains a crosswalk, moving current_version_id without moving the mapping
  -- would leave it published, correct-looking, and awarding nothing.
  select count(*) into v_crosswalks
  from public.course_compliance_credits cc
  where cc.course_id = v_course_id and cc.is_active;

  if v_crosswalks <> 0 then
    raise exception 'this course now carries % active compliance crosswalk(s); move them onto v2026.2 in this same migration',
      v_crosswalks;
  end if;
end;
$verify$;
