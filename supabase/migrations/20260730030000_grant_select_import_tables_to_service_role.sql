-- Restore service_role SELECT on the import control-plane tables.
--
-- 20260730010000 revoked ALL table privileges so trusted workers cannot mutate
-- jobs/rows/events outside the security-definer RPCs. That was correct for
-- INSERT/UPDATE/DELETE, but SELECT is still required:
--   1. Edge/system workers poll job and row status through the service role client.
--   2. carebase_activation_wave.test.sql asserts import outcomes as service_role.
--
-- Writes stay exclusive to start_data_import_job / record_data_import_chunk /
-- finalize_data_import_job / rollback_employee_import_job.

begin;

do $do$
begin
  if to_regclass('public.data_import_jobs') is null
    or to_regclass('public.data_import_rows') is null
    or to_regclass('public.data_import_events') is null then
    return;
  end if;

  execute 'grant select on public.data_import_jobs, public.data_import_rows, public.data_import_events to service_role';
end;
$do$;

commit;
