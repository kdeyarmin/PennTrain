-- Focused pgTAP coverage for append-only exclusion snapshots, replay-safe correlation IDs,
-- validation, atomic activation, and last-known-good preservation.
-- Run with: supabase test db

begin;
select plan(27);

-- Isolate the source pointer from any optional local seed data. The surrounding transaction
-- restores the original state after the test.
update public.exclusion_source_state
set active_snapshot_id = null,
    last_run_id = null,
    last_attempt_at = null,
    last_success_at = null,
    last_status = 'not_loaded',
    last_error = null
where source = 'sam_exclusions';

create temp table exclusion_refresh_test_ids as
select public.begin_exclusion_source_refresh(
  '10000000-0000-4000-8000-000000000001',
  'sam_exclusions'
) as first_begin;

select is(
  first_begin->>'status',
  'staging',
  'a source refresh begins in staging state'
) from exclusion_refresh_test_ids;

select is(
  (public.begin_exclusion_source_refresh(
    '10000000-0000-4000-8000-000000000001',
    'sam_exclusions'
  )->>'runId'),
  first_begin->>'runId',
  'replaying a correlation ID returns the same run ID'
) from exclusion_refresh_test_ids;

select lives_ok(
  format(
    $sql$insert into public.exclusion_list_entries (
      snapshot_id, source_record_key, source, first_name, last_name, raw
    ) values (%L::uuid, 'sam-record-1', 'sam_exclusions', 'Test', 'Excluded', '{}'::jsonb)$sql$,
    first_begin->>'snapshotId'
  ),
  'rows can be staged in an open snapshot'
) from exclusion_refresh_test_ids;

select is(
  (select count(*)::integer
   from public.exclusion_list_entries
   where snapshot_id = (first_begin->>'snapshotId')::uuid),
  1,
  'one source row is staged'
) from exclusion_refresh_test_ids;

select throws_ok(
  format(
    $sql$select public.complete_exclusion_source_refresh(%L::uuid, 2)$sql$,
    first_begin->>'runId'
  ),
  null,
  null,
  'activation rejects a staged count that differs from the expected source count'
) from exclusion_refresh_test_ids;

select lives_ok(
  format(
    $sql$select public.fail_exclusion_source_refresh(%L::uuid, 'simulated partial import')$sql$,
    first_begin->>'runId'
  ),
  'a failed refresh is recorded separately after activation rolls back'
) from exclusion_refresh_test_ids;

select is(
  (select status from public.exclusion_refresh_runs
   where id = (first_begin->>'runId')::uuid),
  'failed',
  'the run exposes its failed status'
) from exclusion_refresh_test_ids;

select is(
  (select active_snapshot_id from public.exclusion_source_state where source = 'sam_exclusions'),
  null::uuid,
  'a failed first refresh does not install a partial active pointer'
);

select results_eq(
  format(
    $sql$select result->>'runId', result->>'snapshotId', result->>'status'
         from (select public.begin_exclusion_source_refresh(
           '10000000-0000-4000-8000-000000000001', 'sam_exclusions'
         ) result) resumed$sql$
  ),
  format(
    $sql$select %L::text, %L::text, 'staging'::text$sql$,
    first_begin->>'runId', first_begin->>'snapshotId'
  ),
  'retrying a failed correlation resumes the same staged snapshot'
) from exclusion_refresh_test_ids;

select lives_ok(
  format(
    $sql$insert into public.exclusion_list_entries (
      snapshot_id, source_record_key, source, first_name, last_name, raw
    ) values (%L::uuid, 'sam-record-1', 'sam_exclusions', 'Test', 'Excluded', '{}'::jsonb)
    on conflict (snapshot_id, source_record_key) do nothing$sql$,
    first_begin->>'snapshotId'
  ),
  'replaying an already-staged batch is idempotent'
) from exclusion_refresh_test_ids;

select lives_ok(
  format(
    $sql$insert into public.exclusion_list_entries (
      snapshot_id, source_record_key, source, first_name, last_name, raw
    ) values (%L::uuid, 'sam-record-2', 'sam_exclusions', 'Second', 'Excluded', '{}'::jsonb)$sql$,
    first_begin->>'snapshotId'
  ),
  'a retry can append the missing batch to the same snapshot'
) from exclusion_refresh_test_ids;

select lives_ok(
  format(
    $sql$select public.complete_exclusion_source_refresh(%L::uuid, 2)$sql$,
    first_begin->>'runId'
  ),
  'a complete validated snapshot activates successfully'
) from exclusion_refresh_test_ids;

