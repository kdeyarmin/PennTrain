-- fhir-ingest 202'd bundles into an inbox nothing ever drained.
--
-- A connected EHR posting a Bundle (or a pharmacy posting a medication snapshot through
-- integration-api) got {status:"accepted"} and a durable receipt in
-- app_private.integration_command_receipts -- and that was the end of the story. The apply
-- functions (apply_fhir_integration_command, apply_medication_integration_command) were
-- invoked only by pgTAP tests, so fhir_* clinical tables never populated,
-- last_sync_completed_at never advanced, and run_fhir_integration_freshness_evaluator filed
-- an urgent stale_source exception for every source, endlessly, while the partner believed
-- their data was flowing.
--
-- The drain below claims accepted receipts (and stale 'processing' ones a crashed run left
-- behind) with SKIP LOCKED and calls the matching apply function. Those functions already
-- carry their own contract-validation exception handling -- they mark the receipt
-- 'rejected' and file an integration exception rather than raising -- so the loop's own
-- handler only catches the unexpected, marking that receipt 'dead_letter' instead of
-- wedging the whole drain behind one poison command.

create or replace function app_private.drain_integration_command_inbox(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_applied integer := 0;
  v_rejected integer := 0;
  v_dead integer := 0;
  v_result jsonb;
begin
  for v_row in
    select r.id, r.command_type
    from app_private.integration_command_receipts r
    where r.command_type in ('fhir.bundle.import', 'medication.snapshot.import')
      and (
        r.status = 'accepted'
        or (r.status = 'processing' and r.updated_at < now() - interval '15 minutes')
      )
    order by r.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked
  loop
    begin
      if v_row.command_type = 'fhir.bundle.import' then
        v_result := public.apply_fhir_integration_command(v_row.id);
      else
        v_result := public.apply_medication_integration_command(v_row.id);
      end if;
      if v_result ? 'errorCode' then
        v_rejected := v_rejected + 1;
      else
        v_applied := v_applied + 1;
      end if;
    exception when others then
      update app_private.integration_command_receipts
      set status = 'dead_letter',
          result = jsonb_build_object('errorCode', sqlstate, 'message', left(sqlerrm, 500)),
          updated_at = now()
      where id = v_row.id;
      v_dead := v_dead + 1;
    end;
  end loop;

  return jsonb_build_object('applied', v_applied, 'rejected', v_rejected, 'deadLettered', v_dead);
end;
$$;

revoke all on function app_private.drain_integration_command_inbox(integer)
  from public, anon, authenticated, service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'drain-integration-command-inbox';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'drain-integration-command-inbox',
    '*/5 * * * *',
    'select app_private.drain_integration_command_inbox(20)'
  );
end
$$;

insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, cron_job_name,
  expected_interval, freshness_sla, is_critical, retry_mode, operator_route
) values
  ('integration-command-inbox-drain', 'Integration command inbox drain',
   'Applies accepted FHIR bundle and medication snapshot commands from the partner-facing '
   'integration inbox. Silence here means EHR/pharmacy data is acknowledged but never lands, '
   'and every connected source goes stale.',
   'sql_cron', 'drain-integration-command-inbox',
   interval '5 minutes', interval '30 minutes', true, 'automatic', '/admin/system-jobs')
on conflict (job_key) do nothing;
