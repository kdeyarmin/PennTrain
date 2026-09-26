-- REG38(f): a changed medical condition requires a new evaluation independently of
-- the assessment/support-plan decision. Neither chapter gives a numeric window.
-- due_date is explicitly a same-day INTERNAL follow-up target, with no grace/renewal.
alter table public.resident_change_events
  add column medical_condition_changed boolean not null default false,
  add column medical_evaluation_item_id uuid references public.resident_compliance_items(id) on delete restrict;
create index resident_change_events_medical_evaluation_item_idx
  on public.resident_change_events(medical_evaluation_item_id) where medical_evaluation_item_id is not null;
alter table public.resident_compliance_items drop constraint resident_compliance_items_item_type_check;
alter table public.resident_compliance_items add constraint resident_compliance_items_item_type_check check (item_type in (
  'preadmission_screening','initial_assessment_15day','support_plan_30day','annual_reassessment',
  'medical_evaluation','annual_medical_evaluation','significant_change_reassessment',
  'support_plan_quarterly_review','change_medical_evaluation'
));

-- Preserve every deployed amendment to the contributor authorization and assessment window.
alter function public.create_resident_change_event(uuid,text,timestamptz,text,text,text,text,boolean,text,text,text,integer,uuid,timestamptz,text,boolean,boolean,uuid)
  rename to create_resident_change_event_core;
alter function public.create_resident_change_event_core(uuid,text,timestamptz,text,text,text,text,boolean,text,text,text,integer,uuid,timestamptz,text,boolean,boolean,uuid)
  set schema app_private;
revoke all on function app_private.create_resident_change_event_core(uuid,text,timestamptz,text,text,text,text,boolean,text,text,text,integer,uuid,timestamptz,text,boolean,boolean,uuid)
  from public,anon,authenticated,service_role;

create function public.create_resident_change_event(
  p_resident_id uuid, p_category text, p_identified_at timestamptz,
  p_immediate_observations text, p_immediate_action_taken text,
  p_provider_notification_status text, p_designated_person_notification_status text,
  p_emergency_transfer boolean, p_emergency_transfer_destination text,
  p_monitoring_instructions text, p_monitoring_frequency text, p_monitoring_duration_hours integer,
  p_assigned_profile_id uuid, p_follow_up_due_at timestamptz, p_incident_decision text,
  p_reassessment_required boolean, p_support_plan_revision_required boolean,
  p_source_service_alert_id uuid default null, p_medical_condition_changed boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_event uuid; v public.resident_change_events%rowtype; v_item uuid; v_citation uuid;
begin
  v_event := app_private.create_resident_change_event_core(
    p_resident_id,p_category,p_identified_at,p_immediate_observations,p_immediate_action_taken,
    p_provider_notification_status,p_designated_person_notification_status,p_emergency_transfer,
    p_emergency_transfer_destination,p_monitoring_instructions,p_monitoring_frequency,p_monitoring_duration_hours,
    p_assigned_profile_id,p_follow_up_due_at,p_incident_decision,p_reassessment_required,
    p_support_plan_revision_required,p_source_service_alert_id
  );
  if coalesce(p_medical_condition_changed,false) then
    select * into v from public.resident_change_events where id=v_event;
    select t.id into v_citation from public.dhs_citation_topics t
      join public.facilities f on f.id=v.facility_id
      where t.citation_ref=case when f.facility_type='ALR' then '2800.141' else '2600.141' end limit 1;
    insert into public.resident_compliance_items(
      organization_id,facility_id,resident_id,item_type,due_date,renewal_interval_days,
      warning_days,grace_period_days,notes,citation_topic_id
    ) values (
      v.organization_id,v.facility_id,v.resident_id,'change_medical_evaluation',public.pa_day(v.identified_at),null,
      0,0,'Medical condition changed: '||v.immediate_observations||E'\nSame-day internal follow-up target. 55 Pa. Code 2600.141(b)(2) / 2800.141(b)(2) requires evaluation when the medical condition changes but specifies no numeric deadline. Upload the signed DME for an examination on or after the identified date. The annual cycle remains unchanged.',v_citation
    ) returning id into v_item;
    update public.resident_change_events set medical_condition_changed=true,medical_evaluation_item_id=v_item where id=v_event;
    insert into public.resident_change_event_history(organization_id,facility_id,event_id,event_type,resulting_status,reason,actor_profile_id,evidence)
      values(v.organization_id,v.facility_id,v_event,'medical_evaluation_required',v.status,
        'Medical-condition change requires a separate DME',auth.uid(),jsonb_build_object('medicalConditionChanged',true,'medicalEvaluationItemId',v_item));
  end if;
  return v_event;
end $$;
revoke all on function public.create_resident_change_event(uuid,text,timestamptz,text,text,text,text,boolean,text,text,text,integer,uuid,timestamptz,text,boolean,boolean,uuid,boolean) from public,anon;
grant execute on function public.create_resident_change_event(uuid,text,timestamptz,text,text,text,text,boolean,text,text,text,integer,uuid,timestamptz,text,boolean,boolean,uuid,boolean) to authenticated,service_role;

create function app_private.validate_change_medical_evaluation()
returns trigger language plpgsql security definer set search_path='' as $$
declare v public.resident_change_events%rowtype;
begin
  if new.item_type <> 'change_medical_evaluation' then return new; end if;
  if new.renewal_interval_days is not null or new.grace_period_days <> 0 then
    raise exception 'A condition-change medical evaluation is separate from the annual cycle and has no numeric grace period' using errcode='23514';
  end if;
  -- Recalculation updates historical compliant rows too. Once validated, an unchanged
  -- completion remains valid after a lawful retention-expiry purge of its source document.
  if new.status='compliant' and (tg_op='INSERT' or old.status is distinct from 'compliant'
    or new.completed_date is distinct from old.completed_date or new.resident_id is distinct from old.resident_id
    or new.item_type is distinct from old.item_type) then
    select * into v from public.resident_change_events where medical_evaluation_item_id=new.id;
    if v.id is null or v.resident_id is distinct from new.resident_id
      or new.completed_date is null or new.completed_date < public.pa_day(v.identified_at)
      or new.completed_date > public.pa_today()
      or not exists (select 1 from public.resident_documents d where d.compliance_item_id=new.id and d.resident_id=new.resident_id and d.is_state_form) then
      raise exception 'Attach the signed DME for an examination on or after the medical-condition change before completing this item' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.validate_change_medical_evaluation() from public,anon,authenticated;
create trigger validate_change_medical_evaluation before insert or update
on public.resident_compliance_items for each row execute function app_private.validate_change_medical_evaluation();

create function app_private.require_change_medical_evaluation_before_closure()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='closed' and new.medical_condition_changed and not exists (
    select 1 from public.resident_compliance_items i where i.id=new.medical_evaluation_item_id
      and i.resident_id=new.resident_id and i.item_type='change_medical_evaluation' and i.status='compliant'
      and i.completed_date >= public.pa_day(new.identified_at)
  ) then
    raise exception 'Complete the medical evaluation for this condition change before closing the event' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function app_private.require_change_medical_evaluation_before_closure() from public,anon,authenticated;
create trigger require_change_medical_evaluation_before_closure before update of status
on public.resident_change_events for each row execute function app_private.require_change_medical_evaluation_before_closure();
