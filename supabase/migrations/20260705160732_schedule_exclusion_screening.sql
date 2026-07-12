select cron.schedule(
  'monthly-exclusion-screening',
  '0 5 3 * *',
  $$
    select net.http_post(
      url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/screen-exclusions',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb
    );
  $$
);
