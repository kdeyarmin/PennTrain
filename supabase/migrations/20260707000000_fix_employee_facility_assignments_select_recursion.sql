-- 20260706054447_fix_scheduling_review_findings.sql added a branch to employees_select that
-- queries employee_facility_assignments directly (to surface float-assigned employees to the
-- facility_manager scheduling them). But employee_facility_assignments_select already queried
-- employees directly too (its "does the current user own this employee row" branch), and neither
-- subquery goes through a SECURITY DEFINER helper that bypasses RLS -- so evaluating either
-- policy now recurses into the other, and Postgres aborts with "infinite recursion detected in
-- policy for relation employees" (42P17). This breaks every select against employees or
-- employee_facility_assignments for every authenticated role (not just facility_manager), which
-- is why the app started rendering "Employee #<uuid>" everywhere instead of names -- the
-- useListEmployees() query fails outright and every credential/training/report row falls back to
-- its missing-employee placeholder.
--
-- Fix: swap employee_facility_assignments_select's raw subquery for the existing
-- owns_employee() helper (already SECURITY DEFINER, already used by every other "does the caller
-- own this employee" RLS branch in the schema specifically to avoid this class of recursion).
alter policy employee_facility_assignments_select on public.employee_facility_assignments using (
  public.is_platform_admin()
  or public.owns_employee(employee_id)
  or (organization_id = (select public.current_org_id())
      and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)))
);
