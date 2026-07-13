-- Priority 9: environmental work orders and preventive maintenance.
-- The lifecycle is deliberately separate from corrective_actions: maintenance work carries
-- asset/location, downtime, cost, vendor, photo, warranty, and supervisor-verification evidence.

create sequence public.work_order_number_seq;

alter table public.inspection_items
  add column qr_token uuid not null default gen_random_uuid(),
  add column warranty_expires_on date,
  add column service_contract_expires_on date;
create unique index inspection_items_qr_token_key on public.inspection_items(qr_token);

create table public.maintenance_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 200),
  room_number text,
  location_detail text,
  qr_token uuid not null default gen_random_uuid() unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, label)
);
create index maintenance_locations_org_facility_idx
  on public.maintenance_locations(organization_id, facility_id);

create table public.preventive_maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  inspection_item_id uuid references public.inspection_items(id) on delete cascade,
  maintenance_location_id uuid references public.maintenance_locations(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 240),
  description text not null check (length(btrim(description)) between 1 and 4000),
  frequency_unit text not null check (frequency_unit in ('day','week','month','year')),
  frequency_interval integer not null default 1 check (frequency_interval between 1 and 365),
  next_due_date date not null,
  default_priority text not null default 'routine'
    check (default_priority in ('routine','urgent','emergency')),
  assigned_employee_id uuid references public.employees(id) on delete set null,
  external_vendor text,
  estimated_duration_minutes integer check (estimated_duration_minutes is null or estimated_duration_minutes >= 0),
  estimated_cost numeric(12,2) check (estimated_cost is null or estimated_cost >= 0),
  parts_needed text,
  is_active boolean not null default true,
  last_generated_on date,
  created_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (inspection_item_id is not null or maintenance_location_id is not null)
);
create index preventive_maintenance_due_idx
  on public.preventive_maintenance_schedules(next_due_date)
  where is_active;
create index preventive_maintenance_org_facility_idx
  on public.preventive_maintenance_schedules(organization_id, facility_id);

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  work_order_number text not null unique,
  source_inspection_event_id uuid unique references public.inspection_events(id) on delete set null,
  preventive_maintenance_schedule_id uuid references public.preventive_maintenance_schedules(id) on delete set null,
  inspection_item_id uuid references public.inspection_items(id) on delete set null,
  maintenance_location_id uuid references public.maintenance_locations(id) on delete set null,
  location_detail text,
  room_number text,
  problem_description text not null check (length(btrim(problem_description)) between 3 and 4000),
  safety_risk text not null default 'low'
    check (safety_risk in ('none','low','moderate','high','immediate_danger')),
  priority text not null default 'routine'
    check (priority in ('routine','urgent','emergency')),
  temporary_protective_action text,
  assigned_employee_id uuid references public.employees(id) on delete set null,
  external_vendor text,
  target_completion_at timestamptz,
  parts_needed text,
  estimated_cost numeric(12,2) check (estimated_cost is null or estimated_cost >= 0),
  actual_cost numeric(12,2) check (actual_cost is null or actual_cost >= 0),
  downtime_started_at timestamptz,
  downtime_ended_at timestamptz,
  repair_notes text,
  resident_impact text,
  status text not null default 'open'
    check (status in ('open','assigned','in_progress','on_hold','pending_verification','verified','canceled')),
  created_by_profile_id uuid references public.profiles(id),
  completed_by_profile_id uuid references public.profiles(id),
  completed_at timestamptz,
  verified_by_profile_id uuid references public.profiles(id),
  verified_at timestamptz,
  verification_notes text,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (downtime_ended_at is null or downtime_started_at is not null),
  check (downtime_ended_at is null or downtime_ended_at >= downtime_started_at),
  check (status <> 'pending_verification' or (completed_at is not null and completed_by_profile_id is not null and length(btrim(coalesce(repair_notes, ''))) >= 3)),
  check (status <> 'verified' or (verified_at is not null and verified_by_profile_id is not null and length(btrim(coalesce(verification_notes, ''))) >= 3))
);
create index work_orders_org_facility_status_idx
  on public.work_orders(organization_id, facility_id, status);
create index work_orders_target_completion_idx
  on public.work_orders(target_completion_at)
  where status not in ('verified','canceled');
create index work_orders_inspection_item_idx on public.work_orders(inspection_item_id);
create index work_orders_assigned_employee_idx on public.work_orders(assigned_employee_id);

