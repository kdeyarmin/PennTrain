-- Priority 10: emergency-operations management for drills, actual emergencies,
-- extended outages, accountability, communication, and after-action follow-through.

alter table public.work_item_templates drop constraint work_item_templates_source_type_check;
alter table public.work_item_templates add constraint work_item_templates_source_type_check
  check (source_type in (
    'violation', 'inspection', 'incident', 'near_miss', 'training_gap',
    'exclusion_match', 'credential', 'policy', 'rule_exception', 'move_in',
    'complaint', 'support_plan', 'qapi', 'change_of_condition', 'emergency'
  ));

insert into public.work_item_templates (
  template_key, name, source_type, default_priority, due_interval,
  required_evidence_types, approval_required, escalation_after, default_owner_role
) values (
  'emergency.after_action', 'Emergency after-action corrective action', 'emergency',
  'high', interval '7 days', array[]::text[], true, interval '1 day', 'facility_manager'
)
on conflict (organization_id, template_key) do nothing;

create table public.emergency_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  title text not null,
  current_version_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id)
);

create table public.emergency_plan_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  plan_id uuid not null references public.emergency_plans(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  effective_date date not null,
  change_summary text not null,
  plan_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(plan_snapshot) = 'object'),
  storage_bucket text,
  storage_path text,
  file_name text,
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (plan_id, version_number),
  check ((storage_path is null) = (file_name is null)),
  check (storage_path is null or storage_bucket = 'emergency-documents')
);

alter table public.emergency_plans
  add constraint emergency_plans_current_version_fkey
  foreign key (current_version_id) references public.emergency_plan_versions(id) on delete restrict;

create table public.emergency_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  emergency_role text not null check (emergency_role in (
    'incident_commander', 'resident_accountability', 'staff_accountability',
    'evacuation_lead', 'transportation_lead', 'communications_lead',
    'medication_continuity', 'utilities_lead', 'logistics', 'other'
  )),
  responsibility text not null,
  is_backup boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, employee_id, emergency_role, is_backup)
);

create table public.resident_evacuation_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  resident_id uuid not null unique references public.residents(id) on delete cascade,
  assistance_level text not null check (assistance_level in (
    'independent', 'cueing', 'one_person', 'two_person', 'full_assistance'
  )),
  mobility_needs text,
  transportation_needs text,
  evacuation_method text,
  required_equipment text,
  communication_needs text,
  preferred_relocation_notes text,
  notes text,
  last_reviewed_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.emergency_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  resource_type text not null check (resource_type in (
    'relocation_site', 'transportation_vendor', 'utility_contact',
    'medication_emar_vendor', 'emergency_service', 'other'
  )),
  name text not null,
  contact_name text,
  phone text,
  email text,
  address text,
  capacity integer check (capacity is null or capacity >= 0),
  contract_reference text,
  availability_notes text,
  is_active boolean not null default true,
  last_verified_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.emergency_inventory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  inventory_type text not null check (inventory_type in (
    'food', 'water', 'generator_fuel', 'medication_continuity',
    'batteries', 'first_aid', 'sanitation', 'other'
  )),
  item_name text not null,
  quantity numeric not null default 0 check (quantity >= 0),
  unit text not null,
  minimum_quantity numeric not null default 0 check (minimum_quantity >= 0),
  expiration_date date,
  status text not null default 'ready' check (status in (
    'ready', 'low', 'expired', 'unavailable'
  )),
  location text,
  notes text,
  checked_at timestamptz not null default now(),
  checked_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.emergency_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  event_number text not null,
  event_mode text not null check (event_mode in ('drill', 'actual')),
  event_type text not null check (event_type in (
    'fire', 'severe_weather', 'power_outage', 'water_outage', 'hvac_outage',
    'evacuation', 'shelter_in_place', 'missing_person', 'infectious_disease',
    'transportation_disruption', 'other'
  )),
  status text not null default 'active' check (status in (
    'active', 'stabilized', 'closed', 'canceled'
  )),
  plan_version_id uuid not null references public.emergency_plan_versions(id) on delete restrict,
  incident_id uuid references public.incidents(id) on delete set null,
  inspection_event_id uuid references public.inspection_events(id) on delete set null,
  incident_commander_profile_id uuid references public.profiles(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  location_description text,
  assembly_point text,
  summary text not null,
  declared_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, event_number),
  check (ended_at is null or ended_at >= started_at),
  check (status not in ('closed', 'canceled') or ended_at is not null)
);

create table public.emergency_event_residents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  emergency_event_id uuid not null references public.emergency_events(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  resident_name_snapshot text not null,
  room_snapshot text,
  assistance_level_snapshot text not null,
  mobility_needs_snapshot text,
  transportation_needs_snapshot text,
  evacuation_method_snapshot text,
  required_equipment_snapshot text,
  accountability_status text not null default 'expected' check (accountability_status in (
    'expected', 'present', 'evacuated', 'relocated', 'sheltering',
    'not_present', 'unaccounted'
  )),
  assigned_employee_id uuid references public.employees(id),
  relocation_site_id uuid references public.emergency_resources(id),
  accounted_at timestamptz,
  accounted_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (emergency_event_id, resident_id)
);

