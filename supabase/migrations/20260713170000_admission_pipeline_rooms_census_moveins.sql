-- Priority 4: pre-admission CRM, residential room/bed inventory, temporal census,
-- and a complete command surface over the existing move_in_* workspace tables.

create table public.referral_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  source_type text not null check (source_type in (
    'hospital', 'snf', 'agency', 'family', 'physician', 'community', 'self', 'other'
  )),
  contact_name text,
  phone text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.admission_prospects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  first_name text not null,
  last_name text not null,
  preferred_name text,
  date_of_birth date,
  phone text,
  email text,
  referral_source_id uuid references public.referral_sources(id) on delete set null,
  inquiry_date date not null default current_date,
  stage text not null default 'prospect' check (stage in (
    'prospect', 'applicant', 'approved', 'waitlisted', 'reserved',
    'admitted', 'declined', 'lost'
  )),
  clinical_review_status text not null default 'not_started' check (clinical_review_status in (
    'not_started', 'in_review', 'approved', 'needs_information', 'declined'
  )),
  financial_review_status text not null default 'not_started' check (financial_review_status in (
    'not_started', 'in_review', 'approved', 'needs_information', 'declined'
  )),
  expected_move_in_date date,
  decision_reason text,
  lost_lead_reason text,
  primary_contact_name text,
  primary_contact_relationship text,
  primary_contact_phone text,
  primary_contact_email text,
  notes text,
  resident_id uuid references public.residents(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stage <> 'admitted' or resident_id is not null)
);
create index admission_prospects_pipeline_idx
  on public.admission_prospects(organization_id, facility_id, stage, expected_move_in_date);
create index admission_prospects_referral_idx
  on public.admission_prospects(referral_source_id, stage);

create table public.admission_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  prospect_id uuid not null references public.admission_prospects(id) on delete cascade,
  activity_type text not null check (activity_type in (
    'inquiry', 'contact_attempt', 'tour_scheduled', 'tour_completed', 'tour_canceled',
    'clinical_review', 'financial_review', 'decision', 'note', 'stage_change'
  )),
  occurred_at timestamptz not null default now(),
  scheduled_for timestamptz,
  outcome text,
  notes text,
  actor_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index admission_activities_prospect_idx
  on public.admission_activities(prospect_id, occurred_at desc);

create table public.facility_buildings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  name text not null,
  licensed_capacity integer not null default 0 check (licensed_capacity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, name)
);

create table public.residential_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  building_id uuid not null references public.facility_buildings(id) on delete cascade,
  name text not null,
  description text,
  secured boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building_id, name)
);

create table public.facility_rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  building_id uuid not null references public.facility_buildings(id) on delete cascade,
  residential_unit_id uuid references public.residential_units(id) on delete set null,
  room_number text not null,
  room_type text not null check (room_type in (
    'private', 'semi_private', 'shared', 'suite', 'studio', 'other'
  )),
  gender_restriction text not null default 'none' check (gender_restriction in (
    'none', 'female', 'male', 'compatibility_review'
  )),
  compatibility_notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, room_number)
);

create table public.facility_beds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  room_id uuid not null references public.facility_rooms(id) on delete cascade,
  bed_label text not null,
  status text not null default 'available' check (status in (
    'available', 'reserved', 'occupied', 'temporarily_unavailable', 'maintenance_hold'
  )),
  reserved_for_prospect_id uuid references public.admission_prospects(id) on delete set null,
  occupied_by_resident_id uuid references public.residents(id) on delete set null,
  expected_vacancy_date date,
  hold_reason text,
  qr_code text not null default ('BED-' || upper(encode(extensions.gen_random_bytes(8), 'hex'))),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, bed_label),
  unique (qr_code),
  check (
    (status = 'available' and reserved_for_prospect_id is null and occupied_by_resident_id is null)
    or (status = 'reserved' and reserved_for_prospect_id is not null and occupied_by_resident_id is null)
    or (status = 'occupied' and occupied_by_resident_id is not null and reserved_for_prospect_id is null)
    or status in ('temporarily_unavailable', 'maintenance_hold')
  )
);
create unique index facility_beds_one_resident_idx
  on public.facility_beds(occupied_by_resident_id)
  where occupied_by_resident_id is not null;
create unique index facility_beds_one_prospect_idx
  on public.facility_beds(reserved_for_prospect_id)
  where reserved_for_prospect_id is not null;
create index facility_beds_inventory_idx
  on public.facility_beds(facility_id, status, expected_vacancy_date);

alter table public.residents add column bed_id uuid references public.facility_beds(id) on delete set null;

alter table public.residents drop constraint residents_status_check;
alter table public.residents add constraint residents_status_check check (status in (
  'prospect', 'applicant', 'approved', 'waitlisted', 'reserved',
  'active', 'temporarily_out', 'hospital_leave', 'discharged', 'deceased'
));

create table public.resident_census_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  event_type text not null check (event_type in (
    'reserved', 'admitted', 'temporarily_out', 'returned', 'hospital_leave',
    'room_transfer', 'discharged', 'deceased'
  )),
  prior_status text,
  resulting_status text not null,
  prior_bed_id uuid references public.facility_beds(id) on delete set null,
  resulting_bed_id uuid references public.facility_beds(id) on delete set null,
  effective_at timestamptz not null default now(),
  reason text,
  actor_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index resident_census_history_idx
  on public.resident_census_events(resident_id, effective_at desc);

