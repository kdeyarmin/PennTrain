-- REG38(b,h,k), REG37(j): timed clinical duties share the audited, tenant-scoped
-- resident obligation register. Their evidence is immutable on completion.
alter table public.resident_regulatory_actions drop constraint resident_regulatory_actions_action_type_check;
alter table public.resident_regulatory_actions add constraint resident_regulatory_actions_action_type_check check(action_type in (
 'discharge_notice','closure_resident_notice','closure_department_notice','contract_change_notice',
 'transfer_record','contract_rescission_window','itemized_funds_account','refund_due','managed_funds_return','personal_needs_refund','closure_license_return',
 'scu_admission','scu_support_plan','scu_continuing_need','scu_plan_review','resident_tb_test','medication_refusal_notice','alf_exception_request'));
alter table public.resident_regulatory_actions drop constraint resident_regulatory_actions_recipient_role_check;
alter table public.resident_regulatory_actions add constraint resident_regulatory_actions_recipient_role_check
 check(recipient_role in ('resident','designated_person','referral_agent','department','estate','prescriber'));
create unique index resident_imported_refusal_duty on public.resident_regulatory_actions((details->>'external_event_id'))
 where action_type='medication_refusal_notice';
create unique index resident_tb_open_duty on public.resident_regulatory_actions(resident_id)
 where action_type='resident_tb_test' and status='pending';
drop trigger prepare_regulatory_action on public.resident_regulatory_actions;
create trigger prepare_regulatory_action before insert or update on public.resident_regulatory_actions for each row
when(new.action_type not in ('scu_admission','scu_support_plan','scu_continuing_need','scu_plan_review','resident_tb_test','medication_refusal_notice','alf_exception_request'))
execute function public.prepare_resident_regulatory_action();