create table public.work_order_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  event_type text not null check (event_type in ('created','updated','transition','submitted_for_verification','verified','reopened','document_added')),
  prior_status text,
  resulting_status text,
  actor_profile_id uuid references public.profiles(id),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index work_order_history_work_order_idx on public.work_order_history(work_order_id, id);

create table public.maintenance_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  work_order_id uuid references public.work_orders(id) on delete cascade,
  inspection_item_id uuid references public.inspection_items(id) on delete cascade,
  document_type text not null check (document_type in (
    'problem_photo','before_photo','after_photo','warranty','service_contract',
    'part_invoice','vendor_report','other'
  )),
  storage_bucket text not null default 'maintenance-documents'
    check (storage_bucket = 'maintenance-documents'),
  storage_path text not null,
  file_name text not null,
  file_type text not null,
  file_size integer check (file_size is null or file_size >= 0),
  document_label text,
  uploaded_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((work_order_id is not null)::integer + (inspection_item_id is not null)::integer = 1),
  unique (storage_bucket, storage_path)
);
create index maintenance_documents_work_order_idx on public.maintenance_documents(work_order_id);
create index maintenance_documents_item_idx on public.maintenance_documents(inspection_item_id);

create trigger set_updated_at before update on public.maintenance_locations
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.preventive_maintenance_schedules
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.work_orders
  for each row execute function public.set_updated_at();

create trigger audit_log after insert or update or delete on public.maintenance_locations
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.preventive_maintenance_schedules
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.work_orders
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.maintenance_documents
  for each row execute function public.audit_log_trigger();

create or replace function public.stamp_maintenance_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_facility uuid;
begin
  if tg_table_name = 'maintenance_locations' then
    select f.organization_id, f.id into v_org, v_facility
    from public.facilities f where f.id = new.facility_id;
  elsif tg_table_name = 'preventive_maintenance_schedules' then
    if new.inspection_item_id is not null then
      select i.organization_id, i.facility_id into v_org, v_facility
      from public.inspection_items i where i.id = new.inspection_item_id;
    else
      select l.organization_id, l.facility_id into v_org, v_facility
      from public.maintenance_locations l where l.id = new.maintenance_location_id;
    end if;
  elsif tg_table_name = 'work_orders' then
    if new.source_inspection_event_id is not null then
      select e.organization_id, e.facility_id, e.inspection_item_id
        into v_org, v_facility, new.inspection_item_id
      from public.inspection_events e where e.id = new.source_inspection_event_id;
    elsif new.inspection_item_id is not null then
      select i.organization_id, i.facility_id into v_org, v_facility
      from public.inspection_items i where i.id = new.inspection_item_id;
    elsif new.maintenance_location_id is not null then
      select l.organization_id, l.facility_id into v_org, v_facility
      from public.maintenance_locations l where l.id = new.maintenance_location_id;
    else
      select f.organization_id, f.id into v_org, v_facility
      from public.facilities f where f.id = new.facility_id;
    end if;
    if tg_op = 'INSERT' then
      new.work_order_number := format(
        'WO-%s-%s', to_char(current_date, 'YYYY'),
        lpad(nextval('public.work_order_number_seq')::text, 6, '0')
      );
      new.created_by_profile_id := coalesce(new.created_by_profile_id, auth.uid());
      new.status := 'open';
    end if;
  elsif tg_table_name = 'maintenance_documents' then
    if new.work_order_id is not null then
      select w.organization_id, w.facility_id into v_org, v_facility
      from public.work_orders w where w.id = new.work_order_id;
    else
      select i.organization_id, i.facility_id into v_org, v_facility
      from public.inspection_items i where i.id = new.inspection_item_id;
    end if;
    new.uploaded_by_profile_id := coalesce(new.uploaded_by_profile_id, auth.uid());
  end if;

  if v_org is null or v_facility is null then
    raise exception 'Maintenance parent record was not found' using errcode = '23503';
  end if;
  new.organization_id := v_org;
  new.facility_id := v_facility;

  if tg_table_name in ('preventive_maintenance_schedules','work_orders') then
    if new.assigned_employee_id is not null and not exists (
      select 1 from public.employees e
      where e.id = new.assigned_employee_id
        and e.organization_id = v_org
        and e.status = 'active'
    ) then
      raise exception 'Assigned maintenance employee must be active in this organization' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger stamp_scope before insert or update on public.maintenance_locations
  for each row execute function public.stamp_maintenance_scope();
