-- REG8, REG9(a/b), REG26(a), REG38(d). Sources: 55 Pa. Code 2600/2800
-- sections 15, 16, 188 and 6 Pa. Code 15.152. Read 2026-09-26.
-- Source verification remains a human workflow: no citation verification stamp changes.
-- Existing notifications/completed history are intentionally not rewritten.

alter table public.incidents drop constraint incidents_incident_type_check;
alter table public.incidents add constraint incidents_incident_type_check check (incident_type in (
  'death','suspicious_death','suicide_attempt','elopement','abuse_allegation','sexual_abuse',
  'neglect_allegation','medication_error','significant_injury','serious_bodily_injury','assault',
  'resident_rights_violation','misuse_of_funds','communicable_disease_outbreak','food_poisoning',
  'fire','environmental_emergency','emergency_services','unscheduled_closure','bankruptcy',
  'criminal_conviction','utility_termination_notice','health_safety_violation','inadequate_staffing','other'
));

alter table public.incident_notifications drop constraint incident_notifications_notification_type_check;
alter table public.incident_notifications add constraint incident_notifications_notification_type_check
check (notification_type in ('state_hotline','family_guardian','resident','resident_family','designated_person',
  'law_enforcement','licensing_agency','protective_services','department_of_aging','prescriber',
  'supervision_plan','written_report','other'));

alter table public.incident_notification_rules
  add column facility_types text[] not null default array['PCH','ALR']::text[],
  add column deadline_basis text not null default 'elapsed_hours'
    check (deadline_basis in ('elapsed_hours','same_business_day'));
alter table public.incident_notification_rules drop constraint incident_notification_rules_due_hours_check;
alter table public.incident_notification_rules add constraint incident_notification_rules_due_hours_check
  check (due_hours >= 0 and due_hours <= 720);
comment on column public.incident_notification_rules.due_hours is
  'Zero means immediately, not a permitted delay. same_business_day uses the facility calendar instead.';

insert into public.incident_notification_rules (incident_type,notification_type,due_hours,citation,source_confidence,facility_types,note)
select t, 'state_hotline', 24, '55 Pa. Code 2600.16(a),(c) / 2800.16(a),(c)', 'unverified',
  case when t = 'inadequate_staffing' then array['ALR']::text[] else array['PCH','ALR']::text[] end,
  'Report the listed incident or condition to the Department within 24 hours. Inadequate staffing is specifically 2800.16(a)(20).'
from unnest(array['suspicious_death','suicide_attempt','sexual_abuse','serious_bodily_injury',
  'resident_rights_violation','misuse_of_funds','communicable_disease_outbreak','food_poisoning',
  'emergency_services','unscheduled_closure','bankruptcy','criminal_conviction',
  'utility_termination_notice','health_safety_violation','inadequate_staffing']) t
on conflict (incident_type,notification_type) do nothing;

-- ALF family and designated person are separate recipients; completing one does not complete both.
insert into public.incident_notification_rules (incident_type,notification_type,due_hours,citation,source_confidence,facility_types,note)
select distinct r.incident_type, n.kind, 0, '55 Pa. Code 2800.16(c)', 'unverified', array['ALR']::text[],
  'Immediately notify the resident family AND designated person of the reportable incident or condition.'
from public.incident_notification_rules r
cross join (values ('resident_family'),('designated_person')) n(kind)
where r.notification_type = 'state_hotline'
on conflict (incident_type,notification_type) do nothing;
update public.incident_notification_rules set facility_types = array['PCH','ALR']::text[],
  citation = '55 Pa. Code 2600.15(d) / 2800.15(d), 2800.16(c)',
  note = 'Immediately notify the designated person of suspected abuse or neglect; ALF also requires this for every reportable incident.'
where notification_type = 'designated_person' and incident_type in ('abuse_allegation','neglect_allegation','sexual_abuse','medication_error');

insert into public.incident_notification_rules (incident_type,notification_type,due_hours,citation,source_confidence,note)
values ('medication_error','prescriber',0,'55 Pa. Code 2600.188(b) / 2800.188(b)','unverified',
  'Immediately report the medication error to the prescribing practitioner. Record the recipient, time, instructions and follow-up.'),
  ('medication_error','resident',0,'55 Pa. Code 2600.188(b) / 2800.188(b)','unverified',
  'Immediately report the medication error to the resident.');
