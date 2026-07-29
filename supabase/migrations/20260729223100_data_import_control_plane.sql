-- Governed data-import control plane.
--
-- Existing employee CSV import processed rows independently and returned errors only to the browser.
-- There was no durable original-file receipt, preview history, resumability contract, or safe rollback
-- boundary. These generic tables/RPCs are shared by employee, training, credential, resident, room,
-- contact, assessment, and incident importers; the employee Edge Function is the first adopter.

create table public.data_import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete set null,
  domain text not null check (domain in (
    'employees','training_records','credentials','residents','resident_contacts','rooms','assessments','incidents'
  )),
  status text not null default 'uploaded' check (status in (
    'uploaded','mapping','validated','ready','applying','applied','finalized','failed','rolled_back','canceled'
  )),
  original_file_name text not null check (length(original_file_name) between 1 and 255),
  original_file_sha256 text not null check (original_file_sha256 ~ '^[0-9a-f]{64}$'),
  definition_version text not null default '1',
  duplicate_strategy text not null default 'create' check (duplicate_strategy in ('create','skip','update')),
  mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  total_rows integer not null default 0 check (total_rows >= 0 and total_rows <= 100000),
  valid_rows integer not null default 0 check (valid_rows >= 0),
  warning_rows integer not null default 0 check (warning_rows >= 0),
  error_rows integer not null default 0 check (error_rows >= 0),
  applied_rows integer not null default 0 check (applied_rows >= 0),
  skipped_rows integer not null default 0 check (skipped_rows >= 0),
  reverted_rows integer not null default 0 check (reverted_rows >= 0),
  started_at timestamptz,
  applied_at timestamptz,
  finalized_at timestamptz,
  rolled_back_at timestamptz,
  canceled_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_rows + error_rows <= total_rows or total_rows = 0),
  check (applied_rows + skipped_rows <= total_rows or total_rows = 0)
);
create index data_import_jobs_org_idx
  on public.data_import_jobs(organization_id, created_at desc);
create index data_import_jobs_open_hash_idx
  on public.data_import_jobs(organization_id, domain, original_file_sha256, status);

create table public.data_import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.data_import_jobs(id) on delete cascade,
  row_number integer not null check (row_number > 1),
  source_row jsonb not null default '{}'::jsonb check (jsonb_typeof(source_row) = 'object'),
  normalized_row jsonb not null default '{}'::jsonb check (jsonb_typeof(normalized_row) = 'object'),
  proposed_action text not null default 'create' check (proposed_action in ('create','update','skip')),
  status text not null check (status in ('valid','invalid','applied','skipped','failed','reverted')),
  target_table text,
  target_id uuid,
  before_snapshot jsonb,
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  applied_at timestamptz,
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, row_number)
);
create index data_import_rows_job_status_idx
  on public.data_import_rows(job_id, status, row_number);

create table public.data_import_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.data_import_jobs(id) on delete cascade,
  event_type text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index data_import_events_job_idx on public.data_import_events(job_id, created_at);

alter table public.data_import_jobs enable row level security;
alter table public.data_import_rows enable row level security;
alter table public.data_import_events enable row level security;

create policy data_import_jobs_select on public.data_import_jobs
for select to authenticated using (
  public.is_platform_admin()
  or (
    organization_id = public.current_org_id()
    and (
      public.current_role() in ('org_admin','auditor')
      or (public.current_role() = 'facility_manager'
        and (facility_id is null or public.is_assigned_to_facility(facility_id)))
    )
  )
);
create policy data_import_rows_select on public.data_import_rows
for select to authenticated using (
  exists (
    select 1 from public.data_import_jobs j
    where j.id = job_id
      and (
        public.is_platform_admin()
        or (
          j.organization_id = public.current_org_id()
          and (
            public.current_role() in ('org_admin','auditor')
            or (public.current_role() = 'facility_manager'
              and (j.facility_id is null or public.is_assigned_to_facility(j.facility_id)))
          )
        )
      )
  )
);
create policy data_import_events_select on public.data_import_events
for select to authenticated using (
  exists (
    select 1 from public.data_import_jobs j
    where j.id = job_id
      and (
        public.is_platform_admin()
        or (
          j.organization_id = public.current_org_id()
          and (
            public.current_role() in ('org_admin','auditor')
            or (public.current_role() = 'facility_manager'
              and (j.facility_id is null or public.is_assigned_to_facility(j.facility_id)))
          )
        )
      )
  )
);

