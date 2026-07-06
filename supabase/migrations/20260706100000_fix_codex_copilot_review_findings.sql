-- Fixes for PR #36 (Tier 3.6) review findings from the Codex and Copilot GitHub review bots.
-- Each finding was independently re-verified against the actual code before being addressed here;
-- see the plan doc's "Post-review fix pass" section for the full trace. The 5 migrations this PR
-- already shipped are applied to a live Supabase preview branch (tracked by filename+checksum), so
-- every fix here is a new migration rather than an edit to those files, mirroring this repo's own
-- precedent (e.g. 20260705163816_fix_checkin_token_url_safety.sql followed
-- 20260705162933_class_checkin_core.sql as a separate file).

-- Finding 1 (Codex, P2): the ALR rule-pack seed only inserted an annual_reassessment row for the
-- 'standard' admission track. instantiate_resident_compliance_items() requires an exact
-- admission_track match, so every 'expedited'-track ALR resident got zero annual-reassessment
-- tracking -- no due date, no alerts, ever. The annual cycle itself doesn't differ by admission
-- track (only the initial admission-window timing does), so this mirrors the standard-track row.
insert into public.resident_compliance_rule_packs
  (facility_type, item_type, admission_track, offset_basis, offset_days, renewal_interval_days, grace_period_days, warning_days, citation_ref, notes)
values
  ('ALR', 'annual_reassessment', 'expedited', 'after_admission', 365, 365, 0, 30, '2800.225',
   'Same as the standard-track row -- the annual cycle does not differ by admission track, only the '
   'initial assessment/support-plan timing does. Grace period unconfirmed, same caveat as the '
   'standard-track row.');

-- Finding 2 (Codex P1 + Copilot): the update policy never checked status, so an org_admin/
-- facility_manager could update a finalized form's content directly via the API, bypassing the
-- editor UI's isReadOnly guard (a frontend convention, not a security boundary) and silently
-- diverging the stored "legal" record from its already-generated PDF.
-- finalize_resident_assessment_form() and its cloned_from_id/superseded_by_id update both run
-- security definer, so they bypass RLS entirely and are unaffected by this tightening.
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

-- Finding 3 (Codex P2 + Copilot): complete_resident_compliance_item() wasn't idempotent -- calling
-- it on an already-completed item re-set completed_date and, for recurring item types, inserted
-- another next-cycle row every time. Two real paths hit this: a double-click on ResidentDetail's
-- manual "complete" checkmark, and retrying finalize_resident_assessment_form() after a
-- PDF-generation failure (finding 4) re-running the completion call on an item that's already
-- compliant. This early-return guard is the root-cause fix and covers both paths.
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

-- Finding 4 (Copilot): even with finding 3 fixed, calling finalize twice still overwrote
-- finalized_at with a new timestamp and re-ran the cloned_from_id supersession update, which is
-- wrong for what's supposed to be an immutable legal timestamp.
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

-- Finding 5 (Copilot): version_number was computed from the latest *finalized* form only. If an
-- unfinalized draft already existed at version N (e.g. a double-clicked "Complete in CareMetric"
-- button, or two different compliance items each triggering a start), a second call still saw the
-- latest finalized version as the baseline and could assign a colliding version_number to a second
-- draft row. Fixed to compute the next version from the max across all statuses, while still
-- cloning content from the latest finalized row specifically (unchanged).
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
