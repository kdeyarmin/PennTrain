-- The durable import worker wrote tables the service role cannot write.
--
-- THE FINDING, verified against production grants and against a clean replay -- the grants are the
-- same in both, so this is the deployed contract and not drift:
--
--   data_import_jobs          SELECT           -- the worker UPDATEs it (job counters, applied_at)
--   data_import_rows          SELECT           -- the worker UPDATEs it (every row's outcome)
--   employees                 SELECT, INSERT   -- the worker UPDATEs it
--   residents                 SELECT           -- the worker INSERTs and UPDATEs it
--   resident_assessment_forms SELECT           -- the worker INSERTs and UPDATEs it
--   facility_assignments      INSERT           -- the worker SELECTs it
--
-- So every apply for the employees, residents and assessments domains fails at the first ledger
-- write -- before touching a single record -- while credentials, training records, rooms and
-- incidents go through `import_apply_*` RPCs and survive. `import_apply_resident_contact` was
-- granted to `authenticated` only, so the contacts domain fails at the RPC call instead.
--
-- Production has never run an import (zero jobs), so nothing has broken yet. Data import is the
-- first thing a pilot facility does.
--
-- WHY RPCs AND NOT GRANTS. `carebase_activation_wave.test.sql` pins the contract in words:
-- "mutations stay on SECURITY DEFINER RPCs". Granting the service role UPDATE on `employees` and
-- `residents` would settle the immediate failure by abandoning the rule that produced it -- and
-- that rule is doing real work, because a service-role connection has no `auth.uid()` and every
-- row-level protection in this schema is written against one. The three functions below are the
-- same shape as the `import_apply_*` functions that already exist: the worker keeps the payload
-- construction and the per-row scope decisions it already has (and already tests), and the write
-- itself moves behind a definer function that re-checks the job's organization in SQL, so the
-- boundary does not depend on the caller getting it right.
--
-- `facility_assignments` is a READ, so it gets a read grant. Reads were never the contract.
--
-- THE UPDATE SEMANTICS THIS HAD TO PRESERVE. The worker updates only the columns the ledger row
-- actually carries. Two comments in that file explain why, and both name a bug that was fixed by
-- getting it right: padding the payload back to full shape "erased a resident's recorded date of
-- birth and room on rescue of a re-import that touched neither", and on employees it "would null
-- absent columns and flip status back to active". So these take a jsonb payload and write only its
-- keys -- absent means untouched, present-and-null means null -- against a per-table allowlist
-- that is spelled out here rather than inferred, so a column added to `employees` later is not
-- silently importable.
--
-- Rollback: drop the three functions and revoke the grants. That restores a worker that cannot
-- finish an employees, residents or assessments import.

-- ---------------------------------------------------------------------------------------
-- The ledger. Both writes the worker makes, as functions it can execute.
-- ---------------------------------------------------------------------------------------

create or replace function public.import_mark_row(
  p_row_id uuid,
  p_status text,
  p_target_table text,
  p_target_id uuid,
  p_errors text[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  if p_status not in ('applied', 'skipped', 'failed') then
    raise exception 'A row outcome must be applied, skipped or failed, not %', p_status
      using errcode = '22023';
  end if;

  select r.job_id into v_job_id from public.data_import_rows r where r.id = p_row_id;
  if v_job_id is null then
    raise exception 'Import row not found' using errcode = 'P0002';
  end if;
  perform app_private.assert_import_manager(v_job_id);

  update public.data_import_rows
  set status = p_status,
      target_table = p_target_table,
      -- A failure keeps no target: the row did not land anywhere.
      target_id = case when p_status = 'failed' then null else p_target_id end,
      -- `errors` is jsonb, not text[] -- `db lint` caught the mismatch statically, which is the
      -- only place it would have shown up before a caregiver's import hit it at runtime.
      errors = to_jsonb(coalesce(p_errors, array[]::text[])),
      applied_at = case when p_status = 'failed' then null else now() end
  where id = p_row_id;
end;
$$;

comment on function public.import_mark_row(uuid, text, text, uuid, text[]) is
  'Records one import row''s outcome. The durable worker''s only write to data_import_rows.';

create or replace function public.import_recount_job(
  p_job_id uuid,
  p_finalize_applied boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_applied integer;
  v_skipped integer;
  v_valid integer;
  v_errors integer;
begin
  perform app_private.assert_import_manager(p_job_id);

  -- Counted in SQL rather than by shipping every row's status to the worker and counting there,
  -- which is what this replaced: a 5,000-row import fetched 5,000 statuses per pass to produce
  -- four integers.
  select
    count(*) filter (where status = 'applied'),
    count(*) filter (where status = 'skipped'),
    count(*) filter (where status = 'valid'),
    count(*) filter (where status in ('failed', 'invalid'))
  into v_applied, v_skipped, v_valid, v_errors
  from public.data_import_rows
  where job_id = p_job_id;

  update public.data_import_jobs
  set applied_rows = v_applied,
      skipped_rows = v_skipped,
      valid_rows = v_valid,
      error_rows = v_errors,
      applied_at = case when p_finalize_applied then now() else applied_at end
  where id = p_job_id;

  return jsonb_build_object(
    'appliedRows', v_applied,
    'skippedRows', v_skipped,
    'validRows', v_valid,
    'errorRows', v_errors
  );
end;
$$;

comment on function public.import_recount_job(uuid, boolean) is
  'Recounts an import job''s row outcomes and persists the counters. The durable worker''s only write to data_import_jobs.';

-- ---------------------------------------------------------------------------------------
-- The three domains that had no RPC. One shape, three allowlists.
-- ---------------------------------------------------------------------------------------

-- Applies one payload's keys to a row, or inserts it. Shared by the three functions below so the
-- "absent means untouched" rule is written once.
--
-- Dynamic SQL, deliberately and narrowly: every column name is checked for membership in the
-- caller's allowlist before it reaches quote_ident, so a key the payload invents cannot become a
-- column reference, and a column the allowlist does not name cannot be written at all -- including
-- one added to the table after this migration.
create or replace function app_private.import_write_row(
  p_table text,
  p_allowlist text[],
  p_row_id uuid,
  p_org_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_columns text[] := array[]::text[];
  v_values text[] := array[]::text[];
  v_sets text[] := array[]::text[];
  v_sql text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_payload, 'null'::jsonb)) <> 'object' then
    raise exception 'import payload must be an object' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_payload) loop
    -- organization_id is never taken from the payload: it comes from the job, below.
    if v_key = 'organization_id' then
      continue;
    end if;
    if not (v_key = any(p_allowlist)) then
      raise exception '% is not an importable column of %', v_key, p_table using errcode = '22023';
    end if;
    v_columns := v_columns || quote_ident(v_key);
    -- Read back off a typed record rather than out of the jsonb: `payload -> 'hire_date'` is a
    -- jsonb value and will not assign to a date column, and `->>` would turn `content` (a jsonb
    -- column) into a string. jsonb_populate_record types every key by the table's own definition.
    v_values := v_values || format('src.%s', quote_ident(v_key));
    v_sets := v_sets || format('%s = src.%s', quote_ident(v_key), quote_ident(v_key));
  end loop;

  if array_length(v_columns, 1) is null then
    raise exception 'import payload has no importable columns' using errcode = '22023';
  end if;

  if p_row_id is null then
    v_sql := format(
      'insert into public.%I (organization_id, %s) '
      'select $1, %s from jsonb_populate_record(null::public.%I, $2) src returning id',
      p_table,
      array_to_string(v_columns, ', '),
      array_to_string(v_values, ', '),
      p_table
    );
    execute v_sql into v_id using p_org_id, p_payload;
  else
    v_sql := format(
      'update public.%I t set %s from jsonb_populate_record(null::public.%I, $2) src '
      'where t.id = $3 and t.organization_id = $1 returning t.id',
      p_table,
      array_to_string(v_sets, ', '),
      p_table
    );
    execute v_sql into v_id using p_org_id, p_payload, p_row_id;
    if v_id is null then
      raise exception 'import target was not found in the job organization' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

comment on function app_private.import_write_row(text, text[], uuid, uuid, jsonb) is
  'Writes only the keys a payload carries, against a per-table allowlist. Absent means untouched; present-and-null means null.';

create or replace function public.import_apply_employee(
  p_job_id uuid,
  p_employee_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
begin
  if not exists (
    select 1 from public.data_import_jobs j where j.id = p_job_id and j.domain = 'employees'
  ) then
    raise exception 'import job does not accept employees' using errcode = '22023';
  end if;
  return app_private.import_write_row(
    'employees',
    array[
      'facility_id', 'first_name', 'last_name', 'job_title', 'email', 'employee_number',
      'department', 'phone', 'hire_date', 'status', 'trainer_status', 'administers_medications'
    ]::text[],
    p_employee_id, v_org, p_payload
  );
end;
$$;

create or replace function public.import_apply_resident(
  p_job_id uuid,
  p_resident_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
begin
  if not exists (
    select 1 from public.data_import_jobs j where j.id = p_job_id and j.domain = 'residents'
  ) then
    raise exception 'import job does not accept residents' using errcode = '22023';
  end if;
  return app_private.import_write_row(
    'residents',
    array[
      'facility_id', 'first_name', 'last_name', 'date_of_birth', 'room',
      'admission_date', 'preferred_name', 'status'
    ]::text[],
    p_resident_id, v_org, p_payload
  );
end;
$$;

create or replace function public.import_apply_resident_assessment(
  p_job_id uuid,
  p_form_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
begin
  if not exists (
    -- 'assessments' is the value data_import_jobs_domain_check allows and process-data-import-jobs
    -- dispatches. An earlier draft read 'resident_assessments', which is not in that vocabulary at
    -- all, so this predicate matched no job and every assessment row failed 22023 before it was
    -- written. Found in review; the assertion below now calls this with a real job.
    select 1 from public.data_import_jobs j where j.id = p_job_id and j.domain = 'assessments'
  ) then
    raise exception 'import job does not accept resident assessments' using errcode = '22023';
  end if;
  return app_private.import_write_row(
    'resident_assessment_forms',
    array[
      'facility_id', 'resident_id', 'form_type', 'reason', 'status',
      'prepared_date', 'content', 'version_number', 'schema_version'
    ]::text[],
    p_form_id, v_org, p_payload
  );
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Who may call these, and the one read grant.
-- ---------------------------------------------------------------------------------------
-- The worker only. These take an already-validated payload and write it; the interactive import
-- surface goes through start_data_import_job and record_data_import_chunk, which validate.
revoke all on function public.import_mark_row(uuid, text, text, uuid, text[]) from public, anon, authenticated;
revoke all on function public.import_recount_job(uuid, boolean) from public, anon, authenticated;
revoke all on function public.import_apply_employee(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.import_apply_resident(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.import_apply_resident_assessment(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function app_private.import_write_row(text, text[], uuid, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.import_mark_row(uuid, text, text, uuid, text[]) to service_role;
grant execute on function public.import_recount_job(uuid, boolean) to service_role;
grant execute on function public.import_apply_employee(uuid, uuid, jsonb) to service_role;
grant execute on function public.import_apply_resident(uuid, uuid, jsonb) to service_role;
grant execute on function public.import_apply_resident_assessment(uuid, uuid, jsonb) to service_role;

-- The contacts domain fails for a different reason and in a different place: its RPC exists and is
-- correct, and was granted to `authenticated` only -- so the worker's call is refused before any
-- of its logic runs.
grant execute on function public.import_apply_resident_contact(uuid, uuid, jsonb, uuid) to service_role;

-- A read, not a mutation. The worker checks whether the job's creating manager is still assigned
-- to a facility before letting a rescued row reach it; refusing the read makes that check fail
-- closed on every row, which is a different bug wearing the same clothes.
grant select on public.facility_assignments to service_role;

-- ---------------------------------------------------------------------------------------
-- Four smaller functions of the same class: a read or a write the narrowing took away.
-- ---------------------------------------------------------------------------------------
-- Each of these is a single table and a single privilege, and each is a read except where a
-- write is what the function exists to do. They go through the phase1_access_matrix allowlist,
-- which is where an approved service-role privilege is recorded and where an UNapproved one is
-- caught -- adding a grant without adding it there fails that test, which is the point.

-- process-credential-renewals reads the uploaded document it is about to OCR. With no grant at
-- all, every renewal submission throws before the extraction starts.
grant select on public.employee_credential_documents to service_role;

-- generate-poc-document rewrites the stored plan-of-correction PDF when a plan is amended. It
-- holds SELECT, INSERT and DELETE and not UPDATE, so the first generation works and every
-- regeneration after an edit answers 500.
grant update on public.violation_documents to service_role;

-- invite-user's compensating cleanup detaches the employee it linked when the invitation email
-- fails to send. Without it the compensation itself fails, and the employee is left pointing at
-- an auth user who never received an invitation -- which the employee page then reports as
-- "already has portal access", with no way to re-invite.
grant update (profile_id, updated_at) on public.employees to service_role;

-- create-billing-session embeds `packages!inner(is_active, trial_days)` to confirm the plan is
-- still sold before creating a Stripe session. With no grant on `packages` the embed returns
-- nothing and self-serve checkout answers `active_price_missing` for every plan, which reads as
-- a pricing problem rather than a permission one.
grant select on public.packages to service_role;
