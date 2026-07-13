-- Priorities 7-17: resident-rights operations, service workload, work orders,
-- emergency events, resident administrative record, external signatures,
-- dietary operations, resident-services calendar, resident billing/funds,
-- citation-backed copilot logs, and scheduled report delivery foundations.
-- These tables intentionally link to incidents, QAPI, work items, documents, and
-- evidence workflows instead of rebuilding those mature modules.

insert into public.work_item_templates(template_key,name,source_type,default_priority,due_interval,approval_required,escalation_after,default_owner_role) values
 ('complaint.investigation','Complaint investigation','complaint','high',interval '7 days',true,interval '1 day','facility_manager'),
 ('work_order.repair','Environmental work order','work_order','medium',interval '3 days',false,interval '1 day','facility_manager'),
 ('dietary.exception','Dietary or food-safety exception','dietary','medium',interval '2 days',false,interval '1 day','facility_manager'),
 ('resident_service.followup','Resident service follow-up','resident_service','medium',interval '3 days',false,interval '1 day','facility_manager')
on conflict(organization_id,template_key) do nothing;

create table public.complaints (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict, complaint_number text not null,
 date_received date not null default current_date, method_received text not null,
 complainant_name text, complainant_type text not null check(complainant_type in('resident','designated_person','family','anonymous','staff_on_behalf','billing','food','staff_conduct','service','privacy','resident_rights','environmental','other')),
 is_anonymous boolean not null default false, resident_id uuid references public.residents(id) on delete restrict,
 category text not null, immediate_risk text not null default 'none' check(immediate_risk in('none','low','moderate','high','imminent')),
 acknowledgement_date date, assigned_investigator_profile_id uuid references public.profiles(id), investigation_notes text,
 interviews jsonb not null default '[]', findings text, corrective_action text, written_response text,
 appeal_or_reconsideration text, ombudsman_referral jsonb not null default '{}', nonretaliation_monitoring jsonb not null default '{}',
 closure_approved_by uuid references public.profiles(id), closure_approved_at timestamptz,
 linked_incident_id uuid references public.incidents(id) on delete restrict, qapi_project_id uuid references public.qapi_projects(id) on delete set null,
 reportable_event_suspected boolean not null default false, status text not null default 'open' check(status in('open','acknowledged','investigating','pending_response','pending_closure','closed','withdrawn')),
 created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,complaint_number), check(not is_anonymous or complainant_name is null), check(status<>'closed' or closure_approved_at is not null)
);
create index complaints_queue_idx on public.complaints(organization_id,facility_id,status,date_received);
create trigger set_updated_at before update on public.complaints for each row execute function public.set_updated_at();

create table public.complaint_history(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id), complaint_id uuid not null references public.complaints(id) on delete restrict,
 event_type text not null, prior_status text, resulting_status text, actor_profile_id uuid references public.profiles(id), reason text not null,
 evidence jsonb not null default '{}', occurred_at timestamptz not null default now()
);

create table public.scheduling_eligibility_decisions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict, schedule_id uuid references public.schedules(id) on delete cascade,
 shift_assignment_id uuid references public.shift_assignments(id) on delete set null, employee_id uuid not null references public.employees(id) on delete restrict,
 unit_id uuid references public.facility_units(id), shift_date date not null, start_time time not null, end_time time not null,
 decision text not null check(decision in('eligible','eligible_with_warning','blocked')), hard_block boolean not null default false,
 explanation jsonb not null default '[]', override_id uuid, evaluated_by uuid references public.profiles(id), evaluated_at timestamptz not null default now()
);
create index scheduling_eligibility_decisions_lookup_idx on public.scheduling_eligibility_decisions(employee_id,shift_date,evaluated_at desc);

create table public.scheduling_eligibility_overrides(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict, employee_id uuid not null references public.employees(id) on delete restrict,
 reason text not null, authority text not null, scope jsonb not null, expires_at timestamptz not null, approver_profile_id uuid not null references public.profiles(id),
 audit_record jsonb not null default '{}', created_at timestamptz not null default now(), revoked_at timestamptz
);

