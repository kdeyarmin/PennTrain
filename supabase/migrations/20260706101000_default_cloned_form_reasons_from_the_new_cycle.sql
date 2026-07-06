-- Further fix for a PR #36 review finding from Codex, on the eighth fix migration (round 12).
--
-- Finding AA (Codex P2): start_resident_assessment_form() clones a prior finalized form's content
-- verbatim onto a new cycle -- the row's own `reason` column correctly reflects why this cycle
-- started (p_reason), but content.assessmentInfo.assessmentReason/supportPlanReason (the actual
-- fields the editor and PDF render) still say whatever the PRIOR cycle's reason was, often
-- "initial". A user starting an annual/significant-change cycle has to notice and manually fix both
-- selects, or the exported document reports the wrong reason. Set both fields to match p_reason at
-- clone time -- the user can still change either one in the editor if it genuinely needs to diverge
-- from the row-level reason (e.g. the assessment portion and support-plan portion happening for
-- different reasons in the same cycle).
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

  perform public.assert_resident_assessment_compliance_item_valid(p_compliance_item_id, p_resident_id);

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

  v_content := jsonb_set(
    jsonb_set(coalesce(v_prior_finalized.content, '{}'::jsonb), '{assessmentInfo,assessmentReason}', to_jsonb(p_reason)),
    '{assessmentInfo,supportPlanReason}', to_jsonb(p_reason)
  );

  insert into public.resident_assessment_forms
    (organization_id, facility_id, resident_id, compliance_item_id, form_type, reason,
     version_number, cloned_from_id, status, content, prepared_by_profile_id, prepared_by_name, prepared_by_title, prepared_date)
  values (
    v_res.organization_id, v_res.facility_id, v_res.id, p_compliance_item_id, v_form_type, p_reason,
    v_next_version, v_prior_finalized.id, 'draft', v_content,
    auth.uid(), coalesce(v_profile.first_name || ' ' || v_profile.last_name, ''), coalesce(v_profile.role, ''),
    current_date
  )
  returning * into v_new;

  return v_new;
end;
$$;
revoke all on function public.start_resident_assessment_form(uuid, text, uuid) from public, anon;
grant execute on function public.start_resident_assessment_form(uuid, text, uuid) to authenticated;
