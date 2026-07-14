-- The daily-operations tables define authenticated SELECT policies, but the
-- underlying table privilege was omitted. RLS is evaluated only after the
-- table ACL permits the command, so those policies were otherwise unusable.

grant select on table
  public.workforce_time_off_requests,
  public.shift_report_entries,
  public.shift_report_acknowledgements,
  public.notification_escalation_rules
to authenticated;
