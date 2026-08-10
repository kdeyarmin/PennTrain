-- The durable worker applied completed dry runs.
--
-- Every bulk-import-* validate pass that walks the whole CSV parks its job at 'ready' with all
-- passing rows still 'valid'. That is a preview -- the Data Migration Center advertises it as a
-- no-write dry run, and its Apply button is a separate, deliberate step (disabled outright while
-- the preview has failures). `claim_data_import_jobs` (20260801020100) treated 'ready' and
-- 'applying' identically, so the worker's next sweep applied every one of those previews: an
-- import the manager decided against, or previewed with failures the UI refuses to apply, was
-- written anyway -- across every organization with a job parked at 'ready'.
--
-- Only 'applying' is a stranded apply, the case the worker exists to rescue. A job at 'ready'
-- has by definition not been applied by anyone; it moves to 'applying' the moment a browser
-- apply reports its first chunk through `record_data_import_chunk`, and from then on the worker
-- may take it once its claim expires. A browser apply that dies before its first receipt does
-- leave the job at 'ready' with unreceipted writes -- but re-applying that job's 'valid' rows
-- would duplicate those writes, so 'ready' is not safely claimable in that window either.
--
-- The claimable index narrows to match. Rollback: CREATE OR REPLACE the version from
-- 20260801020100 and rebuild the index with `where status in ('ready', 'applying')`.

drop index if exists public.data_import_jobs_claimable_idx;
create index data_import_jobs_claimable_idx
  on public.data_import_jobs (status, claim_expires_at)
  where status = 'applying';

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
    -- 'applying' only. 'ready' is a completed dry run waiting for a human to press Apply,
    -- not a stranded apply.
    where j.status = 'applying'
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
