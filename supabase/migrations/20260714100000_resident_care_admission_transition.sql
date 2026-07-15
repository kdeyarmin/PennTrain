-- Resident care delivery, support-plan, DME, appointment, transfer, and transition foundation.
-- All workflows are authenticated staff workflows; no public resident/family/prospect portal artifacts are introduced.

create schema if not exists app_private;

create table public.resident_support_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  version_number integer not null,
  state text not null default 'draft' check (state in ('draft','in_review','approved','effective','superseded','archived')),
  effective_date date,
  review_due_date date,
  prior_plan_id uuid references public.resident_support_plans(id) on delete restrict,
  assessment_form_id uuid references public.resident_assessment_forms(id) on delete restrict,
  needs jsonb not null default '[]'::jsonb check (jsonb_typeof(needs) = 'array'),
  goals jsonb not null default '[]'::jsonb check (jsonb_typeof(goals) = 'array'),
  services jsonb not null default '[]'::jsonb check (jsonb_typeof(services) = 'array'),
  interventions jsonb not null default '[]'::jsonb check (jsonb_typeof(interventions) = 'array'),
  staff_instructions text,
  printable_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(printable_snapshot) = 'object'),
  staff_controlled_signature jsonb not null default '{}'::jsonb check (jsonb_typeof(staff_controlled_signature) = 'object'),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resident_id, version_number),
  check (review_due_date is null or effective_date is null or review_due_date >= effective_date),
  check (state not in ('approved','effective') or (approved_by is not null and approved_at is not null and effective_date is not null))
);
create index resident_support_plans_scope_idx on public.resident_support_plans(organization_id, facility_id, resident_id, state, effective_date desc);

create table public.support_plan_assessment_mapping_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  facility_id uuid references public.facilities(id) on delete cascade,
  rule_key text not null,
  version integer not null,
  is_active boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  assessment_item_key text not null,
  condition jsonb not null default '{}'::jsonb check (jsonb_typeof(condition) = 'object'),
  proposed_need jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed_need) = 'object'),
  proposed_service jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed_service) = 'object'),
  proposed_intervention jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed_intervention) = 'object'),
  proposed_dme jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed_dme) = 'object'),
  rationale text not null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, facility_id, rule_key, version),
  check (effective_to is null or effective_to >= effective_from)
);
create index support_plan_mapping_rules_effective_idx on public.support_plan_assessment_mapping_rules(organization_id, facility_id, is_active, effective_from, effective_to);

create table public.support_plan_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  assessment_form_id uuid references public.resident_assessment_forms(id) on delete restrict,
  current_plan_id uuid references public.resident_support_plans(id) on delete restrict,
  target_plan_id uuid references public.resident_support_plans(id) on delete set null,
  state text not null default 'proposed' check (state in ('proposed','accepted','modified','rejected','superseded')),
  proposal jsonb not null check (jsonb_typeof(proposal) = 'object'),
  conflict_warnings text[] not null default array[]::text[],
  rationale text,
  owner_profile_id uuid references public.profiles(id),
  due_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_reason text,
  work_item_id uuid references public.work_items(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, assessment_form_id, resident_id)
);
create index support_plan_proposals_queue_idx on public.support_plan_proposals(organization_id, facility_id, state, due_at);

create table public.resident_dme_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid references public.residents(id) on delete set null,
  equipment_type text not null check (equipment_type in ('walker','wheelchair','hospital_bed','oxygen_equipment','lift','specialty_mattress','shower_equipment','adaptive_device','other')),
  ownership text not null default 'facility' check (ownership in ('facility','resident','rented','vendor','other')),
  location text,
  vendor text,
  order_date date,
  delivery_date date,
  serial_asset_number text,
  condition text not null default 'serviceable' check (condition in ('new','serviceable','needs_cleaning','needs_repair','unsafe','retired')),
  inspection_frequency_days integer check (inspection_frequency_days between 1 and 1095),
  preventive_maintenance_required boolean not null default false,
  staff_instructions text,
  supporting_document_id uuid references public.resident_documents(id) on delete set null,
  replacement_due_date date,
  cleaning_required boolean not null default false,
  status text not null default 'ordered' check (status in ('ordered','in_use','needs_repair','returned','transferred','disposed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, serial_asset_number)
);
create index resident_dme_items_scope_idx on public.resident_dme_items(organization_id, facility_id, resident_id, status, replacement_due_date);

create table public.resident_dme_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  dme_item_id uuid not null references public.resident_dme_items(id) on delete restrict,
  resident_id uuid references public.residents(id) on delete set null,
  event_type text not null check (event_type in ('assigned','inspected','repair_requested','repaired','returned','transferred','disposed','cleaned','documented')),
  prior_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references public.profiles(id),
  note text,
  occurred_at timestamptz not null default now()
);
create index resident_dme_history_item_idx on public.resident_dme_history(dme_item_id, occurred_at desc);

