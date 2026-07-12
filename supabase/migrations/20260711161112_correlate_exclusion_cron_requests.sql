-- Generate one correlation UUID when pg_cron enqueues the monthly HTTP request. pg_net retains
-- that body for transport retries, allowing the Edge Function and both source refreshes to resume
-- the same logical job safely instead of duplicating snapshots.
select cron.unschedule('monthly-exclusion-screening')
where exists (select 1 from cron.job where jobname = 'monthly-exclusion-screening');

select cron.schedule(
  'monthly-exclusion-screening',
  '0 5 12 * *',
  $$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/screen-exclusions',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-CareMetric-Cron-Secret', coalesce(
           (select decrypted_secret
            from vault.decrypted_secrets
            where name = 'cron_shared_secret'
            limit 1),
           ''
         )
       ),
       body := jsonb_build_object('correlationId', gen_random_uuid())
     ); $$
);
