-- C5 residual: first-class citation_ref on survey evidence packet items.
-- Ordering prefers explicit citation_ref; falls back to label-parse for older rows.

alter table public.survey_evidence_packet_items
  add column if not exists citation_ref text
    check (citation_ref is null or length(btrim(citation_ref)) between 1 and 64);

comment on column public.survey_evidence_packet_items.citation_ref is
  'Optional regulation/citation key (e.g. 2800.64 or 2600.227(a)). Used for entrance-conference packet order.';

-- Backfill from labels that already carry a citation prefix.
update public.survey_evidence_packet_items i
set citation_ref = (regexp_match(
  coalesce(i.label, ''),
  '(?:^|[^0-9])([0-9]+(?:\.[0-9A-Za-z]+)+(?:\([^)]+\))*)'
))[1]
where i.citation_ref is null
  and (regexp_match(
    coalesce(i.label, ''),
    '(?:^|[^0-9])([0-9]+(?:\.[0-9A-Za-z]+)+(?:\([^)]+\))*)'
  ))[1] is not null;

create index if not exists survey_evidence_packet_items_citation_ref_idx
  on public.survey_evidence_packet_items (organization_id, citation_ref)
  where citation_ref is not null;

-- Prefer explicit citation_ref; fall back to label-embedded citation.
create or replace function app_private.survey_packet_item_regulation_key(
  p_citation_ref text,
  p_label text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select app_private.survey_packet_regulation_sort_key(
    coalesce(nullif(btrim(p_citation_ref), ''), p_label)
  );
$$;

drop function if exists public.add_survey_evidence_packet_item(text, text, uuid, uuid, uuid, uuid, text, integer);

create or replace function public.add_survey_evidence_packet_item(
  p_source_type text,
  p_label text,
  p_source_id uuid default null,
  p_facility_id uuid default null,
  p_survey_day_session_id uuid default null,
  p_binder_export_job_id uuid default null,
  p_notes text default null,
  p_sort_order integer default 0,
  p_citation_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_id uuid;
  v_citation text;
begin
  if v_org is null and not public.is_platform_admin() then
    raise exception 'Organization required' using errcode = '22023';
  end if;
  if not (
    public.is_platform_admin()
    or public.current_role() in ('org_admin', 'facility_manager', 'auditor')
  ) then
    raise exception 'Not authorized to build survey evidence packets' using errcode = '42501';
  end if;
  if p_source_type not in ('binder_export', 'evidence_artifact', 'incident', 'work_item', 'policy', 'note') then
    raise exception 'Invalid source_type' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_label, ''))) < 1 then
    raise exception 'Label is required' using errcode = '22023';
  end if;

  v_citation := nullif(btrim(coalesce(p_citation_ref, '')), '');
  if v_citation is null then
    v_citation := (regexp_match(
      btrim(p_label),
      '(?:^|[^0-9])([0-9]+(?:\.[0-9A-Za-z]+)+(?:\([^)]+\))*)'
    ))[1];
  end if;
  if v_citation is not null and length(v_citation) > 64 then
    raise exception 'citation_ref too long' using errcode = '22023';
  end if;

  insert into public.survey_evidence_packet_items (
    organization_id, facility_id, survey_day_session_id, binder_export_job_id,
    source_type, source_id, label, notes, sort_order, citation_ref, created_by
  ) values (
    coalesce(v_org, (select organization_id from public.binder_export_jobs where id = p_binder_export_job_id)),
    p_facility_id, p_survey_day_session_id, p_binder_export_job_id,
    p_source_type, p_source_id, btrim(p_label), nullif(btrim(p_notes), ''),
    coalesce(p_sort_order, 0), v_citation, auth.uid()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select i.id into v_id from public.survey_evidence_packet_items i
    where i.organization_id = coalesce(v_org, i.organization_id)
      and i.source_type = p_source_type
      and i.source_id is not distinct from p_source_id
      and i.survey_day_session_id is not distinct from p_survey_day_session_id
    limit 1;
  end if;
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
  order by app_private.survey_packet_item_regulation_key(i.citation_ref, i.label) nulls last,
           i.sort_order,
           i.created_at
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
      'citationRef', i.citation_ref,
      'binderExportJobId', i.binder_export_job_id,
      'regulationKey', app_private.survey_packet_item_regulation_key(i.citation_ref, i.label)
    ) order by app_private.survey_packet_item_regulation_key(i.citation_ref, i.label) nulls last,
              i.sort_order,
              i.created_at
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
    v_org, auth.uid(), 'survey_evidence_packet', coalesce(p_survey_day_session_id, p_binder_export_job_id, extensions.gen_random_uuid())::text,
    'packet_assembled', v_manifest
  );

  return v_manifest;
end;
$$;

revoke all on function public.add_survey_evidence_packet_item(text, text, uuid, uuid, uuid, uuid, text, integer, text) from public, anon;
revoke all on function public.list_survey_evidence_packet_items(uuid, uuid) from public, anon;
revoke all on function public.assemble_survey_evidence_packet_manifest(uuid, uuid) from public, anon;
grant execute on function public.add_survey_evidence_packet_item(text, text, uuid, uuid, uuid, uuid, text, integer, text) to authenticated;
grant execute on function public.list_survey_evidence_packet_items(uuid, uuid) to authenticated;
grant execute on function public.assemble_survey_evidence_packet_manifest(uuid, uuid) to authenticated;
