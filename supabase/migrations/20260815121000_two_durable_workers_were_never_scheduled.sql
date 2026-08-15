-- Two shipped queue drains had producers but no schedule, so their queues only ever grew.
--
-- process-data-import-jobs is the durable-import rescue worker: a closed browser tab strands
-- an import job in "applying" with written-but-unreceipted rows, and this worker exists to
-- claim the stranded job once its 5-minute lease lapses and finish it. It had dedicated
-- SECURITY DEFINER apply RPCs (20260801220000) and a claim protocol -- and no caller: no
-- cron.schedule, no run-system-job registry entry, no frontend invocation. Every stranded
-- import stayed stranded forever while the UI showed "applying".
--
-- fhir-writeback is the outbound clinical-observation drain. The UI queues rows through
-- queue_clinical_observation_writeback (useClinicalObservations), and the function's own
-- header says "Enable delivery by scheduling this function" -- which never happened. Rows
-- landed 'pending' and no observation ever reached the partner EHR.
--
-- Both get the modern cron posture (fail-loud base URL + shared secret helpers from
-- 20260730200300, correlation id per tick) and a system_job_definitions row so the watchdog
-- notices silence instead of calling an idle queue healthy.

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'process-durable-data-imports';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'process-durable-data-imports',
    '*/5 * * * *',
    $cron$ select net.http_post(
         url := app_private.require_functions_base_url() || '/functions/v1/process-data-import-jobs',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'X-Correlation-Id', gen_random_uuid()::text,
           'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
         ),
         body := jsonb_build_object('limit', 3)
       ); $cron$
  );

  select jobid into v_job_id from cron.job where jobname = 'drain-fhir-writeback-queue';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'drain-fhir-writeback-queue',
    '*/5 * * * *',
    $cron$ select net.http_post(
         url := app_private.require_functions_base_url() || '/functions/v1/fhir-writeback',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'X-Correlation-Id', gen_random_uuid()::text,
           'X-CareMetric-Cron-Secret', app_private.require_cron_shared_secret()
         ),
         body := '{}'::jsonb
       ); $cron$
  );
end
$$;

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values
  ('durable-data-import-worker', 'Durable data import worker',
   'Claims data-import jobs stranded mid-apply (a closed browser tab) once their lease '
   'lapses and finishes applying their validated rows. Silence here means stuck imports '
   'that report "applying" forever.',
   'edge_cron', 'process-durable-data-imports',
   interval '5 minutes', interval '30 minutes', true, 'automatic', '/admin/system-jobs'),
  ('fhir-writeback-drain', 'FHIR write-back drain',
   'Delivers queued clinical observation write-backs to connected FHIR servers. Silence '
   'here means observations recorded in CareBase never reach the partner EHR.',
   'edge_cron', 'drain-fhir-writeback-queue',
   interval '5 minutes', interval '30 minutes', true, 'automatic', '/admin/system-jobs')
on conflict (job_key) do nothing;
