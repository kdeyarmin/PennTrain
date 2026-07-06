-- Forward-fix (review finding): shift_assignments_select's employee-owned branch checks only
-- `e.profile_id = auth.uid()`, with no profiles.is_active check -- unlike every other RLS helper in
-- this codebase (current_role/current_org_id/is_platform_admin/is_assigned_to_facility/
-- owns_employee/is_own_employee_assigned_to_facility), which were all deliberately hardened
-- (20260704164627_fix_codex_review_findings.sql, 20260706054447_fix_scheduling_review_findings.sql)
-- to treat a deactivated profile as having zero access.
--
-- Deactivating a terminated employee's profile (is_active=false) does not revoke their existing
-- Supabase Auth JWT until it naturally expires. Because this branch never joins profiles/checks
-- is_active, a terminated employee can keep hitting /me/schedule and reading every published shift
-- assigned to them for as long as their stale session lasts -- exactly the class of bug the rest of
-- this app's RLS helpers were already patched to close.
alter policy shift_assignments_select on public.shift_assignments using (
  public.is_platform_admin()
  or (
    exists (select 1 from public.employees e
            join public.profiles p on p.id = e.profile_id
            where e.id = shift_assignments.employee_id and e.profile_id = (select auth.uid()) and p.is_active)
    and exists (select 1 from public.schedules s where s.id = shift_assignments.schedule_id and s.status = 'published')
  )
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin', 'auditor') or public.is_assigned_to_facility(facility_id)))
);
