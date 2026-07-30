-- The workforce-readiness forecast maintenance function runs as service_role and directly
-- reads from and updates employee_credentials to drive work-item lifecycle changes.
-- Without table-level privileges the UPDATE at line 153 of the forecast test (and any
-- equivalent production path) fails with "permission denied for table employee_credentials"
-- even though service_role bypasses RLS.  Grant all DML to service_role and keep the
-- authenticated role limited to SELECT, consistent with the pattern used for other
-- workforce tables (e.g. 20260714093000_daily_facility_operations_workforce.sql).
grant all on public.employee_credentials to service_role;
grant all on public.employee_credential_documents to service_role;
