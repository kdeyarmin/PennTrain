-- Reverts 20260705234657_grant_facility_manager_audit_logs_select.sql. Automated PR review
-- (kdeyarmin/PennTrain#34) correctly flagged that audit_logs has no facility_id column, so granting
-- facility_manager here (unlike every other facility_manager grant in this schema, which is scoped
-- via is_assigned_to_facility(facility_id)) gave every facility manager unrestricted read access to
-- every other facility's audit trail in their org -- including full old_values/new_values JSON of
-- employee, incident, and other entity changes outside their assignment. Reverting to org_admin/
-- auditor-only until a facility-scoped approach (or a deliberate org-wide-access decision) is made.
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','auditor'))
);
