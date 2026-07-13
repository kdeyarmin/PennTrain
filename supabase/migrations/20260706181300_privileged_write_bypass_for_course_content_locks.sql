-- Forward-fix (review finding): the cron-invoked poll-heygen-video-statuses Edge Function writes
-- course_blocks via a service-role client with NO caller JWT (verify_jwt=false), so
-- lock_published_course_block()'s only bypass -- is_platform_admin(), which needs auth.uid() -- can
-- never apply for that write path.
--
-- If a platform_admin generates a HeyGen video for a block, then publishes that course_version
-- before the async job finishes, the poller's later attempt to write the resolved video_url/status
-- back onto that (now-published, immutable) course_blocks row is unconditionally rejected by this
-- trigger: is_platform_admin() evaluates false with no JWT, so the exception fires every time. The
-- block is re-selected and re-polled by the cron every 5 minutes forever (wasting HeyGen API calls),
-- the video_url is never set for real employees taking the now-published course, and if the job had
-- already completed, the downloaded video file is left orphaned in the course-videos storage bucket
-- with no course_blocks row ever linking to it.
--
-- The rest of this schema already has a standard escape hatch for exactly this shape of problem --
-- trusted server-side code (RPCs, and now this migration's server-side trigger) sets the
-- app.privileged_write GUC before a write that must bypass a client-facing guardrail (see
-- quiz_attempts/course_assignments/certificates). Extend the same bypass to the course-content
-- immutability locks, alongside the existing is_platform_admin() bypass, so a trusted service-role
-- write (which sets this GUC itself) can still resolve an in-flight async job's terminal status on
-- an already-published version, while an ordinary authenticated client still cannot bypass
-- immutability just by claiming the GUC (client sessions never have permission to set it, same as
-- the existing quiz/course_assignment/certificate protections rely on).
--
-- NOTE: this migration only updates the database-side gate. The corresponding Edge Function change
-- (poll-heygen-video-statuses / the shared pollAndResolveHeygenVideo helper must call
-- `set_config('app.privileged_write', 'on', true)` before writing course_blocks when running as the
-- service-role client) is tracked separately as non-migration application code.
create or replace function public.lock_published_course_block()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_ver uuid;
begin
  if public.is_platform_admin() or coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  v_ver := case when tg_op = 'DELETE' then old.course_version_id else new.course_version_id end;
  if public.course_version_is_published(v_ver) then
    raise exception 'course_block belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

-- Same bypass, for consistency/defense in depth, on the quiz/quiz_question/quiz_answer siblings
-- (quiz content itself is not touched by the HeyGen poller today, but keeping every content-lock
-- trigger's escape hatch identical avoids this exact gap resurfacing if a future trusted
-- server-side writer needs to touch quiz content on a published version).
create or replace function public.enforce_quiz_block_rules()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_ver uuid; v_type text; v_block uuid;
begin
  if public.is_platform_admin() or coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  v_block := case when tg_op = 'DELETE' then old.course_block_id else new.course_block_id end;
  select cb.course_version_id, cb.block_type into v_ver, v_type
    from public.course_blocks cb where cb.id = v_block;
  if public.course_version_is_published(v_ver) then
    raise exception 'quiz belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;
  if tg_op <> 'DELETE' and v_type is distinct from 'quiz' then
    raise exception 'a quiz may only attach to a course_block of block_type = ''quiz'' (block % is %)',
      v_block, coalesce(v_type, '<missing>') using errcode = 'check_violation';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

create or replace function public.lock_published_quiz_question()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_ver uuid; v_quiz uuid;
begin
  if public.is_platform_admin() or coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  v_quiz := case when tg_op = 'DELETE' then old.quiz_id else new.quiz_id end;
  select cb.course_version_id into v_ver
    from public.quizzes qz
    join public.course_blocks cb on cb.id = qz.course_block_id
   where qz.id = v_quiz;
  if public.course_version_is_published(v_ver) then
    raise exception 'quiz_question belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

create or replace function public.lock_published_quiz_answer()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_ver uuid; v_q uuid;
begin
  if public.is_platform_admin() or coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  v_q := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  select cb.course_version_id into v_ver
    from public.quiz_questions qq
    join public.quizzes qz on qz.id = qq.quiz_id
    join public.course_blocks cb on cb.id = qz.course_block_id
   where qq.id = v_q;
  if public.course_version_is_published(v_ver) then
    raise exception 'quiz_answer belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

create or replace function public.lock_published_quiz_question_explanation()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_ver uuid; v_q uuid;
begin
  if public.is_platform_admin() or coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  v_q := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  select cb.course_version_id into v_ver
    from public.quiz_questions qq
    join public.quizzes qz on qz.id = qq.quiz_id
    join public.course_blocks cb on cb.id = qz.course_block_id
   where qq.id = v_q;
  if public.course_version_is_published(v_ver) then
    raise exception 'quiz_question_explanation belongs to published (immutable) course version %; create a new version to edit', v_ver
      using errcode = '0A000';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$function$;

-- service_role already has EXECUTE on is_platform_admin()/course_version_is_published() (granted by
-- 20260705224500_grant_service_role_execute_on_course_lock_helpers.sql); current_setting() is a
-- built-in with no grant needed.
