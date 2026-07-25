-- Occupancy board (program plan Phase 9b, request item 21).
--
-- LICENSED CAPACITY IS A REGULATORY NUMBER, NOT A ROW COUNT. The plan is explicit, and it matters:
-- counting beds tells you how many people the building could physically hold, which is not what a
-- licence permits. `facility_licenses.licensed_capacity` is the authority. `facility_buildings.
-- licensed_capacity` is a per-building allocation of that number and is reported alongside it, but
-- the facility figure -- and the over-capacity warning -- comes from the licence.
--
-- The licence used is the ACTIVE one covering today. A facility with no such licence reports null
-- capacity and says so, rather than falling back to a bed count: silently substituting a physical
-- number for a regulatory one is how a facility ends up believing it has room it is not licensed for.
--
-- RECONCILIATION IS PART OF THE OUTPUT. The plan's exit gate requires occupancy figures to reconcile
-- against census. Bed occupancy and resident census are maintained by different write paths -- a bed
-- is released by the move-out flow, a resident's status by the census flow -- so they can disagree.
-- Rather than hiding that behind a single number, the board returns both counts and the specific
-- mismatched records, because a discrepancy is itself the finding.
--
-- Rollback: drop the function.

create or replace function public.get_facility_occupancy_board(p_facility_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_facility public.facilities%rowtype;
  v_license public.facility_licenses%rowtype;
  v_buildings jsonb;
  v_rooms jsonb;
  v_census jsonb;
  v_reconciliation jsonb;
begin
  -- security invoker: the facilities, beds and residents RLS policies decide visibility.
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;

  -- The licence in force today. 'provisional' and 'conditional' still permit operation at a stated
  -- capacity, so they count; suspended, expired and closed do not.
  select * into v_license
  from public.facility_licenses l
  where l.facility_id = v_facility.id
    and l.status in ('active', 'provisional', 'conditional')
    and l.effective_from <= current_date
    and (l.expires_on is null or l.expires_on >= current_date)
  order by l.effective_from desc
  limit 1;

  select jsonb_build_object(
    'activeResidents', count(*) filter (where r.status = 'active'),
    'temporarilyOut', count(*) filter (where r.status = 'temporarily_out'),
    'hospitalLeave', count(*) filter (where r.status = 'hospital_leave'),
    -- Residents in the building tonight. Someone on hospital leave still holds their bed, so they
    -- are counted against capacity; a discharged resident is not.
    'occupyingABed', count(*) filter (where r.status in ('active', 'temporarily_out', 'hospital_leave'))
  ) into v_census
  from public.residents r
  where r.facility_id = v_facility.id;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.name), '[]'::jsonb)
    into v_buildings
  from (
    select
      fb.id, fb.name,
      fb.licensed_capacity as building_allocated_capacity,
      count(bed.id)::integer as beds,
      count(bed.id) filter (where bed.status = 'available')::integer as available,
      count(bed.id) filter (where bed.status = 'reserved')::integer as reserved,
      count(bed.id) filter (where bed.status = 'occupied')::integer as occupied,
      count(bed.id) filter (where bed.status = 'maintenance_hold')::integer as maintenance_hold,
      count(bed.id) filter (where bed.status = 'temporarily_unavailable')::integer as temporarily_unavailable,
      count(bed.id) filter (
        where bed.status = 'occupied' and res.status in ('temporarily_out', 'hospital_leave')
      )::integer as occupied_but_away
    from public.facility_buildings fb
    left join public.facility_rooms fr on fr.building_id = fb.id and fr.is_active
    left join public.facility_beds bed on bed.room_id = fr.id
    left join public.residents res on res.id = bed.occupied_by_resident_id
    where fb.facility_id = v_facility.id and fb.is_active
    group by fb.id, fb.name, fb.licensed_capacity
  ) b;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.building_name, r.room_number), '[]'::jsonb)
    into v_rooms
  from (
    select
      fr.id, fr.room_number, fr.room_type, fr.gender_restriction,
      fb.name as building_name,
      ru.name as unit_name,
      coalesce(ru.secured, false) as secured,
      count(bed.id)::integer as beds,
      count(bed.id) filter (where bed.status = 'available')::integer as available_beds,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', bed.id,
        'label', bed.bed_label,
        'status', bed.status,
        'holdReason', bed.hold_reason,
        'expectedVacancyDate', bed.expected_vacancy_date,
        'residentId', bed.occupied_by_resident_id,
        'residentName', case when res.id is null then null
          else btrim(res.first_name || ' ' || res.last_name) end,
        'residentStatus', res.status,
        'reservedForProspectId', bed.reserved_for_prospect_id
      ) order by bed.bed_label) filter (where bed.id is not null), '[]'::jsonb) as bed_details
    from public.facility_rooms fr
    join public.facility_buildings fb on fb.id = fr.building_id
    left join public.residential_units ru on ru.id = fr.residential_unit_id
    left join public.facility_beds bed on bed.room_id = fr.id
    left join public.residents res on res.id = bed.occupied_by_resident_id
    where fr.facility_id = v_facility.id and fr.is_active
    group by fr.id, fr.room_number, fr.room_type, fr.gender_restriction, fb.name, ru.name, ru.secured
  ) r;

  -- The reconciliation the exit gate asks for. Both directions are reported: a resident with no bed
  -- and a bed pointing at somebody who is not resident are different problems with different fixes.
  select jsonb_build_object(
    'residentsWithoutABed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'residentId', res.id,
        'name', btrim(res.first_name || ' ' || res.last_name),
        'status', res.status
      ) order by res.last_name, res.first_name)
      from public.residents res
      where res.facility_id = v_facility.id
        and res.status in ('active', 'temporarily_out', 'hospital_leave')
        and not exists (
          select 1 from public.facility_beds bed where bed.occupied_by_resident_id = res.id
        )
    ), '[]'::jsonb),
    'bedsHeldByNonResidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bedId', bed.id,
        'bedLabel', bed.bed_label,
        'residentId', res.id,
        'residentStatus', res.status
      ) order by bed.bed_label)
      from public.facility_beds bed
      join public.residents res on res.id = bed.occupied_by_resident_id
      where bed.facility_id = v_facility.id
        and res.status in ('discharged', 'deceased')
    ), '[]'::jsonb)
  ) into v_reconciliation;

  return jsonb_build_object(
    'facilityId', v_facility.id,
    'facilityName', v_facility.name,
    'license', case when v_license.id is null then null else jsonb_build_object(
      'id', v_license.id,
      'licenseNumber', v_license.license_number,
      'status', v_license.status,
      'expiresOn', v_license.expires_on,
      'licensedCapacity', v_license.licensed_capacity
    ) end,
    -- Null, never a bed count. A facility with no licence on file must see that it has no licensed
    -- capacity recorded, not a physical number wearing a regulatory label.
    'licensedCapacity', v_license.licensed_capacity,
    'licensedCapacitySource', case
      when v_license.id is null then 'no_active_license_on_file'
      when v_license.licensed_capacity is null then 'license_records_no_capacity'
      else 'facility_license'
    end,
    'census', v_census,
    'buildings', v_buildings,
    'rooms', v_rooms,
    'reconciliation', v_reconciliation,
    'generatedAt', now()
  );
end $$;
revoke all on function public.get_facility_occupancy_board(uuid) from public, anon;
grant execute on function public.get_facility_occupancy_board(uuid) to authenticated, service_role;