create trigger stamp_scope before insert or update on public.preventive_maintenance_schedules
  for each row execute function public.stamp_maintenance_scope();
create trigger stamp_scope before insert or update on public.work_orders
  for each row execute function public.stamp_maintenance_scope();
create trigger stamp_scope before insert or update on public.maintenance_documents
  for each row execute function public.stamp_maintenance_scope();

create or replace function public.prevent_work_order_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Work-order history is append-only' using errcode = '55000';
end;
$$;
create trigger work_order_history_immutable before update or delete on public.work_order_history
  for each row execute function public.prevent_work_order_history_mutation();

create or replace function public.create_work_order(
  p_facility_id uuid,
  p_problem_description text,
  p_inspection_item_id uuid default null,
  p_maintenance_location_id uuid default null,
  p_location_detail text default null,
  p_room_number text default null,
  p_safety_risk text default 'low',
  p_priority text default 'routine',
  p_temporary_protective_action text default null,
  p_assigned_employee_id uuid default null,
  p_external_vendor text default null,
  p_target_completion_at timestamptz default null,
  p_parts_needed text default null,
  p_estimated_cost numeric default null,
  p_resident_impact text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select f.organization_id into v_org from public.facilities f where f.id = p_facility_id;
  if v_org is null then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  if not (public.is_platform_admin() or (
    v_org = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager','trainer')
    and public.is_assigned_to_facility(p_facility_id)
  )) then raise exception 'Not authorized to create work orders' using errcode = '42501'; end if;
  if p_inspection_item_id is not null and not exists (
    select 1 from public.inspection_items i
    where i.id = p_inspection_item_id and i.facility_id = p_facility_id
  ) then raise exception 'Inspection item is outside the selected facility' using errcode = '23514'; end if;
  if p_maintenance_location_id is not null and not exists (
    select 1 from public.maintenance_locations l
    where l.id = p_maintenance_location_id and l.facility_id = p_facility_id
  ) then raise exception 'Maintenance location is outside the selected facility' using errcode = '23514'; end if;

  insert into public.work_orders(
    organization_id, facility_id, work_order_number, inspection_item_id,
    maintenance_location_id, location_detail, room_number, problem_description,
    safety_risk, priority, temporary_protective_action, assigned_employee_id,
    external_vendor, target_completion_at, parts_needed, estimated_cost,
    resident_impact, created_by_profile_id
  ) values (
    v_org, p_facility_id, 'pending', p_inspection_item_id,
    p_maintenance_location_id, nullif(btrim(p_location_detail), ''), nullif(btrim(p_room_number), ''),
    btrim(p_problem_description), p_safety_risk, p_priority,
    nullif(btrim(p_temporary_protective_action), ''), p_assigned_employee_id,
    nullif(btrim(p_external_vendor), ''), p_target_completion_at,
    nullif(btrim(p_parts_needed), ''), p_estimated_cost,
    nullif(btrim(p_resident_impact), ''), auth.uid()
  ) returning id into v_id;
  insert into public.work_order_history(
    organization_id, facility_id, work_order_id, event_type, resulting_status,
    actor_profile_id, notes
  ) values (v_org, p_facility_id, v_id, 'created', 'open', auth.uid(), 'Work order created');
  return v_id;
end;
$$;

create or replace function public.update_work_order_details(
  p_work_order_id uuid,
  p_location_detail text,
  p_room_number text,
  p_safety_risk text,
  p_priority text,
  p_temporary_protective_action text,
  p_assigned_employee_id uuid,
  p_external_vendor text,
  p_target_completion_at timestamptz,
  p_parts_needed text,
  p_estimated_cost numeric,
  p_resident_impact text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.work_orders%rowtype;
begin
  select * into v from public.work_orders where id = p_work_order_id for update;
  if not found then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  if not (public.is_platform_admin() or (
    v.organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager','trainer')
    and public.is_assigned_to_facility(v.facility_id)
  )) then raise exception 'Not authorized to update work orders' using errcode = '42501'; end if;
  if v.status in ('verified','canceled') then
    raise exception 'Terminal work orders cannot be edited' using errcode = '55000';
  end if;
  update public.work_orders set
    location_detail = nullif(btrim(p_location_detail), ''),
    room_number = nullif(btrim(p_room_number), ''),
    safety_risk = p_safety_risk,
    priority = p_priority,
    temporary_protective_action = nullif(btrim(p_temporary_protective_action), ''),
    assigned_employee_id = p_assigned_employee_id,
    external_vendor = nullif(btrim(p_external_vendor), ''),
    target_completion_at = p_target_completion_at,
    parts_needed = nullif(btrim(p_parts_needed), ''),
    estimated_cost = p_estimated_cost,
    resident_impact = nullif(btrim(p_resident_impact), '')
  where id = v.id;
  insert into public.work_order_history(
    organization_id, facility_id, work_order_id, event_type, prior_status,
    resulting_status, actor_profile_id, notes
  ) values (v.organization_id, v.facility_id, v.id, 'updated', v.status, v.status, auth.uid(), 'Work-order details updated');
  return true;
end;
$$;

create or replace function public.transition_work_order(
  p_work_order_id uuid,
  p_target_status text,
  p_notes text,
  p_actual_cost numeric default null,
  p_downtime_started_at timestamptz default null,
  p_downtime_ended_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.work_orders%rowtype;
  v_allowed boolean := false;
  v_is_assignee boolean := false;
begin
  select * into v from public.work_orders where id = p_work_order_id for update;
  if not found then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  v_is_assignee := exists (
    select 1 from public.employees e where e.id = v.assigned_employee_id and e.profile_id = auth.uid()
  );
  if not (v_is_assignee or public.is_platform_admin() or (
    v.organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager','trainer')
    and public.is_assigned_to_facility(v.facility_id)
  )) then raise exception 'Not authorized to transition this work order' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_notes, ''))) < 3 then
    raise exception 'Transition notes are required' using errcode = '22023';
  end if;

  v_allowed := case v.status
    when 'open' then p_target_status in ('assigned','in_progress','on_hold','canceled')
    when 'assigned' then p_target_status in ('in_progress','on_hold','canceled')
    when 'in_progress' then p_target_status in ('on_hold','pending_verification','canceled')
    when 'on_hold' then p_target_status in ('in_progress','canceled')
    when 'pending_verification' then p_target_status = 'in_progress'
    when 'canceled' then p_target_status = 'open'
    else false
  end;
  if not v_allowed then
    raise exception 'Invalid work-order transition from % to %', v.status, p_target_status using errcode = '55000';
  end if;

  if p_target_status = 'pending_verification' then
    update public.work_orders set
      status = p_target_status,
      repair_notes = btrim(p_notes),
      actual_cost = p_actual_cost,
      downtime_started_at = coalesce(p_downtime_started_at, downtime_started_at),
      downtime_ended_at = p_downtime_ended_at,
      completed_by_profile_id = auth.uid(),
      completed_at = now()
    where id = v.id;
  else
    update public.work_orders set
      status = p_target_status,
      canceled_at = case when p_target_status = 'canceled' then now() else null end,
      completed_by_profile_id = case when v.status = 'pending_verification' then null else completed_by_profile_id end,
      completed_at = case when v.status = 'pending_verification' then null else completed_at end
    where id = v.id;
  end if;

  insert into public.work_order_history(
    organization_id, facility_id, work_order_id, event_type, prior_status,
    resulting_status, actor_profile_id, notes, metadata
  ) values (
    v.organization_id, v.facility_id, v.id,
    case when p_target_status = 'pending_verification' then 'submitted_for_verification'
         when v.status = 'pending_verification' then 'reopened' else 'transition' end,
    v.status, p_target_status, auth.uid(), btrim(p_notes),
    jsonb_build_object('actualCost', p_actual_cost, 'downtimeStartedAt', p_downtime_started_at, 'downtimeEndedAt', p_downtime_ended_at)
  );
  return true;
