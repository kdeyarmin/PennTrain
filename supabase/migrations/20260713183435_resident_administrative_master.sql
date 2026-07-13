-- Priority 11: authoritative administrative and residential-care profile.
-- This intentionally excludes diagnoses, orders, medications, progress notes, and other EHR data.

alter table public.residents
  add column preferred_name text,
  add column photo_document_id uuid references public.resident_documents(id) on delete set null,
  add column prior_address_line1 text,
  add column prior_address_line2 text,
  add column prior_address_city text,
  add column prior_address_state text,
  add column prior_address_postal_code text,
  add column pharmacy_name text,
  add column pharmacy_phone text,
  add column pharmacy_email text,
  add column hospice_home_health_agency_name text,
  add column hospice_home_health_agency_phone text,
  add column insurance_payer_name text,
  add column insurance_member_id text,
  add column insurance_group_number text,
  add column secondary_payer_name text,
  add column dietary_requirements text,
  add column food_allergies text[] not null default array[]::text[],
  add column mobility_summary text,
  add column supervision_requirements text,
  add column communication_preferences text,
  add column preferred_language text,
  add column religious_cultural_preferences text,
  add column advance_directive_status text not null default 'unknown'
    check (advance_directive_status in ('unknown', 'not_on_file', 'on_file', 'declined')),
  add column resident_rights_acknowledged_at timestamptz,
  add column resident_rights_document_id uuid references public.resident_documents(id) on delete set null,
  add column contract_status text not null default 'pending'
    check (contract_status in ('pending', 'executed', 'amended', 'expired', 'terminated', 'not_applicable')),
  add column contract_effective_date date,
  add column contract_document_id uuid references public.resident_documents(id) on delete set null;

create table public.resident_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete cascade,
  contact_type text not null check (contact_type in (
    'emergency_contact', 'designated_person', 'guardian', 'power_of_attorney',
    'primary_care_provider', 'dentist', 'pharmacy', 'case_manager',
    'hospice_agency', 'home_health_agency', 'insurer', 'other'
  )),
  name text not null check (length(btrim(name)) > 0),
  relationship text,
  legal_authority text,
  phone text,
  alternate_phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  is_primary boolean not null default false,
  receives_notifications boolean not null default false,
  notes text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resident_contacts_resident_idx
  on public.resident_contacts(resident_id, active, contact_type, sort_order);
create unique index resident_contacts_primary_type_idx
  on public.resident_contacts(resident_id, contact_type)
  where active and is_primary;

create table public.resident_property_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete cascade,
  item_name text not null check (length(btrim(item_name)) > 0),
  quantity integer not null default 1 check (quantity > 0),
  description text,
  condition_at_receipt text,
  received_on date,
  released_on date,
  disposition text,
  resident_acknowledged_at timestamptz,
  document_id uuid references public.resident_documents(id) on delete set null,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (released_on is null or received_on is null or released_on >= received_on)
);
create index resident_property_items_resident_idx
  on public.resident_property_items(resident_id, active, created_at desc);

create table public.resident_legal_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete cascade,
  record_type text not null check (record_type in (
    'court_order', 'advance_directive', 'resident_rights_acknowledgement',
    'resident_contract', 'insurance_payer', 'guardianship', 'power_of_attorney', 'other'
  )),
  title text not null check (length(btrim(title)) > 0),
  status text not null default 'active'
    check (status in ('pending', 'active', 'superseded', 'revoked', 'expired', 'declined')),
  authority_name text,
  summary text,
  effective_date date,
  expiration_date date,
  acknowledged_at timestamptz,
  document_id uuid references public.resident_documents(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiration_date is null or effective_date is null or expiration_date >= effective_date)
);
create index resident_legal_records_resident_idx
  on public.resident_legal_records(resident_id, record_type, status, created_at desc);

create table public.resident_administrative_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  resident_id uuid not null references public.residents(id) on delete restrict,
  event_type text not null,
  summary text not null,
  snapshot jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  occurred_at timestamptz not null default now()
);
create index resident_administrative_history_resident_idx
  on public.resident_administrative_history(resident_id, occurred_at desc);

