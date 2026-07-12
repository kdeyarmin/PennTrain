-- Review-gate for AI-generated course content: an AI-drafted course_version can't be published
-- until a human (platform_admin) has explicitly reviewed it. Manually-authored versions default
-- ai_generated=false, so this is a no-op for all non-AI content.
--
-- Note: course_versions.ai_generated was already added by
-- 20260705210500_create_course_from_ai_draft_rpc.sql (create_course_from_ai_draft needs the
-- column to exist when it inserts, which runs ahead of this migration in the plan's ordering) --
-- this migration only adds the two review-tracking columns below.
alter table public.course_versions add column ai_reviewed_at timestamptz;
alter table public.course_versions add column ai_reviewed_by uuid references public.profiles(id) on delete set null;

-- CRITICAL, unlike the existing lock_published_* immutability triggers in
-- 20260704073252_group_c_functions_and_triggers.sql (lines ~161-265), which all begin with
-- "if public.is_platform_admin() then return ...; end if;" as a bypass for the platform_admin
-- who owns/edits system-catalog content -- this trigger must NOT include that bypass.
-- platform_admin is exactly the actor this review gate is meant to constrain: an AI-generated
-- version they haven't reviewed yet must not be publishable, even by them, even via a raw API
-- call that skips the UI's checkbox.
create or replace function public.block_unreviewed_ai_publish()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if new.status = 'published' and new.ai_generated and new.ai_reviewed_at is null then
    raise exception 'course_version % is AI-generated and has not been reviewed; mark it reviewed before publishing', new.id
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$function$;

create trigger block_unreviewed_ai_publish before update on public.course_versions
  for each row execute function public.block_unreviewed_ai_publish();