create function app_private.prepare_resident_clinical_duty()
returns trigger language plpgsql security definer set search_path='' as $$
declare v public.residents%rowtype; v_type text; v_doc uuid; v_months integer; v_time timestamptz; v_count integer; v_import public.external_medication_administration_events%rowtype;
begin
  select * into v from public.residents where id=new.resident_id for update;
  select facility_type into v_type from public.facilities where id=new.facility_id;
  if v.id is null or v.organization_id is distinct from new.organization_id or v.facility_id is distinct from new.facility_id
    or v_type not in ('PCH','ALR') then raise exception 'Clinical duty requires a resident in this licensed facility' using errcode='23514'; end if;
  if tg_op='UPDATE' then
    if new.organization_id is distinct from old.organization_id or new.facility_id is distinct from old.facility_id
      or new.resident_id is distinct from old.resident_id or new.action_type is distinct from old.action_type then
      raise exception 'Clinical duty scope and type cannot change' using errcode='23514'; end if;
    if old.status='completed' then
      if (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
        raise exception 'Completed clinical evidence is immutable; append a correction' using errcode='23514'; end if;
      return new;
    end if;
  end if;
  if length(btrim(new.reason))<3 then raise exception 'Record the clinical triggering event' using errcode='23514'; end if;
  new.created_by:=case when tg_op='INSERT' then auth.uid() else old.created_by end;
  if new.action_type='medication_refusal_notice' then
    select * into v_import from public.external_medication_administration_events where id=nullif(new.details->>'external_event_id','')::uuid;
    if v_import.id is null or v_import.resident_id is distinct from new.resident_id or v_import.administration_status<>'refused'
      or (tg_op='UPDATE' and new.details->>'external_event_id' is distinct from old.details->>'external_event_id') then
      raise exception 'A refusal duty must retain its original imported resident event' using errcode='23514'; end if;
    new.anchor_at:=v_import.occurred_at;
    if new.recipient_role<>'prescriber' then raise exception 'A medication refusal must be addressed to the prescriber' using errcode='23514'; end if;
    new.due_at:=new.anchor_at+interval '24 hours';
  elsif new.action_type='resident_tb_test' then
    if v_type<>'ALR' then raise exception 'The two-year resident TB requirement is Chapter 2800' using errcode='23514'; end if;
    new.due_at:=case when new.details->>'cycle'='renewal' then ((new.anchor_at at time zone 'America/New_York')+interval '2 years') at time zone 'America/New_York' else new.anchor_at+interval '15 days' end;
  elsif new.action_type='alf_exception_request' then
    if v_type<>'ALR' or new.recipient_role<>'department' then raise exception 'Excludable-condition requests are ALF Department records' using errcode='23514'; end if;
    if length(btrim(coalesce(new.details->>'condition','')))<3 or length(btrim(coalesce(new.details->>'request_evidence','')))<3
      or length(btrim(coalesce(new.details->>'supporting_evidence','')))<3 or length(btrim(coalesce(new.details->>'certifier','')))<3
      or coalesce(new.details->>'request_decision','') not in ('submitted','declined_by_facility','determination_unnecessary') then
      raise exception 'Record the condition, request, supporting accommodations/care plan, qualified certification and decision to seek an exception' using errcode='23514'; end if;
    if new.anchor_at>now() or (new.completed_at is not null and new.completed_at<new.anchor_at) then
      raise exception 'Record the actual past request and a subsequent determination' using errcode='23514'; end if;
    v_time:=new.anchor_at; v_count:=0;
    while v_count<5 loop v_time:=((v_time at time zone 'America/New_York')+interval '1 day') at time zone 'America/New_York';
      if extract(isodow from v_time at time zone 'America/New_York')<6 then v_count:=v_count+1; end if;
    end loop;
    new.due_at:=v_time;
  else
    if new.recipient_role<>'resident' then raise exception 'Special-care evidence belongs to the resident' using errcode='23514'; end if;
    if coalesce(new.details->>'unit_type','') not in ('dementia','inrbi') or (v_type='PCH' and new.details->>'unit_type'='inrbi') then
      raise exception 'Choose the applicable dementia or ALF INRBI unit' using errcode='23514'; end if;
    v_months:=case when v_type='PCH' then 12 when new.details->>'unit_type'='inrbi' then 6 else 3 end;
    if new.action_type='scu_plan_review' and v_type='ALR' and new.details->>'unit_type'='inrbi' then v_months:=1; end if;
    new.due_at:=case when new.action_type='scu_admission' then new.anchor_at
      when new.action_type='scu_support_plan' then new.anchor_at+interval '72 hours'
      else ((new.anchor_at at time zone 'America/New_York')+make_interval(months=>v_months)) at time zone 'America/New_York' end;
  end if;
  if new.status='not_applicable' then
    if new.action_type in ('scu_support_plan','scu_continuing_need','scu_plan_review') and not v.sdcu
      and nullif(new.details->>'unit_left_at','')::timestamptz<=now() and nullif(new.details->>'unit_left_at','')::timestamptz<=new.due_at and length(btrim(coalesce(new.exception_basis,'')))>=10 then
      return new;
    end if;
    if new.action_type<>'medication_refusal_notice' or length(btrim(coalesce(new.exception_basis,'')))<10
      or length(btrim(coalesce(new.details->>'prescriber_instruction','')))<10 then
      raise exception 'Only a documented prescriber instruction can replace a medication-refusal report schedule' using errcode='23514'; end if;
  elsif new.status='completed' then
    if new.completed_at is null or new.completed_at>now() or length(btrim(coalesce(new.evidence,'')))<3 then
      raise exception 'Record actual completion time and evidence' using errcode='23514'; end if;
    if new.action_type='medication_refusal_notice' then
      if new.completed_at<new.anchor_at or length(btrim(coalesce(new.recipient_name,'')))<2 then
        raise exception 'Record the prescriber and actual notification after the refusal' using errcode='23514'; end if;
    elsif new.action_type='alf_exception_request' then
      if coalesce(new.details->>'determination','') not in ('approved','denied','not_requested','not_required')
        or coalesce(new.details->>'resident_decision','') not in ('admit','retain','deny_admission','transfer','discharge')
        or length(btrim(coalesce(new.details->>'determination_evidence','')))<3 then
        raise exception 'Retain the written determination and admission/retention/transfer/discharge decision in the resident record' using errcode='23514'; end if;
      if (new.details->>'resident_decision' in ('admit','retain') and new.details->>'determination' not in ('approved','not_required'))
        or (new.details->>'determination'='not_required' and new.details->>'request_decision'<>'determination_unnecessary')
        or (new.details->>'determination'='not_requested' and new.details->>'request_decision'<>'declined_by_facility') then
        raise exception 'Admission or retention requires approval or a documented applicable §229(e) exception' using errcode='23514'; end if;
    else
      v_doc:=nullif(new.details->>'document_id','')::uuid;
      if not exists(select 1 from public.resident_documents where id=v_doc and resident_id=v.id
        and (new.action_type='resident_tb_test' or is_state_form)) then
        raise exception 'Attach the dated clinical evidence from this resident record' using errcode='23514'; end if;
      if new.action_type='resident_tb_test' then
        if (new.details->>'tb_result'='negative' and new.completed_at<new.anchor_at-interval '2 years')
          or coalesce(new.details->>'tb_result','') not in ('negative','positive_with_chest_xray')
          or (new.details->>'tb_result'='positive_with_chest_xray' and length(btrim(coalesce(new.details->>'chest_xray_result','')))<3) then
          raise exception 'Record a negative test within two years or positive test with chest X-ray result' using errcode='23514'; end if;
      elsif new.action_type='scu_admission' then
        if v.status in ('discharged','deceased') or new.anchor_at>now() or new.completed_at<new.anchor_at then raise exception 'Record an actual past unit admission and its subsequent confirmation for an admitted resident' using errcode='23514'; end if;
        if exists(select 1 from public.resident_regulatory_actions where resident_id=new.resident_id and status='pending'
          and action_type in ('scu_support_plan','scu_continuing_need','scu_plan_review')) then
          raise exception 'Resolve the existing unit episode before recording another unit admission' using errcode='23514'; end if;
        v_time:=nullif(new.details->>'screened_at','')::timestamptz;
        if v_time is null or v_time>new.anchor_at or v_time<new.anchor_at-interval '72 hours'
          or length(btrim(coalesce(new.details->>'screening_collaborator','')))<3
          or (case when new.details->>'unit_type'='inrbi' then coalesce(new.details->>'screening_collaborator_role','') not in ('physician','neuropsychologist','cpb_team')
            else coalesce(new.details->>'screening_collaborator_role','') not in ('physician','geriatric_assessment_team') end)
          or coalesce(new.details->>'medical_provider_role','') not in ('physician','physician_assistant','crnp')
          or length(btrim(coalesce(new.details->>'admission_agreement','')))<3
          or length(btrim(coalesce(new.details->>'alternatives_considered','')))<3
          or length(btrim(coalesce(new.details->>'medical_evaluation_evidence','')))<3
          or nullif(new.details->>'medical_evaluated_on','')::date is null
          or (new.details->>'medical_evaluated_on')::date<(new.anchor_at at time zone 'America/New_York')::date-60
          or (new.details->>'medical_evaluated_on')::date>(new.anchor_at at time zone 'America/New_York')::date then
          raise exception 'Unit admission requires screening within the prior 72 hours, qualified collaboration, agreement, alternatives review and a medical evaluation within 60 days' using errcode='23514'; end if;
      elsif new.completed_at<new.anchor_at-(case when new.action_type='scu_support_plan' then interval '72 hours' else interval '0 hours' end) then
        raise exception 'The clinical evidence predates this duty window' using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.prepare_resident_clinical_duty() from public,anon,authenticated;
create trigger prepare_resident_clinical_duty before insert or update on public.resident_regulatory_actions for each row
when(new.action_type in ('scu_admission','scu_support_plan','scu_continuing_need','scu_plan_review','resident_tb_test','medication_refusal_notice','alf_exception_request'))
execute function app_private.prepare_resident_clinical_duty();

create function app_private.advance_resident_clinical_duties()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_next text; v_details jsonb;
begin
  if new.status<>'completed' or (tg_op='UPDATE' and old.status='completed') then return new; end if;
  if new.action_type='scu_admission' then
    update public.residents set sdcu=true where id=new.resident_id;
    insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,details)
    select new.organization_id,new.facility_id,new.resident_id,t,new.anchor_at,
      'Special-care unit admission: '||new.reason,jsonb_build_object('unit_type',new.details->>'unit_type','unit_admission_id',new.id)
    from unnest(array['scu_support_plan','scu_continuing_need']) t;
  elsif new.action_type in ('scu_support_plan','scu_continuing_need','scu_plan_review','resident_tb_test') then
    -- A positive tuberculin result requires chest X-ray evidence, not repeating
    -- the negative-test cycle that §141(a)(11) expressly limits to negatives.
    if new.action_type='resident_tb_test' and new.details->>'tb_result'='positive_with_chest_xray' then return new; end if;
    if exists(select 1 from public.residents where id=new.resident_id and (status in ('discharged','deceased') or (new.action_type<>'resident_tb_test' and not sdcu))) then return new; end if;
    v_next:=case when new.action_type='scu_support_plan' then 'scu_plan_review' else new.action_type end;
    v_details:=jsonb_build_object('cycle','renewal','previous_action_id',new.id,'unit_type',new.details->>'unit_type','unit_admission_id',new.details->>'unit_admission_id');
    insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,details)
    values(new.organization_id,new.facility_id,new.resident_id,v_next,new.completed_at,'Next clinical review after documented completion',v_details);
  end if;
  return new;