select is(
  (select active_snapshot_id from public.exclusion_source_state where source = 'sam_exclusions'),
  (first_begin->>'snapshotId')::uuid,
  'activation atomically switches the source pointer'
) from exclusion_refresh_test_ids;

select results_eq(
  format(
    $sql$select status, staged_record_count, activated_snapshot_id
         from public.exclusion_refresh_runs where id = %L::uuid$sql$,
    first_begin->>'runId'
  ),
  format(
    $sql$select 'succeeded'::text, 2::integer, %L::uuid$sql$,
    first_begin->>'snapshotId'
  ),
  'the successful run records count and activated snapshot'
) from exclusion_refresh_test_ids;

select is(
  (select length(checksum) from public.exclusion_refresh_runs
   where id = (first_begin->>'runId')::uuid),
  64,
  'the activated run records a deterministic SHA-256 snapshot checksum'
) from exclusion_refresh_test_ids;

select is(
  (public.complete_exclusion_source_refresh(
    (first_begin->>'runId')::uuid,
    2
  )->>'replayed')::boolean,
  true,
  'replaying completion of an activated run is a safe no-op'
) from exclusion_refresh_test_ids;

create temp table exclusion_refresh_failed_ids as
select public.begin_exclusion_source_refresh(
  '10000000-0000-4000-8000-000000000002',
  'sam_exclusions'
) as second_begin;

select is(
  second_begin->>'status',
  'staging',
  'a later refresh gets its own staging snapshot'
) from exclusion_refresh_failed_ids;

select lives_ok(
  format(
    $sql$insert into public.exclusion_list_entries (
      snapshot_id, source_record_key, source, first_name, last_name, raw
    ) values (%L::uuid, 'sam-partial-record', 'sam_exclusions', 'Partial', 'Result', '{}'::jsonb)$sql$,
    second_begin->>'snapshotId'
  ),
  'a later partial SAM response can be staged without changing the active pointer'
) from exclusion_refresh_failed_ids;

select throws_ok(
  format(
    $sql$select public.complete_exclusion_source_refresh(%L::uuid, 2)$sql$,
    second_begin->>'runId'
  ),
  null,
  null,
  'validation rejects a staged count that does not match the complete SAM response'
) from exclusion_refresh_failed_ids;

select lives_ok(
  format(
    $sql$select public.fail_exclusion_source_refresh(%L::uuid, 'simulated partial source')$sql$,
    second_begin->>'runId'
  ),
  'the partial-source failure is observable'
) from exclusion_refresh_failed_ids;

select is(
  (select active_snapshot_id from public.exclusion_source_state where source = 'sam_exclusions'),
  (select (first_begin->>'snapshotId')::uuid from exclusion_refresh_test_ids),
  'a failed later refresh preserves the last-known-good active pointer'
);

select results_eq(
  $$select health_status, active_record_count, last_status
    from public.exclusion_source_health where source = 'sam_exclusions'$$,
  $$select 'failed'::text, 2::integer, 'failed'::text$$,
  'source health exposes the failure while reporting the retained active count'
);

create temp table exclusion_refresh_zero_ids as
select public.begin_exclusion_source_refresh(
  '10000000-0000-4000-8000-000000000003',
  'sam_exclusions'
) as zero_begin;

select lives_ok(
  format(
    $sql$select public.complete_exclusion_source_refresh(%L::uuid, 0)$sql$,
    zero_begin->>'runId'
  ),
  'a complete SAM response with zero roster matches activates successfully'
) from exclusion_refresh_zero_ids;

select is(
  (select active_snapshot_id from public.exclusion_source_state where source = 'sam_exclusions'),
  (select (zero_begin->>'snapshotId')::uuid from exclusion_refresh_zero_ids),
  'a valid zero-match SAM snapshot replaces stale positive matches'
);

select results_eq(
  $$select health_status, active_record_count, last_status
    from public.exclusion_source_health where source = 'sam_exclusions'$$,
  $$select 'healthy'::text, 0::integer, 'succeeded'::text$$,
  'source health reports a successful zero-match SAM refresh'
);

select throws_ok(
  format(
    $sql$update public.exclusion_list_entries set first_name = 'Changed'
         where snapshot_id = %L::uuid$sql$,
    first_begin->>'snapshotId'
  ),
  null,
  null,
  'activated snapshot rows cannot be updated'
) from exclusion_refresh_test_ids;

select throws_ok(
  format(
    $sql$delete from public.exclusion_list_entries where snapshot_id = %L::uuid$sql$,
    first_begin->>'snapshotId'
  ),
  null,
  null,
  'activated snapshot rows cannot be deleted'
) from exclusion_refresh_test_ids;

select * from finish();
rollback;
