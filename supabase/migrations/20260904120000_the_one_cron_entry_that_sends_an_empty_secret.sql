-- The one cron entry that reads the shared secret its own way, and sends an empty one when
-- that fails.
--
-- THE FINDING. Sixteen active cron entries call an Edge Function through net.http_post. Fifteen
-- resolve the URL with `app_private.require_functions_base_url()` and the header with
-- `app_private.require_cron_shared_secret()`, both introduced by 20260730200300 so that a
-- missing vault secret fails the cron run loudly instead of sending a request that cannot
-- authenticate. `process-credential-renewals`, scheduled one day later by 20260731240000, does
-- neither: it hard-codes the production project host and reads the vault directly behind
-- `coalesce(..., '')`. When that read returns nothing, the request goes out carrying an empty
-- `X-CareMetric-Cron-Secret`, the function answers 401, and pg_cron records the tick as
-- `succeeded` because the request was enqueued.
--
-- Observed on production on 2026-09-04: 144 ticks in 24 hours, 141 answered 200 and 3 answered
-- 401 (07:10, 12:40, 14:10 UTC). The three are invisible to every operator surface -- the job's
-- definition is `sql_cron`, its ledger is pg_cron's exit status, and `last_known_good_at` has
-- never been set -- so a run of empty-secret ticks would look identical to a healthy day. The
-- hard-coded host is the second half: it makes this the only cron entry that is wrong on every
-- deployment except the one it names, and would silently call production from a staging stack.
--
-- WHAT THIS DOES. Reschedules the entry through the two helpers, same name, same schedule, same
-- body. `require_cron_shared_secret()` raises when the vault row is missing or empty, so the
-- failure mode moves from "an unauthenticated request nobody sees" to "a failed cron run", which
-- is the mode the other fifteen already have. Nothing else changes: the Edge Function's own
-- check (`requireCronRequest`) is untouched and still refuses a wrong or empty secret.
--
-- The three intermittent empty reads are not explained by this file and are recorded in BACKLOG
-- Tier I: on a stack where the vault row exists, a `coalesce` fallback should never have fired,
-- and after this migration the same condition will surface as a visible cron failure instead of
-- a 401 in a log stream nobody reads.
--
-- Rollback: reschedule with the previous command (20260731240000, section 3). No reason to.

select cron.unschedule('process-credential-renewals')
where exists (select 1 from cron.job where jobname = 'process-credential-renewals');

select cron.schedule(
  'process-credential-renewals',
  '*/10 * * * *',
  $$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/process-credential-renewals',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := '{}'::jsonb
     ); $$
);