create table public.move_in_task_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  workspace_id uuid not null references public.move_in_workspaces(id) on delete restrict,
  task_id uuid references public.move_in_tasks(id) on delete restrict,
  event_type text not null,
  prior_state text,
  resulting_state text,
  reason text not null,
  actor_profile_id uuid references public.profiles(id),
  evidence jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index move_in_task_history_workspace_idx
  on public.move_in_task_history(workspace_id, occurred_at desc);

create trigger prevent_move_in_task_history_mutation
before update or delete on public.move_in_task_history
for each row execute function app_private.prevent_phase5_evidence_mutation();

do $$
declare
  t text;
begin
  foreach t in array array[
    'referral_sources', 'admission_prospects', 'admission_activities',
    'facility_buildings', 'residential_units', 'facility_rooms', 'facility_beds',
    'resident_census_events', 'move_in_task_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

create or replace function app_private.admission_row_visible(p_org uuid, p_fac uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or (
      p_org = public.current_org_id()
      and (
        public.current_role() in ('org_admin', 'auditor')
        or (
          public.current_role() = 'facility_manager'
          and public.is_assigned_to_facility(p_fac)
        )
      )
    )
$$;
revoke all on function app_private.admission_row_visible(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.admission_row_visible(uuid, uuid) to authenticated;

create or replace function app_private.assert_admission_manager(p_org uuid, p_fac uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role', '') = 'service_role' or public.is_platform_admin() then
    return;
  end if;
  if auth.uid() is null
    or public.current_org_id() <> p_org
    or public.current_role() not in ('org_admin', 'facility_manager')
    or (
      p_fac is not null
      and public.current_role() = 'facility_manager'
      and not public.is_assigned_to_facility(p_fac)
    ) then
    raise exception 'Admission operation is outside caller scope' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.assert_admission_manager(uuid, uuid)
  from public, anon, authenticated, service_role;

create policy referral_sources_select on public.referral_sources
for select to authenticated
using (
  public.is_platform_admin()
  or (
    organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager', 'auditor')
  )
);
create policy admission_prospects_select on public.admission_prospects
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));
create policy admission_activities_select on public.admission_activities
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));
create policy facility_buildings_select on public.facility_buildings
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));
create policy residential_units_select on public.residential_units
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));
create policy facility_rooms_select on public.facility_rooms
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));
create policy facility_beds_select on public.facility_beds
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));
create policy resident_census_events_select on public.resident_census_events
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));
create policy move_in_task_history_select on public.move_in_task_history
for select to authenticated using (app_private.admission_row_visible(organization_id, facility_id));

drop policy movein_guest_grants_select on public.move_in_guest_grants;
create policy movein_guest_grants_select on public.move_in_guest_grants
for select to authenticated
using (app_private.admission_row_visible(organization_id, facility_id));
drop policy movein_guest_events_select on public.move_in_guest_access_events;
create policy movein_guest_events_select on public.move_in_guest_access_events
for select to authenticated
using (app_private.admission_row_visible(organization_id, facility_id));

do $$
declare
  t text;
begin
  foreach t in array array[
    'referral_sources', 'admission_prospects', 'admission_activities',
    'facility_buildings', 'residential_units', 'facility_rooms', 'facility_beds',
    'resident_census_events', 'move_in_task_history'
  ] loop
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$$;

create or replace function public.create_referral_source(
  p_organization_id uuid,
  p_name text,
  p_source_type text,
  p_contact_name text default null,
  p_phone text default null,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform app_private.assert_admission_manager(p_organization_id, null);
  if p_source_type not in ('hospital', 'snf', 'agency', 'family', 'physician', 'community', 'self', 'other')
    or length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Invalid referral source' using errcode = '22023';
  end if;
  insert into public.referral_sources(
    organization_id, name, source_type, contact_name, phone, email
  ) values (
    p_organization_id, btrim(p_name), p_source_type, nullif(btrim(p_contact_name), ''),
    nullif(btrim(p_phone), ''), nullif(btrim(p_email), '')
  )
  on conflict (organization_id, name) do update
  set source_type = excluded.source_type,
      contact_name = excluded.contact_name,
      phone = excluded.phone,
      email = excluded.email,
      updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_admission_prospect(
  p_facility_id uuid,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date default null,
  p_phone text default null,
  p_email text default null,
  p_referral_source_id uuid default null,
  p_expected_move_in_date date default null,
  p_primary_contact_name text default null,
  p_primary_contact_relationship text default null,
  p_primary_contact_phone text default null,
  p_primary_contact_email text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facility public.facilities%rowtype;
  v_id uuid;
begin
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_facility.organization_id, v_facility.id);
  if length(btrim(coalesce(p_first_name, ''))) < 1
    or length(btrim(coalesce(p_last_name, ''))) < 1
    or (p_referral_source_id is not null and not exists (
      select 1 from public.referral_sources s
      where s.id = p_referral_source_id and s.organization_id = v_facility.organization_id
    )) then
    raise exception 'Invalid prospect' using errcode = '22023';
  end if;
  insert into public.admission_prospects(
    organization_id, facility_id, first_name, last_name, date_of_birth,
    phone, email, referral_source_id, expected_move_in_date,
    primary_contact_name, primary_contact_relationship, primary_contact_phone,
    primary_contact_email, notes, created_by
  ) values (
    v_facility.organization_id, v_facility.id, btrim(p_first_name), btrim(p_last_name),
    p_date_of_birth, nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''),
    p_referral_source_id, p_expected_move_in_date, nullif(btrim(p_primary_contact_name), ''),
    nullif(btrim(p_primary_contact_relationship), ''), nullif(btrim(p_primary_contact_phone), ''),
    nullif(btrim(p_primary_contact_email), ''), nullif(btrim(p_notes), ''), auth.uid()
  ) returning id into v_id;
  insert into public.admission_activities(
    organization_id, facility_id, prospect_id, activity_type, notes, actor_profile_id
  ) values (
    v_facility.organization_id, v_facility.id, v_id, 'inquiry',
    'Prospect inquiry created', auth.uid()
  );
  return v_id;
