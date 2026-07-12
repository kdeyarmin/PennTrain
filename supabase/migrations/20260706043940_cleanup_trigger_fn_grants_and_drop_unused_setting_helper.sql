-- Trigger functions have zero legitimate direct callers (they only ever fire as BEFORE INSERT
-- triggers, which needs no grant at all) -- strip the leftover authenticated grant too.
revoke execute on function public.enforce_facility_limit() from authenticated;
revoke execute on function public.enforce_employee_limit() from authenticated;

-- get_platform_setting() was meant as a convenience for service-role edge functions, but
-- service_role already bypasses RLS entirely and every other edge function in this codebase
-- queries tables directly via the service-role client rather than through a wrapper RPC (see
-- admin-update-user's `.from("profiles").select(...)` pattern) -- this function only added an
-- extra authenticated-exposed surface with no real caller. Drop it; edge functions read
-- platform_settings directly instead.
drop function if exists public.get_platform_setting(text);
