-- Backlog SG-4: drop public.record_resident_service_task, the superseded service-task command.
--
-- record_service_task_response replaced it in 20260726060100, and every in-repo surface (the floor
-- and the manager task queue) calls the successor. The legacy command stayed granted to
-- `authenticated` only because nobody could say whether a caller outside this repository still
-- used it -- 20260805000000, 20260805030000 and 20260805040000 recorded that reasoning on the
-- function itself. SG-4 named the evidence that would settle it: request logs over a real window
-- showing nobody invokes it.
--
-- That evidence now exists. The production API gateway logs from 2026-09-09 to 2026-10-09 (the
-- whole retained window, read one day at a time) carry about 214,000 /rest/v1/rpc/ requests and
-- none for this function. Nothing in the database calls it either: record_service_task_response
-- names it only in comments. pg_stat_statements was not used as evidence, because it records no
-- PostgREST RPC statement in a form that can be matched, so its zero proves nothing.
--
-- So the second write path is removed rather than kept or reduced to a shim. The successor has
-- evaluated the same exception thresholds since 20260805040000, so service_task_alerts keeps its
-- producer. No rows are touched: tasks the legacy command documented keep their statuses, including
-- completed_by_other, which get_my_shift_workspace already treats as a completion.
--
-- If an unknown caller does surface, restoring it is a re-creation from git history
-- (20260713160000) plus its grant to `authenticated`.

drop function public.record_resident_service_task(uuid, text, text, boolean, uuid);

-- 20260805040000 described the legacy command as this evaluator's second caller. That stops being
-- true here, and a stored reason that quietly goes stale is what those migrations were written to
-- prevent.
comment on function app_private.evaluate_service_task_exception(public.resident_service_task_instances) is
  'Threshold evaluation behind public.service_task_alerts, called at the end of '
  'public.record_service_task_response, the service-outcome command every in-repo surface uses '
  '(wired in 20260805040000). Its other caller, the superseded public.record_resident_service_task, '
  'was dropped in 20261009210000 (backlog SG-4). Inserts are deduped per (task_instance_id, alert_type).';
