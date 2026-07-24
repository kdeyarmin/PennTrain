-- Rollback for the copilot answer-disposition audit:
--   20260726000300_copilot_run_disposition_audit.sql
--
-- The forward migration is purely additive (one new append-only table + one SECURITY DEFINER
-- RPC); it alters nothing pre-existing, so this reverses cleanly. Apply top-to-bottom inside a
-- single transaction. NOTE: dropping the table discards all recorded human dispositions of copilot
-- answers; export first if that audit trail must be retained.

begin;

-- 1. Drop the write path (the RPC is the only way rows were inserted).
drop function if exists public.record_copilot_run_disposition(uuid, text, text);

-- 2. Drop the table (CASCADE clears the immutability trigger, select policy, and indexes with it).
drop table if exists public.compliance_copilot_run_dispositions cascade;

commit;
