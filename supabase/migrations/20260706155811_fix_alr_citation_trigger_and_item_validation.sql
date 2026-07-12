create or replace function public.auto_tag_resident_compliance_item_citation_topic()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_facility_type text; v_category text;
begin
  if new.citation_topic_id is null then
    select facility_type into v_facility_type from public.facilities where id = new.facility_id;

    if new.item_type = 'medical_evaluation' then
      v_category := case when v_facility_type = 'ALR' then 'ALR Medical Evaluations' else 'Resident Medical Evaluations' end;
    elsif new.item_type = 'preadmission_screening' then
      v_category := 'Resident Preadmission Screening';
    elsif new.item_type in ('support_plan_30day', 'initial_assessment_15day') then
      v_category := case
        when v_facility_type = 'ALR' then 'ALR Initial Assessment & Support Plan'
        when new.item_type = 'support_plan_30day' then 'Resident Support Plans'
        else 'Resident Assessments'
      end;
    else
      v_category := case when v_facility_type = 'ALR' then 'ALR Annual & Significant-Change Reassessment' else 'Resident Assessments' end;
    end if;

    select id into new.citation_topic_id from public.dhs_citation_topics where category = v_category;
  end if;
  return new;
end;
$$;
revoke all on function public.auto_tag_resident_compliance_item_citation_topic() from public, anon, authenticated;

create or replace function public.start_resident_assessment_form(
  p_resident_id uuid, p_reason text, p_compliance_item_id uuid default null
)
returns public.resident_assessment_forms
language plpgsql security definer set search_path to 'public' as $$
declare
  v_res record;
  v_facility_type text;
  v_form_type text;
  v_prior_finalized public.resident_assessment_forms;
  v_max_version integer;
  v_new public.resident_assessment_forms;
  v_profile record;
  v_next_version integer;
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

  if p_compliance_item_id is not null
     and not exists (
       select 1 from public.resident_compliance_items
       where id = p_compliance_item_id and resident_id = p_resident_id
     ) then
    raise exception 'compliance item % does not belong to resident %', p_compliance_item_id, p_resident_id
      using errcode = 'invalid_parameter_value';
  end if;

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;
  v_form_type := case when v_facility_type = 'ALR' then 'ASP' else 'RASP' end;

  perform pg_advisory_xact_lock(hashtext(p_resident_id::text || ':' || v_form_type));

  select * into v_prior_finalized from public.resident_assessment_forms
  where resident_id = p_resident_id and form_type = v_form_type and status = 'finalized'
  order by version_number desc limit 1;

  select max(version_number) into v_max_version from public.resident_assessment_forms
  where resident_id = p_resident_id and form_type = v_form_type;

  select first_name, last_name, role into v_profile from public.profiles where id = auth.uid();
  v_next_version := coalesce(v_max_version, 0) + 1;

  insert into public.resident_assessment_forms
    (organization_id, facility_id, resident_id, compliance_item_id, form_type, reason,
     version_number, cloned_from_id, status, content, prepared_by_profile_id, prepared_by_name, prepared_by_title, prepared_date)
  values (
    v_res.organization_id, v_res.facility_id, v_res.id, p_compliance_item_id, v_form_type, p_reason,
    v_next_version, v_prior_finalized.id, 'draft',
    coalesce(v_prior_finalized.content, '{}'::jsonb),
    auth.uid(), coalesce(v_profile.first_name || ' ' || v_profile.last_name, ''), coalesce(v_profile.role, ''),
    current_date
  )
  returning * into v_new;

  return v_new;
end;
$$;
revoke all on function public.start_resident_assessment_form(uuid, text, uuid) from public, anon;
grant execute on function public.start_resident_assessment_form(uuid, text, uuid) to authenticated;
