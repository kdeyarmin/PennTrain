-- Product requirement (explicit, no exception): documents like the RASP/ASP and DME are DHS-
-- prescribed forms. A resident_compliance_items row may only be marked 'compliant' once the actual
-- state-approved form has been uploaded and attached to that specific item -- CareMetric's own
-- digital-form editor and its generated reference PDF are prep/drafting tools, not a substitute.
-- Previously complete_resident_compliance_item() required no evidence at all (a bare button click),
-- and finalizing the digital RASP/ASP form auto-completed the linked item from the custom-rendered
-- layout alone. Both paths are closed here.

-- is_state_form distinguishes an actually-completed DHS form (uploaded by staff) from every other
-- resident_documents row, including generate-resident-assessment-pdf's own CareMetric-rendered
-- output -- that function stamps compliance_item_id too, so without this flag its own reference PDF
-- would silently satisfy the very requirement it isn't allowed to satisfy.
alter table public.resident_documents add column is_state_form boolean not null default false;
comment on column public.resident_documents.is_state_form is
  'True only when this document IS the actual DHS-prescribed form (RASP/ASP, DME, Preadmission '
  'Screening, etc.) as completed and uploaded by facility staff -- never true for a CareMetric-'
  'generated reference PDF. complete_resident_compliance_item() requires a linked document with '
  'this flag set before an item can be marked compliant; there is no exception path.';

-- Signature change (uuid) -> (uuid, uuid): drop the old 1-arg version outright rather than leaving
-- it callable alongside the new one -- an old cached PostgREST/client call routing to the
-- no-document version would be exactly the bypass this migration exists to close.
drop function if exists public.complete_resident_compliance_item(uuid) cascade;
create or replace function public.complete_resident_compliance_item(p_item_id uuid, p_document_id uuid)
returns public.resident_compliance_items
language plpgsql security definer set search_path to 'public' as $$
declare
  v_item public.resident_compliance_items;
  v_document public.resident_documents;
  v_completed_date date := current_date;
  v_updated public.resident_compliance_items;
  v_facility_type text;
  v_support_plan_citation_ref text;
begin
  select * into v_item from public.resident_compliance_items where id = p_item_id for update;
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

  if v_item.renewal_interval_days is not null then
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
$$;
revoke all on function public.complete_resident_compliance_item(uuid, uuid) from public, anon;
grant execute on function public.complete_resident_compliance_item(uuid, uuid) to authenticated;

-- Finalizing the digital RASP/ASP prep form can no longer auto-complete the linked compliance item
-- -- there is no document to satisfy the new gate above, and there must not be a second, weaker path
-- to 'compliant' that bypasses it. Finalize now only freezes the draft/creates the version lineage;
-- completing the item is always the explicit, document-gated action above.
create or replace function public.finalize_resident_assessment_form(p_form_id uuid)
returns public.resident_assessment_forms
language plpgsql security definer set search_path to 'public' as $$
declare
  v_form public.resident_assessment_forms;
  v_updated public.resident_assessment_forms;
begin
  select * into v_form from public.resident_assessment_forms where id = p_form_id for update;
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

  perform public.assert_resident_assessment_compliance_item_valid(v_form.compliance_item_id, v_form.resident_id);

  update public.resident_assessment_forms
  set status = 'finalized', finalized_at = now()
  where id = p_form_id
  returning * into v_updated;

  if v_form.cloned_from_id is not null then
    update public.resident_assessment_forms set superseded_by_id = p_form_id where id = v_form.cloned_from_id;
  end if;

  return v_updated;
end;
$$;
revoke all on function public.finalize_resident_assessment_form(uuid) from public, anon;
grant execute on function public.finalize_resident_assessment_form(uuid) to authenticated;
