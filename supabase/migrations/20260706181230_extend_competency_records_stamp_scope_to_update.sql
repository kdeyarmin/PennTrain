-- Forward-fix (review finding): competency_records' stamp_scope trigger
-- (20260704164627_fix_codex_review_findings.sql) fires BEFORE INSERT only, never re-deriving
-- facility_id/organization_id on UPDATE, even though the table's own UPDATE RLS policy
-- (competency_records_update, 20260704073358_group_c_rls_policies.sql) re-validates
-- is_assigned_to_facility(facility_id) against that now-unstamped column.
--
-- A facility_manager/trainer assigned only to Facility A who owns a competency_records row for one
-- of their Facility-A employees could call
-- `.update({ employee_id: <employee in Facility B, same org> }).eq('id', <that record>)`. Because
-- the trigger only ran on insert, facility_id/organization_id are NOT recomputed from the new
-- employee_id -- the update policy checks is_assigned_to_facility(facility_id) against the OLD,
-- unchanged facility_id (Facility A), which the caller legitimately owns, so the UPDATE succeeds.
-- The row's employee_id now silently points to a Facility-B employee while facility_id/
-- organization_id still say Facility A, permanently mis-attributing a competency evaluation to the
-- wrong facility.
--
-- This is the exact vulnerability class 20260704182232_extend_stamp_scope_triggers_to_update.sql
-- already fixed for employee_training_records/practicums/training_documents -- and that migration's
-- own comment names competency_records as one of the tables sharing this gap, but it was never
-- actually patched (competency_records used stamp_scope_from_employee() too, per
-- 20260704164627_fix_codex_review_findings.sql, so the same "before insert or update" extension
-- applies here unchanged).
drop trigger stamp_scope on public.competency_records;
create trigger stamp_scope before insert or update on public.competency_records
  for each row execute function public.stamp_scope_from_employee();
