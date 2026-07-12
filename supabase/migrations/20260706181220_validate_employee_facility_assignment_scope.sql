-- Forward-fix (review finding): employee_facility_assignments_write's WITH CHECK validates the
-- row's own organization_id and facility_id assignment (organization_id = current_org_id() and
-- is_assigned_to_facility(facility_id)), but never validates that employee_id actually belongs to
-- that organization -- unlike every other employee_id-scoped table in this schema
-- (course_assignments, employee_training_records, practicums, competency_records,
-- employee_credentials, etc.), which all use a stamp_scope_from_employee()-style trigger that
-- derives organization_id/facility_id server-side from employee_id and ignores client input
-- entirely.
--
-- Concretely: a facility_manager in Org X, genuinely assigned to Facility F1 (also in Org X),
-- could call `.insert({organization_id: <Org X>, employee_id: <employee belonging to Org Y>,
-- facility_id: <F1>})`. This passes WITH CHECK because organization_id matches current_org_id()
-- and is_assigned_to_facility(F1) is true -- employee_id is never cross-checked. The resulting row
-- makes is_employee_assigned_to_facility(<Org Y employee>, F1) return true, which is exactly the
-- predicate shift_assignments_write's WITH CHECK
-- (20260706054447_fix_scheduling_review_findings.sql) and validate_employee_schedule_preference()
-- trust to authorize scheduling -- letting a facility_manager fabricate a cross-tenant scheduling
-- link and, downstream, a real shift_assignments row the Org Y employee's own /me/schedule would
-- then surface (shift_assignments_select's employee-owned branch has no organization_id check).
-- This is also the same root cause behind the equivalent gap in
-- useEmployeeFacilityAssignments.ts's useAddEmployeeFacilityAssignment hook, which inserts
-- organization_id/employee_id/facility_id exactly as the caller supplies them -- fixing it here,
-- server-side, closes that path too regardless of which client code calls the insert.
--
-- Unlike stamp_scope_from_employee() (used where facility_id IS the employee's home facility),
-- this table's facility_id is deliberately a *different, additional* facility the employee can be
-- scheduled at -- so we must not overwrite facility_id from the employee row. Instead, derive
-- organization_id from employee_id (rejecting a nonexistent employee, same as every other
-- stamp_scope trigger) and separately reject a facility_id whose own organization doesn't match --
-- both derived/validated server-side rather than trusted from client input.
create or replace function public.validate_employee_facility_assignment_scope()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_emp_org uuid;
  v_fac_org uuid;
begin
  select organization_id into v_emp_org from public.employees where id = new.employee_id;
  if v_emp_org is null then
    raise exception 'employee % not found', new.employee_id using errcode = 'foreign_key_violation';
  end if;

  select organization_id into v_fac_org from public.facilities where id = new.facility_id;
  if v_fac_org is null or v_fac_org <> v_emp_org then
    raise exception 'facility % does not belong to employee %''s organization', new.facility_id, new.employee_id
      using errcode = 'foreign_key_violation';
  end if;

  new.organization_id := v_emp_org;
  return new;
end;
$function$;

create trigger validate_employee_facility_assignment_scope
  before insert or update on public.employee_facility_assignments
  for each row execute function public.validate_employee_facility_assignment_scope();

revoke all on function public.validate_employee_facility_assignment_scope() from public, anon, authenticated;
