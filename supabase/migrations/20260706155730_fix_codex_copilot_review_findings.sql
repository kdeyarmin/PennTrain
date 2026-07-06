insert into public.resident_compliance_rule_packs
  (facility_type, item_type, admission_track, offset_basis, offset_days, renewal_interval_days, grace_period_days, warning_days, citation_ref, notes)
values
  ('ALR', 'annual_reassessment', 'expedited', 'after_admission', 365, 365, 0, 30, '2800.225',
   'Same as the standard-track row -- the annual cycle does not differ by admission track, only the '
   'initial assessment/support-plan timing does. Grace period unconfirmed, same caveat as the '
   'standard-track row.');

alter policy resident_assessment_forms_update on public.resident_assessment_forms using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id)
      and status = 'draft')
) with check (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(facility_id)
      and status = 'draft')
);

create or replace function public.complete_resident_compliance_item(p_item_id uuid)
returns public.resident_compliance_items
language plpgsql security definer set search_path to 'public' as $$
declare
  v_item public.resident_compliance_items;
  v_completed_date date := current_date;
  v_updated public.resident_compliance_items;
begin
  select * into v_item from public.resident_compliance_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'resident compliance item % not found', p_item_id using errcode = 'no_data_found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_item.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_item.facility_id))
  ) then
    raise exception 'not authorized to complete this resident compliance item' using errcode = 'insufficient_privilege';
  end if;

  if v_item.status = 'compliant' and v_item.completed_date is not null then
    return v_item;
  end if;

  update public.resident_compliance_items
  set completed_date = v_completed_date, status = 'compliant'
  where id = p_item_id
  returning * into v_updated;

  if v_item.renewal_interval_days is not null then
    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, v_item.item_type,
       v_completed_date + v_item.renewal_interval_days, v_item.renewal_interval_days, v_item.warning_days, v_item.grace_period_days);
  end if;

  if v_item.item_type in ('annual_reassessment', 'significant_change_reassessment')
     and not exists (select 1 from public.resident_compliance_items where triggered_by_item_id = p_item_id) then
    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, triggered_by_item_id)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, 'support_plan_30day',
       v_completed_date + 30, null, 14, 0, p_item_id);
  end if;

  return v_updated;
end;
$$;
revoke all on function public.complete_resident_compliance_item(uuid) from public, anon;
grant execute on function public.complete_resident_compliance_item(uuid) to authenticated;

create or replace function public.finalize_resident_assessment_form(p_form_id uuid)
returns public.resident_assessment_forms
language plpgsql security definer set search_path to 'public' as $$
declare
  v_form public.resident_assessment_forms;
  v_updated public.resident_assessment_forms;
begin
  select * into v_form from public.resident_assessment_forms where id = p_form_id;
  if v_form.id is null then
    raise exception 'resident assessment form % not found', p_form_id using errcode = 'no_data_found';
  end if;

  if not (
    public.is_platform_admin()
    or (v_form.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_form.facility_id))
  ) then
    raise exception 'not authorized to finalize this assessment form' using errcode = 'insufficient_privilege';
  end if;

  if v_form.status = 'finalized' then
    return v_form;
  end if;

  update public.resident_assessment_forms
  set status = 'finalized', finalized_at = now()
  where id = p_form_id
  returning * into v_updated;

  if v_form.cloned_from_id is not null then
    update public.resident_assessment_forms set superseded_by_id = p_form_id where id = v_form.cloned_from_id;
  end if;

  if v_form.compliance_item_id is not null then
    perform public.complete_resident_compliance_item(v_form.compliance_item_id);
  end if;

  return v_updated;
end;
$$;
revoke all on function public.finalize_resident_assessment_form(uuid) from public, anon;
grant execute on function public.finalize_resident_assessment_form(uuid) to authenticated;

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

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;
  v_form_type := case when v_facility_type = 'ALR' then 'ASP' else 'RASP' end;

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
