select cron.schedule(
  'recalculate-compliance-nightly',
  '0 6 * * *',
  $$ select public.recalculate_all_compliance(); $$
);
