-- Audit classification for the activation-wave control planes.
--
-- Import rows may contain employee/resident source data and lifecycle/invitation records are personnel
-- access evidence, so every table is treated as regulated. Jobs, rows, and cases use ordinary row
-- audit triggers; import events are also audited because service-role writers can append operational
-- details over time.

create trigger data_import_events_audit
after insert or update or delete on public.data_import_events
for each row execute function public.audit_log_trigger();

insert into app_private.audit_entity_manifest(
  table_name, audit_mode, contains_regulated_data, rationale
) values
  (
    'user_invitation_lifecycle',
    'row_trigger',
    true,
    'Invitation identity, role, employee link, status, and delivery lifecycle are audited personnel-access evidence (20260729223000)'
  ),
  (
    'data_import_jobs',
    'row_trigger',
    true,
    'Import file identity, scope, counts, state, and operator decisions are audited data-migration evidence (20260729223100)'
  ),
  (
    'data_import_rows',
    'row_trigger',
    true,
    'Normalized source rows, errors, before snapshots, targets, and rollback status can contain regulated employee or resident data (20260729223100)'
  ),
  (
    'data_import_events',
    'row_trigger',
    true,
    'Import operation events identify jobs, actors, and processing outcomes and are audited as regulated migration evidence (20260729223100)'
  ),
  (
    'employee_lifecycle_cases',
    'row_trigger',
    true,
    'Transfer, leave, return, termination, access, reason, dependency preview, and applied event are audited personnel evidence (20260729223200)'
  )
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();
