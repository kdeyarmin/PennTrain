-- State Form Document Analyzer: production backend replacing the /admin/document-analyzer
-- browser simulation. Historical scanned state forms are uploaded to a private
-- platform-admin-only bucket, and each file becomes a durable extraction job following the
-- certificate-PDF/binder worker pattern: a caller-authorized enqueue RPC, service-role
-- claim/finish worker RPCs with stale-lease reclaim and exponential backoff, a cron sweep
-- that drives the analyze-state-form edge worker, and an operational-control-plane
-- registration. Extraction results land on the job row as an editable draft that a super
-- admin must review and approve before export -- the AI never finalizes a state form on
-- its own. Scanned forms contain resident PHI, so the extraction step (the only step
-- that sends resident content to the AI vendor -- uploads stay inside the
-- Supabase-BAA-covered bucket) sits behind the ai_document_analyzer_enabled platform
-- setting, which (like ai_wellness_summary_generation_enabled) defaults to DISABLED
-- until the PHI/BAA review for the AI vendor is confirmed.

create table public.document_analyzer_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  requested_by uuid not null references public.profiles(id) on delete cascade,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  file_size integer check (file_size is null or file_size >= 0),
  source_bucket text not null default 'state-form-analyzer'
    check (source_bucket = 'state-form-analyzer'),
  source_path text not null check (source_path like 'uploads/%'),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'needs_review', 'ready', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  current_run_id uuid,
  worker_id uuid,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_started_at timestamptz,
  completed_at timestamptz,
  -- Extraction output. These become the editable review draft; the worker overwrites them
  -- on every successful extraction and every draft edit clears the approval below.
  model text,
  page_count integer check (page_count is null or page_count between 1 and 600),
  confidence integer check (confidence is null or confidence between 0 and 100),
  resident_name text not null default '' check (length(resident_name) <= 300),
  facility_name text not null default '' check (length(facility_name) <= 300),
  state_form_template text not null default '' check (length(state_form_template) <= 300),
  review_due_date text not null default '' check (length(review_due_date) <= 100),
  admission_date date,
  notes text not null default '' check (length(notes) <= 20000),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  -- Review workflow. Approval is the human gate before any export/print.
  approved_for_export boolean not null default false,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  -- Resident-chart linkage (the facility chosen in the review panel, and the resident
  -- created or linked from the extracted demographics).
  organization_id uuid references public.organizations(id) on delete set null,
  facility_id uuid references public.facilities(id) on delete set null,
  chart_creation_status text not null default 'not_asked'
    check (chart_creation_status in ('not_asked', 'declined', 'created')),
  chart_resident_id uuid references public.residents(id) on delete set null,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_analyzer_jobs_source_unique unique (source_bucket, source_path),
  constraint document_analyzer_jobs_processing_consistency_check check (
    status <> 'processing'
    or (current_run_id is not null and worker_id is not null and locked_at is not null)
  ),
  constraint document_analyzer_jobs_approval_check check (
    not approved_for_export
    or (status in ('needs_review', 'ready') and approved_by is not null and approved_at is not null)
  ),
  constraint document_analyzer_jobs_chart_check check (
    chart_creation_status <> 'created' or chart_resident_id is not null
  )
);

create index document_analyzer_jobs_claim_idx
  on public.document_analyzer_jobs (available_at, created_at)
  where status = 'queued';
create index document_analyzer_jobs_stale_idx
  on public.document_analyzer_jobs (locked_at)
  where status = 'processing';
create index document_analyzer_jobs_created_idx
  on public.document_analyzer_jobs (created_at desc);
create index document_analyzer_jobs_requested_by_idx
  on public.document_analyzer_jobs (requested_by);
create index document_analyzer_jobs_approved_by_idx
  on public.document_analyzer_jobs (approved_by);
create index document_analyzer_jobs_organization_id_idx
  on public.document_analyzer_jobs (organization_id);
create index document_analyzer_jobs_facility_id_idx
  on public.document_analyzer_jobs (facility_id);
