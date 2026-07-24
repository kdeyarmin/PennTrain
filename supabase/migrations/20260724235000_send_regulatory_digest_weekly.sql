-- PT-064 (remaining slice): actually send the promised regulatory-update digest.
--
-- The marketing site and welcome email promise newsletter subscribers "periodic
-- plain-language digests" of the public regulatory_updates feed, but nothing has
-- ever sent one. This migration wires the new send-regulatory-digest Edge
-- Function into the shared system-jobs control plane and schedules it weekly:
--
--   1. Registers the 'regulatory-digest-send' job definition so every run is
--      durably tracked (claim_system_job_execution / finish_system_job), shows
--      up in the admin control plane with a freshness SLA, and can be re-run by
--      an operator.
--   2. Adds get_regulatory_digest_state(): the sender's durable watermark and
--      resume cursor are the `digestState` object recorded in the last
--      successful run's result. system_job_runs lives in app_private, which
--      PostgREST does not expose, so the worker's service-role client reads it
--      through this definer RPC instead of querying the table directly.
--   3. Schedules the weekly cron invocation -- Monday 14:00 UTC, i.e. Monday
--      morning US Eastern, two hours after the in-app send-monday-digest job so
--      the two Monday sends do not compete -- using the fail-loudly vault
--      secret helper app_private.require_cron_shared_secret() added by
--      20260724200000 (a missing secret fails the run in cron.job_run_details
--      instead of sending an empty header the function 401s forever).

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values (
  'regulatory-digest-send',
  'Regulatory digest send',
  'Emails the weekly regulatory-update digest to subscribed newsletter recipients',
  'edge_cron',
  'send-regulatory-digest-weekly',
  interval '7 days', interval '8 days', false, 'manual', '/admin/system-jobs'
)
on conflict (job_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  execution_kind = excluded.execution_kind,
  cron_job_name = excluded.cron_job_name,
  expected_interval = excluded.expected_interval,
  freshness_sla = excluded.freshness_sla,
  is_critical = excluded.is_critical,
  retry_mode = excluded.retry_mode,
  operator_route = excluded.operator_route,
  updated_at = now();

-- Durable digest watermark: the digestState jsonb recorded by the most recent
-- successful (fully or partially delivered) run of the digest job. Returns NULL
-- when no run has recorded state yet; the worker then falls back to a bounded
-- first-run lookback. Failed runs are ignored on purpose -- they record the
-- pre-run state only for debugging, and reading it would be equivalent, but the
-- succeeded/partial filter keeps the contract crisp: state advances only when a
-- run delivered something (or verified there was nothing to deliver).
create or replace function public.get_regulatory_digest_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select r.result->'digestState'
  from app_private.system_job_runs r
  where r.job_key = 'regulatory-digest-send'
    and r.status in ('succeeded', 'partial')
    and r.result ? 'digestState'
  order by r.finished_at desc
  limit 1;
$function$;

revoke all on function public.get_regulatory_digest_state() from public, anon, authenticated;
grant execute on function public.get_regulatory_digest_state() to service_role;

-- The hard-coded functions base URL below intentionally follows the convention
-- every sibling cron job in this project uses; making the URL per-environment
-- (vault-seeded) across all jobs is tracked separately in PT-069's remaining
-- slice.
select cron.unschedule('send-regulatory-digest-weekly')
where exists (
  select 1 from cron.job where jobname = 'send-regulatory-digest-weekly'
);

select cron.schedule(
  'send-regulatory-digest-weekly',
  '0 14 * * 1',
  $cron$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/send-regulatory-digest',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Correlation-Id', gen_random_uuid()::text,
         'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
       ),
       body := jsonb_build_object('recipientCap', 500, 'maxRuntimeMs', 110000)
     ); $cron$
);
