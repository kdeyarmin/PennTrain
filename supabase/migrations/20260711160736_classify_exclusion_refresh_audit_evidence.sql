-- The exclusion refresh migration precedes the Phase 1 audit manifest migration. Classify its
-- operational tables explicitly: immutable run/snapshot rows retain the transition evidence,
-- while source_state is only the current pointer projected from that retained history.
insert into app_private.audit_entity_manifest (
  table_name,
  audit_mode,
  contains_regulated_data,
  rationale
)
values
  (
    'exclusion_refresh_runs',
    'domain_evidence',
    true,
    'Append-only source refresh attempts retain correlation, counts, checksum, outcome, and error evidence'
  ),
  (
    'exclusion_source_snapshots',
    'domain_evidence',
    true,
    'Immutable source snapshots retain validation and activation lifecycle evidence'
  ),
  (
    'exclusion_source_state',
    'domain_evidence',
    true,
    'Current active pointer is a projection whose full transitions are retained by refresh runs and snapshots'
  )
on conflict (table_name) do update
set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();
