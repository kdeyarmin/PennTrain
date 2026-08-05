-- The durable import worker and the browser applied the same rows to the same customer.
--
-- `claim_data_import_jobs` (20260801020100) claims any job in 'ready' or 'applying' whose claim
-- is absent or expired, and the worker then applies every `data_import_rows` row still marked
-- 'valid'. A browser apply looks EXACTLY like that: the bulk-import-* functions walk the CSV in
-- chunks, and each chunk calls `record_data_import_chunk` with `p_job_status => 'applying'` until
-- the last one, which sets 'applied'. Nothing in that path has ever written `claim_expires_at`,
-- so from the worker's side a job a manager is halfway through importing is indistinguishable
-- from one a dead browser tab stranded -- which is the case the worker was built to rescue.
--
-- What that produces is not an error. The worker applies the rows the browser has not reached
-- yet; the browser then reaches them and applies them again, because its chunk loop reads the
-- CSV, not the ledger. The result is duplicate employees, residents, credentials, contacts,
-- assessments and incidents in the customer's data, from an import that reported success on both
-- sides. All eight durable domains are exposed.
--
-- The mechanism to fix it already exists and only one participant was using it. This teaches
-- `record_data_import_chunk` -- the single RPC every browser chunk already goes through -- to
-- take and renew the job's claim for its caller, and to refuse outright when someone else holds a
-- live one. Two consequences follow for free:
--
--   * `claim_data_import_jobs` skips a job a browser session is working, with no change to it:
--     its `claim_expires_at` predicate finally has something to read, and its
--     `for update skip locked` now also passes over the row this function locks.
--   * Calling `record_data_import_chunk` with an empty chunk and no status is an ATOMIC lease
--     acquisition, so the importers can take the claim BEFORE applying their first row rather
--     than discovering the conflict when they write the receipt -- by which point the duplicate
--     rows exist. `_shared/importJobLease.ts` is that call.
--
-- The lease is short (five minutes) and renewed by every chunk, so a browser tab that dies
-- strands the job for at most five minutes before the worker may rescue it -- the behaviour that
-- justified the worker, kept, with the overlap removed. It is cleared outright when the caller
-- reports a phase as finished ('ready', 'applied', 'failed') so the worker can pick up
-- immediately in the case that matters most: an apply the browser gave up on.
--
-- Rollback: CREATE OR REPLACE the version of `record_data_import_chunk` from
-- 20260729223100_data_import_control_plane.sql.

