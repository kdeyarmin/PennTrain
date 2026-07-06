-- Fresh get_advisors run flags 11 functions as anon-executable SECURITY DEFINER RPCs. All 11 were
-- defined with only `revoke all on function ... from public;` (or, for issue_certificate/
-- current_org_id/current_role/is_platform_admin/is_assigned_to_facility, no revoke at all) --
-- the same PUBLIC-vs-named-role gap already fixed elsewhere in this project
-- (revoke_public_grant_on_privileged_functions, fix_anon_execute_leak_on_course_and_recalc_rpcs,
-- close_anon_execute_leaks_across_tier2_functions): revoking from PUBLIC never touches Supabase's
-- own project-level default-privilege grant to the named `anon` role, which every function above
-- picked up automatically at CREATE time.
--
-- None of these are concretely exploitable -- every one either has its own
-- is_platform_admin()/current_org_id()/current_role()/owns_employee()-style internal check that
-- depends on auth.uid() resolving to a real signed-in user (null for an anon caller, so the check
-- fails and the RPC raises or returns nothing), or is a read-only lookup with no sensitive branch
-- reachable without a session. But the leftover anon grant is still unnecessary RPC-exposure
-- surface and a standing lint finding, so close it explicitly. authenticated keeps EXECUTE on all
-- of these: the five RLS-helper functions are called from inside RLS policy expressions
-- throughout the schema and require it to evaluate at all, and the rest are legitimate
-- authenticated-only RPCs.
--
-- verify_certificate(text) is intentionally excluded -- anon access there is the deliberate,
-- already-accepted public certificate-verification surface (see group_c_rpcs.sql), not a leak.

revoke all on function public.current_org_id() from public, anon, authenticated;
grant execute on function public.current_org_id() to authenticated;

revoke all on function public.current_role() from public, anon, authenticated;
grant execute on function public.current_role() to authenticated;

revoke all on function public.is_platform_admin() from public, anon, authenticated;
grant execute on function public.is_platform_admin() to authenticated;

revoke all on function public.is_assigned_to_facility(uuid) from public, anon, authenticated;
grant execute on function public.is_assigned_to_facility(uuid) to authenticated;

revoke all on function public.owns_employee(uuid) from public, anon, authenticated;
grant execute on function public.owns_employee(uuid) to authenticated;

revoke all on function public.course_version_is_published(uuid) from public, anon, authenticated;
grant execute on function public.course_version_is_published(uuid) to authenticated;

revoke all on function public.get_quiz_answer_choices(uuid) from public, anon, authenticated;
grant execute on function public.get_quiz_answer_choices(uuid) to authenticated;

revoke all on function public.grade_quiz_attempt(uuid) from public, anon, authenticated;
grant execute on function public.grade_quiz_attempt(uuid) to authenticated;

revoke all on function public.issue_certificate(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.issue_certificate(uuid, uuid, uuid, timestamptz) to authenticated;

revoke all on function public.create_course_from_ai_draft(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_course_from_ai_draft(jsonb, uuid) to authenticated;

revoke all on function public.replace_quiz_questions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_quiz_questions(uuid, jsonb) to authenticated;