create table public.service_workload_requirements(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict, unit_id uuid references public.facility_units(id), shift_definition_id uuid references public.shift_definitions(id),
 effective_date date not null, active_resident_count integer not null default 0, support_plan_service_minutes integer not null default 0,
 two_person_transfer_count integer not null default 0, escort_requirement_count integer not null default 0, safety_check_frequency_minutes integer,
 medication_qualified_staff_required integer not null default 0, secured_unit_coverage_required boolean not null default false,
 appointment_transportation_demand jsonb not null default '{}', required_first_aid_cpr_coverage integer not null default 0,
 required_trainer_supervisor_coverage integer not null default 0, calculated_staffing_need numeric not null default 0,
 notes text, created_at timestamptz not null default now(), unique(facility_id,unit_id,shift_definition_id,effective_date)
);

create table public.environmental_work_orders(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict, work_order_number text not null,
 inspection_event_id uuid references public.inspection_events(id) on delete set null, location_detail text, room text, asset_id uuid,
 qr_code_payload text, problem_description text not null, photograph_urls jsonb not null default '[]', safety_risk text not null default 'none',
 priority text not null default 'routine' check(priority in('routine','urgent','emergency')), temporary_protective_action text,
 assigned_maintenance_employee_id uuid references public.employees(id), external_vendor text, target_completion timestamptz,
 parts_needed text, cost numeric(12,2), downtime interval, repair_notes text, before_photo_urls jsonb not null default '[]', after_photo_urls jsonb not null default '[]',
 supervisor_verified_by uuid references public.profiles(id), supervisor_verified_at timestamptz, resident_impact text,
 preventive_maintenance_schedule jsonb not null default '{}', warranty_service_contract_document_ids uuid[] not null default '{}',
 status text not null default 'open' check(status in('open','assigned','in_progress','repair_complete_pending_verification','verified','closed','canceled')),
 created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,work_order_number)
);
create trigger set_updated_at before update on public.environmental_work_orders for each row execute function public.set_updated_at();

create table public.emergency_plans(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict, version_label text not null, effective_date date not null,
 plan_document_id uuid, relocation_sites jsonb not null default '[]', transportation_vendors jsonb not null default '[]', utility_contacts jsonb not null default '[]',
 emar_vendor_contact jsonb not null default '{}', emergency_food_water_inventory jsonb not null default '{}', generator_fuel_status jsonb not null default '{}',
 approved_by uuid references public.profiles(id), approved_at timestamptz, superseded_by uuid references public.emergency_plans(id), created_at timestamptz not null default now(), unique(facility_id,version_label)
);

