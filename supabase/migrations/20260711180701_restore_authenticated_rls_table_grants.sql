-- RLS policies define which rows an authenticated caller may access, but they
-- do not grant the underlying table privileges. Restore the Data API grants
-- that match the existing per-command policies without widening any policy.

grant select, insert, update, delete
  on table
    public.employees,
    public.course_assignments
  to authenticated;

grant select, insert, update, delete
  on table public.employee_facility_assignments
  to authenticated;

grant select, insert, update, delete
  on table public.schedules
  to authenticated;

grant select, insert, update, delete
  on table public.employee_training_records
  to authenticated;

-- Assignment validation is a SECURITY INVOKER trigger and must be able to
-- inspect the selected published version under the caller's role.
grant select
  on table public.course_versions
  to authenticated;

-- Completion and notification evidence is intentionally client read-only.
grant select
  on table
    public.certificates,
    public.notifications,
    public.notification_deliveries
  to authenticated;

grant select, insert, update, delete
  on table
    public.training_types,
    public.residents,
    public.resident_compliance_items
  to authenticated;

-- Resident documents have SELECT/INSERT/DELETE policies and deliberately no
-- direct UPDATE path.
grant select, insert, delete
  on table public.resident_documents
  to authenticated;

-- Help-center tables predate the explicit Data API grant convention. Their
-- policies allow ticket owners and platform administrators to read/write the
-- narrow commands below, and Storage attachment policies must also be able to
-- inspect both tables while evaluating object access.
grant select, insert, update
  on table public.support_tickets
  to authenticated;

grant select, insert
  on table public.support_ticket_messages
  to authenticated;
