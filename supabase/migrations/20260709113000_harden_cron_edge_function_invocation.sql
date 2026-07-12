-- Harden cron-invoked Edge Functions that must keep verify_jwt=false because pg_net cannot send
-- a user JWT. Store the same random value in both places before this migration reaches prod:
--
--   select vault.create_secret('<random-32+-byte-secret>', 'cron_shared_secret');
--   supabase secrets set CRON_SHARED_SECRET='<same-random-secret>'
--
-- The Edge Functions reject requests missing X-CareMetric-Cron-Secret, and pg_cron reads the
-- matching value from Supabase Vault at execution time so the secret never lives in source.
create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule('dispatch-notification-deliveries')
where exists (select 1 from cron.job where jobname = 'dispatch-notification-deliveries');

select cron.schedule(
  'dispatch-notification-deliveries',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/dispatch-notifications',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-CareMetric-Cron-Secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret' limit 1), '')
       ),
       body := '{}'::jsonb
     ); $$
);

select cron.unschedule('monthly-exclusion-screening')
where exists (select 1 from cron.job where jobname = 'monthly-exclusion-screening');

select cron.schedule(
  'monthly-exclusion-screening',
  '0 5 12 * *',
  $$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/screen-exclusions',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-CareMetric-Cron-Secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret' limit 1), '')
       ),
       body := '{}'::jsonb
     ); $$
);

select cron.unschedule('poll-heygen-video-statuses')
where exists (select 1 from cron.job where jobname = 'poll-heygen-video-statuses');

select cron.schedule(
  'poll-heygen-video-statuses',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/poll-heygen-video-statuses',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-CareMetric-Cron-Secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret' limit 1), '')
       ),
       body := '{}'::jsonb
     ); $$
);
