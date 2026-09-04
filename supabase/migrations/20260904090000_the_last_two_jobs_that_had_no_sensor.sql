-- The last two of G270's six, and the reason they needed an Edge Function change first.
--
-- WHERE THIS PICKS UP. 20260904050000 closed four of the six critical definitions that were
-- judged by a cron entry whose command is a `net.http_post` -- a signal that records only that
-- the request was enqueued. Each of those four had a sibling definition that its Edge Function
-- genuinely claims and finishes, so the fix was to move the cron entry onto the row that already
-- held the truth.
--
-- `data-lifecycle` and `organization-export-jobs` had no such sibling, and that migration said so
-- rather than pretending otherwise: `run-data-lifecycle` and `process-organization-export-jobs`
-- never called `claim_system_job_execution` at all, so there was no ledger to point at. Moving or
-- relabelling them then would have swapped an always-green signal for an always-red one, which is
-- the same defect facing the other way.
--
-- WHAT CHANGED FIRST. Both Edge Functions now claim a run before doing any work and finish it on
-- every exit path, following the pattern `generate-compliance-binder` has used in production
-- since 20260712150000:
--
--   * `run-data-lifecycle` reports against `data-lifecycle`. Each lifecycle step (every active
--     retention policy, plus the export-archive sweep) is one unit, so a single stuck policy
--     closes the run `partial` rather than taking the whole sweep down with it. Eight Deno tests
--     cover it, three of them new and specifically about the ledger: the claim's arguments, the
--     partial outcome, and that a refused claim does no work and finishes nothing.
--   * `process-organization-export-jobs` reports against `organization-data-export`. An empty
--     queue is a successful run with nothing attempted, which is what keeps the freshness signal
--     alive on a day with no exports -- the alternative, staying silent when idle, would make a
--     quiet day and a dead worker look identical, which is this whole class of bug.
--
-- Claiming BEFORE the work is deliberate in both. A run that dies mid-sweep then leaves a claimed
-- row that 20260904080000's reconciler closes as `abandoned_run`, instead of leaving no trace that
-- the invocation ever happened.
--
-- THE FIX HERE, now that both have a sensor.
--
--   * `organization-export-jobs` is the same shape as the four before it: a `sql_cron` row holding
--     the cron name while `organization-data-export` does the work. The cron entry moves onto the
--     worker and the redundant row is deleted, guarded by its own run history.
--   * `data-lifecycle` is the one definition with no duplicate -- it holds its own cron name and
--     always did. Only its `execution_kind` was wrong: labelled `sql_cron` while its cron command
--     is a `net.http_post`. Correcting it to `edge_cron` is what makes the watchdog stop reading
--     pg_cron's exit status and start reading the run this deploy's function now records.
--
-- BLAST RADIUS, and it is the sharpest in this series. Both jobs go from never-observed to
-- observed, so if either is genuinely broken it will start paging -- which is the point, and is
-- what happened with the billing sync. Neither is expected to: both cron entries have run
-- successfully every scheduled tick for the last seven days, and the failure mode being removed
-- is that nobody would have known if they had not. Freshness SLAs are unchanged.
--
-- Rollback: restore the organization-export-jobs definition with its cron name, clear it from
-- organization-data-export, and set data-lifecycle's execution_kind back to 'sql_cron'. The Edge
-- Function instrumentation is additive and can stay either way.

update app_private.system_job_definitions
set cron_job_name = null, is_active = false, updated_at = now()
where job_key = 'organization-export-jobs';

delete from app_private.system_job_definitions d
where d.job_key = 'organization-export-jobs'
  and not exists (
    select 1 from app_private.system_job_runs r where r.job_key = d.job_key
  );

update app_private.system_job_definitions
set cron_job_name = 'process-organization-export-jobs',
    is_critical = true,
    updated_at = now()
where job_key = 'organization-data-export';

-- Not a duplicate row, just a wrong label: its cron command is a net.http_post, so pg_cron's exit
-- status was never evidence that the sweep ran.
update app_private.system_job_definitions
set execution_kind = 'edge_cron', updated_at = now()
where job_key = 'data-lifecycle';
