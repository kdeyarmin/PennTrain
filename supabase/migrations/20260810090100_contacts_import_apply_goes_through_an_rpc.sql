-- The resident-contacts browser apply could never write a row.
--
-- bulk-import-resident-contacts inserted and updated public.resident_contacts directly under
-- the caller's JWT, but 20260713183435 grants authenticated SELECT only -- writes to that table
-- are RPC-only by design. Every browser apply therefore failed with "permission denied" on rows
-- the dry run had just called valid. The table grants stay exactly as they are; the importer
-- gets what the other locked-down import domains already have (import_apply_incident,
-- import_apply_employee_credential, ...): a dedicated apply RPC. Unlike those, this one is for
-- the BROWSER applier, so it authorizes through the import job the same way
-- record_data_import_chunk does, and holds writes to the visibility rule of
-- resident_contacts_select rather than trusting the client's resident id.

create or replace function public.import_apply_resident_contact(
  p_job_id uuid,
  p_resident_id uuid,
  p_payload jsonb,
  p_contact_id uuid default null
)
returns public.resident_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
  v_resident public.residents%rowtype;
  v_existing public.resident_contacts%rowtype;
  v_result public.resident_contacts%rowtype;
  v_name text := nullif(btrim(coalesce(p_payload ->> 'name', '')), '');
  v_contact_type text := nullif(btrim(coalesce(p_payload ->> 'contact_type', '')), '');
  v_is_primary boolean := coalesce((p_payload ->> 'is_primary')::boolean, false);
begin
  if jsonb_typeof(coalesce(p_payload, 'null'::jsonb)) <> 'object' then
    raise exception 'resident contact payload must be an object' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.data_import_jobs j
    where j.id = p_job_id and j.domain = 'resident_contacts'
  ) then
    raise exception 'import job does not accept resident contacts' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'Contact name is required' using errcode = '22023';
  end if;
  if v_contact_type is null or v_contact_type not in (
    'emergency_contact', 'designated_person', 'guardian', 'power_of_attorney',
    'primary_care_provider', 'dentist', 'pharmacy', 'case_manager',
    'hospice_agency', 'home_health_agency', 'insurer', 'other'
  ) then
    raise exception 'Invalid contact type' using errcode = '22023';
  end if;

  select * into v_resident from public.residents where id = p_resident_id;
  if not found then
    raise exception 'Resident not found' using errcode = '23503';
  end if;
  if v_resident.organization_id is distinct from v_org then
    raise exception 'resident is outside import scope' using errcode = '42501';
  end if;
  -- The same visibility rule as resident_contacts_select: a write through this RPC is never
  -- broader than what the caller can already read.
  if not app_private.admission_row_visible(v_resident.organization_id, v_resident.facility_id) then
    raise exception 'resident is outside caller scope' using errcode = '42501';
  end if;

  if p_contact_id is null then
    insert into public.resident_contacts(
      organization_id, facility_id, resident_id, contact_type, name, relationship,
      email, phone, is_primary, active, created_by
    ) values (
      v_resident.organization_id, v_resident.facility_id, v_resident.id, v_contact_type,
      v_name, nullif(btrim(coalesce(p_payload ->> 'relationship', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'email', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'phone', '')), ''),
      v_is_primary, true, auth.uid()
    ) returning * into v_result;
  else
    select * into v_existing from public.resident_contacts
    where id = p_contact_id
    for update;
    if not found then
      raise exception 'Resident contact not found' using errcode = 'P0002';
    end if;
    if v_existing.organization_id is distinct from v_org
       or v_existing.resident_id is distinct from v_resident.id then
      raise exception 'resident contact is outside import scope' using errcode = '42501';
    end if;
    update public.resident_contacts c set
      contact_type = v_contact_type,
      name = v_name,
      relationship = nullif(btrim(coalesce(p_payload ->> 'relationship', '')), ''),
      email = nullif(btrim(coalesce(p_payload ->> 'email', '')), ''),
      phone = nullif(btrim(coalesce(p_payload ->> 'phone', '')), ''),
      is_primary = v_is_primary,
      updated_at = now()
    where c.id = v_existing.id
    returning * into v_result;
  end if;
  return v_result;
end;
$$;

revoke all on function public.import_apply_resident_contact(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.import_apply_resident_contact(uuid, uuid, jsonb, uuid)
  to authenticated;
