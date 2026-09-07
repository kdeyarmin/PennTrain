/**
 * What /admin/system-jobs tells an operator about a job's kill switch before they flip it
 * (BACKLOG.md J78).
 *
 * HOW THE TRUTH WAS ESTABLISHED, from the SQL rather than from the column name.
 * `kill_switch_enabled` is read in exactly one place: `public.claim_system_job_execution`
 * (`20260711162509_phase1_operational_recovery.sql:596-598`), which raises 55000 "System job is
 * disabled" before any run is claimed. So the switch stops a job exactly when that job's worker
 * claims -- and TWO kinds of worker do: the SQL wrapper `execute_registered_sql_job`
 * (`20260905240000:57-60`), and every Edge Function, which calls `claim_system_job_execution` over
 * its service-role client as its first act and answers 5xx when the claim raises (e.g.
 * `supabase/functions/dispatch-notifications/index.ts:359-371`).
 *
 * The old predicate saw only the first. `app_private.kill_switch_can_stop_job` asked whether the
 * definition's CRON COMMAND mentioned `execute_registered_sql_job`, which is true of the SQL jobs
 * alone, so this console printed "Disable will not stop this job" over the fourteen Edge jobs
 * whose switch does stop them -- notification dispatch and certificate rendering among them.
 * `20260906170000_a_kill_switch_the_console_called_dead.sql` replaced the inference with a recorded
 * fact, `system_job_definitions.claims_before_running`, so the RPC's `kill_switch_can_stop` is now
 * the honest answer and this module simply reads it. Nothing here second-guesses that column: a
 * hardcoded client-side list of claiming workers would go stale the moment a future worker is
 * registered `claims_before_running = false`, which is the failure this row is about.
 *
 * Today exactly one definition answers false: `system-job-watchdog`, whose cron entry deliberately
 * keeps its own `select public.run_system_job_watchdog();` statement, because a control plane where
 * one switch silences every other job's monitoring is a worse object than a watchdog that cannot be
 * switched off (`20260905240000:29-33`).
 */

/** The control-plane fields this module reads. */
export interface KillSwitchJobLike {
  kill_switch_enabled: boolean;
  /**
   * `app_private.kill_switch_can_stop_job` -- whether this job's worker claims a run, which is
   * where the switch is read.
   */
  kill_switch_can_stop: boolean;
}

/** True when flipping this job's kill switch actually stops the work. */
export function killSwitchStopsJob(job: KillSwitchJobLike): boolean {
  return job.kill_switch_can_stop === true;
}

/** Short badge label for a switch that cannot act, or null when it can. */
export function killSwitchBadgeLabel(job: KillSwitchJobLike): string | null {
  return killSwitchStopsJob(job) ? null : "Kill switch inert";
}

/**
 * The operator-facing warning for a job whose switch cannot act, or null when it can.
 *
 * The reason is stated as what is actually true -- the job never claims a run, which is the only
 * place the switch is read -- not as the old "does not route through the SQL wrapper", which was
 * both the wrong test and the wrong explanation.
 */
export function killSwitchDeadNotice(job: KillSwitchJobLike): string | null {
  if (killSwitchStopsJob(job)) return null;
  return job.kill_switch_enabled
    ? "Marked disabled, but this job keeps running: its schedule never claims a run, and claiming is the only place the switch is read. Stop it at its own console."
    : "Disabling this job records the intent but will not stop it: its schedule never claims a run, and claiming is the only place the switch is read.";
}

/** Hover text for the Disable/Enable control -- the same fact, short enough for a tooltip. */
export function killSwitchButtonTitle(job: KillSwitchJobLike): string | undefined {
  return killSwitchStopsJob(job)
    ? undefined
    : "This job never claims a run, so the switch records intent without stopping it.";
}

/**
 * Why a job offers no "Run now", or null when it does (BACKLOG.md J82).
 *
 * `request_system_job_rerun` refuses `retry_mode = 'none'` outright
 * (`20260711162509_phase1_operational_recovery.sql:857-858`), so the control is correctly absent --
 * but the cell said nothing at all whenever the job had a recovery row, which is every job the
 * console can act on. The watchdog was registered `retry_mode = 'automatic'` until
 * `20260906170000`, so instead of being absent the button queued a run that
 * `execute_registered_sql_job` had no arm for; it raised 22023 and the wrapper's own handler wrote
 * a durable FAILED run against the one job whose purpose is judging the others.
 */
export function manualRunUnavailableReason(job: { retry_mode: string }): string | null {
  return job.retry_mode === "none"
    ? "Runs on its own schedule; a manual re-run is not a meaningful action for it."
    : null;
}
