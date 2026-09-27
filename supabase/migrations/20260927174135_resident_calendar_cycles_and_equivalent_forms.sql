-- Calendar years/quarters for the published PA rule packs; tenant fixed-day
-- overrides stay fixed-day. No completed evidence or recorded dates are changed.
create function app_private.resident_cycle_next_due(p_anchor date,p_item_type text,p_days integer,p_org uuid,p_facility_type text,p_track text)
returns date language plpgsql stable set search_path='' as $$
declare v_rule public.resident_compliance_rule_packs%rowtype;
begin
  if p_anchor is null or p_days is null then return null; end if;
  select * into v_rule from public.resident_compliance_rule_packs
  where state='PA' and facility_type=p_facility_type and item_type=p_item_type and is_active
    and admission_track=case when p_facility_type='ALR' then coalesce(p_track,'standard') else 'standard' end
    and (organization_id=p_org or organization_id is null)
  order by organization_id nulls last,created_at desc,id limit 1;
  if found and v_rule.organization_id is null then
    if p_item_type in ('annual_reassessment','annual_medical_evaluation') and p_days=365 then
      return (p_anchor+interval '1 year')::date;
    elsif p_facility_type='ALR' and p_item_type='support_plan_quarterly_review' and p_days=90 then
      return (p_anchor+interval '3 months')::date;
    end if;
  end if;
  return p_anchor+p_days;
end $$;
revoke all on function app_private.resident_cycle_next_due(date,text,integer,uuid,text,text) from public,anon,authenticated;

-- Each replacement fails if the underlying audited function changed unexpectedly.
do $migration$
declare v_def text; v_body text; v_new text; v_old text; v_replacement text; v_pair record;
begin
  select pg_get_functiondef(oid),prosrc into strict v_def,v_body from pg_proc
    where oid='app_private.complete_resident_compliance_item_core(uuid,uuid,date)'::regprocedure;
  v_new:=v_body;
  for v_pair in select * from (values
    ('v_completed_date + v_annual_rule.renewal_interval_days', 'app_private.resident_cycle_next_due(v_completed_date, ''annual_medical_evaluation'', v_annual_rule.renewal_interval_days, v_item.organization_id, v_facility_type, v_admission_track)'),
    ('v_completed_date + v_item.renewal_interval_days', 'app_private.resident_cycle_next_due(v_completed_date, v_item.item_type, v_item.renewal_interval_days, v_item.organization_id, v_facility_type, v_admission_track)'),
    ('v_completed_date + v_quarterly_rule.renewal_interval_days', 'app_private.resident_cycle_next_due(v_completed_date, ''support_plan_quarterly_review'', v_quarterly_rule.renewal_interval_days, v_item.organization_id, v_facility_type, v_admission_track)')
  ) p(old_text,new_text) loop
    if position(v_pair.old_text in v_new)=0 then raise exception 'Resident cycle expression changed: %',v_pair.old_text; end if;
    v_new:=replace(v_new,v_pair.old_text,v_pair.new_text);
  end loop;
  v_old:='(into v_admission_track\s+from public\.residents r where r\.id = v_item\.resident_id;)';
  if v_new !~ v_old then raise exception 'Resident assessment cycle anchor changed'; end if;
  v_replacement:='\1'||$body$
  -- The first annual assessment runs from the initial assessment, not admission.
  if v_item.item_type='initial_assessment_15day' and v_facility_type in ('PCH','ALR') and not exists(
    select 1 from public.resident_compliance_rule_packs where organization_id=v_item.organization_id and state='PA'
      and facility_type=v_facility_type and admission_track=v_admission_track and item_type='annual_reassessment' and is_active
  ) then
    update public.resident_compliance_items i set due_date=app_private.resident_cycle_next_due(
      v_completed_date,'annual_reassessment',i.renewal_interval_days,i.organization_id,v_facility_type,v_admission_track)
    where i.resident_id=v_item.resident_id and i.item_type='annual_reassessment' and i.completed_date is null
      and i.due_date=app_private.resident_cycle_next_due(v_admission_date,'annual_reassessment',i.renewal_interval_days,i.organization_id,v_facility_type,v_admission_track);
  end if;
