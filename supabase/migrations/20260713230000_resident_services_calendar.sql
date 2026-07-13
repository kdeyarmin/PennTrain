-- Priority 14: one resident-services calendar for appointments, transportation,
-- activities, family/community services, return instructions, and follow-up work.

alter table public.work_item_templates drop constraint work_item_templates_source_type_check;
alter table public.work_item_templates add constraint work_item_templates_source_type_check
  check (source_type in (
    'violation', 'inspection', 'incident', 'near_miss', 'training_gap',
    'exclusion_match', 'credential', 'policy', 'rule_exception', 'move_in',
    'complaint', 'support_plan', 'qapi', 'change_of_condition',
    'dietary_exception', 'food_safety', 'resident_calendar'
  ));

insert into public.work_item_templates(
  template_key, name, source_type, default_priority, due_interval,
  approval_required, escalation_after, default_owner_role
) values (
  'resident_calendar.followup', 'Resident appointment follow-up',
  'resident_calendar', 'high', interval '3 days', false,
  interval '1 day', 'facility_manager'
) on conflict (organization_id, template_key) do nothing;

create table public.facility_transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  label text not null check (length(btrim(label)) >= 2),
  vehicle_type text not null check (vehicle_type in (
    'car', 'van', 'wheelchair_van', 'bus', 'other'
  )),
  license_plate text,
  capacity integer not null default 1 check (capacity between 1 and 100),
  wheelchair_accessible boolean not null default false,
  status text not null default 'available' check (status in (
    'available', 'maintenance', 'out_of_service', 'retired'
  )),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, label),
  unique (facility_id, license_plate)
);
create index facility_transport_vehicles_scope_idx
  on public.facility_transport_vehicles(organization_id, facility_id, status);

create table public.resident_service_calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete cascade,
  event_type text not null check (event_type in (
    'medical_appointment', 'dental_appointment', 'behavioral_health_appointment',
    'laboratory_visit', 'therapy', 'community_service', 'family_visit',
    'transportation', 'facility_activity', 'outside_activity'
  )),
  title text not null check (length(btrim(title)) >= 3),
  provider_name text,
  provider_contact text,
  location_name text,
  location_address text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in (
    'scheduled', 'completed', 'canceled', 'no_show'
  )),
  transportation_mode text not null default 'none' check (transportation_mode in (
    'none', 'facility_vehicle', 'family', 'vendor', 'public_transit',
    'rideshare', 'walking', 'other'
  )),
  vehicle_id uuid references public.facility_transport_vehicles(id) on delete set null,
  transportation_vendor text,
  required_records text[] not null default array[]::text[],
  preparation_instructions text,
  outcome_reason text,
  return_instructions text,
  resolved_at timestamptz,
  next_appointment_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((transportation_mode = 'facility_vehicle') = (vehicle_id is not null)),
  check ((status = 'scheduled') = (resolved_at is null)),
  check (next_appointment_at is null or next_appointment_at > starts_at)
);
create index resident_service_calendar_events_range_idx
  on public.resident_service_calendar_events(facility_id, starts_at, ends_at);
create index resident_service_calendar_events_resident_idx
  on public.resident_service_calendar_events(resident_id, starts_at desc);
create index resident_service_calendar_events_status_idx
  on public.resident_service_calendar_events(facility_id, status, starts_at);

create table public.resident_service_calendar_event_staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  event_id uuid not null references public.resident_service_calendar_events(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete restrict,
  external_staff_name text,
  assignment_role text not null check (assignment_role in ('driver', 'accompanying_staff')),
  instructions text,
  created_at timestamptz not null default now(),
  check ((employee_id is not null)::integer + (nullif(btrim(external_staff_name), '') is not null)::integer = 1),
  unique nulls not distinct (event_id, employee_id, external_staff_name, assignment_role)
);
create unique index resident_service_calendar_one_driver_idx
  on public.resident_service_calendar_event_staff(event_id)
  where assignment_role = 'driver';
create index resident_service_calendar_event_staff_employee_idx
  on public.resident_service_calendar_event_staff(employee_id, event_id);

