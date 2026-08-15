-- An export job that hard-killed its worker retried every 20 minutes forever -- and blocked
-- the org from ever requesting another export.
--
-- claim_organization_export_jobs' stale-lease branch (status='processing', locked_at older
-- than 20 minutes) carried no attempt_count guard; only the pending/failed branch did. A job
-- whose worker dies before finish_organization_export_job runs -- the reachable case is an
-- isolate OOM on a very large table sweep -- ping-ponged between 'processing' and reclaim
-- indefinitely, attempt_count growing without bound, while request_organization_export
-- refused new requests because a pending/processing job already existed. The org admin was
-- locked out of the feature with no visible failure.
--
-- Two changes: the stale branch honors max_attempts like the other branch, and a pre-sweep
-- finishes over-cap stale jobs as terminally failed (mirroring finish_organization_export_job's
-- failure column posture) so the in-flight uniqueness gate opens and the next request starts
-- fresh.

create or replace function public.claim_organization_export_jobs(
  p_batch_size integer default 2
)
returns table (
  job_id uuid,
  organization_id uuid,
  requested_by uuid,
  lock_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Only the trusted export worker may claim jobs' using errcode = '42501';
  end if;
  if p_batch_size not between 1 and 10 then
    raise exception 'Batch size must be between 1 and 10' using errcode = '22023';
  end if;

  -- A stale job past its attempts budget is finished as failed instead of reclaimed: the
  -- worker it would be handed to has already died on it max_attempts times.
  update public.organization_export_jobs j
  set status = 'failed',
      last_error_code = 'attempts_exhausted',
      last_error_message = 'Export worker was interrupted repeatedly; the job will not be retried automatically. Request a new export.',
      locked_at = null, lock_token = null, updated_at = now()
  where j.status = 'processing'
    and j.locked_at < now() - interval '20 minutes'
    and j.attempt_count >= j.max_attempts;

  return query
  with candidates as (
    select j.id
    from public.organization_export_jobs j
    where (
      (j.status in ('pending','failed') and j.available_at <= now() and j.attempt_count < j.max_attempts)
      or (j.status = 'processing' and j.locked_at < now() - interval '20 minutes'
          and j.attempt_count < j.max_attempts)
    )
    order by j.requested_at
    for update skip locked
    limit p_batch_size
  ), claimed as (
    update public.organization_export_jobs j
    set status = 'processing',
        attempt_count = j.attempt_count + 1,
        locked_at = now(),
        lock_token = extensions.gen_random_uuid(),
        last_error_code = null,
        last_error_message = null,
        updated_at = now()
    from candidates c where j.id = c.id
    returning j.*
  )
  select c.id, c.organization_id, c.requested_by, c.lock_token, c.attempt_count
  from claimed c;
end;
$function$;

revoke all on function public.claim_organization_export_jobs(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_organization_export_jobs(integer) to service_role;
