-- The durable import worker (process-data-import-jobs) creates and updates residents through
-- import_apply_resident, whose column allowlist (20260905090000) predates residents.external_id
-- (20260906130000). bulk-import-residents writes external_id on create, and on update when the CSV
-- carries it; a row rescued by the worker after the browser tab closed could not, so a 500-row file
-- whose tab closed at row 250 created rows 251-500 with external_id NULL -- and the next re-import
-- could no longer match them by external_id, opening a second census row for anyone whose name had
-- since been corrected in the app. This adds the column to the allowlist; the worker now carries the
-- value on both paths. `create or replace` keeps the existing service_role-only grant.
create or replace function public.import_apply_resident(
  p_job_id uuid,
  p_resident_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
begin
  if not exists (
    select 1 from public.data_import_jobs j where j.id = p_job_id and j.domain = 'residents'
  ) then
    raise exception 'import job does not accept residents' using errcode = '22023';
  end if;
  return app_private.import_write_row(
    'residents',
    array[
      'facility_id', 'first_name', 'last_name', 'date_of_birth', 'room',
      'admission_date', 'preferred_name', 'status', 'external_id'
    ]::text[],
    p_resident_id, v_org, p_payload
  );
end;
$$;
