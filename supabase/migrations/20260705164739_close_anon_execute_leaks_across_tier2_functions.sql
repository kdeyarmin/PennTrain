-- Same "PUBLIC-vs-named-role" gotcha this session already hit twice before
-- (fix_anon_execute_leak_on_course_and_recalc_rpcs, revoke_anon_execute_on_notification_and_review_functions):
-- `revoke ... from public` only clears the PUBLIC pseudo-role's grant, not Supabase's own
-- project-level default-privilege grant to the named `anon` role, which every one of these
-- functions picked up automatically at CREATE time. None of these are actually exploitable --
-- each SECURITY DEFINER function's own is_platform_admin()/current_org_id()/current_role()/
-- owns_employee()-style check depends on auth.uid() resolving to a real signed-in user, which is
-- null for an anon caller -- but leaving the grant in place is still an unnecessary RPC-exposure
-- surface and a Supabase advisor lint finding, so close it explicitly across every function
-- touched by Tier 2.6-2.9.

-- Superseded by generate_class_checkin_token(uuid, boolean) -- drop the now-dead 1-arg overload
-- entirely rather than just fixing its grants.
drop function if exists public.generate_class_checkin_token(uuid);

revoke all on function public.generate_class_checkin_token(uuid, boolean) from public, anon, authenticated;
grant execute on function public.generate_class_checkin_token(uuid, boolean) to authenticated;

revoke all on function public.checkin_via_token(text) from public, anon, authenticated;
grant execute on function public.checkin_via_token(text) to authenticated;

revoke all on function public.checkin_via_kiosk_pin(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.checkin_via_kiosk_pin(uuid, uuid, text) to authenticated;

revoke all on function public.set_employee_checkin_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.set_employee_checkin_pin(uuid, text) to authenticated;

revoke all on function public.rescan_org_exclusion_matches(uuid) from public, anon, authenticated;
grant execute on function public.rescan_org_exclusion_matches(uuid) to authenticated;

-- Trigger-only functions -- not callable directly via RPC regardless of grants (Postgres itself
-- rejects a direct call to a RETURNS TRIGGER function), but revoked anyway for lint hygiene,
-- matching revoke_execute_on_notification_delivery_trigger's precedent.
revoke all on function public.lock_published_policy_version() from public, anon, authenticated;
revoke all on function public.stamp_org_from_administrator_profile() from public, anon, authenticated;
revoke all on function public.stamp_scope_from_employee_for_attestation() from public, anon, authenticated;
