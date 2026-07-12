-- The prior fixup migration revoked from `public`, but pg_proc.proacl shows this project's default
-- privileges grant EXECUTE to `anon`/`authenticated`/`service_role` explicitly and individually at
-- CREATE FUNCTION time (not via the generic PUBLIC pseudo-role) -- confirmed live via
-- has_function_privilege('anon', ...). Revoking from `public` was therefore a no-op for any
-- function that never had an explicit `revoke ... from anon` of its own. get_platform_health and
-- retry_notification_delivery are already clean (they had an explicit `revoke ... from anon` in
-- their original migration); these three did not.
--
-- get_platform_setting(p_key text) is the most serious of the three: left anon-callable, any
-- unauthenticated caller could read an arbitrary platform_settings row via
-- /rest/v1/rpc/get_platform_setting, defeating the point of gating the table itself behind
-- platform_admin-only RLS and only exposing two curated fields publicly via the
-- get-platform-status edge function.
revoke execute on function public.get_platform_setting(text) from anon, public;
revoke execute on function public.enforce_facility_limit() from anon, public;
revoke execute on function public.enforce_employee_limit() from anon, public;
