-- pgTAP coverage for 20260905110000: a LEIE refresh that dies is recoverable, not permanent.
--
-- The 2026-08-12 monthly refresh was killed inside the parser -- the deployed worker peaked at
-- 386 MB against an Edge Function's 256 MB -- and left its run 'staging' with zero rows. Nothing
-- closed it, so exclusion_source_health reported a load still in progress 24 days later, and
-- because every invocation minted a fresh correlation id the September fire would have opened a
-- second staging snapshot beside it rather than finishing the first.
--
-- These assert the database half: a durable stage cursor that survives a failure (so a retry
-- converges instead of redoing the same prefix forever), and a reconciler that closes runs whose
-- worker never came back. Run with: supabase test db (requires the local Supabase Docker stack).

begin;
select plan(17);

-- The refresh functions are service-role SECURITY DEFINER surfaces with no tenant scoping, so
-- these need no organization or profile fixtures -- only the source state rows the schema seeds.

select has_function(
  'public', 'record_exclusion_stage_progress', array['uuid', 'jsonb'],
  'record_exclusion_stage_progress(uuid, jsonb) exists'
);
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_exclusion_stage_progress'),
  true,
  'record_exclusion_stage_progress is SECURITY DEFINER'
);
select ok(
  has_function_privilege('service_role', 'public.record_exclusion_stage_progress(uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_exclusion_stage_progress(uuid, jsonb)', 'EXECUTE'),
  'only the service role may record staging progress'
);

-- A fresh refresh has nothing to resume from.
select is(
  (select public.begin_exclusion_source_refresh(
     'aa000000-0000-4000-8000-000000000001', 'oig_leie') ->> 'stageCursor'),
  null,
  'a fresh refresh begins with no stage cursor'
);

create temporary table t_run(run_id uuid, snapshot_id uuid) on commit drop;
insert into t_run
select (r ->> 'runId')::uuid, (r ->> 'snapshotId')::uuid
from (
  select public.begin_exclusion_source_refresh('aa000000-0000-4000-8000-000000000001', 'oig_leie') as r
) s;

select lives_ok(
  $$select public.record_exclusion_stage_progress(
      (select run_id from t_run),
      '{"chunk": 40, "entries": 40000, "fingerprint": "15578603|Mon, 10 Aug 2026 13:18:45 GMT|"}'::jsonb
    )$$,
  'a worker can record staging progress against its own run'
);
select is(
  (select stage_cursor ->> 'chunk' from public.exclusion_refresh_runs where id = (select run_id from t_run)),
  '40',
  'the cursor lands on the run'
);
select ok(
  (select last_progress_at is not null and last_progress_at >= now() - interval '1 minute'
   from public.exclusion_refresh_runs where id = (select run_id from t_run)),
  'recording progress stamps last_progress_at, which is what the reconciler keys on'
);

-- Replay: the same (correlation, source) must return the SAME run and snapshot, carrying the
-- cursor. This is the whole resume mechanism -- without it a retry cannot know where to pick up.
select is(
  (select public.begin_exclusion_source_refresh(
     'aa000000-0000-4000-8000-000000000001', 'oig_leie') ->> 'runId'),
  (select run_id::text from t_run),
  'replaying a correlation returns the run already open for it'
);
select is(
  (select public.begin_exclusion_source_refresh(
     'aa000000-0000-4000-8000-000000000001', 'oig_leie') -> 'stageCursor' ->> 'chunk'),
  '40',
  'the replay hands the resuming worker its predecessor''s cursor'
);

select throws_ok(
  $$select public.record_exclusion_stage_progress((select run_id from t_run), '"forty"'::jsonb)$$,
  '22023',
  null,
  'a cursor that is not an object is refused'
);

-- The reconciler.
select is(
  app_private.reconcile_stalled_exclusion_refresh_runs(),
  0,
  'a refresh that just made progress is left alone'
);

-- Keyed on progress, not on the start: a long refresh that is still working must never be swept.
update public.exclusion_refresh_runs
set started_at = now() - interval '10 hours', last_progress_at = now() - interval '1 minute'
where id = (select run_id from t_run);
select is(
  app_private.reconcile_stalled_exclusion_refresh_runs(),
  0,
  'a run started ten hours ago but still reporting progress is not swept'
);

update public.exclusion_refresh_runs
set last_progress_at = now() - interval '7 hours'
where id = (select run_id from t_run);
select is(
  app_private.reconcile_stalled_exclusion_refresh_runs(),
  1,
  'a run whose worker stopped reporting for over six hours is closed'
);
select is(
  (select last_status from public.exclusion_source_state where source = 'oig_leie'),
  'failed',
  'the source state moves with the run -- exclusion_source_health stops reporting a load in progress'
);
select matches(
  (select error from public.exclusion_refresh_runs where id = (select run_id from t_run)),
  'reconcile_stalled_exclusion_refresh_runs',
  'the closed run says who closed it and why, rather than failing anonymously'
);

-- The anti-livelock property. begin's failed -> staging reset deliberately KEEPS the cursor: a
-- refresh that cannot finish inside one budget would otherwise restart at chunk zero on every
-- attempt and never reach the end.
select is(
  (select public.begin_exclusion_source_refresh(
     'aa000000-0000-4000-8000-000000000001', 'oig_leie') -> 'stageCursor' ->> 'chunk'),
  '40',
  'reopening a failed run keeps the cursor, so a retry continues instead of restarting'
);

select matches(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'run_system_job_watchdog'),
  'reconcile_stalled_exclusion_refresh_runs',
  'the watchdog runs the reconciler, so this self-heals without another migration'
);

select * from finish();
rollback;
