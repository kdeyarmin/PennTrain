-- Regulatory administration retains module, manager, session and assurance gates.
create function app_private.assert_resident_regulatory_manager(p_org uuid,p_fac uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 perform app_private.assert_admission_manager(p_org,p_fac);
 if coalesce(auth.jwt()->>'role','')='service_role' then return; end if;
 if not public.current_sms_mfa_satisfied() or not public.current_impersonation_session_live()
   or not public.identity_assurance_is_current('compliance_profile_admin') then
   raise exception 'A current verified resident-management session is required' using errcode='42501'; end if;
end $$;
revoke all on function app_private.assert_resident_regulatory_manager(uuid,uuid) from public,anon,authenticated,service_role;

-- REG9(e), REG25, REG38(e,l,n). Policy alternatives are explicit and audited;
-- existing conservative defaults remain in force until a manager records a choice.
alter table public.facilities add column resident_regulatory_policy jsonb not null default
  '{"alf_admission_grace_days":0,"alf_contract_timing":"before_admission","revision_grace_days":0,"medication_reportability":"all_events"}'::jsonb,
  add column campus_identifier text;
alter table public.facilities add constraint resident_regulatory_policy_choices check (
  jsonb_typeof(resident_regulatory_policy)='object'
  and coalesce(resident_regulatory_policy->>'alf_admission_grace_days','') in ('0','15')
  and coalesce(resident_regulatory_policy->>'alf_contract_timing','') in ('before_admission','within_24_hours')
  and coalesce(resident_regulatory_policy->>'revision_grace_days','') in ('0','5')
  and coalesce(resident_regulatory_policy->>'medication_reportability','') in ('all_events','statutory_errors')
  and resident_regulatory_policy ?& array['alf_admission_grace_days','alf_contract_timing','revision_grace_days','medication_reportability']);

alter table public.residents add column expedited_admission_basis text,
  add column expedited_admission_evidence text;
alter table public.residents add constraint expedited_admission_basis_choice check (
  expedited_admission_basis is null or expedited_admission_basis in ('acute_care_hospital','escape_abuse','no_alternative_arrangement'));

create function app_private.validate_expedited_admission_basis()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.admission_track='expedited' and exists(select 1 from public.facilities where id=new.facility_id and facility_type='ALR')
    and (tg_op='INSERT' or old.admission_track is distinct from new.admission_track
      or old.expedited_admission_basis is distinct from new.expedited_admission_basis
      or old.expedited_admission_evidence is distinct from new.expedited_admission_evidence
      or (old.status is distinct from new.status and new.status='active'))
    and (new.expedited_admission_basis is null or length(btrim(coalesce(new.expedited_admission_evidence,'')))<10) then
    raise exception 'Expedited ALF admission requires the 2800.224(a)(3) basis and supporting documentation reference' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function app_private.validate_expedited_admission_basis() from public,anon,authenticated;
create trigger validate_expedited_admission_basis before insert or update on public.residents
for each row execute function app_private.validate_expedited_admission_basis();

create function app_private.apply_resident_document_grace_policy()
returns trigger language plpgsql set search_path='' as $$
declare v_policy jsonb; v_type text; v_track text;
begin
  if new.completed_date is not null then return new; end if;
  select f.resident_regulatory_policy,f.facility_type,r.admission_track into v_policy,v_type,v_track
    from public.facilities f join public.residents r on r.facility_id=f.id where r.id=new.resident_id;
  if new.item_type='support_plan_30day' and new.triggered_by_item_id is not null then
    new.grace_period_days:=(v_policy->>'revision_grace_days')::integer;
  elsif v_type='ALR' and v_track='standard' and new.item_type in ('medical_evaluation','initial_assessment_15day')
    and new.triggered_by_item_id is null then
    new.grace_period_days:=(v_policy->>'alf_admission_grace_days')::integer;
  end if;
  return new;
end $$;
revoke all on function app_private.apply_resident_document_grace_policy() from public,anon,authenticated;
create trigger apply_resident_document_grace_policy before insert or update on public.resident_compliance_items
for each row execute function app_private.apply_resident_document_grace_policy();

create function public.save_resident_regulatory_policy(p_facility_id uuid,p_policy jsonb,p_reason text,p_campus_identifier text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v public.facilities%rowtype; v_workspace uuid;
begin
  select * into v from public.facilities where id=p_facility_id for update;
  if not found then raise exception 'Facility not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_regulatory_manager(v.organization_id,v.id);
  if v.facility_type not in ('PCH','ALR') or length(btrim(coalesce(p_reason,'')))<10 then
    raise exception 'A PCH/ALF policy requires a documented decision of at least 10 characters' using errcode='23514'; end if;
  update public.facilities set resident_regulatory_policy=p_policy||jsonb_build_object('decision_reason',btrim(p_reason),'decided_at',now(),'decided_by',auth.uid()),
    campus_identifier=nullif(btrim(p_campus_identifier),'') where id=v.id;
  update public.resident_compliance_items set grace_period_days=grace_period_days
    where facility_id=v.id and completed_date is null and item_type in ('medical_evaluation','initial_assessment_15day','support_plan_30day');
  perform public.recalculate_resident_compliance_statuses();
  for v_workspace in select id from public.move_in_workspaces where facility_id=v.id and state not in ('completed','canceled') loop
    perform public.refresh_move_in_readiness(v_workspace);
  end loop;
end $$;
revoke all on function public.save_resident_regulatory_policy(uuid,jsonb,text,text) from public,anon;
grant execute on function public.save_resident_regulatory_policy(uuid,jsonb,text,text) to authenticated,service_role;

-- A contract may remain open after ALF admission only under the recorded 24-hour policy.
-- Other tasks, including the prior-to-admission needs certification, remain blocking.
create or replace function public.refresh_move_in_readiness(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.move_in_workspaces%rowtype; v_total integer; v_ready integer; v_blockers integer; v_deferred integer; v_allow boolean; v_snapshot jsonb;
begin
  select * into v from public.move_in_workspaces where id=p_workspace_id for update;
  if not found then raise exception 'Move-in workspace not found' using errcode='P0002'; end if;
  select facility_type='ALR' and resident_regulatory_policy->>'alf_contract_timing'='within_24_hours' into v_allow from public.facilities where id=v.facility_id;
  select count(*)::integer,
    count(*) filter(where state in ('completed','approved') or (state='exception' and approved_at is not null))::integer,
    count(*) filter(where not(state in ('completed','approved') or (state='exception' and approved_at is not null))
      and not(coalesce(v_allow,false) and (task_key='resident_agreement' or (task_key='guest_signing' and 'resident_agreement'=any(depends_on_task_keys)))))::integer,
    count(*) filter(where coalesce(v_allow,false) and (task_key='resident_agreement' or (task_key='guest_signing' and 'resident_agreement'=any(depends_on_task_keys))) and state not in ('completed','approved'))::integer
  into v_total,v_ready,v_blockers,v_deferred from public.move_in_tasks where workspace_id=v.id;
  v_snapshot:=jsonb_build_object('generatedAt',now(),'status',case when v_total>0 and v_blockers=0 then 'inspection_ready' else 'not_ready' end,
    'totalTasks',v_total,'readyTasks',v_ready,'blockers',v_blockers,'contractsDueAfterAdmission',v_deferred);
  update public.move_in_workspaces set readiness_snapshot=coalesce(readiness_snapshot,'{}'::jsonb)||v_snapshot,state=case when state in ('completed','canceled') then state
    when v_total>0 and v_blockers=0 then 'ready' else 'active' end,updated_at=now() where id=v.id;
  return v_snapshot;
end $$;

alter function public.complete_move_in_admission(uuid,text,date) rename to complete_move_in_admission_core;
alter function public.complete_move_in_admission_core(uuid,text,date) set schema app_private;
revoke all on function app_private.complete_move_in_admission_core(uuid,text,date) from public,anon,authenticated,service_role;
create function public.complete_move_in_admission(p_workspace_id uuid,p_reason text,p_admission_date date,p_admitted_at timestamptz default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.move_in_workspaces%rowtype; v_resident uuid; v_allow boolean;
begin
  select * into v from public.move_in_workspaces where id=p_workspace_id for update;
  if not found then raise exception 'Move-in workspace not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_regulatory_manager(v.organization_id,v.facility_id);
  select facility_type='ALR' and resident_regulatory_policy->>'alf_contract_timing'='within_24_hours' into v_allow from public.facilities where id=v.facility_id;
  if p_admitted_at is not null and (p_admitted_at>now() or (p_admitted_at at time zone 'America/New_York')::date is distinct from p_admission_date) then
    raise exception 'Actual admission time must be in the past and on the recorded first day residing here' using errcode='23514'; end if;
  if v_allow and p_admitted_at is null then raise exception 'The 24-hour contract policy requires the actual admission date and time' using errcode='23514'; end if;
  if p_admitted_at is not null and exists(select 1 from public.facilities where id=v.facility_id and facility_type='ALR')
    and not exists(select 1 from public.move_in_tasks where workspace_id=v.id and task_key='alf_needs_certification'
      and state in ('approved','completed') and nullif(signature_evidence->>'signedAt','')::timestamptz<=p_admitted_at) then
    raise exception 'The needs certification must precede the actual admission time' using errcode='23514'; end if;
  if v_allow then
    update public.move_in_tasks set due_at=p_admitted_at+interval '24 hours' where workspace_id=v.id and (task_key='resident_agreement' or (task_key='guest_signing' and 'resident_agreement'=any(depends_on_task_keys)))
      and state not in ('completed','approved');
  end if;
  v_resident:=app_private.complete_move_in_admission_core(p_workspace_id,p_reason,p_admission_date);
  update public.move_in_workspaces set readiness_snapshot=readiness_snapshot||jsonb_build_object('actualAdmissionAt',coalesce(p_admitted_at,public.pa_midnight(p_admission_date))) where id=v.id;
  return v_resident;
end $$;
revoke all on function public.complete_move_in_admission(uuid,text,date,timestamptz) from public,anon;
grant execute on function public.complete_move_in_admission(uuid,text,date,timestamptz) to authenticated,service_role;

-- Preserve the existing task writer's authorization/evidence gates and amend only
-- its final readiness dependency. Guest signing remains pending, due with the contract.
do $migration$
declare v_body text; v_def text; v_new text;
begin
 select prosrc,pg_get_functiondef(oid) into strict v_body,v_def from pg_proc where oid='public.update_move_in_task(uuid,text,uuid,jsonb,text)'::regprocedure;
 v_new:=replace(v_body,'where d.workspace_id = v.workspace_id and d.task_key = v_dep',
  $replacement$where d.workspace_id = v.workspace_id and d.task_key = v_dep
          and not (v.task_key='ready_to_admit' and d.task_key='resident_agreement'
            and exists(select 1 from public.facilities f where f.id=v.facility_id and f.facility_type='ALR'
              and f.resident_regulatory_policy->>'alf_contract_timing'='within_24_hours'))$replacement$);
 if v_new=v_body then raise exception 'The readiness dependency definition changed; review the contract policy integration'; end if;
 execute replace(v_def,v_body,v_new);
end $migration$;

create function app_private.validate_move_in_contract_evidence()
returns trigger language plpgsql set search_path='' as $$
declare v_admitted timestamptz; v_allow boolean;
begin
 if new.task_key not in ('resident_agreement','guest_signing') then return new; end if;
 select nullif(w.readiness_snapshot->>'actualAdmissionAt','')::timestamptz,
   f.facility_type='ALR' and f.resident_regulatory_policy->>'alf_contract_timing'='within_24_hours'
 into v_admitted,v_allow from public.move_in_workspaces w join public.facilities f on f.id=w.facility_id where w.id=new.workspace_id;
 if v_allow and v_admitted is not null then new.due_at:=v_admitted+interval '24 hours'; end if;
 if new.task_key='resident_agreement' and new.state in ('approved','completed') and
   (tg_op='INSERT' or old.state not in ('approved','completed') or new.signature_evidence is distinct from old.signature_evidence) then
   if nullif(new.signature_evidence->>'signedAt','')::timestamptz is null
     or (new.signature_evidence->>'signedAt')::timestamptz>now() then
     raise exception 'Record the actual contract signature date and time' using errcode='23514'; end if;
 end if;
 return new;
end $$;
revoke all on function app_private.validate_move_in_contract_evidence() from public,anon,authenticated;
create trigger validate_move_in_contract_evidence before insert or update on public.move_in_tasks for each row execute function app_private.validate_move_in_contract_evidence();

-- The facility may retain the conservative all-events presumption or use the six
-- staff-administered prescription error categories. A human determination wins.
create function app_private.apply_medication_reportability_policy()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.incident_type='medication_error' and new.reportability_determined_at is null
    and exists(select 1 from public.facilities where id=new.facility_id and resident_regulatory_policy->>'medication_reportability'='statutory_errors') then
    new.reportability_status:=case when new.pathway_answers->>'event_kind'='actual_error'
      and new.pathway_answers->>'administration_by'='staff'
      and new.pathway_answers->>'error_category' in ('wrong_resident','wrong_medication','wrong_dose','wrong_time','omitted','wrong_route')
      then 'reportable' else 'pending_review' end;
  end if;
  return new;
end $$;
revoke all on function app_private.apply_medication_reportability_policy() from public,anon,authenticated;
create trigger zz_apply_medication_reportability_policy before insert or update on public.incidents
for each row execute function app_private.apply_medication_reportability_policy();

create function app_private.sync_medication_care_notifications()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_recipient text; v_citation text;
begin
  if new.incident_type<>'medication_error' then return new; end if;
  if new.reportability_determined_at is null and exists(select 1 from public.facilities where id=new.facility_id and resident_regulatory_policy->>'medication_reportability'='statutory_errors') then
    update public.incident_notifications set status=case when new.reportability_status='reportable' then
      case when due_at<now() then 'overdue' else 'pending' end else 'not_required' end,
      notes=coalesce(notes,'')||E'\nMedication-event policy: '||case when new.reportability_status='reportable' then 'staff prescription error classified.' else 'Department report awaits the required human reportability determination.' end
    where incident_id=new.id and notification_type in ('state_hotline','written_report') and completed_at is null and status<>'completed';
    if new.reportability_status='reportable' then perform app_private.create_incident_notification_presets(new.id); end if;
  end if;
  if new.pathway_answers->>'event_kind' in ('actual_error','adverse_reaction') then
    v_citation:=case when new.pathway_answers->>'event_kind'='adverse_reaction' then '55 Pa. Code 2600.189 / 2800.189: immediately consult a physician or seek emergency care; notify the designated person and document response/action.'
      else '55 Pa. Code 2600.188(b)-(c) / 2800.188(b)-(c): immediately notify resident, designated person and prescriber; document the response.' end;
    foreach v_recipient in array case when new.pathway_answers->>'event_kind'='adverse_reaction' then array['prescriber','designated_person'] else array['prescriber','designated_person','resident'] end loop
      if not exists(select 1 from public.incident_notifications where incident_id=new.id and notification_type=v_recipient) then
        insert into public.incident_notifications(organization_id,facility_id,incident_id,notification_type,due_at,notes)
        values(new.organization_id,new.facility_id,new.id,v_recipient,coalesce(new.reported_at,new.occurred_at),v_citation);
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function app_private.sync_medication_care_notifications() from public,anon,authenticated;
create trigger sync_medication_care_notifications after insert or update of pathway_answers,reportability_status on public.incidents
for each row execute function app_private.sync_medication_care_notifications();

-- A pathway edit cannot overturn a documented human reportability determination.
do $migration$
declare v_body text; v_def text; v_new text;
begin
 select prosrc,pg_get_functiondef(oid) into strict v_body,v_def from pg_proc where oid='public.save_incident_pathway(uuid,text,jsonb,boolean)'::regprocedure;
 v_new:=replace(v_body,$old$when v_pathway.reportability = 'presumed_reportable'$old$,$new$when v_pathway.reportability = 'presumed_reportable' and v.reportability_determined_at is null$new$);
 if v_new=v_body then raise exception 'Review the pathway human-determination guard'; end if;
 execute replace(v_def,v_body,v_new);
end $migration$;