end $$;
revoke all on function app_private.advance_resident_clinical_duties() from public,anon,authenticated;
create trigger advance_resident_clinical_duties after insert or update on public.resident_regulatory_actions for each row
when(new.action_type in ('scu_admission','scu_support_plan','scu_continuing_need','scu_plan_review','resident_tb_test'))
execute function app_private.advance_resident_clinical_duties();

create function app_private.seed_resident_tb_duty()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.admission_date is not null and exists(select 1 from public.facilities where id=new.facility_id and facility_type='ALR') then
    if tg_op='UPDATE' then
      update public.resident_regulatory_actions set anchor_at=public.pa_midnight(new.admission_date)
        where resident_id=new.id and action_type='resident_tb_test' and status='pending' and details->>'cycle'='initial';
      if exists(select 1 from public.resident_regulatory_actions where resident_id=new.id and action_type='resident_tb_test') then return new; end if;
    end if;
    insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,details)
    values(new.organization_id,new.facility_id,new.id,'resident_tb_test',public.pa_midnight(new.admission_date),'2800.141(a)(11): document the resident TB test or positive test and chest X-ray result','{"cycle":"initial"}')
    on conflict(resident_id) where action_type='resident_tb_test' and status='pending' do nothing;
  end if;
  return new;
end $$;
revoke all on function app_private.seed_resident_tb_duty() from public,anon,authenticated;
create trigger seed_resident_tb_duty after insert or update of admission_date on public.residents for each row execute function app_private.seed_resident_tb_duty();
insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,anchor_at,reason,details)
select r.organization_id,r.facility_id,r.id,'resident_tb_test',public.pa_midnight(r.admission_date),
 '2800.141(a)(11): existing resident TB evidence requires review; no past test is presumed','{"cycle":"initial"}'::jsonb
