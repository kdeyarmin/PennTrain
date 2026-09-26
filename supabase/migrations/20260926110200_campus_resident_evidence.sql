-- REG33: campus moves preserve actual completed evidence through a specific path.
-- Ordinary PCH initial assessments/plans consequently use a post-admission floor.
alter table public.residents add column campus_transfer_evidence jsonb;
alter table public.resident_compliance_items add column carried_from_item_id uuid references public.resident_compliance_items(id) on delete restrict;
create index resident_compliance_carried_from_idx on public.resident_compliance_items(carried_from_item_id) where carried_from_item_id is not null;

create or replace function public.resident_compliance_backdate_days(p_item_type text,p_facility_type text)
returns integer language sql immutable set search_path='' as $$
 select case when p_item_type='medical_evaluation' then 60 when p_item_type='preadmission_screening' then 30
 when p_item_type='initial_assessment_15day' and p_facility_type='ALR' then 30
 when p_item_type in ('initial_assessment_15day','support_plan_30day') and p_facility_type in ('PCH','ALR') then 0 else 180 end;
$$;

create function public.carry_campus_resident_evidence(p_resident_id uuid,p_source_resident_id uuid,p_addendum_document_id uuid,p_evidence jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v public.residents%rowtype; v_source public.residents%rowtype; v_facility public.facilities%rowtype; v_source_facility public.facilities%rowtype;
 v_kind text; v_source_item public.resident_compliance_items%rowtype; v_target public.resident_compliance_items%rowtype; v_document uuid; v_due date;
begin
 select * into v from public.residents where id=p_resident_id for update;
 select * into v_source from public.residents where id=p_source_resident_id for update;
 if v.id is null or v_source.id is null then raise exception 'Both campus resident records must exist' using errcode='P0002'; end if;
 perform app_private.assert_resident_regulatory_manager(v.organization_id,v.facility_id);
 perform app_private.assert_resident_regulatory_manager(v_source.organization_id,v_source.facility_id);
 if lower(btrim(v.first_name)) is distinct from lower(btrim(v_source.first_name))
   or lower(btrim(v.last_name)) is distinct from lower(btrim(v_source.last_name))
   or v.date_of_birth is null or v.date_of_birth is distinct from v_source.date_of_birth then
   raise exception 'Verify the same resident identity and birth date on both campus records before carrying clinical evidence' using errcode='23514'; end if;
 select * into v_facility from public.facilities where id=v.facility_id;
 select * into v_source_facility from public.facilities where id=v_source.facility_id;
 if v.organization_id<>v_source.organization_id or v.facility_id=v_source.facility_id
   or v_facility.facility_type not in ('PCH','ALR') or v_source_facility.facility_type not in ('PCH','ALR')
   or nullif(btrim(v_facility.campus_identifier),'') is null or v_facility.campus_identifier is distinct from v_source_facility.campus_identifier
   or v.admission_date is null or v.admission_date>public.pa_today()
   or v_source.status<>'discharged' or v_source.discharge_date is distinct from v.admission_date then
   raise exception 'A campus move requires matching documented campuses, separate licensed homes, and source discharge on the actual destination admission day' using errcode='23514'; end if;
 if v.campus_transfer_evidence is not null then raise exception 'Campus evidence was already carried; preserve the existing history' using errcode='23514'; end if;
 if not exists(select 1 from public.resident_documents where id=p_addendum_document_id and resident_id=v.id) then
   raise exception 'Upload the dated campus-move addendum to the receiving resident record' using errcode='23514'; end if;
 if jsonb_typeof(p_evidence) is distinct from 'object' then raise exception 'Select the source items and receiving copies' using errcode='23514'; end if;
 foreach v_kind in array array['medical_evaluation','initial_assessment_15day','support_plan_30day'] loop
   select * into v_source_item from public.resident_compliance_items where id=nullif(p_evidence->v_kind->>'source_item_id','')::uuid and resident_id=v_source.id;
   select * into v_target from public.resident_compliance_items where resident_id=v.id and item_type=v_kind and completed_date is null order by created_at,id limit 1 for update;
   if v_source_item.id is null or v_target.id is null or v_source_item.status<>'compliant' or v_source_item.completed_date is null
     or v_source_item.completed_date>v.admission_date or not exists(select 1 from public.resident_documents where compliance_item_id=v_source_item.id and resident_id=v_source.id and is_state_form)
     or (v_kind='medical_evaluation' and (v_source_item.item_type not in ('medical_evaluation','annual_medical_evaluation') or v_source_item.completed_date<(v.admission_date-interval '1 year')::date))
     or (v_kind='initial_assessment_15day' and v_source_item.item_type not in ('initial_assessment_15day','annual_reassessment','significant_change_reassessment'))
     or (v_kind='support_plan_30day' and v_source_item.item_type<>'support_plan_30day') then
     raise exception 'The carried % must be completed, supported by its signed DHS form, and eligible on the actual move date',v_kind using errcode='23514'; end if;
   v_document:=nullif(p_evidence->v_kind->>'document_id','')::uuid;
   if not exists(select 1 from public.resident_documents where id=v_document and resident_id=v.id and compliance_item_id=v_target.id and is_state_form) then
     raise exception 'Upload a copy of the signed % to the matching receiving-facility item',v_kind using errcode='23514'; end if;
   update public.resident_compliance_items set completed_date=v_source_item.completed_date,status='compliant',carried_from_item_id=v_source_item.id,
     final_plan_review=v_source_item.final_plan_review where id=v_target.id;
   if v_kind in ('medical_evaluation','initial_assessment_15day') then
     v_due:=(v_source_item.completed_date+interval '1 year')::date;
     update public.resident_compliance_items set due_date=v_due where resident_id=v.id and completed_date is null
       and item_type=case when v_kind='medical_evaluation' then 'annual_medical_evaluation' else 'annual_reassessment' end;
     if not found then
       insert into public.resident_compliance_items(organization_id,facility_id,resident_id,item_type,due_date,renewal_interval_days,warning_days,grace_period_days)
       values(v.organization_id,v.facility_id,v.id,case when v_kind='medical_evaluation' then 'annual_medical_evaluation' else 'annual_reassessment' end,v_due,365,30,15);
     end if;
   elsif v_facility.facility_type='ALR' then
     insert into public.resident_compliance_items(organization_id,facility_id,resident_id,item_type,due_date,renewal_interval_days,warning_days,grace_period_days)
     values(v.organization_id,v.facility_id,v.id,'support_plan_quarterly_review',(v_source_item.completed_date+interval '3 months')::date,90,14,5)
     on conflict(resident_id) where item_type='support_plan_quarterly_review' and completed_date is null do nothing;
   end if;
 end loop;
 update public.residents set campus_transfer_evidence=jsonb_build_object('source_resident_id',v_source.id,'source_facility_id',v_source.facility_id,
   'actual_move_date',v.admission_date,'addendum_document_id',p_addendum_document_id,'items',p_evidence,'recorded_at',now(),'recorded_by',auth.uid()) where id=v.id;
 perform public.recalculate_resident_compliance_statuses();
end $$;
revoke all on function public.carry_campus_resident_evidence(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.carry_campus_resident_evidence(uuid,uuid,uuid,jsonb) to authenticated,service_role;
