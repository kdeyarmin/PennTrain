-- 20260704180646_stamp_facility_scope_from_employee_on_writes.sql only attached the stamp_scope
-- triggers as BEFORE INSERT, matching the course_assignments/competency_records precedent -- but
-- unlike those two tables, employee_training_records_update and practicums_update RLS policies
-- (20260704053527_group_b_rls_policies.sql) validate is_assigned_to_facility(facility_id) on
-- UPDATE too. Without a BEFORE UPDATE trigger, a facility_manager/trainer assigned to Facility A
-- could UPDATE an in-scope row to point employee_id at an employee in Facility B while keeping
-- facility_id=A, since nothing re-derives facility_id from the (possibly changed) employee_id on
-- update. Fix: fire the same trigger on UPDATE as well, so RLS's WITH CHECK always validates
-- against the real, server-derived facility, not whatever the client's UPDATE payload claims.
--
-- training_documents has no UPDATE policy at all (only select/insert/delete), so it isn't
-- exploitable the same way, but the trigger is extended there too for consistency/defense in
-- depth in case an update policy is ever added without this being reconsidered.
drop trigger stamp_scope on public.employee_training_records;
create trigger stamp_scope before insert or update on public.employee_training_records
  for each row execute function public.stamp_scope_from_employee();

drop trigger stamp_scope on public.practicums;
create trigger stamp_scope before insert or update on public.practicums
  for each row execute function public.stamp_scope_from_employee();

drop trigger stamp_scope on public.training_documents;
create trigger stamp_scope before insert or update on public.training_documents
  for each row execute function public.stamp_scope_from_employee_if_present();
