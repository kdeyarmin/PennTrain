-- Further fixes for PR #36 review findings from Codex, on the second fix migration.
--
-- Finding D (Codex P2): the prior fix migration only corrected citation_topic_id for the ONE
-- insert path it touched (the triggered support_plan_30day row in
-- complete_resident_compliance_item()). Two other insert paths still relied on
-- auto_tag_resident_compliance_item_citation_topic()'s fallback, which has zero facility-type
-- awareness and always assigns the PCH-numbered (2600.x) topic: the renewal-row insert in
-- complete_resident_compliance_item() (for recurring annual_reassessment/medical_evaluation
-- cycles) and log_resident_change_of_condition()'s significant_change_reassessment insert. Rather
-- than patch every individual call site one at a time (clearly error-prone, as this finding
-- demonstrates), this fixes the root cause: the trigger itself is now facility-type-aware, so
-- every insert path that leaves citation_topic_id null -- present, future, anywhere in the
-- codebase -- gets the correct topic automatically. stamp_scope_from_resident() (trigger name
-- "stamp_scope") fires before trg_auto_tag_resident_compliance_item_citation_topic()
-- alphabetically, so new.facility_id is already populated by the time this runs.
create or replace function public.auto_tag_resident_compliance_item_citation_topic()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_facility_type text; v_category text;
begin
  if new.citation_topic_id is null then
    select facility_type into v_facility_type from public.facilities where id = new.facility_id;

    if new.item_type = 'medical_evaluation' then
      v_category := case when v_facility_type = 'ALR' then 'ALR Medical Evaluations' else 'Resident Medical Evaluations' end;
    elsif new.item_type = 'preadmission_screening' then
      -- ALR doesn't seed this item type at all (Phase 5's rule pack has no ALR preadmission_screening
      -- row), so this branch is effectively PCH-only already.
      v_category := 'Resident Preadmission Screening';
    elsif new.item_type in ('support_plan_30day', 'initial_assessment_15day') then
      -- Ch. 2800.224 covers the initial assessment AND preliminary support plan together for ALR;
      -- PCH keeps its existing split (2600.227 for the support plan, 2600.225 for the assessment).
      v_category := case
        when v_facility_type = 'ALR' then 'ALR Initial Assessment & Support Plan'
        when new.item_type = 'support_plan_30day' then 'Resident Support Plans'
        else 'Resident Assessments'
      end;
    else
      -- annual_reassessment, significant_change_reassessment
      v_category := case when v_facility_type = 'ALR' then 'ALR Annual & Significant-Change Reassessment' else 'Resident Assessments' end;
    end if;

    select id into new.citation_topic_id from public.dhs_citation_topics where category = v_category;
  end if;
  return new;
end;
$$;
revoke all on function public.auto_tag_resident_compliance_item_citation_topic() from public, anon, authenticated;

-- Finding E (Codex P2): p_compliance_item_id was accepted and stored without verifying it actually
-- belongs to p_resident_id. A caller authorized for one resident could pass a different resident's
-- compliance_item_id; finalizing that form would then call complete_resident_compliance_item() on
-- the wrong resident's row, marking an unrelated deadline compliant.
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
