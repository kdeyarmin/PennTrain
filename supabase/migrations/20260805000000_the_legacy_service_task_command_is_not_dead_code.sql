-- Why public.record_resident_service_task is still here (backlog G15.13, recorded as SG-4).
--
-- READ FROM INSIDE THIS REPOSITORY IT LOOKS LIKE DEAD CODE. Nothing calls it.
-- `useRecordResidentServiceTask` (useResidentServiceTasks.ts) kept the old name but reaches
-- public.record_service_task_response; the only remaining in-repo references are the pgTAP suite
-- and the generated database.types.ts. The next person sweeping unused RPCs will find exactly
-- that and delete it.
--
-- IT IS NOT DEAD CODE. 20260713160000_support_plan_service_task_automation.sql ends with
-- `grant execute ... to authenticated` on this function and nothing has revoked it since, so it is
-- a live PostgREST surface. Any caller outside this repository -- a partner integration, an
-- operator script, a mobile build shipped before the successor existed -- can still reach it, and
-- this repository cannot see who does.
--
-- THERE ARE THREE WAYS TO CLOSE IT OUT AND ALL THREE CHANGE BEHAVIOUR FOR THOSE CALLERS:
--
--   1. Drop the function. Their call fails outright (42883). Loud, which is the one thing in its
--      favour, but it also removes the last caller of app_private.evaluate_service_task_exception
--      (see below) and so silently retires the service_task_alerts queue with it.
--   2. Revoke execute. Same failure with a different code (42501) and the same alerting loss. It
--      is the drop in every respect that matters to a caller.
--   3. Delegate to the successor -- keep the signature, call record_service_task_response inside.
--      The call keeps succeeding, which is what makes this the option that looks safe.
--
-- OPTION 3 IS THE ONE THAT LOOKS SAFE AND IS NOT, AND IT FAILS ON EVIDENCE RATHER THAN CAUTION.
-- `completed_by_other` -- one of the five outcomes this function accepts, and a real one: the aide
-- who came to do the task found it already done by a colleague -- has NO equivalent response in
-- the successor. record_service_task_response validates its response against
-- resident_service_requirements.acceptable_completion_responses, which
-- 20260726050100_service_delivery_contract.sql constrains by CHECK to exactly seven values, none
-- of which is completed_by_other. A shim therefore has to map it onto completed_as_planned (which
-- is what completionResponseForServiceOutcome already does on the client), and that writes
-- status = 'completed'. The caller sent "somebody else did this" and the record says "I did this".
-- That is not a caution about unknown callers; it is a specific, checkable loss of meaning, and it
-- lands in a resident's service history, which is a regulatory record.
--
-- Three further divergences, any one of which independently breaks a shim's promise to behave the
-- same way:
--
--   * ALERTING. This function is the only caller of app_private.evaluate_service_task_exception,
--     which is the only thing that inserts public.service_task_alerts (the exception thresholds in
--     public.service_exception_rules -- 3 refusals in 7 days routes to support-plan review, and so
--     on). record_service_task_response has never evaluated exceptions. A shim stops producing
--     alerts for the caller that used to get them.
--   * VALIDATION RELAXED. This function rejects a non-completed outcome with no note (>= 3 chars)
--     and rejects a requirement with requires_two_staff when no second employee is supplied.
--     record_service_task_response enforces neither. A shim starts accepting calls that used to be
--     refused, which is the worse direction for a compliance record.
--   * VALIDATION TIGHTENED, IN THE OTHER DIRECTION. record_service_task_response rejects any
--     response the plan's acceptable_completion_responses does not list. A shim starts rejecting
--     calls that used to succeed, on a rule the old caller has never seen.
--
-- SO THE ROW STAYS OPEN AND THE FUNCTION STAYS AS IT IS. Leaving it untouched is the only outcome
-- that changes nothing for a caller this repository cannot enumerate. That is a decision with a
-- cost -- two commands can write this table with different rules -- and it is recorded as a
-- standing gap rather than closed as cleanup, so it carries a review date and a gate.
--
-- WHAT WOULD ACTUALLY CLOSE IT: evidence about callers (PostgREST/pg_stat_statements over a real
-- window showing nobody outside this repository invokes it), or a successor that can express
-- completed_by_other -- which is a schema change to the response vocabulary and its CHECK, not a
-- shim. Until one of those exists, deleting this function is a guess.
--
-- This migration changes no behaviour. It attaches the finding to the objects themselves, because
-- a comment in a planning document does not reach the person running "drop the unused RPCs".

comment on function public.record_resident_service_task(uuid, text, text, boolean, uuid) is
  'SUPERSEDED by record_service_task_response but DELIBERATELY RETAINED -- do not drop, revoke, or '
  'reduce to a shim without reading 20260805000000 (backlog SG-4). It is still granted to '
  'authenticated, so out-of-repo callers can still reach it; it accepts completed_by_other, which '
  'the successor''s response vocabulary cannot express and would silently record as an ordinary '
  'completion; and it is the only caller of app_private.evaluate_service_task_exception, so it is '
  'the only thing that still fills the service_task_alerts queue.';

comment on function app_private.evaluate_service_task_exception(public.resident_service_task_instances) is
  'Threshold evaluation behind public.service_task_alerts. Called from exactly one place -- '
  'public.record_resident_service_task -- so this is the whole alert-producing path. '
  'record_service_task_response, the successor for in-repo callers, does not evaluate exceptions '
  'at all; see 20260805000000 and backlog SG-4 before changing either side.';
