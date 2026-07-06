-- Reconstructed from the live xsqobvvreaovwibxwyvv project's actual grant state -- this migration
-- was applied directly to the database but its file was never committed to this repo. Verified via
-- has_function_privilege() against the live project that this is a faithful match of the current
-- state before adding this file (see PR discussion for details).
--
-- Same "PUBLIC-vs-named-role" gotcha this session hit repeatedly before (fix_anon_execute_leak_on_
-- course_and_recalc_rpcs, revoke_anon_execute_on_notification_and_review_functions,
-- close_anon_execute_leaks_across_tier2_functions): `revoke ... from public` alone doesn't clear
-- Supabase's own project-level default-privilege grant to the named `anon` role that every function
-- picks up automatically at CREATE time. None of these are actually exploitable -- the RLS helpers
-- are security definer stable functions whose own auth.uid()-based logic returns a safe default for
-- an anon caller, and the course-AI RPCs gate on is_platform_admin() internally -- but the grants are
-- still an unnecessary RPC-exposure surface and a Supabase advisor lint finding.

-- RLS helper functions -- called via (select fn()) inside RLS policies, so authenticated must keep
-- EXECUTE (every authenticated query needs it for policy evaluation).
revoke all on function public.current_role() from public, anon, authenticated;
grant execute on function public.current_role() to authenticated;

revoke all on function public.current_org_id() from public, anon, authenticated;
grant execute on function public.current_org_id() to authenticated;

revoke all on function public.is_platform_admin() from public, anon, authenticated;
grant execute on function public.is_platform_admin() to authenticated;

revoke all on function public.is_assigned_to_facility(uuid) from public, anon, authenticated;
grant execute on function public.is_assigned_to_facility(uuid) to authenticated;

revoke all on function public.owns_employee(uuid) from public, anon, authenticated;
grant execute on function public.owns_employee(uuid) to authenticated;

-- Course-AI RPCs -- platform_admin-only by their own internal check; Postgres GRANT has no
-- per-row/role-attribute concept, so authenticated still needs EXECUTE and the real gate stays in
-- the RPC body.
revoke all on function public.create_course_from_ai_draft(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_course_from_ai_draft(jsonb, uuid) to authenticated;

revoke all on function public.replace_quiz_questions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_quiz_questions(uuid, jsonb) to authenticated;
