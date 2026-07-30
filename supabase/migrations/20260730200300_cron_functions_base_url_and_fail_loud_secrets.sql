-- PT-069 residual: every edge-invoking cron uses a vault-backed functions base URL
-- and fails loudly when cron_shared_secret is missing (no more coalesce(..., '')).
--
-- require_functions_base_url() reads vault secret `supabase_functions_base_url`,
-- then GUC app.functions_base_url, then the production project URL as last resort
-- so existing production keeps working if vault is not yet seeded. Staging/preview
-- MUST seed the vault secret to their own project URL before enabling crons:
--   select vault.create_secret('https://<ref>.supabase.co', 'supabase_functions_base_url');

create or replace function app_private.require_functions_base_url()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select nullif(btrim(decrypted_secret), '') into v_url
  from vault.decrypted_secrets
  where name = 'supabase_functions_base_url'
  limit 1;

  if v_url is null then
    begin
      v_url := nullif(btrim(current_setting('app.functions_base_url', true)), '');
    exception when others then
      v_url := null;
    end;
  end if;

  -- Last-resort production default. Non-production environments must override
  -- via vault; otherwise crons would hit the wrong project (loud 401s).
  if v_url is null then
    v_url := 'https://xsqobvvreaovwibxwyvv.supabase.co';
  end if;

  return rtrim(v_url, '/');
end;
$$;

revoke all on function app_private.require_functions_base_url() from public, anon, authenticated;

-- Seed vault when missing (does not overwrite an existing secret).
do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'supabase_functions_base_url'
  ) then
    perform vault.create_secret(
      'https://xsqobvvreaovwibxwyvv.supabase.co',
      'supabase_functions_base_url'
    );
  end if;
exception when others then
  -- Vault extension / permissions may be absent on local stacks that do not
  -- run crons; the helper still falls back to the production default / GUC.
  raise notice 'Could not seed supabase_functions_base_url vault secret: %', sqlerrm;
end;
$$;

-- Helper: alter one job by name if it exists (idempotent across envs that
-- never scheduled a particular job).
create or replace function app_private.alter_cron_job_if_exists(
  p_jobname text,
  p_command text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = p_jobname;
  if v_jobid is null then
    return;
  end if;
  perform cron.alter_job(job_id := v_jobid, command := p_command);
end;
$$;

revoke all on function app_private.alter_cron_job_if_exists(text, text) from public, anon, authenticated;

select app_private.alter_cron_job_if_exists(
  'billing-quantity-sync',
  $cron$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/sync-billing-quantities',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Correlation-Id', gen_random_uuid()::text,
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := jsonb_build_object('batchSize', 50, 'maxRuntimeMs', 110000)
     ); $cron$
);

select app_private.alter_cron_job_if_exists(
  'send-regulatory-digest-weekly',
  $cron$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/send-regulatory-digest',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Correlation-Id', gen_random_uuid()::text,
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := jsonb_build_object('recipientCap', 500, 'maxRuntimeMs', 110000)
     ); $cron$
);

select app_private.alter_cron_job_if_exists(
  'dispatch-notification-deliveries',
  $cron$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/dispatch-notifications',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Correlation-Id', gen_random_uuid()::text,
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := '{}'::jsonb
     ); $cron$
);

select app_private.alter_cron_job_if_exists(
  'monthly-exclusion-screening',
  $cron$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/screen-exclusions',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := jsonb_build_object('correlationId', gen_random_uuid())
     ); $cron$
);

select app_private.alter_cron_job_if_exists(
  'poll-heygen-video-statuses',
  $cron$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/poll-heygen-video-statuses',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Correlation-Id', gen_random_uuid()::text,
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := '{}'::jsonb
     ); $cron$
);

select app_private.alter_cron_job_if_exists(
  'process-certificate-pdf-jobs',
  $cron$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/generate-certificate-pdf',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := jsonb_build_object('batchSize', 10)
     ); $cron$
);

select app_private.alter_cron_job_if_exists(
  'process-binder-export-jobs',
  $cron$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/generate-compliance-binder',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := jsonb_build_object('batchSize', 2)
     ); $cron$
);

select app_private.alter_cron_job_if_exists(
  'process-document-analyzer-jobs',
  $cron$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/analyze-state-form',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := jsonb_build_object('batchSize', 2)
     ); $cron$
);

select app_private.alter_cron_job_if_exists(
  'integration-webhook-dispatch',
  $cron$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/dispatch-integration-webhooks',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Correlation-Id', gen_random_uuid()::text,
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := jsonb_build_object('batchSize', 50)
     ); $cron$
);

select app_private.alter_cron_job_if_exists(
  'poll-regulatory-updates-weekly',
  $cron$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/poll-regulatory-updates',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Correlation-Id', gen_random_uuid()::text,
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := '{}'::jsonb
     ); $cron$
);

select app_private.alter_cron_job_if_exists(
  'run-data-lifecycle-nightly',
  $cron$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/run-data-lifecycle',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Correlation-Id', gen_random_uuid()::text,
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := '{}'::jsonb
     ); $cron$
);

select app_private.alter_cron_job_if_exists(
  'process-organization-export-jobs',
  $cron$ select net.http_post(
       url := app_private.require_functions_base_url() || '/functions/v1/process-organization-export-jobs',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := '{}'::jsonb
     ); $cron$
);

drop function if exists app_private.alter_cron_job_if_exists(text, text);