create trigger set_updated_at before update on public.resident_contacts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.resident_property_items
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.resident_legal_records
  for each row execute function public.set_updated_at();

create trigger audit_log after insert or update or delete on public.resident_contacts
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.resident_property_items
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.resident_legal_records
  for each row execute function public.audit_log_trigger();

create or replace function app_private.validate_resident_administrative_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_resident public.residents%rowtype;
  v_document public.resident_documents%rowtype;
begin
  select * into v_resident from public.residents where id = new.resident_id;
  if not found then raise exception 'Resident not found' using errcode = '23503'; end if;
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.facility_id is distinct from old.facility_id
    or new.resident_id is distinct from old.resident_id
  ) then raise exception 'Resident administrative scope is immutable' using errcode = '23514'; end if;
  new.organization_id := v_resident.organization_id;
  new.facility_id := v_resident.facility_id;
  if tg_table_name in ('resident_property_items', 'resident_legal_records')
    and nullif(to_jsonb(new)->>'document_id', '') is not null then
    select * into v_document from public.resident_documents
    where id = (to_jsonb(new)->>'document_id')::uuid;
    if not found or v_document.resident_id <> v_resident.id then
      raise exception 'Document is outside resident record' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.validate_resident_administrative_scope() from public, anon, authenticated;

create trigger validate_resident_administrative_scope
before insert or update on public.resident_contacts
for each row execute function app_private.validate_resident_administrative_scope();
create trigger validate_resident_administrative_scope
before insert or update on public.resident_property_items
for each row execute function app_private.validate_resident_administrative_scope();
create trigger validate_resident_administrative_scope
before insert or update on public.resident_legal_records
for each row execute function app_private.validate_resident_administrative_scope();

create trigger prevent_resident_administrative_history_mutation
before update or delete on public.resident_administrative_history
for each row execute function app_private.prevent_phase5_evidence_mutation();

alter table public.resident_contacts enable row level security;
alter table public.resident_property_items enable row level security;
alter table public.resident_legal_records enable row level security;
alter table public.resident_administrative_history enable row level security;

create policy resident_contacts_select on public.resident_contacts
for select to authenticated
using (app_private.admission_row_visible(organization_id, facility_id));
create policy resident_property_items_select on public.resident_property_items
for select to authenticated
using (app_private.admission_row_visible(organization_id, facility_id));
create policy resident_legal_records_select on public.resident_legal_records
for select to authenticated
using (app_private.admission_row_visible(organization_id, facility_id));
create policy resident_administrative_history_select on public.resident_administrative_history
for select to authenticated
using (app_private.admission_row_visible(organization_id, facility_id));

revoke all on table public.resident_contacts, public.resident_property_items,
  public.resident_legal_records, public.resident_administrative_history
from public, anon, authenticated, service_role;
grant select on table public.resident_contacts, public.resident_property_items,
  public.resident_legal_records, public.resident_administrative_history
to authenticated;
grant all on table public.resident_contacts, public.resident_property_items,
  public.resident_legal_records, public.resident_administrative_history
to service_role;

-- Preserve data entered through the earlier Part I resident fields.
insert into public.resident_contacts(
  organization_id, facility_id, resident_id, contact_type, name, phone,
  is_primary, receives_notifications, sort_order
)
select organization_id, facility_id, id, contact_type, name, phone, true,
  contact_type = 'designated_person', sort_order
from public.residents r
cross join lateral (values
  ('primary_care_provider'::text, r.primary_physician_name, r.primary_physician_phone, 0),
  ('dentist', r.dentist_name, r.dentist_phone, 1),
  ('case_manager', r.case_manager_name, r.case_manager_phone, 2),
  ('designated_person', r.designated_person_name, null::text, 3)
) existing(contact_type, name, phone, sort_order)
where nullif(btrim(name), '') is not null;

