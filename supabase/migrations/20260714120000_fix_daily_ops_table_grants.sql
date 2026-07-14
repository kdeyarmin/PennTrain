-- Fix missing table-level grants for daily operations tables.
-- Migration 20260714093000 created these tables with SELECT RLS policies
-- for the authenticated role but omitted the corresponding GRANT SELECT,
-- causing the phase1_access_matrix invariant check to fail.
grant select on
  public.workforce_time_off_requests,
  public.shift_report_entries,
  public.shift_report_acknowledgements,
  public.notification_escalation_rules
to authenticated;