update public.incident_notification_rules set citation='55 Pa. Code 2600.188(b) / 2800.188(b)',
  note='Immediately report the medication error to the designated person.'
where incident_type='medication_error' and notification_type='designated_person';

insert into public.incident_notification_rules (incident_type,notification_type,due_hours,citation,source_confidence,note)
select t, n.kind, n.hours, n.citation, 'unverified', n.note
from unnest(array['sexual_abuse','serious_bodily_injury','suspicious_death']) t
cross join (values
  ('law_enforcement',0,'6 Pa. Code 15.152(a)(1)','Immediately make the oral report to law enforcement.'),
  ('protective_services',0,'6 Pa. Code 15.151(a)(1)','Immediately report suspected abuse to the local protective services agency.'),
  ('department_of_aging',0,'6 Pa. Code 15.152(a)(2)','Report to Aging during the current business day or, after normal business hours, at the next business-day opening. Reminder assumes 08:00-17:00 weekdays; confirm office hours and holidays.'),
  ('written_report',48,'6 Pa. Code 15.152(a)(3)','Written reports to law enforcement and protective services within 48 hours of the oral reports; record each recipient.')) n(kind,hours,citation,note);
update public.incident_notification_rules set deadline_basis = 'same_business_day'
where notification_type = 'department_of_aging';

insert into public.incident_pathways(key,label,incident_type,reportability,version,sort_order)
select distinct r.incident_type,initcap(replace(r.incident_type,'_',' ')),r.incident_type,'presumed_reportable',1,200
from public.incident_notification_rules r
where r.notification_type='state_hotline'
and not exists(select 1 from public.incident_pathways p where p.incident_type=r.incident_type)
on conflict(key) do nothing;

create or replace function app_private.incident_rule_due_at(p_known_at timestamptz,p_hours integer,p_basis text)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare v_local timestamp := p_known_at at time zone 'America/New_York'; v_day date := v_local::date;
begin
  if p_basis <> 'same_business_day' then return p_known_at + make_interval(hours => p_hours); end if;
  -- Weekends roll forward. Public holidays are intentionally not used to extend a deadline:
  -- this is a conservative reminder, not a claim that a holiday is a business day.
  if extract(isodow from v_day) not in (6,7) and v_local::time >= time '08:00' and v_local::time < time '17:00' then
    return (v_day + time '17:00') at time zone 'America/New_York';
  end if;
  if v_local::time >= time '17:00' then v_day := v_day + 1; end if;
  while extract(isodow from v_day) in (6,7) loop v_day := v_day + 1; end loop;
  return (v_day + time '08:00') at time zone 'America/New_York';
end $$;
revoke all on function app_private.incident_rule_due_at(timestamptz,integer,text) from public,anon,authenticated;

