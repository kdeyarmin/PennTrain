-- Sidebar.tsx has always shown the "Audit Log" nav link to both org_admin and
-- facility_manager, but audit_logs_select (see group_b_rls_policies.sql) only ever
-- granted org_admin/auditor -- facility_manager clicking the link got silently
-- redirected back to /app by the frontend's role gate, with RLS never actually
-- consulted. This closes that gap at the source of truth (RLS) so the frontend
-- route change (AUDIT_LOG_ROLES in App.tsx) reflects real, working access rather
-- than a route that would otherwise return zero rows.
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id()) and (select public.current_role()) in ('org_admin','facility_manager','auditor'))
);