end;
$$;

create or replace function public.verify_work_order(
  p_work_order_id uuid,
  p_decision text,
  p_verification_notes text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.work_orders%rowtype;
  v_verifier_name text;
begin
  select * into v from public.work_orders where id = p_work_order_id for update;
  if not found then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  if v.status <> 'pending_verification' then
    raise exception 'Only work awaiting verification can be reviewed' using errcode = '55000';
  end if;
  if p_decision not in ('verified','reopened') or length(btrim(coalesce(p_verification_notes, ''))) < 3 then
    raise exception 'A valid verification decision and notes are required' using errcode = '22023';
  end if;
  if not (public.is_platform_admin() or (
    v.organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager')
    and public.is_assigned_to_facility(v.facility_id)
  )) then raise exception 'Supervisor verification is required' using errcode = '42501'; end if;

  if p_decision = 'verified' then
    update public.work_orders set
      status = 'verified', verified_by_profile_id = auth.uid(), verified_at = now(),
      verification_notes = btrim(p_verification_notes)
    where id = v.id;
    if v.source_inspection_event_id is not null then
      update public.inspection_events set
        follow_up_required = false,
        notes = concat_ws(E'\n', nullif(notes, ''), format('%s repair verified: %s', v.work_order_number, btrim(p_verification_notes)))
      where id = v.source_inspection_event_id;
    end if;
    if v.inspection_item_id is not null then
      select concat_ws(' ', p.first_name, p.last_name) into v_verifier_name
      from public.profiles p where p.id = auth.uid();
      insert into public.inspection_events(
        organization_id, facility_id, inspection_item_id, performed_date,
        performed_by, performed_by_profile_id, result, follow_up_required, notes
      ) values (
        v.organization_id, v.facility_id, v.inspection_item_id, current_date,
        coalesce(nullif(v_verifier_name, ''), 'Maintenance supervisor'), auth.uid(),
        'pass', false, format('%s verified after repair: %s', v.work_order_number, btrim(p_verification_notes))
      );
      update public.inspection_items i set
        last_inspected_date = current_date,
        next_due_date = current_date + i.inspection_interval_days,
        status = 'compliant'
      where i.id = v.inspection_item_id;
    end if;
  else
    update public.work_orders set
      status = 'in_progress', completed_by_profile_id = null, completed_at = null,
      verified_by_profile_id = null, verified_at = null,
      verification_notes = btrim(p_verification_notes)
    where id = v.id;
  end if;
  insert into public.work_order_history(
    organization_id, facility_id, work_order_id, event_type, prior_status,
    resulting_status, actor_profile_id, notes
  ) values (
    v.organization_id, v.facility_id, v.id,
    case when p_decision = 'verified' then 'verified' else 'reopened' end,
    v.status, case when p_decision = 'verified' then 'verified' else 'in_progress' end,
    auth.uid(), btrim(p_verification_notes)
  );
  return true;
end;
$$;

create or replace function public.create_work_order_from_failed_inspection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inspection_items%rowtype;
  v_id uuid;
begin
  if new.result not in ('fail','deficiency_noted') then return new; end if;
  if exists (select 1 from public.work_orders w where w.source_inspection_event_id = new.id) then return new; end if;
  select * into v_item from public.inspection_items where id = new.inspection_item_id;
  insert into public.work_orders(
    organization_id, facility_id, work_order_number, source_inspection_event_id,
    inspection_item_id, location_detail, problem_description, safety_risk,
    priority, target_completion_at, created_by_profile_id
  ) values (
    new.organization_id, new.facility_id, 'pending', new.id, new.inspection_item_id,
    v_item.location_detail,
    format('%s inspection %s: %s', v_item.label, replace(new.result, '_', ' '), coalesce(nullif(new.deficiency_notes, ''), 'Follow-up repair required')),
    case when new.result = 'fail' then 'high' else 'moderate' end,
    case when new.result = 'fail' then 'urgent' else 'routine' end,
    case when new.result = 'fail' then now() + interval '24 hours' else now() + interval '7 days' end,
    coalesce(new.performed_by_profile_id, auth.uid())
  ) returning id into v_id;
  insert into public.work_order_history(
    organization_id, facility_id, work_order_id, event_type, resulting_status,
    actor_profile_id, notes, metadata
  ) values (
    new.organization_id, new.facility_id, v_id, 'created', 'open',
    coalesce(new.performed_by_profile_id, auth.uid()),
    'Automatically generated from failed inspection',
    jsonb_build_object('inspectionEventId', new.id)
  );
  return new;
end;
$$;
create trigger failed_inspection_creates_work_order
  after insert or update of result on public.inspection_events
  for each row execute function public.create_work_order_from_failed_inspection();

create or replace function public.generate_due_preventive_maintenance_work_orders(
  p_as_of date default current_date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.preventive_maintenance_schedules%rowtype;
  v_id uuid;
  v_count integer := 0;
begin
  for v_schedule in
    select s.* from public.preventive_maintenance_schedules s
    where s.is_active and s.next_due_date <= p_as_of
      and (
        coalesce(auth.jwt()->>'role', '') = 'service_role'
        or public.is_platform_admin()
        or (s.organization_id = public.current_org_id()
          and public.current_role() in ('org_admin','facility_manager')
          and public.is_assigned_to_facility(s.facility_id))
      )
    for update
  loop
    if not exists (
      select 1 from public.work_orders w
      where w.preventive_maintenance_schedule_id = v_schedule.id
        and w.status not in ('verified','canceled')
    ) then
      insert into public.work_orders(
        organization_id, facility_id, work_order_number,
        preventive_maintenance_schedule_id, inspection_item_id,
        maintenance_location_id, problem_description, priority,
        assigned_employee_id, external_vendor, target_completion_at,
        parts_needed, estimated_cost, created_by_profile_id
      ) values (
        v_schedule.organization_id, v_schedule.facility_id, 'pending', v_schedule.id,
        v_schedule.inspection_item_id, v_schedule.maintenance_location_id,
        v_schedule.description, v_schedule.default_priority,
        v_schedule.assigned_employee_id, v_schedule.external_vendor,
        v_schedule.next_due_date + time '17:00', v_schedule.parts_needed,
        v_schedule.estimated_cost, auth.uid()
      ) returning id into v_id;
      insert into public.work_order_history(
        organization_id, facility_id, work_order_id, event_type,
        resulting_status, actor_profile_id, notes, metadata
      ) values (
        v_schedule.organization_id, v_schedule.facility_id, v_id, 'created',
        'open', auth.uid(), 'Generated from preventive-maintenance schedule',
        jsonb_build_object('scheduleId', v_schedule.id, 'dueDate', v_schedule.next_due_date)
      );
      update public.preventive_maintenance_schedules set
        last_generated_on = p_as_of,
        next_due_date = case frequency_unit
          when 'day' then next_due_date + frequency_interval
          when 'week' then next_due_date + (frequency_interval * 7)
          when 'month' then (next_due_date + make_interval(months => frequency_interval))::date
          else (next_due_date + make_interval(years => frequency_interval))::date
        end
      where id = v_schedule.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.log_maintenance_document_access(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v public.maintenance_documents%rowtype;
begin
  select * into v from public.maintenance_documents where id = p_document_id;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if not (public.is_platform_admin() or (
    v.organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager','trainer','auditor')
    and (public.current_role() in ('org_admin','auditor') or public.is_assigned_to_facility(v.facility_id))
  )) then raise exception 'Not authorized to access this document' using errcode = '42501'; end if;
  insert into public.audit_logs(organization_id, actor_profile_id, entity_type, entity_id, action)
  values(v.organization_id, auth.uid(), 'maintenance_documents', v.id::text, 'document_viewed');
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'maintenance_locations','preventive_maintenance_schedules','work_orders',
    'work_order_history','maintenance_documents'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

create policy maintenance_locations_select on public.maintenance_locations
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = (select public.current_org_id())
    and ((select public.current_role()) in ('org_admin','auditor')
      or ((select public.current_role()) in ('facility_manager','trainer') and public.is_assigned_to_facility(facility_id)))
  )
);
create policy maintenance_locations_write on public.maintenance_locations
for all to authenticated using (
  public.is_platform_admin() or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin','facility_manager')
    and public.is_assigned_to_facility(facility_id)
  )
) with check (
  public.is_platform_admin() or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin','facility_manager')
    and public.is_assigned_to_facility(facility_id)
  )
);

