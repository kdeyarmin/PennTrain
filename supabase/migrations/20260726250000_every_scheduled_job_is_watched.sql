-- Every scheduled job is registered, so the watchdog and the operator page can see it.
--
-- THE FINDING. The database schedules 39 cron jobs. `app_private.system_job_definitions` held 23.
-- Both surfaces that report job health are driven by that table:
--
--   * public.run_system_job_watchdog() iterates system_job_definitions and emits a stale-job event
--     when a critical job has not succeeded inside its freshness SLA. A job with no definition row
--     is not iterated, so its silence raises nothing.
--   * public.get_system_job_control_plane() -- the /admin/system-jobs page -- returns one row per
--     definition. An unregistered job does not appear, so the page reads as a complete list of
--     healthy jobs while 22 of them are unobserved.
--
-- This is the failure mode this program treats as worst: a metric that reads fine because it is
-- blind. "All jobs healthy" and "all jobs I know about are healthy" are indistinguishable on screen.
--
-- WHAT WAS UNWATCHED. Not obscure jobs. Among them:
--
--   * generate-resident-service-tasks-daily -- if this stops, the floor is issued no tasks at all.
--     Staff would see an empty queue and have no reason to suspect the schedule rather than a quiet
--     day. This is the most operationally severe job in the list.
--   * activate-due-support-plans -- approved plans never take effect, so service requirements keep
--     generating from the superseded version (see 20260726240000, which added the per-resident
--     symptom card for exactly this).
--   * escalate-change-followups / -overdue-work-items / -shift-handoffs -- everything time-based in
--     the operational queue stops escalating while still looking populated.
--   * billing-quantity-sync and billing-trial-expiry-notices -- billing drifts silently.
--   * run-data-lifecycle-nightly -- retention stops running, which is a compliance exposure that
--     nothing else surfaces.
--   * system-job-last-success-watchdog itself -- the watchdog did not watch the watchdog, so if it
--     stopped, every other job's staleness went unreported too.
--
-- CRITICALITY IS NOT UNIFORM AND IS NOT GUESSED. `is_critical` drives paging; marking everything
-- critical produces a stream nobody reads, which is the same outcome as watching nothing. The rule
-- used below: critical when silence causes care, compliance, or billing harm that no other surface
-- would reveal. A digest that does not send is noticed by its absence; a task generator that does
-- not run is not.
--
-- Freshness SLAs are set at roughly two missed runs, so one transient failure does not page while a
-- genuinely stopped job does.
--
-- Rollback: delete these rows from app_private.system_job_definitions by job_key.

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values
  -- Care delivery -------------------------------------------------------------------------------
  ('resident-service-task-generation', 'Resident service task generation',
   'Generates the floor task queue from active support plans. Silence here empties every aide''s task list.',
   'sql_cron', 'generate-resident-service-tasks-daily',
   interval '1 day', interval '30 hours', true, 'manual', '/admin/system-jobs'),

  ('support-plan-activation', 'Support plan activation',
   'Promotes approved plans whose effective date has arrived; also regenerates service requirements.',
   'sql_cron', 'activate-due-support-plans',
   interval '1 day', interval '30 hours', true, 'manual', '/admin/system-jobs'),

  ('change-followup-escalation', 'Change-of-condition follow-up escalation',
   'Escalates change-of-condition follow-ups past their due time.',
   'sql_cron', 'escalate-change-followups',
   interval '15 minutes', interval '1 hour', true, 'automatic', '/admin/system-jobs'),

  ('shift-handoff-escalation', 'Shift handoff escalation',
   'Escalates shift handoffs left unacknowledged.',
   'sql_cron', 'escalate-shift-handoffs',
   interval '15 minutes', interval '1 hour', true, 'automatic', '/admin/system-jobs'),

  -- Operational queue ---------------------------------------------------------------------------
  ('work-item-escalation', 'Work item escalation',
   'Escalates overdue work items. Without it the queue still lists work but stops ageing it.',
   'sql_cron', 'escalate-overdue-work-items',
   interval '15 minutes', interval '1 hour', true, 'automatic', '/admin/system-jobs'),

  ('work-item-registration', 'Outstanding work item registration',
   'Registers outstanding obligations as work items so they reach an owner.',
   'sql_cron', 'register-outstanding-work-items',
   interval '1 hour', interval '3 hours', true, 'automatic', '/admin/system-jobs'),

  ('compliance-requirement-maintenance', 'Compliance requirement maintenance',
   'Maintains resident and employee compliance requirement rows against the rule packs.',
   'sql_cron', 'compliance-requirement-maintenance-daily',
   interval '1 day', interval '30 hours', true, 'manual', '/admin/system-jobs'),

  -- Retention and integrations ------------------------------------------------------------------
  ('data-lifecycle', 'Data lifecycle enforcement',
   'Applies retention and purge policy. Silent failure is a compliance exposure nothing else shows.',
   'sql_cron', 'run-data-lifecycle-nightly',
   interval '1 day', interval '30 hours', true, 'manual', '/admin/system-jobs'),

  ('integration-webhook-dispatch-cron', 'Integration webhook dispatch',
   'Delivers queued outbound integration webhooks.',
   'sql_cron', 'integration-webhook-dispatch',
   interval '5 minutes', interval '30 minutes', true, 'automatic', '/admin/system-jobs'),

  ('fhir-integration-freshness', 'FHIR integration freshness',
   'Flags FHIR feeds that have gone stale, so clinical data is not trusted past its currency.',
   'sql_cron', 'fhir-integration-freshness',
   interval '15 minutes', interval '1 hour', true, 'automatic', '/admin/system-jobs'),

  ('medication-integration-freshness', 'Medication integration freshness',
   'Flags medication feeds that have gone stale.',
   'sql_cron', 'medication-integration-freshness',
   interval '15 minutes', interval '1 hour', true, 'automatic', '/admin/system-jobs'),

  -- Billing -------------------------------------------------------------------------------------
  ('billing-trial-expiry', 'Trial expiry notices',
   'Sends trial expiry notices and applies expiry. Silence bills or fails to bill without anyone noticing.',
   'sql_cron', 'billing-trial-expiry-notices',
   interval '1 day', interval '30 hours', true, 'manual', '/admin/system-jobs'),

  -- Async work the user is waiting on -----------------------------------------------------------
  -- Critical because the user sees "in progress" indefinitely rather than an error.
  ('certificate-pdf-jobs', 'Certificate PDF generation queue',
   'Renders queued certificate PDFs.',
   'sql_cron', 'process-certificate-pdf-jobs',
   interval '5 minutes', interval '30 minutes', true, 'automatic', '/admin/system-jobs'),

  ('binder-export-jobs', 'Compliance binder export queue',
   'Builds queued compliance binder exports.',
   'sql_cron', 'process-binder-export-jobs',
   interval '5 minutes', interval '30 minutes', true, 'automatic', '/admin/system-jobs'),

  ('document-analyzer-jobs', 'State form analyzer queue',
   'Extracts fields from uploaded state forms.',
   'sql_cron', 'process-document-analyzer-jobs',
   interval '5 minutes', interval '30 minutes', true, 'automatic', '/admin/system-jobs'),

  ('organization-export-jobs', 'Organization export queue',
   'Builds queued organization data exports.',
   'sql_cron', 'process-organization-export-jobs',
   interval '15 minutes', interval '1 hour', true, 'automatic', '/admin/system-jobs'),

  -- The watchdog itself -------------------------------------------------------------------------
  -- Registered so the watchdog watches the watchdog. Without this row, the one job whose failure
  -- suppresses every other job's alerting was the only one nothing could report on.
  ('system-job-watchdog', 'System job watchdog',
   'Emits stale-job events for critical jobs past their freshness SLA.',
   'sql_cron', 'system-job-last-success-watchdog',
   interval '5 minutes', interval '30 minutes', true, 'automatic', '/admin/system-jobs'),

  -- Deliberately NOT critical -------------------------------------------------------------------
  -- Registered for visibility on /admin/system-jobs, but their silence is either self-evident to the
  -- people expecting the output, or carries no care/compliance consequence. Marking these critical
  -- would add noise to the page operators must trust when something real breaks.
  ('billing-quantity-sync-cron', 'Billing quantity sync',
   'Syncs seat quantities to the billing provider; discrepancies also surface on the billing screens.',
   'sql_cron', 'billing-quantity-sync',
   interval '1 hour', interval '3 hours', false, 'automatic', '/admin/system-jobs'),

  ('survey-day-session-expiry', 'Survey Day session expiry',
   'Closes Survey Day sessions left open. A stale open session is visible in the workspace itself.',
   'sql_cron', 'expire-stale-survey-day-sessions',
   interval '15 minutes', interval '2 hours', false, 'automatic', '/admin/system-jobs'),

  ('regulatory-update-polling', 'Regulatory update polling',
   'Polls for published regulatory changes. Weekly cadence; staleness is visible on the citation library.',
   'sql_cron', 'poll-regulatory-updates-weekly',
   interval '7 days', interval '16 days', false, 'manual', '/admin/system-jobs'),

  ('carebase-report-subscriptions', 'Scheduled report delivery',
   'Delivers subscribed CareBase reports. A missing report is noticed by the person expecting it.',
   'sql_cron', 'process-carebase-report-subscriptions',
   interval '15 minutes', interval '2 hours', false, 'automatic', '/admin/system-jobs'),

  ('public-demo-baseline-restore', 'Public demo baseline restore',
   'Resets the public demo playground. Affects the demo tenant only.',
   'sql_cron', 'restore-public-demo-baseline',
   interval '1 day', interval '3 days', false, 'automatic', '/admin/system-jobs')

on conflict (job_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  cron_job_name = excluded.cron_job_name,
  expected_interval = excluded.expected_interval,
  freshness_sla = excluded.freshness_sla,
  is_critical = excluded.is_critical,
  retry_mode = excluded.retry_mode,
  operator_route = excluded.operator_route,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- The ratchet
-- ---------------------------------------------------------------------------

-- Reports scheduled cron jobs that no definition row covers. This is what makes the gap a build
-- failure rather than something to rediscover: adding a cron.schedule without a definition means
-- adding a job that neither the watchdog nor the operator page can see, and the accompanying pgTAP
-- suite fails on exactly that.
--
-- Returns rows rather than raising, so the test can name the offending jobs instead of just failing.
create or replace function app_private.unwatched_cron_jobs()
returns table (job_name text)
language sql
stable
set search_path = ''
as $$
  select c.jobname::text
  from cron.job c
  left join app_private.system_job_definitions d on d.cron_job_name = c.jobname
  where d.job_key is null
  order by c.jobname;
$$;
revoke all on function app_private.unwatched_cron_jobs() from public, anon, authenticated, service_role;
