-- PT-026: AI data minimization -- pseudonymization audit trail for the
-- compliance copilot.
--
-- compliance-copilot now unconditionally replaces person names and room
-- numbers with stable per-request aliases ("Resident 1", "Staff 2", "Room 1")
-- before anything is sent to the AI provider, and re-substitutes the real
-- names into the validated model output for authorized users
-- (supabase/functions/_shared/aiRedaction.ts). The immutable run receipt
-- therefore needs to record what actually crossed the provider boundary:
-- this column stores the exact pseudonymized prompt that was sent plus the
-- alias map the prompt used, so an audit can both confirm that no direct
-- identifiers left the tenant boundary and reconstruct the real-name reading
-- of the exchange.
--
-- Contract note: the existing user-facing columns (question, rule_sources,
-- evidence_used, response) keep storing the real-name representation shown to
-- authorized users, and response_checksum_sha256 continues to cover the
-- stored (real-name) response. The alias map contains real names, which is
-- why this table's existing RLS (org-scoped platform_admin / org_admin /
-- facility_manager / auditor read) already covers it -- the same audience can
-- read those names on the residents/employees tables directly.
--
-- Nullable: failure receipts recorded before a prompt was built have no
-- provider exchange to record. The insert-only immutability trigger
-- (prevent_phase5_evidence_mutation) is unchanged and applies to this column
-- like every other.

alter table public.compliance_copilot_runs
  add column redaction jsonb
  check (redaction is null or jsonb_typeof(redaction) = 'object');

comment on column public.compliance_copilot_runs.redaction is
  'PT-026 pseudonymization record: {"aliases":[{"alias","value","kind"},...],"prompt":<exact pseudonymized prompt sent to the AI provider>}. Null when the run failed before a prompt was built.';
