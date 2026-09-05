-- Two definitions labelled `sql_cron` whose cron entries post to an Edge Function (I17 residual).
--
-- `process-credential-renewals` and `regulatory-update-polling` both run as `net.http_post` to a
-- function, and both were recorded as `sql_cron`. That matters because of how the watchdog and the
-- control plane resolve freshness: for `sql_cron` they read pg_cron's own exit status, and for
-- every other kind they read `app_private.system_job_runs`. A `net.http_post` succeeds the moment
-- the request is ENQUEUED, so both jobs were being judged by a signal that proves delivery and
-- nothing else -- a function answering 401 on every invocation still leaves a trail of `succeeded`
-- cron rows. `process-credential-renewals` did exactly that three times on 2026-09-04 (I4), and
-- neither the watchdog nor the console said a word.
--
-- WHY THIS IS A SECOND MIGRATION rather than part of 20260905240000. Relabelling first would have
-- been worse than leaving it: `last_success_at` for a non-`sql_cron` kind is the ledger's own last
-- succeeded run, a null is stale IMMEDIATELY rather than after the SLA elapses, and neither
-- function claimed a run at all. Both would have gone stale on the first watchdog tick and stayed
-- stale forever. 20260904090000 hit exactly this and said so; the order it established is
-- instrument, deploy, then relabel.
--
-- Both functions now claim before doing any work and finish on every exit path, following the
-- pattern `generate-compliance-binder` has used in production since 20260712150000. An empty queue
-- and an empty source list are SUCCESSFUL runs with nothing attempted, which is what keeps the
-- freshness signal alive on a quiet interval -- staying silent when idle would make a quiet ten
-- minutes and a dead worker look identical, which is this whole class of bug.
--
-- THE DEPLOY WINDOW, WHICH IS NOT ZERO, and is the same one 20260904090000 described:
-- `deploy-migrations.yml` pushes migrations first and Edge Functions second, so for the length of
-- one workflow run these two are judged by a ledger the deployed functions do not yet write to.
-- Both warn on the first watchdog tick after this migration and keep warning until each records
-- its first successful run: `process-credential-renewals` runs every ten minutes, so it clears
-- within ten minutes of the function deploy; `regulatory-update-polling` is weekly, so if the
-- deploy lands just after its tick it can warn for most of a week. Expected and self-clearing, not
-- a signal to act on. Neither is critical, so neither pages.
--
-- Rollback: set both execution_kinds back to 'sql_cron'. The instrumentation is additive and can
-- stay either way.

update app_private.system_job_definitions
set execution_kind = 'edge_cron', updated_at = now()
where job_key in ('process-credential-renewals', 'regulatory-update-polling')
  and execution_kind = 'sql_cron';
