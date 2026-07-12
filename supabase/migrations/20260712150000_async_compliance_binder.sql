-- Asynchronous compliance binder exports (END_USER_REVIEW.md recommendation #7).
--
-- The compliance binder was generated synchronously inside a single edge-function
-- request: the whole org was queried and the PDF rendered before anything returned,
-- risking the edge wall-clock limit on large organizations and giving the requester no
-- progress feedback. Binder generation now follows the certificate-PDF worker pattern:
-- a durable binder_export_jobs queue (this table IS the user-visible artifact record --
-- binders previously had no owning row at all, only a storage object), a caller-
-- authorized enqueue RPC, service-role claim/finish worker RPCs with stale-lease
-- reclaim and exponential backoff, a 5-minute cron that drives the edge worker, and an
-- operational-control-plane registration. The edge function keeps a user path that
-- signs a finished job's PDF for download.

create table public.binder_export_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  -- Empty array = org-wide. Facility scope is resolved and validated at enqueue time
  -- (facility_manager assignments, or an org_admin/auditor narrowing) so the worker
  -- only ever applies it.
  facility_ids uuid[] not null default '{}'::uuid[],
  correlation_id uuid not null default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  current_run_id uuid,
  worker_id uuid,
  requested_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_started_at timestamptz,
  completed_at timestamptz,
  storage_bucket text,
  storage_path text,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint binder_export_jobs_processing_consistency_check check (
    status <> 'processing'
    or (current_run_id is not null and worker_id is not null and locked_at is not null)
  ),
  constraint binder_export_jobs_succeeded_storage_check check (
    status <> 'succeeded'
    or (storage_bucket is not null and storage_path is not null)
  )
);

create index binder_export_jobs_claim_idx
  on public.binder_export_jobs (available_at, requested_at)
  where status in ('pending', 'failed');
create index binder_export_jobs_stale_idx
  on public.binder_export_jobs (locked_at)
  where status = 'processing';
create index binder_export_jobs_org_created_idx
  on public.binder_export_jobs (organization_id, requested_at desc);

create trigger set_updated_at before update on public.binder_export_jobs
  for each row execute function public.set_updated_at();

alter table public.binder_export_jobs enable row level security;

-- The async download path treats visibility of a binder_export_jobs row as the proof that
-- the caller may sign and download its PDF, so this policy must not be wider than the old
-- synchronous flow's auto-scoping. org_admin/auditor are org-wide reporting roles and see
-- the whole org queue; a facility_manager sees only exports they requested or whose facility
-- scope is entirely within their assigned facilities -- never an org-wide (empty scope) or
-- other-facility export.
create policy binder_export_jobs_select on public.binder_export_jobs
for select to authenticated using (
  (select public.is_platform_admin())
  or (
    organization_id = (select public.current_org_id())
    and (
      (select public.current_role()) in ('org_admin', 'auditor')
      or (
        (select public.current_role()) = 'facility_manager'
        and (
          requested_by = (select auth.uid())
          or (
            cardinality(facility_ids) > 0
            and facility_ids <@ (
              select coalesce(array_agg(fa.facility_id), '{}'::uuid[])
              from public.facility_assignments fa
              join public.facilities f on f.id = fa.facility_id
              where fa.profile_id = (select auth.uid())
                and f.organization_id = (select public.current_org_id())
            )
          )
        )
      )
    )
  )
);

revoke all on table public.binder_export_jobs from public, anon, authenticated, service_role;
grant select on table public.binder_export_jobs to authenticated;
grant all on table public.binder_export_jobs to service_role;