revoke all on public.data_import_jobs, public.data_import_rows, public.data_import_events
  from public, anon, authenticated;
grant select on public.data_import_jobs, public.data_import_rows, public.data_import_events to authenticated;
grant all on public.data_import_jobs, public.data_import_rows, public.data_import_events to service_role;

create trigger data_import_jobs_updated_at before update on public.data_import_jobs
for each row execute function public.set_updated_at();
create trigger data_import_rows_updated_at before update on public.data_import_rows
for each row execute function public.set_updated_at();
create trigger data_import_jobs_audit after insert or update or delete on public.data_import_jobs
for each row execute function public.audit_log_trigger();
create trigger data_import_rows_audit after insert or update or delete on public.data_import_rows
for each row execute function public.audit_log_trigger();

create or replace function app_private.assert_import_manager(p_job_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_facility uuid;
begin
  if current_user in ('postgres','service_role','supabase_admin') then
    if p_job_id is not null then
      select j.organization_id into v_org from public.data_import_jobs j where j.id = p_job_id;
    end if;
    return v_org;
  end if;

  if public.current_role() not in ('platform_admin','org_admin','facility_manager') then
    raise exception 'Import manager permission required' using errcode = '42501';
  end if;
  if p_job_id is null then
    return public.current_org_id();
  end if;

  select j.organization_id, j.facility_id into v_org, v_facility
  from public.data_import_jobs j where j.id = p_job_id;
  if v_org is null then raise exception 'Import job not found' using errcode = 'P0002'; end if;
  if not public.is_platform_admin()
     and (v_org <> public.current_org_id()
       or (public.current_role() = 'facility_manager'
         and v_facility is not null and not public.is_assigned_to_facility(v_facility))) then
    raise exception 'Import job is outside your scope' using errcode = '42501';
  end if;
  return v_org;
end;
$$;

create or replace function public.start_data_import_job(
  p_domain text,
  p_file_name text,
  p_file_sha256 text,
  p_total_rows integer,
  p_duplicate_strategy text default 'create',
  p_facility_id uuid default null,
  p_organization_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(null);
  v_id uuid;
begin
  if public.is_platform_admin() then v_org := p_organization_id; end if;
  if v_org is null then raise exception 'Organization is required' using errcode = '22023'; end if;
  if p_domain not in ('employees','training_records','credentials','residents','resident_contacts','rooms','assessments','incidents') then
    raise exception 'Unsupported import domain' using errcode = '22023';
  end if;
  if p_file_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid file checksum' using errcode = '22023'; end if;
  if p_total_rows < 1 or p_total_rows > 100000 then raise exception 'Import row count is outside limits' using errcode = '22023'; end if;
  if p_duplicate_strategy not in ('create','skip','update') then raise exception 'Invalid duplicate strategy' using errcode = '22023'; end if;
  if p_facility_id is not null and not exists (
    select 1 from public.facilities f where f.id = p_facility_id and f.organization_id = v_org
  ) then raise exception 'Facility is outside import scope' using errcode = '42501'; end if;

  -- Reuse an unfinished job for the same caller/file, which makes the existing chunk protocol
  -- resumable even when an older client does not echo the job id between calls.
  select j.id into v_id
  from public.data_import_jobs j
  where j.organization_id = v_org
    and j.domain = p_domain
    and j.original_file_sha256 = p_file_sha256
    and j.created_by is not distinct from auth.uid()
    and j.status in ('uploaded','mapping','validated','ready','applying','failed')
  order by j.created_at desc
  limit 1;

  if v_id is null then
    insert into public.data_import_jobs(
      organization_id, facility_id, domain, original_file_name, original_file_sha256,
      total_rows, duplicate_strategy, status, created_by
    ) values (
      v_org, p_facility_id, p_domain, left(btrim(p_file_name), 255), p_file_sha256,
      p_total_rows, p_duplicate_strategy, 'uploaded', auth.uid()
    ) returning id into v_id;
    insert into public.data_import_events(organization_id, job_id, event_type, actor_profile_id, details)
    values (v_org, v_id, 'created', auth.uid(), jsonb_build_object('totalRows', p_total_rows));
  end if;
  return v_id;
end;
$$;

create or replace function public.record_data_import_chunk(
  p_job_id uuid,
  p_rows jsonb,
  p_job_status text default null,
  p_last_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
  v_row jsonb;
  v_count integer := 0;
  v_valid integer;
  v_warning integer;
  v_error integer;
  v_applied integer;
  v_skipped integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then
    raise exception 'Import chunk must be an array of no more than 200 rows' using errcode = '22023';
  end if;
  if p_job_status is not null and p_job_status not in ('uploaded','mapping','validated','ready','applying','applied','failed') then
    raise exception 'Invalid import job status' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    insert into public.data_import_rows(
      organization_id, job_id, row_number, source_row, normalized_row,
      proposed_action, status, target_table, target_id, before_snapshot,
      errors, warnings, applied_at
    ) values (
      v_org,
      p_job_id,
      (v_row ->> 'rowNumber')::integer,
      coalesce(v_row -> 'sourceRow', '{}'::jsonb),
      coalesce(v_row -> 'normalizedRow', '{}'::jsonb),
      coalesce(v_row ->> 'proposedAction', 'create'),
      v_row ->> 'status',
      nullif(v_row ->> 'targetTable', ''),
      nullif(v_row ->> 'targetId', '')::uuid,
      v_row -> 'beforeSnapshot',
      coalesce(v_row -> 'errors', '[]'::jsonb),
      coalesce(v_row -> 'warnings', '[]'::jsonb),
      case when v_row ->> 'status' = 'applied' then now() else null end
    )
    on conflict (job_id, row_number) do update set
      source_row = excluded.source_row,
      normalized_row = excluded.normalized_row,
      proposed_action = excluded.proposed_action,
      status = excluded.status,
      target_table = excluded.target_table,
      target_id = excluded.target_id,
      before_snapshot = excluded.before_snapshot,
      errors = excluded.errors,
      warnings = excluded.warnings,
      applied_at = coalesce(excluded.applied_at, public.data_import_rows.applied_at),
      updated_at = now()
    where public.data_import_rows.status not in ('applied','reverted')
       or excluded.status in ('reverted');
    v_count := v_count + 1;
  end loop;

  select
    count(*) filter (where r.status in ('valid','applied','skipped')),
    count(*) filter (where jsonb_array_length(r.warnings) > 0),
    count(*) filter (where r.status in ('invalid','failed')),
    count(*) filter (where r.status = 'applied'),
    count(*) filter (where r.status = 'skipped')
  into v_valid, v_warning, v_error, v_applied, v_skipped
  from public.data_import_rows r where r.job_id = p_job_id;

  update public.data_import_jobs j
  set valid_rows = v_valid,
      warning_rows = v_warning,
      error_rows = v_error,
      applied_rows = v_applied,
      skipped_rows = v_skipped,
      status = coalesce(p_job_status, j.status),
      started_at = coalesce(j.started_at, now()),
      applied_at = case when p_job_status = 'applied' then now() else j.applied_at end,
      last_error = p_last_error,
      updated_at = now()
  where j.id = p_job_id;

  insert into public.data_import_events(organization_id, job_id, event_type, actor_profile_id, details)
  values (v_org, p_job_id, 'chunk_recorded', auth.uid(), jsonb_build_object('rows', v_count, 'status', p_job_status));

  return jsonb_build_object('jobId', p_job_id, 'recorded', v_count, 'valid', v_valid,
    'warnings', v_warning, 'errors', v_error, 'applied', v_applied, 'skipped', v_skipped);
end;
$$;

create or replace function public.finalize_data_import_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
  v_job public.data_import_jobs%rowtype;
begin
  select * into v_job from public.data_import_jobs where id = p_job_id for update;
  if v_job.status not in ('applied','ready') then
    raise exception 'Only ready or applied imports may be finalized' using errcode = '22023';
  end if;
  if v_job.error_rows > 0 then
    raise exception 'Resolve or explicitly skip invalid rows before finalization' using errcode = '22023';
  end if;
  update public.data_import_jobs
  set status = 'finalized', finalized_at = now(), updated_at = now()
  where id = p_job_id;
  insert into public.data_import_events(organization_id, job_id, event_type, actor_profile_id)
  values (v_org, p_job_id, 'finalized', auth.uid());
  return jsonb_build_object('jobId', p_job_id, 'status', 'finalized', 'finalizedAt', now());
end;
$$;

create or replace function public.rollback_employee_import_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
  v_job public.data_import_jobs%rowtype;
  v_row record;
  v_reverted integer := 0;
  v_blocked integer := 0;
begin
  select * into v_job from public.data_import_jobs where id = p_job_id for update;
  if v_job.domain <> 'employees' then raise exception 'This rollback supports employee imports only' using errcode = '22023'; end if;
  if v_job.status <> 'applied' then raise exception 'Only an applied, unfinalized import may be rolled back' using errcode = '22023'; end if;
  if v_job.applied_at < now() - interval '24 hours' then
    raise exception 'The 24-hour rollback window has closed' using errcode = '22023';
  end if;

  for v_row in
    select r.id as import_row_id, r.target_id, r.applied_at
    from public.data_import_rows r
    where r.job_id = p_job_id and r.status = 'applied'
      and r.proposed_action = 'create' and r.target_table = 'employees'
    order by r.row_number desc
  loop
    begin
      delete from public.employees e
      where e.id = v_row.target_id
        and e.organization_id = v_org
        and e.profile_id is null
        and e.updated_at <= v_row.applied_at + interval '1 second';
      if found then
        update public.data_import_rows set status = 'reverted', reverted_at = now(), updated_at = now()
        where id = v_row.import_row_id;
        v_reverted := v_reverted + 1;
      else
        v_blocked := v_blocked + 1;
      end if;
    exception when foreign_key_violation then
      v_blocked := v_blocked + 1;
    end;
  end loop;

  update public.data_import_jobs
  set status = case when v_blocked = 0 then 'rolled_back' else 'applied' end,
      reverted_rows = v_reverted,
      rolled_back_at = case when v_blocked = 0 then now() else null end,
      last_error = case when v_blocked > 0 then concat(v_blocked, ' row(s) changed or gained dependent records and were not removed.') else null end,
      updated_at = now()
  where id = p_job_id;
  insert into public.data_import_events(organization_id, job_id, event_type, actor_profile_id, details)
  values (v_org, p_job_id, 'rollback_attempted', auth.uid(), jsonb_build_object('reverted', v_reverted, 'blocked', v_blocked));

  return jsonb_build_object('jobId', p_job_id, 'reverted', v_reverted, 'blocked', v_blocked,
    'status', case when v_blocked = 0 then 'rolled_back' else 'partially_blocked' end);
end;
$$;

revoke all on function public.start_data_import_job(text,text,text,integer,text,uuid,uuid) from public, anon;
revoke all on function public.record_data_import_chunk(uuid,jsonb,text,text) from public, anon;
revoke all on function public.finalize_data_import_job(uuid) from public, anon;
revoke all on function public.rollback_employee_import_job(uuid) from public, anon;
grant execute on function public.start_data_import_job(text,text,text,integer,text,uuid,uuid) to authenticated, service_role;
grant execute on function public.record_data_import_chunk(uuid,jsonb,text,text) to authenticated, service_role;
grant execute on function public.finalize_data_import_job(uuid) to authenticated, service_role;
grant execute on function public.rollback_employee_import_job(uuid) to authenticated, service_role;
