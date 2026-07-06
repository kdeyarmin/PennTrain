-- Tier 3.6 Phase 2: support-plan cross-trigger + change-of-condition logging. Moves completion
-- logic server-side (out of the client hook) so it's correct regardless of which UI surface
-- touches the row, and adds the significant_change_reassessment item type's only entry point.

-- Lets the UI show "Support Plan Revision -- triggered by Annual Reassessment completed <date>"
-- instead of an unexplained duplicate row.
alter table public.resident_compliance_items add column triggered_by_item_id uuid references public.resident_compliance_items(id);

-- Replaces the client-side two-call (update + insert) logic in useCompleteResidentComplianceItem().
-- Recurring items (renewal_interval_days set) schedule their next cycle as a new row, same
-- convention as before. New: completing annual_reassessment or significant_change_reassessment
-- also inserts a linked support_plan_30day row due 30 days out, satisfying 2600.227/2800.227's
-- support-plan revision requirement -- guarded by an idempotency check so re-invoking this RPC on
-- an already-completed item never double-spawns the revision.
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

-- Only entry point for significant_change_reassessment: PA DHS states no numeric turnaround for
-- this trigger anywhere in the regulation text or RCG, so due_date is the date logged (immediate),
-- zero grace -- see the comment on resident_compliance_items.grace_period_days for the same note.
-- p_notes is a short compliance-tracking annotation (e.g. "fall, ER visit 7/3"), the same shape as
-- free-text fields already used elsewhere in this schema (e.g. incidents.description) -- not a
-- clinical record.
create or replace function public.log_resident_change_of_condition(p_resident_id uuid, p_notes text default null)
returns public.resident_compliance_items
language plpgsql security definer set search_path to 'public' as $$
declare
  v_res record;
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
