-- Service-role needs SELECT on the import control-plane tables so that
-- security-definer RPCs and trusted database workers can read job/row/event
-- state directly.  Writes still flow exclusively through the security-definer
-- functions; only SELECT is restored here to avoid reopening direct-write paths
-- that were intentionally closed in 20260730010000.

begin;

do $do$
begin
  if to_regclass('public.data_import_jobs') is null then return; end if;
  execute 'grant select on public.data_import_jobs, public.data_import_rows, public.data_import_events to service_role';
end;
$do$;

commit;
