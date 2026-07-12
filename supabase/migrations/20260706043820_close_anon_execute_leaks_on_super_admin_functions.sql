-- Same gap this codebase already hit once (20260704180605_revoke_public_grant_on_privileged_functions.sql):
-- Postgres grants EXECUTE to PUBLIC automatically at CREATE FUNCTION time; revoking from a named
-- role (anon) never touches that separate PUBLIC-level grant, since every role including anon is
-- implicitly a member of PUBLIC. Confirmed by the security advisor flagging all four new functions
-- from this session as anon/public-executable despite the earlier `revoke ... from anon`.
--
-- enforce_facility_limit()/enforce_employee_limit() only ever fire as BEFORE INSERT triggers and
-- should never be directly RPC-callable by anyone -- revoke from public entirely, no re-grant.
revoke execute on function public.enforce_facility_limit() from public;
revoke execute on function public.enforce_employee_limit() from public;

-- The rest have real authenticated callers (admin dashboard, retry action, settings lookups) --
-- strip the PUBLIC grant, keep the explicit authenticated/service_role grants already made.
revoke execute on function public.get_platform_health() from public;
revoke execute on function public.get_platform_setting(text) from public;
revoke execute on function public.retry_notification_delivery(uuid) from public;