create index document_analyzer_jobs_chart_resident_id_idx
  on public.document_analyzer_jobs (chart_resident_id);

create trigger set_updated_at before update on public.document_analyzer_jobs
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.document_analyzer_jobs
  for each row execute function public.audit_log_trigger();

alter table public.document_analyzer_jobs enable row level security;

-- Uploads are historical scanned state forms that may reference any organization, and the
-- page is super-admin-only end to end, so visibility is platform_admin only -- org roles
-- never see this queue.
create policy document_analyzer_jobs_select on public.document_analyzer_jobs
for select to authenticated using (
  (select public.is_platform_admin())
);

revoke all on table public.document_analyzer_jobs from public, anon, authenticated, service_role;
grant select on table public.document_analyzer_jobs to authenticated;
grant all on table public.document_analyzer_jobs to service_role;

-- ---------------------------------------------------------------------------
-- Source-document bucket (private; platform_admin only; PDFs only)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('state-form-analyzer', 'state-form-analyzer', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Client uploads land under uploads/ only; the worker writes export packets under
-- exports/ with the service-role client (which bypasses RLS), so no authenticated write
-- policy exists for that prefix and no delete policy exists at all -- job rows own the
-- object lifecycle.
create policy "state-form-analyzer read" on storage.objects for select to authenticated using (
  bucket_id = 'state-form-analyzer'
  and (select public.is_platform_admin())
);

create policy "state-form-analyzer insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'state-form-analyzer'
  and (select public.is_platform_admin())
  and name like 'uploads/%'
);

-- ---------------------------------------------------------------------------
-- Caller RPCs (platform_admin only; the page's write surface)
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_document_analyzer_job(
  p_file_name text,
  p_file_size integer,
  p_source_path text
)
returns public.document_analyzer_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.document_analyzer_jobs%rowtype;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'platform_admin' and p.is_active
  ) then
    raise exception 'The document analyzer is limited to platform administrators'
      using errcode = '42501';
  end if;

  if p_file_name is null or length(btrim(p_file_name)) not between 1 and 255
     or lower(p_file_name) not like '%.pdf' then
    raise exception 'A PDF file name is required' using errcode = '22023';
  end if;
  if p_source_path is null
     or p_source_path not like 'uploads/%'
     or lower(p_source_path) not like '%.pdf'
     or length(p_source_path) > 1024 then
    raise exception 'source path must be an uploads/ PDF object path' using errcode = '22023';
  end if;
  if p_file_size is not null and p_file_size < 0 then
    raise exception 'file size cannot be negative' using errcode = '22023';
  end if;

  insert into public.document_analyzer_jobs (requested_by, file_name, file_size, source_path)
  values (auth.uid(), btrim(p_file_name), p_file_size, p_source_path)
  returning * into v_job;
  return v_job;
end;
$function$;
revoke all on function public.enqueue_document_analyzer_job(text, integer, text)
  from public, anon;
grant execute on function public.enqueue_document_analyzer_job(text, integer, text)
  to authenticated;

