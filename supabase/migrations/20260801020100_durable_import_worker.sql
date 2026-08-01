-- Durable import worker (BACKLOG D3) — claim/release for ready jobs.
-- Rows already live in data_import_rows; this prevents stranded browser applies.

alter table public.data_import_jobs
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text,
  add column if not exists claim_expires_at timestamptz;

create index if not exists data_import_jobs_claimable_idx
  on public.data_import_jobs (status, claim_expires_at)
  where status in ('ready', 'applying');

create or replace function public.claim_data_import_jobs(
  p_limit integer default 1,
  p_claim_seconds integer default 300
)
returns setof public.data_import_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 1), 10));
  v_seconds integer := greatest(60, least(coalesce(p_claim_seconds, 300), 1800));
begin
  if auth.role() is distinct from 'service_role' and not public.is_platform_admin() then
    raise exception 'Not authorized to claim import jobs' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select j.id
    from public.data_import_jobs j
    where j.status in ('ready', 'applying')
      and (j.claim_expires_at is null or j.claim_expires_at < now())
    order by j.created_at asc
    limit v_limit
    for update skip locked
  ),
  updated as (
    update public.data_import_jobs j
    set
      status = 'applying',
      claimed_at = now(),
      claimed_by = coalesce(auth.uid()::text, 'worker'),
      claim_expires_at = now() + make_interval(secs => v_seconds),
      started_at = coalesce(j.started_at, now()),
      updated_at = now()
    from candidates c
    where j.id = c.id
    returning j.*
  )
  select * from updated;
end;
$$;

revoke all on function public.claim_data_import_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_data_import_jobs(integer, integer) to service_role;

create or replace function public.release_data_import_job_claim(
  p_job_id uuid,
  p_status text default null,
  p_last_error text default null
)
returns public.data_import_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.data_import_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' and not public.is_platform_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.data_import_jobs set
    claimed_at = null,
    claimed_by = null,
    claim_expires_at = null,
    status = coalesce(nullif(btrim(p_status), ''), status),
    last_error = coalesce(p_last_error, last_error),
    updated_at = now()
  where id = p_job_id
  returning * into v;

  if not found then
    raise exception 'Import job not found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

revoke all on function public.release_data_import_job_claim(uuid, text, text) from public, anon, authenticated;
grant execute on function public.release_data_import_job_claim(uuid, text, text) to service_role;
