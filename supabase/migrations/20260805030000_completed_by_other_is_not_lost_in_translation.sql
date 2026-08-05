-- Correcting the reason 20260805000000 gave for keeping public.record_resident_service_task
-- (backlog SG-4). The conclusion is unchanged -- do not drop it, do not revoke it, do not reduce it
-- to a delegating shim. The argument for the third of those was wrong, and a documented reason that
-- is wrong is worse than no reason at all, because it is the one the next person trusts.
--
-- WHAT 20260805000000 CLAIMED. That `completed_by_other` -- the aide arrived and a colleague had
-- already done the task -- has no equivalent in the successor, so a shim would have to send
-- `completed_as_planned`, write status = 'completed', and thereby record "I did this" where the
-- caller said "somebody else did this": a specific, checkable loss of meaning landing in a
-- resident's service history.
--
-- WHY THAT IS FALSE. The translation already exists in this repository, is tested, and runs on
-- every successor call the product makes:
--
--   * artifacts/caremetric-carebase/src/lib/serviceDeliveryContract.ts --
--     completionResponseForServiceOutcome maps completed / completed_late / completed_by_other onto
--     completed_as_planned. 20260805000000 acknowledged this much.
--   * artifacts/caremetric-carebase/src/hooks/useResidentServiceTasks.ts --
--     and this is the half the earlier note missed: the same call writes
--     exception_details.legacy_status = the original outcome, plus a completed_by_other boolean.
--     The distinction survives the mapping. It is not recorded as an ordinary completion.
--
-- So a SQL shim would not lose the fact. It has a proven mapping to copy, written by the surface
-- that already had to solve this problem. One caveat worth carrying: exception_details.legacy_status
-- is written by useResidentServiceTasks and read back by nothing -- no UI surface and no query in
-- this repository consumes it -- so the preserved fact is available to whoever goes looking for it,
-- and to no screen.
--
-- WHAT ACTUALLY BLOCKS THE SHIM, AND IT IS NARROWER. record_service_task_response refuses any
-- response the requirement's acceptable_completion_responses does not list (22023). A shim that
-- delegates inherits that gate, so a call this function accepts today would start failing on a rule
-- its caller has never been subject to. That is inherent to delegating -- the only way around it is
-- to stop delegating, at which point the shim is a second implementation again, which is the thing
-- being removed.
--
-- The other two divergences 20260805000000 listed are real, and are cost rather than blocker,
-- because a careful shim could re-implement both: the successor never evaluates exception
-- thresholds (so alerts stop for the caller that used to get them), and it enforces neither the
-- >= 3-char note on a non-completed outcome nor requires_two_staff (so calls that used to be
-- refused start succeeding). They are why a careless shim is worse than leaving this alone; they
-- are not why a shim is impossible.
--
-- WHAT WOULD ACTUALLY CLOSE SG-4 is unchanged on one leg and corrected on the other: evidence about
-- callers (PostgREST / pg_stat_statements over a real window showing nobody outside this repository
-- invokes it), or a decision that the plan's acceptable_completion_responses gate may apply to
-- legacy callers too. Not, as 20260805000000 had it, a schema change to the response vocabulary --
-- the vocabulary was never the obstacle.
--
-- 20260805000000 is deployed, and a deployed migration is a record of what ran rather than source
-- that can be revised, so its header stands as written and this one supersedes it. The function
-- comment is a live object property rather than a record, so it is re-issued below.
--
-- This migration changes no behaviour.

comment on function public.record_resident_service_task(uuid, text, text, boolean, uuid) is
  'SUPERSEDED by record_service_task_response but DELIBERATELY RETAINED -- do not drop, revoke, or '
  'reduce to a shim without reading 20260805030000, which corrects 20260805000000 (backlog SG-4). '
  'It is still granted to authenticated, so out-of-repo callers this repository cannot enumerate '
  'can still reach it. It is the only caller of app_private.evaluate_service_task_exception, so it '
  'is the only thing that still fills the service_task_alerts queue. And a delegating shim would '
  'inherit the successor''s acceptable_completion_responses gate, so calls this function accepts '
  'today would start failing 22023 on a rule their caller has never seen. CORRECTION to '
  '20260805000000: completed_by_other is NOT lost in translation -- '
  'completionResponseForServiceOutcome maps it onto completed_as_planned and '
  'useResidentServiceTasks preserves it in exception_details as legacy_status plus a boolean, '
  'tested and in use, so fidelity is not the reason this stays.';
