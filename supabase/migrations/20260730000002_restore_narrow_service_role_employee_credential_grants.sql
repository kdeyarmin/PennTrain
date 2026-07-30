-- The readiness maintenance worker only needs to execute its RPC as service_role; the
-- direct credential UPDATE in the regression suite is fixture setup and should not widen
-- the core-table allowlist. Restore the previously audited narrow grants here.
revoke all
  on table
    public.employee_credentials,
    public.employee_credential_documents
  from service_role;

grant select
  on table public.employee_credentials
  to service_role;
