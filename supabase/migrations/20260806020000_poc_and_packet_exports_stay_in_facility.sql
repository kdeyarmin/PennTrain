-- Fourth-pass follow-ons after 20260806010000:
--
-- 1. assert_can_manage_violation (POC submit/correct/verify) let any org facility_manager
--    manage any facility's violations via SECURITY DEFINER, bypassing dhs_violations RLS
--    which already requires is_assigned_to_facility for FM writes.
-- 2. record_survey_evidence_packet_export likewise admitted any org FM; list_packet_items
--    and list_packet_exports returned every facility's rows to every FM (G58 tightened
--    add/remove/assemble/grants but not these).

create or replace function public.assert_can_manage_violation(p_violation_id uuid)
returns public.dhs_violations
language plpgsql security definer set search_path = ''
as $$
declare v public.dhs_violations%rowtype;
begin
  select * into v from public.dhs_violations where id = p_violation_id for update;
  if not found then raise exception 'Violation not found' using errcode = 'P0002'; end if;
  if not (
    public.is_platform_admin()
    or (
      v.organization_id = public.current_org_id()
      and (
        public.current_role() = 'org_admin'
        or (
          public.current_role() = 'facility_manager'
          and v.facility_id is not null
          and public.is_assigned_to_facility(v.facility_id)
        )
      )
    )
  ) then
    raise exception 'Not authorized to manage this plan of correction' using errcode = '42501';
  end if;
  return v;
end;
$$;

create or replace function public.record_survey_evidence_packet_export(
  p_facility_id uuid,
  p_survey_day_session_id uuid,
  p_binder_export_job_id uuid,
  p_storage_path text,
  p_content_sha256 text,
  p_byte_size bigint,
  p_item_count integer,
  p_manifest jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_id uuid;
begin
  if v_org is null and not public.is_platform_admin() then
    raise exception 'Organization required' using errcode = '22023';
  end if;
  if not (
    public.is_platform_admin()
    or public.current_role() = 'org_admin'
    or (
      public.current_role() = 'facility_manager'
      and p_facility_id is not null
      and public.is_assigned_to_facility(p_facility_id)
    )
  ) then
    raise exception 'Not authorized to package survey evidence' using errcode = '42501';
  end if;
  if p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid content hash' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size < 1 then
    raise exception 'Invalid package size' using errcode = '22023';
  end if;

  insert into public.survey_evidence_packet_exports (
    organization_id, facility_id, survey_day_session_id, binder_export_job_id,
    storage_path, content_sha256, byte_size, item_count, manifest, status, created_by
  ) values (
    coalesce(v_org, (select organization_id from public.binder_export_jobs where id = p_binder_export_job_id)),
    p_facility_id, p_survey_day_session_id, p_binder_export_job_id,
    btrim(p_storage_path), lower(p_content_sha256), p_byte_size, coalesce(p_item_count, 0),
    coalesce(p_manifest, '{}'::jsonb), 'ready', auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    coalesce(v_org, (select organization_id from public.survey_evidence_packet_exports where id = v_id)),
    auth.uid(), 'survey_evidence_packet_export', v_id::text, 'packet_packaged',
    jsonb_build_object(
      'byteSize', p_byte_size,
      'itemCount', p_item_count,
      'contentSha256', p_content_sha256,
      'storagePath', p_storage_path
    )
  );

  return v_id;
end;
$$;

create or replace function public.list_survey_evidence_packet_items(
  p_survey_day_session_id uuid default null,
  p_binder_export_job_id uuid default null
)
returns setof public.survey_evidence_packet_items
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.is_platform_admin()
    or public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select i.*
  from public.survey_evidence_packet_items i
  where (public.is_platform_admin() or i.organization_id = public.current_org_id())
    and (p_survey_day_session_id is null or i.survey_day_session_id = p_survey_day_session_id)
    and (p_binder_export_job_id is null or i.binder_export_job_id = p_binder_export_job_id)
    and (
      public.is_platform_admin()
      or public.current_role() in ('org_admin', 'auditor')
      or (
        public.current_role() = 'facility_manager'
        and i.facility_id is not null
        and public.is_assigned_to_facility(i.facility_id)
      )
    )
  order by app_private.survey_packet_item_regulation_key(i.citation_ref, i.label) nulls last,
           i.sort_order,
           i.created_at
  limit 500;
end;
$$;

create or replace function public.list_survey_evidence_packet_exports(
  p_survey_day_session_id uuid default null,
  p_binder_export_job_id uuid default null
)
returns setof public.survey_evidence_packet_exports
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.is_platform_admin()
    or public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select e.*
  from public.survey_evidence_packet_exports e
  where (public.is_platform_admin() or e.organization_id = public.current_org_id())
    and (p_survey_day_session_id is null or e.survey_day_session_id = p_survey_day_session_id)
    and (p_binder_export_job_id is null or e.binder_export_job_id = p_binder_export_job_id)
    and (
      public.is_platform_admin()
      or public.current_role() in ('org_admin', 'auditor')
      or (
        public.current_role() = 'facility_manager'
        and e.facility_id is not null
        and public.is_assigned_to_facility(e.facility_id)
      )
    )
  order by e.created_at desc
  limit 50;
end;
$$;
