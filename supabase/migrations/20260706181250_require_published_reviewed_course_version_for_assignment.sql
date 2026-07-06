-- Forward-fix (review finding): course_assignments_insert has no server-side check that
-- course_version_id refers to a published (let alone AI-reviewed) course_versions row -- the
-- mandatory AI self-review/publish gate (block_unreviewed_ai_publish) only guards the transition of
-- course_versions.status itself to 'published'; it never guards *assigning* a still-draft version
-- to a real employee.
--
-- courses.status and course_versions.status are deliberately decoupled (CourseDetail.tsx: "This is
-- the course's catalog status. It's independent of the per-version publish workflow below"), and
-- create_course_from_ai_draft_rpc.sql sets courses.current_version_id to the brand-new AI-generated
-- DRAFT version (ai_generated=true, ai_reviewed_at=null) immediately on generation, before any
-- review. CourseAssignments.tsx's picker UI filters to published courses/versions and falls back to
-- course.current_version_id when 0/1 published versions exist -- but nothing in the database itself
-- stops a course_assignments row (however it's created: this UI, a future bulk-import path, a direct
-- API call) from pointing at a draft or unreviewed-AI course_version_id. If that happens, an
-- employee can complete and be certified for a course whose content was never reviewed or even
-- published -- completely bypassing the review gate this whole mechanism exists to enforce.
--
-- Deliberately NOT bypassed for platform_admin: unlike the content-immutability locks (which
-- platform_admin may need to intentionally override), this is a pure data-integrity guardrail with
-- no legitimate reason for ANY role -- including the course-authoring role itself -- to assign a
-- learner to content that was never published/reviewed. Mirrors the equally-strict, no-bypass
-- AI-review-gate trigger already documented in ARCHITECTURE.md ("unlike the immutability trigger
-- above, this one applies to platform_admin specifically").
create or replace function public.validate_course_assignment_version()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_status text;
  v_ai_generated boolean;
  v_ai_reviewed_at timestamptz;
begin
  select status, ai_generated, ai_reviewed_at
    into v_status, v_ai_generated, v_ai_reviewed_at
    from public.course_versions where id = new.course_version_id;

  if v_status is null then
    raise exception 'course version % not found', new.course_version_id using errcode = 'foreign_key_violation';
  end if;

  if v_status <> 'published' then
    raise exception 'cannot assign course_version %; it is not published', new.course_version_id
      using errcode = 'check_violation';
  end if;

  if v_ai_generated and v_ai_reviewed_at is null then
    raise exception 'cannot assign course_version %; its AI-generated content has not completed the required review', new.course_version_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

create trigger validate_course_assignment_version
  before insert or update of course_version_id on public.course_assignments
  for each row execute function public.validate_course_assignment_version();

revoke all on function public.validate_course_assignment_version() from public, anon, authenticated;
