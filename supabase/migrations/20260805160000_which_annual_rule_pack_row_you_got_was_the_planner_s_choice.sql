-- The annual medical evaluation's warning window was whichever row the planner returned first.
--
-- `resident_compliance_rule_packs` is keyed by (organization_id, state, facility_type, item_type,
-- admission_track), and its own lookup index says so. `instantiate_resident_compliance_items`
-- reads it that way -- facility type, admission track, state, tenant-or-global -- and substitutes
-- 'standard' for PCH, which has no expedited track.
--
-- The successor lookup 20260804170000 added to `complete_resident_compliance_item` dropped two of
-- those predicates. It filtered on item_type, facility_type, is_active and the tenant, then
-- `order by rp.organization_id nulls last limit 1`. For ALR that matches BOTH seeded
-- `annual_medical_evaluation` rows -- standard and expedited, carried from the two
-- `medical_evaluation` rows 20260706155617 seeded for 2800.141 -- and both are global, so they
-- tie on the only ORDER BY key and LIMIT 1 returns whichever the plan reached first.
--
-- The two rows do not agree. `warning_days` is carried from the source row: 30 on the standard
-- track, 14 on the expedited one. So an ALR resident's annual medical evaluation started warning
-- 30 days out or 14 days out with nothing in the data to say which, and the same resident could
-- get a different answer on a re-run -- the annual cycle of 55 Pa. Code 2800.141, whose whole
-- purpose is to raise the item before it lapses.
--
-- Fixed by restating the predicates the rest of the schema uses, with the same PCH substitution,
-- and by making the ORDER BY total so a duplicate key cannot reintroduce a coin flip. The
-- function is redeclared from 20260804170000; one block changes, marked CHANGE inline, and every
-- other line is carried forward verbatim.
--
-- Rollback: CREATE OR REPLACE the version from
-- 20260804170000_one_rule_pack_row_cannot_carry_two_cycles.sql.

CREATE OR REPLACE FUNCTION public.complete_resident_compliance_item(p_item_id uuid, p_document_id uuid)
 RETURNS resident_compliance_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item public.resident_compliance_items;
  v_document public.resident_documents;
  v_completed_date date := public.pa_today();
  v_updated public.resident_compliance_items;
  v_facility_type text;
  v_support_plan_citation_ref text;
  v_annual_rule public.resident_compliance_rule_packs;
  v_admission_track text;
begin
  select * into v_item from public.resident_compliance_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'resident compliance item % not found', p_item_id using errcode = 'no_data_found';
  end if;

  if not coalesce((
    public.is_platform_admin()
    or (v_item.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin', 'facility_manager')
        and public.is_assigned_to_facility(v_item.facility_id))
  ), false) then
    raise exception 'not authorized to complete this resident compliance item' using errcode = 'insufficient_privilege';
  end if;

  if v_item.status = 'compliant' and v_item.completed_date is not null then
    return v_item;
  end if;

  -- The document must exist, belong to the same resident, be linked to THIS item specifically
  -- (not just any state form on file for the resident), and be flagged as the actual state form.
  -- IS DISTINCT FROM (not <>) so a document with a null compliance_item_id -- e.g. uploaded via the
  -- generic per-resident Documents uploader without picking an item -- is correctly rejected instead
  -- of silently passing through three-valued-logic NULL comparison.
  select * into v_document from public.resident_documents where id = p_document_id;
  if v_document.id is null
     or v_document.resident_id is distinct from v_item.resident_id
     or v_document.compliance_item_id is distinct from p_item_id
     or v_document.is_state_form is not true then
    raise exception 'the state-approved DHS form for this item must be uploaded and attached before it can be marked complete -- no exception'
      using errcode = 'check_violation';
  end if;

  update public.resident_compliance_items
  set completed_date = v_completed_date, status = 'compliant'
  where id = p_item_id
  returning * into v_updated;

  -- CHANGE (20260804170000): the successor's item_type and grace are no longer inherited blindly.
  -- A completed *initial* medical evaluation renews as `annual_medical_evaluation`, and takes that
  -- item type's own rule-pack row -- which is the only reason the 15-day annual grace can be
  -- applied at all without also handing it to the initial cycle. Every other item type renews as
  -- itself on its own carried values, exactly as before.
  if v_item.item_type = 'medical_evaluation' then
    select facility_type into v_facility_type from public.facilities where id = v_item.facility_id;
    -- CHANGE (20260805160000): admission_track and state, the two predicates every other
    -- rule-pack lookup in this schema uses. Without the track this SELECT matched both ALR
    -- medical-evaluation rows, they tie on the only ORDER BY key, and which one LIMIT 1 returned
    -- was the planner's choice -- so an expedited resident's annual evaluation got a 30-day
    -- warning window or a 14-day one at random. PCH has one track, exactly as
    -- instantiate_resident_compliance_items assumes when it substitutes 'standard'.
    select case when v_facility_type = 'ALR' then r.admission_track else 'standard' end
    into v_admission_track
    from public.residents r where r.id = v_item.resident_id;

    select * into v_annual_rule
    from public.resident_compliance_rule_packs rp
    where rp.item_type = 'annual_medical_evaluation'
      and rp.facility_type = v_facility_type
      and rp.admission_track = coalesce(v_admission_track, 'standard')
      and rp.state = 'PA'
      and rp.is_active
      and (rp.organization_id = v_item.organization_id or rp.organization_id is null)
    -- A tenant override wins, and beyond that the newest row does: two rows on the same key are
    -- not supposed to exist, and if they ever do the answer must still not depend on the plan.
    order by rp.organization_id nulls last, rp.created_at desc, rp.id
    limit 1;

    if v_annual_rule.id is not null then
      insert into public.resident_compliance_items
        (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days)
      values
        (v_item.organization_id, v_item.facility_id, v_item.resident_id, 'annual_medical_evaluation',
         v_completed_date + v_annual_rule.renewal_interval_days, v_annual_rule.renewal_interval_days,
         v_annual_rule.warning_days, v_annual_rule.grace_period_days);
    end if;
  elsif v_item.renewal_interval_days is not null then
    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, v_item.item_type,
       v_completed_date + v_item.renewal_interval_days, v_item.renewal_interval_days, v_item.warning_days, v_item.grace_period_days);
  end if;

  if v_item.item_type in ('annual_reassessment', 'significant_change_reassessment')
     and not exists (select 1 from public.resident_compliance_items where triggered_by_item_id = p_item_id) then
    select facility_type into v_facility_type from public.facilities where id = v_item.facility_id;
    v_support_plan_citation_ref := case when v_facility_type = 'ALR' then '2800.224' else '2600.227' end;

    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, citation_topic_id, triggered_by_item_id)
    values
      (v_item.organization_id, v_item.facility_id, v_item.resident_id, 'support_plan_30day',
       v_completed_date + 30, null, 14, 0,
       (select id from public.dhs_citation_topics where citation_ref = v_support_plan_citation_ref),
       p_item_id);
  end if;

  return v_updated;
end;
$function$;
