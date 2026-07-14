-- Hardening pass from the adversarial review of the document analyzer pipeline.
--
-- 1. PHI containment: drop the generic audit trigger on document_analyzer_jobs. The
--    generic audit_log_trigger() copies the whole row (resident_name, notes, issues --
--    extracted resident content) into audit_logs stamped with the row's organization_id,
--    and once a reviewer picks a chart facility that org's org_admin/auditor can read the
--    entry through audit_logs_select -- leaking a platform-admin-only queue org-wide.
--    Worker queues follow the binder_export_jobs precedent (no row trigger); approvals
--    stay attributable through approved_by/approved_at on the row itself. The decision is
--    registered in the audit manifest, and any already-written rows are removed.
-- 2. Lease recovery: a worker that dies uncleanly on a job's final attempt used to strand
--    the row in 'processing' forever -- the reclaim arm requires attempt_count <
--    max_attempts, finish refuses non-processing rows only after lease checks, and retry
--    only accepts 'failed'. claim_document_analyzer_jobs now fails out exhausted stale
--    leases first (mirroring the phase2 integration-hub pattern) so the row lands in
--    'failed' where the manual retry RPC can re-queue it.
-- 3. Review integrity: draft edits can no longer move a job to a different facility after
--    a resident chart was linked -- the chart was validated against the chosen facility.
-- 4. Referential actions: approved_by/chart_resident_id dropped ON DELETE SET NULL. The
--    nulling collided with the approval/chart CHECK constraints, so deleting a referenced
--    profile/resident aborted with a confusing check_violation; a plain FK now blocks the
--    delete with an accurate foreign-key error instead.
-- 5. Upload rollback: the client removes the stored object when enqueue fails after
--    upload; that remove silently no-oped because the bucket had no delete policy. Grant
--    platform_admin delete on the uploads/ prefix only (exports/ stays service-role-only).

drop trigger if exists audit_log on public.document_analyzer_jobs;

delete from public.audit_logs where entity_type = 'document_analyzer_jobs';

insert into app_private.audit_entity_manifest (table_name, audit_mode, contains_regulated_data, rationale)
values (
  'document_analyzer_jobs',
  'not_required',
  true,
  'Platform-admin-only extraction queue holding resident content from scanned state forms. A row trigger would copy that content into org-scoped audit_logs entries; approvals are attributable via approved_by/approved_at and all writes flow through SECURITY DEFINER RPCs.'
)
on conflict (table_name) do update
  set audit_mode = excluded.audit_mode,
      contains_regulated_data = excluded.contains_regulated_data,
      rationale = excluded.rationale;

alter table public.document_analyzer_jobs
  drop constraint document_analyzer_jobs_approved_by_fkey,
  add constraint document_analyzer_jobs_approved_by_fkey
    foreign key (approved_by) references public.profiles(id);

alter table public.document_analyzer_jobs
  drop constraint document_analyzer_jobs_chart_resident_id_fkey,
  add constraint document_analyzer_jobs_chart_resident_id_fkey
    foreign key (chart_resident_id) references public.residents(id);

create policy "state-form-analyzer delete" on storage.objects for delete to authenticated using (
  bucket_id = 'state-form-analyzer'
  and (select public.is_platform_admin())
  and name like 'uploads/%'
);

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

  -- A worker killed mid-extraction on the job's final attempt leaves an exhausted stale
  -- lease no arm below can ever pick up. Fail those rows out so the manual retry RPC can
  -- re-queue them.
  update public.document_analyzer_jobs j
  set status = 'failed',
      current_run_id = null,
      worker_id = null,
      locked_at = null,
      completed_at = now(),
      last_error_code = 'worker_lost',
      last_error_message = 'The extraction worker was interrupted before recording a result. Retry to re-queue this form.'
  where j.status = 'processing'
    and j.locked_at < now() - interval '15 minutes'
    and j.attempt_count >= j.max_attempts;

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
        current_run_id = gen_random_uuid(),
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

create or replace function public.update_document_analyzer_job_draft(
  p_job_id uuid,
  p_resident_name text default null,
  p_facility_name text default null,
  p_state_form_template text default null,
  p_review_due_date text default null,
  p_admission_date date default null,
  p_notes text default null,
  p_facility_id uuid default null
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
  if v_job.chart_creation_status = 'created'
     and p_facility_id is distinct from v_job.facility_id then
    raise exception 'The facility cannot be changed after a resident chart is linked'
      using errcode = '55000';
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