create or replace function public.save_resident_administrative_master(
  p_resident_id uuid,
  p_profile jsonb,
  p_contacts jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resident public.residents%rowtype;
  v_contact jsonb;
  v_contact_id uuid;
  v_snapshot jsonb;
  v_document_id uuid;
begin
  select * into v_resident from public.residents where id = p_resident_id for update;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_resident.organization_id, v_resident.facility_id);
  if jsonb_typeof(coalesce(p_profile, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_contacts, '[]'::jsonb)) <> 'array' then
    raise exception 'Administrative profile payload is invalid' using errcode = '22023';
  end if;

  foreach v_document_id in array array[
    nullif(p_profile->>'photo_document_id', '')::uuid,
    nullif(p_profile->>'resident_rights_document_id', '')::uuid,
    nullif(p_profile->>'contract_document_id', '')::uuid
  ] loop
    if v_document_id is not null and not exists (
      select 1 from public.resident_documents d
      where d.id = v_document_id and d.resident_id = v_resident.id
    ) then raise exception 'Document is outside resident record' using errcode = '23514'; end if;
  end loop;

  update public.residents set
    preferred_name = case when p_profile ? 'preferred_name' then nullif(btrim(p_profile->>'preferred_name'), '') else preferred_name end,
    photo_document_id = case when p_profile ? 'photo_document_id' then nullif(p_profile->>'photo_document_id', '')::uuid else photo_document_id end,
    date_of_birth = case when p_profile ? 'date_of_birth' then nullif(p_profile->>'date_of_birth', '')::date else date_of_birth end,
    prior_address_line1 = case when p_profile ? 'prior_address_line1' then nullif(btrim(p_profile->>'prior_address_line1'), '') else prior_address_line1 end,
    prior_address_line2 = case when p_profile ? 'prior_address_line2' then nullif(btrim(p_profile->>'prior_address_line2'), '') else prior_address_line2 end,
    prior_address_city = case when p_profile ? 'prior_address_city' then nullif(btrim(p_profile->>'prior_address_city'), '') else prior_address_city end,
    prior_address_state = case when p_profile ? 'prior_address_state' then nullif(upper(btrim(p_profile->>'prior_address_state')), '') else prior_address_state end,
    prior_address_postal_code = case when p_profile ? 'prior_address_postal_code' then nullif(btrim(p_profile->>'prior_address_postal_code'), '') else prior_address_postal_code end,
    insurance_payer_name = case when p_profile ? 'insurance_payer_name' then nullif(btrim(p_profile->>'insurance_payer_name'), '') else insurance_payer_name end,
    insurance_member_id = case when p_profile ? 'insurance_member_id' then nullif(btrim(p_profile->>'insurance_member_id'), '') else insurance_member_id end,
    insurance_group_number = case when p_profile ? 'insurance_group_number' then nullif(btrim(p_profile->>'insurance_group_number'), '') else insurance_group_number end,
    secondary_payer_name = case when p_profile ? 'secondary_payer_name' then nullif(btrim(p_profile->>'secondary_payer_name'), '') else secondary_payer_name end,
    dietary_requirements = case when p_profile ? 'dietary_requirements' then nullif(btrim(p_profile->>'dietary_requirements'), '') else dietary_requirements end,
    food_allergies = case when p_profile ? 'food_allergies' then array(
      select distinct btrim(value) from jsonb_array_elements_text(coalesce(p_profile->'food_allergies', '[]'::jsonb))
      where btrim(value) <> '' order by btrim(value)
    ) else food_allergies end,
    mobility_summary = case when p_profile ? 'mobility_summary' then nullif(btrim(p_profile->>'mobility_summary'), '') else mobility_summary end,
    supervision_requirements = case when p_profile ? 'supervision_requirements' then nullif(btrim(p_profile->>'supervision_requirements'), '') else supervision_requirements end,
    communication_preferences = case when p_profile ? 'communication_preferences' then nullif(btrim(p_profile->>'communication_preferences'), '') else communication_preferences end,
    preferred_language = case when p_profile ? 'preferred_language' then nullif(btrim(p_profile->>'preferred_language'), '') else preferred_language end,
    religious_cultural_preferences = case when p_profile ? 'religious_cultural_preferences' then nullif(btrim(p_profile->>'religious_cultural_preferences'), '') else religious_cultural_preferences end,
    advance_directive_status = case when p_profile ? 'advance_directive_status' then p_profile->>'advance_directive_status' else advance_directive_status end,
    resident_rights_acknowledged_at = case when p_profile ? 'resident_rights_acknowledged_at' then nullif(p_profile->>'resident_rights_acknowledged_at', '')::timestamptz else resident_rights_acknowledged_at end,
    resident_rights_document_id = case when p_profile ? 'resident_rights_document_id' then nullif(p_profile->>'resident_rights_document_id', '')::uuid else resident_rights_document_id end,
    contract_status = case when p_profile ? 'contract_status' then p_profile->>'contract_status' else contract_status end,
    contract_effective_date = case when p_profile ? 'contract_effective_date' then nullif(p_profile->>'contract_effective_date', '')::date else contract_effective_date end,
    contract_document_id = case when p_profile ? 'contract_document_id' then nullif(p_profile->>'contract_document_id', '')::uuid else contract_document_id end,
    updated_at = now()
  where id = v_resident.id;

  update public.resident_contacts set active = false, is_primary = false, updated_at = now()
  where resident_id = v_resident.id and active;

  for v_contact in select value from jsonb_array_elements(p_contacts) loop
    if (v_contact->>'contact_type') not in (
      'emergency_contact', 'designated_person', 'guardian', 'power_of_attorney',
      'primary_care_provider', 'dentist', 'pharmacy', 'case_manager',
      'hospice_agency', 'home_health_agency', 'insurer', 'other'
    ) or length(btrim(coalesce(v_contact->>'name', ''))) < 1 then
      raise exception 'Resident contact is invalid' using errcode = '22023';
    end if;
    v_contact_id := nullif(v_contact->>'id', '')::uuid;
    if v_contact_id is null then
      insert into public.resident_contacts(
        organization_id, facility_id, resident_id, contact_type, name, relationship,
        legal_authority, phone, alternate_phone, email, address_line1, address_line2,
        city, state, postal_code, is_primary, receives_notifications, notes,
        sort_order, active, created_by
      ) values (
        v_resident.organization_id, v_resident.facility_id, v_resident.id,
        v_contact->>'contact_type', btrim(v_contact->>'name'), nullif(btrim(v_contact->>'relationship'), ''),
        nullif(btrim(v_contact->>'legal_authority'), ''), nullif(btrim(v_contact->>'phone'), ''),
        nullif(btrim(v_contact->>'alternate_phone'), ''), nullif(btrim(v_contact->>'email'), ''),
        nullif(btrim(v_contact->>'address_line1'), ''), nullif(btrim(v_contact->>'address_line2'), ''),
        nullif(btrim(v_contact->>'city'), ''), nullif(upper(btrim(v_contact->>'state')), ''),
        nullif(btrim(v_contact->>'postal_code'), ''), coalesce((v_contact->>'is_primary')::boolean, false),
        coalesce((v_contact->>'receives_notifications')::boolean, false), nullif(btrim(v_contact->>'notes'), ''),
        coalesce((v_contact->>'sort_order')::integer, 0), true, auth.uid()
      );
    else
      update public.resident_contacts set
        contact_type = v_contact->>'contact_type', name = btrim(v_contact->>'name'),
        relationship = nullif(btrim(v_contact->>'relationship'), ''),
        legal_authority = nullif(btrim(v_contact->>'legal_authority'), ''),
        phone = nullif(btrim(v_contact->>'phone'), ''), alternate_phone = nullif(btrim(v_contact->>'alternate_phone'), ''),
        email = nullif(btrim(v_contact->>'email'), ''), address_line1 = nullif(btrim(v_contact->>'address_line1'), ''),
        address_line2 = nullif(btrim(v_contact->>'address_line2'), ''), city = nullif(btrim(v_contact->>'city'), ''),
        state = nullif(upper(btrim(v_contact->>'state')), ''), postal_code = nullif(btrim(v_contact->>'postal_code'), ''),
        is_primary = coalesce((v_contact->>'is_primary')::boolean, false),
        receives_notifications = coalesce((v_contact->>'receives_notifications')::boolean, false),
        notes = nullif(btrim(v_contact->>'notes'), ''), sort_order = coalesce((v_contact->>'sort_order')::integer, 0),
        active = true, updated_at = now()
      where id = v_contact_id and resident_id = v_resident.id;
      if not found then raise exception 'Resident contact not found' using errcode = 'P0002'; end if;
    end if;
  end loop;

  update public.residents r set
    primary_physician_name = (select c.name from public.resident_contacts c where c.resident_id = r.id and c.active and c.contact_type = 'primary_care_provider' order by c.is_primary desc, c.sort_order limit 1),
    primary_physician_phone = (select c.phone from public.resident_contacts c where c.resident_id = r.id and c.active and c.contact_type = 'primary_care_provider' order by c.is_primary desc, c.sort_order limit 1),
    dentist_name = (select c.name from public.resident_contacts c where c.resident_id = r.id and c.active and c.contact_type = 'dentist' order by c.is_primary desc, c.sort_order limit 1),
    dentist_phone = (select c.phone from public.resident_contacts c where c.resident_id = r.id and c.active and c.contact_type = 'dentist' order by c.is_primary desc, c.sort_order limit 1),
    case_manager_name = (select c.name from public.resident_contacts c where c.resident_id = r.id and c.active and c.contact_type = 'case_manager' order by c.is_primary desc, c.sort_order limit 1),
    case_manager_phone = (select c.phone from public.resident_contacts c where c.resident_id = r.id and c.active and c.contact_type = 'case_manager' order by c.is_primary desc, c.sort_order limit 1),
    designated_person_name = (select c.name from public.resident_contacts c where c.resident_id = r.id and c.active and c.contact_type = 'designated_person' order by c.is_primary desc, c.sort_order limit 1),
    pharmacy_name = (select c.name from public.resident_contacts c where c.resident_id = r.id and c.active and c.contact_type = 'pharmacy' order by c.is_primary desc, c.sort_order limit 1),
    pharmacy_phone = (select c.phone from public.resident_contacts c where c.resident_id = r.id and c.active and c.contact_type = 'pharmacy' order by c.is_primary desc, c.sort_order limit 1),
    pharmacy_email = (select c.email from public.resident_contacts c where c.resident_id = r.id and c.active and c.contact_type = 'pharmacy' order by c.is_primary desc, c.sort_order limit 1),
    hospice_home_health_agency_name = (select c.name from public.resident_contacts c where c.resident_id = r.id and c.active and c.contact_type in ('hospice_agency', 'home_health_agency') order by c.is_primary desc, c.sort_order limit 1),
    hospice_home_health_agency_phone = (select c.phone from public.resident_contacts c where c.resident_id = r.id and c.active and c.contact_type in ('hospice_agency', 'home_health_agency') order by c.is_primary desc, c.sort_order limit 1),
    updated_at = now()
  where r.id = v_resident.id;

  select jsonb_build_object(
    'profile', to_jsonb(r) - 'organization_id',
    'contacts', coalesce((select jsonb_agg(to_jsonb(c) - 'organization_id' order by c.sort_order, c.created_at) from public.resident_contacts c where c.resident_id = r.id and c.active), '[]'::jsonb)
  ) into v_snapshot from public.residents r where r.id = v_resident.id;
  insert into public.resident_administrative_history(
    organization_id, facility_id, resident_id, event_type, summary, snapshot, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'master_record_updated', 'Administrative master record updated', v_snapshot, auth.uid()
  );
  return true;
