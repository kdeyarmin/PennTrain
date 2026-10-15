-- Demo reset schedules only the roster it just qualified.
--
-- seed.sql marks the Sunrise login personas synthetic, then calls
-- app_private.seed_demo_organization(). That function writes qualification and
-- OAPSA evidence for employee_number like 'DEMO-%', then fills the published
-- schedule from the first four active synthetic employees at the primary site.
-- Numbered demo staff sort first, so the fourth seat is a login persona
-- (null employee_number) who has neither record. The shift trigger then raises
-- 23514 (oapsa_provisional_expired, staff_qualification_evidence_missing) and
-- `pnpm run db:reset:demo` rolls the whole seed back.
--
-- The evidence insert and the shift roster now use the same predicate. An
-- isolated playground still gets its three primary-site shifts; a persona
-- created beside that roster is left off the schedule instead of aborting it.

do $patch$
declare
  body text;
  marker text := $old$    where organization_id = v_org.id and facility_id = v_facility.id
      and status = 'active' and is_synthetic
    order by employee_number limit 4$old$;
begin
  select pg_get_functiondef('app_private.seed_demo_organization(uuid)'::regprocedure) into body;
  if position(marker in body) = 0 then
    raise exception 'seed_demo_organization shift roster marker changed';
  end if;
  execute replace(body, marker, $new$    where organization_id = v_org.id and facility_id = v_facility.id
      and status = 'active' and is_synthetic and employee_number like 'DEMO-%'
    order by employee_number limit 4$new$);
end
$patch$;