create table public.emergency_events(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict, plan_id uuid references public.emergency_plans(id) on delete restrict,
 event_type text not null check(event_type in('drill','actual_event','extended_outage')), started_at timestamptz not null, ended_at timestamptz,
 staff_assignments jsonb not null default '[]', evacuation_roster jsonb not null default '[]', resident_accountability jsonb not null default '[]', staff_accountability jsonb not null default '[]',
 family_designated_person_notifications jsonb not null default '[]', communication_log jsonb not null default '[]', event_timeline jsonb not null default '[]',
 after_action_review text, corrective_action_plan text, status text not null default 'active' check(status in('active','after_action','closed')),
 created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create table public.resident_administrative_profiles(
 resident_id uuid primary key references public.residents(id) on delete cascade, organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict, preferred_name text, photograph_url text, date_of_birth date, prior_address jsonb,
 emergency_contacts jsonb not null default '[]', designated_person jsonb, guardian jsonb, power_of_attorney jsonb, court_orders jsonb not null default '[]',
 primary_care_provider jsonb, dentist jsonb, pharmacy jsonb, case_manager jsonb, hospice_home_health_agency jsonb, insurance_payer_information jsonb not null default '[]',
 dietary_requirements text, food_allergies text, mobility_summary text, supervision_requirements text, communication_preferences text, language text,
 religious_cultural_preferences text, property_inventory jsonb not null default '[]', advance_directive_document_ids uuid[] not null default '{}',
 resident_rights_acknowledgement jsonb, contract_status text, transition_history jsonb not null default '[]', updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.resident_administrative_profiles for each row execute function public.set_updated_at();

create table public.resident_signature_records(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict, resident_id uuid not null references public.residents(id) on delete restrict,
 document_type text not null, document_version text not null, signer_name text not null, signer_relationship text not null, legal_authority text,
 signed_at timestamptz, authentication_method text, ip_device_evidence jsonb not null default '{}', witness_profile_id uuid references public.profiles(id),
 refused_to_sign boolean not null default false, unable_to_sign boolean not null default false, reason text, copy_delivery_date date, amendment_history jsonb not null default '[]',
 guest_grant_id uuid references public.move_in_guest_grants(id) on delete set null, created_at timestamptz not null default now(),
 check(signed_at is not null or refused_to_sign or unable_to_sign)
);

create table public.dietary_operations(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict, resident_id uuid references public.residents(id) on delete restrict,
 record_type text not null check(record_type in('resident_diet','menu_cycle','meal_attendance','meal_refusal','intake_exception','hydration_round','weight_monitoring','nutrition_risk_review','referral_followup','food_safety_check')),
 occurred_at timestamptz not null default now(), details jsonb not null default '{}', exception_repetition_key text, work_item_id uuid references public.work_items(id) on delete set null,
 qapi_project_id uuid references public.qapi_projects(id) on delete set null, created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create index dietary_operations_queue_idx on public.dietary_operations(facility_id,record_type,occurred_at desc);

create table public.resident_service_events(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict, resident_id uuid references public.residents(id) on delete restrict,
 event_type text not null check(event_type in('medical_appointment','dental_appointment','behavioral_health','laboratory','therapy','community_service','family_visit','transportation','facility_activity','outside_activity')),
 provider text, starts_at timestamptz not null, ends_at timestamptz, transportation jsonb not null default '{}', driver_employee_id uuid references public.employees(id), vehicle text,
 accompanying_staff jsonb not null default '[]', required_records jsonb not null default '[]', preparation_instructions text,
 completion_status text not null default 'scheduled' check(completion_status in('scheduled','completed','canceled','no_show')),
 return_instructions text, followup_tasks jsonb not null default '[]', next_appointment_at timestamptz, work_item_id uuid references public.work_items(id), created_at timestamptz not null default now()
);

create table public.resident_financial_accounts(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete restrict, resident_id uuid not null references public.residents(id) on delete restrict,
 account_type text not null check(account_type in('contract_charges','personal_funds')), status text not null default 'active', created_at timestamptz not null default now(), unique(resident_id,account_type)
);
create table public.resident_financial_transactions(
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.resident_financial_accounts(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete cascade, facility_id uuid not null references public.facilities(id) on delete restrict,
 transaction_type text not null, effective_date date not null default current_date, amount numeric(12,2) not null, purpose text not null, receipt_document_id uuid,
 staff_profile_id uuid references public.profiles(id), resident_acknowledgement jsonb, running_balance numeric(12,2), adjustment_of_transaction_id uuid references public.resident_financial_transactions(id),
 audit_history jsonb not null default '[]', created_at timestamptz not null default now()
);

create table public.regulatory_copilot_responses(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid references public.facilities(id) on delete restrict, question text not null, response_summary text not null,
 applicable_jurisdiction text not null, facility_type text not null, citation text, regulatory_source text, effective_date date, rule_pack_version text,
 evidence_used jsonb not null default '[]', missing_information jsonb not null default '[]', determination_type text not null check(determination_type in('recommendation','confirmed_system_determination')),
 safeguards jsonb not null default '{}', created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create table public.scheduled_report_deliveries(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 facility_id uuid references public.facilities(id) on delete restrict, report_name text not null, report_definition jsonb not null,
 date_range jsonb not null, as_of_date date not null, cadence text not null check(cadence in('daily','weekly','monthly','quarterly','annual')),
 authorized_recipients jsonb not null default '[]', delivery_method text not null, immutable_snapshot jsonb, reconciliation_result jsonb,
 delivery_history jsonb not null default '[]', failed_delivery_retry jsonb not null default '{}', evidence_room_published_at timestamptz,
 retention_period interval not null default interval '7 years', trend_comparison jsonb not null default '{}', next_run_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

do $$declare t text;begin foreach t in array array[
 'complaints','complaint_history','scheduling_eligibility_decisions','scheduling_eligibility_overrides','service_workload_requirements','environmental_work_orders','emergency_plans','emergency_events','resident_administrative_profiles','resident_signature_records','dietary_operations','resident_service_events','resident_financial_accounts','resident_financial_transactions','regulatory_copilot_responses','scheduled_report_deliveries'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 execute format('grant all on table public.%I to service_role',t);
 execute format('grant select on table public.%I to authenticated',t);
 execute format('create policy %I on public.%I for select to authenticated using(app_private.admission_row_visible(organization_id,facility_id))',t||'_select',t);
end loop;end$$;

create or replace function public.create_complaint_incident_if_reportable(p_complaint_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.complaints%rowtype; v_incident uuid;begin
 select * into c from public.complaints where id=p_complaint_id for update; if not found then raise exception 'Complaint not found' using errcode='P0002'; end if;
 perform app_private.assert_admission_manager(c.organization_id,c.facility_id);
 if not c.reportable_event_suspected then return c.linked_incident_id; end if;
 if c.linked_incident_id is null then
  insert into public.incidents(organization_id,facility_id,incident_type,occurred_at,reported_at,reported_by_profile_id,resident_identifier,location_detail,narrative,severity,status,investigator_profile_id)
  values(c.organization_id,c.facility_id,case when c.category ilike '%abuse%' then 'abuse_allegation' when c.category ilike '%neglect%' then 'neglect_allegation' when c.category ilike '%injur%' then 'significant_injury' else 'other' end, c.date_received::timestamptz, now(), auth.uid(), c.resident_id::text, null, 'Created from complaint '||c.complaint_number||': '||coalesce(c.investigation_notes,c.category), case when c.immediate_risk in('high','imminent') then 'critical' else 'moderate' end, 'reported', c.assigned_investigator_profile_id) returning id into v_incident;
  update public.complaints set linked_incident_id=v_incident, updated_at=now() where id=c.id;
  insert into public.complaint_history(organization_id,facility_id,complaint_id,event_type,resulting_status,actor_profile_id,reason,evidence) values(c.organization_id,c.facility_id,c.id,'incident_linked',c.status,auth.uid(),'Reportable concern initiated incident workflow',jsonb_build_object('incidentId',v_incident));
 else v_incident:=c.linked_incident_id; end if; return v_incident;
end$$;

create or replace function public.prevent_blocked_shift_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
declare d public.scheduling_eligibility_decisions%rowtype;begin
 select * into d from public.scheduling_eligibility_decisions where employee_id=new.employee_id and facility_id=new.facility_id and shift_date=new.shift_date and start_time=new.start_time and end_time=new.end_time order by evaluated_at desc limit 1;
 if d.id is null then
  raise exception 'Scheduling assignment requires a current eligibility decision' using errcode='42501';
 end if;
 if d.decision='blocked' and d.hard_block and not exists(select 1 from public.scheduling_eligibility_overrides o where o.id=d.override_id and o.revoked_at is null and o.expires_at>now()) then
  raise exception 'Blocked scheduling assignment requires an active authorized override' using errcode='42501';
 end if;
 return new;
end$$;
create trigger enforce_scheduling_eligibility before insert or update on public.shift_assignments for each row execute function public.prevent_blocked_shift_assignment();

grant execute on function public.create_complaint_incident_if_reportable(uuid) to authenticated;