create or replace function public.update_document_analyzer_job_draft(
  p_job_id uuid,
  p_resident_name text,
  p_facility_name text,
  p_state_form_template text,
  p_review_due_date text,
  p_admission_date date,
  p_notes text,
  p_facility_id uuid
)
returns public.document_analyzer_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.document_analyzer_jobs%rowtype;
  v_org uuid;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'platform_admin' and p.is_active
  ) then
    raise exception 'The document analyzer is limited to platform administrators'
      using errcode = '42501';
  end if;

  select j.* into v_job from public.document_analyzer_jobs j where j.id = p_job_id for update;
  if v_job.id is null then
    raise exception 'document analyzer job not found' using errcode = 'P0002';
  end if;
  if v_job.status not in ('needs_review', 'ready') then
    raise exception 'Only extracted jobs awaiting review can be edited' using errcode = '55000';
  end if;

  if p_facility_id is not null then
    select f.organization_id into v_org from public.facilities f where f.id = p_facility_id;
    if v_org is null then
      raise exception 'facility not found' using errcode = '22023';
    end if;
  end if;

  -- Full-overwrite draft semantics (the page always submits the whole draft). Any edit
  -- re-opens the human review gate by clearing the approval.
  update public.document_analyzer_jobs
  set resident_name = left(coalesce(p_resident_name, ''), 300),
      facility_name = left(coalesce(p_facility_name, ''), 300),
      state_form_template = left(coalesce(p_state_form_template, ''), 300),
      review_due_date = left(coalesce(p_review_due_date, ''), 100),
      admission_date = p_admission_date,
      notes = left(coalesce(p_notes, ''), 20000),
      facility_id = p_facility_id,
      organization_id = v_org,
      approved_for_export = false,
      approved_by = null,
      approved_at = null
  where id = v_job.id
  returning * into v_job;
  return v_job;
end;
$function$;
revoke all on function public.update_document_analyzer_job_draft(uuid, text, text, text, text, date, text, uuid)
  from public, anon;
grant execute on function public.update_document_analyzer_job_draft(uuid, text, text, text, text, date, text, uuid)
  to authenticated;

create or replace function public.approve_document_analyzer_job(p_job_id uuid)
returns public.document_analyzer_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.document_analyzer_jobs%rowtype;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'platform_admin' and p.is_active
  ) then
    raise exception 'The document analyzer is limited to platform administrators'
      using errcode = '42501';
  end if;

  select j.* into v_job from public.document_analyzer_jobs j where j.id = p_job_id for update;
  if v_job.id is null then
    raise exception 'document analyzer job not found' using errcode = 'P0002';
  end if;
  if v_job.status not in ('needs_review', 'ready') then
    raise exception 'Only extracted jobs awaiting review can be approved' using errcode = '55000';
  end if;
  if length(btrim(v_job.resident_name)) = 0
     or length(btrim(v_job.facility_name)) = 0
     or length(btrim(v_job.state_form_template)) = 0
     or length(btrim(v_job.review_due_date)) = 0 then
    raise exception 'Resident name, facility, state form template, and review due date are required before approval'
      using errcode = '22023';
  end if;

  update public.document_analyzer_jobs
  set approved_for_export = true,
      approved_by = auth.uid(),
      approved_at = now()
  where id = v_job.id
  returning * into v_job;
  return v_job;
end;
$function$;
revoke all on function public.approve_document_analyzer_job(uuid) from public, anon;
grant execute on function public.approve_document_analyzer_job(uuid) to authenticated;

create or replace function public.retry_document_analyzer_job(p_job_id uuid)
returns public.document_analyzer_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.document_analyzer_jobs%rowtype;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'platform_admin' and p.is_active
  ) then
    raise exception 'The document analyzer is limited to platform administrators'
      using errcode = '42501';
  end if;

  select j.* into v_job from public.document_analyzer_jobs j where j.id = p_job_id for update;
  if v_job.id is null then
    raise exception 'document analyzer job not found' using errcode = 'P0002';
  end if;
  if v_job.status <> 'failed' then
    raise exception 'Only failed jobs can be retried' using errcode = '55000';
  end if;

  update public.document_analyzer_jobs
  set status = 'queued',
      attempt_count = 0,
      available_at = now(),
      current_run_id = null,
      worker_id = null,
      locked_at = null,
      completed_at = null,
      last_error_code = null,
      last_error_message = null
  where id = v_job.id
  returning * into v_job;
  return v_job;
end;
$function$;
revoke all on function public.retry_document_analyzer_job(uuid) from public, anon;
grant execute on function public.retry_document_analyzer_job(uuid) to authenticated;

