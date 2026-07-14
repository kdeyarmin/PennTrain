-- Give the analyzer caller RPCs' nullable parameters explicit null defaults so the
-- generated TypeScript types mark them optional -- the page submits the whole draft every
-- time, and "omitted" and "null" deliberately mean the same thing (full-overwrite
-- semantics). Redefinitions only change defaults; bodies are identical to
-- 20260713233707_state_form_document_analyzer.sql.

create or replace function public.enqueue_document_analyzer_job(
  p_file_name text,
  p_file_size integer default null,
  p_source_path text default null
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
