-- Recovered from production supabase_migrations.schema_migrations.statements
-- (applied 2026-07-24 as version 20260724043912 but never committed to git).
-- See PennTrain_Comprehensive_Review_2026-07-24.md addendum / PT-051.
--
-- Replay adaptation: the committed orientation seed (20260724040747) already
-- inserts the renamed catalog_code, so production's strict "exactly one row
-- renamed" assertion would fail a fresh replay with zero rows. The rename
-- applies only where the old code exists, and the assertion verifies the
-- final state instead.
--
-- required_annual_individual_courses.test.sql pgTAP-scopes the "individual PA DHS
-- annual course catalog" specifically to catalog_code prefixes PA-DHS-%, PA-PCH-%,
-- and PA-ALR-%, and asserts every course matching those prefixes is truly annual
-- (recurrence_interval_days = 365). This course is a one-time new-hire orientation,
-- not an annual topic, so it was never meant to be part of that catalog -- it just
-- accidentally matched the PA-DHS-% prefix. Rename the catalog_code so it falls
-- outside all three prefixes, which is the correct fix (the test's annual-catalog
-- scope and its hardcoded 20-course list stay accurate and untouched) rather than
-- loosening a test that is correctly enforcing an "annual" invariant for a course
-- that was never annual.
do $rename$
declare
  v_final integer;
begin
  perform set_config('app.privileged_write', 'on', true);

  update public.courses
  set catalog_code = 'PA-ORIENT-NEW-EMPLOYEE-PCH-ALF'
  where id = 'e2c03f97-74e5-4fb7-b4f1-ced867d37950'::uuid
    and catalog_code = 'PA-DHS-ORIENT-NEW-EMPLOYEE';

  select count(*) into v_final
  from public.courses
  where id = 'e2c03f97-74e5-4fb7-b4f1-ced867d37950'::uuid
    and catalog_code = 'PA-ORIENT-NEW-EMPLOYEE-PCH-ALF';
  if v_final <> 1 then
    raise exception 'Expected the orientation course to carry catalog_code PA-ORIENT-NEW-EMPLOYEE-PCH-ALF, found % matching rows', v_final;
  end if;
end;
$rename$;