create table public.emergency_event_staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  emergency_event_id uuid not null references public.emergency_events(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  employee_name_snapshot text not null,
  job_title_snapshot text,
  responsibility_snapshot text,
  roster_source text not null check (roster_source in ('scheduled_shift', 'emergency_assignment', 'manual')),
  accountability_status text not null default 'expected' check (accountability_status in (
    'expected', 'present', 'evacuated', 'relocated', 'sheltering',
    'not_present', 'unaccounted'
  )),
  accounted_at timestamptz,
  accounted_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (emergency_event_id, employee_id)
);

create table public.emergency_event_timeline (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  emergency_event_id uuid not null references public.emergency_events(id) on delete restrict,
  event_type text not null check (event_type in (
    'declared', 'accountability', 'evacuation', 'relocation', 'resource',
    'communication', 'status_change', 'observation', 'decision', 'other'
  )),
  occurred_at timestamptz not null default now(),
  description text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.emergency_communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  emergency_event_id uuid not null references public.emergency_events(id) on delete restrict,
  batch_id uuid,
  audience text not null check (audience in (
    'designated_person', 'family', 'staff', 'resident', 'vendor',
    'utility', 'emergency_services', 'other'
  )),
  resident_id uuid references public.residents(id) on delete set null,
  informal_support_id uuid references public.resident_informal_supports(id) on delete set null,
  recipient_name_snapshot text,
  recipient_contact_snapshot text,
  channel text not null check (channel in ('phone', 'sms', 'email', 'in_person', 'radio', 'other')),
  delivery_status text not null check (delivery_status in (
    'queued', 'attempted', 'sent', 'confirmed', 'failed', 'not_required'
  )),
  message text not null,
  occurred_at timestamptz not null default now(),
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.emergency_after_action_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  emergency_event_id uuid not null unique references public.emergency_events(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved')),
  response_summary text not null,
  strengths text,
  gaps_identified text,
  lessons_learned text,
  corrective_action_plan text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'approved' or approved_at is not null)
);

create table public.emergency_event_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  emergency_event_id uuid not null references public.emergency_events(id) on delete restrict,
  work_item_id uuid not null references public.work_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (emergency_event_id, work_item_id)
);

create index emergency_plan_versions_plan_idx on public.emergency_plan_versions(plan_id, version_number desc);
create index emergency_staff_assignments_facility_idx on public.emergency_staff_assignments(facility_id, is_active);
create index resident_evacuation_profiles_facility_idx on public.resident_evacuation_profiles(facility_id);
create index emergency_resources_facility_idx on public.emergency_resources(facility_id, resource_type, is_active);
create index emergency_inventory_facility_idx on public.emergency_inventory_items(facility_id, inventory_type, status);
create index emergency_events_queue_idx on public.emergency_events(organization_id, facility_id, status, started_at desc);
create index emergency_event_residents_status_idx on public.emergency_event_residents(emergency_event_id, accountability_status);
create index emergency_event_staff_status_idx on public.emergency_event_staff(emergency_event_id, accountability_status);
create index emergency_timeline_event_idx on public.emergency_event_timeline(emergency_event_id, occurred_at desc);
create index emergency_communications_event_idx on public.emergency_communications(emergency_event_id, occurred_at desc);

create trigger set_updated_at before update on public.emergency_plans
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.emergency_staff_assignments
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.resident_evacuation_profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.emergency_resources
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.emergency_inventory_items
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.emergency_events
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.emergency_event_residents
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.emergency_event_staff
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.emergency_after_action_reviews
  for each row execute function public.set_updated_at();

create or replace function app_private.stamp_emergency_facility_scope()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.facilities where id = new.facility_id;
  if v_org is null then
    raise exception 'Emergency record facility not found' using errcode = '23503';
  end if;
  new.organization_id := v_org;
  return new;
end;
$$;
revoke all on function app_private.stamp_emergency_facility_scope() from public, anon, authenticated, service_role;

create or replace function app_private.validate_emergency_staff_assignment()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.facilities where id = new.facility_id;
  if v_org is null or not exists (
    select 1 from public.employees e
    where e.id = new.employee_id and e.organization_id = v_org
      and (
        e.facility_id = new.facility_id
        or exists (
          select 1 from public.employee_facility_assignments efa
          where efa.employee_id = e.id and efa.facility_id = new.facility_id
        )
      )
  ) then
    raise exception 'Emergency staff assignment crosses facility scope' using errcode = '42501';
  end if;
  new.organization_id := v_org;
  return new;
end;
$$;
revoke all on function app_private.validate_emergency_staff_assignment() from public, anon, authenticated, service_role;

create trigger stamp_scope before insert or update on public.emergency_resources
  for each row execute function app_private.stamp_emergency_facility_scope();
create trigger stamp_scope before insert or update on public.emergency_inventory_items
  for each row execute function app_private.stamp_emergency_facility_scope();