create or replace function app_private.create_incident_notification_presets(p_incident_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v public.incidents%rowtype; v_facility_type text; v_created integer;
begin
  select * into v from public.incidents where id=p_incident_id;
  if not found or v.reportability_status <> 'reportable' then return 0; end if;
  select facility_type into v_facility_type from public.facilities where id=v.facility_id;
  insert into public.incident_notifications (organization_id,facility_id,incident_id,notification_type,due_at,notes)
  select v.organization_id,v.facility_id,v.id,r.notification_type,
    app_private.incident_rule_due_at(coalesce(v.reportability_determined_at,v.reported_at,v.occurred_at),r.due_hours,r.deadline_basis),
    r.citation || ': ' || coalesce(r.note,'')
  from public.incident_notification_rules r
  where r.incident_type=v.incident_type and r.is_active and v_facility_type=any(r.facility_types)
    and not exists (select 1 from public.incident_notifications n where n.incident_id=v.id and n.notification_type=r.notification_type);
  get diagnostics v_created = row_count;
  return v_created;
end $$;
revoke all on function app_private.create_incident_notification_presets(uuid) from public,anon,authenticated;

create or replace function app_private.default_incident_reportability()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_pathway public.incident_pathways%rowtype;
begin
  if new.incident_type='inadequate_staffing' and not exists(select 1 from public.facilities where id=new.facility_id and facility_type='ALR') then
    raise exception 'The inadequate-staffing report category is specific to 2800.16(a)(20); use another applicable report category for this facility' using errcode='22023';
  end if;
  if new.reportability_status is distinct from 'pending_review' then return new; end if;
  if new.pathway_key is not null then
    select * into v_pathway from public.incident_pathways where key=new.pathway_key;
    if found then
      new.pathway_version := coalesce(new.pathway_version,v_pathway.version);
      if v_pathway.reportability='presumed_reportable' then new.reportability_status := 'reportable'; end if;
      return new;
    end if;
  end if;
  if exists (select 1 from public.incident_notification_rules r join public.facilities f on f.id=new.facility_id
    where r.incident_type=new.incident_type and r.notification_type='state_hotline' and r.is_active
      and f.facility_type=any(r.facility_types)) then new.reportability_status := 'reportable'; end if;
  return new;
end $$;
revoke all on function app_private.default_incident_reportability() from public,anon,authenticated;

-- The staff-involvement editor is an existing caller: an involved party on an abuse allegation
-- opens the immediately due plan/suspension submission, including when added after initial filing.
create or replace function app_private.seed_abuse_supervision_submissions(p_incident_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.incidents%rowtype;
begin
  select * into v from public.incidents where id=p_incident_id for update;
  if v.incident_type not in ('abuse_allegation','neglect_allegation','sexual_abuse') then return; end if;
  if not exists (select 1 from public.facilities where id=v.facility_id and facility_type in ('PCH','ALR')) then return; end if;
  insert into public.incident_notifications(organization_id,facility_id,incident_id,notification_type,due_at,notes)
  select v.organization_id,v.facility_id,v.id,'supervision_plan',coalesce(v.reported_at,v.occurred_at),
    '55 Pa. Code 2600.15(b)-(c) / 2800.15(b)-(c): implement a plan of supervision or suspend accused staff; immediately submit the plan or suspension to the Department. Attach the plan and record submission evidence for '||e.first_name||' '||e.last_name||'. [staff-involvement:'||s.id||']'
  from public.incident_staff_involved s join public.employees e on e.id=s.employee_id
  where s.incident_id=v.id and s.involvement_type='involved_party'
    and not exists (select 1 from public.incident_notifications n where n.incident_id=v.id and n.notification_type='supervision_plan'
      and n.notes like '%[staff-involvement:'||s.id||']%');
end $$;
revoke all on function app_private.seed_abuse_supervision_submissions(uuid) from public,anon,authenticated;
create or replace function app_private.require_abuse_supervision_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='incidents' then perform app_private.seed_abuse_supervision_submissions(new.id);
  else perform app_private.seed_abuse_supervision_submissions(new.incident_id); end if;
  return new;
end $$;
revoke all on function app_private.require_abuse_supervision_submission() from public,anon,authenticated;
create trigger require_abuse_supervision_submission after insert or update of involvement_type
on public.incident_staff_involved for each row execute function app_private.require_abuse_supervision_submission();
create trigger require_abuse_supervision_on_reclassification after update of incident_type
on public.incidents for each row execute function app_private.require_abuse_supervision_submission();

-- REG38(a): the actual first day of residence, not the day the admission is entered.
drop function public.complete_move_in_admission(uuid,text);
CREATE OR REPLACE FUNCTION public.complete_move_in_admission(p_workspace_id uuid, p_reason text, p_admission_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.move_in_workspaces%rowtype;
  v_resident public.residents%rowtype;
  v_prospect public.admission_prospects%rowtype;
  v_bed public.facility_beds%rowtype;
begin
  if p_admission_date is null or p_admission_date > public.pa_today() then
    raise exception 'Enter the first day the resident resided at the facility, not a future date' using errcode='22023';
  end if;
  select * into v from public.move_in_workspaces where id = p_workspace_id for update;
  if not found then raise exception 'Move-in workspace not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if v.state in ('completed','canceled') then raise exception 'Workspace is not open for admission' using errcode='55000'; end if;
  update public.residents set admission_date=p_admission_date where id=v.resident_id;
  perform public.refresh_move_in_readiness(v.id);
  select * into v from public.move_in_workspaces where id = p_workspace_id;
  if v.state <> 'ready' or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Workspace is not ready to admit' using errcode = '55000';
  end if;
  select * into v_resident from public.residents where id = v.resident_id for update;
  select * into v_prospect from public.admission_prospects where resident_id = v.resident_id for update;
  select * into v_bed from public.facility_beds where id = v_resident.bed_id for update;
  if v_bed.status <> 'reserved' or v_bed.reserved_for_prospect_id <> v_prospect.id then
    raise exception 'Reserved bed is no longer available' using errcode = '55000';
  end if;
  update public.facility_beds
  set status = 'occupied', occupied_by_resident_id = v_resident.id,
      reserved_for_prospect_id = null, updated_at = now()
  where id = v_bed.id;
  update public.residents
  set status = 'active', admission_date = p_admission_date, discharge_date = null,
      updated_at = now()
  where id = v_resident.id;
  update public.admission_prospects set stage = 'admitted', updated_at = now()
  where id = v_prospect.id;
  update public.move_in_workspaces
  set state = 'completed',
      readiness_snapshot = readiness_snapshot || jsonb_build_object(
        'admittedAt', now(), 'admissionDate', p_admission_date, 'admittedBy', auth.uid(), 'admissionReason', btrim(p_reason)
      ),
      updated_at = now()
  where id = v.id;
  insert into public.resident_census_events(
    organization_id, facility_id, resident_id, event_type, prior_status,
    resulting_status, prior_bed_id, resulting_bed_id, reason, actor_profile_id, effective_at
  ) values (
    v.organization_id, v.facility_id, v_resident.id, 'admitted',
    v_resident.status, 'active', v_resident.bed_id, v_resident.bed_id,
    btrim(p_reason), auth.uid(), public.pa_midnight(p_admission_date)
  );
  return v_resident.id;
end;
$function$
;


revoke all on function public.complete_move_in_admission(uuid,text,date) from public,anon; grant execute on function public.complete_move_in_admission(uuid,text,date) to authenticated,service_role;

-- Keep reinstatement aligned with the preset producer, including facility scope and calendar rules.
create or replace function public.determine_incident_reportability(p_incident_id uuid,p_status text,p_rationale text)
returns integer language plpgsql security definer set search_path='' as $$
declare v public.incidents%rowtype; v_created integer:=0; v_facility_type text;
begin
  if p_status is null or p_status not in ('reportable','not_reportable') then
    raise exception 'Reportability must be reportable or not_reportable' using errcode='22023';
  end if;
  if length(btrim(coalesce(p_rationale,''))) < 10 then
    raise exception 'A reportability determination requires a written rationale of at least 10 characters' using errcode='22023';
  end if;
  select * into v from public.incidents where id=p_incident_id for update;
  if not found then raise exception 'Incident not found' using errcode='P0002'; end if;
  perform app_private.assert_incident_manager(v.organization_id,v.facility_id);
  select facility_type into v_facility_type from public.facilities where id=v.facility_id;
  update public.incidents set reportability_status=p_status,reportability_determined_at=now(),
    reportability_determined_by=auth.uid(),reportability_rationale=btrim(p_rationale),updated_at=now()
  where id=v.id;
  if p_status='reportable' then
    update public.incident_notifications n
    set due_at=coalesce((select app_private.incident_rule_due_at(now(),r.due_hours,r.deadline_basis)
          from public.incident_notification_rules r where r.incident_type=v.incident_type
          and r.notification_type=n.notification_type and r.is_active and v_facility_type=any(r.facility_types)),n.due_at),
      status='pending',notes=coalesce(n.notes || E'\n','') || 'Reinstated: ' || btrim(p_rationale),updated_at=now()
    where n.incident_id=v.id and n.status='not_required';
    v_created:=app_private.create_incident_notification_presets(v.id);
  else
    update public.incident_notifications n set status='not_required',
      notes=coalesce(n.notes || E'\n','') || 'Determined not reportable: ' || btrim(p_rationale),updated_at=now()
    where n.incident_id=v.id and n.status<>'completed' and n.completed_at is null
      -- Care response and staff protection are separate from reporting the event to DHS.
      and n.notification_type not in ('prescriber','resident','supervision_plan')
      and not (v.incident_type='medication_error' and n.notification_type='designated_person');
  end if;
  return v_created;
end $$;
revoke all on function public.determine_incident_reportability(uuid,text,text) from public,anon;
grant execute on function public.determine_incident_reportability(uuid,text,text) to authenticated,service_role;

create or replace function app_private.require_prescriber_response()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.notification_type='prescriber' and new.status='completed' then
    if length(btrim(coalesce(new.recipient,'')))=0 or length(btrim(coalesce(new.notes,'')))<5 or new.completed_at is null then
      raise exception 'Record the prescriber recipient, response and follow-up before completing this notification' using errcode='23514';
    end if;
    if tg_op='UPDATE' and old.status<>'completed' and new.notes is not distinct from old.notes then
      raise exception 'Add the prescriber response and follow-up to the notification notes before completing it' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.require_prescriber_response() from public,anon,authenticated;
create trigger require_prescriber_response before insert or update on public.incident_notifications
for each row execute function app_private.require_prescriber_response();

-- REG9(d): preserve the underlying cycle engine while recording structured signed-plan review.
alter table public.resident_compliance_items add column final_plan_review jsonb;
comment on column public.resident_compliance_items.final_plan_review is
  'Documented LPN approval under named RN supervision for 2800.227(b), with license numbers, approval date, source document and recorder; never backfilled.';
alter function public.complete_resident_compliance_item(uuid,uuid,date) rename to complete_resident_compliance_item_core;
alter function public.complete_resident_compliance_item_core(uuid,uuid,date) set schema app_private;
revoke all on function app_private.complete_resident_compliance_item_core(uuid,uuid,date) from public,anon,authenticated,service_role;

create function public.complete_resident_compliance_item(p_item_id uuid,p_document_id uuid,p_completed_on date default null,p_review_attestation jsonb default null)
returns public.resident_compliance_items language plpgsql security definer set search_path='' as $$
declare v public.resident_compliance_items%rowtype; v_facility_type text; v_reviewed_on date;
begin
  select * into v from public.resident_compliance_items where id=p_item_id for update;
  if not found then raise exception 'Resident compliance item not found' using errcode='P0002'; end if;
  if not coalesce(public.is_platform_admin() or (v.organization_id=public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(v.facility_id)),false) then
    raise exception 'Not authorized to complete this resident compliance item' using errcode='42501';
  end if;
  if v.status='compliant' and v.completed_date is not null then return v; end if;
  if v.item_type='change_medical_evaluation' and p_completed_on is null then
    raise exception 'Enter the actual medical examination date' using errcode='22023';
  end if;
  select facility_type into v_facility_type from public.facilities where id=v.facility_id;
  if v_facility_type='ALR' and v.item_type='support_plan_30day' then
    if jsonb_typeof(p_review_attestation) is distinct from 'object'
      or exists(select 1 from unnest(array['lpn_name','lpn_license','rn_supervisor_name','rn_supervisor_license']) k
        where length(btrim(coalesce(p_review_attestation->>k,'')))<2)
      or p_completed_on is null or nullif(p_review_attestation->>'reviewed_on','') is null then
      raise exception 'Document LPN approval, both nursing license numbers, RN supervision and the actual approval date for the ALF final plan' using errcode='23514';
    end if;
    v_reviewed_on := (p_review_attestation->>'reviewed_on')::date;
    if v_reviewed_on > p_completed_on or v_reviewed_on > public.pa_today() then
      raise exception 'Final plan approval must occur on or before its completion date and cannot be future dated' using errcode='23514';
    end if;
    update public.resident_compliance_items set final_plan_review=jsonb_build_object(
      'lpn_name',btrim(p_review_attestation->>'lpn_name'),'lpn_license',btrim(p_review_attestation->>'lpn_license'),
      'rn_supervisor_name',btrim(p_review_attestation->>'rn_supervisor_name'),'rn_supervisor_license',btrim(p_review_attestation->>'rn_supervisor_license'),
      'reviewed_on',v_reviewed_on,'document_id',p_document_id,'recorded_by',auth.uid(),'recorded_at',now()) where id=v.id;
  end if;
  return app_private.complete_resident_compliance_item_core(p_item_id,p_document_id,p_completed_on);
end $$;
revoke all on function public.complete_resident_compliance_item(uuid,uuid,date,jsonb) from public,anon;
grant execute on function public.complete_resident_compliance_item(uuid,uuid,date,jsonb) to authenticated,service_role;

-- REG9(e): certification is its own signed, qualified pre-admission decision, not a generic
-- clinical-review checkbox. Existing active workspaces acquire the task; historical admissions do not.
create or replace function app_private.seed_alf_needs_certification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.facilities where id=new.facility_id and facility_type='ALR') then
    insert into public.move_in_tasks(organization_id,facility_id,workspace_id,task_key,title,due_at,
      requires_document,requires_signature,requires_approval)
    values(new.organization_id,new.facility_id,new.id,'alf_needs_certification',
      'Certify needs can be met before admission · 2800.22(b)',public.pa_midnight(new.target_move_in_date),true,true,true)
    on conflict(workspace_id,task_key) do nothing;
  end if;
  return new;
end $$;
revoke all on function app_private.seed_alf_needs_certification() from public,anon,authenticated;
create trigger seed_alf_needs_certification after insert on public.move_in_workspaces
for each row execute function app_private.seed_alf_needs_certification();

insert into public.move_in_tasks(organization_id,facility_id,workspace_id,task_key,title,due_at,
  requires_document,requires_signature,requires_approval)
select w.organization_id,w.facility_id,w.id,'alf_needs_certification',
  'Certify needs can be met before admission · 2800.22(b)',public.pa_midnight(w.target_move_in_date),true,true,true
from public.move_in_workspaces w join public.facilities f on f.id=w.facility_id
where f.facility_type='ALR' and w.state in ('active','ready')
on conflict(workspace_id,task_key) do nothing;

create or replace function app_private.validate_alf_needs_certification()
returns trigger language plpgsql set search_path='' as $$
declare v_signature jsonb:=new.signature_evidence;
begin
  if new.task_key='alf_needs_certification' and new.state in ('approved','completed','exception') then
    if new.document_id is null or jsonb_typeof(v_signature) is distinct from 'object'
      or length(btrim(coalesce(v_signature->>'signerName','')))<2
      or coalesce(v_signature->>'canMeetNeeds','')<>'true'
      or coalesce(v_signature->>'priorToAdmission','')<>'true'
      or coalesce(v_signature->>'certifierRole','') not in ('administrator_consulted','physician','crnp','medical_director')
      or nullif(v_signature->>'signedAt','') is null
      or (v_signature->>'certifierRole'='administrator_consulted' and length(btrim(coalesce(v_signature->>'consultedProvider','')))<2) then
      raise exception 'Attach the signed pre-admission needs certification and record qualified certifier, consultation when applicable, actual signature time and prior-to-admission confirmation' using errcode='23514';
    end if;
    if (v_signature->>'signedAt')::timestamptz>now() then
      raise exception 'Certification signature time cannot be in the future' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.validate_alf_needs_certification() from public,anon,authenticated;
create trigger validate_alf_needs_certification before insert or update on public.move_in_tasks
for each row execute function app_private.validate_alf_needs_certification();

-- Recheck actual admission day against the signed certification, including backdated admissions.
create or replace function app_private.check_alf_certification_at_admission()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.state<>'completed' and new.state='completed'
    and exists(select 1 from public.facilities where id=new.facility_id and facility_type='ALR')
    and not exists(select 1 from public.move_in_tasks t join public.residents r on r.id=new.resident_id
      where t.workspace_id=new.id and t.task_key='alf_needs_certification'
        and t.state in ('approved','completed') and t.document_id is not null
        and coalesce(t.signature_evidence->>'priorToAdmission','')='true'
        and ((t.signature_evidence->>'signedAt')::timestamptz at time zone 'America/New_York')::date <= r.admission_date) then
    raise exception 'ALF admission requires a qualified signed needs certification made before actual admission' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function app_private.check_alf_certification_at_admission() from public,anon,authenticated;
create trigger check_alf_certification_at_admission before update of state on public.move_in_workspaces
for each row execute function app_private.check_alf_certification_at_admission();

do $$ declare v_id uuid; begin
  for v_id in select w.id from public.move_in_workspaces w join public.facilities f on f.id=w.facility_id
    where f.facility_type='ALR' and w.state in ('active','ready') loop
    perform public.refresh_move_in_readiness(v_id);
  end loop;
end $$;

-- The existing final-report reminder remains an internal 48-hour target for the new categories.
insert into public.incident_notification_rules(incident_type,notification_type,due_hours,citation,source_confidence,facility_types,note)
select r.incident_type,'written_report',48,'55 Pa. Code 2600.16(d) / 2800.16(d)','unverified',r.facility_types,
  'Final report immediately after the investigation concludes; 48 hours is an internal preparation target, not a statutory deadline.'
from public.incident_notification_rules r where r.notification_type='state_hotline'
on conflict(incident_type,notification_type) do nothing;