create table public.resident_appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  appointment_type text not null,
  provider_name text,
  location text not null,
  starts_at timestamptz not null,
  expected_return_at timestamptz,
  transportation_provider text,
  vehicle_identifier text,
  driver_employee_id uuid references public.employees(id) on delete set null,
  escort_employee_id uuid references public.employees(id) on delete set null,
  pickup_at timestamptz,
  documents_required text[] not null default array[]::text[],
  equipment_required text[] not null default array[]::text[],
  preparation_checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(preparation_checklist) = 'array'),
  staff_notification_log jsonb not null default '[]'::jsonb check (jsonb_typeof(staff_notification_log) = 'array'),
  status text not null default 'scheduled' check (status in ('scheduled','attended','canceled','no_show','rescheduled','follow_up_required','closed')),
  outcome_summary text,
  uploaded_document_id uuid references public.resident_documents(id) on delete set null,
  new_order_ack_status text not null default 'not_applicable' check (new_order_ack_status in ('not_applicable','pending_review','acknowledged')),
  follow_up_due_at timestamptz,
  follow_up_work_item_id uuid references public.work_items(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expected_return_at is null or expected_return_at > starts_at)
);
create index resident_appointments_calendar_idx on public.resident_appointments(organization_id, facility_id, starts_at, status);
create index resident_appointments_driver_idx on public.resident_appointments(driver_employee_id, starts_at) where driver_employee_id is not null and status in ('scheduled','rescheduled');
create index resident_appointments_escort_idx on public.resident_appointments(escort_employee_id, starts_at) where escort_employee_id is not null and status in ('scheduled','rescheduled');

create table public.hospital_transfer_episodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  reason text not null,
  destination text not null,
  transfer_time timestamptz not null,
  transport_method text not null,
  ems_provider_info text,
  documents_sent text[] not null default array[]::text[],
  equipment_sent text[] not null default array[]::text[],
  notifications jsonb not null default '[]'::jsonb check (jsonb_typeof(notifications) = 'array'),
  belongings jsonb not null default '{}'::jsonb check (jsonb_typeof(belongings) = 'object'),
  expected_return_at timestamptz,
  bed_hold_status text not null default 'not_applicable' check (bed_hold_status in ('not_applicable','held','released','pending')),
  linked_incident_id uuid,
  linked_change_event_id uuid references public.resident_change_events(id) on delete set null,
  responsible_profile_id uuid references public.profiles(id),
  status text not null default 'out' check (status in ('out','returned','canceled')),
  return_time timestamptz,
  discharge_document_id uuid references public.resident_documents(id) on delete set null,
  changed_order_ack_status text not null default 'not_applicable' check (changed_order_ack_status in ('not_applicable','pending_review','acknowledged')),
  medication_reconciliation_status text not null default 'not_applicable' check (medication_reconciliation_status in ('not_applicable','pending','completed','authorized_exception')),
  condition_changes text,
  diet_changes text,
  mobility_changes text,
  skin_concerns text,
  dme_changes text,
  follow_up_appointment_id uuid references public.resident_appointments(id) on delete set null,
  assessment_review_required boolean not null default false,
  support_plan_review_required boolean not null default false,
  return_work_item_id uuid references public.work_items(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (return_time is null or return_time >= transfer_time)
);
create index hospital_transfer_episodes_scope_idx on public.hospital_transfer_episodes(organization_id, facility_id, resident_id, status, transfer_time desc);

create or replace function app_private.assert_resident_care_manager(p_org uuid, p_fac uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','') = 'service_role' or public.is_platform_admin() then return; end if;
  if auth.uid() is null or public.current_org_id() <> p_org or public.current_role() not in ('org_admin','facility_manager') or (public.current_role() = 'facility_manager' and not public.is_assigned_to_facility(p_fac)) then
    raise exception 'Resident care operation is outside caller scope' using errcode = '42501';
  end if;
end $$;

create or replace function app_private.prevent_resident_care_history_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Resident care evidence is append-only' using errcode = '55000';
end $$;

create or replace function app_private.prevent_effective_support_plan_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.state in ('effective','superseded','archived') and coalesce(current_setting('app.allow_support_plan_history_update', true), '') <> 'true' and row(old.*) is distinct from row(new.*) then
    raise exception 'Effective and historical support plans are immutable; create a new version' using errcode = '55000';
  end if;
  return new;
end $$;

create trigger resident_support_plans_prevent_history_mutation
before update on public.resident_support_plans
for each row execute function app_private.prevent_effective_support_plan_mutation();
create trigger resident_dme_history_append_only before update or delete on public.resident_dme_history for each row execute function app_private.prevent_resident_care_history_mutation();

do $$ begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at' and pg_function_is_visible(oid)) then
    create trigger set_resident_support_plans_updated_at before update on public.resident_support_plans for each row execute function public.set_updated_at();
    create trigger set_support_plan_proposals_updated_at before update on public.support_plan_proposals for each row execute function public.set_updated_at();
    create trigger set_resident_dme_items_updated_at before update on public.resident_dme_items for each row execute function public.set_updated_at();
    create trigger set_resident_appointments_updated_at before update on public.resident_appointments for each row execute function public.set_updated_at();
    create trigger set_hospital_transfer_episodes_updated_at before update on public.hospital_transfer_episodes for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace function public.create_support_plan_draft(p_resident_id uuid, p_assessment_form_id uuid default null, p_prior_plan_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_res public.residents%rowtype; v_prior public.resident_support_plans%rowtype; v_next integer; v_id uuid;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v_res.organization_id, v_res.facility_id);
  if p_prior_plan_id is not null then select * into v_prior from public.resident_support_plans where id = p_prior_plan_id and resident_id = p_resident_id; end if;
  select coalesce(max(version_number),0)+1 into v_next from public.resident_support_plans where resident_id = p_resident_id;
  insert into public.resident_support_plans(organization_id,facility_id,resident_id,version_number,prior_plan_id,assessment_form_id,needs,goals,services,interventions,staff_instructions,created_by)
  values(v_res.organization_id,v_res.facility_id,v_res.id,v_next,p_prior_plan_id,p_assessment_form_id,coalesce(v_prior.needs,'[]'::jsonb),coalesce(v_prior.goals,'[]'::jsonb),coalesce(v_prior.services,'[]'::jsonb),coalesce(v_prior.interventions,'[]'::jsonb),v_prior.staff_instructions,auth.uid())
  returning id into v_id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values) values(v_res.organization_id,auth.uid(),'resident_support_plan',v_id::text,'support_plan.draft_created',jsonb_build_object('residentId',v_res.id,'version',v_next));
  return v_id;
