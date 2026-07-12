-- Bug fix for the prior migration: jsonb_set's default create_missing=true only creates the FINAL
-- path element, not intermediate ones missing from a scalar/absent parent in older Postgres
-- semantics as actually observed here -- when v_content had no 'assessmentInfo' key at all (a
-- true first-ever 'initial' form with no prior version), the jsonb_set call above silently no-op'd
-- and assessmentReason/supportPlanReason never got set. Rewritten to build the assessmentInfo
-- object directly instead of relying on jsonb_set's path-creation behavior.
create or replace function public.start_resident_assessment_form(
  p_resident_id uuid, p_reason text, p_compliance_item_id uuid default null
)
returns public.resident_assessment_forms
language plpgsql security definer set search_path to 'public' as $$
declare
  v_res record;
  v_facility_type text;
  v_form_type text;
  v_prior public.resident_assessment_forms;
  v_new public.resident_assessment_forms;
  v_profile record;
  v_next_version integer;
  v_content jsonb;
begin
  select id, organization_id, facility_id into v_res from public.residents where id = p_resident_id;
  if v_res.id is null then
    raise exception 'resident % not found', p_resident_id using errcode = 'no_data_found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_res.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_res.facility_id))
  ) then
    raise exception 'not authorized to start an assessment form for this resident' using errcode = 'insufficient_privilege';
  end if;

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;
  v_form_type := case when v_facility_type = 'ALR' then 'ASP' else 'RASP' end;

  select * into v_prior from public.resident_assessment_forms
  where resident_id = p_resident_id and form_type = v_form_type and status = 'finalized'
  order by version_number desc limit 1;

  select first_name, last_name, role into v_profile from public.profiles where id = auth.uid();
  v_next_version := coalesce(v_prior.version_number, 0) + 1;

  v_content := coalesce(v_prior.content, '{}'::jsonb);
  v_content := v_content || jsonb_build_object(
    'assessmentInfo',
    coalesce(v_content->'assessmentInfo', '{}'::jsonb)
      || jsonb_build_object('assessmentReason', p_reason, 'supportPlanReason', p_reason)
  );

  insert into public.resident_assessment_forms
    (organization_id, facility_id, resident_id, compliance_item_id, form_type, reason,
     version_number, cloned_from_id, status, content, prepared_by_profile_id, prepared_by_name, prepared_by_title, prepared_date)
  values (
    v_res.organization_id, v_res.facility_id, v_res.id, p_compliance_item_id, v_form_type, p_reason,
    v_next_version, v_prior.id, 'draft',
    v_content,
    auth.uid(), coalesce(v_profile.first_name || ' ' || v_profile.last_name, ''), coalesce(v_profile.role, ''),
    current_date
  )
  returning * into v_new;

  return v_new;
end;
$$;
revoke all on function public.start_resident_assessment_form(uuid, text, uuid) from public, anon;
grant execute on function public.start_resident_assessment_form(uuid, text, uuid) to authenticated;