$body$;
  -- Match the track-loading SELECT only, after chapter and track are known.
  v_new:=regexp_replace(v_new,v_old,v_replacement);
  execute replace(v_def,v_body,v_new);
  select pg_get_functiondef(oid),prosrc into strict v_def,v_body from pg_proc
    where oid='public.instantiate_resident_compliance_items(uuid)'::regprocedure;
  v_old:='v_res.admission_date + v_rule.offset_days';
  v_replacement:='app_private.resident_cycle_next_due(v_res.admission_date, v_rule.item_type, v_rule.offset_days, v_res.organization_id, v_facility_type, v_admission_track)';
  if position(v_old in v_body)=0 then raise exception 'Resident admission cycle expression changed'; end if;
  execute replace(v_def,v_body,replace(v_body,v_old,v_replacement));
end $migration$;

-- Repair only unfinished global baseline cycles whose old date can be traced to
-- the original completion/admission plus the old fixed-day interval.
with anchors as (
  select i.id,i.item_type,i.renewal_interval_days,i.organization_id,f.facility_type,r.admission_track,
    coalesce((select max(prior.completed_date) from public.resident_compliance_items prior
      where prior.resident_id=i.resident_id and prior.completed_date is not null
        and prior.completed_date<=i.due_date and case
          when i.item_type='annual_medical_evaluation' then prior.item_type in ('medical_evaluation','annual_medical_evaluation')
          when i.item_type='annual_reassessment' then prior.item_type='annual_reassessment'
          else prior.item_type in ('support_plan_30day','support_plan_quarterly_review') end),
      case when i.item_type='annual_reassessment' then r.admission_date end) as anchor
  from public.resident_compliance_items i join public.residents r on r.id=i.resident_id
  join public.facilities f on f.id=i.facility_id
  where i.completed_date is null and i.status<>'not_applicable' and i.carried_from_item_id is null
    and i.item_type in ('annual_medical_evaluation','annual_reassessment','support_plan_quarterly_review')
), repairs as (
  select a.id,app_private.resident_cycle_next_due(a.anchor,a.item_type,a.renewal_interval_days,a.organization_id,a.facility_type,a.admission_track) as next_due
  from anchors a join public.resident_compliance_items i on i.id=a.id
  where a.anchor is not null and i.due_date=a.anchor+a.renewal_interval_days
)
update public.resident_compliance_items i set due_date=r.next_due from repairs r
where i.id=r.id and i.due_date is distinct from r.next_due;

-- First annual assessments still at the admission-derived default acquire the
-- documented initial-assessment anchor. Preserve later cycles and manual dates.
update public.resident_compliance_items i set due_date=app_private.resident_cycle_next_due(
  initial.completed_date,'annual_reassessment',i.renewal_interval_days,i.organization_id,f.facility_type,r.admission_track)
from public.residents r join public.facilities f on f.id=r.facility_id
join public.resident_compliance_items initial on initial.resident_id=r.id and initial.item_type='initial_assessment_15day' and initial.completed_date is not null
where i.resident_id=r.id and f.facility_type in ('PCH','ALR') and i.item_type='annual_reassessment' and i.completed_date is null and i.status<>'not_applicable'
  and not exists(select 1 from public.resident_compliance_rule_packs p where p.organization_id=i.organization_id and p.state='PA'
    and p.facility_type=f.facility_type and p.admission_track=case when f.facility_type='ALR' then r.admission_track else 'standard' end and p.item_type='annual_reassessment' and p.is_active)
  and i.carried_from_item_id is null and not exists(select 1 from public.resident_compliance_items prior where prior.resident_id=r.id and prior.item_type='annual_reassessment' and prior.completed_date is not null)
  and i.due_date=app_private.resident_cycle_next_due(r.admission_date,'annual_reassessment',i.renewal_interval_days,i.organization_id,f.facility_type,r.admission_track);

-- Chapter 2600.225(b)/.227(b), 2800.224(a)(4),(c)(5), .225(a), .227(b)
-- permit equivalent assessment/support forms containing the same information.
-- Medical evaluation and PCH preadmission forms retain their prescribed-form rule.
alter table public.resident_documents add column equivalent_form_review jsonb;
comment on column public.resident_documents.equivalent_form_review is
  'Documented review that an eligible assessment/support form contains all DHS form information, with mapping/reference, reviewer and server-recorded actor/time. Does not mark it an official DHS form.';
create function app_private.resident_equivalent_form_allowed(p_type text,p_item text)
returns boolean language sql immutable set search_path='' as $$
  select p_type in ('PCH','ALR') and p_item in ('initial_assessment_15day','annual_reassessment','significant_change_reassessment','support_plan_30day')
    or p_type='ALR' and p_item='support_plan_quarterly_review'
