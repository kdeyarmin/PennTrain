-- Companion fix to 20260706101300_privileged_write_bypass_for_course_content_locks.sql: that
-- migration added an app.privileged_write bypass to lock_published_course_block() so a trusted
-- server-side write could resolve an in-flight HeyGen job on an already-published course version,
-- but flagged that nothing yet SETS that GUC for the actual write path -- poll-heygen-video-statuses
-- (cron-invoked, verify_jwt=false) writes course_blocks through a plain service-role
-- `adminClient.from("course_blocks").update(...)` (supabase/functions/_shared/heygenPolling.ts),
-- and each PostgREST request is its own transaction, so a separate prior call could never make
-- set_config(..., true)'s transaction-local effect visible to that update's trigger anyway.
--
-- Same problem, same solution already used twice in this schema (set_certificate_pdf,
-- 20260705055759; admin_update_profile, 20260704142921): a SECURITY DEFINER RPC that calls
-- set_config() and performs the write in the same PL/pgSQL block (so it's the same transaction),
-- revoked from public/anon/authenticated and granted ONLY to service_role -- reachable exclusively
-- from a trusted Edge Function holding the service-role key, never directly from a browser client.
-- No internal authorization check by design, matching set_certificate_pdf's rationale: the calling
-- Edge Function (poll-heygen-video-statuses) is a cron-only, no-caller-JWT endpoint that always
-- processes the same system-wide HeyGen job queue regardless of who/what invoked it -- there is no
-- caller identity to authorize against.
--
-- check-course-video-status (the other, authenticated-caller consumer of the same shared
-- pollAndResolveHeygenVideo helper) is unaffected and keeps writing course_blocks directly through
-- the caller's own RLS-scoped client -- that path already satisfies lock_published_course_block()'s
-- is_platform_admin() bypass today (WRITER_ROLES restricts that endpoint to platform_admin), so it
-- has no need for this RPC.
create or replace function public.write_course_block_heygen_state(
  p_block_id  uuid,
  p_body      jsonb,
  p_video_url text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform set_config('app.privileged_write', 'on', true);
  update public.course_blocks
     set body      = p_body,
         video_url = coalesce(p_video_url, video_url)
   where id = p_block_id;
end;
$function$;

revoke all on function public.write_course_block_heygen_state(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.write_course_block_heygen_state(uuid, jsonb, text) to service_role;
