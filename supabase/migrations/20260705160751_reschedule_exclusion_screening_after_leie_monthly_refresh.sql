-- OIG LEIE is refreshed monthly, historically by the 10th -- move the schedule later in the
-- month (was day 3) so the job reliably pulls the current month's fresh file instead of
-- occasionally re-ingesting last month's.
select cron.schedule(
  'monthly-exclusion-screening',
  '0 5 12 * *',
  $$
    select net.http_post(
      url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/screen-exclusions',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb
    );
  $$
);