create or replace function public.record_data_import_chunk(
  p_job_id uuid,
  p_rows jsonb,
  p_job_status text default null,
  p_last_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
  v_row jsonb;
  v_count integer := 0;
  v_valid integer;
  v_warning integer;
  v_error integer;
  v_applied integer;
  v_skipped integer;
  -- The same identity `claim_data_import_jobs` writes, so the worker and a platform admin
  -- reclaiming their own job are recognised rather than locked out by their own lease.
  v_holder text := coalesce((select auth.uid())::text, 'worker');
  v_claimed_by text;
  v_claim_expires timestamptz;
  -- A phase the caller says is over. 'applying' and 'validated' mean more chunks are coming.
  v_phase_done boolean := coalesce(p_job_status, '') in ('ready', 'applied', 'failed');
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then
    raise exception 'Import chunk must be an array of no more than 200 rows' using errcode = '22023';
  end if;
  if p_job_status is not null and p_job_status not in ('uploaded','mapping','validated','ready','applying','applied','failed') then
    raise exception 'Invalid import job status' using errcode = '22023';
  end if;

  -- FOR UPDATE, before anything is written: this is the lease, and it is what
  -- claim_data_import_jobs' `for update skip locked` passes over.
  select j.claimed_by, j.claim_expires_at
  into v_claimed_by, v_claim_expires
  from public.data_import_jobs j
  where j.id = p_job_id
  for update;

  if v_claim_expires is not null
     and v_claim_expires > now()
     and v_claimed_by is distinct from v_holder then
    raise exception
      'This import is already being applied by another session or by the durable import worker. Wait for that run to finish or its claim to expire before continuing.'
      using errcode = '55006';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    insert into public.data_import_rows(
      organization_id, job_id, row_number, source_row, normalized_row,
      proposed_action, status, target_table, target_id, before_snapshot,
      errors, warnings, applied_at
    ) values (
      v_org,
      p_job_id,
      (v_row ->> 'rowNumber')::integer,
      coalesce(v_row -> 'sourceRow', '{}'::jsonb),
      coalesce(v_row -> 'normalizedRow', '{}'::jsonb),
      coalesce(v_row ->> 'proposedAction', 'create'),
      v_row ->> 'status',
      nullif(v_row ->> 'targetTable', ''),
      nullif(v_row ->> 'targetId', '')::uuid,
      v_row -> 'beforeSnapshot',
      coalesce(v_row -> 'errors', '[]'::jsonb),
      coalesce(v_row -> 'warnings', '[]'::jsonb),
      case when v_row ->> 'status' = 'applied' then now() else null end
    )
    on conflict (job_id, row_number) do update set
      source_row = excluded.source_row,
      normalized_row = excluded.normalized_row,
      proposed_action = excluded.proposed_action,
      status = excluded.status,
      target_table = excluded.target_table,
      target_id = excluded.target_id,
      before_snapshot = excluded.before_snapshot,
      errors = excluded.errors,
      warnings = excluded.warnings,
      applied_at = coalesce(excluded.applied_at, public.data_import_rows.applied_at),
      updated_at = now()
    where public.data_import_rows.status not in ('applied','reverted')
       or excluded.status in ('reverted');
    v_count := v_count + 1;
  end loop;

  select
    count(*) filter (where r.status in ('valid','applied','skipped')),
    count(*) filter (where jsonb_array_length(r.warnings) > 0),
    count(*) filter (where r.status in ('invalid','failed')),
    count(*) filter (where r.status = 'applied'),
    count(*) filter (where r.status = 'skipped')
  into v_valid, v_warning, v_error, v_applied, v_skipped
  from public.data_import_rows r where r.job_id = p_job_id;

  update public.data_import_jobs j
  set valid_rows = v_valid,
      warning_rows = v_warning,
      error_rows = v_error,
      applied_rows = v_applied,
      skipped_rows = v_skipped,
      status = coalesce(p_job_status, j.status),
      started_at = coalesce(j.started_at, now()),
      applied_at = case when p_job_status = 'applied' then now() else j.applied_at end,
      last_error = p_last_error,
      claimed_by = case when v_phase_done then null else v_holder end,
      claimed_at = case when v_phase_done then null else coalesce(j.claimed_at, now()) end,
      claim_expires_at = case when v_phase_done then null else now() + interval '5 minutes' end,
      updated_at = now()
  where j.id = p_job_id;

  insert into public.data_import_events(organization_id, job_id, event_type, actor_profile_id, details)
  values (v_org, p_job_id, 'chunk_recorded', auth.uid(), jsonb_build_object('rows', v_count, 'status', p_job_status));

  return jsonb_build_object('jobId', p_job_id, 'recorded', v_count, 'valid', v_valid,
    'warnings', v_warning, 'errors', v_error, 'applied', v_applied, 'skipped', v_skipped);
end;
$$;

comment on function public.record_data_import_chunk(uuid, jsonb, text, text) is
  'Records one chunk of an import ledger and holds the job''s claim for its caller while the run '
  'is in progress, so the durable worker and a browser session cannot apply the same rows. '
  'Called with an empty chunk and no status it is an atomic lease acquisition. BACKLOG.md G34.';

-- CREATE OR REPLACE preserves the existing ACL; re-asserted so this migration is self-describing
-- about who may reach the function.
revoke all on function public.record_data_import_chunk(uuid, jsonb, text, text)
  from public, anon;
grant execute on function public.record_data_import_chunk(uuid, jsonb, text, text)
  to authenticated, service_role;
