-- Same PUBLIC-vs-named-role gotcha this repo has hit repeatedly (see
-- close_anon_execute_leaks_across_tier2_functions and friends): `revoke ... from public` only
-- clears the PUBLIC pseudo-role grant, not Supabase's own project-level default-privilege grant to
-- the named `anon` role that every new function picks up automatically at CREATE time. Close it
-- explicitly for every function added by the scheduling feature.

-- Trigger-only functions: no direct grant needed at all.
revoke all on function public.sync_employee_primary_facility_assignment() from public, anon, authenticated;
revoke all on function public.validate_employee_schedule_preference() from public, anon, authenticated;

-- RLS-helper-style boolean functions: authenticated needs it (mirrors is_assigned_to_facility /
-- owns_employee), anon does not.
revoke all on function public.is_employee_assigned_to_facility(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_employee_assigned_to_facility(uuid, uuid) to authenticated;

revoke all on function public.is_own_employee_assigned_to_facility(uuid) from public, anon, authenticated;
grant execute on function public.is_own_employee_assigned_to_facility(uuid) to authenticated;

-- Action RPCs: authenticated needs it (each does its own is_platform_admin()/current_org_id()/
-- current_role()/is_assigned_to_facility() check internally, same shape as complete_training_class),
-- anon does not.
revoke all on function public.generate_schedule_assignments(uuid) from public, anon, authenticated;
grant execute on function public.generate_schedule_assignments(uuid) to authenticated;

revoke all on function public.clear_auto_filled_assignments(uuid) from public, anon, authenticated;
grant execute on function public.clear_auto_filled_assignments(uuid) to authenticated;

revoke all on function public.publish_schedule(uuid) from public, anon, authenticated;
grant execute on function public.publish_schedule(uuid) to authenticated;

revoke all on function public.unpublish_schedule(uuid) from public, anon, authenticated;
grant execute on function public.unpublish_schedule(uuid) to authenticated;