create or replace function public.mark_document_analyzer_job_chart_created(
  p_job_id uuid,
  p_resident_id uuid
)
returns public.document_analyzer_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.document_analyzer_jobs%rowtype;
  v_resident_facility uuid;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'platform_admin' and p.is_active
  ) then
    raise exception 'The document analyzer is limited to platform administrators'
      using errcode = '42501';
  end if;

  select j.* into v_job from public.document_analyzer_jobs j where j.id = p_job_id for update;
  if v_job.id is null then
    raise exception 'document analyzer job not found' using errcode = 'P0002';
  end if;
  if v_job.facility_id is null then
    raise exception 'Choose a system facility on the job before linking a resident chart'
      using errcode = '55000';
  end if;

  select r.facility_id into v_resident_facility from public.residents r where r.id = p_resident_id;
  if v_resident_facility is null then
    raise exception 'resident not found' using errcode = '22023';
  end if;
  if v_resident_facility <> v_job.facility_id then
    raise exception 'resident does not belong to the job''s selected facility' using errcode = '22023';
  end if;

  update public.document_analyzer_jobs
  set chart_creation_status = 'created',
      chart_resident_id = p_resident_id
  where id = v_job.id
  returning * into v_job;
  return v_job;
end;
$function$;
revoke all on function public.mark_document_analyzer_job_chart_created(uuid, uuid) from public, anon;
grant execute on function public.mark_document_analyzer_job_chart_created(uuid, uuid) to authenticated;

create or replace function public.decline_document_analyzer_job_chart(p_job_id uuid)
returns public.document_analyzer_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.document_analyzer_jobs%rowtype;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'platform_admin' and p.is_active
  ) then
    raise exception 'The document analyzer is limited to platform administrators'
      using errcode = '42501';
  end if;

  select j.* into v_job from public.document_analyzer_jobs j where j.id = p_job_id for update;
  if v_job.id is null then
    raise exception 'document analyzer job not found' using errcode = 'P0002';
  end if;
  if v_job.chart_creation_status = 'created' then
    raise exception 'A linked resident chart cannot be declined' using errcode = '55000';
  end if;

  update public.document_analyzer_jobs
  set chart_creation_status = 'declined'
  where id = v_job.id
  returning * into v_job;
  return v_job;
