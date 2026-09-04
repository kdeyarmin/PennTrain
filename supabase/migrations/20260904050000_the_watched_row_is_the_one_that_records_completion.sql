-- Four critical jobs read their health off pg_cron's exit status, which for them means nothing.
--
-- THE FINDING (BACKLOG G270, the residual half of G269). 20260814010000 stopped the watchdog
-- trusting `cron.job_run_details` for `edge_cron` and `worker` definitions, because when a cron
-- entry's command is a `net.http_post`, "succeeded" records that the REQUEST WAS ENQUEUED, not
-- that the work happened. It keyed that decision on `execution_kind`.
--
-- `execution_kind` is a label, and six critical definitions carry the label `sql_cron` while their
-- cron entry is a `net.http_post` to an Edge Function. For those six the watchdog is back to
-- reading the wrong sensor -- the exact condition that let the billing sync fail hourly for weeks
-- under a green light. Verified on production: all six have zero rows in
-- `app_private.system_job_runs` under their own job_key, so pg_cron is the only thing feeding
-- their freshness.
--
-- Four of the six have a SIBLING definition that records the real work, and that sibling carries
-- `cron_job_name = null` -- so, exactly as in the billing case, the row doing the observing and
-- the row being observed are different rows:
--
--   watched (never records)              records the work (never watched)
--   -----------------------------------  -----------------------------------------
--   certificate-pdf-jobs                 certificate-pdf-generation
--   binder-export-jobs                   binder-export-generation
--   document-analyzer-jobs               document-analyzer-extraction
--   integration-webhook-dispatch-cron    integration-webhook-dispatch
--
-- Each right-hand row is claimed and finished by its Edge Function through
-- `claim_system_job_execution` / `finish_system_job` (generate-certificate-pdf,
-- generate-compliance-binder, analyze-state-form, dispatch-integration-webhooks respectively), and
-- on production all four have recorded successes minutes old. The health signal exists; nothing
-- was reading it.
--
-- THE FIX, following 20260814010000's shape exactly. For each pair the cron entry moves onto the
-- row that records completion, the criticality the PAIR was declared with moves with it, and the
-- now-redundant row is removed -- guarded by its own run history, so a deployment that did record
-- runs under that key keeps them (the FK is ON DELETE RESTRICT).
--
-- The two definitions whose surviving row was `is_critical = false` (binder-export-generation,
-- document-analyzer-extraction) become critical. That is not an escalation: the pair was already
-- declared critical on the half that could never report, so this preserves the intended alerting
-- rather than adding it. Both record a run on every cron tick even with an empty queue -- verified
-- on production, where each has a `last_known_good_at` minutes old -- so a 30-minute freshness SLA
-- against a 5-minute cron has ample margin and will not flap on an idle queue.
--
-- THE OTHER TWO OF THE SIX ARE DELIBERATELY NOT TOUCHED HERE, and this is the honest part.
-- `data-lifecycle` (run-data-lifecycle) and `organization-export-jobs`
-- (process-organization-export-jobs) have no sibling that records anything, because neither Edge
-- Function calls claim_system_job_execution at all. Repointing or relabelling them would not give
-- the watchdog a true sensor -- it would only replace a signal that is always green with one that
-- is always red, and a critical job that pages continuously is the same failure this migration
-- exists to end, pointed the other way. Fixing them means instrumenting those two functions to
-- claim and finish a run, which is an Edge Function change with its own tests and its own deploy;
-- it is recorded in BACKLOG.md as the remainder of G270 rather than half-done here.
--
-- BLAST RADIUS. Four cron entries change which definition observes them; two definitions become
-- critical; four redundant definitions are removed where they have no run history. No cron
-- schedule, command, function, or Edge Function changes, so no job's actual execution is altered
-- -- only which row the watchdog reads to decide whether it happened.
--
-- Rollback: restore the four removed definitions and clear cron_job_name from the four survivors.

do $$
declare
  v_pair record;
begin
  for v_pair in
    select *
    from (values
      ('certificate-pdf-jobs',              'certificate-pdf-generation',   'process-certificate-pdf-jobs'),
      ('binder-export-jobs',                'binder-export-generation',     'process-binder-export-jobs'),
      ('document-analyzer-jobs',            'document-analyzer-extraction', 'process-document-analyzer-jobs'),
      ('integration-webhook-dispatch-cron', 'integration-webhook-dispatch', 'integration-webhook-dispatch')
    ) as t(stale_key, recording_key, cron_name)
  loop
    -- Release the cron name first: cron_job_name is UNIQUE, so the redundant row has to let go
    -- before the recording row can take it. Deactivate too -- a surviving row (one that has run
    -- history and so escapes the delete below) that kept is_active would list on
    -- /admin/system-jobs as a job that can never be scheduled again.
    update app_private.system_job_definitions
    set cron_job_name = null, is_active = false, updated_at = now()
    where job_key = v_pair.stale_key;

    delete from app_private.system_job_definitions d
    where d.job_key = v_pair.stale_key
      and not exists (
        select 1 from app_private.system_job_runs r where r.job_key = d.job_key
      );

    -- The row the Edge Function actually claims and finishes becomes the watched, critical one.
    update app_private.system_job_definitions
    set cron_job_name = v_pair.cron_name,
        is_critical = true,
        updated_at = now()
    where job_key = v_pair.recording_key;
  end loop;
end;
$$;

comment on column app_private.system_job_definitions.cron_job_name is
  'The cron entry whose freshness this definition is judged by. It must sit on the definition that RECORDS the work through claim_system_job_execution / finish_system_job, not on a sibling that merely schedules it: for a cron command that is a net.http_post, pg_cron''s exit status proves the request was enqueued and nothing more. Splitting the two across separate rows is how the billing sync failed hourly for weeks under a green light (20260814010000) and how four more jobs were still being judged as of 20260904050000.';
