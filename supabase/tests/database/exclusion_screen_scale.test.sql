-- The exclusion screens, against a table large enough for the planner to have a choice.
--
-- This file exists because 3,916 assertions and 26 gates passed 20260905270000 twice while it was
-- unfit to run: every one of them exercised it against an exclusion table holding a handful of
-- rows, where a sequential scan is genuinely the cheapest plan and nothing about cost is visible.
-- Production holds 157,192 entries against 19 active employees. The first version applied the
-- score to every (employee x entry) pair and took the database off the air; the second added
-- indexes and a prefilter that read as index-answerable but used `<%`, which gin_trgm_ops does not
-- carry, so the BitmapOr never formed and it took the database off the air again.
--
-- Neither failure was subtle at scale and neither was visible below it. So this seeds sixty
-- thousand entries and a roster of nineteen, and asserts what was actually wrong both times --
-- through public.complete_exclusion_source_refresh, which is the call the weekly refresh makes and
-- which runs the roster sweep itself. Both broken versions fail it: the shape assertions catch the
-- plan and the ten-second bound catches the cost. Run with: supabase test db.

begin;
select plan(6);

insert into public.organizations(id,name,slug,subscription_status) values
  ('16000000-0000-4000-8000-000000000001','Screen Scale Org','screen-scale-org','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('16000000-0000-4000-8000-000000000011','16000000-0000-4000-8000-000000000001','Scale Facility','ALR');

-- The roster first, while no snapshot is active, so the on-hire trigger has nothing to screen
-- against and the sweep below is the only thing being measured. Nineteen is production's number;
-- with one employee even the quadratic version finishes quickly enough to pass a bound, which is
-- how the first version of this test passed against the code it was written to reject.
insert into public.employees(organization_id,facility_id,first_name,last_name,job_title,status)
select '16000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000011',
       upper(substr(md5(i::text || 'emp-given'), 1, 6)),
       upper(substr(md5(i::text || 'emp-sur'), 1, 8)),
       'Aide', 'active'
from generate_series(1, 18) i;

insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status)
values ('16000000-0000-4000-8000-000000000031','16000000-0000-4000-8000-000000000001',
        '16000000-0000-4000-8000-000000000011','Wanda','Excludalot','Aide','active');

select is(
  (select count(*)::int from public.employees
   where organization_id = '16000000-0000-4000-8000-000000000001' and status = 'active'),
  19,
  'nineteen active employees, the size of the roster this ran against in production'
);

-- A real snapshot through the refresh RPCs, so the active pointer and the sweep are the ones
-- production uses rather than a hand-built copy of them.
create temp table scale_ids as
select public.begin_exclusion_source_refresh(
  '16000000-0000-4000-8000-000000000090', 'oig_leie'
) as refresh;

insert into public.exclusion_list_entries (snapshot_id, source_record_key, source, first_name, last_name, raw)
select (r.refresh->>'snapshotId')::uuid, 'scale-' || i, 'oig_leie',
       upper(substr(md5(i::text || 'given'), 1, 6)),
       upper(substr(md5(i::text), 1, 8)),
       '{}'::jsonb
from scale_ids r, generate_series(1, 60000) i;

-- One entry a planted employee really matches, so a screen that finds nothing cannot pass by
-- finding nothing quickly.
insert into public.exclusion_list_entries (snapshot_id, source_record_key, source, first_name, last_name, raw)
select (refresh->>'snapshotId')::uuid, 'scale-planted', 'oig_leie', 'Wanda', 'Excludalot', '{}'::jsonb
from scale_ids;

analyze public.exclusion_list_entries;
analyze public.employees;

------------------------------------------------------------------------------------------------
-- Activation runs the sweep. Time it, and watch what it touches.
------------------------------------------------------------------------------------------------
-- Read off the clock, not off pg_stat_user_tables: a table's scan counters are held in the
-- backend's pending list and flushed at COMMIT, so inside a rolled-back test they never move --
-- measured, with pg_stat_force_next_flush() and pg_stat_clear_snapshot() in place. The shape the
-- counters would have shown is asserted structurally in exclusion_name_variants.test.sql instead.
create temp table scan_before as select clock_timestamp() as t0;

select lives_ok(
  format(
    $sql$select public.complete_exclusion_source_refresh(%L::uuid, 60001)$sql$,
    (select refresh->>'runId' from scale_ids)
  ),
  'sixty thousand entries activate, and activation sweeps the roster'
);

create temp table scan_after as select clock_timestamp() as t1;

-- The bound, not a benchmark. Measured on 83,513 real LEIE rows: the quadratic version took 57s
-- for this sweep and the fixed one 216ms. At this size that is roughly 41s against 0.2s, so ten
-- seconds fails on either regression without failing on a slow runner.
select ok(
  (select t1 from scan_after) - (select t0 from scan_before) < interval '10 seconds',
  'the roster sweep over sixty thousand entries and nineteen employees finishes inside ten seconds'
);

select is(
  (select count(*)::int from public.exclusion_screening_matches
   where employee_id = '16000000-0000-4000-8000-000000000031'),
  1,
  'the planted employee is matched against the planted entry among sixty thousand'
);

------------------------------------------------------------------------------------------------
-- The prefilter's operators, independently of which bodies are installed
------------------------------------------------------------------------------------------------
-- gin_trgm_ops carries `=`, `%` and `%>` with the indexed expression on the left, and does not
-- carry `<%`. A BitmapOr needs every branch to be an index qual, so one unindexable branch costs
-- the whole prefilter -- which is exactly what happened.
create or replace function pg_temp.plan_text(p_sql text) returns text
language plpgsql as $$
declare v text := ''; r record;
begin
  for r in execute 'explain (costs off) ' || p_sql loop
    v := v || r."QUERY PLAN" || E'\n';
  end loop;
  return v;
end $$;

create or replace function pg_temp.prefilter_plan() returns text
language sql stable as $$
  select pg_temp.plan_text($q$
    select l.id from public.exclusion_list_entries l
    where l.snapshot_id = (select active_snapshot_id from public.exclusion_source_state
                           where source = 'oig_leie')
      and l.source = 'oig_leie'
      and (
        public.exclusion_name_key(l.last_name) = public.exclusion_name_key('EXCLUDALOT')
        or pg_catalog.upper(l.last_name) operator(extensions.%) pg_catalog.upper('EXCLUDALOT')
        or public.exclusion_name_key(l.last_name) operator(extensions.%)
           public.exclusion_name_key('EXCLUDALOT')
        or pg_catalog.upper(l.last_name) operator(extensions.%>) pg_catalog.upper('EXCLUDALOT')
      )
  $q$);
$$;

select ok(
  pg_temp.prefilter_plan() like '%Bitmap Index Scan%',
  'the four operators the screens use plan as index scans over the surname indexes'
);

select ok(
  pg_temp.prefilter_plan() not like '%Seq Scan on exclusion_list_entries%',
  'and never as a sequential scan of the entry table'
);

select * from finish();
rollback;