-- ---------------------------------------------------------------------------
-- Enqueue (caller-authorized; mirrors the edge function's previous auth model)
-- ---------------------------------------------------------------------------

create or replace function public.request_binder_export(
  p_organization_id uuid default null,
  p_facility_ids uuid[] default null
)
returns public.binder_export_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_org uuid;
  v_scope uuid[] := '{}'::uuid[];
  v_job public.binder_export_jobs%rowtype;
begin
  select p.* into v_profile from public.profiles p where p.id = auth.uid();
  if v_profile.id is null or not v_profile.is_active
     or v_profile.role not in ('platform_admin', 'org_admin', 'facility_manager', 'auditor') then
    raise exception 'Binder export is outside caller scope' using errcode = '42501';
  end if;

  if v_profile.role = 'platform_admin' then
    v_org := coalesce(p_organization_id, v_profile.organization_id);
  else
    v_org := v_profile.organization_id;
  end if;
  if v_org is null or not exists (select 1 from public.organizations o where o.id = v_org) then
    raise exception 'A valid organization is required' using errcode = '22023';
  end if;

  if v_profile.role = 'facility_manager' then
    -- Managers are always auto-scoped to their assigned facilities.
    select coalesce(array_agg(fa.facility_id), '{}'::uuid[]) into v_scope
    from public.facility_assignments fa
    join public.facilities f on f.id = fa.facility_id
    where fa.profile_id = v_profile.id and f.organization_id = v_org;
    if coalesce(array_length(v_scope, 1), 0) = 0 then
      raise exception 'No facility assignments found for this manager' using errcode = '42501';
    end if;
  elsif p_facility_ids is not null and coalesce(array_length(p_facility_ids, 1), 0) > 0 then
    select coalesce(array_agg(distinct f.id), '{}'::uuid[]) into v_scope
    from public.facilities f
    where f.id = any(p_facility_ids) and f.organization_id = v_org;
    if coalesce(array_length(v_scope, 1), 0) <> (select count(distinct u) from unnest(p_facility_ids) u) then
      raise exception 'Facility scope does not belong to the organization' using errcode = '22023';
    end if;
  end if;

  -- One active export per requester per organization and scope: repeated clicks return
  -- the in-flight job instead of stacking duplicate renders, while a request with a
  -- different facility scope still starts its own export.
  select j.* into v_job
  from public.binder_export_jobs j
  where j.organization_id = v_org
    and j.requested_by = v_profile.id
    and j.facility_ids = v_scope
    and j.status in ('pending', 'processing')
  order by j.requested_at desc
  limit 1;
  if v_job.id is not null then
    return v_job;
  end if;

  insert into public.binder_export_jobs (organization_id, requested_by, facility_ids)
  values (v_org, v_profile.id, v_scope)
  returning * into v_job;
  return v_job;
end;
$function$;
revoke all on function public.request_binder_export(uuid, uuid[])
  from public, anon;
grant execute on function public.request_binder_export(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Worker claim / finish (service_role only; mirrors the certificate PDF worker)
-- ---------------------------------------------------------------------------

create or replace function public.claim_binder_export_jobs(
  p_worker_id uuid,
  p_job_id uuid default null,
  p_limit integer default 1
)
returns table (
  job_id uuid,
  organization_id uuid,
  facility_ids uuid[],
  correlation_id uuid,
  run_id uuid,
  attempt_count integer,
  requested_by uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_limit < 1 or p_limit > 10 then
    raise exception 'p_limit must be between 1 and 10' using errcode = 'invalid_parameter_value';
  end if;

  return query
  with candidates as (
    select j.id
    from public.binder_export_jobs j
    where (p_job_id is null or j.id = p_job_id)
      and j.attempt_count < j.max_attempts
      and (
        (j.status in ('pending', 'failed') and j.available_at <= now())
        or (j.status = 'processing' and j.locked_at < now() - interval '15 minutes')
      )
    order by j.available_at, j.requested_at
    limit p_limit
    for update of j skip locked
  ), claimed as (
    update public.binder_export_jobs j
    set status = 'processing',
        attempt_count = j.attempt_count + 1,
        current_run_id = gen_random_uuid(),
        worker_id = p_worker_id,
        locked_at = now(),
        last_started_at = now(),
        last_error_code = null,
        last_error_message = null
    from candidates c
    where j.id = c.id
    returning j.id, j.organization_id, j.facility_ids, j.correlation_id, j.current_run_id,
      j.attempt_count, j.requested_by
  )
  select c.id, c.organization_id, c.facility_ids, c.correlation_id, c.current_run_id,
    c.attempt_count, c.requested_by
  from claimed c;
end;
$function$;
revoke all on function public.claim_binder_export_jobs(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_binder_export_jobs(uuid, uuid, integer)
  to service_role;

create or replace function public.finish_binder_export_job(
  p_job_id uuid,
  p_run_id uuid,
  p_bucket text default null,
  p_path text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.binder_export_jobs%rowtype;
  v_success boolean;
  v_retry boolean;
begin
  select j.* into v_job
  from public.binder_export_jobs j
  where j.id = p_job_id
  for update of j;

  if v_job.id is null
     or v_job.status <> 'processing'
     or v_job.current_run_id is distinct from p_run_id then
    return false;
  end if;

  v_success := p_bucket is not null and p_path is not null and p_error_message is null;
  v_retry := not v_success and v_job.attempt_count < v_job.max_attempts;

  if v_success then
    update public.binder_export_jobs
    set status = 'succeeded',
        current_run_id = null,
        worker_id = null,
        locked_at = null,
        completed_at = now(),
        storage_bucket = p_bucket,
        storage_path = p_path,
        last_error_code = null,
        last_error_message = null
    where id = v_job.id;
  else
    update public.binder_export_jobs
    set status = case when v_retry then 'pending' else 'failed' end,
        current_run_id = null,
        worker_id = null,
        locked_at = null,
        available_at = case
          when v_retry then now() + make_interval(secs => least(3600, 30 * (2 ^ greatest(0, v_job.attempt_count - 1))))
          else available_at
        end,
        completed_at = case when v_retry then null else now() end,
        last_error_code = left(coalesce(p_error_code, 'render_failed'), 120),
        last_error_message = left(coalesce(p_error_message, 'Compliance binder generation failed'), 2000)
    where id = v_job.id;
  end if;

  return true;
end;
$function$;
revoke all on function public.finish_binder_export_job(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_binder_export_job(uuid, uuid, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Scheduling + operational registration
-- ---------------------------------------------------------------------------

select cron.schedule(
  'process-binder-export-jobs',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/generate-compliance-binder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-CareMetric-Cron-Secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret' limit 1), '')),
    body := jsonb_build_object('batchSize', 2));
  $$
);

insert into app_private.system_job_definitions (
  job_key,
  display_name,
  description,
  execution_kind,
  cron_job_name,
  expected_interval,
  freshness_sla,
  is_critical,
  retry_mode,
  operator_route
) values (
  'binder-export-generation',
  'Compliance binder exports',
  'Claims, renders, and stores requested compliance binder PDFs',
  'worker',
  null,
  interval '15 minutes',
  interval '30 minutes',
  false,
  'automatic',
  '/admin/system-jobs'
);
