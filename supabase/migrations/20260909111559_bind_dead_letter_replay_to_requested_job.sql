-- A manual replay must dispatch the same job as its original dead letter.
-- Lock and validate before the existing replay RPC can queue or reuse a run;
-- this supports any older dead letter without exposing the private job ledger.
create function public.replay_system_job_dead_letter_for_job(
  p_run_id uuid,
  p_job_key text,
  p_reason text
)
returns table (run_id uuid, correlation_id text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job_key text;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only platform_admin may replay dead letters' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'A meaningful replay reason is required' using errcode = '22023';
  end if;

  select r.job_key into v_job_key
  from app_private.system_job_runs r
  where r.id = p_run_id and r.dead_lettered_at is not null
  for update;
  if not found then
    raise exception 'Dead-lettered run not found' using errcode = 'P0002';
  end if;
  if v_job_key is distinct from p_job_key then
    raise exception 'Dead-lettered run does not belong to the requested job' using errcode = '22023';
  end if;

  -- The original RPC retains session/role checks, reason validation, canonical
  -- replay reuse, kill switches, circuit state, and audit writes in this transaction.
  return query
  select replay.run_id, replay.correlation_id
  from public.replay_system_job_dead_letter(p_run_id, p_reason) replay;
end;
$function$;

revoke all on function public.replay_system_job_dead_letter_for_job(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.replay_system_job_dead_letter_for_job(uuid, text, text)
  to authenticated;
