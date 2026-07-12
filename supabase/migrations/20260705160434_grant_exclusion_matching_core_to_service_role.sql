-- The screen-exclusions Edge Function calls this via its service-role client's .rpc() after
-- bulk-loading a fresh CSV -- same reasoning as set_certificate_pdf/admin_update_profile:
-- service_role does NOT implicitly bypass function-level EXECUTE grants, so it needs its own
-- explicit grant even though the function is otherwise fully locked down.
grant execute on function public.match_exclusion_list_against_roster_core(text, uuid) to service_role;