create trigger validate_scope before insert or update on public.emergency_staff_assignments
  for each row execute function app_private.validate_emergency_staff_assignment();

do $$
declare t text;
begin
  foreach t in array array[
    'emergency_plans', 'emergency_plan_versions', 'emergency_staff_assignments',
    'resident_evacuation_profiles', 'emergency_resources', 'emergency_inventory_items',
    'emergency_events', 'emergency_event_residents', 'emergency_event_staff',
    'emergency_event_timeline', 'emergency_communications',
    'emergency_after_action_reviews', 'emergency_event_actions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'emergency_plans', 'emergency_plan_versions', 'emergency_staff_assignments',
    'resident_evacuation_profiles', 'emergency_resources', 'emergency_inventory_items',
    'emergency_events', 'emergency_event_residents', 'emergency_event_staff',
    'emergency_event_timeline', 'emergency_communications',
    'emergency_after_action_reviews', 'emergency_event_actions'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id))',
      t || '_select', t
    );
  end loop;
end;
$$;

grant insert, update, delete on public.emergency_staff_assignments,
  public.emergency_resources, public.emergency_inventory_items to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'emergency_staff_assignments', 'emergency_resources', 'emergency_inventory_items'
  ] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
        public.is_platform_admin() or (
          organization_id = (select public.current_org_id())
          and (select public.current_role()) in (''org_admin'', ''facility_manager'')
          and public.is_assigned_to_facility(facility_id)
        )
      )', t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (
        public.is_platform_admin() or (
          organization_id = (select public.current_org_id())
          and (select public.current_role()) in (''org_admin'', ''facility_manager'')
          and public.is_assigned_to_facility(facility_id)
        )
      ) with check (
        public.is_platform_admin() or (
          organization_id = (select public.current_org_id())
          and (select public.current_role()) in (''org_admin'', ''facility_manager'')
          and public.is_assigned_to_facility(facility_id)
        )
      )', t || '_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (
        public.is_platform_admin() or (
          organization_id = (select public.current_org_id())
          and (select public.current_role()) = ''org_admin''
        )
      )', t || '_delete', t
    );
  end loop;
end;
$$;

create trigger prevent_emergency_plan_version_mutation
  before update or delete on public.emergency_plan_versions
  for each row execute function app_private.prevent_phase5_evidence_mutation();
create trigger prevent_emergency_timeline_mutation
  before update or delete on public.emergency_event_timeline
  for each row execute function app_private.prevent_phase5_evidence_mutation();
create trigger prevent_emergency_communication_mutation
  before update or delete on public.emergency_communications
  for each row execute function app_private.prevent_phase5_evidence_mutation();

insert into storage.buckets (id, name, public)
values ('emergency-documents', 'emergency-documents', false)
on conflict (id) do nothing;

create policy "emergency-documents insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'emergency-documents'
  and (storage.foldername(name))[1] = (select public.current_org_id())::text
  and (
    public.is_platform_admin()
    or (
      (select public.current_role()) in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(((storage.foldername(name))[2])::uuid)
      and exists (
        select 1 from public.facilities f
        where f.id = ((storage.foldername(name))[2])::uuid
          and f.organization_id = (select public.current_org_id())
      )
    )
  )
);

create policy "emergency-documents read"
on storage.objects for select to authenticated
using (
  bucket_id = 'emergency-documents'
  and exists (
    select 1 from public.emergency_plan_versions v
    where v.storage_bucket = storage.objects.bucket_id
      and v.storage_path = storage.objects.name
      and app_private.admission_row_visible(v.organization_id, v.facility_id)
  )
);

create or replace function public.create_emergency_plan_version(
  p_facility_id uuid,
  p_title text,
  p_effective_date date,
  p_change_summary text,
  p_plan_snapshot jsonb default '{}'::jsonb,
  p_storage_path text default null,
  p_file_name text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_fac public.facilities%rowtype;
  v_plan public.emergency_plans%rowtype;
  v_version integer;
  v_id uuid;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_fac.organization_id, v_fac.id);
  if length(btrim(coalesce(p_title, ''))) < 3
     or length(btrim(coalesce(p_change_summary, ''))) < 5
     or p_effective_date is null
     or jsonb_typeof(coalesce(p_plan_snapshot, '{}'::jsonb)) <> 'object'
     or ((p_storage_path is null) <> (p_file_name is null)) then
    raise exception 'Emergency plan version is incomplete' using errcode = '22023';
  end if;
  if p_storage_path is not null and p_storage_path not like v_fac.organization_id::text || '/' || v_fac.id::text || '/%' then
    raise exception 'Emergency plan document path crosses scope' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('emergency-plan'), hashtext(v_fac.id::text));
  select * into v_plan from public.emergency_plans where facility_id = v_fac.id for update;
  if not found then
    insert into public.emergency_plans (organization_id, facility_id, title, created_by)
    values (v_fac.organization_id, v_fac.id, btrim(p_title), auth.uid())
    returning * into v_plan;
  else
    update public.emergency_plans set title = btrim(p_title), updated_at = now() where id = v_plan.id;
  end if;
  select coalesce(max(version_number), 0) + 1 into v_version
  from public.emergency_plan_versions where plan_id = v_plan.id;
  insert into public.emergency_plan_versions (
    organization_id, facility_id, plan_id, version_number, effective_date,
    change_summary, plan_snapshot, storage_bucket, storage_path, file_name, approved_by
  ) values (
    v_fac.organization_id, v_fac.id, v_plan.id, v_version, p_effective_date,
    btrim(p_change_summary), coalesce(p_plan_snapshot, '{}'::jsonb),
    case when p_storage_path is null then null else 'emergency-documents' end,
    p_storage_path, p_file_name, auth.uid()
  ) returning id into v_id;
  update public.emergency_plans set current_version_id = v_id, updated_at = now() where id = v_plan.id;
  return v_id;
