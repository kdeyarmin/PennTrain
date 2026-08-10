-- Room upserts only ever added beds: both create_room_with_beds (the interactive form and
-- the browser CSV applier) and import_apply_room_with_beds (the durable worker) inserted
-- labels A..N with `on conflict do nothing` and left everything else in the room alone. A
-- rooms import that lowers bed_count (a semi-private converted to private, say) therefore
-- reported "applied" while the surplus bed rows survived, overstating inventory and census
-- capacity everywhere bed counts roll up. Both appliers also had no way to write
-- facility_rooms.is_active: the table's UPDATE grant is deliberately revoked from
-- authenticated (20260801220000 documents this as load-bearing), so the browser applier's
-- direct `update ... set is_active` silently failed with 42501 on every row and the CSV
-- status column never landed.
--
-- Now both RPCs share one reconcile: beds outside the imported label set are deleted when
-- they are plainly removable, the row fails with a clear message when any of them is
-- occupied, reserved, or held (silently dropping a bed a resident is in is not an import's
-- decision to make), and an explicit p_is_active lands through the SECURITY DEFINER path
-- instead of a doomed table update.

create or replace function app_private.reconcile_room_beds(
  p_room_id uuid,
  p_room_number text,
  p_bed_count integer
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_target_labels text[];
  v_blocking text;
begin
  select array_agg(chr(64 + g)) into v_target_labels from generate_series(1, p_bed_count) g;

  -- Lock the room's beds so the blocking check and the delete see the same set; without
  -- this, a bed reserved between the two statements would silently survive the reconcile.
  perform 1 from public.facility_beds where room_id = p_room_id for update;

  select string_agg(b.bed_label, ', ' order by b.bed_label) into v_blocking
  from public.facility_beds b
  where b.room_id = p_room_id
    and not (b.bed_label = any (v_target_labels))
    and (b.status <> 'available'
      or b.occupied_by_resident_id is not null
      or b.reserved_for_prospect_id is not null);
  if v_blocking is not null then
    raise exception 'Cannot reduce room % to % bed(s): bed(s) % are occupied, reserved, or held',
      p_room_number, p_bed_count, v_blocking using errcode = '55000';
  end if;

  delete from public.facility_beds b
  where b.room_id = p_room_id
    and not (b.bed_label = any (v_target_labels))
    and b.status = 'available'
    and b.occupied_by_resident_id is null
    and b.reserved_for_prospect_id is null;
end;
$$;

drop function if exists public.import_apply_room_with_beds(uuid, uuid, text, text, text, text, integer, text);

create function public.import_apply_room_with_beds(
  p_organization_id uuid,
  p_facility_id uuid,
  p_building_name text,
  p_unit_name text,
  p_room_number text,
  p_room_type text,
  p_bed_count integer,
  p_gender_restriction text default 'none',
  p_is_active boolean default null
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
  if auth.role() is distinct from 'service_role' then
    raise exception 'import_apply_room_with_beds is restricted to service_role' using errcode = '42501';
  end if;
  if p_organization_id is null then
    raise exception 'p_organization_id is required' using errcode = '22023';
  end if;

  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  -- Validate facility belongs to the explicit organization — no assert_admission_manager
  if v_facility.organization_id is distinct from p_organization_id then
    raise exception 'facility is outside import scope' using errcode = '42501';
  end if;

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
    v_facility.organization_id, v_facility.id, btrim(p_building_name), 0
  )
  on conflict (facility_id, name) do update
  set updated_at = now()
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
    room_number, room_type, gender_restriction, is_active
  ) values (
    v_facility.organization_id, v_facility.id, v_building, v_unit,
    btrim(p_room_number), p_room_type, p_gender_restriction, coalesce(p_is_active, true)
  )
  on conflict (facility_id, room_number) do update
  set room_type = excluded.room_type,
      residential_unit_id = excluded.residential_unit_id,
      gender_restriction = excluded.gender_restriction,
      is_active = coalesce(p_is_active, public.facility_rooms.is_active),
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

  perform app_private.reconcile_room_beds(v_room, btrim(p_room_number), p_bed_count);

  return v_room;
end;
$$;

revoke all on function public.import_apply_room_with_beds(uuid, uuid, text, text, text, text, integer, text, boolean)
  from public, anon, authenticated;
grant execute on function public.import_apply_room_with_beds(uuid, uuid, text, text, text, text, integer, text, boolean)
  to service_role;

drop function if exists public.create_room_with_beds(uuid, text, text, text, text, integer, text, integer);

create function public.create_room_with_beds(
  p_facility_id uuid,
  p_building_name text,
  p_unit_name text,
  p_room_number text,
  p_room_type text,
  p_bed_count integer,
  p_gender_restriction text default 'none',
  p_licensed_capacity integer default null,
  p_is_active boolean default null
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
    room_number, room_type, gender_restriction, is_active
  ) values (
    v_facility.organization_id, v_facility.id, v_building, v_unit,
    btrim(p_room_number), p_room_type, p_gender_restriction, coalesce(p_is_active, true)
  )
  on conflict (facility_id, room_number) do update
  set room_type = excluded.room_type,
      residential_unit_id = excluded.residential_unit_id,
      gender_restriction = excluded.gender_restriction,
      is_active = coalesce(p_is_active, public.facility_rooms.is_active),
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

  perform app_private.reconcile_room_beds(v_room, btrim(p_room_number), p_bed_count);

  return v_room;
end;
$$;

revoke all on function public.create_room_with_beds(uuid, text, text, text, text, integer, text, integer, boolean)
  from public, anon, service_role;
grant execute on function public.create_room_with_beds(uuid, text, text, text, text, integer, text, integer, boolean)
  to authenticated;
