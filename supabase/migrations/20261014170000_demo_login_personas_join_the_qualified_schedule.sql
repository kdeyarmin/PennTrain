-- Sunrise login personas join the qualified demo schedule.
--
-- seed.sql inserts Avery, Dana, and Casey as synthetic employees linked to a
-- profile, then calls app_private.seed_demo_organization(). Qualification and
-- OAPSA evidence, and the published shift roster, still matched only
-- employee_number like 'DEMO-%'. Those three have a null employee number, so
-- My Schedule stayed empty. Widening the roster without the evidence inserts
-- aborts db:reset:demo (23514 oapsa_provisional_expired /
-- staff_qualification_evidence_missing).
--
-- Evidence and the roster now include synthetic staff who are either on the
-- DEMO-% roster or linked to a login profile. An unlinked synthetic coworker
-- still has neither, and stays off the schedule. The primary site has three
-- numbered demo employees; limit 8 leaves room for the linked personas
-- without pulling anyone else in.

do $patch$
declare
  body text;
begin
  select pg_get_functiondef('app_private.seed_demo_organization(uuid)'::regprocedure) into body;

  if position($old$e.is_synthetic and e.employee_number like 'DEMO-%'$old$ in body) = 0 then
    raise exception 'seed_demo_organization qualification predicate changed';
  end if;
  body := replace(
    body,
    $old$e.is_synthetic and e.employee_number like 'DEMO-%'$old$,
    $new$e.is_synthetic and (e.employee_number like 'DEMO-%' or e.profile_id is not null)$new$
  );

  if position($old$else 'DEMO-PSP-'||e.employee_number end$old$ in body) = 0 then
    raise exception 'seed_demo_organization clearance number expression changed';
  end if;
  body := replace(
    body,
    $old$else 'DEMO-PSP-'||e.employee_number end$old$,
    $new$else 'DEMO-PSP-'||coalesce(e.employee_number, 'LOGIN-'||left(replace(e.id::text, '-', ''), 12)) end$new$
  );

  if position($old$select id, row_number() over (order by employee_number) - 1 as day_offset$old$ in body) = 0 then
    raise exception 'seed_demo_organization shift day-offset marker changed';
  end if;
  body := replace(
    body,
    $old$select id, row_number() over (order by employee_number) - 1 as day_offset$old$,
    $new$select id, row_number() over (order by employee_number nulls last, id) - 1 as day_offset$new$
  );

  if position($old$    where organization_id = v_org.id and facility_id = v_facility.id
      and status = 'active' and is_synthetic and employee_number like 'DEMO-%'
    order by employee_number limit 4$old$ in body) = 0 then
    raise exception 'seed_demo_organization shift roster marker changed';
  end if;
  body := replace(
    body,
    $old$    where organization_id = v_org.id and facility_id = v_facility.id
      and status = 'active' and is_synthetic and employee_number like 'DEMO-%'
    order by employee_number limit 4$old$,
    $new$    where organization_id = v_org.id and facility_id = v_facility.id
      and status = 'active' and is_synthetic
      and (employee_number like 'DEMO-%' or profile_id is not null)
    order by employee_number nulls last, id limit 8$new$
  );

  execute body;
end
$patch$;