create policy preventive_maintenance_select on public.preventive_maintenance_schedules
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = (select public.current_org_id())
    and ((select public.current_role()) in ('org_admin','auditor')
      or ((select public.current_role()) in ('facility_manager','trainer') and public.is_assigned_to_facility(facility_id)))
  )
);
create policy preventive_maintenance_write on public.preventive_maintenance_schedules
for all to authenticated using (
  public.is_platform_admin() or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin','facility_manager')
    and public.is_assigned_to_facility(facility_id)
  )
) with check (
  public.is_platform_admin() or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin','facility_manager')
    and public.is_assigned_to_facility(facility_id)
  )
);

create policy work_orders_select on public.work_orders
for select to authenticated using (
  public.is_platform_admin()
  or exists (
    select 1 from public.employees e
    where e.id = work_orders.assigned_employee_id and e.profile_id = (select auth.uid())
  )
  or (
    organization_id = (select public.current_org_id())
    and ((select public.current_role()) in ('org_admin','auditor')
      or ((select public.current_role()) in ('facility_manager','trainer') and public.is_assigned_to_facility(facility_id)))
  )
);
create policy work_order_history_select on public.work_order_history
for select to authenticated using (
  exists (select 1 from public.work_orders w where w.id = work_order_history.work_order_id)
);
create policy maintenance_documents_select on public.maintenance_documents
for select to authenticated using (
  public.is_platform_admin() or (
    organization_id = (select public.current_org_id())
    and ((select public.current_role()) in ('org_admin','auditor')
      or ((select public.current_role()) in ('facility_manager','trainer') and public.is_assigned_to_facility(facility_id)))
  )
);
create policy maintenance_documents_insert on public.maintenance_documents
for insert to authenticated with check (
  public.is_platform_admin() or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin','facility_manager','trainer')
    and public.is_assigned_to_facility(facility_id)
  )
);
create policy maintenance_documents_delete on public.maintenance_documents
for delete to authenticated using (
  public.is_platform_admin() or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin','facility_manager')
    and public.is_assigned_to_facility(facility_id)
  )
);

