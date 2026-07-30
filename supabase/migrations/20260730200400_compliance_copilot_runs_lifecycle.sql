-- Retention policy for compliance_copilot_runs receipts (real questions +
-- restored responses + redaction maps). RLS already restricts SELECT; this
-- adds the lifecycle archive path so PHI does not live forever in the hot table.
-- disposition archive_only: never auto-deletes (legal/audit).

insert into public.data_lifecycle_policies (
  policy_key, source_table, time_column, organization_column, archive_after_days,
  delete_after_days, disposition, evidence_class, policy_rationale
) values (
  'lifecycle.compliance_copilot_runs',
  'compliance_copilot_runs',
  'created_at',
  'organization_id',
  365,
  null,
  'archive_only',
  'ai_governance_evidence',
  'Compliance copilot runs store the real user question, restored model response, and pseudonymization receipt. Archive after one year for governance; never auto-delete.'
)
on conflict (policy_key) do update set
  archive_after_days = excluded.archive_after_days,
  delete_after_days = excluded.delete_after_days,
  disposition = excluded.disposition,
  policy_rationale = excluded.policy_rationale,
  is_active = true;