end;
$$;

create or replace function public.upsert_resident_evacuation_profile(
  p_resident_id uuid,
  p_assistance_level text,
  p_mobility_needs text,
  p_transportation_needs text,
  p_evacuation_method text,
  p_required_equipment text,
  p_communication_needs text,
  p_preferred_relocation_notes text,
  p_notes text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_res public.residents%rowtype; v_id uuid;
begin
  select * into v_res from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_res.organization_id, v_res.facility_id);
  if p_assistance_level not in ('independent', 'cueing', 'one_person', 'two_person', 'full_assistance') then
    raise exception 'Invalid evacuation assistance level' using errcode = '22023';
  end if;
  insert into public.resident_evacuation_profiles (
    organization_id, facility_id, resident_id, assistance_level, mobility_needs,
    transportation_needs, evacuation_method, required_equipment,
    communication_needs, preferred_relocation_notes, notes, reviewed_by
  ) values (
    v_res.organization_id, v_res.facility_id, v_res.id, p_assistance_level,
    nullif(btrim(p_mobility_needs), ''), nullif(btrim(p_transportation_needs), ''),
    nullif(btrim(p_evacuation_method), ''), nullif(btrim(p_required_equipment), ''),
    nullif(btrim(p_communication_needs), ''), nullif(btrim(p_preferred_relocation_notes), ''),
    nullif(btrim(p_notes), ''), auth.uid()
  )
  on conflict (resident_id) do update set
    assistance_level = excluded.assistance_level,
    mobility_needs = excluded.mobility_needs,
    transportation_needs = excluded.transportation_needs,
    evacuation_method = excluded.evacuation_method,
    required_equipment = excluded.required_equipment,
    communication_needs = excluded.communication_needs,
    preferred_relocation_notes = excluded.preferred_relocation_notes,
    notes = excluded.notes,
    last_reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.start_emergency_event(
  p_facility_id uuid,
  p_event_mode text,
  p_event_type text,
  p_started_at timestamptz,
  p_summary text,
  p_location_description text,
  p_assembly_point text,
  p_incident_commander uuid,
  p_incident_id uuid default null,
  p_inspection_event_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_fac public.facilities%rowtype;
  v_plan_version uuid;
  v_id uuid;
  v_number text;
  v_local_date date;
  v_local_time time;
begin
  select * into v_fac from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_fac.organization_id, v_fac.id);
  select current_version_id into v_plan_version from public.emergency_plans where facility_id = v_fac.id;
  if v_plan_version is null then raise exception 'An approved emergency plan version is required' using errcode = '55000'; end if;
  if p_event_mode not in ('drill', 'actual')
     or p_event_type not in (
       'fire', 'severe_weather', 'power_outage', 'water_outage', 'hvac_outage',
       'evacuation', 'shelter_in_place', 'missing_person', 'infectious_disease',
       'transportation_disruption', 'other'
     )
     or length(btrim(coalesce(p_summary, ''))) < 5 then
    raise exception 'Emergency event declaration is incomplete' using errcode = '22023';
  end if;
  if p_incident_id is not null and not exists (
    select 1 from public.incidents i where i.id = p_incident_id and i.facility_id = v_fac.id
  ) then raise exception 'Linked incident crosses facility scope' using errcode = '42501'; end if;
  if p_inspection_event_id is not null and not exists (
    select 1 from public.inspection_events i where i.id = p_inspection_event_id and i.facility_id = v_fac.id
  ) then raise exception 'Linked drill crosses facility scope' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('emergency-event-number'), hashtext(v_fac.organization_id::text));
  v_number := 'EMG-' || to_char(coalesce(p_started_at, now()), 'YYYY') || '-' ||
    lpad((select (count(*) + 1)::text from public.emergency_events where organization_id = v_fac.organization_id), 4, '0');
  insert into public.emergency_events (
    organization_id, facility_id, event_number, event_mode, event_type,
    plan_version_id, incident_id, inspection_event_id, incident_commander_profile_id,
    started_at, location_description, assembly_point, summary, declared_by
  ) values (
    v_fac.organization_id, v_fac.id, v_number, p_event_mode, p_event_type,
    v_plan_version, p_incident_id, p_inspection_event_id, p_incident_commander,
    coalesce(p_started_at, now()), nullif(btrim(p_location_description), ''),
    nullif(btrim(p_assembly_point), ''), btrim(p_summary), auth.uid()
  ) returning id, started_at::date, started_at::time into v_id, v_local_date, v_local_time;

  insert into public.emergency_event_residents (
    organization_id, facility_id, emergency_event_id, resident_id,
    resident_name_snapshot, room_snapshot, assistance_level_snapshot,
    mobility_needs_snapshot, transportation_needs_snapshot,
    evacuation_method_snapshot, required_equipment_snapshot
  )
  select
    r.organization_id, r.facility_id, v_id, r.id,
    r.first_name || ' ' || r.last_name, r.room,
    coalesce(ep.assistance_level, 'full_assistance'), ep.mobility_needs,
    ep.transportation_needs, ep.evacuation_method, ep.required_equipment
  from public.residents r
  left join public.resident_evacuation_profiles ep on ep.resident_id = r.id
  where r.facility_id = v_fac.id and r.status = 'active';

  insert into public.emergency_event_staff (
    organization_id, facility_id, emergency_event_id, employee_id,
    employee_name_snapshot, job_title_snapshot, responsibility_snapshot, roster_source
  )
  select distinct on (e.id)
    e.organization_id, v_fac.id, v_id, e.id, e.first_name || ' ' || e.last_name,
    e.job_title, coalesce(esa.responsibility, 'Scheduled shift'),
    case when sa.id is not null then 'scheduled_shift' else 'emergency_assignment' end
  from public.employees e
  left join public.shift_assignments sa on sa.employee_id = e.id
    and sa.facility_id = v_fac.id
    and sa.status in ('scheduled', 'confirmed', 'completed')
    and (
      (sa.start_time <= sa.end_time and sa.shift_date = v_local_date and v_local_time between sa.start_time and sa.end_time)
      or (sa.start_time > sa.end_time and (
        (sa.shift_date = v_local_date and v_local_time >= sa.start_time)
        or (sa.shift_date = v_local_date - 1 and v_local_time <= sa.end_time)
      ))
    )
  left join public.emergency_staff_assignments esa on esa.employee_id = e.id
    and esa.facility_id = v_fac.id and esa.is_active
  where e.organization_id = v_fac.organization_id and e.status = 'active'
    and (sa.id is not null or esa.id is not null)
  order by e.id, (sa.id is not null) desc, esa.is_backup, esa.created_at;

  insert into public.emergency_event_timeline (
    organization_id, facility_id, emergency_event_id, event_type,
    occurred_at, description, metadata, recorded_by
  ) values (
    v_fac.organization_id, v_fac.id, v_id, 'declared', coalesce(p_started_at, now()),
    'Emergency event declared and accountability rosters snapshotted.',
    jsonb_build_object('eventMode', p_event_mode, 'eventType', p_event_type), auth.uid()
  );
  return v_id;