end;
$$;

create or replace function public.update_admission_prospect(
  p_prospect_id uuid,
  p_stage text,
  p_clinical_review_status text,
  p_financial_review_status text,
  p_expected_move_in_date date,
  p_decision_reason text default null,
  p_lost_lead_reason text default null,
  p_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.admission_prospects%rowtype;
begin
  select * into v from public.admission_prospects where id = p_prospect_id for update;
  if not found then raise exception 'Prospect not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if p_stage not in ('prospect', 'applicant', 'approved', 'waitlisted', 'reserved', 'declined', 'lost')
    or p_clinical_review_status not in ('not_started', 'in_review', 'approved', 'needs_information', 'declined')
    or p_financial_review_status not in ('not_started', 'in_review', 'approved', 'needs_information', 'declined')
    or (p_stage in ('approved', 'reserved') and (
      p_clinical_review_status <> 'approved' or p_financial_review_status <> 'approved'
    )) then
    raise exception 'Invalid admission decision or reviews are incomplete' using errcode = '22023';
  end if;
  update public.admission_prospects
  set stage = p_stage,
      clinical_review_status = p_clinical_review_status,
      financial_review_status = p_financial_review_status,
      expected_move_in_date = p_expected_move_in_date,
      decision_reason = nullif(btrim(p_decision_reason), ''),
      lost_lead_reason = nullif(btrim(p_lost_lead_reason), ''),
      notes = nullif(btrim(p_notes), ''),
      updated_at = now()
  where id = p_prospect_id;
  insert into public.admission_activities(
    organization_id, facility_id, prospect_id, activity_type,
    outcome, notes, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v.id,
    case when v.stage is distinct from p_stage then 'stage_change' else 'decision' end,
    p_stage, coalesce(nullif(btrim(p_decision_reason), ''), 'Admission review updated'), auth.uid()
  );
  return true;
end;
$$;

create or replace function public.record_admission_activity(
  p_prospect_id uuid,
  p_activity_type text,
  p_scheduled_for timestamptz default null,
  p_outcome text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.admission_prospects%rowtype;
  v_id uuid;
begin
  select * into v from public.admission_prospects where id = p_prospect_id;
  if not found then raise exception 'Prospect not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if p_activity_type not in (
    'contact_attempt', 'tour_scheduled', 'tour_completed', 'tour_canceled',
    'clinical_review', 'financial_review', 'decision', 'note'
  ) then raise exception 'Invalid admission activity' using errcode = '22023'; end if;
  insert into public.admission_activities(
    organization_id, facility_id, prospect_id, activity_type,
    scheduled_for, outcome, notes, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v.id, p_activity_type,
    p_scheduled_for, nullif(btrim(p_outcome), ''), nullif(btrim(p_notes), ''), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_room_with_beds(
  p_facility_id uuid,
  p_building_name text,
  p_unit_name text,
  p_room_number text,
  p_room_type text,
  p_bed_count integer,
  p_gender_restriction text default 'none',
  p_licensed_capacity integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facility public.facilities%rowtype;
  v_building uuid;
  v_unit uuid;
  v_room uuid;
  i integer;
begin
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_facility.organization_id, v_facility.id);
  if p_room_type not in ('private', 'semi_private', 'shared', 'suite', 'studio', 'other')
    or p_gender_restriction not in ('none', 'female', 'male', 'compatibility_review')
    or p_bed_count not between 1 and 8
    or length(btrim(coalesce(p_building_name, ''))) < 1
    or length(btrim(coalesce(p_room_number, ''))) < 1 then
    raise exception 'Invalid room inventory' using errcode = '22023';
  end if;
  insert into public.facility_buildings(
    organization_id, facility_id, name, licensed_capacity
  ) values (
    v_facility.organization_id, v_facility.id, btrim(p_building_name),
    coalesce(p_licensed_capacity, 0)
  )
  on conflict (facility_id, name) do update
  set licensed_capacity = case
    when p_licensed_capacity is null then public.facility_buildings.licensed_capacity
    else p_licensed_capacity end,
    updated_at = now()
  returning id into v_building;
  if nullif(btrim(p_unit_name), '') is not null then
    insert into public.residential_units(
      organization_id, facility_id, building_id, name
    ) values (
      v_facility.organization_id, v_facility.id, v_building, btrim(p_unit_name)
    )
    on conflict (building_id, name) do update set updated_at = now()
    returning id into v_unit;
  end if;
  insert into public.facility_rooms(
    organization_id, facility_id, building_id, residential_unit_id,
    room_number, room_type, gender_restriction
  ) values (
    v_facility.organization_id, v_facility.id, v_building, v_unit,
    btrim(p_room_number), p_room_type, p_gender_restriction
  )
  on conflict (facility_id, room_number) do update
  set room_type = excluded.room_type,
      residential_unit_id = excluded.residential_unit_id,
      gender_restriction = excluded.gender_restriction,
      updated_at = now()
  returning id into v_room;
  for i in 1..p_bed_count loop
    insert into public.facility_beds(
      organization_id, facility_id, room_id, bed_label
    ) values (
      v_facility.organization_id, v_facility.id, v_room,
      case when p_bed_count = 1 then 'A' else chr(64 + i) end
    ) on conflict (room_id, bed_label) do nothing;
  end loop;
  return v_room;
end;
$$;

create or replace function public.set_bed_availability(
  p_bed_id uuid,
  p_status text,
  p_hold_reason text default null,
  p_expected_vacancy_date date default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.facility_beds%rowtype;
begin
  select * into v from public.facility_beds where id = p_bed_id for update;
  if not found then raise exception 'Bed not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if p_status not in ('available', 'temporarily_unavailable', 'maintenance_hold')
    or v.status in ('reserved', 'occupied') then
    raise exception 'Occupied or reserved beds must be released through census workflow' using errcode = '55000';
  end if;
  update public.facility_beds
  set status = p_status,
      reserved_for_prospect_id = null,
      occupied_by_resident_id = null,
      hold_reason = case when p_status = 'available' then null else nullif(btrim(p_hold_reason), '') end,
      expected_vacancy_date = p_expected_vacancy_date,
      updated_at = now()
  where id = v.id;
  return true;
end;
$$;

create or replace function public.reserve_bed_for_prospect(
  p_prospect_id uuid,
  p_bed_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prospect public.admission_prospects%rowtype;
  v_bed public.facility_beds%rowtype;
begin
  select * into v_prospect from public.admission_prospects where id = p_prospect_id for update;
  select * into v_bed from public.facility_beds where id = p_bed_id for update;
  if v_prospect.id is null or v_bed.id is null then
    raise exception 'Prospect or bed not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_admission_manager(v_prospect.organization_id, v_prospect.facility_id);
  if v_prospect.stage not in ('approved', 'waitlisted', 'reserved')
    or v_prospect.clinical_review_status <> 'approved'
    or v_prospect.financial_review_status <> 'approved'
    or v_bed.facility_id <> v_prospect.facility_id
    or (v_bed.status <> 'available' and v_bed.reserved_for_prospect_id <> v_prospect.id) then
    raise exception 'Prospect is not approved or bed is unavailable' using errcode = '55000';
  end if;
  update public.facility_beds
  set status = 'available', reserved_for_prospect_id = null, updated_at = now()
  where reserved_for_prospect_id = v_prospect.id and id <> v_bed.id;
  update public.facility_beds
  set status = 'reserved', reserved_for_prospect_id = v_prospect.id,
      occupied_by_resident_id = null, updated_at = now()
  where id = v_bed.id;
  update public.admission_prospects set stage = 'reserved', updated_at = now()
  where id = v_prospect.id;
  insert into public.admission_activities(
    organization_id, facility_id, prospect_id, activity_type, outcome, notes, actor_profile_id
  ) values (
    v_prospect.organization_id, v_prospect.facility_id, v_prospect.id,
    'stage_change', 'reserved', 'Bed reserved for expected move-in', auth.uid()
  );
  return true;
end;
$$;

create or replace function app_private.ensure_move_in_template(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  select id into v_id from public.move_in_templates
  where organization_id = p_org and is_active
  order by version desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.move_in_templates(
    organization_id, name, version, definition
  ) values (
    p_org, 'Standard admission readiness', 1,
    jsonb_build_object('tasks', jsonb_build_array(
      jsonb_build_object('key','required_documents','title','Required admission documents','requiresDocument',true,'requiresSignature',false,'requiresApproval',true,'dependsOn',jsonb_build_array(),'dueOffsetDays',-3),
      jsonb_build_object('key','resident_agreement','title','Resident agreement and signatures','requiresDocument',false,'requiresSignature',true,'requiresApproval',true,'dependsOn',jsonb_build_array(),'dueOffsetDays',-2),
      jsonb_build_object('key','financial_approval','title','Financial approval','requiresDocument',false,'requiresSignature',false,'requiresApproval',true,'dependsOn',jsonb_build_array(),'dueOffsetDays',-3),
      jsonb_build_object('key','clinical_approval','title','Clinical admission review','requiresDocument',false,'requiresSignature',false,'requiresApproval',true,'dependsOn',jsonb_build_array(),'dueOffsetDays',-3),
      jsonb_build_object('key','room_readiness','title','Room and bed readiness','requiresDocument',false,'requiresSignature',false,'requiresApproval',true,'dependsOn',jsonb_build_array('financial_approval','clinical_approval'),'dueOffsetDays',-1),
      jsonb_build_object('key','transportation','title','Move-in transportation','requiresDocument',false,'requiresSignature',false,'requiresApproval',false,'dependsOn',jsonb_build_array(),'dueOffsetDays',-1),
      jsonb_build_object('key','emar_vendor_readiness','title','Medication/eMAR vendor readiness status','requiresDocument',false,'requiresSignature',false,'requiresApproval',false,'dependsOn',jsonb_build_array('clinical_approval'),'dueOffsetDays',-1),
      jsonb_build_object('key','family_uploads','title','Family or designated-person uploads','requiresDocument',true,'requiresSignature',false,'requiresApproval',false,'dependsOn',jsonb_build_array(),'dueOffsetDays',-2),
      jsonb_build_object('key','guest_signing','title','Guest signing complete','requiresDocument',false,'requiresSignature',true,'requiresApproval',false,'dependsOn',jsonb_build_array('resident_agreement'),'dueOffsetDays',-1),
      jsonb_build_object('key','ready_to_admit','title','Ready-to-admit decision','requiresDocument',false,'requiresSignature',false,'requiresApproval',true,'dependsOn',jsonb_build_array('required_documents','resident_agreement','financial_approval','clinical_approval','room_readiness'),'dueOffsetDays',0)
    ))
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app_private.ensure_move_in_template(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.refresh_move_in_readiness(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace public.move_in_workspaces%rowtype;
  v_total integer;
  v_ready integer;
  v_blockers integer;
  v_snapshot jsonb;
begin
  select * into v_workspace from public.move_in_workspaces where id = p_workspace_id for update;
  if not found then raise exception 'Move-in workspace not found' using errcode = 'P0002'; end if;
  select count(*)::integer,
    count(*) filter (where state in ('completed', 'approved') or (state = 'exception' and approved_at is not null))::integer,
    count(*) filter (where not (
      state in ('completed', 'approved') or (state = 'exception' and approved_at is not null)
    ))::integer
  into v_total, v_ready, v_blockers
  from public.move_in_tasks where workspace_id = p_workspace_id;
  v_snapshot := jsonb_build_object(
    'generatedAt', now(), 'status', case when v_total > 0 and v_blockers = 0 then 'inspection_ready' else 'not_ready' end,
    'totalTasks', v_total, 'readyTasks', v_ready, 'blockers', v_blockers
  );
  update public.move_in_workspaces
  set readiness_snapshot = v_snapshot,
      state = case
        when state in ('completed', 'canceled') then state
        when v_total > 0 and v_blockers = 0 then 'ready'
        else 'active'
      end,
      updated_at = now()
  where id = p_workspace_id;
  return v_snapshot;
end;
$$;
revoke all on function public.refresh_move_in_readiness(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_move_in_readiness(uuid) to service_role;

create or replace function public.start_move_in_workspace(
  p_prospect_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prospect public.admission_prospects%rowtype;
  v_bed public.facility_beds%rowtype;
  v_room public.facility_rooms%rowtype;
  v_template uuid;
  v_resident uuid;
  v_workspace uuid;
  v_task jsonb;
begin
  select * into v_prospect from public.admission_prospects where id = p_prospect_id for update;
  if not found then raise exception 'Prospect not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_prospect.organization_id, v_prospect.facility_id);
  select * into v_bed from public.facility_beds
  where reserved_for_prospect_id = v_prospect.id and status = 'reserved' for update;
  if v_prospect.stage <> 'reserved' or v_bed.id is null
    or v_prospect.expected_move_in_date is null then
    raise exception 'Approved prospect requires a reserved bed and expected move-in date' using errcode = '55000';
  end if;
  select * into v_room from public.facility_rooms where id = v_bed.room_id;
  if v_prospect.resident_id is null then
    insert into public.residents(
      organization_id, facility_id, first_name, last_name, date_of_birth,
      room, bed_id, admission_date, status,
      designated_person_name
    ) values (
      v_prospect.organization_id, v_prospect.facility_id, v_prospect.first_name,
      v_prospect.last_name, v_prospect.date_of_birth, v_room.room_number, v_bed.id,
      v_prospect.expected_move_in_date, 'reserved',
      v_prospect.primary_contact_name
    ) returning id into v_resident;
    update public.admission_prospects set resident_id = v_resident, updated_at = now()
    where id = v_prospect.id;
    insert into public.resident_census_events(
      organization_id, facility_id, resident_id, event_type, resulting_status,
      resulting_bed_id, reason, actor_profile_id
    ) values (
      v_prospect.organization_id, v_prospect.facility_id, v_resident, 'reserved',
      'reserved', v_bed.id, 'Admission workspace started', auth.uid()
    );
  else
    v_resident := v_prospect.resident_id;
  end if;
  select id into v_workspace from public.move_in_workspaces
  where resident_id = v_resident and state <> 'canceled'
  order by created_at desc limit 1;
  if v_workspace is not null then return v_workspace; end if;
  v_template := app_private.ensure_move_in_template(v_prospect.organization_id);
  insert into public.move_in_workspaces(
    organization_id, facility_id, resident_id, template_id,
    target_move_in_date, created_by
  ) values (
    v_prospect.organization_id, v_prospect.facility_id, v_resident,
    v_template, v_prospect.expected_move_in_date, auth.uid()
  ) returning id into v_workspace;
  for v_task in
    select value from jsonb_array_elements(
      (select definition->'tasks' from public.move_in_templates where id = v_template)
    )
  loop
    insert into public.move_in_tasks(
      organization_id, facility_id, workspace_id, task_key, title, due_at,
      depends_on_task_keys, requires_document, requires_signature, requires_approval
    ) values (
      v_prospect.organization_id, v_prospect.facility_id, v_workspace,
      v_task->>'key', v_task->>'title',
      v_prospect.expected_move_in_date::timestamptz
        + make_interval(days => coalesce((v_task->>'dueOffsetDays')::integer, 0)),
      coalesce(array(select jsonb_array_elements_text(v_task->'dependsOn')), array[]::text[]),
      coalesce((v_task->>'requiresDocument')::boolean, false),
      coalesce((v_task->>'requiresSignature')::boolean, false),
      coalesce((v_task->>'requiresApproval')::boolean, false)
    );
  end loop;
  perform public.refresh_move_in_readiness(v_workspace);
  return v_workspace;
end;
$$;

create or replace function public.assign_move_in_task(
  p_task_id uuid,
  p_owner_profile_id uuid,
  p_due_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.move_in_tasks%rowtype;
begin
  select * into v from public.move_in_tasks where id = p_task_id for update;
  if not found then raise exception 'Move-in task not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if p_owner_profile_id is not null and not exists (
    select 1 from public.profiles p where p.id = p_owner_profile_id
      and p.organization_id = v.organization_id and p.is_active
  ) then raise exception 'Owner is outside organization' using errcode = '22023'; end if;
  update public.move_in_tasks set owner_profile_id = p_owner_profile_id,
    due_at = p_due_at, updated_at = now() where id = v.id;
  insert into public.move_in_task_history(
    organization_id, facility_id, workspace_id, task_id, event_type,
    prior_state, resulting_state, reason, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v.workspace_id, v.id, 'assignment',
    v.state, v.state, 'Task assignment updated', auth.uid()
  );
  return true;
end;
$$;

create or replace function public.update_move_in_task(
  p_task_id uuid,
  p_target_state text,
  p_document_id uuid default null,
  p_signature_evidence jsonb default null,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.move_in_tasks%rowtype;
  v_dep text;
begin
  select * into v from public.move_in_tasks where id = p_task_id for update;
  if not found then raise exception 'Move-in task not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if p_target_state not in ('open', 'in_progress', 'submitted', 'approved', 'exception', 'completed')
    or (p_target_state = 'exception' and length(btrim(coalesce(p_reason, ''))) < 5) then
    raise exception 'Invalid move-in task state' using errcode = '22023';
  end if;
  if p_document_id is not null and not exists (
    select 1 from public.resident_documents d
    join public.move_in_workspaces w on w.resident_id = d.resident_id
    where d.id = p_document_id and w.id = v.workspace_id
  ) then raise exception 'Document is outside workspace resident' using errcode = '22023'; end if;
  if p_target_state in ('approved', 'completed') then
    if v.requires_document and coalesce(p_document_id, v.document_id) is null then
      raise exception 'Required document is missing' using errcode = '55000';
    end if;
    if v.requires_signature and coalesce(p_signature_evidence, v.signature_evidence) is null then
      raise exception 'Required signature is missing' using errcode = '55000';
    end if;
    foreach v_dep in array v.depends_on_task_keys loop
      if exists (
        select 1 from public.move_in_tasks d
        where d.workspace_id = v.workspace_id and d.task_key = v_dep
          and not (d.state in ('completed', 'approved') or (d.state = 'exception' and d.approved_at is not null))
      ) then raise exception 'Task dependency is incomplete: %', v_dep using errcode = '55000'; end if;
    end loop;
  end if;
  if v.requires_approval and p_target_state = 'completed' and v.approved_at is null then
    raise exception 'Task requires approval before completion' using errcode = '55000';
  end if;
  update public.move_in_tasks
  set state = p_target_state,
      document_id = coalesce(p_document_id, document_id),
      signature_evidence = coalesce(p_signature_evidence, signature_evidence),
      exception_reason = case when p_target_state = 'exception' then btrim(p_reason) else exception_reason end,
      approved_by = case when p_target_state = 'approved' then auth.uid() else approved_by end,
      approved_at = case when p_target_state = 'approved' then now() else approved_at end,
      updated_at = now()
  where id = v.id;
  insert into public.move_in_task_history(
    organization_id, facility_id, workspace_id, task_id, event_type,
    prior_state, resulting_state, reason, actor_profile_id,
    evidence
  ) values (
    v.organization_id, v.facility_id, v.workspace_id, v.id, 'state_change',
    v.state, p_target_state, coalesce(nullif(btrim(p_reason), ''), 'Move-in task updated'),
    auth.uid(), jsonb_strip_nulls(jsonb_build_object(
      'documentId', p_document_id, 'signatureCaptured', p_signature_evidence is not null
    ))
  );
  perform public.refresh_move_in_readiness(v.workspace_id);
  return true;
end;
$$;

create or replace function public.issue_move_in_guest_grant(
  p_workspace_id uuid,
  p_guest_label text,
  p_task_ids uuid[],
  p_expires_at timestamptz,
  p_terms_version text default 'v1'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.move_in_workspaces%rowtype;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
begin
  select * into v from public.move_in_workspaces where id = p_workspace_id;
  if not found then raise exception 'Move-in workspace not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if p_expires_at <= now() or cardinality(p_task_ids) = 0
    or exists (
      select 1 from unnest(p_task_ids) id
      where not exists (select 1 from public.move_in_tasks t where t.id = id and t.workspace_id = v.id)
    ) then raise exception 'Invalid guest grant scope' using errcode = '22023'; end if;
  insert into public.move_in_guest_grants(
    organization_id, facility_id, workspace_id, resident_id, token_sha256,
    guest_label, allowed_task_ids, expires_at, terms_version, created_by
  ) values (
    v.organization_id, v.facility_id, v.id, v.resident_id,
    encode(extensions.digest(convert_to(v_token, 'utf8'), 'sha256'), 'hex'),
    btrim(p_guest_label), p_task_ids, p_expires_at, p_terms_version, auth.uid()
  ) returning id into v_id;
  return jsonb_build_object('grantId', v_id, 'token', v_token);
end;
$$;

create or replace function public.accept_move_in_guest_terms(
  p_token text,
  p_fingerprint text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.move_in_guest_grants%rowtype;
begin
  select * into v from public.move_in_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
  for update;
  if not found or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'Move-in guest link is invalid or expired' using errcode = '42501';
  end if;
  update public.move_in_guest_grants set accepted_at = coalesce(accepted_at, now()) where id = v.id;
  insert into public.move_in_guest_access_events(
    organization_id, facility_id, guest_grant_id, workspace_id,
    event_type, ip_hash, user_agent_hash
  ) values (
    v.organization_id, v.facility_id, v.id, v.workspace_id, 'view',
    p_fingerprint, p_fingerprint
  );
  return true;
end;
$$;

create or replace function public.revoke_move_in_guest_grant(
  p_grant_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.move_in_guest_grants%rowtype;
begin
  select * into v from public.move_in_guest_grants where id = p_grant_id for update;
  if not found then raise exception 'Move-in guest grant not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Revocation reason is required' using errcode = '22023';
  end if;
  update public.move_in_guest_grants set revoked_at = coalesce(revoked_at, now()) where id = v.id;
  insert into public.move_in_guest_access_events(
    organization_id, facility_id, guest_grant_id, workspace_id, event_type
  ) values (v.organization_id, v.facility_id, v.id, v.workspace_id, 'revoked');
  return true;
end;
$$;

create or replace function public.get_move_in_guest_workspace(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.move_in_guest_grants%rowtype;
  v_resident public.residents%rowtype;
begin
  select * into v from public.move_in_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  if not found or v.revoked_at is not null or v.expires_at <= now() or v.accepted_at is null then
    raise exception 'Move-in guest access denied' using errcode = '42501';
  end if;
  select * into v_resident from public.residents where id = v.resident_id;
  return jsonb_build_object(
    'guestLabel', v.guest_label,
    'residentName', v_resident.first_name || ' ' || left(v_resident.last_name, 1) || '.',
    'expiresAt', v.expires_at,
    'termsVersion', v.terms_version,
    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'state', t.state,
        'requiresSignature', t.requires_signature,
        'requiresDocument', t.requires_document,
        'signed', t.signature_evidence is not null
      ) order by t.due_at), '[]'::jsonb)
      from public.move_in_tasks t where t.id = any(v.allowed_task_ids)
    )
  );
end;
$$;

create or replace function public.sign_move_in_guest_task(
  p_token text,
  p_task_id uuid,
  p_signer_name text,
  p_relationship text,
  p_attestation text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.move_in_guest_grants%rowtype;
  v_task public.move_in_tasks%rowtype;
begin
  select * into v from public.move_in_guest_grants
  where token_sha256 = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
  for update;
  if not found or v.revoked_at is not null or v.expires_at <= now() or v.accepted_at is null
    or not (p_task_id = any(v.allowed_task_ids)) then
    raise exception 'Move-in guest signing denied' using errcode = '42501';
  end if;
  select * into v_task from public.move_in_tasks where id = p_task_id and workspace_id = v.workspace_id for update;
  if not found or not v_task.requires_signature or length(btrim(p_signer_name)) < 2
    or length(btrim(p_attestation)) < 5 then
    raise exception 'Invalid guest signature' using errcode = '22023';
  end if;
  update public.move_in_tasks
  set signature_evidence = jsonb_build_object(
    'signerName', btrim(p_signer_name), 'relationship', btrim(p_relationship),
    'attestation', btrim(p_attestation), 'signedAt', now(),
    'authenticationMethod', 'expiring_guest_link', 'termsVersion', v.terms_version
  ), state = 'submitted', updated_at = now()
  where id = v_task.id;
  insert into public.move_in_guest_access_events(
    organization_id, facility_id, guest_grant_id, workspace_id, task_id, event_type
  ) values (
    v.organization_id, v.facility_id, v.id, v.workspace_id, v_task.id, 'sign'
  );
  insert into public.move_in_task_history(
    organization_id, facility_id, workspace_id, task_id, event_type,
    prior_state, resulting_state, reason, evidence
  ) values (
    v.organization_id, v.facility_id, v.workspace_id, v_task.id, 'guest_signature',
    v_task.state, 'submitted', 'Guest signature captured',
    jsonb_build_object('guestGrantId', v.id, 'signerName', btrim(p_signer_name))
  );
  perform public.refresh_move_in_readiness(v.workspace_id);
  return true;
end;
$$;

create or replace function public.complete_move_in_admission(
  p_workspace_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.move_in_workspaces%rowtype;
  v_resident public.residents%rowtype;
  v_prospect public.admission_prospects%rowtype;
  v_bed public.facility_beds%rowtype;
begin
  select * into v from public.move_in_workspaces where id = p_workspace_id for update;
  if not found then raise exception 'Move-in workspace not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
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
  set status = 'active', admission_date = current_date, discharge_date = null,
      updated_at = now()
  where id = v_resident.id;
  update public.admission_prospects set stage = 'admitted', updated_at = now()
  where id = v_prospect.id;
  update public.move_in_workspaces
  set state = 'completed',
      readiness_snapshot = readiness_snapshot || jsonb_build_object(
        'admittedAt', now(), 'admittedBy', auth.uid(), 'admissionReason', btrim(p_reason)
      ),
      updated_at = now()
  where id = v.id;
  insert into public.resident_census_events(
    organization_id, facility_id, resident_id, event_type, prior_status,
    resulting_status, prior_bed_id, resulting_bed_id, reason, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v_resident.id, 'admitted',
    v_resident.status, 'active', v_resident.bed_id, v_resident.bed_id,
    btrim(p_reason), auth.uid()
  );
  return v_resident.id;
end;
$$;

create or replace function public.transition_resident_census(
  p_resident_id uuid,
  p_target_status text,
  p_bed_id uuid default null,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.residents%rowtype;
  v_bed public.facility_beds%rowtype;
  v_event text;
begin
  select * into v from public.residents where id = p_resident_id for update;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v.organization_id, v.facility_id);
  if p_target_status not in ('active', 'temporarily_out', 'hospital_leave', 'discharged', 'deceased')
    or length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Invalid census transition' using errcode = '22023';
  end if;
  if p_bed_id is not null then
    select * into v_bed from public.facility_beds where id = p_bed_id for update;
    if v_bed.facility_id <> v.facility_id
      or (v_bed.status <> 'available' and v_bed.occupied_by_resident_id <> v.id) then
      raise exception 'Target bed is unavailable' using errcode = '55000';
    end if;
  end if;
  v_event := case
    when p_target_status = 'active' and v.status in ('temporarily_out', 'hospital_leave') then 'returned'
    when p_target_status = 'active' and v.status = 'reserved' then 'admitted'
    when p_target_status = 'active' and p_bed_id is not null and p_bed_id is distinct from v.bed_id then 'room_transfer'
    else p_target_status
  end;
  if p_target_status = v.status and p_bed_id is not distinct from v.bed_id then
    raise exception 'Census transition would not change resident state' using errcode = '22023';
  end if;
  if p_bed_id is not null and p_bed_id is distinct from v.bed_id then
    update public.facility_beds set status = 'available', occupied_by_resident_id = null,
      expected_vacancy_date = null, updated_at = now()
    where id = v.bed_id and occupied_by_resident_id = v.id;
    update public.facility_beds set status = 'occupied', occupied_by_resident_id = v.id,
      reserved_for_prospect_id = null, updated_at = now() where id = p_bed_id;
  end if;
  if p_target_status in ('discharged', 'deceased') then
    update public.facility_beds set status = 'available', occupied_by_resident_id = null,
      expected_vacancy_date = null, updated_at = now()
    where id = v.bed_id and occupied_by_resident_id = v.id;
  end if;
  update public.residents
  set status = p_target_status,
      bed_id = case when p_target_status in ('discharged', 'deceased') then null else coalesce(p_bed_id, bed_id) end,
      room = case
        when p_target_status in ('discharged', 'deceased') then room
        when p_bed_id is not null then (select room_number from public.facility_rooms where id = v_bed.room_id)
        else room end,
      discharge_date = case when p_target_status in ('discharged', 'deceased') then current_date else null end,
      updated_at = now()
  where id = v.id;
  insert into public.resident_census_events(
    organization_id, facility_id, resident_id, event_type, prior_status,
    resulting_status, prior_bed_id, resulting_bed_id, reason, actor_profile_id
  ) values (
    v.organization_id, v.facility_id, v.id, v_event, v.status,
    p_target_status, v.bed_id,
    case when p_target_status in ('discharged', 'deceased') then null else coalesce(p_bed_id, v.bed_id) end,
    btrim(p_reason), auth.uid()
  );
  return true;
end;
$$;

revoke all on function public.create_referral_source(uuid, text, text, text, text, text),
  public.create_admission_prospect(uuid, text, text, date, text, text, uuid, date, text, text, text, text, text),
  public.update_admission_prospect(uuid, text, text, text, date, text, text, text),
  public.record_admission_activity(uuid, text, timestamptz, text, text),
  public.create_room_with_beds(uuid, text, text, text, text, integer, text, integer),
  public.set_bed_availability(uuid, text, text, date),
  public.reserve_bed_for_prospect(uuid, uuid),
  public.start_move_in_workspace(uuid),
  public.assign_move_in_task(uuid, uuid, timestamptz),
  public.update_move_in_task(uuid, text, uuid, jsonb, text),
  public.issue_move_in_guest_grant(uuid, text, uuid[], timestamptz, text),
  public.revoke_move_in_guest_grant(uuid, text),
  public.complete_move_in_admission(uuid, text),
  public.transition_resident_census(uuid, text, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.create_referral_source(uuid, text, text, text, text, text),
  public.create_admission_prospect(uuid, text, text, date, text, text, uuid, date, text, text, text, text, text),
  public.update_admission_prospect(uuid, text, text, text, date, text, text, text),
  public.record_admission_activity(uuid, text, timestamptz, text, text),
  public.create_room_with_beds(uuid, text, text, text, text, integer, text, integer),
  public.set_bed_availability(uuid, text, text, date),
  public.reserve_bed_for_prospect(uuid, uuid),
  public.start_move_in_workspace(uuid),
  public.assign_move_in_task(uuid, uuid, timestamptz),
  public.update_move_in_task(uuid, text, uuid, jsonb, text),
  public.issue_move_in_guest_grant(uuid, text, uuid[], timestamptz, text),
  public.revoke_move_in_guest_grant(uuid, text),
  public.complete_move_in_admission(uuid, text),
  public.transition_resident_census(uuid, text, uuid, text)
to authenticated;

revoke all on function public.accept_move_in_guest_terms(text, text),
  public.get_move_in_guest_workspace(text),
  public.sign_move_in_guest_task(text, uuid, text, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.accept_move_in_guest_terms(text, text),
  public.get_move_in_guest_workspace(text),
  public.sign_move_in_guest_task(text, uuid, text, text, text)
to anon, authenticated;
