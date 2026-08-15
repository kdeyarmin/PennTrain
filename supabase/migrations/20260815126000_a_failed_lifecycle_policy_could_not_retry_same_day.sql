-- A failed lifecycle policy could not be retried until the next Pennsylvania day.
--
-- run_data_lifecycle_policy inserts its run receipt (unique request_id, which the worker
-- derives as periodEnd:policy_key) BEFORE sweeping, and keeps the row on failure -- so after
-- any transient error, every same-day re-invocation of that policy hit the unique constraint
-- and did no work. Retention was delayed a full day per failure (never lost, and never
-- unsafe, but a 207 response with zero progress). The receipt now yields to a retry when --
-- and only when -- the prior run for the same request id FAILED; completed and running
-- receipts still refuse with the same SQLSTATE 23505 the constraint raised, so the worker's
-- duplicate handling is untouched.

create or replace function public.run_data_lifecycle_policy(
  p_policy_key text,
  p_limit integer default 5000,
  p_request_id text default extensions.gen_random_uuid()::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_policy public.data_lifecycle_policies%rowtype;
  v_run_id uuid;
  v_cutoff timestamptz;
  v_archived integer := 0;
  v_deleted integer := 0;
  v_held integer := 0;
  v_sql text;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only the trusted lifecycle worker may run retention policies' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 25000 then raise exception 'Lifecycle batch limit is invalid' using errcode = '22023'; end if;
  select * into v_policy from public.data_lifecycle_policies
  where policy_key = p_policy_key and is_active;
  if not found then raise exception 'Lifecycle policy not found' using errcode = 'P0002'; end if;
  v_cutoff := now() - make_interval(days => v_policy.archive_after_days);
  -- A failed run releases its request id for a same-day retry: the receipt row flips back
  -- to running and is reused. Completed and still-running receipts keep the original
  -- duplicate-key refusal (raised explicitly, same SQLSTATE the unique constraint produced,
  -- so callers' 23505 handling is unchanged).
  insert into public.data_lifecycle_runs(policy_key, cutoff_at, request_id)
  values (v_policy.policy_key, v_cutoff, p_request_id)
  on conflict (request_id) do update
    set status = 'running', started_at = now(), completed_at = null, error_message = null,
        cutoff_at = excluded.cutoff_at,
        rows_examined = 0, rows_archived = 0, rows_deleted = 0, rows_held = 0
    where public.data_lifecycle_runs.status = 'failed'
  returning id into v_run_id;
  if v_run_id is null then
    raise unique_violation using message =
      format('duplicate key value violates unique constraint "data_lifecycle_runs_request_id_key" (request %s already ran)', p_request_id);
  end if;

  v_sql := format($sql$
    with candidates as (
      select t.*, to_jsonb(t) as payload
      from %I.%I t
      where t.%I < $1
        and not exists (
          select 1 from public.data_lifecycle_holds h
          where h.released_at is null
            and (h.source_table is null or h.source_table = $2)
            and (h.organization_id is null or h.organization_id = %s)
            and t.%I between h.starts_at and h.ends_at
        )
        %s
      order by t.%I
      limit $3
    ), written as (
      insert into app_private.retained_records_archive (
        source_schema, source_table, source_record_id, organization_id,
        source_occurred_at, retention_policy_key, record_payload, record_checksum_sha256
      ) select $4, $2, id::text, %s, %I, $5, payload,
        encode(extensions.digest(convert_to(payload::text, 'utf8'), 'sha256'), 'hex')
      from candidates
      where not exists (
        select 1 from app_private.retained_records_archive a
        where a.source_table = $2 and a.source_record_id = candidates.id::text
      )
      returning 1
    ) select count(*) from written
  $sql$,
    v_policy.source_schema, v_policy.source_table, v_policy.time_column,
    case when v_policy.organization_column is null then 'null::uuid' else format('t.%I', v_policy.organization_column) end,
    v_policy.time_column,
    case when v_policy.source_table = 'audit_logs' then
      'and not exists (select 1 from app_private.audit_legal_holds ah where ah.released_at is null and (ah.organization_id is null or ah.organization_id = t.organization_id))'
    else '' end,
    v_policy.time_column,
    case when v_policy.organization_column is null then 'null::uuid' else format('%I', v_policy.organization_column) end,
    v_policy.time_column
  );
  execute v_sql into v_archived using v_cutoff, v_policy.source_table, p_limit,
    v_policy.source_schema, v_policy.policy_key;

  if v_policy.disposition = 'archive_then_delete' and v_policy.delete_after_days is not null then
    v_cutoff := now() - make_interval(days => v_policy.delete_after_days);
    v_sql := format($sql$
      delete from %I.%I t where t.id in (
        select t2.id from %I.%I t2
        where t2.%I < $1
          and exists (select 1 from app_private.retained_records_archive a
            where a.source_table = $2 and a.source_record_id = t2.id::text)
          and not exists (select 1 from public.data_lifecycle_holds h
            where h.released_at is null and (h.source_table is null or h.source_table = $2)
              and (h.organization_id is null or h.organization_id = %s)
              and t2.%I between h.starts_at and h.ends_at)
        order by t2.%I limit $3
      )
    $sql$, v_policy.source_schema, v_policy.source_table,
      v_policy.source_schema, v_policy.source_table, v_policy.time_column,
      case when v_policy.organization_column is null then 'null::uuid' else format('t2.%I', v_policy.organization_column) end,
      v_policy.time_column, v_policy.time_column);
    execute v_sql using v_cutoff, v_policy.source_table, p_limit;
    get diagnostics v_deleted = row_count;
  end if;
  update public.data_lifecycle_runs set status = 'completed', completed_at = now(),
    rows_examined = v_archived, rows_archived = v_archived,
    rows_deleted = v_deleted, rows_held = v_held where id = v_run_id;
  return jsonb_build_object('runId', v_run_id, 'policyKey', v_policy.policy_key,
    'archived', v_archived, 'deleted', v_deleted, 'held', v_held);
exception when others then
  if v_run_id is not null then
    update public.data_lifecycle_runs set status = 'failed', completed_at = now(),
      error_message = left(sqlerrm, 2000) where id = v_run_id;
  end if;
  raise;
end;
$function$;

revoke all on function public.run_data_lifecycle_policy(text,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.run_data_lifecycle_policy(text,integer,text) to service_role;