end;
$function$;
revoke all on function public.decline_document_analyzer_job_chart(uuid) from public, anon;
grant execute on function public.decline_document_analyzer_job_chart(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Worker claim / finish (service_role only; mirrors the binder worker)
-- ---------------------------------------------------------------------------

create or replace function public.claim_document_analyzer_jobs(
  p_worker_id uuid,
  p_job_id uuid default null,
  p_limit integer default 1
)
returns table (
  job_id uuid,
  run_id uuid,
  source_bucket text,
  source_path text,
  file_name text,
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
    from public.document_analyzer_jobs j
    where (p_job_id is null or j.id = p_job_id)
      and j.attempt_count < j.max_attempts
      and (
        (j.status = 'queued' and j.available_at <= now())
        or (j.status = 'processing' and j.locked_at < now() - interval '15 minutes')
      )
    order by j.available_at, j.created_at
    limit p_limit
    for update of j skip locked
  ), claimed as (
    update public.document_analyzer_jobs j
    set status = 'processing',
        attempt_count = j.attempt_count + 1,
        current_run_id = extensions.gen_random_uuid(),
        worker_id = p_worker_id,
        locked_at = now(),
        last_started_at = now(),
        last_error_code = null,
        last_error_message = null
    from candidates c
    where j.id = c.id
    returning j.id, j.source_bucket, j.source_path, j.file_name, j.current_run_id,
      j.attempt_count, j.requested_by
  )
  select c.id, c.current_run_id, c.source_bucket, c.source_path, c.file_name,
    c.attempt_count, c.requested_by
  from claimed c;
end;
$function$;
revoke all on function public.claim_document_analyzer_jobs(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_document_analyzer_jobs(uuid, uuid, integer)
  to service_role;

create or replace function public.finish_document_analyzer_job(
  p_job_id uuid,
  p_run_id uuid,
  p_status text default null,
  p_model text default null,
  p_page_count integer default null,
  p_confidence integer default null,
  p_resident_name text default null,
  p_facility_name text default null,
  p_state_form_template text default null,
  p_review_due_date text default null,
  p_admission_date date default null,
  p_notes text default null,
  p_issues jsonb default null,
  p_error_code text default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.document_analyzer_jobs%rowtype;
  v_success boolean;
  v_retry boolean;
begin
  if p_status is not null and p_status not in ('needs_review', 'ready') then
    raise exception 'p_status must be needs_review or ready' using errcode = 'invalid_parameter_value';
  end if;

  select j.* into v_job
  from public.document_analyzer_jobs j
  where j.id = p_job_id
  for update of j;

  if v_job.id is null
     or v_job.status <> 'processing'
     or v_job.current_run_id is distinct from p_run_id then
    return false;
  end if;

  v_success := p_status is not null and p_error_message is null;
  v_retry := not v_success and v_job.attempt_count < v_job.max_attempts;

  if v_success then
    update public.document_analyzer_jobs
    set status = p_status,
        current_run_id = null,
        worker_id = null,
        locked_at = null,
        completed_at = now(),
        model = p_model,
        page_count = p_page_count,
        confidence = p_confidence,
        resident_name = left(coalesce(p_resident_name, ''), 300),
        facility_name = left(coalesce(p_facility_name, ''), 300),
        state_form_template = left(coalesce(p_state_form_template, ''), 300),
        review_due_date = left(coalesce(p_review_due_date, ''), 100),
        admission_date = p_admission_date,
        notes = left(coalesce(p_notes, ''), 20000),
        issues = case when jsonb_typeof(coalesce(p_issues, '[]'::jsonb)) = 'array'
          then coalesce(p_issues, '[]'::jsonb) else '[]'::jsonb end,
        last_error_code = null,
        last_error_message = null
    where id = v_job.id;
  else
    update public.document_analyzer_jobs
    set status = case when v_retry then 'queued' else 'failed' end,
        current_run_id = null,
        worker_id = null,
        locked_at = null,
        available_at = case
          when v_retry then now() + make_interval(secs => least(3600, 30 * (2 ^ greatest(0, v_job.attempt_count - 1))))
          else available_at
        end,
        completed_at = case when v_retry then null else now() end,
        last_error_code = left(coalesce(p_error_code, 'extraction_failed'), 120),
        last_error_message = left(coalesce(p_error_message, 'State form extraction failed'), 2000)
    where id = v_job.id;
  end if;

  return true;
end;
$function$;
revoke all on function public.finish_document_analyzer_job(uuid, uuid, text, text, integer, integer, text, text, text, text, date, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_document_analyzer_job(uuid, uuid, text, text, integer, integer, text, text, text, text, date, text, jsonb, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Feature kill switch (PHI to the AI vendor -- same posture as the wellness summary)
-- ---------------------------------------------------------------------------

-- Scanned historical state forms carry real resident demographics and clinical notes.
-- DEPLOYMENT.md's PHI/BAA section requires confirming a signed Business Associate
-- Agreement with the AI vendor before any real patient-linked data is sent off-platform;
-- extraction stays disabled until a platform administrator flips this after that review.
insert into public.platform_settings (key, value) values
  ('ai_document_analyzer_enabled', 'false'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Scheduling + operational registration
-- ---------------------------------------------------------------------------

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'process-document-analyzer-jobs';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'process-document-analyzer-jobs',
    '*/5 * * * *',
    $cron$
    select net.http_post(
      url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/analyze-state-form',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-CareMetric-Cron-Secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret' limit 1), '')),
      body := jsonb_build_object('batchSize', 2));
    $cron$
  );
end
$$;

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
  'document-analyzer-extraction',
  'State form document analyzer',
  'Claims uploaded historical state form PDFs and extracts their contents for super-admin review',
  'worker',
  null,
  interval '15 minutes',
  interval '30 minutes',
  false,
  'automatic',
  '/admin/system-jobs'
);
