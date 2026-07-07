-- ViolationDetail.tsx's retraining-assignment flow did two separate client-side inserts
-- (course_assignments, then corrective_actions) -- if the second insert failed, the toast said
-- "assigned, but failed to record corrective action" with no rollback, leaving an orphaned course
-- assignment untracked by any Plan of Correction. Wrapping both inserts in one security-invoker
-- function makes them atomic: if either insert's RLS/constraints reject, the whole call (including
-- the first insert) rolls back automatically. Deliberately NOT security definer -- both inserts must
-- stay subject to the caller's own course_assignments_insert/corrective_actions_insert RLS policies,
-- the same trust model as the existing get_facility_readiness_breakdown() function.
--
-- Also fixes the responsible-party bug: the client previously stamped owner_profile_id with the
-- current manager's own id instead of the assigned employee's, and never set owner_name at all
-- (silently blank on the generated POC PDF). This function derives both from the employee row.
--
-- The employee is looked up (and scoped to the violation's own org/facility) before either insert
-- runs, not after: an org_admin can manage more than one facility, so without this check the caller
-- could point retraining at an employee from a different facility than the violation, and a plain
-- `insert ... select ... from employees where id = ...` that matches zero rows would silently insert
-- zero corrective_actions rows (leaving the just-created course_assignments row orphaned) instead of
-- failing loudly.
create or replace function public.create_violation_retraining_action(
  p_violation_id uuid,
  p_employee_id uuid,
  p_course_id uuid,
  p_course_version_id uuid,
  p_due_date date,
  p_description text
) returns public.corrective_actions
language plpgsql
set search_path to 'public'
as $$
declare
  v_org uuid;
  v_fac uuid;
  v_employee_profile_id uuid;
  v_employee_name text;
  v_assignment_id uuid;
  v_action public.corrective_actions;
begin
  select organization_id, facility_id into v_org, v_fac
    from public.dhs_violations where id = p_violation_id;
  if v_org is null then
    raise exception 'violation % not found', p_violation_id using errcode = 'foreign_key_violation';
  end if;

  select profile_id, last_name || ', ' || first_name into v_employee_profile_id, v_employee_name
    from public.employees
    where id = p_employee_id and organization_id = v_org and facility_id = v_fac;
  if not found then
    raise exception 'employee % not found in violation %''s facility', p_employee_id, p_violation_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.course_assignments (
    employee_id, course_id, course_version_id, facility_id, organization_id, assigned_by, due_date
  )
  values (p_employee_id, p_course_id, p_course_version_id, v_fac, v_org, auth.uid(), p_due_date)
  returning id into v_assignment_id;

  insert into public.corrective_actions (
    violation_id, description, due_date, course_assignment_id, owner_profile_id, owner_name,
    organization_id, facility_id
  )
  values (p_violation_id, p_description, p_due_date, v_assignment_id, v_employee_profile_id, v_employee_name, v_org, v_fac)
  returning * into v_action;

  return v_action;
end;
$$;

revoke all on function public.create_violation_retraining_action(uuid, uuid, uuid, uuid, date, text) from public, anon;
grant execute on function public.create_violation_retraining_action(uuid, uuid, uuid, uuid, date, text) to authenticated;
