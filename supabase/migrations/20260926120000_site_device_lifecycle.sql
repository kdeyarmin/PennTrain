-- REG26 / REG39. Reviews are append-only: a changed assessment does not rewrite
-- the evidence that supported an earlier device, vehicle or fire approval.
create table public.facility_site_policies (
  facility_id uuid primary key references public.facilities(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  count_unsuccessful_pch_drills boolean not null default false,
  inspection_grace text not null default 'strict' check (inspection_grace in ('strict','rcg')),
  alf_approval_renewal text not null default 'every_three_years' check (alf_approval_renewal in ('every_three_years','changed_use')),
  rationale text not null check (length(btrim(rationale)) >= 5),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table public.facility_site_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  review_type text not null check (review_type in ('bedside_device','voice_device','vehicle_documents','driver_license','fire_approval')),
  inspection_item_id uuid references public.inspection_items(id) on delete restrict,
  vehicle_id uuid references public.facility_transport_vehicles(id) on delete restrict,
  employee_id uuid references public.employees(id) on delete restrict,
  external_driver_name text,
  resident_id uuid references public.residents(id) on delete restrict,
  support_plan_id uuid references public.resident_support_plans(id) on delete restrict,
  agreement_version_id uuid references public.resident_agreement_versions(id) on delete restrict,
  supersedes_id uuid references public.facility_site_reviews(id) on delete restrict unique,
  event_kind text not null default 'review' check (event_kind in ('review','removed','withdrawn','restricted','renovation','use_changed','renewed')),
  occurred_at timestamptz not null,
  next_review_on date,
  details jsonb not null default '{}' check (jsonb_typeof(details)='object'),
  evidence text not null check (length(btrim(evidence)) >= 5),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index facility_site_reviews_facility_idx on public.facility_site_reviews(facility_id,occurred_at desc);
create index facility_site_reviews_item_idx on public.facility_site_reviews(inspection_item_id,created_at desc);
create index facility_site_reviews_vehicle_idx on public.facility_site_reviews(vehicle_id,created_at desc);
alter table public.facility_site_policies enable row level security;
alter table public.facility_site_reviews enable row level security;

do $policies$ declare v_table text; begin
  foreach v_table in array array['facility_site_policies','facility_site_reviews'] loop
    execute format('create policy site_read on public.%I for select to authenticated using (app_private.admission_row_visible(organization_id,facility_id))',v_table);
    execute format('create policy site_write on public.%I for insert to authenticated with check (public.is_platform_admin() or (organization_id=public.current_org_id() and public.current_role() in (''org_admin'',''facility_manager'') and public.is_assigned_to_facility(facility_id)))',v_table);
    execute format('create policy product_module_entitlement on public.%I as restrictive for all to authenticated using ((select app_private.has_product_module(''modules.carebase''))) with check ((select app_private.has_product_module(''modules.carebase'')))',v_table);
    execute format('create policy sms_mfa_session_required on public.%I as restrictive for all to authenticated using ((select public.current_sms_mfa_satisfied())) with check ((select public.current_sms_mfa_satisfied()))',v_table);
    execute format('create policy impersonation_session_lifetime on public.%I as restrictive for all to authenticated using ((select public.current_impersonation_session_live())) with check ((select public.current_impersonation_session_live()))',v_table);
    execute format('create policy site_identity_insert on public.%I as restrictive for insert to authenticated with check ((select public.identity_assurance_is_current(''compliance_profile_admin'')))',v_table);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',v_table);
    execute format('grant select,insert on public.%I to authenticated',v_table);
    execute format('grant all on public.%I to service_role',v_table);
    execute format('create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()',v_table);
    insert into app_private.product_module_resources(resource_schema,resource_name,module_key) values('public',v_table,'modules.carebase');
    insert into app_private.audit_entity_manifest(table_name,audit_mode,contains_regulated_data,rationale)
      values(v_table,'row_trigger',true,'Facility device, transport and fire-safety evidence and policy choices are retained with an audit trail.');
  end loop;
end $policies$;
grant update on public.facility_site_policies to authenticated;
create policy site_clinical_scope on public.facility_site_reviews as restrictive for select to authenticated
using (resident_id is null or public.can_read_clinical_record(organization_id,facility_id));
create policy site_update on public.facility_site_policies for update to authenticated
using (public.is_platform_admin() or (organization_id=public.current_org_id() and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(facility_id)))
with check (public.is_platform_admin() or (organization_id=public.current_org_id() and public.current_role() in ('org_admin','facility_manager') and public.is_assigned_to_facility(facility_id)));
create policy site_identity_update on public.facility_site_policies as restrictive for update to authenticated
using ((select public.identity_assurance_is_current('compliance_profile_admin'))) with check ((select public.identity_assurance_is_current('compliance_profile_admin')));

create or replace function public.validate_facility_site_record()
returns trigger language plpgsql set search_path='' as $$
declare v_type text; v_org uuid; v_key text; v_previous public.facility_site_reviews%rowtype; v_time timestamptz; v_doc uuid;
begin
  select organization_id,facility_type into v_org,v_type from public.facilities where id=new.facility_id;
  if v_org is distinct from new.organization_id or v_type not in ('PCH','ALR') then
    raise exception 'Site regulatory records require a PCH/ALF in the same organization' using errcode='23514';
  end if;
  if tg_table_name='facility_site_policies' then
    if tg_op='UPDATE' and (new.facility_id<>old.facility_id or new.organization_id<>old.organization_id) then raise exception 'Policy scope cannot change' using errcode='23514'; end if;
    if new.count_unsuccessful_pch_drills and v_type<>'PCH' then raise exception 'The unsuccessful-drill interpretation is documented only in the PCH RCG' using errcode='23514'; end if;
    new.updated_by:=auth.uid(); new.updated_at:=now(); return new;
  end if;
  if new.occurred_at>now() then raise exception 'An evidence event cannot be in the future' using errcode='23514'; end if;
  if new.review_type='bedside_device' and new.resident_id is null then raise exception 'Bedside device lifecycle requires the resident' using errcode='23514'; end if;
  if (new.support_plan_id is not null and new.review_type<>'bedside_device') or (new.agreement_version_id is not null and new.review_type<>'voice_device') or (new.resident_id is not null and new.review_type not in ('bedside_device','voice_device')) then raise exception 'Unexpected resident evidence link for this review type' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',new.facility_id,new.review_type,new.inspection_item_id,new.vehicle_id,new.resident_id,new.employee_id,lower(btrim(new.external_driver_name))),0));
  if new.resident_id is not null and not exists(select 1 from public.residents where id=new.resident_id and facility_id=new.facility_id and organization_id=new.organization_id) then raise exception 'Resident is outside this facility' using errcode='23514'; end if;
  if new.review_type='driver_license' then
    if new.vehicle_id is not null or new.inspection_item_id is not null or new.resident_id is not null or ((new.employee_id is not null)::integer + (nullif(btrim(new.external_driver_name),'') is not null)::integer)<>1 then raise exception 'Identify exactly one employee or external driver' using errcode='23514'; end if;
    if new.employee_id is not null and not exists(select 1 from public.employees e where e.id=new.employee_id and e.organization_id=new.organization_id and (e.facility_id=new.facility_id or exists(select 1 from public.employee_facility_assignments a where a.employee_id=e.id and a.facility_id=new.facility_id))) then raise exception 'Driver is outside this facility' using errcode='23514'; end if;
  elsif new.employee_id is not null or new.external_driver_name is not null then raise exception 'Only driver reviews identify an employee or external driver' using errcode='23514';
  elsif new.review_type='vehicle_documents' then
    if new.vehicle_id is null or new.inspection_item_id is not null or not exists(select 1 from public.facility_transport_vehicles where id=new.vehicle_id and facility_id=new.facility_id and organization_id=new.organization_id) then raise exception 'Select a vehicle in this facility' using errcode='23514'; end if;
  elsif new.inspection_item_id is null or new.vehicle_id is not null or not exists(select 1 from public.inspection_items where id=new.inspection_item_id and facility_id=new.facility_id and organization_id=new.organization_id and item_type=case new.review_type when 'bedside_device' then 'bedside_mobility_device' when 'voice_device' then 'voice_controlled_device_policy' else 'fire_safety_approval' end) then
    raise exception 'Select the matching device or fire-approval inspection item in this facility' using errcode='23514';
  end if;
  if new.supersedes_id is not null then
    select * into v_previous from public.facility_site_reviews where id=new.supersedes_id;
    if not found or (v_previous.facility_id,v_previous.review_type,v_previous.inspection_item_id,v_previous.vehicle_id,v_previous.resident_id,v_previous.employee_id,v_previous.external_driver_name) is distinct from (new.facility_id,new.review_type,new.inspection_item_id,new.vehicle_id,new.resident_id,new.employee_id,new.external_driver_name) or new.occurred_at<v_previous.occurred_at then raise exception 'A follow-up must retain its subject and follow the prior event' using errcode='23514'; end if;
    if new.review_type='fire_approval' and v_previous.event_kind in ('withdrawn','restricted','renovation') then
      if new.event_kind=v_previous.event_kind and new.occurred_at is distinct from v_previous.occurred_at then raise exception 'Notice follow-ups retain the original event time' using errcode='23514'; end if;
      if new.event_kind<>v_previous.event_kind and ((v_previous.event_kind in ('withdrawn','restricted') and (nullif(v_previous.details->>'oral_notified_at','') is null or nullif(v_previous.details->>'written_notified_at','') is null)) or (v_previous.event_kind='renovation' and nullif(v_previous.details->>'submitted_at','') is null)) then raise exception 'Complete the pending DHS notice/submission record before starting a new approval event' using errcode='23514'; end if;
    end if;
  elsif exists(select 1 from public.facility_site_reviews where facility_id=new.facility_id and review_type=new.review_type and inspection_item_id is not distinct from new.inspection_item_id and vehicle_id is not distinct from new.vehicle_id and resident_id is not distinct from new.resident_id and employee_id is not distinct from new.employee_id and external_driver_name is not distinct from new.external_driver_name) then
    raise exception 'Append a follow-up to the latest record instead of creating a parallel history' using errcode='23514';
  end if;
  if new.event_kind='removed' then
    if new.review_type not in ('bedside_device','voice_device') or length(btrim(coalesce(new.details->>'removal_reason','')))<5 then raise exception 'Device removal requires its reason and actual removal time' using errcode='23514'; end if;
    new.next_review_on:=null;
  elsif new.review_type='bedside_device' then
    if new.event_kind<>'review' or new.resident_id is null or new.support_plan_id is null or not exists(select 1 from public.resident_support_plans where id=new.support_plan_id and resident_id=new.resident_id and facility_id=new.facility_id and state in ('approved','effective')) then raise exception 'Bedside use requires the resident and an approved/effective support plan' using errcode='23514'; end if;
    foreach v_key in array array['need','intended_use','risks','safe_use_ability','cover','installation','entrapment_measurements','independent_operation','unrestricted_movement','review_procedure'] loop
      if length(btrim(coalesce(new.details->>v_key,'')))<3 then raise exception 'Bedside review requires evidence for %',v_key using errcode='23514'; end if;
    end loop;
    if new.details->>'appropriate' is distinct from 'true' then raise exception 'An inappropriate bedside device must be recorded as removed immediately' using errcode='23514'; end if;
    if v_type='ALR' and length(btrim(coalesce(new.details->>'alf_203','')))<3 then raise exception 'ALF bedside review requires section 2800.203 evidence' using errcode='23514'; end if;
    if new.next_review_on is null or new.next_review_on<=public.pa_day(new.occurred_at) then raise exception 'Set the periodic review date from the facility procedure' using errcode='23514'; end if;
  elsif new.review_type='voice_device' then
    if new.event_kind<>'review' then raise exception 'Voice device records must be reviews or removals' using errcode='23514'; end if;
    foreach v_key in array array['ownership','policy_notice','consent_privacy','contract_terms','review_procedure'] loop
      if length(btrim(coalesce(new.details->>v_key,'')))<3 then raise exception 'Voice-device review requires %',v_key using errcode='23514'; end if;
    end loop;
    if new.details->>'ownership' not in ('resident','facility') then raise exception 'Record resident or facility ownership' using errcode='23514'; end if;
    if new.details->>'ownership'='resident' and new.resident_id is null then raise exception 'A resident-owned device requires a resident' using errcode='23514'; end if;
    if new.resident_id is not null and (new.agreement_version_id is null or not exists(select 1 from public.resident_agreement_versions v join public.resident_agreements a on a.id=v.agreement_id where v.id=new.agreement_version_id and v.resident_id=new.resident_id and v.facility_id=new.facility_id and v.status='active' and a.status='executed')) then raise exception 'Link the executed resident agreement version containing device terms' using errcode='23514'; end if;
    if new.details->>'ownership'='facility' then
      foreach v_key in array array['administrators','posted_notice','history_deletion','disclosure_policy'] loop
        if length(btrim(coalesce(new.details->>v_key,'')))<3 then raise exception 'Facility voice-device safeguards require %',v_key using errcode='23514'; end if;
      end loop;
    end if;
    if new.next_review_on is null or new.next_review_on<=public.pa_day(new.occurred_at) then raise exception 'Set the next device-policy review date' using errcode='23514'; end if;
  elsif new.review_type='vehicle_documents' then
    if new.event_kind<>'review' then raise exception 'Vehicle documents require a review record' using errcode='23514'; end if;
    foreach v_key in array array['registration','insurance','inspection'] loop
      v_doc:=nullif(new.details->>(v_key||'_document_id'),'')::uuid;
      if v_doc is null or not exists(select 1 from public.training_documents where id=v_doc and organization_id=new.organization_id and facility_id=new.facility_id and employee_id is null) then raise exception 'Link the facility document copy for %',v_key using errcode='23514'; end if;
      if nullif(new.details->>(v_key||'_expires_on'),'')::date is null then raise exception 'Record the actual % expiration date',v_key using errcode='23514'; end if;
    end loop;
    new.next_review_on:=least((new.details->>'registration_expires_on')::date,(new.details->>'insurance_expires_on')::date,(new.details->>'inspection_expires_on')::date);
  elsif new.review_type='driver_license' then
    if new.event_kind<>'review' then raise exception 'Driver licenses require a review record' using errcode='23514'; end if;
    foreach v_key in array case when new.details->>'cdl_required'='true' then array['license','cdl'] else array['license'] end loop
      v_doc:=nullif(new.details->>(v_key||'_document_id'),'')::uuid;
      if v_doc is null or not exists(select 1 from public.training_documents where id=v_doc and organization_id=new.organization_id and facility_id=new.facility_id and employee_id is not distinct from new.employee_id) then raise exception 'Link the driver document copy for %',v_key using errcode='23514'; end if;
      if nullif(new.details->>(v_key||'_expires_on'),'')::date is null then raise exception 'Record the actual % expiration date',v_key using errcode='23514'; end if;
    end loop;
    if new.details->>'adult_driver_verified' is distinct from 'true' then raise exception 'Confirm the driver is at least 18 years old' using errcode='23514'; end if;
    new.next_review_on:=least((new.details->>'license_expires_on')::date,nullif(new.details->>'cdl_expires_on','')::date);
  else
    if new.event_kind not in ('review','withdrawn','restricted','renovation','use_changed','renewed') then raise exception 'Invalid fire-approval event' using errcode='23514'; end if;
    foreach v_key in array array['oral_notified_at','written_notified_at','submitted_at'] loop
      v_time:=nullif(new.details->>v_key,'')::timestamptz;
      if v_time is not null and (v_time<new.occurred_at or v_time>now() or length(btrim(coalesce(new.details->>(v_key||'_evidence'),'')))<3) then raise exception 'Record actual notification/submission time and delivery evidence for %',v_key using errcode='23514'; end if;
    end loop;
    if new.event_kind in ('review','renewed','use_changed') or nullif(new.details->>'submitted_at','') is not null then
      v_doc:=nullif(new.details->>'approval_document_id','')::uuid;
      if v_doc is null or not exists(select 1 from public.training_documents where id=v_doc and organization_id=new.organization_id and facility_id=new.facility_id and employee_id is null) then raise exception 'Link the fire approval or written authority certification document' using errcode='23514'; end if;
    end if;
    if v_type='ALR' and new.event_kind in ('review','renewed','use_changed') then
      if nullif(new.details->>'approval_issued_on','')::date is null or (new.details->>'approval_issued_on')::date>public.pa_day(new.occurred_at) then raise exception 'Record the actual fire approval issue date; a review does not restart its term' using errcode='23514'; end if;
      if coalesce((select alf_approval_renewal from public.facility_site_policies where facility_id=new.facility_id),'every_three_years')='every_three_years' or new.event_kind='use_changed' or new.details->>'changed_use_within_three_years'='true' then
        new.next_review_on:=least(new.next_review_on,((new.details->>'approval_issued_on')::date+interval '3 years')::date);
      end if;
    end if;
  end if;
  new.created_by:=auth.uid(); new.created_at:=now(); return new;
end $$;
revoke all on function public.validate_facility_site_record() from public,anon,authenticated;
create trigger validate_site_policy before insert or update on public.facility_site_policies for each row execute function public.validate_facility_site_record();
create trigger validate_site_review before insert on public.facility_site_reviews for each row execute function public.validate_facility_site_record();

-- A retained child FK blocks parent cascades too, including historical drill
-- findings, rather than relying only on the direct event DELETE policy.
alter table public.inspection_events drop constraint inspection_events_inspection_item_id_fkey;
alter table public.inspection_events add constraint inspection_events_inspection_item_id_fkey foreign key(inspection_item_id) references public.inspection_items(id) on delete restrict;

create or replace function public.require_current_transport_vehicle_documents()
returns trigger language plpgsql set search_path='' as $$
declare v public.facility_site_reviews%rowtype; v_key text;
begin
  if new.vehicle_id is null or new.status<>'scheduled' then return new; end if;
  if tg_op='UPDATE' and new.vehicle_id is not distinct from old.vehicle_id and new.starts_at is not distinct from old.starts_at then return new; end if;
  if not exists(select 1 from public.facilities where id=new.facility_id and facility_type in ('PCH','ALR')) then return new; end if;
  if not exists(select 1 from public.facility_transport_vehicles where id=new.vehicle_id and facility_id=new.facility_id and status='available') then raise exception 'The vehicle is not available' using errcode='23514'; end if;
  select r.* into v from public.facility_site_reviews r where r.vehicle_id=new.vehicle_id and r.review_type='vehicle_documents' and not exists(select 1 from public.facility_site_reviews child where child.supersedes_id=r.id) order by r.created_at desc,r.id desc limit 1;
  if not found then raise exception 'Record vehicle registration, insurance and inspection copies before scheduling transport' using errcode='23514'; end if;
  foreach v_key in array array['registration','insurance','inspection'] loop
    if not exists(select 1 from public.training_documents where id=(v.details->>(v_key||'_document_id'))::uuid and facility_id=new.facility_id) then raise exception 'The vehicle % document copy is missing',v_key using errcode='23514'; end if;
    if (v.details->>(v_key||'_expires_on'))::date<public.pa_day(new.starts_at) then raise exception 'Vehicle % expires before this trip',v_key using errcode='23514'; end if;
  end loop;
  return new;
end $$;
revoke all on function public.require_current_transport_vehicle_documents() from public,anon,authenticated;
create trigger require_vehicle_documents before insert or update on public.resident_service_calendar_events for each row execute function public.require_current_transport_vehicle_documents();

create or replace function public.require_current_transport_driver_license()
returns trigger language plpgsql set search_path='' as $$
declare v_event public.resident_service_calendar_events%rowtype; v public.facility_site_reviews%rowtype; v_key text;
begin
  select * into v_event from public.resident_service_calendar_events where id=new.event_id;
  if new.assignment_role<>'driver' or v_event.transportation_mode<>'facility_vehicle' or v_event.status<>'scheduled' or not exists(select 1 from public.facilities where id=new.facility_id and facility_type in ('PCH','ALR')) then return new; end if;
  select r.* into v from public.facility_site_reviews r where r.facility_id=new.facility_id and r.review_type='driver_license'
    and r.employee_id is not distinct from new.employee_id and lower(btrim(r.external_driver_name)) is not distinct from lower(btrim(new.external_staff_name))
    and not exists(select 1 from public.facility_site_reviews child where child.supersedes_id=r.id) order by r.created_at desc,r.id desc limit 1;
  if not found then raise exception 'Record current driver license evidence before assigning this driver' using errcode='23514'; end if;
  foreach v_key in array case when v.details->>'cdl_required'='true' then array['license','cdl'] else array['license'] end loop
    if not exists(select 1 from public.training_documents where id=(v.details->>(v_key||'_document_id'))::uuid and facility_id=new.facility_id) or (v.details->>(v_key||'_expires_on'))::date<public.pa_day(v_event.starts_at) then raise exception 'The driver % copy is missing or expires before this trip',v_key using errcode='23514'; end if;
  end loop;
  return new;
end $$;
revoke all on function public.require_current_transport_driver_license() from public,anon,authenticated;
create trigger require_driver_license before insert or update on public.resident_service_calendar_event_staff for each row execute function public.require_current_transport_driver_license();
create or replace function public.recheck_transport_driver_on_reschedule()
returns trigger language plpgsql set search_path='' as $$ begin
  if new.status='scheduled' and (new.starts_at is distinct from old.starts_at or new.vehicle_id is distinct from old.vehicle_id) then
    update public.resident_service_calendar_event_staff set instructions=instructions where event_id=new.id and assignment_role='driver';
  end if;
  return new;
end $$;
revoke all on function public.recheck_transport_driver_on_reschedule() from public,anon,authenticated;
create trigger recheck_transport_driver after update on public.resident_service_calendar_events for each row execute function public.recheck_transport_driver_on_reschedule();

create or replace function app_private.site_inspection_grace(p_facility uuid,p_type text)
returns integer language sql stable security definer set search_path='' as $$
  select case when coalesce((select inspection_grace from public.facility_site_policies where facility_id=p_facility),'strict')<>'rcg' then 0
    when p_type in ('fire_safety_expert_inspection','evacuation_time_letter','emergency_prep_plan_review','furnace_inspection','wood_coal_stove_approval','fireplace_chimney_service') then 15
    when p_type in ('smoke_detector','fire_alarm_system','private_water_coliform_test','sleeping_hours_fire_drill') then 5
    else 0 end;
$$;
revoke all on function app_private.site_inspection_grace(uuid,text) from public,anon,authenticated;
-- Only the PCH RCG supplies the unsuccessful-drill interpretation. An evacuation
-- violation remains an independent recorded finding under either counting policy.
do $patch$ declare v_def text; begin
  v_def:=pg_get_functiondef('public.recalculate_inspection_item_compliance(uuid)'::regprocedure);
  if position('where e.result = ''pass''' in v_def)=0 or position('when i.next_due_date < v_pa_today then ''expired''' in v_def)=0 then raise exception 'Inspection recalc changed; review the policy splice'; end if;
  v_def:=replace(v_def,'where e.result = ''pass''',
    'where (e.result = ''pass'' or (ii.item_type in (''fire_drill_program'',''sleeping_hours_fire_drill'') and exists(select 1 from public.facility_site_policies p join public.facilities f on f.id=p.facility_id where p.facility_id=ii.facility_id and f.facility_type=''PCH'' and p.count_unsuccessful_pch_drills)))');
  v_def:=replace(v_def,'when i.next_due_date < v_pa_today then ''expired''',
    'when i.next_due_date + app_private.site_inspection_grace(i.facility_id,i.item_type) < v_pa_today then ''expired''');
  execute v_def;
end $patch$;
create or replace function app_private.recalculate_site_policy_items()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid; begin
  for v_id in select id from public.inspection_items where facility_id=new.facility_id loop
    perform public.recalculate_inspection_item_compliance(v_id);
  end loop;
  return new;
end $$;
revoke all on function app_private.recalculate_site_policy_items() from public,anon,authenticated;
create trigger recalculate_site_policy_items after insert or update on public.facility_site_policies for each row execute function app_private.recalculate_site_policy_items();

-- A failed drill can meet a chosen monthly frequency policy, but must not erase
-- its evacuation finding or allow a corrected row to escape the history.
create or replace function public.retain_site_review_history()
returns trigger language plpgsql set search_path='' as $$ begin
  raise exception 'Site reviews are immutable; append a follow-up or correction record' using errcode='23514';
end $$;
revoke all on function public.retain_site_review_history() from public,anon,authenticated;
create trigger retain_site_review_history before update on public.facility_site_reviews for each row execute function public.retain_site_review_history();

create or replace function public.get_facility_site_reviews(p_facility_id uuid,p_offset integer default 0)
returns setof public.facility_site_reviews language plpgsql set search_path='' as $$
declare v public.facility_site_reviews%rowtype; v_seen uuid[]:='{}'; begin
  if p_offset<0 then raise exception 'Invalid offset' using errcode='22023'; end if;
  for v in select * from public.facility_site_reviews where facility_id=p_facility_id order by created_at desc,id limit 1000 offset p_offset loop
    if v.resident_id is not null and not (v.resident_id=any(v_seen)) then
      perform public.log_clinical_access(v.resident_id,'view_domain','device_safety',null,null);
      v_seen:=array_append(v_seen,v.resident_id);
    end if;
    return next v;
  end loop;
end $$;
revoke all on function public.get_facility_site_reviews(uuid,integer) from public,anon,authenticated;
grant execute on function public.get_facility_site_reviews(uuid,integer) to authenticated;

-- A complete device assessment advances the actual inspection schedule; removal
-- retires that device item and its alerts. The immutable review is the evidence.
create or replace function app_private.apply_device_lifecycle_review()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.review_type not in ('bedside_device','voice_device') then return new; end if;
  if new.event_kind='removed' then
    update public.inspection_items set is_active=false where id=new.inspection_item_id;
  else
    update public.inspection_items set is_active=true,inspection_interval_days=new.next_review_on-public.pa_day(new.occurred_at) where id=new.inspection_item_id;
    insert into public.inspection_events(inspection_item_id,performed_date,performed_by,result,notes)
    values(new.inspection_item_id,public.pa_day(new.occurred_at),coalesce((select nullif(btrim(first_name||' '||last_name),'') from public.profiles where id=new.created_by),'Recorded site reviewer'),'pass','Device lifecycle review '||new.id::text||': '||new.evidence);
  end if;
  perform public.recalculate_inspection_item_compliance(new.inspection_item_id);
  return new;
end $$;
revoke all on function app_private.apply_device_lifecycle_review() from public,anon,authenticated;
create trigger apply_device_lifecycle_review after insert on public.facility_site_reviews for each row execute function app_private.apply_device_lifecycle_review();