do $$
declare t text;
begin
  foreach t in array array[
    'maintenance_locations','preventive_maintenance_schedules','work_orders',
    'work_order_history','maintenance_documents'
  ] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end
$$;
grant select, insert, update, delete on public.maintenance_locations to authenticated;
grant select, insert, update, delete on public.preventive_maintenance_schedules to authenticated;
grant select on public.work_orders, public.work_order_history to authenticated;
grant select, insert, delete on public.maintenance_documents to authenticated;
grant usage, select on sequence public.work_order_number_seq to service_role;
grant usage, select on sequence public.work_order_history_id_seq to service_role;

revoke execute on function public.stamp_maintenance_scope() from public, anon, authenticated;
revoke execute on function public.prevent_work_order_history_mutation() from public, anon, authenticated;
revoke execute on function public.create_work_order_from_failed_inspection() from public, anon, authenticated;
revoke execute on function public.create_work_order(uuid,text,uuid,uuid,text,text,text,text,text,uuid,text,timestamptz,text,numeric,text) from public, anon;
revoke execute on function public.update_work_order_details(uuid,text,text,text,text,text,uuid,text,timestamptz,text,numeric,text) from public, anon;
revoke execute on function public.transition_work_order(uuid,text,text,numeric,timestamptz,timestamptz) from public, anon;
revoke execute on function public.verify_work_order(uuid,text,text) from public, anon;
revoke execute on function public.generate_due_preventive_maintenance_work_orders(date) from public, anon;
revoke execute on function public.log_maintenance_document_access(uuid) from public, anon;
grant execute on function public.create_work_order(uuid,text,uuid,uuid,text,text,text,text,text,uuid,text,timestamptz,text,numeric,text) to authenticated;
grant execute on function public.update_work_order_details(uuid,text,text,text,text,text,uuid,text,timestamptz,text,numeric,text) to authenticated;
grant execute on function public.transition_work_order(uuid,text,text,numeric,timestamptz,timestamptz) to authenticated;
grant execute on function public.verify_work_order(uuid,text,text) to authenticated;
grant execute on function public.generate_due_preventive_maintenance_work_orders(date) to authenticated, service_role;
grant execute on function public.log_maintenance_document_access(uuid) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'maintenance-documents', 'maintenance-documents', false, 20971520,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "maintenance-documents read" on storage.objects
for select to authenticated using (
  bucket_id = 'maintenance-documents'
  and (
    public.is_platform_admin()
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (
        (select public.current_role()) in ('org_admin','auditor')
        or (
          (select public.current_role()) in ('facility_manager','trainer')
          and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
        )
      )
    )
  )
);
create policy "maintenance-documents insert" on storage.objects
for insert to authenticated with check (
  bucket_id = 'maintenance-documents'
  and (
    public.is_platform_admin()
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (select public.current_role()) in ('org_admin','facility_manager','trainer')
      and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
    )
  )
);
create policy "maintenance-documents delete" on storage.objects
for delete to authenticated using (
  bucket_id = 'maintenance-documents'
  and (
    public.is_platform_admin()
    or (
      (storage.foldername(name))[1] = (select public.current_org_id())::text
      and (select public.current_role()) in ('org_admin','facility_manager')
      and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
    )
  )
);
