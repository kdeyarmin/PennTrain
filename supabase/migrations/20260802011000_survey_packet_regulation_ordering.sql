-- C5 minimal durable slice: keep the existing survey evidence packet system, but make packet
-- list/manifest order stable when labels carry a regulation or citation prefix (for example
-- 2800.64 or 2600.227(a)). Non-citation rows still fall back to manual sort_order and created_at.
create or replace function app_private.survey_packet_regulation_sort_key(p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_match text;
  v_token text;
  v_key text := '';
begin
  select (regexp_match(
    coalesce(p_label, ''),
    '(?:^|[^0-9])([0-9]+(?:\.[0-9A-Za-z]+)+(?:\([^)]+\))*)'
  ))[1]
  into v_match;

  if v_match is null or length(v_match) = 0 then
    return null;
  end if;

  for v_token in
    select token[1]
    from regexp_matches(v_match, '([0-9]+|[A-Za-z]+)', 'g') as token
  loop
    if v_token ~ '^[0-9]+$' then
      v_key := v_key || '.d' || lpad(v_token, 8, '0');
    else
      v_key := v_key || '.a' || lower(v_token);
    end if;
  end loop;

  return nullif(ltrim(v_key, '.'), '');
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
  order by app_private.survey_packet_regulation_sort_key(i.label) nulls last, i.sort_order, i.created_at
  limit 500;
end;
$$;

create or replace function public.assemble_survey_evidence_packet_manifest(
  p_survey_day_session_id uuid default null,
  p_binder_export_job_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_items jsonb;
  v_manifest jsonb;
begin
  if not (
    public.is_platform_admin()
    or public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'sourceType', i.source_type,
      'sourceId', i.source_id,
      'label', i.label,
      'notes', i.notes,
      'sortOrder', i.sort_order,
      'binderExportJobId', i.binder_export_job_id,
      'regulationKey', app_private.survey_packet_regulation_sort_key(i.label)
    ) order by app_private.survey_packet_regulation_sort_key(i.label) nulls last, i.sort_order, i.created_at
  ), '[]'::jsonb)
  into v_items
  from public.survey_evidence_packet_items i
  where (public.is_platform_admin() or i.organization_id = v_org)
    and (p_survey_day_session_id is null or i.survey_day_session_id = p_survey_day_session_id)
    and (p_binder_export_job_id is null or i.binder_export_job_id = p_binder_export_job_id);

  v_manifest := jsonb_build_object(
    'assembledAt', now(),
    'assembledBy', auth.uid(),
    'organizationId', v_org,
    'surveyDaySessionId', p_survey_day_session_id,
    'binderExportJobId', p_binder_export_job_id,
    'itemCount', jsonb_array_length(v_items),
    'items', v_items,
    'accessControlNote', 'Packet is selection metadata + existing binder/evidence artifacts; guest grants remain explicit via evidence room.',
    'immutable', true
  );

  if p_survey_day_session_id is not null then
    begin
      perform public.record_survey_day_packet_assembled(p_survey_day_session_id);
    exception when others then
      null;
    end;
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_org, auth.uid(), 'survey_evidence_packet', coalesce(p_survey_day_session_id, p_binder_export_job_id, gen_random_uuid())::text,
    'packet_assembled', v_manifest
  );

  return v_manifest;
end;
$$;
