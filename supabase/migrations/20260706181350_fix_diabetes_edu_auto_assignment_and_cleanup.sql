-- Forward-fix (review finding): the DIABETES-EDU training_type
-- (20260705143706_med_admin_practicum_windows_and_diabetes_education.sql) was seeded with
-- applies_to_administers_meds = true, directly contradicting that same migration's own comment
-- that it is deliberately NOT auto-assigned -- insulin authorization only applies to the subset of
-- med-admin staff who actually handle insulin, which isn't a fact this schema tracks per-employee,
-- so it's meant to be assigned deliberately per-employee via the existing "Record Training" flow.
--
-- instantiate_missing_requirements() gates shell-creation on
-- `coalesce(tt.applies_to_administers_meds, false) = false or v_emp.administers_medications` -- with
-- applies_to_administers_meds = true, that reduces to just `v_emp.administers_medications`, so every
-- employee with administers_medications = true (the entire med-admin roster, including staff who
-- never touch insulin) gets a permanent "missing" DIABETES-EDU shell on hire/backfill -- overstating
-- non-compliance org-wide and generating ongoing due-soon/missing alerts for a requirement most of
-- those employees were never actually supposed to have.
update public.training_types
set applies_to_administers_meds = false
where code = 'DIABETES-EDU' and organization_id is null;

-- Clean up shells the buggy engine already created: an untouched auto-instantiated row is
-- identifiable as "missing status, never completed, no supporting document on file" -- exactly what
-- instantiate_missing_requirements() itself produces and nothing else. A row an admin has since
-- acted on (any completion_date, or a supporting training_documents row) is left alone, since that's
-- evidence of a deliberate, real assignment rather than the auto-engine's blanket shell.
-- alerts.training_record_id has no ON DELETE action, so any open alert pointing at a shell we're
-- about to remove must be cleared first or the delete would fail with a FK violation.
delete from public.alerts a
using public.employee_training_records r
join public.training_types tt on tt.id = r.training_type_id
where a.training_record_id = r.id
  and tt.code = 'DIABETES-EDU' and tt.organization_id is null
  and r.status = 'missing' and r.completion_date is null
  and not exists (select 1 from public.training_documents d where d.training_record_id = r.id);

delete from public.employee_training_records r
using public.training_types tt
where r.training_type_id = tt.id
  and tt.code = 'DIABETES-EDU' and tt.organization_id is null
  and r.status = 'missing' and r.completion_date is null
  and not exists (select 1 from public.training_documents d where d.training_record_id = r.id);