create table public.resident_service_calendar_follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  event_id uuid not null references public.resident_service_calendar_events(id) on delete cascade,
  resident_id uuid not null references public.residents(id) on delete cascade,
  title text not null check (length(btrim(title)) >= 3),
  description text not null check (length(btrim(description)) >= 5),
  owner_profile_id uuid references public.profiles(id),
  due_at timestamptz not null,
  work_item_id uuid unique references public.work_items(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index resident_service_calendar_follow_ups_event_idx
  on public.resident_service_calendar_follow_ups(event_id, due_at);

create table public.resident_service_calendar_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  event_id uuid not null references public.resident_service_calendar_events(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  event_type text not null,
  prior_status text,
  resulting_status text,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  actor_profile_id uuid references public.profiles(id),
  occurred_at timestamptz not null default now()
);
create index resident_service_calendar_history_event_idx
  on public.resident_service_calendar_history(event_id, occurred_at desc);

create trigger facility_transport_vehicles_updated_at before update on public.facility_transport_vehicles
for each row execute function public.set_updated_at();
create trigger resident_service_calendar_events_updated_at before update on public.resident_service_calendar_events
for each row execute function public.set_updated_at();
create trigger protect_resident_service_calendar_history before update or delete on public.resident_service_calendar_history
for each row execute function app_private.prevent_phase5_evidence_mutation();

create or replace function app_private.calendar_event_visible(
  p_org uuid, p_fac uuid, p_event uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.admission_row_visible(p_org, p_fac)
    or (
      p_org = public.current_org_id()
      and public.current_role() = 'employee'
      and exists (
        select 1
        from public.resident_service_calendar_event_staff staff
        join public.employees employee on employee.id = staff.employee_id
        where staff.event_id = p_event and employee.profile_id = auth.uid()
      )
    )
$$;
revoke all on function app_private.calendar_event_visible(uuid,uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function app_private.calendar_event_visible(uuid,uuid,uuid) to authenticated;

create or replace function app_private.assert_calendar_contributor(p_event uuid)
returns public.resident_service_calendar_events language plpgsql stable security definer set search_path = '' as $$
declare v public.resident_service_calendar_events%rowtype;
begin
  select * into v from public.resident_service_calendar_events where id = p_event;
  if not found then raise exception 'Resident calendar event not found' using errcode = 'P0002'; end if;
  if coalesce(auth.jwt()->>'role', '') = 'service_role' or public.is_platform_admin() then return v; end if;
  if auth.uid() is null or v.organization_id <> public.current_org_id()
    or (
      not (public.current_role() in ('org_admin','facility_manager')
        and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(v.facility_id)))
      and not (public.current_role() = 'employee' and exists (
        select 1 from public.resident_service_calendar_event_staff staff
        join public.employees employee on employee.id = staff.employee_id
        where staff.event_id = v.id and employee.profile_id = auth.uid()
      ))
    ) then
    raise exception 'Resident calendar operation is outside caller scope' using errcode = '42501';
  end if;
  return v;
end
$$;
revoke all on function app_private.assert_calendar_contributor(uuid)
from public, anon, authenticated, service_role;

create or replace function public.upsert_facility_transport_vehicle(
  p_facility_id uuid, p_vehicle_id uuid, p_label text, p_vehicle_type text,
  p_license_plate text, p_capacity integer, p_wheelchair_accessible boolean,
  p_status text, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_fac public.facilities%rowtype; v_id uuid;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_fac.organization_id, v_fac.id);
  if length(btrim(coalesce(p_label, ''))) < 2
    or p_vehicle_type not in ('car','van','wheelchair_van','bus','other')
    or p_capacity not between 1 and 100
    or p_status not in ('available','maintenance','out_of_service','retired') then
    raise exception 'Vehicle record is invalid' using errcode = '22023';
  end if;
  insert into public.facility_transport_vehicles(
    id, organization_id, facility_id, label, vehicle_type, license_plate,
    capacity, wheelchair_accessible, status, notes, created_by
  ) values (
    coalesce(p_vehicle_id, gen_random_uuid()), v_fac.organization_id, v_fac.id,
    btrim(p_label), p_vehicle_type, nullif(btrim(p_license_plate), ''),
    p_capacity, coalesce(p_wheelchair_accessible, false), p_status,
    nullif(btrim(p_notes), ''), auth.uid()
  ) on conflict (id) do update set
    label = excluded.label, vehicle_type = excluded.vehicle_type,
    license_plate = excluded.license_plate, capacity = excluded.capacity,
    wheelchair_accessible = excluded.wheelchair_accessible,
    status = excluded.status, notes = excluded.notes, updated_at = now()
  where public.facility_transport_vehicles.facility_id = v_fac.id
  returning id into v_id;
  if v_id is null then raise exception 'Vehicle not found' using errcode = 'P0002'; end if;
  return v_id;
end
$$;

create or replace function public.create_resident_service_calendar_event(
  p_resident_id uuid, p_event jsonb, p_staff jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_resident public.residents%rowtype;
  v_vehicle public.facility_transport_vehicles%rowtype;
  v_id uuid;
  v_starts timestamptz;
  v_ends timestamptz;
  v_staff jsonb;
  v_employee public.employees%rowtype;
  v_employee_id uuid;
  v_external text;
  v_role text;
  v_records text[];
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_resident.organization_id, v_resident.facility_id);
  if jsonb_typeof(coalesce(p_event, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_staff, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_staff, '[]'::jsonb)) > 20 then
    raise exception 'Calendar event payload is invalid' using errcode = '22023';
  end if;
  begin
    v_starts := (p_event->>'startsAt')::timestamptz;
    v_ends := (p_event->>'endsAt')::timestamptz;
  exception when others then
    raise exception 'Calendar event dates are invalid' using errcode = '22007';
  end;
  if p_event->>'eventType' not in (
      'medical_appointment','dental_appointment','behavioral_health_appointment',
      'laboratory_visit','therapy','community_service','family_visit',
      'transportation','facility_activity','outside_activity'
    ) or length(btrim(coalesce(p_event->>'title', ''))) < 3
    or v_starts is null or v_ends <= v_starts
    or p_event->>'transportationMode' not in (
      'none','facility_vehicle','family','vendor','public_transit','rideshare','walking','other'
    ) then raise exception 'Calendar event is invalid' using errcode = '22023';
  end if;
  if nullif(p_event->>'vehicleId', '') is not null then
    if p_event->>'transportationMode' <> 'facility_vehicle' then
      raise exception 'Facility transportation requires transportationMode=facility_vehicle' using errcode = '22023';
    end if;
    select * into v_vehicle from public.facility_transport_vehicles
    where id = (p_event->>'vehicleId')::uuid and facility_id = v_resident.facility_id and status = 'available';
    if exists (
      select 1 from public.resident_service_calendar_events existing
      where existing.vehicle_id = v_vehicle.id and existing.status = 'scheduled'
        and tstzrange(existing.starts_at, existing.ends_at, '[)') && tstzrange(v_starts, v_ends, '[)')
    ) then raise exception 'Vehicle is already assigned during this time' using errcode = '23P01'; end if;
  elsif p_event->>'transportationMode' = 'facility_vehicle' then
    raise exception 'Facility transportation requires a vehicle' using errcode = '22023';
  end if;
  v_records := array(
    select distinct btrim(value)
    from jsonb_array_elements_text(coalesce(p_event->'requiredRecords', '[]'::jsonb))
    where btrim(value) <> '' order by btrim(value)
  );
  insert into public.resident_service_calendar_events(
    organization_id, facility_id, resident_id, event_type, title,
    provider_name, provider_contact, location_name, location_address,
    starts_at, ends_at, transportation_mode, vehicle_id,
    transportation_vendor, required_records, preparation_instructions,
    notes, created_by
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    p_event->>'eventType', btrim(p_event->>'title'),
    nullif(btrim(p_event->>'providerName'), ''), nullif(btrim(p_event->>'providerContact'), ''),
    nullif(btrim(p_event->>'locationName'), ''), nullif(btrim(p_event->>'locationAddress'), ''),
    v_starts, v_ends, p_event->>'transportationMode', v_vehicle.id,
    nullif(btrim(p_event->>'transportationVendor'), ''), v_records,
    nullif(btrim(p_event->>'preparationInstructions'), ''),
    nullif(btrim(p_event->>'notes'), ''), auth.uid()
  ) returning id into v_id;
  for v_staff in select value from jsonb_array_elements(coalesce(p_staff, '[]'::jsonb)) loop
    v_employee_id := nullif(v_staff->>'employeeId', '')::uuid;
    v_external := nullif(btrim(v_staff->>'externalName'), '');
    v_role := v_staff->>'role';
    if v_role not in ('driver','accompanying_staff')
      or ((v_employee_id is not null)::integer + (v_external is not null)::integer <> 1) then
      raise exception 'Calendar staff assignment is invalid' using errcode = '22023';
    end if;
    if v_employee_id is not null then
      select * into v_employee from public.employees
      where id = v_employee_id and organization_id = v_resident.organization_id and status = 'active';
      if not found or not exists (
        select 1 from public.employee_facility_assignments assignment
        where assignment.employee_id = v_employee.id and assignment.facility_id = v_resident.facility_id
      ) then raise exception 'Assigned employee is outside facility scope' using errcode = '42501'; end if;
      perform pg_advisory_xact_lock(hashtext('resident_calendar_employee'), hashtext(v_employee.id::text));
      if exists (
        select 1 from public.resident_service_calendar_event_staff assigned
        join public.resident_service_calendar_events existing on existing.id = assigned.event_id
        where assigned.employee_id = v_employee.id and existing.status = 'scheduled'
          and tstzrange(existing.starts_at, existing.ends_at, '[)') && tstzrange(v_starts, v_ends, '[)')
      ) then raise exception 'Employee is already assigned during this time' using errcode = '23P01'; end if;
    end if;
    insert into public.resident_service_calendar_event_staff(
      organization_id, facility_id, event_id, employee_id,
      external_staff_name, assignment_role, instructions
    ) values (
      v_resident.organization_id, v_resident.facility_id, v_id,
      v_employee_id, v_external, v_role, nullif(btrim(v_staff->>'instructions'), '')
    );
  end loop;
  insert into public.resident_service_calendar_history(
    organization_id, facility_id, event_id, resident_id, event_type,
    resulting_status, reason, evidence, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_id, v_resident.id,
    'created', 'scheduled', 'Resident service calendar event created',
    jsonb_build_object('eventType', p_event->>'eventType', 'startsAt', v_starts,
      'staffCount', jsonb_array_length(coalesce(p_staff, '[]'::jsonb))), auth.uid()
  );
  return v_id;
end
$$;

create or replace function public.reschedule_resident_service_calendar_event(
  p_event_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_reason text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.resident_service_calendar_events%rowtype;
begin
  select * into v from public.resident_service_calendar_events where id = p_event_id for update;
  if not found then raise exception 'Calendar event not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if v.status <> 'scheduled' or p_starts_at is null or p_ends_at <= p_starts_at
    or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Calendar reschedule is invalid' using errcode = '22023';
  end if;
  if v.vehicle_id is not null and exists (
    select 1 from public.resident_service_calendar_events existing
    where existing.id <> v.id and existing.vehicle_id = v.vehicle_id and existing.status = 'scheduled'
      and tstzrange(existing.starts_at, existing.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then raise exception 'Vehicle is already assigned during this time' using errcode = '23P01'; end if;
  if exists (
    select 1 from public.resident_service_calendar_event_staff staff
    join public.resident_service_calendar_event_staff assigned on assigned.employee_id = staff.employee_id
    join public.resident_service_calendar_events existing on existing.id = assigned.event_id
    where staff.event_id = v.id and staff.employee_id is not null
      and existing.id <> v.id and existing.status = 'scheduled'
      and tstzrange(existing.starts_at, existing.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then raise exception 'Assigned staff conflict with the new time' using errcode = '23P01'; end if;
  update public.resident_service_calendar_events set starts_at = p_starts_at,
    ends_at = p_ends_at, updated_at = now() where id = v.id;
  insert into public.resident_service_calendar_history(
    organization_id, facility_id, event_id, resident_id, event_type,
    prior_status, resulting_status, reason, evidence, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v.id, v.resident_id, 'rescheduled',
    v.status, v.status, btrim(p_reason),
    jsonb_build_object('priorStartsAt', v.starts_at, 'priorEndsAt', v.ends_at,
      'startsAt', p_starts_at, 'endsAt', p_ends_at), auth.uid()
  );
  return true;
end
$$;

create or replace function public.record_resident_service_calendar_outcome(
  p_event_id uuid, p_status text, p_resolved_at timestamptz,
  p_reason text, p_return_instructions text, p_follow_ups jsonb,
  p_next_appointment_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.resident_service_calendar_events%rowtype;
  v_follow jsonb;
  v_follow_id uuid;
  v_work_id uuid;
  v_template_id uuid;
  v_owner uuid;
  v_due timestamptz;
begin
  v := app_private.assert_calendar_contributor(p_event_id);
  select * into v from public.resident_service_calendar_events where id = v.id for update;
  if v.status <> 'scheduled' or p_status not in ('completed','canceled','no_show')
    or p_resolved_at is null or p_resolved_at > now() + interval '1 hour'
    or jsonb_typeof(coalesce(p_follow_ups, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_follow_ups, '[]'::jsonb)) > 20
    or (p_status in ('canceled','no_show') and length(btrim(coalesce(p_reason, ''))) < 5)
    or (p_next_appointment_at is not null and p_next_appointment_at <= v.starts_at) then
    raise exception 'Calendar outcome is invalid' using errcode = '22023';
  end if;
  update public.resident_service_calendar_events set
    status = p_status, outcome_reason = nullif(btrim(p_reason), ''),
    return_instructions = nullif(btrim(p_return_instructions), ''),
    resolved_at = p_resolved_at, next_appointment_at = p_next_appointment_at,
    resolved_by = auth.uid(), updated_at = now()
  where id = v.id;
  select id into v_template_id from public.work_item_templates
  where (organization_id = v.organization_id or organization_id is null)
    and template_key = 'resident_calendar.followup' and is_active
  order by organization_id nulls last limit 1;
  for v_follow in select value from jsonb_array_elements(coalesce(p_follow_ups, '[]'::jsonb)) loop
    begin
      v_due := (v_follow->>'dueAt')::timestamptz;
      v_owner := nullif(v_follow->>'ownerProfileId', '')::uuid;
    exception when others then
      raise exception 'Follow-up assignment is invalid' using errcode = '22007';
    end;
    if length(btrim(coalesce(v_follow->>'title', ''))) < 3
      or length(btrim(coalesce(v_follow->>'description', ''))) < 5
      or v_due is null
      or (v_owner is not null and not exists (
        select 1 from public.profiles profile where profile.id = v_owner
          and profile.organization_id = v.organization_id and profile.is_active
      )) then raise exception 'Follow-up task is invalid' using errcode = '22023'; end if;
    insert into public.resident_service_calendar_follow_ups(
      organization_id, facility_id, event_id, resident_id, title,
      description, owner_profile_id, due_at, created_by
    ) values (
      v.organization_id, v.facility_id, v.id, v.resident_id,
      btrim(v_follow->>'title'), btrim(v_follow->>'description'),
      v_owner, v_due, auth.uid()
    ) returning id into v_follow_id;
    insert into public.work_items(
      organization_id, facility_id, template_id, source_type, source_id,
      deduplication_key, title, description, owner_profile_id,
      priority, due_at, created_by
    ) values (
      v.organization_id, v.facility_id, v_template_id, 'resident_calendar', v_follow_id,
      'resident-calendar-followup:' || v_follow_id,
      btrim(v_follow->>'title'), btrim(v_follow->>'description'), v_owner,
      coalesce(nullif(v_follow->>'priority', ''), 'high'), v_due, auth.uid()
    ) returning id into v_work_id;
    update public.resident_service_calendar_follow_ups set work_item_id = v_work_id where id = v_follow_id;
    insert into public.work_item_history(
      organization_id, facility_id, work_item_id, event_type,
      resulting_state, actor_profile_id, reason
    ) values (
      v.organization_id, v.facility_id, v_work_id, 'created', 'open',
      auth.uid(), 'Resident calendar return instructions created follow-up work'
    );
  end loop;
  insert into public.resident_service_calendar_history(
    organization_id, facility_id, event_id, resident_id, event_type,
    prior_status, resulting_status, reason, evidence, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v.id, v.resident_id, 'outcome_recorded',
    v.status, p_status, coalesce(nullif(btrim(p_reason), ''), 'Event outcome recorded'),
    jsonb_build_object('resolvedAt', p_resolved_at,
      'followUpCount', jsonb_array_length(coalesce(p_follow_ups, '[]'::jsonb)),
      'nextAppointmentAt', p_next_appointment_at), auth.uid()
  );
  return v.id;
end
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'facility_transport_vehicles', 'resident_service_calendar_events',
    'resident_service_calendar_event_staff', 'resident_service_calendar_follow_ups',
    'resident_service_calendar_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end
$$;

create policy facility_transport_vehicles_select on public.facility_transport_vehicles
for select to authenticated using (
  app_private.admission_row_visible(organization_id, facility_id)
  or (organization_id = public.current_org_id()
    and public.current_role() = 'employee'
    and public.is_own_employee_assigned_to_facility(facility_id))
);
create policy resident_service_calendar_events_select on public.resident_service_calendar_events
for select to authenticated using (
  app_private.calendar_event_visible(organization_id, facility_id, id)
);
create policy resident_service_calendar_event_staff_select on public.resident_service_calendar_event_staff
for select to authenticated using (
  app_private.calendar_event_visible(organization_id, facility_id, event_id)
);
create policy resident_service_calendar_follow_ups_select on public.resident_service_calendar_follow_ups
for select to authenticated using (
  app_private.calendar_event_visible(organization_id, facility_id, event_id)
);
create policy resident_service_calendar_history_select on public.resident_service_calendar_history
for select to authenticated using (
  app_private.calendar_event_visible(organization_id, facility_id, event_id)
);

revoke all on function public.upsert_facility_transport_vehicle(uuid,uuid,text,text,text,integer,boolean,text,text),
  public.create_resident_service_calendar_event(uuid,jsonb,jsonb),
  public.reschedule_resident_service_calendar_event(uuid,timestamptz,timestamptz,text),
  public.record_resident_service_calendar_outcome(uuid,text,timestamptz,text,text,jsonb,timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.upsert_facility_transport_vehicle(uuid,uuid,text,text,text,integer,boolean,text,text),
  public.create_resident_service_calendar_event(uuid,jsonb,jsonb),
  public.reschedule_resident_service_calendar_event(uuid,timestamptz,timestamptz,text),
  public.record_resident_service_calendar_outcome(uuid,text,timestamptz,text,text,jsonb,timestamptz)
to authenticated;

-- Replace the placeholder appointment signal in QAPI with authoritative calendar outcomes.
create or replace function public.get_qapi_source_metrics(p_facility_id uuid, p_from date, p_through date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_fac public.facilities%rowtype; v_complaints jsonb;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found or not app_private.admission_row_visible(v_fac.organization_id, v_fac.id) then
    raise exception 'QAPI metrics outside scope' using errcode = '42501';
  end if;
  if p_from is null or p_through is null or p_from > p_through then
    raise exception 'QAPI metric period is invalid' using errcode = '22023';
  end if;
  v_complaints := public.get_complaint_trends(v_fac.id, p_from, p_through);
  return jsonb_build_object(
    'falls', (select count(*) from public.resident_change_events where facility_id=v_fac.id and category='fall' and identified_at::date between p_from and p_through),
    'medicationIncidents', (select count(*) from public.incidents where facility_id=v_fac.id and incident_type='medication_error' and occurred_at::date between p_from and p_through),
    'hospitalTransfers', (select count(*) from public.resident_change_events where facility_id=v_fac.id and (category in('emergency_department_visit','hospital_return') or emergency_transfer) and identified_at::date between p_from and p_through),
    'missedServices', (select count(*) from public.resident_service_task_instances where facility_id=v_fac.id and status='not_completed' and scheduled_start::date between p_from and p_through),
    'lateServices', (select count(*) from public.resident_service_task_instances where facility_id=v_fac.id and status='completed_late' and scheduled_start::date between p_from and p_through),
    'lateAssessments', (select count(*) from public.resident_compliance_items where facility_id=v_fac.id and status='expired' and item_type in('initial_assessment_15day','annual_reassessment','significant_change_reassessment','support_plan_30day')),
    'trainingGaps', (select count(*) from public.employee_training_records where facility_id=v_fac.id and status in('missing','expired')),
    'citationRecurrence', (select count(*) from (select citation_topic_id from public.dhs_violations where facility_id=v_fac.id and inspection_date between p_from and p_through group by citation_topic_id having count(*)>1)x),
    'inspectionDeficiencies', (select count(*) from public.inspection_events where facility_id=v_fac.id and result in('fail','deficiency_noted') and performed_date between p_from and p_through),
    'nutritionExceptions', ((select count(*) from public.resident_meal_records where facility_id=v_fac.id and exception_type is not null and served_at::date between p_from and p_through) + (select count(*) from public.resident_hydration_rounds where facility_id=v_fac.id and exception_recorded and scheduled_at::date between p_from and p_through) + (select count(*) from public.resident_weight_readings where facility_id=v_fac.id and review_required and measured_at::date between p_from and p_through)),
    'mealRefusals', (select count(*) from public.resident_meal_records where facility_id=v_fac.id and exception_type='meal_refusal' and served_at::date between p_from and p_through),
    'hydrationExceptions', (select count(*) from public.resident_hydration_rounds where facility_id=v_fac.id and exception_recorded and scheduled_at::date between p_from and p_through),
    'weightReviews', (select count(*) from public.resident_weight_readings where facility_id=v_fac.id and review_required and measured_at::date between p_from and p_through),
    'foodSafetyExceptions', (select count(*) from public.food_safety_logs where facility_id=v_fac.id and result='exception' and observed_at::date between p_from and p_through),
    'openNutritionReferrals', (select count(*) from public.nutrition_risk_reviews where facility_id=v_fac.id and referral_status in('pending','scheduled')),
    'currentInactiveStaff', (select count(*) from public.employees where facility_id=v_fac.id and status<>'active'),
    'complaints', (v_complaints->>'total')::integer,
    'highRiskComplaints', (v_complaints->>'highRisk')::integer,
    'residentRightsComplaints', (v_complaints->>'residentRights')::integer,
    'appointmentFailures', (select count(*) from public.resident_service_calendar_events where facility_id=v_fac.id and event_type in('medical_appointment','dental_appointment','behavioral_health_appointment','laboratory_visit','therapy') and status in('canceled','no_show') and starts_at::date between p_from and p_through),
    'periodStart', p_from, 'periodEnd', p_through
  );
end
$$;
revoke all on function public.get_qapi_source_metrics(uuid,date,date)
from public, anon, authenticated, service_role;
grant execute on function public.get_qapi_source_metrics(uuid,date,date) to authenticated;

-- Surface upcoming calendar obligations through the resident administrative packet.
alter function public.get_resident_administrative_packet(uuid)
  rename to get_resident_administrative_packet_before_calendar;
revoke all on function public.get_resident_administrative_packet_before_calendar(uuid)
from public, anon, authenticated, service_role;

create or replace function public.get_resident_administrative_packet(p_resident_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_packet jsonb;
begin
  v_packet := public.get_resident_administrative_packet_before_calendar(p_resident_id);
  return v_packet || jsonb_build_object(
    'upcomingResidentServices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id, 'eventType', event.event_type, 'title', event.title,
        'provider', event.provider_name, 'startsAt', event.starts_at,
        'endsAt', event.ends_at, 'transportationMode', event.transportation_mode,
        'requiredRecords', event.required_records,
        'preparationInstructions', event.preparation_instructions
      ) order by event.starts_at)
      from public.resident_service_calendar_events event
      where event.resident_id = p_resident_id and event.status = 'scheduled'
        and event.ends_at >= now() and event.starts_at < now() + interval '90 days'
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function public.get_resident_administrative_packet(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_resident_administrative_packet(uuid) to authenticated;
