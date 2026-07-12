drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager','auditor'))
);