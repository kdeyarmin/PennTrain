-- Recovered verbatim from production supabase_migrations.schema_migrations.statements
-- (applied 2026-07-24 as version 20260724051753 but never committed to git).
-- See PennTrain_Comprehensive_Review_2026-07-24.md addendum / PT-051.
-- Note: on fresh replays the reconstructed course seeds already insert
-- 'verified_only', so the guarded update matches zero rows and only the
-- invariant check below does work -- both paths converge on the same state.
--
-- The three new standalone annual courses were inserted with credit_mode
-- 'automatic', but every other published system-catalog course (organization_id
-- is null) uses 'verified_only' -- confirmed by
-- comprehensive_annual_course_catalog.test.sql's "all system-course credit
-- awaits employer audience and evidence verification" invariant. 'automatic' is
-- reserved for organization-authored courses, where the org itself is directly
-- accountable; a shared system course used across many facilities needs the
-- employer to verify audience and evidence before regulatory hours count, the
-- same reasoning already applied to the medication-support course mapping.
do $fix$
begin
  perform set_config('app.privileged_write', 'on', true);

  update public.course_compliance_credits
  set credit_mode = 'verified_only'
  where course_id in (
    '221245ad-fcb2-431f-b929-e745014a51c2'::uuid,
    'e4e3090e-19cb-4d83-99e3-ec8aea17304a'::uuid,
    '2b13c14f-5876-43df-9329-612f695ba952'::uuid
  )
  and credit_mode = 'automatic';
end;
$fix$;

do $verify$
declare
  v_bad_count integer;
begin
  select count(*) into v_bad_count
  from public.course_compliance_credits cc
  join public.courses c on c.id = cc.course_id
    and c.current_version_id = cc.course_version_id
  where c.organization_id is null
    and c.status = 'published'
    and c.catalog_code is not null
    and cc.is_active
    and cc.credit_mode <> 'verified_only';

  if v_bad_count <> 0 then
    raise exception 'Expected zero non-verified_only system-course credit rows, found %', v_bad_count;
  end if;
end;
$verify$;