end;
$$;

create or replace function public.upsert_resident_property_item(
  p_resident_id uuid,
  p_item_name text,
  p_quantity integer,
  p_item_id uuid default null,
  p_description text default null,
  p_condition_at_receipt text default null,
  p_received_on date default null,
  p_released_on date default null,
  p_disposition text default null,
  p_resident_acknowledged_at timestamptz default null,
  p_document_id uuid default null,
  p_notes text default null,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_resident public.residents%rowtype; v_id uuid;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_resident.organization_id, v_resident.facility_id);
  if length(btrim(coalesce(p_item_name, ''))) < 1 or coalesce(p_quantity, 0) < 1 then
    raise exception 'Property item is invalid' using errcode = '22023';
  end if;
  if p_item_id is null then
    insert into public.resident_property_items(
      organization_id, facility_id, resident_id, item_name, quantity, description,
      condition_at_receipt, received_on, released_on, disposition,
      resident_acknowledged_at, document_id, notes, active, created_by
    ) values (
      v_resident.organization_id, v_resident.facility_id, v_resident.id, btrim(p_item_name), p_quantity,
      nullif(btrim(p_description), ''), nullif(btrim(p_condition_at_receipt), ''), p_received_on,
      p_released_on, nullif(btrim(p_disposition), ''), p_resident_acknowledged_at,
      p_document_id, nullif(btrim(p_notes), ''), p_active, auth.uid()
    ) returning id into v_id;
  else
    update public.resident_property_items set item_name = btrim(p_item_name), quantity = p_quantity,
      description = nullif(btrim(p_description), ''), condition_at_receipt = nullif(btrim(p_condition_at_receipt), ''),
      received_on = p_received_on, released_on = p_released_on, disposition = nullif(btrim(p_disposition), ''),
      resident_acknowledged_at = p_resident_acknowledged_at, document_id = p_document_id,
      notes = nullif(btrim(p_notes), ''), active = p_active, updated_at = now()
    where id = p_item_id and resident_id = v_resident.id returning id into v_id;
    if v_id is null then raise exception 'Property item not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.resident_administrative_history(
    organization_id, facility_id, resident_id, event_type, summary, snapshot, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'property_inventory_updated', 'Property inventory updated',
    (select to_jsonb(i) - 'organization_id' from public.resident_property_items i where i.id = v_id), auth.uid()
  );
  return v_id;
