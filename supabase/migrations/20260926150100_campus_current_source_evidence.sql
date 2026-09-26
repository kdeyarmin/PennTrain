-- A campus move carries the latest existing source records; it cannot cherry-pick
-- an older plan or reset a review cycle. The RCG imposes a one-year limit on the
-- medical evaluation, not an invented age cutoff on the existing assessment/plan.
alter function public.carry_campus_resident_evidence(uuid,uuid,uuid,jsonb) rename to carry_campus_resident_evidence_core;
alter function public.carry_campus_resident_evidence_core(uuid,uuid,uuid,jsonb) set schema app_private;
revoke all on function app_private.carry_campus_resident_evidence_core(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
do $patch$ declare v_definition text; begin
 select pg_get_functiondef('app_private.carry_campus_resident_evidence_core(uuid,uuid,uuid,jsonb)'::regprocedure) into v_definition;
 v_definition:=replace(v_definition,'''medical_evaluation'',''annual_medical_evaluation''','''medical_evaluation'',''annual_medical_evaluation'',''change_medical_evaluation''');
 execute v_definition;
end $patch$;
create function public.carry_campus_resident_evidence(p_resident_id uuid,p_source_resident_id uuid,p_addendum_document_id uuid,p_evidence jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v public.residents%rowtype; v_source public.residents%rowtype; v_kind text; v_types text[];
 v_item public.resident_compliance_items%rowtype; v_plan_date date; v_review public.resident_compliance_items%rowtype; v_target public.resident_compliance_items%rowtype;
 v_review_doc uuid; v_source_due date; v_type text;
begin
 select * into v from public.residents where id=p_resident_id for update;
 select * into v_source from public.residents where id=p_source_resident_id for update;
 if v.id is null or v_source.id is null then raise exception 'Both campus resident records must exist' using errcode='P0002'; end if;
 perform app_private.assert_resident_regulatory_manager(v.organization_id,v.facility_id);
 perform app_private.assert_resident_regulatory_manager(v_source.organization_id,v_source.facility_id);
 foreach v_kind in array array['medical_evaluation','initial_assessment_15day','support_plan_30day'] loop
  v_types:=case v_kind when 'medical_evaluation' then array['medical_evaluation','annual_medical_evaluation','change_medical_evaluation']
    when 'initial_assessment_15day' then array['initial_assessment_15day','annual_reassessment','significant_change_reassessment'] else array['support_plan_30day'] end;
  select * into v_item from public.resident_compliance_items where id=nullif(p_evidence->v_kind->>'source_item_id','')::uuid and resident_id=v_source.id;
  if v_item.id is null or exists(select 1 from public.resident_compliance_items where resident_id=v_source.id and item_type=any(v_types) and status='compliant'
    and completed_date<=v.admission_date and completed_date>v_item.completed_date) then
    raise exception 'Carry the latest completed source % applicable on the move day',v_kind using errcode='23514'; end if;
  if v_kind='support_plan_30day' then v_plan_date:=v_item.completed_date; end if;
 end loop;
 select * into v_review from public.resident_compliance_items where resident_id=v_source.id and item_type='support_plan_quarterly_review'
   and status='compliant' and completed_date between v_plan_date and v.admission_date order by completed_date desc,created_at desc,id limit 1;
 if v_review.id is not null then
  v_review_doc:=nullif(p_evidence->'support_plan_quarterly_review'->>'document_id','')::uuid;
  if nullif(p_evidence->'support_plan_quarterly_review'->>'source_item_id','')::uuid is distinct from v_review.id
    or not exists(select 1 from public.resident_documents where compliance_item_id=v_review.id and resident_id=v_source.id and is_state_form)
    or not exists(select 1 from public.resident_documents where id=v_review_doc and resident_id=v.id and is_state_form) then
    raise exception 'Carry a signed receiving-facility copy of the latest documented quarterly review' using errcode='23514'; end if;
 end if;
 perform app_private.carry_campus_resident_evidence_core(p_resident_id,p_source_resident_id,p_addendum_document_id,p_evidence);
 -- A change-triggered DME does not restart the original annual evaluation cycle.
 -- An overdue source cycle stays overdue after transfer.
 foreach v_kind in array array['annual_medical_evaluation','annual_reassessment'] loop
  select due_date into v_source_due from public.resident_compliance_items where resident_id=v_source.id and item_type=v_kind and completed_date is null order by due_date,id limit 1;
  if found then update public.resident_compliance_items set due_date=v_source_due where resident_id=v.id and item_type=v_kind and completed_date is null; end if;
 end loop;
 select facility_type into v_type from public.facilities where id=v.facility_id;
 if v_review.id is not null and v_type='ALR' then
  select * into v_target from public.resident_compliance_items where resident_id=v.id and item_type='support_plan_quarterly_review' and completed_date is null for update;
  if v_target.id is null then raise exception 'Receiving quarterly review cycle is missing' using errcode='23514'; end if;
  update public.resident_documents set compliance_item_id=v_target.id where id=v_review_doc;
  update public.resident_compliance_items set completed_date=v_review.completed_date,status='compliant',carried_from_item_id=v_review.id where id=v_target.id;
  insert into public.resident_compliance_items(organization_id,facility_id,resident_id,item_type,due_date,renewal_interval_days,warning_days,grace_period_days,citation_topic_id)
  values(v.organization_id,v.facility_id,v.id,'support_plan_quarterly_review',(v_review.completed_date+interval '3 months')::date,90,14,5,v_target.citation_topic_id);
 end if;
 perform public.recalculate_resident_compliance_statuses();
end $$;
revoke all on function public.carry_campus_resident_evidence(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.carry_campus_resident_evidence(uuid,uuid,uuid,jsonb) to authenticated,service_role;
