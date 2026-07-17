-- A public demo is a deliberately synthetic tenant, not a privileged account in a
-- customer tenant. The marker below gates restore operations and outbound delivery.
alter table public.organizations
  add column is_demo boolean not null default false,
  add column demo_seed_version integer,
  add column demo_reset_at timestamptz,
  add constraint organizations_demo_seed_check check (
    (not is_demo and demo_seed_version is null)
    or (is_demo and demo_seed_version is not null and demo_seed_version > 0)
  );

create index organizations_demo_idx on public.organizations(id) where is_demo;

create or replace function app_private.seed_demo_organization(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org public.organizations%rowtype;
  v_facility public.facilities%rowtype;
  v_second_facility public.facilities%rowtype;
  v_actor_id uuid;
  v_employee_id uuid;
  v_learner_id uuid;
  v_trainer_id uuid;
  v_training_type_id uuid;
  v_class_id uuid;
  v_resident_id uuid;
  v_second_resident_id uuid;
  v_unit_id uuid;
  v_building_id uuid;
  v_room_id uuid;
  v_shift_id uuid;
  v_schedule_id uuid;
  v_inspection_item_id uuid;
  v_location_id uuid;
  v_plan_id uuid;
  v_plan_version_id uuid;
  v_form_id uuid;
begin
  select * into v_org
  from public.organizations
  where id = p_organization_id and is_demo
  for update;
  if v_org.id is null then
    raise exception 'Demo organization not found' using errcode = 'P0002';
  end if;

  select * into v_facility
  from public.facilities
  where organization_id = v_org.id and is_active
  order by case facility_type when 'PCH' then 0 when 'ALR' then 1 else 2 end,
    created_at, id
  limit 1;
  if v_facility.id is null then
    insert into public.facilities (
      organization_id, name, facility_type, address, city, state, zip,
      administrator_name, administrator_email
    ) values (
      v_org.id, 'Sunrise Manor', 'PCH', '100 Demo Lane', 'Philadelphia', 'PA', '19103',
      'Robert Chen', 'demo-admin@example.invalid'
    ) returning * into v_facility;
  end if;

  select * into v_second_facility
  from public.facilities
  where organization_id = v_org.id and is_active and id <> v_facility.id
  order by created_at, id
  limit 1;
  if v_second_facility.id is null then
    insert into public.facilities (
      organization_id, name, facility_type, address, city, state, zip
    ) values (
      v_org.id, 'Sunrise Gardens', 'ALR', '200 Demo Lane', 'Philadelphia', 'PA', '19103'
    ) returning * into v_second_facility;
  end if;

  select id into v_actor_id
  from public.profiles
  where organization_id = v_org.id and role = 'org_admin' and is_active
  order by created_at, id
  limit 1;

  insert into public.facility_units (organization_id, facility_id, name, sort_order)
  values (v_org.id, v_facility.id, 'Personal Care - East', 1)
  on conflict (facility_id, name) do update set is_active = true, updated_at = now()
  returning id into v_unit_id;

  insert into public.facility_buildings (
    organization_id, facility_id, name, licensed_capacity
  ) values (v_org.id, v_facility.id, 'Main Building', 24)
  on conflict (facility_id, name) do update
    set licensed_capacity = excluded.licensed_capacity, is_active = true, updated_at = now()
  returning id into v_building_id;

  insert into public.residential_units (
    organization_id, facility_id, building_id, name, description
  ) values (
    v_org.id, v_facility.id, v_building_id, 'East Wing', 'Synthetic demo residential unit'
  ) on conflict (building_id, name) do update
    set description = excluded.description, is_active = true, updated_at = now()
  returning id into v_unit_id;

  insert into public.facility_rooms (
    organization_id, facility_id, building_id, residential_unit_id, room_number, room_type
  ) values (v_org.id, v_facility.id, v_building_id, v_unit_id, '101', 'private')
  on conflict (facility_id, room_number) do update
    set residential_unit_id = excluded.residential_unit_id, is_active = true, updated_at = now()
  returning id into v_room_id;

  insert into public.employees (
    organization_id, facility_id, employee_number, first_name, last_name, email,
    hire_date, job_title, department, status, administers_medications,
    scheduled_hours_per_week, worker_type, cleared_for_unsupervised_duty, is_synthetic
  ) select v_org.id, seed.facility_id, seed.employee_number, seed.first_name,
    seed.last_name, seed.email, seed.hire_date, seed.job_title, seed.department,
    'active', seed.administers_medications, seed.scheduled_hours_per_week,
    'regular', seed.cleared_for_unsupervised_duty, true
  from (values
    (v_facility.id, 'DEMO-101', 'Morgan', 'Lee', 'morgan.lee@example.invalid',
      current_date - 420, 'Medication Technician', 'Resident Care', 'active', true, 40, 'regular', true, true),
    (v_facility.id, 'DEMO-102', 'Taylor', 'Rivera', 'taylor.rivera@example.invalid',
      current_date - 210, 'Direct Care Staff', 'Resident Care', 'active', false, 36, 'regular', true, true),
    (v_facility.id, 'DEMO-103', 'Jamie', 'Okafor', 'jamie.okafor@example.invalid',
      current_date - 75, 'Activities Coordinator', 'Resident Services', 'active', false, 32, 'regular', true, true),
    (v_second_facility.id, 'DEMO-104', 'Riley', 'Martinez', 'riley.martinez@example.invalid',
      current_date - 35, 'Personal Care Aide', 'Resident Care', 'active', false, 24, 'regular', false, true)
  ) seed(facility_id,employee_number,first_name,last_name,email,hire_date,job_title,department,status,administers_medications,scheduled_hours_per_week,worker_type,cleared_for_unsupervised_duty,is_synthetic)
  where not exists (
    select 1 from public.employees e
    where e.organization_id = v_org.id and e.employee_number = seed.employee_number
  );

  update public.employees
  set status = 'active', termination_date = null, is_synthetic = true, updated_at = now()
  where organization_id = v_org.id and employee_number like 'DEMO-%';

  select id into v_employee_id
  from public.employees
  where organization_id = v_org.id and employee_number = 'DEMO-101';

  insert into public.residents (
    organization_id, facility_id, first_name, last_name, preferred_name, room,
    admission_date, date_of_birth, admission_track, status, primary_physician_name,
    designated_person_name, dietary_requirements, food_allergies, mobility_summary,
    supervision_requirements, communication_preferences, preferred_language,
    advance_directive_status, contract_status, contract_effective_date, is_synthetic
  ) select v_org.id, v_facility.id, seed.first_name, seed.last_name, seed.preferred_name,
    seed.room, seed.admission_date, seed.date_of_birth, seed.admission_track, 'active',
    'Dr. Elena Park', seed.designated_person_name, seed.dietary_requirements,
    seed.food_allergies, seed.mobility_summary, seed.supervision_requirements,
    seed.communication_preferences, 'English', 'on_file', 'executed', seed.admission_date, true
  from (values
    ('Evelyn','Brooks','Evie','101',current_date - 180,date '1943-04-18','standard','Marcus Brooks','Heart healthy',array['Shellfish']::text[],'Uses a rolling walker','Routine safety checks','Prefers written appointment reminders'),
    ('Samuel','Green','Sam','102',current_date - 62,date '1938-11-02','standard','Priya Green','Consistent carbohydrate',array[]::text[],'Independent with cane','Evening cueing','Speak clearly and allow response time'),
    ('Nora','Wilson','Nora','201',current_date - 21,date '1946-07-09','expedited','Lena Wilson','Regular diet',array['Peanuts']::text[],'Standby assist for transfers','Two-hour checks overnight','Prefers family included in planning')
  ) as seed(first_name,last_name,preferred_name,room,admission_date,date_of_birth,admission_track,designated_person_name,dietary_requirements,food_allergies,mobility_summary,supervision_requirements,communication_preferences)
  where not exists (
    select 1 from public.residents r
    where r.organization_id = v_org.id and r.first_name = seed.first_name
      and r.last_name = seed.last_name and r.is_synthetic
  );

  select id into v_resident_id from public.residents
  where organization_id = v_org.id and first_name = 'Evelyn' and last_name = 'Brooks'
  order by created_at limit 1;
  select id into v_second_resident_id from public.residents
  where organization_id = v_org.id and first_name = 'Samuel' and last_name = 'Green'
  order by created_at limit 1;

  insert into public.facility_beds (
    organization_id, facility_id, room_id, bed_label, status, occupied_by_resident_id
  ) values (v_org.id, v_facility.id, v_room_id, 'A', 'occupied', v_resident_id)
  on conflict (room_id, bed_label) do update
    set status = 'occupied', occupied_by_resident_id = excluded.occupied_by_resident_id,
      reserved_for_prospect_id = null, updated_at = now();

  insert into public.employee_credentials (
    organization_id, facility_id, employee_id, credential_type, credential_label,
    issuing_authority, credential_number, issue_date, expiration_date,
    last_verified_date, status, verification_method, verified_by_profile_id, verified_at
  ) select v_org.id, v_facility.id, v_employee_id, 'act34_criminal_history',
    'PA Criminal History Clearance', 'Pennsylvania State Police', 'DEMO-ACT34-101',
    current_date - 700, current_date + 26, current_date - 30, 'due_soon',
    'Synthetic demo verification', v_actor_id, now()
  where v_employee_id is not null and not exists (
    select 1 from public.employee_credentials
    where employee_id = v_employee_id and credential_number = 'DEMO-ACT34-101'
  );

  select e.id into v_learner_id
  from public.employees e
  join public.profiles p on p.id = e.profile_id
  where e.organization_id = v_org.id and p.role = 'employee' and p.is_active
  order by e.created_at, e.id
  limit 1;
  v_learner_id := coalesce(v_learner_id, v_employee_id);

  insert into public.course_assignments (
    organization_id, facility_id, employee_id, course_id, course_version_id,
    assigned_by, due_date, status
  ) select v_org.id, e.facility_id, e.id, c.id, c.current_version_id,
    v_actor_id, current_date + row_number() over (order by c.catalog_code)::integer * 7,
    case when row_number() over (order by c.catalog_code) = 1 then 'in_progress' else 'assigned' end
  from public.employees e
  cross join lateral (
    select id, current_version_id, catalog_code
    from public.courses
    where status = 'published' and current_version_id is not null
      and catalog_code in (
        'PA-PCH-ANNUAL-ASSESSED-NEEDS',
        'PA-PCH-ANNUAL-PERSONAL-CARE-SERVICES',
        'PA-PCH-2600-236-DEMENTIA-FOUNDATIONS'
      )
    order by catalog_code
  ) c
  where e.id = v_learner_id
    and not exists (
      select 1 from public.course_assignments a
      where a.employee_id = e.id and a.course_id = c.id and a.status <> 'canceled'
    );

  select p.id into v_trainer_id
  from public.profiles p
  where p.organization_id = v_org.id and p.role = 'trainer' and p.is_active
  order by p.created_at, p.id
  limit 1;
  select id into v_training_type_id from public.training_types
  where name = 'Abuse, Neglect, and Exploitation Reporting' and is_active
  limit 1;
  if v_trainer_id is not null and v_training_type_id is not null then
    select id into v_class_id from public.training_classes
    where organization_id = v_org.id and class_name = 'Demo: Abuse Reporting Refresher'
    order by created_at limit 1;
    if v_class_id is null then
      insert into public.training_classes (
        organization_id, facility_id, trainer_profile_id, training_type_id,
        class_name, class_date, location, duration_hours, status, notes,
        capacity, starts_at, ends_at, room_name
      ) values (
        v_org.id, v_facility.id, v_trainer_id, v_training_type_id,
        'Demo: Abuse Reporting Refresher', current_date + 5, 'Sunrise Manor', 1.5,
        'scheduled', 'Synthetic scheduled class for the public demo.', 12,
        date_trunc('day', now() + interval '5 days') + interval '13 hours',
        date_trunc('day', now() + interval '5 days') + interval '14 hours 30 minutes',
        'Training Room A'
      ) returning id into v_class_id;
    else
      update public.training_classes
      set class_date = current_date + 5, status = 'scheduled',
        starts_at = date_trunc('day', now() + interval '5 days') + interval '13 hours',
        ends_at = date_trunc('day', now() + interval '5 days') + interval '14 hours 30 minutes',
        updated_at = now()
      where id = v_class_id and status <> 'completed';
    end if;
    insert into public.training_class_attendees (class_id, employee_id, attended)
    select v_class_id, v_learner_id, true
    where v_learner_id is not null
    on conflict (class_id, employee_id) do nothing;
  end if;

  insert into public.shift_definitions (
    organization_id, facility_id, name, start_time, end_time, color, sort_order
  ) values (v_org.id, v_facility.id, 'Day', '07:00', '15:00', '#2563eb', 1)
  on conflict (facility_id, name) do update
    set start_time = excluded.start_time, end_time = excluded.end_time,
      color = excluded.color, is_active = true, updated_at = now()
  returning id into v_shift_id;
  insert into public.shift_definitions (
    organization_id, facility_id, name, start_time, end_time, color, sort_order
  ) values
    (v_org.id, v_facility.id, 'Evening', '15:00', '23:00', '#7c3aed', 2),
    (v_org.id, v_facility.id, 'Overnight', '23:00', '07:00', '#334155', 3)
  on conflict (facility_id, name) do update
    set start_time = excluded.start_time, end_time = excluded.end_time,
      color = excluded.color, is_active = true, updated_at = now();

  select id into v_schedule_id from public.schedules
  where organization_id = v_org.id and title = 'Demo staffing schedule'
  order by created_at limit 1;
  if v_schedule_id is null then
    insert into public.schedules (
      organization_id, facility_id, title, period_start, period_end,
      status, created_by, published_at
    ) values (
      v_org.id, v_facility.id, 'Demo staffing schedule', current_date,
      current_date + 13, 'published', v_actor_id, now()
    ) returning id into v_schedule_id;
  else
    update public.schedules set period_start = current_date, period_end = current_date + 13,
      status = 'published', published_at = now(), updated_at = now()
    where id = v_schedule_id;
    delete from public.shift_assignments where schedule_id = v_schedule_id;
  end if;

  insert into public.shift_assignments (
    organization_id, schedule_id, facility_id, employee_id, shift_definition_id,
    shift_date, start_time, end_time, status, source, notes
  ) select v_org.id, v_schedule_id, v_facility.id, e.id, v_shift_id,
    current_date + day_offset::integer, '07:00', '15:00', 'confirmed', 'manual', 'Synthetic demo shift'
  from (
    select id, row_number() over (order by employee_number) - 1 as day_offset
    from public.employees
    where organization_id = v_org.id and facility_id = v_facility.id
      and status = 'active' and is_synthetic
    order by employee_number limit 4
  ) e;

  insert into public.admission_prospects (
    organization_id, facility_id, first_name, last_name, inquiry_date, stage,
    clinical_review_status, financial_review_status, expected_move_in_date,
    primary_contact_name, primary_contact_relationship, primary_contact_phone, notes, created_by
  ) select v_org.id, v_facility.id, seed.first_name, seed.last_name, current_date - seed.age,
    seed.stage, seed.clinical, seed.financial, current_date + seed.move_in,
    seed.contact, 'Daughter', '215-555-01' || seed.age::text,
    'Synthetic prospect for demo workflow.', v_actor_id
  from (values
    ('Arthur','Miles',3,'applicant','in_review','approved',18,'Denise Miles'),
    ('Helen','Sato',8,'approved','approved','approved',7,'Mina Sato'),
    ('George','King',1,'prospect','not_started','not_started',30,'Amelia King')
  ) seed(first_name,last_name,age,stage,clinical,financial,move_in,contact)
  where not exists (
    select 1 from public.admission_prospects p
    where p.organization_id = v_org.id and p.first_name = seed.first_name and p.last_name = seed.last_name
  );

  insert into public.incidents (
    organization_id, facility_id, incident_type, occurred_at, reported_at,
    reported_by_profile_id, resident_id, resident_identifier, location_detail,
    narrative, severity, status, investigator_name, investigation_started_at,
    idempotency_key
  ) select v_org.id, v_facility.id, 'significant_injury', now() - interval '3 days',
    now() - interval '3 days' + interval '20 minutes', v_actor_id, v_resident_id,
    'Evelyn Brooks (synthetic)', 'Dining room',
    'Synthetic resident had a witnessed fall with no apparent injury. Monitoring and follow-up are in progress.',
    'moderate', 'investigating', 'Dana Brooks', now() - interval '2 days',
    'demo-significant-injury-001'
  where not exists (
    select 1 from public.incidents where organization_id = v_org.id
      and idempotency_key = 'demo-significant-injury-001'
  );

  insert into public.inspection_items (
    organization_id, facility_id, item_kind, item_type, label, location_detail,
    manufacturer, model_number, serial_number, install_date, inspection_interval_days,
    last_inspected_date, next_due_date, status, notes
  ) select
    v_org.id, v_facility.id, 'equipment', 'generator', 'Emergency generator',
    'Rear utility room', 'Demo Power Systems', 'GEN-20', 'SYNTHETIC-001',
    current_date - 900, 30, current_date - 24, current_date + 6, 'due_soon',
    'Synthetic inspection asset for the public demo.'
  where not exists (
    select 1 from public.inspection_items i
    where i.organization_id = v_org.id and i.facility_id = v_facility.id
      and i.label = 'Emergency generator'
  );
  select id into v_inspection_item_id from public.inspection_items
  where organization_id = v_org.id and facility_id = v_facility.id
    and label = 'Emergency generator' order by created_at limit 1;
  insert into public.inspection_events (
    organization_id, facility_id, inspection_item_id, performed_date,
    performed_by, performed_by_profile_id, result, follow_up_required, notes
  ) select v_org.id, v_facility.id, v_inspection_item_id, current_date - 24,
    'Dana Brooks', v_actor_id, 'pass', false, 'Synthetic monthly generator inspection.'
  where v_inspection_item_id is not null and not exists (
    select 1 from public.inspection_events e
    where e.inspection_item_id = v_inspection_item_id and e.notes = 'Synthetic monthly generator inspection.'
  );

  insert into public.maintenance_locations (
    organization_id, facility_id, label, room_number, location_detail
  ) values (v_org.id, v_facility.id, 'Dining room', 'DR-1', 'Main building, first floor')
  on conflict (facility_id, label) do update set is_active = true, updated_at = now()
  returning id into v_location_id;
  insert into public.work_orders (
    organization_id, facility_id, work_order_number, maintenance_location_id,
    location_detail, problem_description, safety_risk, priority,
    temporary_protective_action, assigned_employee_id, target_completion_at,
    estimated_cost, resident_impact, status, created_by_profile_id
  ) select
    v_org.id, v_facility.id, 'DEMO-WO-1001', v_location_id, 'Dining room window',
    'Window latch does not close securely.', 'moderate', 'urgent',
    'Window secured and area marked pending repair.', v_employee_id,
    now() + interval '2 days', 185, 'Dining room seating moved away from window.',
    'assigned', v_actor_id
  where not exists (
    select 1 from public.work_orders w
    where w.organization_id = v_org.id
      and w.problem_description = 'Window latch does not close securely.'
  );
  update public.work_orders
  set status = 'assigned', target_completion_at = now() + interval '2 days', updated_at = now()
  where organization_id = v_org.id
    and problem_description = 'Window latch does not close securely.';

  insert into public.resident_service_calendar_events (
    organization_id, facility_id, resident_id, event_type, title, provider_name,
    provider_contact, location_name, starts_at, ends_at, status,
    transportation_mode, transportation_vendor, required_records,
    preparation_instructions, notes, created_by
  ) select v_org.id, v_facility.id, v_second_resident_id, 'medical_appointment',
    'Cardiology follow-up', 'Dr. Elena Park', '215-555-0188', 'Penn Cardiology',
    date_trunc('day', now() + interval '4 days') + interval '10 hours',
    date_trunc('day', now() + interval '4 days') + interval '11 hours',
    'scheduled', 'vendor', 'Demo Transit', array['Medication list','Insurance card']::text[],
    'Bring current medication list and arrive 15 minutes early.',
    'Synthetic appointment for the public demo.', v_actor_id
  where v_second_resident_id is not null and not exists (
    select 1 from public.resident_service_calendar_events e
    where e.organization_id = v_org.id and e.resident_id = v_second_resident_id
      and e.title = 'Cardiology follow-up' and e.status = 'scheduled'
  );

  insert into public.complaints (
    organization_id, facility_id, complaint_number, date_received, method_received,
    complainant_type, complainant_name, resident_id, category, description,
    immediate_risk, acknowledgement_date, assigned_investigator_profile_id,
    investigation_notes, status, created_by
  ) values (
    v_org.id, v_facility.id, 'DEMO-CMP-1001', now() - interval '5 days', 'phone',
    'family', 'Marcus Brooks (synthetic)', v_resident_id, 'service',
    'Family requested more consistent communication about appointment schedule changes.',
    'low', now() - interval '4 days', v_actor_id,
    'Reviewing handoff and family notification workflow.', 'investigating', v_actor_id
  ) on conflict (organization_id, complaint_number) do update
    set status = 'investigating', updated_at = now();

  insert into public.qapi_projects (
    organization_id, facility_id, project_number, title, problem_statement,
    source_of_concern, baseline_data, measurable_objective, target_description,
    target_value, start_date, target_completion_date, project_lead_profile_id,
    team_members, root_cause_method, planned_interventions,
    measurement_frequency, status, created_by
  ) values (
    v_org.id, v_facility.id, 'DEMO-QAPI-2026-01', 'Improve appointment handoff reliability',
    'Appointment changes are not always acknowledged during shift handoff.',
    'Synthetic complaint trend', 'Baseline acknowledgment rate: 72 percent.',
    'Reach a 95 percent documented acknowledgment rate.', 'Acknowledgment rate', 95,
    current_date - 14, current_date + 60, v_actor_id,
    '[{"name":"Dana Brooks","role":"Project lead"},{"name":"Jamie Okafor","role":"Resident services"}]'::jsonb,
    'five_whys', 'Use a standard handoff checklist and audit five records weekly.',
    'Weekly', 'active', v_actor_id
  ) on conflict (organization_id, project_number) do update
    set status = 'active', target_completion_date = current_date + 60, updated_at = now();

  if v_actor_id is not null then
    insert into public.emergency_plans (
      organization_id, facility_id, title, created_by
    ) values (v_org.id, v_facility.id, 'Sunrise Manor Emergency Operations Plan', v_actor_id)
    on conflict (facility_id) do update set title = excluded.title, updated_at = now()
    returning id into v_plan_id;

    insert into public.emergency_plan_versions (
      organization_id, facility_id, plan_id, version_number, effective_date,
      change_summary, plan_snapshot, approved_by, approved_at
    ) values (
      v_org.id, v_facility.id, v_plan_id, 1, current_date - 120,
      'Synthetic baseline emergency plan.',
      '{"assemblyPoint":"East parking lot","incidentCommand":"Administrator on duty","residentAccountability":"Printed census and room sweep"}'::jsonb,
      v_actor_id, now() - interval '120 days'
    ) on conflict (plan_id, version_number) do nothing;
    select id into v_plan_version_id
    from public.emergency_plan_versions
    where plan_id = v_plan_id and version_number = 1;
    update public.emergency_plans set current_version_id = v_plan_version_id where id = v_plan_id;

    insert into public.emergency_events (
      organization_id, facility_id, event_number, event_mode, event_type, status,
      plan_version_id, incident_commander_profile_id, started_at, ended_at,
      location_description, assembly_point, summary, declared_by
    ) values (
      v_org.id, v_facility.id, 'DEMO-DRILL-1001', 'drill', 'fire', 'closed',
      v_plan_version_id, v_actor_id, now() - interval '20 days',
      now() - interval '20 days' + interval '11 minutes', 'Main building',
      'East parking lot', 'Synthetic fire drill completed with all residents accounted for.',
      v_actor_id
    ) on conflict (organization_id, event_number) do update
      set plan_version_id = excluded.plan_version_id, status = 'closed', updated_at = now();
  end if;

  insert into public.evidence_collections (
    organization_id, facility_id, name, purpose, status, legal_hold,
    terms_version, created_by
  ) select v_org.id, v_facility.id, '2026 DHS Survey Readiness',
    'Synthetic workspace for assembling survey-readiness reports and supporting records.',
    'draft', false, 'demo-1', v_actor_id
  where not exists (
    select 1 from public.evidence_collections c
    where c.organization_id = v_org.id and c.name = '2026 DHS Survey Readiness'
  );

  if v_resident_id is not null and not exists (
    select 1 from public.resident_assessment_forms f
    where f.resident_id = v_resident_id and f.form_type = 'ASP' and f.version_number = 1
  ) then
    insert into public.resident_assessment_forms (
      organization_id, facility_id, resident_id, form_type, reason, version_number,
      status, content, prepared_by_profile_id, prepared_by_name, prepared_by_title,
      prepared_date
    ) values (
      v_org.id, v_facility.id, v_resident_id, 'ASP', 'initial', 1, 'draft',
      jsonb_build_object(
        'assessmentInfo', jsonb_build_object('lastSupportPlanDate', current_date::text),
        'section1', jsonb_build_object('items', jsonb_build_object(
          'morning_personal_care', jsonb_build_object(
            'planDescription','Offer setup and standby assistance with morning personal care.',
            'planFrequency','daily','planResponsibleParty','DCS',
            'serviceNeedDescription','Standby support with morning routine.'
          )
        ))
      ),
      v_actor_id, 'Dana Brooks', 'Facility Administrator', current_date
    ) returning id into v_form_id;
    update public.resident_assessment_forms
    set status = 'finalized', finalized_at = now(), updated_at = now()
    where id = v_form_id;
  end if;

  perform public.generate_resident_service_tasks(current_date, current_date + 14, null);
  perform public.recalculate_compliance_core(v_org.id);

  update public.organizations
  set demo_seed_version = 1, demo_reset_at = now(), updated_at = now()
  where id = v_org.id;

  return jsonb_build_object(
    'organizationId', v_org.id,
    'seedVersion', 1,
    'resetAt', now(),
    'facilities', (select count(*) from public.facilities where organization_id = v_org.id),
    'employees', (select count(*) from public.employees where organization_id = v_org.id),
    'residents', (select count(*) from public.residents where organization_id = v_org.id),
    'schedules', (select count(*) from public.schedules where organization_id = v_org.id),
    'courseAssignments', (select count(*) from public.course_assignments where organization_id = v_org.id),
    'admissionProspects', (select count(*) from public.admission_prospects where organization_id = v_org.id),
    'incidents', (select count(*) from public.incidents where organization_id = v_org.id),
    'workOrders', (select count(*) from public.work_orders where organization_id = v_org.id)
  );
end;
$function$;

create or replace function public.restore_demo_baseline()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org_id uuid := public.current_org_id();
  v_result jsonb;
begin
  if auth.uid() is null or public.current_role() <> 'org_admin' or not exists (
    select 1 from public.organizations o where o.id = v_org_id and o.is_demo
  ) then
    raise exception 'Only a demo organization administrator may restore demo data'
      using errcode = '42501';
  end if;
  v_result := app_private.seed_demo_organization(v_org_id);
  insert into public.audit_logs (
    organization_id, actor_profile_id, entity_type, entity_id, action, new_values
  ) values (
    v_org_id, auth.uid(), 'demo_organization', v_org_id::text, 'baseline_restored', v_result
  );
  return v_result;
end;
$function$;

create or replace function app_private.restore_all_demo_baselines()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org record;
  v_count integer := 0;
begin
  if current_user not in ('postgres', 'supabase_admin')
     and coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Demo restore requires a trusted worker' using errcode = '42501';
  end if;
  for v_org in select id from public.organizations where is_demo loop
    perform app_private.seed_demo_organization(v_org.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- Never turn in-app demo events into email, SMS, or web-push deliveries.
create or replace function app_private.suppress_demo_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1 from public.organizations o
    where o.id = new.organization_id and o.is_demo
  ) then
    return null;
  end if;
  return new;
end;
$function$;

create trigger suppress_demo_notification_delivery
before insert on public.notification_deliveries
for each row execute function app_private.suppress_demo_notification_delivery();

revoke all on function app_private.seed_demo_organization(uuid),
  app_private.restore_all_demo_baselines(),
  app_private.suppress_demo_notification_delivery(),
  public.restore_demo_baseline()
from public, anon, authenticated, service_role;
grant execute on function app_private.seed_demo_organization(uuid),
  app_private.restore_all_demo_baselines() to service_role;
grant execute on function public.restore_demo_baseline() to authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'restore-public-demo-baseline';
select cron.schedule(
  'restore-public-demo-baseline',
  '15 9 * * *',
  $$select app_private.restore_all_demo_baselines();$$
);

-- Existing hosted sample tenants become explicit demo tenants on deployment. New
-- environments receive the same marker and call the seed function from seed.sql.
update public.organizations
set is_demo = true, demo_seed_version = 1, updated_at = now()
where slug = 'sunrise-healthcare';

do $block$
declare v_org_id uuid;
begin
  select id into v_org_id from public.organizations
  where slug = 'sunrise-healthcare' and is_demo;
  if v_org_id is not null then
    perform app_private.seed_demo_organization(v_org_id);
  end if;
end;
$block$;