end $$;

create or replace function public.submit_support_plan_for_review(p_plan_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v public.resident_support_plans%rowtype;
begin
  select * into v from public.resident_support_plans where id = p_plan_id for update;
  if not found then raise exception 'Support plan not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.state <> 'draft' then raise exception 'Only draft plans can be submitted' using errcode='22023'; end if;
  update public.resident_support_plans set state='in_review', updated_at=now() where id=v.id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,old_values,new_values) values(v.organization_id,auth.uid(),'resident_support_plan',v.id::text,'support_plan.submitted',jsonb_build_object('state',v.state),jsonb_build_object('state','in_review'));
  return true;
end $$;

create or replace function public.approve_support_plan(p_plan_id uuid, p_effective_date date, p_review_due_date date, p_staff_signature jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare v public.resident_support_plans%rowtype; svc jsonb; v_req uuid;
begin
  select * into v from public.resident_support_plans where id=p_plan_id for update;
  if not found then raise exception 'Support plan not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.state not in ('in_review','approved') or p_effective_date is null or p_review_due_date < p_effective_date then raise exception 'Invalid support plan approval request' using errcode='22023'; end if;
  perform set_config('app.allow_support_plan_history_update','true',true);
  update public.resident_support_plans set state='superseded', updated_at=now() where resident_id=v.resident_id and state='effective' and id<>v.id;
  update public.resident_support_plans set state='effective', effective_date=p_effective_date, review_due_date=p_review_due_date, approved_by=auth.uid(), approved_at=now(), staff_controlled_signature=coalesce(p_staff_signature,'{}'::jsonb), printable_snapshot=jsonb_build_object('planId',v.id,'version',v.version_number,'effectiveDate',p_effective_date,'needs',v.needs,'goals',v.goals,'services',v.services,'interventions',v.interventions) where id=v.id;
  update public.resident_service_requirements set status='superseded', superseded_at=now(), updated_at=now() where resident_id=v.resident_id and status='active';
  for svc in select * from jsonb_array_elements(coalesce(v.services,'[]'::jsonb)) loop
    insert into public.resident_service_requirements(organization_id,facility_id,resident_id,source_assessment_form_id,source_plan_version,source_section,source_key,service_code,service_name,need_description,special_instructions,frequency,frequency_detail,time_window_start,time_window_end,responsible_role,requires_two_staff,documentation_mode,effective_from)
    values(v.organization_id,v.facility_id,v.resident_id,coalesce(v.assessment_form_id, (select id from public.resident_assessment_forms where resident_id=v.resident_id order by created_at desc limit 1)),v.version_number,'support_plan_services',(v.id::text || ':' || coalesce(svc->>'key',svc->>'service_code',extensions.gen_random_uuid()::text)),coalesce(svc->>'service_code','support_plan_service'),coalesce(svc->>'service_name',svc->>'name','Support-plan service'),svc->>'need',coalesce(svc->>'staff_instructions',v.staff_instructions,''),coalesce(nullif(svc->>'frequency',''),'daily'),svc->>'frequency_detail',coalesce((svc->>'time_window_start')::time,'09:00'::time),coalesce((svc->>'time_window_end')::time,'11:00'::time),coalesce(svc->>'responsible_role','employee'),coalesce((svc->>'requires_two_staff')::boolean,false),coalesce(svc->>'documentation_mode','every_task'),p_effective_date)
    returning id into v_req;
  end loop;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values) values(v.organization_id,auth.uid(),'resident_support_plan',v.id::text,'support_plan.effective',jsonb_build_object('effectiveDate',p_effective_date,'reviewDueDate',p_review_due_date));
  return true;
end $$;

