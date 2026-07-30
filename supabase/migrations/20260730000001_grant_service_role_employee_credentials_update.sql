-- The forecast maintenance test (and any future service-role maintenance worker) needs to
-- UPDATE employee_credentials directly via the service-role path in the regression suite.
-- The daily forecast maintenance itself only reads credentials, but the test must simulate
-- a credential expiration change and re-run the maintenance sweep to verify work-item closure.
-- Extend the existing service_role grant (20260711190000) from SELECT-only to include UPDATE.

grant update
  on table public.employee_credentials
  to service_role;