$$;
revoke all on function app_private.resident_equivalent_form_allowed(text,text) from public,anon,authenticated;
create function app_private.validate_resident_equivalent_form()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_item public.resident_compliance_items%rowtype; v_type text;
begin
  if new.equivalent_form_review is null then return new; end if;
  select * into v_item from public.resident_compliance_items where id=new.compliance_item_id;
  select facility_type into v_type from public.facilities where id=new.facility_id;
  if new.is_state_form or v_item.id is null or v_item.resident_id is distinct from new.resident_id
    or v_item.facility_id is distinct from new.facility_id or v_item.organization_id is distinct from new.organization_id
    or not coalesce(app_private.resident_equivalent_form_allowed(v_type,v_item.item_type),false)
    or jsonb_typeof(new.equivalent_form_review) is distinct from 'object'
    or new.equivalent_form_review->'all_required_information' is distinct from 'true'::jsonb
    or length(btrim(coalesce(new.equivalent_form_review->>'review_reference','')))<10
    or length(btrim(coalesce(new.equivalent_form_review->>'reviewer_name','')))<2 then
    raise exception 'An equivalent assessment/support form requires a linked eligible item, all required DHS information, reviewer and documented comparison reference' using errcode='23514';
  end if;
  if tg_op='INSERT' or new.equivalent_form_review is distinct from old.equivalent_form_review then
    new.equivalent_form_review:=new.equivalent_form_review||jsonb_build_object('recorded_by',auth.uid(),'recorded_at',now());
  end if;
  return new;
end $$;
revoke all on function app_private.validate_resident_equivalent_form() from public,anon,authenticated;
create trigger zz_validate_resident_equivalent_form before insert or update on public.resident_documents
for each row execute function app_private.validate_resident_equivalent_form();

do $migration$
declare v_def text; v_body text; v_new text;
begin
  select pg_get_functiondef(oid),prosrc into strict v_def,v_body from pg_proc
    where oid='app_private.complete_resident_compliance_item_core(uuid,uuid,date)'::regprocedure;
  if position('or v_document.is_state_form is not true then' in v_body)=0 then raise exception 'Resident document gate changed'; end if;
  v_new:=replace(v_body,'or v_document.is_state_form is not true then',
    'or not coalesce((v_document.is_state_form or (app_private.resident_equivalent_form_allowed(v_facility_type,v_item.item_type) and v_document.equivalent_form_review is not null)),false) then');
  v_new:=replace(v_new,'the state-approved DHS form for this item must be uploaded and attached before it can be marked complete -- no exception',
    'Attach the completed DHS form or a documented equivalent assessment/support form permitted for this chapter and item');
  execute replace(v_def,v_body,v_new);
end $migration$;

-- Existing campus copies and clinical support-plan evidence use the same reviewed
-- form alternative; a generic upload without a linked review remains ineligible.
do $migration$
declare v_signature text; v_def text; v_body text; v_new text;
begin
  foreach v_signature in array array[
    'app_private.carry_campus_resident_evidence_core(uuid,uuid,uuid,jsonb)',
    'public.carry_campus_resident_evidence(uuid,uuid,uuid,jsonb)'
  ] loop
    select pg_get_functiondef(oid),prosrc into strict v_def,v_body from pg_proc where oid=v_signature::regprocedure;
    if position('and is_state_form)' in v_body)=0 then raise exception 'Campus document gate changed: %',v_signature; end if;
    v_new:=replace(v_body,'and is_state_form)','and (is_state_form or equivalent_form_review is not null))');
    v_new:=replace(v_new,'supported by its signed DHS form','supported by its signed DHS form or documented equivalent');
    if v_signature='public.carry_campus_resident_evidence(uuid,uuid,uuid,jsonb)' then
      if position('where id=v_review_doc and resident_id=v.id and (is_state_form or equivalent_form_review is not null)' in v_new)=0
        or position('set compliance_item_id=v_target.id where id=v_review_doc' in v_new)=0 then raise exception 'Campus quarterly linking changed'; end if;
      v_new:=replace(v_new,'where id=v_review_doc and resident_id=v.id and (is_state_form or equivalent_form_review is not null)',
        'where id=v_review_doc and resident_id=v.id and (is_state_form or equivalent_form_review is not null or jsonb_typeof(p_evidence->''support_plan_quarterly_review''->''equivalent_form_review'')=''object'')');
      v_new:=replace(v_new,'set compliance_item_id=v_target.id where id=v_review_doc',
        'set compliance_item_id=v_target.id, equivalent_form_review=coalesce(p_evidence->''support_plan_quarterly_review''->''equivalent_form_review'',equivalent_form_review) where id=v_review_doc');
      if position('if v_review.id is not null then' in v_new)=0 then raise exception 'Campus quarterly destination gate changed'; end if;
      v_new:=replace(v_new,'if v_review.id is not null then',
        'select facility_type into v_type from public.facilities where id=v.facility_id; if v_review.id is not null and v_type=''ALR'' then');
    end if;
    execute replace(v_def,v_body,v_new);
  end loop;
  select pg_get_functiondef(oid),prosrc into strict v_def,v_body from pg_proc
    where oid='app_private.prepare_resident_clinical_duty()'::regprocedure;
  if position('or is_state_form))' in v_body)=0 then raise exception 'Clinical document gate changed'; end if;
  v_new:=replace(v_body,'or is_state_form))','or is_state_form or equivalent_form_review is not null))');
  execute replace(v_def,v_body,v_new);
