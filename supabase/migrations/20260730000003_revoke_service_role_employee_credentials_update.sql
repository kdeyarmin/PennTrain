-- The core access matrix intentionally keeps service-role grants on employee_credentials
-- read-only. Revert the temporary UPDATE grant so trusted workflows continue to use
-- controlled RPCs rather than direct core-table mutation privileges.
revoke update
  on table public.employee_credentials
  from service_role;