end;
$$;

create or replace function public.record_emergency_accountability(
  p_emergency_event_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_status text,
  p_assigned_employee_id uuid default null,
  p_relocation_site_id uuid default null,
  p_notes text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_event public.emergency_events%rowtype; v_name text;
begin
  select * into v_event from public.emergency_events where id = p_emergency_event_id for update;
  if not found then raise exception 'Emergency event not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_event.organization_id, v_event.facility_id);
  if v_event.status in ('closed', 'canceled') then raise exception 'Emergency event is closed' using errcode = '55000'; end if;
  if p_status not in ('expected', 'present', 'evacuated', 'relocated', 'sheltering', 'not_present', 'unaccounted') then
    raise exception 'Invalid accountability status' using errcode = '22023';
  end if;
  if p_relocation_site_id is not null and not exists (
    select 1 from public.emergency_resources r where r.id = p_relocation_site_id
      and r.facility_id = v_event.facility_id and r.resource_type = 'relocation_site'
  ) then raise exception 'Relocation site crosses facility scope' using errcode = '42501'; end if;
  if p_subject_type = 'resident' then
    update public.emergency_event_residents set
      accountability_status = p_status,
      assigned_employee_id = p_assigned_employee_id,
      relocation_site_id = p_relocation_site_id,
      accounted_at = case when p_status = 'expected' then null else now() end,
      accounted_by = case when p_status = 'expected' then null else auth.uid() end,
      notes = nullif(btrim(p_notes), '')
    where emergency_event_id = v_event.id and resident_id = p_subject_id
    returning resident_name_snapshot into v_name;
  elsif p_subject_type = 'staff' then
    update public.emergency_event_staff set
      accountability_status = p_status,
      accounted_at = case when p_status = 'expected' then null else now() end,
      accounted_by = case when p_status = 'expected' then null else auth.uid() end,
      notes = nullif(btrim(p_notes), '')
    where emergency_event_id = v_event.id and employee_id = p_subject_id
    returning employee_name_snapshot into v_name;
  else
    raise exception 'Invalid accountability subject type' using errcode = '22023';
  end if;
  if v_name is null then raise exception 'Accountability subject not found' using errcode = 'P0002'; end if;
  insert into public.emergency_event_timeline (
    organization_id, facility_id, emergency_event_id, event_type, description, metadata, recorded_by
  ) values (
    v_event.organization_id, v_event.facility_id, v_event.id, 'accountability',
    v_name || ' marked ' || replace(p_status, '_', ' '),
    jsonb_build_object('subjectType', p_subject_type, 'subjectId', p_subject_id, 'status', p_status), auth.uid()
  );
  return true;
end;
$$;

create or replace function public.add_emergency_timeline_entry(
  p_emergency_event_id uuid,
  p_event_type text,
  p_occurred_at timestamptz,
  p_description text,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_event public.emergency_events%rowtype; v_id uuid;
begin
  select * into v_event from public.emergency_events where id = p_emergency_event_id;
  if not found then raise exception 'Emergency event not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_event.organization_id, v_event.facility_id);
  if p_event_type not in ('declared', 'accountability', 'evacuation', 'relocation', 'resource', 'communication', 'status_change', 'observation', 'decision', 'other')
     or length(btrim(coalesce(p_description, ''))) < 3 then
    raise exception 'Invalid emergency timeline entry' using errcode = '22023';
  end if;
  insert into public.emergency_event_timeline (
    organization_id, facility_id, emergency_event_id, event_type,
    occurred_at, description, metadata, recorded_by
  ) values (
    v_event.organization_id, v_event.facility_id, v_event.id, p_event_type,
    coalesce(p_occurred_at, now()), btrim(p_description), coalesce(p_metadata, '{}'::jsonb), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.log_emergency_communication(
  p_emergency_event_id uuid,
  p_audience text,
  p_resident_id uuid,
  p_informal_support_id uuid,
  p_recipient_name text,
  p_recipient_contact text,
  p_channel text,
  p_delivery_status text,
  p_message text,
  p_occurred_at timestamptz default now(),
  p_batch_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_event public.emergency_events%rowtype; v_id uuid;
begin
  select * into v_event from public.emergency_events where id = p_emergency_event_id;
  if not found then raise exception 'Emergency event not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_event.organization_id, v_event.facility_id);
  if p_audience not in ('designated_person', 'family', 'staff', 'resident', 'vendor', 'utility', 'emergency_services', 'other')
     or p_channel not in ('phone', 'sms', 'email', 'in_person', 'radio', 'other')
     or p_delivery_status not in ('queued', 'attempted', 'sent', 'confirmed', 'failed', 'not_required')
     or length(btrim(coalesce(p_message, ''))) < 3 then
    raise exception 'Invalid emergency communication' using errcode = '22023';
  end if;
  if p_resident_id is not null and not exists (
    select 1 from public.emergency_event_residents r
    where r.emergency_event_id = v_event.id and r.resident_id = p_resident_id
  ) then raise exception 'Communication resident crosses event scope' using errcode = '42501'; end if;
  if p_informal_support_id is not null and not exists (
    select 1 from public.resident_informal_supports s
    where s.id = p_informal_support_id
      and (p_resident_id is null or s.resident_id = p_resident_id)
      and s.facility_id = v_event.facility_id
  ) then raise exception 'Communication contact crosses event scope' using errcode = '42501'; end if;
  insert into public.emergency_communications (
    organization_id, facility_id, emergency_event_id, batch_id, audience,
    resident_id, informal_support_id, recipient_name_snapshot,
    recipient_contact_snapshot, channel, delivery_status, message, occurred_at, recorded_by
  ) values (
    v_event.organization_id, v_event.facility_id, v_event.id, p_batch_id, p_audience,
    p_resident_id, p_informal_support_id, nullif(btrim(p_recipient_name), ''),
    nullif(btrim(p_recipient_contact), ''), p_channel, p_delivery_status,
    btrim(p_message), coalesce(p_occurred_at, now()), auth.uid()
  ) returning id into v_id;
  insert into public.emergency_event_timeline (
    organization_id, facility_id, emergency_event_id, event_type, occurred_at,
    description, metadata, recorded_by
  ) values (
    v_event.organization_id, v_event.facility_id, v_event.id, 'communication',
    coalesce(p_occurred_at, now()), 'Communication logged for ' || replace(p_audience, '_', ' '),
    jsonb_build_object('communicationId', v_id, 'status', p_delivery_status, 'channel', p_channel), auth.uid()
  );
  return v_id;
end;
$$;

create or replace function public.queue_designated_person_notifications(
  p_emergency_event_id uuid,
  p_message text,
  p_channel text default 'phone'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_event public.emergency_events%rowtype; v_batch uuid := extensions.gen_random_uuid(); v_count integer;
begin
  select * into v_event from public.emergency_events where id = p_emergency_event_id;
  if not found then raise exception 'Emergency event not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_event.organization_id, v_event.facility_id);
  if p_channel not in ('phone', 'sms', 'email') or length(btrim(coalesce(p_message, ''))) < 3 then
    raise exception 'Invalid mass notification request' using errcode = '22023';
  end if;
  insert into public.emergency_communications (
    organization_id, facility_id, emergency_event_id, batch_id, audience,
    resident_id, informal_support_id, recipient_name_snapshot,
    recipient_contact_snapshot, channel, delivery_status, message, recorded_by
  )
  select
    v_event.organization_id, v_event.facility_id, v_event.id, v_batch, 'designated_person',
    er.resident_id, s.id, s.name, coalesce(s.phone, 'No contact method on file'),
    p_channel, case when s.phone is null then 'failed' else 'queued' end,
    btrim(p_message), auth.uid()
  from public.emergency_event_residents er
  join public.resident_informal_supports s on s.resident_id = er.resident_id
  where er.emergency_event_id = v_event.id;
  get diagnostics v_count = row_count;
  insert into public.emergency_event_timeline (
    organization_id, facility_id, emergency_event_id, event_type, description, metadata, recorded_by
  ) values (
    v_event.organization_id, v_event.facility_id, v_event.id, 'communication',
    'Designated-person notification batch queued.',
    jsonb_build_object('batchId', v_batch, 'recipientCount', v_count, 'channel', p_channel), auth.uid()
  );
  return jsonb_build_object('batchId', v_batch, 'recipientCount', v_count);
end;
$$;

create or replace function public.save_emergency_after_action(
  p_emergency_event_id uuid,
  p_status text,
  p_response_summary text,
  p_strengths text,
  p_gaps_identified text,
  p_lessons_learned text,
  p_corrective_action_plan text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_event public.emergency_events%rowtype; v_id uuid;
begin
  select * into v_event from public.emergency_events where id = p_emergency_event_id;
  if not found then raise exception 'Emergency event not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_event.organization_id, v_event.facility_id);
  if p_status not in ('draft', 'submitted', 'approved')
     or length(btrim(coalesce(p_response_summary, ''))) < 10 then
    raise exception 'After-action review is incomplete' using errcode = '22023';
  end if;
  if p_status in ('submitted', 'approved') and (
    length(btrim(coalesce(p_strengths, ''))) < 5
    or length(btrim(coalesce(p_gaps_identified, ''))) < 5
    or length(btrim(coalesce(p_corrective_action_plan, ''))) < 5
  ) then raise exception 'Submitted after-action review requires findings and a corrective-action plan' using errcode = '55000'; end if;
  insert into public.emergency_after_action_reviews (
    organization_id, facility_id, emergency_event_id, status, response_summary,
    strengths, gaps_identified, lessons_learned, corrective_action_plan,
    reviewed_by, reviewed_at, approved_by, approved_at
  ) values (
    v_event.organization_id, v_event.facility_id, v_event.id, p_status,
    btrim(p_response_summary), nullif(btrim(p_strengths), ''),
    nullif(btrim(p_gaps_identified), ''), nullif(btrim(p_lessons_learned), ''),
    nullif(btrim(p_corrective_action_plan), ''), auth.uid(), now(),
    case when p_status = 'approved' then auth.uid() else null end,
    case when p_status = 'approved' then now() else null end
  )
  on conflict (emergency_event_id) do update set
    status = excluded.status, response_summary = excluded.response_summary,
    strengths = excluded.strengths, gaps_identified = excluded.gaps_identified,
    lessons_learned = excluded.lessons_learned,
    corrective_action_plan = excluded.corrective_action_plan,
    reviewed_by = auth.uid(), reviewed_at = now(),
    approved_by = excluded.approved_by, approved_at = excluded.approved_at,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.add_emergency_corrective_action(
  p_emergency_event_id uuid,
  p_title text,
  p_description text,
  p_owner_profile_id uuid,
  p_priority text,
  p_due_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.emergency_events%rowtype;
  v_template uuid;
  v_work uuid;
  v_id uuid;
begin
  select * into v_event from public.emergency_events where id = p_emergency_event_id;
  if not found then raise exception 'Emergency event not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_event.organization_id, v_event.facility_id);
  if length(btrim(coalesce(p_title, ''))) < 3
     or p_priority not in ('low', 'normal', 'high', 'urgent')
     or p_due_at <= now() then
    raise exception 'Emergency corrective action is incomplete' using errcode = '22023';
  end if;
  select id into v_template from public.work_item_templates
  where template_key = 'emergency.after_action'
    and (organization_id = v_event.organization_id or organization_id is null)
  order by organization_id nulls last limit 1;
  insert into public.work_items (
    organization_id, facility_id, template_id, source_type, source_id,
    deduplication_key, title, description, owner_profile_id, priority, due_at, created_by
  ) values (
    v_event.organization_id, v_event.facility_id, v_template, 'emergency', v_event.id,
'emergency:' || v_event.id || ':' || extensions.gen_random_uuid(), btrim(p_title),
    nullif(btrim(p_description), ''), p_owner_profile_id, p_priority, p_due_at, auth.uid()
  ) returning id into v_work;
  insert into public.work_item_history (
    organization_id, facility_id, work_item_id, event_type,
    resulting_state, actor_profile_id, reason
  ) values (
    v_event.organization_id, v_event.facility_id, v_work, 'created',
    'open', auth.uid(), 'Emergency after-action review created corrective work'
  );
  insert into public.emergency_event_actions (
    organization_id, facility_id, emergency_event_id, work_item_id
  ) values (
    v_event.organization_id, v_event.facility_id, v_event.id, v_work
  ) returning id into v_id;
  insert into public.emergency_event_timeline (
    organization_id, facility_id, emergency_event_id, event_type, description, metadata, recorded_by
  ) values (
    v_event.organization_id, v_event.facility_id, v_event.id, 'decision',
    'Corrective action created: ' || btrim(p_title), jsonb_build_object('workItemId', v_work), auth.uid()
  );
  return v_id;
end;
$$;

create or replace function public.transition_emergency_event(
  p_emergency_event_id uuid,
  p_target_status text,
  p_reason text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_event public.emergency_events%rowtype;
begin
  select * into v_event from public.emergency_events where id = p_emergency_event_id for update;
  if not found then raise exception 'Emergency event not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_event.organization_id, v_event.facility_id);
  if p_target_status not in ('active', 'stabilized', 'closed', 'canceled')
     or length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Invalid emergency event transition' using errcode = '22023';
  end if;
  if p_target_status = 'stabilized' and v_event.status <> 'active' then
    raise exception 'Only an active event may be stabilized' using errcode = '55000';
  end if;
  if p_target_status = 'stabilized' and (
    exists (select 1 from public.emergency_event_residents where emergency_event_id = v_event.id and accountability_status in ('expected', 'unaccounted'))
    or exists (select 1 from public.emergency_event_staff where emergency_event_id = v_event.id and accountability_status in ('expected', 'unaccounted'))
  ) then raise exception 'All residents and staff must be accounted for before stabilization' using errcode = '55000'; end if;
  if p_target_status = 'closed' and (
    v_event.status <> 'stabilized'
    or not exists (
      select 1 from public.emergency_after_action_reviews
      where emergency_event_id = v_event.id and status = 'approved'
    )
  ) then raise exception 'Closed events require stabilization and an approved after-action review' using errcode = '55000'; end if;
  update public.emergency_events set
    status = p_target_status,
    ended_at = case when p_target_status in ('closed', 'canceled') then now() else ended_at end,
    updated_at = now()
  where id = v_event.id;
  insert into public.emergency_event_timeline (
    organization_id, facility_id, emergency_event_id, event_type,
    description, metadata, recorded_by
  ) values (
    v_event.organization_id, v_event.facility_id, v_event.id, 'status_change',
    btrim(p_reason), jsonb_build_object('priorStatus', v_event.status, 'resultingStatus', p_target_status), auth.uid()
  );
  return true;
end;
$$;

revoke all on function
  public.create_emergency_plan_version(uuid, text, date, text, jsonb, text, text),
  public.upsert_resident_evacuation_profile(uuid, text, text, text, text, text, text, text, text),
  public.start_emergency_event(uuid, text, text, timestamptz, text, text, text, uuid, uuid, uuid),
  public.record_emergency_accountability(uuid, text, uuid, text, uuid, uuid, text),
  public.add_emergency_timeline_entry(uuid, text, timestamptz, text, jsonb),
  public.log_emergency_communication(uuid, text, uuid, uuid, text, text, text, text, text, timestamptz, uuid),
  public.queue_designated_person_notifications(uuid, text, text),
  public.save_emergency_after_action(uuid, text, text, text, text, text, text),
  public.add_emergency_corrective_action(uuid, text, text, uuid, text, timestamptz),
  public.transition_emergency_event(uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_emergency_plan_version(uuid, text, date, text, jsonb, text, text),
  public.upsert_resident_evacuation_profile(uuid, text, text, text, text, text, text, text, text),
  public.start_emergency_event(uuid, text, text, timestamptz, text, text, text, uuid, uuid, uuid),
  public.record_emergency_accountability(uuid, text, uuid, text, uuid, uuid, text),
  public.add_emergency_timeline_entry(uuid, text, timestamptz, text, jsonb),
  public.log_emergency_communication(uuid, text, uuid, uuid, text, text, text, text, text, timestamptz, uuid),
  public.queue_designated_person_notifications(uuid, text, text),
  public.save_emergency_after_action(uuid, text, text, text, text, text, text),
  public.add_emergency_corrective_action(uuid, text, text, uuid, text, timestamptz),
  public.transition_emergency_event(uuid, text, text)
to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'emergency_plans', 'emergency_plan_versions', 'emergency_staff_assignments',
    'resident_evacuation_profiles', 'emergency_resources', 'emergency_inventory_items',
    'emergency_events', 'emergency_event_residents', 'emergency_event_staff',
    'emergency_event_timeline', 'emergency_communications',
    'emergency_after_action_reviews', 'emergency_event_actions'
  ] loop
    execute format('create trigger audit_log after insert or update or delete on public.%I for each row execute function public.audit_log_trigger()', t);
  end loop;
end;
$$;