from public.residents r join public.facilities f on f.id=r.facility_id where f.facility_type='ALR' and r.admission_date is not null and r.status not in ('discharged','deceased')
on conflict(resident_id) where action_type='resident_tb_test' and status='pending' do nothing;

create function app_private.seed_imported_refusal_notice()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.administration_status='refused' and exists(select 1 from public.facilities where id=new.facility_id and facility_type in ('PCH','ALR')) then
    insert into public.resident_regulatory_actions(organization_id,facility_id,resident_id,action_type,recipient_role,anchor_at,reason,details)
    values(new.organization_id,new.facility_id,new.resident_id,'medication_refusal_notice','prescriber',new.occurred_at,
      'Imported medication refusal: notify prescriber within 24 hours unless the prescriber directs otherwise (§187(c)).',
      jsonb_build_object('external_event_id',new.id,'external_order_id',new.external_order_id,'source_note',new.source_note))
    on conflict((details->>'external_event_id')) where action_type='medication_refusal_notice' do nothing;
  end if;
  return new;
end $$;
revoke all on function app_private.seed_imported_refusal_notice() from public,anon,authenticated;
create trigger seed_imported_refusal_notice after insert on public.external_medication_administration_events for each row execute function app_private.seed_imported_refusal_notice();

create function public.end_resident_special_care(p_resident_id uuid,p_left_at timestamptz,p_reason text,p_evidence text)
returns void language plpgsql security definer set search_path='' as $$
declare v public.residents%rowtype; v_admitted timestamptz;
begin
  select * into v from public.residents where id=p_resident_id for update;
  if not found then raise exception 'Resident not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_regulatory_manager(v.organization_id,v.facility_id);
  select max(anchor_at) into v_admitted from public.resident_regulatory_actions where resident_id=v.id and action_type='scu_admission' and status='completed';
  if p_left_at is null or p_left_at>now() or p_left_at<coalesce(v_admitted,public.pa_midnight(v.admission_date))
    or length(btrim(coalesce(p_reason,'')))<3 or length(btrim(coalesce(p_evidence,'')))<10 then
    raise exception 'Record actual unit departure after admission, its reason and supporting evidence' using errcode='23514'; end if;
  update public.residents set sdcu=false where id=v.id;
  update public.resident_regulatory_actions set status='not_applicable',exception_basis='Unit departure: '||btrim(p_reason)||'. '||btrim(p_evidence),
    details=details||jsonb_build_object('unit_left_at',p_left_at,'departure_recorded_by',auth.uid())
    where resident_id=v.id and action_type in ('scu_support_plan','scu_continuing_need','scu_plan_review') and status='pending' and due_at>=p_left_at;
end $$;
revoke all on function public.end_resident_special_care(uuid,timestamptz,text,text) from public,anon;
grant execute on function public.end_resident_special_care(uuid,timestamptz,text,text) to authenticated,service_role;

-- Clinical records cannot be retyped into a less restrictive financial notice.
create function app_private.preserve_clinical_duty_type() returns trigger language plpgsql set search_path='' as $$
begin
 if old.action_type in ('scu_admission','scu_support_plan','scu_continuing_need','scu_plan_review','resident_tb_test','medication_refusal_notice','alf_exception_request')
  and new.action_type is distinct from old.action_type then raise exception 'Clinical duty type cannot change' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function app_private.preserve_clinical_duty_type() from public,anon,authenticated;
create trigger preserve_clinical_duty_type before update on public.resident_regulatory_actions for each row execute function app_private.preserve_clinical_duty_type();