end;
$$;

create or replace function public.upsert_resident_legal_record(
  p_resident_id uuid,
  p_record_type text,
  p_title text,
  p_status text,
  p_record_id uuid default null,
  p_authority_name text default null,
  p_summary text default null,
  p_effective_date date default null,
  p_expiration_date date default null,
  p_acknowledged_at timestamptz default null,
  p_document_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_resident public.residents%rowtype; v_id uuid;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  perform app_private.assert_admission_manager(v_resident.organization_id, v_resident.facility_id);
  if p_record_type not in ('court_order', 'advance_directive', 'resident_rights_acknowledgement', 'resident_contract', 'insurance_payer', 'guardianship', 'power_of_attorney', 'other')
    or p_status not in ('pending', 'active', 'superseded', 'revoked', 'expired', 'declined')
    or length(btrim(coalesce(p_title, ''))) < 1 then
    raise exception 'Legal record is invalid' using errcode = '22023';
  end if;
  if p_record_id is null then
    insert into public.resident_legal_records(
      organization_id, facility_id, resident_id, record_type, title, status,
      authority_name, summary, effective_date, expiration_date, acknowledged_at,
      document_id, created_by
    ) values (
      v_resident.organization_id, v_resident.facility_id, v_resident.id, p_record_type,
      btrim(p_title), p_status, nullif(btrim(p_authority_name), ''), nullif(btrim(p_summary), ''),
      p_effective_date, p_expiration_date, p_acknowledged_at, p_document_id, auth.uid()
    ) returning id into v_id;
  else
    update public.resident_legal_records set record_type = p_record_type, title = btrim(p_title),
      status = p_status, authority_name = nullif(btrim(p_authority_name), ''),
      summary = nullif(btrim(p_summary), ''), effective_date = p_effective_date,
      expiration_date = p_expiration_date, acknowledged_at = p_acknowledged_at,
      document_id = p_document_id, updated_at = now()
    where id = p_record_id and resident_id = v_resident.id returning id into v_id;
    if v_id is null then raise exception 'Legal record not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.resident_administrative_history(
    organization_id, facility_id, resident_id, event_type, summary, snapshot, actor_profile_id
  ) values (
    v_resident.organization_id, v_resident.facility_id, v_resident.id,
    'legal_record_updated', 'Legal and document record updated',
    (select to_jsonb(r) - 'organization_id' from public.resident_legal_records r where r.id = v_id), auth.uid()
  );
  return v_id;
