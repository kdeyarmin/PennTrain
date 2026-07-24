-- PT-069: 20260724040534 fixed the billing-quantity-sync cron's NULL URL, but
-- kept `coalesce(vault secret, '')` for the shared cron secret. A missing
-- vault secret therefore sends an empty X-CareMetric-Cron-Secret header and
-- the worker 401s on every run -- the same silent-failure class the URL fix
-- was written to eliminate (the job "runs" green while the function rejects
-- it). Replace the fallback with a helper that raises, so a missing secret
-- shows up as a failed run in cron.job_run_details instead of a silent 401.
--
-- The hard-coded functions base URL below intentionally follows the
-- convention every sibling cron job in this project uses; making the URL
-- per-environment (vault-seeded) across all jobs is tracked separately in
-- PT-069's remaining slice.

create or replace function app_private.require_cron_shared_secret()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_shared_secret'
  limit 1;

  if v_secret is null or v_secret = '' then
    raise exception 'vault secret cron_shared_secret is not configured; seed it before enabling cron-invoked edge functions';
  end if;

  return v_secret;
end;
$$;

revoke all on function app_private.require_cron_shared_secret() from public, anon, authenticated;

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'billing-quantity-sync'),
  command := $cron$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/sync-billing-quantities',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Correlation-Id', gen_random_uuid()::text,
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := jsonb_build_object('batchSize', 50, 'maxRuntimeMs', 110000)
     ); $cron$
);
