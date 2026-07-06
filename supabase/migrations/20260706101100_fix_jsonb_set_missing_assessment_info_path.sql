-- Further fix for a PR #36 review finding from Codex, on the ninth fix migration (round 13).
--
-- Finding AD (Codex P2): the previous round's fix set content.assessmentInfo.assessmentReason/
-- supportPlanReason via two nested jsonb_set calls, but jsonb_set does not create missing
-- intermediate path elements -- only the final key in the path -- so for a resident's first
-- ('initial') form, or any prior content that never had an assessmentInfo key at all,
-- coalesce(v_prior_finalized.content, '{}'::jsonb) has no assessmentInfo object for that nested
-- path to land in, and the whole jsonb_set call is silently a no-op. Confirmed directly against a
-- fresh shadow-DB insert: content stayed exactly '{}', not the intended reason-populated shape --
-- this was NOT caught by this pass's own smoke test, which had its own bug (a `<>` comparison
-- against a NULL value evaluates to NULL, which `if` treats as false, silently skipping the
-- assertion; fixed here by testing the underlying behavior directly with psql rather than relying
-- on that flawed test). Fix: build/merge the assessmentInfo object itself (defaulting to '{}' if
-- absent) before writing it back as a single key, which does not require the key to already exist.
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

  v_content := coalesce(v_prior_finalized.content, '{}'::jsonb);
  v_content := jsonb_set(
    v_content,
    '{assessmentInfo}',
    coalesce(v_content->'assessmentInfo', '{}'::jsonb)
      || jsonb_build_object('assessmentReason', p_reason, 'supportPlanReason', p_reason)
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
