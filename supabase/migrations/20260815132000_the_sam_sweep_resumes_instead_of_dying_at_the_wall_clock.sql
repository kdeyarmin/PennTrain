-- The SAM.gov roster sweep resumes at a durable cursor instead of dying at the wall clock.
--
-- screen-exclusions screened every distinct active-employee name in one sequential pass:
-- one SAM.gov query per name, 20s timeout each, no run deadline and no resume point.
-- Somewhere past ~1,000 distinct names the run outlives the edge-function wall clock (and
-- api.data.gov's hourly key quota), the isolate is killed mid-loop, and the refresh run
-- stays 'staging' forever while every monthly attempt hits the same wall -- SAM screening
-- silently frozen on the last good snapshot, failing safe but never self-correcting.
--
-- The worker now sweeps under an explicit deadline in a deterministic name order, stages
-- entries per name, and finishes as PARTIAL with a durable cursor when the deadline or the
-- quota (429) arrives. The cursor travels in the exclusion-screening system job's terminal
-- result -- the regulatory digest's exact resume pattern (20260724235000) -- and this
-- function reads the latest one back. Run/snapshot continuity costs no new lifecycle SQL:
-- begin_exclusion_source_refresh already replays the same (correlation_id, source) into the
-- same staging run and snapshot, so the resuming invocation simply reuses the stored
-- refresh correlation id.
create or replace function public.get_exclusion_sam_sweep_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select r.result->'samSweepState'
  from app_private.system_job_runs r
  -- Both writers: the monthly full run and the hourly continuation tick. Idle continuation
  -- runs deliberately attach no samSweepState, so they never clobber the latest cursor.
  where r.job_key in ('exclusion-screening', 'sam-sweep-continuation')
    and r.status in ('succeeded', 'partial', 'failed', 'cancelled')
    and r.result ? 'samSweepState'
  order by r.finished_at desc
  limit 1;
$function$;

revoke all on function public.get_exclusion_sam_sweep_state() from public, anon, authenticated;
grant execute on function public.get_exclusion_sam_sweep_state() to service_role;

-- Hourly continuation tick, registered as its own watched job: every cron entry must carry
-- a system_job_definitions row (every_scheduled_job_is_watched pins it), and a truthful row
-- means the tick claims a run every hour -- an idle hour is a cheap succeeded {idle:true}
-- run, the same hourly-run-history shape billing-quantity-sync already has. Non-critical:
-- its silence is already covered by the monthly job's own health and the
-- exclusion_source_health staleness view. The hourly cadence is also what turns the
-- api.data.gov hourly quota from a hard wall into pacing: each tick advances the cursor by
-- roughly one quota's worth of names until the sweep completes and activates.
insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values
  ('sam-sweep-continuation', 'SAM sweep continuation',
   'Hourly tick that resumes a SAM.gov exclusion sweep parked at its cursor by the '
   'deadline or the api.data.gov quota. Idles cheaply when no sweep is in progress.',
   'edge_cron', 'resume-sam-exclusion-screening',
   interval '1 hour', interval '3 hours', false, 'none', '/admin/system-jobs')
on conflict (job_key) do nothing;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'resume-sam-exclusion-screening';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'resume-sam-exclusion-screening',
    '30 * * * *',
    $cron$ select net.http_post(
         url := app_private.require_functions_base_url() || '/functions/v1/screen-exclusions',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'X-Correlation-Id', gen_random_uuid()::text,
           'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
         ),
         body := jsonb_build_object('resumeOnly', true, 'maxRuntimeMs', 100000)
       ); $cron$
  );
end
$$;