end $migration$;

-- .225 requires reassessment on a significant change, without a fixed allowance.
-- Keep the product follow-up target separate; a 14+7 day product default must not
-- be treated as a statutory due date or grace period.
alter table public.resident_compliance_items add column internal_target_date date;
comment on column public.resident_compliance_items.internal_target_date is
  'Operational follow-up target only; not a statutory deadline or permitted delay in required care.';
create function app_private.separate_resident_change_followup_target()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.item_type='significant_change_reassessment' and new.completed_date is null
    and exists(select 1 from public.facilities where id=new.facility_id and facility_type in ('PCH','ALR')) then
    new.internal_target_date:=coalesce(new.due_date,new.internal_target_date);
    new.due_date:=null;
    new.grace_period_days:=0;
    if new.status<>'not_applicable' then new.status:='missing'; end if;
  end if;
  return new;
end $$;
revoke all on function app_private.separate_resident_change_followup_target() from public,anon,authenticated;
create trigger separate_resident_change_followup_target before insert or update on public.resident_compliance_items
for each row execute function app_private.separate_resident_change_followup_target();
update public.resident_compliance_items set due_date=due_date
where item_type='significant_change_reassessment' and completed_date is null
  and exists(select 1 from public.facilities f where f.id=resident_compliance_items.facility_id and f.facility_type in ('PCH','ALR'));
update public.resident_compliance_rule_packs set grace_period_days=0,
  notes='Significant condition change requires an assessment under 2600.225 / 2800.225. No numeric completion allowance is specified. The offset is an internal follow-up target only, never a statutory deadline or grace period.'
where organization_id is null and state='PA' and facility_type in ('PCH','ALR') and item_type='significant_change_reassessment';

-- Keep the operational task visible, but state what its date actually means.
do $migration$
declare v_def text; v_body text; v_new text;
begin
  select pg_get_functiondef(oid),prosrc into strict v_def,v_body from pg_proc where oid='public.register_outstanding_work_items()'::regprocedure;
  v_new:=replace(v_body,'i.item_type, i.due_date, i.status','i.item_type, coalesce(i.due_date,i.internal_target_date) as due_date, i.status');
  v_new:=replace(v_new,'and i.due_date is not null','and coalesce(i.due_date,i.internal_target_date) is not null');
  v_new:=replace(v_new,'''A required resident compliance item is '' || r.status || ''.''',
    'case when r.item_type=''significant_change_reassessment'' then ''Assessment required after a significant change. This date is an internal follow-up target, not a statutory deadline or permitted delay.'' else ''A required resident compliance item is '' || r.status || ''.'' end');
  if v_new=v_body then raise exception 'Resident follow-up work producer changed'; end if;
  execute replace(v_def,v_body,v_new);
end $migration$;
update public.work_items w set description='Assessment required after a significant change. This date is an internal follow-up target, not a statutory deadline or permitted delay.'
from public.resident_compliance_items i
where w.deduplication_key='resident-compliance:'||i.id::text and w.organization_id=i.organization_id
  and i.item_type='significant_change_reassessment' and i.internal_target_date is not null
  and i.completed_date is null and w.state not in ('closed','canceled');
select public.recalculate_resident_compliance_statuses();
select public.resolve_stale_compliance_alerts();
