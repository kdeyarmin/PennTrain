-- Receipting a single applied row through record_data_import_chunk costs a full recount of
-- every row in the job, a jobs-row rewrite, and a data_import_events insert -- per row. The
-- employee importer receipts each applied row individually (a chunk-end-only receipt left
-- every already-written row unreceipted when the receipt failed, and the retry re-inserted
-- them all), so a large roster apply was O(rows) full scans plus O(rows) 'chunk_recorded'
-- events that each describe one row. This is the durable per-row receipt without the
-- per-chunk bookkeeping: the same lease check and upsert carve-outs as
-- record_data_import_chunk, no recount, no event, plus a claim refresh so a slow chunk
-- cannot outlive its own lease mid-apply. The chunk-level call at the end of each chunk
-- still recounts and records the event exactly once.

create function public.record_data_import_row_receipt(
  p_job_id uuid,
  p_row jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
  -- The same identity `claim_data_import_jobs` writes, so the worker and a platform admin
  -- reclaiming their own job are recognised rather than locked out by their own lease.
  v_holder text := coalesce((select auth.uid())::text, 'worker');
  v_claimed_by text;
  v_claim_expires timestamptz;
begin
  if jsonb_typeof(p_row) <> 'object' then
    raise exception 'Import row receipt must be a single row object' using errcode = '22023';
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

  insert into public.data_import_rows(
    organization_id, job_id, row_number, source_row, normalized_row,
    proposed_action, status, target_table, target_id, before_snapshot,
    errors, warnings, applied_at
  ) values (
    v_org,
    p_job_id,
    (p_row ->> 'rowNumber')::integer,
    coalesce(p_row -> 'sourceRow', '{}'::jsonb),
    coalesce(p_row -> 'normalizedRow', '{}'::jsonb),
    coalesce(p_row ->> 'proposedAction', 'create'),
    p_row ->> 'status',
    nullif(p_row ->> 'targetTable', ''),
    nullif(p_row ->> 'targetId', '')::uuid,
    p_row -> 'beforeSnapshot',
    coalesce(p_row -> 'errors', '[]'::jsonb),
    coalesce(p_row -> 'warnings', '[]'::jsonb),
    case when p_row ->> 'status' = 'applied' then now() else null end
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

  update public.data_import_jobs j
  set claimed_by = v_holder,
      claimed_at = coalesce(j.claimed_at, now()),
      claim_expires_at = now() + interval '5 minutes',
      updated_at = now()
  where j.id = p_job_id;

  return jsonb_build_object('jobId', p_job_id, 'rowNumber', (p_row ->> 'rowNumber')::integer);
end;
$$;

revoke all on function public.record_data_import_row_receipt(uuid, jsonb)
  from public, anon;
grant execute on function public.record_data_import_row_receipt(uuid, jsonb)
  to authenticated, service_role;