create or replace function public.generate_support_plan_proposal(p_assessment_form_id uuid, p_reason text default 'Assessment change requires support-plan review')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_assess public.resident_assessment_forms%rowtype; v_res public.residents%rowtype; v_current uuid; v_id uuid; v_work uuid; v_payload jsonb;
begin
  select * into v_assess from public.resident_assessment_forms where id=p_assessment_form_id;
  if not found then raise exception 'Assessment not found' using errcode='P0002'; end if;
  select * into v_res from public.residents where id=v_assess.resident_id;
  perform app_private.assert_resident_care_manager(v_res.organization_id, v_res.facility_id);
  select id into v_current from public.resident_support_plans where resident_id=v_res.id and state='effective' order by effective_date desc limit 1;
  select jsonb_build_object('source','assessment_mapping_rules','assessmentFormId',v_assess.id,'proposedNeeds',coalesce(jsonb_agg(r.proposed_need) filter (where r.id is not null),'[]'::jsonb),'proposedServices',coalesce(jsonb_agg(r.proposed_service) filter (where r.id is not null),'[]'::jsonb),'proposedInterventions',coalesce(jsonb_agg(r.proposed_intervention) filter (where r.id is not null),'[]'::jsonb),'proposedDme',coalesce(jsonb_agg(r.proposed_dme) filter (where r.id is not null),'[]'::jsonb))
  into v_payload
  from public.support_plan_assessment_mapping_rules r
  where r.is_active and (r.organization_id is null or r.organization_id=v_res.organization_id) and (r.facility_id is null or r.facility_id=v_res.facility_id) and current_date between r.effective_from and coalesce(r.effective_to,current_date);
  insert into public.support_plan_proposals(organization_id,facility_id,resident_id,assessment_form_id,current_plan_id,proposal,conflict_warnings,rationale,owner_profile_id,due_at)
  values(v_res.organization_id,v_res.facility_id,v_res.id,v_assess.id,v_current,coalesce(v_payload,'{}'::jsonb),case when v_current is null then array['No current effective support plan was found.']::text[] else array[]::text[] end,btrim(coalesce(p_reason,'')),auth.uid(),now()+interval '3 days')
  on conflict (organization_id, assessment_form_id, resident_id) do update set proposal=excluded.proposal, conflict_warnings=excluded.conflict_warnings, rationale=excluded.rationale, updated_at=now()
  returning id into v_id;
  insert into public.work_items(organization_id,facility_id,source_type,source_id,deduplication_key,title,description,owner_profile_id,priority,due_at,state,created_by)
  values(v_res.organization_id,v_res.facility_id,'rule_exception',v_id,'support-plan-proposal:'||v_id,'Review support-plan proposal','Assessment information suggests the support plan may need human review.',auth.uid(),'high',now()+interval '3 days','open',auth.uid())
  on conflict (organization_id,deduplication_key) do update set updated_at=now()
  returning id into v_work;
  update public.support_plan_proposals set work_item_id=v_work where id=v_id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values) values(v_res.organization_id,auth.uid(),'support_plan_proposal',v_id::text,'support_plan.proposal_generated',jsonb_build_object('assessmentFormId',v_assess.id,'workItemId',v_work));
  return v_id;
end $$;

create or replace function public.review_support_plan_proposal(p_proposal_id uuid, p_decision text, p_rationale text, p_modified_proposal jsonb default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v public.support_plan_proposals%rowtype;
begin
  select * into v from public.support_plan_proposals where id=p_proposal_id for update;
  if not found then raise exception 'Proposal not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if p_decision not in ('accepted','modified','rejected') or length(btrim(coalesce(p_rationale,''))) < 5 then raise exception 'Proposal review requires a decision and rationale' using errcode='22023'; end if;
  update public.support_plan_proposals set state=p_decision, proposal=coalesce(p_modified_proposal, proposal), reviewed_by=auth.uid(), reviewed_at=now(), review_reason=btrim(p_rationale), updated_at=now() where id=v.id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,old_values,new_values) values(v.organization_id,auth.uid(),'support_plan_proposal',v.id::text,'support_plan.proposal_reviewed',jsonb_build_object('state',v.state),jsonb_build_object('state',p_decision,'reason',btrim(p_rationale)));
  return true;
end $$;

create or replace function public.record_service_exception_follow_up(p_task_instance_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.resident_service_task_instances%rowtype; v_work uuid;
begin
  select * into v from public.resident_service_task_instances where id=p_task_instance_id for update;
  if not found then raise exception 'Service task not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status not in ('resident_refused','resident_unavailable','not_completed','completed_late') then raise exception 'Task is not an exception' using errcode='22023'; end if;
  insert into public.work_items(organization_id,facility_id,source_type,source_id,deduplication_key,title,description,priority,due_at,state,created_by)
  values(v.organization_id,v.facility_id,'rule_exception',v.id,'service-exception:'||v.id,'Review resident service exception',left(coalesce(p_reason,v.note,'Service exception needs supervisor review'),1000),'normal',now()+interval '1 day','open',auth.uid())
  on conflict (organization_id,deduplication_key) do update set updated_at=now()
  returning id into v_work;
  update public.resident_service_task_instances set supervisor_notified=true, supervisor_notified_at=now(), updated_at=now() where id=v.id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values) values(v.organization_id,auth.uid(),'resident_service_task_instance',v.id::text,'service_exception.follow_up_created',jsonb_build_object('workItemId',v_work));
  return v_work;
end $$;

