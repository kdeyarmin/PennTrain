-- Forward-fix (Copilot review on PR #43): validate_course_assignment_version()
-- (20260706101250_require_published_reviewed_course_version_for_assignment.sql) checks that
-- new.course_version_id is published/reviewed, but never verifies it actually belongs to
-- new.course_id. course_assignments stores both as independent FKs with no database-level link
-- between them, so a caller (buggy application code, a future bulk-import path, or a direct API
-- call) could insert course_id = <course A> alongside course_version_id = <a published, reviewed
-- version of a completely different course B>. That passes every existing check and assigns the
-- employee to course A's catalog entry while course_progress/quiz_attempts/certificates all
-- actually reference course B's content -- the wrong material, and a certificate/training record
-- that misrepresents which course was completed.
create or replace function public.validate_course_assignment_version()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_course_id uuid;
  v_status text;
  v_ai_generated boolean;
  v_ai_reviewed_at timestamptz;
begin
  select course_id, status, ai_generated, ai_reviewed_at
    into v_course_id, v_status, v_ai_generated, v_ai_reviewed_at
    from public.course_versions where id = new.course_version_id;

  if v_status is null then
    raise exception 'course version % not found', new.course_version_id using errcode = 'foreign_key_violation';
  end if;

  if v_course_id <> new.course_id then
    raise exception 'course_version % does not belong to course %', new.course_version_id, new.course_id
      using errcode = 'foreign_key_violation';
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

-- The original trigger only fired on `insert or update of course_version_id`, so an update that
-- changes ONLY course_id (leaving course_version_id untouched) would never re-run this check
-- either -- also fire on `update of course_id` to cover that direction of the same mismatch.
drop trigger validate_course_assignment_version on public.course_assignments;
create trigger validate_course_assignment_version
  before insert or update of course_version_id, course_id on public.course_assignments
  for each row execute function public.validate_course_assignment_version();
