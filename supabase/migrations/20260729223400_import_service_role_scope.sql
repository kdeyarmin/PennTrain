-- Trusted import workers have no auth.uid(), so the original start function could not derive an
-- organization even though it explicitly accepts p_organization_id and grants service_role execute.
-- Interactive managers still derive scope from their session; only trusted database roles may use the
-- explicit organization parameter without a platform-admin JWT.

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
  v_org uuid;
  v_id uuid;
begin
  if current_user in ('postgres','service_role','supabase_admin') then
    v_org := p_organization_id;
  else
    v_org := app_private.assert_import_manager(null);
    if public.is_platform_admin() then v_org := p_organization_id; end if;
  end if;

  if v_org is null then raise exception 'Organization is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    raise exception 'Organization was not found' using errcode = 'P0002';
  end if;
  if p_domain not in ('employees','training_records','credentials','residents','resident_contacts','rooms','assessments','incidents') then
    raise exception 'Unsupported import domain' using errcode = '22023';
  end if;
  if p_file_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid file checksum' using errcode = '22023'; end if;
  if p_total_rows < 1 or p_total_rows > 100000 then raise exception 'Import row count is outside limits' using errcode = '22023'; end if;
  if p_duplicate_strategy not in ('create','skip','update') then raise exception 'Invalid duplicate strategy' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_file_name, ''))) < 1 then raise exception 'File name is required' using errcode = '22023'; end if;
  if p_facility_id is not null and not exists (
    select 1 from public.facilities f where f.id = p_facility_id and f.organization_id = v_org
  ) then raise exception 'Facility is outside import scope' using errcode = '42501'; end if;

  select j.id into v_id
  from public.data_import_jobs j
  where j.organization_id = v_org
    and j.domain = p_domain
    and j.original_file_sha256 = p_file_sha256
    and (
      current_user in ('postgres','service_role','supabase_admin')
      or j.created_by is not distinct from auth.uid()
    )
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