end;
$$;

revoke all on function public.save_resident_administrative_master(uuid, jsonb, jsonb),
  public.upsert_resident_property_item(uuid, text, integer, uuid, text, text, date, date, text, timestamptz, uuid, text, boolean),
  public.upsert_resident_legal_record(uuid, text, text, text, uuid, text, text, date, date, timestamptz, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.save_resident_administrative_master(uuid, jsonb, jsonb),
  public.upsert_resident_property_item(uuid, text, integer, uuid, text, text, date, date, text, timestamptz, uuid, text, boolean),
  public.upsert_resident_legal_record(uuid, text, text, text, uuid, text, text, date, date, timestamptz, uuid)
to authenticated;

create or replace function public.get_resident_administrative_packet(p_resident_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_resident public.residents%rowtype;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'Resident not found' using errcode = 'P0002'; end if;
  if not app_private.admission_row_visible(v_resident.organization_id, v_resident.facility_id) then
    raise exception 'Resident administrative packet is outside caller scope' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'resident', jsonb_build_object(
      'id', v_resident.id, 'firstName', v_resident.first_name, 'lastName', v_resident.last_name,
      'preferredName', v_resident.preferred_name, 'dateOfBirth', v_resident.date_of_birth,
      'room', v_resident.room, 'status', v_resident.status,
      'priorAddress', jsonb_build_object('line1', v_resident.prior_address_line1, 'line2', v_resident.prior_address_line2, 'city', v_resident.prior_address_city, 'state', v_resident.prior_address_state, 'postalCode', v_resident.prior_address_postal_code),
      'payer', jsonb_build_object('name', v_resident.insurance_payer_name, 'memberId', v_resident.insurance_member_id, 'groupNumber', v_resident.insurance_group_number, 'secondary', v_resident.secondary_payer_name),
      'dietaryRequirements', v_resident.dietary_requirements, 'foodAllergies', v_resident.food_allergies,
      'mobilitySummary', v_resident.mobility_summary, 'supervisionRequirements', v_resident.supervision_requirements,
      'communicationPreferences', v_resident.communication_preferences, 'preferredLanguage', v_resident.preferred_language,
      'religiousCulturalPreferences', v_resident.religious_cultural_preferences,
      'advanceDirectiveStatus', v_resident.advance_directive_status,
      'residentRightsAcknowledgedAt', v_resident.resident_rights_acknowledged_at,
      'contractStatus', v_resident.contract_status, 'contractEffectiveDate', v_resident.contract_effective_date
    ),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'type', c.contact_type, 'name', c.name, 'relationship', c.relationship,
      'legalAuthority', c.legal_authority, 'phone', c.phone, 'alternatePhone', c.alternate_phone,
      'email', c.email, 'isPrimary', c.is_primary, 'receivesNotifications', c.receives_notifications
    ) order by c.sort_order, c.created_at) from public.resident_contacts c where c.resident_id = v_resident.id and c.active), '[]'::jsonb),
    'propertyInventory', coalesce((select jsonb_agg(to_jsonb(i) - 'organization_id' order by i.created_at) from public.resident_property_items i where i.resident_id = v_resident.id and i.active), '[]'::jsonb),
    'legalRecords', coalesce((select jsonb_agg(to_jsonb(l) - 'organization_id' order by l.created_at) from public.resident_legal_records l where l.resident_id = v_resident.id), '[]'::jsonb),
    'lifecycle', coalesce((select jsonb_agg(to_jsonb(e) - 'organization_id' order by e.effective_at) from public.resident_census_events e where e.resident_id = v_resident.id), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_resident_administrative_packet(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_resident_administrative_packet(uuid) to authenticated;

-- Keep the expiring designated-person portal deliberately minimal while reusing the same source.
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
    'residentName', coalesce(v_resident.preferred_name, v_resident.first_name) || ' ' || left(v_resident.last_name, 1) || '.',
    'residentProfile', jsonb_build_object(
      'preferredName', v_resident.preferred_name,
      'preferredLanguage', v_resident.preferred_language,
      'communicationPreferences', v_resident.communication_preferences,
      'contractStatus', v_resident.contract_status,
      'residentRightsAcknowledgedAt', v_resident.resident_rights_acknowledged_at
    ),
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
revoke all on function public.get_move_in_guest_workspace(text) from public, anon, authenticated, service_role;
grant execute on function public.get_move_in_guest_workspace(text) to anon, authenticated;