create or replace function public.register_resident_dme_item(
  p_facility_id uuid,
  p_resident_id uuid,
  p_equipment_type text,
  p_ownership text default 'facility',
  p_location text default null,
  p_vendor text default null,
  p_serial_asset_number text default null,
  p_staff_instructions text default null,
  p_inspection_frequency_days integer default null,
  p_preventive_maintenance_required boolean default false,
  p_replacement_due_date date default null,
  p_cleaning_required boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_fac public.facilities%rowtype; v_id uuid;
begin
  select * into v_fac from public.facilities where id=p_facility_id;
  if not found then raise exception 'Facility not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v_fac.organization_id, v_fac.id);
  if p_resident_id is not null and not exists (select 1 from public.residents r where r.id=p_resident_id and r.facility_id=v_fac.id and r.organization_id=v_fac.organization_id) then raise exception 'Resident is outside facility scope' using errcode='42501'; end if;
  insert into public.resident_dme_items(organization_id,facility_id,resident_id,equipment_type,ownership,location,vendor,serial_asset_number,staff_instructions,inspection_frequency_days,preventive_maintenance_required,replacement_due_date,cleaning_required,status,condition,created_by)
  values(v_fac.organization_id,v_fac.id,p_resident_id,p_equipment_type,coalesce(p_ownership,'facility'),p_location,p_vendor,p_serial_asset_number,p_staff_instructions,p_inspection_frequency_days,coalesce(p_preventive_maintenance_required,false),p_replacement_due_date,coalesce(p_cleaning_required,false),case when p_resident_id is null then 'ordered' else 'in_use' end,'serviceable',auth.uid()) returning id into v_id;
  insert into public.resident_dme_history(organization_id,facility_id,dme_item_id,resident_id,event_type,new_state,actor_profile_id,note) values(v_fac.organization_id,v_fac.id,v_id,p_resident_id,case when p_resident_id is null then 'documented' else 'assigned' end,jsonb_build_object('equipmentType',p_equipment_type,'residentId',p_resident_id,'status',case when p_resident_id is null then 'ordered' else 'in_use' end),auth.uid(),'DME registry item created');
  return v_id;
end $$;

create or replace function public.record_resident_dme_event(p_dme_item_id uuid, p_event_type text, p_note text default null, p_new_resident_id uuid default null, p_new_status text default null, p_new_condition text default null, p_location text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v public.resident_dme_items%rowtype; v_prior jsonb;
begin
  select * into v from public.resident_dme_items where id=p_dme_item_id for update;
  if not found then raise exception 'DME item not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if p_new_resident_id is not null and not exists (select 1 from public.residents r where r.id=p_new_resident_id and r.organization_id=v.organization_id and r.facility_id=v.facility_id) then raise exception 'New resident is outside facility scope' using errcode='42501'; end if;
  v_prior := to_jsonb(v);
  update public.resident_dme_items set resident_id=coalesce(p_new_resident_id,resident_id), status=coalesce(p_new_status,status), condition=coalesce(p_new_condition,condition), location=coalesce(p_location,location), updated_at=now() where id=v.id;
  insert into public.resident_dme_history(organization_id,facility_id,dme_item_id,resident_id,event_type,prior_state,new_state,actor_profile_id,note) values(v.organization_id,v.facility_id,v.id,coalesce(p_new_resident_id,v.resident_id),p_event_type,v_prior,(select to_jsonb(n) from public.resident_dme_items n where n.id=v.id),auth.uid(),p_note);
  return true;
end $$;

create or replace function public.schedule_resident_appointment(p_resident_id uuid, p_appointment_type text, p_location text, p_starts_at timestamptz, p_expected_return_at timestamptz default null, p_provider_name text default null, p_transportation_provider text default null, p_vehicle_identifier text default null, p_driver_employee_id uuid default null, p_escort_employee_id uuid default null, p_pickup_at timestamptz default null, p_documents_required text[] default array[]::text[], p_equipment_required text[] default array[]::text[], p_preparation_checklist jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_res public.residents%rowtype; v_id uuid;
begin
  select * into v_res from public.residents where id=p_resident_id;
  if not found then raise exception 'Resident not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v_res.organization_id, v_res.facility_id);
  if p_starts_at <= now() - interval '1 day' then raise exception 'Appointment time is invalid' using errcode='22023'; end if;
  if p_driver_employee_id is not null and exists (select 1 from public.resident_appointments a where a.driver_employee_id=p_driver_employee_id and a.status in ('scheduled','rescheduled') and tstzrange(a.pickup_at, coalesce(a.expected_return_at,a.starts_at + interval '2 hours'),'[)') && tstzrange(coalesce(p_pickup_at,p_starts_at), coalesce(p_expected_return_at,p_starts_at + interval '2 hours'),'[)')) then raise exception 'Driver has a transportation conflict' using errcode='23P01'; end if;
  if p_escort_employee_id is not null and exists (select 1 from public.resident_appointments a where a.escort_employee_id=p_escort_employee_id and a.status in ('scheduled','rescheduled') and tstzrange(a.pickup_at, coalesce(a.expected_return_at,a.starts_at + interval '2 hours'),'[)') && tstzrange(coalesce(p_pickup_at,p_starts_at), coalesce(p_expected_return_at,p_starts_at + interval '2 hours'),'[)')) then raise exception 'Escort has a transportation conflict' using errcode='23P01'; end if;
  insert into public.resident_appointments(organization_id,facility_id,resident_id,appointment_type,provider_name,location,starts_at,expected_return_at,transportation_provider,vehicle_identifier,driver_employee_id,escort_employee_id,pickup_at,documents_required,equipment_required,preparation_checklist,created_by)
  values(v_res.organization_id,v_res.facility_id,v_res.id,btrim(p_appointment_type),p_provider_name,btrim(p_location),p_starts_at,p_expected_return_at,p_transportation_provider,p_vehicle_identifier,p_driver_employee_id,p_escort_employee_id,p_pickup_at,coalesce(p_documents_required,array[]::text[]),coalesce(p_equipment_required,array[]::text[]),coalesce(p_preparation_checklist,'[]'::jsonb),auth.uid()) returning id into v_id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values) values(v_res.organization_id,auth.uid(),'resident_appointment',v_id::text,'appointment.scheduled',jsonb_build_object('residentId',v_res.id,'startsAt',p_starts_at));
  return v_id;
end $$;

create or replace function public.record_appointment_outcome(p_appointment_id uuid, p_status text, p_outcome_summary text default null, p_follow_up_due_at timestamptz default null, p_new_order_ack_status text default 'not_applicable', p_uploaded_document_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.resident_appointments%rowtype; v_work uuid;
begin
  select * into v from public.resident_appointments where id=p_appointment_id for update;
  if not found then raise exception 'Appointment not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if p_status not in ('attended','canceled','no_show','rescheduled','follow_up_required','closed') then raise exception 'Invalid appointment outcome' using errcode='22023'; end if;
  update public.resident_appointments set status=p_status, outcome_summary=p_outcome_summary, follow_up_due_at=p_follow_up_due_at, new_order_ack_status=coalesce(p_new_order_ack_status,'not_applicable'), uploaded_document_id=p_uploaded_document_id, updated_at=now() where id=v.id;
  if p_status in ('no_show','follow_up_required') or p_follow_up_due_at is not null or p_new_order_ack_status='pending_review' then
    insert into public.work_items(organization_id,facility_id,source_type,source_id,deduplication_key,title,description,priority,due_at,state,created_by)
    values(v.organization_id,v.facility_id,'rule_exception',v.id,'appointment-follow-up:'||v.id,'Complete appointment follow-up',left(coalesce(p_outcome_summary,'Appointment outcome requires staff follow-up'),1000),'normal',coalesce(p_follow_up_due_at,now()+interval '1 day'),'open',auth.uid())
    on conflict (organization_id,deduplication_key) do update set updated_at=now()
    returning id into v_work;
    update public.resident_appointments set follow_up_work_item_id=v_work where id=v.id;
  end if;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,old_values,new_values) values(v.organization_id,auth.uid(),'resident_appointment',v.id::text,'appointment.outcome_recorded',jsonb_build_object('status',v.status),jsonb_build_object('status',p_status,'workItemId',v_work));
  return v_work;
end $$;

create or replace function public.start_hospital_transfer(p_resident_id uuid, p_reason text, p_destination text, p_transfer_time timestamptz, p_transport_method text, p_expected_return_at timestamptz default null, p_linked_change_event_id uuid default null, p_documents_sent text[] default array[]::text[], p_equipment_sent text[] default array[]::text[], p_notifications jsonb default '[]'::jsonb, p_belongings jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_res public.residents%rowtype; v_id uuid;
begin
  select * into v_res from public.residents where id=p_resident_id;
  if not found then raise exception 'Resident not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v_res.organization_id, v_res.facility_id);
  if exists (select 1 from public.hospital_transfer_episodes h where h.resident_id=v_res.id and h.status='out') then raise exception 'Resident already has an open transfer episode' using errcode='23505'; end if;
  insert into public.hospital_transfer_episodes(organization_id,facility_id,resident_id,reason,destination,transfer_time,transport_method,expected_return_at,linked_change_event_id,documents_sent,equipment_sent,notifications,belongings,responsible_profile_id,created_by)
  values(v_res.organization_id,v_res.facility_id,v_res.id,btrim(p_reason),btrim(p_destination),p_transfer_time,btrim(p_transport_method),p_expected_return_at,p_linked_change_event_id,coalesce(p_documents_sent,array[]::text[]),coalesce(p_equipment_sent,array[]::text[]),coalesce(p_notifications,'[]'::jsonb),coalesce(p_belongings,'{}'::jsonb),auth.uid(),auth.uid()) returning id into v_id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values) values(v_res.organization_id,auth.uid(),'hospital_transfer_episode',v_id::text,'hospital_transfer.started',jsonb_build_object('residentId',v_res.id,'destination',p_destination));
  return v_id;
end $$;

create or replace function public.complete_hospital_return(p_episode_id uuid, p_return_time timestamptz, p_discharge_document_id uuid default null, p_changed_order_ack_status text default 'pending_review', p_medication_reconciliation_status text default 'pending', p_condition_changes text default null, p_diet_changes text default null, p_mobility_changes text default null, p_skin_concerns text default null, p_dme_changes text default null, p_assessment_review_required boolean default true, p_support_plan_review_required boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.hospital_transfer_episodes%rowtype; v_work uuid;
begin
  select * into v from public.hospital_transfer_episodes where id=p_episode_id for update;
  if not found then raise exception 'Transfer episode not found' using errcode='P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);
  if v.status <> 'out' or p_return_time < v.transfer_time then raise exception 'Invalid hospital return request' using errcode='22023'; end if;
  insert into public.work_items(organization_id,facility_id,source_type,source_id,deduplication_key,title,description,priority,due_at,state,created_by)
  values(v.organization_id,v.facility_id,'rule_exception',v.id,'hospital-return-follow-up:'||v.id,'Complete hospital-return follow-up','Review discharge documents, order acknowledgement status, assessment/support-plan needs, services, DME, and staff notifications.','high',now()+interval '24 hours','open',auth.uid())
  on conflict (organization_id,deduplication_key) do update set updated_at=now()
  returning id into v_work;
  update public.hospital_transfer_episodes set status='returned', return_time=p_return_time, discharge_document_id=p_discharge_document_id, changed_order_ack_status=p_changed_order_ack_status, medication_reconciliation_status=p_medication_reconciliation_status, condition_changes=p_condition_changes, diet_changes=p_diet_changes, mobility_changes=p_mobility_changes, skin_concerns=p_skin_concerns, dme_changes=p_dme_changes, assessment_review_required=p_assessment_review_required, support_plan_review_required=p_support_plan_review_required, return_work_item_id=v_work, updated_at=now() where id=v.id;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='shift_report_entries') then
    insert into public.shift_report_entries(organization_id,facility_id,resident_id,category,priority,shift_period_start,shift_period_end,narrative,author_profile_id,follow_up_owner_profile_id,requires_acknowledgement,linked_work_item_id,idempotency_key)
    values(v.organization_id,v.facility_id,v.resident_id,'hospital_transfer_return','high',p_return_time,p_return_time + interval '8 hours','Resident returned from hospital; complete discharge follow-up before closing.',auth.uid(),auth.uid(),true,v_work,'hospital-return:'||v.id);
  end if;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values) values(v.organization_id,auth.uid(),'hospital_transfer_episode',v.id::text,'hospital_transfer.return_completed',jsonb_build_object('returnTime',p_return_time,'workItemId',v_work));
  return v_work;
end $$;

create or replace function public.get_resident_care_delivery_analytics(p_facility_id uuid, p_from date, p_through date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_fac public.facilities%rowtype;
begin
  select * into v_fac from public.facilities where id=p_facility_id;
  if not found then raise exception 'Facility not found' using errcode='P0002'; end if;
  if not (coalesce(auth.jwt()->>'role','')='service_role' or public.is_platform_admin() or (public.current_org_id()=v_fac.organization_id and (public.current_role() in ('org_admin','auditor') or public.is_assigned_to_facility(v_fac.id)))) then raise exception 'Analytics outside caller scope' using errcode='42501'; end if;
  return jsonb_build_object(
    'scope', jsonb_build_object('organizationId',v_fac.organization_id,'facilityId',v_fac.id,'from',p_from,'through',p_through,'dateBasis','scheduled_start / event timestamps'),
    'serviceCompletion', jsonb_build_object('numerator',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status in ('completed','completed_late','completed_by_other')),'denominator',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status <> 'superseded'),'definition','Completed service tasks divided by non-superseded scheduled service tasks.'),
    'serviceExceptions', jsonb_build_object('count',(select count(*) from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status in ('resident_refused','resident_unavailable','not_completed','completed_late')),'definition','Service tasks recorded with exception statuses.'),
    'repeatedRefusals', jsonb_build_object('count',(select count(*) from (select resident_id, service_name from public.resident_service_task_instances t where t.facility_id=v_fac.id and t.scheduled_start::date between p_from and p_through and t.status='resident_refused' group by resident_id, service_name having count(*) >= 2) s),'definition','Resident/service pairs with two or more refusals in the reporting period.'),
    'changeOfConditionFrequency', jsonb_build_object('count',(select count(*) from public.resident_change_events c where c.facility_id=v_fac.id and c.first_observed_at::date between p_from and p_through),'definition','Change-of-condition events first observed in the period.'),
    'planReviewTimeliness', jsonb_build_object('overdue',(select count(*) from public.resident_support_plans p where p.facility_id=v_fac.id and p.state='effective' and p.review_due_date < current_date),'definition','Effective support plans with review due dates before today.'),
    'dmeInspectionStatus', jsonb_build_object('due',(select count(*) from public.resident_dme_items d where d.facility_id=v_fac.id and d.status in ('in_use','needs_repair') and d.inspection_frequency_days is not null and not exists (select 1 from public.resident_dme_history h where h.dme_item_id=d.id and h.event_type='inspected' and h.occurred_at >= now() - (d.inspection_frequency_days || ' days')::interval)),'definition','In-use DME items without an inspection recorded inside their configured frequency window.'),
    'hospitalReturnsOpenFollowUp', jsonb_build_object('count',(select count(*) from public.hospital_transfer_episodes h left join public.work_items w on w.id=h.return_work_item_id where h.facility_id=v_fac.id and h.return_time::date between p_from and p_through and h.status='returned' and coalesce(w.state,'open') <> 'closed'),'definition','Returned transfer episodes whose generated follow-up work is not closed.')
  );
