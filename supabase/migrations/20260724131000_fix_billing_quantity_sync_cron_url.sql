-- The billing-quantity-sync cron job, scheduled in
-- 20260720205629_configurable_hybrid_subscription_pricing.sql, built its target
-- URL from a vault secret ('supabase_functions_base_url') and a
-- 'app.functions_base_url' database setting, neither of which was ever
-- populated. Every sibling cron job in this project (dispatch-notification-
-- deliveries, process-certificate-pdf-jobs, poll-heygen-video-statuses,
-- monthly-exclusion-screening, integration-webhook-dispatch, ...) instead
-- hardcodes the project's functions base URL directly. Because neither
-- fallback resolved, url evaluated to NULL on every run and
-- net.http_post failed with "null value in column url" on every single
-- invocation since the job was created (confirmed in cron.job_run_details).
--
-- This aligns billing-quantity-sync with the established convention used by
-- every other scheduled job in this project. Looked up by jobname rather than
-- a hardcoded jobid, since job IDs aren't stable across environments.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'billing-quantity-sync'),
  command := $cron$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/sync-billing-quantities',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Correlation-Id', gen_random_uuid()::text,
         'X-CareMetric-Cron-Secret', coalesce(
           (
             select decrypted_secret
             from vault.decrypted_secrets
             where name = 'cron_shared_secret'
             limit 1
           ),
           ''
         )
       ),
       body := jsonb_build_object('batchSize', 50, 'maxRuntimeMs', 110000)
     ); $cron$
);
