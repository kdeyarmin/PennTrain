-- Further fix for a PR #36 review finding from Codex, on the fifth fix migration (round 6).
--
-- Finding M (Codex P2): instantiate_resident_compliance_items() gates NH/HHA/HOS/GH facilities out
-- of RASP/ASP tracking implicitly -- its rule-pack join simply matches zero rows for any
-- facility_type other than 'PCH'/'ALR', so those residents get no compliance items at all (by
-- design, per Phase 5). log_resident_change_of_condition() has no equivalent guard, so a manager at
-- an unsupported facility type can still create a significant_change_reassessment item (plus its
-- downstream dashboard row, alert, and PCH-shaped 2600.225 citation tag) for a resident this app
-- doesn't model regulatory tracking for -- and ResidentDetail.tsx's "Log Change of Condition" button
-- is shown unconditionally, so there's no client-side gate either. Add the same facility-type check
-- here explicitly, matching the shape of this function's existing authorization checks.
create or replace function public.log_resident_change_of_condition(p_resident_id uuid, p_notes text default null)
returns public.resident_compliance_items
language plpgsql security definer set search_path to 'public' as $$
declare
  v_res record;
  v_facility_type text;
  v_new public.resident_compliance_items;
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
    raise exception 'not authorized to log a change of condition for this resident' using errcode = 'insufficient_privilege';
  end if;

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;
  if v_facility_type not in ('PCH', 'ALR') then
    raise exception 'resident compliance tracking is not supported for this facility type' using errcode = 'feature_not_supported';
  end if;

  insert into public.resident_compliance_items
    (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, notes)
  values
    (v_res.organization_id, v_res.facility_id, v_res.id, 'significant_change_reassessment',
     current_date, null, 2, 0, p_notes)
  returning * into v_new;

  return v_new;
end;
$$;
revoke all on function public.log_resident_change_of_condition(uuid, text) from public, anon;
grant execute on function public.log_resident_change_of_condition(uuid, text) to authenticated;