end $$;

alter table public.resident_support_plans enable row level security;
alter table public.support_plan_assessment_mapping_rules enable row level security;
alter table public.support_plan_proposals enable row level security;
alter table public.resident_dme_items enable row level security;
alter table public.resident_dme_history enable row level security;
alter table public.resident_appointments enable row level security;
alter table public.hospital_transfer_episodes enable row level security;

create policy resident_support_plans_select on public.resident_support_plans for select to authenticated using (public.is_platform_admin() or organization_id=(select public.current_org_id()) and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)));
create policy support_plan_rules_select on public.support_plan_assessment_mapping_rules for select to authenticated using (organization_id is null or public.is_platform_admin() or organization_id=(select public.current_org_id()) and (facility_id is null or public.is_assigned_to_facility(facility_id) or (select public.current_role()) in ('org_admin','auditor')));
create policy support_plan_proposals_select on public.support_plan_proposals for select to authenticated using (public.is_platform_admin() or organization_id=(select public.current_org_id()) and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)));
create policy resident_dme_items_select on public.resident_dme_items for select to authenticated using (public.is_platform_admin() or organization_id=(select public.current_org_id()) and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)));
create policy resident_dme_history_select on public.resident_dme_history for select to authenticated using (public.is_platform_admin() or organization_id=(select public.current_org_id()) and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)));
create policy resident_appointments_select on public.resident_appointments for select to authenticated using (public.is_platform_admin() or organization_id=(select public.current_org_id()) and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)));
create policy hospital_transfer_episodes_select on public.hospital_transfer_episodes for select to authenticated using (public.is_platform_admin() or organization_id=(select public.current_org_id()) and ((select public.current_role()) in ('org_admin','auditor') or public.is_assigned_to_facility(facility_id)));

