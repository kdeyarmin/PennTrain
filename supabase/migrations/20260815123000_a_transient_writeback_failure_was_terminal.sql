-- One 503 from the remote FHIR server permanently stranded a clinical write-back.
--
-- complete_fhir_writeback knew only sent/failed, and claim_fhir_writeback_batch reclaims
-- only 'pending' and stale 'in_flight' rows -- so the first transient provider error
-- (a restart, a timeout, a 429) parked the row at 'failed' forever. The attempts counter
-- and stale-reclaim machinery covered crashed workers but never provider errors, unlike
-- dispatch-integration-webhooks, which retries retryable statuses to an attempts cap.
--
-- The worker now classifies provider failures: retryable ones (network errors, timeouts,
-- 408/429/5xx) return the row to 'pending' for the next cron tick until the attempts cap,
-- and only contract-level rejections (4xx) or exhausted retries land at 'failed'. The
-- 4-argument signature is dropped rather than overloaded so a positional call can never
-- bind ambiguously.

drop function if exists public.complete_fhir_writeback(uuid, boolean, text, text);

create function public.complete_fhir_writeback(
  p_id uuid,
  p_success boolean,
  p_external_resource_id text default null,
  p_error text default null,
  p_retryable boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_max_attempts constant integer := 8;
begin
  update public.fhir_writeback_queue set
    status = case
      when p_success then 'sent'
      when p_retryable and attempts < v_max_attempts then 'pending'
      else 'failed'
    end,
    external_resource_id = coalesce(nullif(btrim(p_external_resource_id), ''), external_resource_id),
    last_error = case when p_success then null else left(coalesce(p_error, 'unknown error'), 500) end,
    sent_at = case when p_success then now() else sent_at end,
    updated_at = now()
  where id = p_id;
end;
$$;

revoke all on function public.complete_fhir_writeback(uuid, boolean, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.complete_fhir_writeback(uuid, boolean, text, text, boolean)
  to service_role;