revoke all on public.resident_support_plans, public.support_plan_assessment_mapping_rules, public.support_plan_proposals, public.resident_dme_items, public.resident_dme_history, public.resident_appointments, public.hospital_transfer_episodes from public, anon, authenticated, service_role;
grant all on public.resident_support_plans, public.support_plan_assessment_mapping_rules, public.support_plan_proposals, public.resident_dme_items, public.resident_dme_history, public.resident_appointments, public.hospital_transfer_episodes to service_role;
grant select on public.resident_support_plans, public.support_plan_assessment_mapping_rules, public.support_plan_proposals, public.resident_dme_items, public.resident_dme_history, public.resident_appointments, public.hospital_transfer_episodes to authenticated;

revoke all on function app_private.assert_resident_care_manager(uuid,uuid), app_private.prevent_resident_care_history_mutation(), app_private.prevent_effective_support_plan_mutation() from public, anon, authenticated, service_role;
revoke all on function public.create_support_plan_draft(uuid,uuid,uuid), public.submit_support_plan_for_review(uuid), public.approve_support_plan(uuid,date,date,jsonb), public.generate_support_plan_proposal(uuid,text), public.review_support_plan_proposal(uuid,text,text,jsonb), public.record_service_exception_follow_up(uuid,text), public.register_resident_dme_item(uuid,uuid,text,text,text,text,text,text,integer,boolean,date,boolean), public.record_resident_dme_event(uuid,text,text,uuid,text,text,text), public.schedule_resident_appointment(uuid,text,text,timestamptz,timestamptz,text,text,text,uuid,uuid,timestamptz,text[],text[],jsonb), public.record_appointment_outcome(uuid,text,text,timestamptz,text,uuid), public.start_hospital_transfer(uuid,text,text,timestamptz,text,timestamptz,uuid,text[],text[],jsonb,jsonb), public.complete_hospital_return(uuid,timestamptz,uuid,text,text,text,text,text,text,text,boolean,boolean), public.get_resident_care_delivery_analytics(uuid,date,date) from public, anon, authenticated, service_role;
grant execute on function public.create_support_plan_draft(uuid,uuid,uuid), public.submit_support_plan_for_review(uuid), public.approve_support_plan(uuid,date,date,jsonb), public.generate_support_plan_proposal(uuid,text), public.review_support_plan_proposal(uuid,text,text,jsonb), public.record_service_exception_follow_up(uuid,text), public.register_resident_dme_item(uuid,uuid,text,text,text,text,text,text,integer,boolean,date,boolean), public.record_resident_dme_event(uuid,text,text,uuid,text,text,text), public.schedule_resident_appointment(uuid,text,text,timestamptz,timestamptz,text,text,text,uuid,uuid,timestamptz,text[],text[],jsonb), public.record_appointment_outcome(uuid,text,text,timestamptz,text,uuid), public.start_hospital_transfer(uuid,text,text,timestamptz,text,timestamptz,uuid,text[],text[],jsonb,jsonb), public.complete_hospital_return(uuid,timestamptz,uuid,text,text,text,text,text,text,text,boolean,boolean), public.get_resident_care_delivery_analytics(uuid,date,date) to authenticated;
