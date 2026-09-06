-- One bad row that stranded an import, an archive that could be made twice, and two events in the
-- same second applied backwards.
--
-- RELEASE_READINESS_PLAN.md section 4.3, imports D1/D2/D5/D7 and platform L6/L7/L10.
--
-- D1. A single failed row blocked Apply, Finalize AND re-run, and nothing could cancel or skip it.
--     `finalize_data_import_job` refuses a receipt with `error_rows > 0` and says "Resolve or
--     explicitly skip invalid rows before finalization" -- and no function in this database could
--     perform that explicit skip. Worse, the stranded receipt owned the file:
--     `start_data_import_job` reuses any job for the same (organization, domain, checksum, creator)
--     still in uploaded|mapping|validated|ready|applying|failed, so re-uploading the same bytes came
--     back to the same dead job. `data_import_jobs` has carried a `canceled` status in its CHECK
--     constraint and a `canceled_at` column since the day it was created, and nothing has ever
--     written either. Two RPCs give the operator the two exits: skip the rows, or close the receipt.
--
-- D2 (the half that is a defect). `set_hris_import_row_decision` refuses any decision on a row whose
--     `validation_status <> 'valid'`, and `apply_hris_import_batch` refuses the whole run while any
--     such row exists. Between them, one invalid row could never be resolved and stranded the import
--     permanently. A human dropping a row that failed validation is exactly the escape hatch, and
--     `skip`/`reject` write nothing to `employees`, so they are admitted for an invalid row while
--     `create`/`link` stay refused. (The other half of D2 -- nothing calls `stage_hris_import_row`
--     -- is by design: it is service_role only and its adapter is deployed outside this repository,
--     per PHASE3_OPERATIONS.md. What was missing in the product was a way to register the source
--     system that adapter fills, which is a UI change, not a SQL one.)
--
-- D5. `request_organization_export` refused a second request only while one was `pending` or
--     `processing`. But `claim_organization_export_jobs` claims `status in ('pending','failed') and
--     attempt_count < max_attempts`, so a failed job with attempts left is not finished -- it is
--     waiting out `finish_organization_export_job`'s backoff and WILL run again. During that window
--     an org admin could queue a second complete archive of the same tenant, and both would be
--     produced.
--
-- D7. Nothing stopped two employees in one organization sharing an `employee_number`. The CSV
--     importer's duplicate detection matches on exactly that pair (`.eq(organization_id)` +
--     `.eq(employee_number)` + `.limit(1)`), so a duplicate created at one facility silently changed
--     what "skip" and "update" mean at another. Checked against the live database first: zero
--     duplicate (organization_id, employee_number) pairs, so the index can be created. It is partial
--     over non-null, non-empty numbers because a blank employee number is "not recorded", not a
--     value, and several thousand rows may legitimately share that state.
--
-- L6. Two migrations updated the compliance-maintenance job definition
--     `where job_key = 'compliance-requirement-maintenance-daily'`. That string is the CRON JOB NAME;
--     the job_key is `compliance-requirement-maintenance`. Both statements matched zero rows, so both
--     were silent no-ops (20260729221600 and 20260729223000, both immutable). /admin/system-jobs has
--     described the job as one statement ever since, while `execute_registered_sql_job` runs four.
--
-- L7. REPRODUCED before it was fixed. `event.created` is a UNIX SECOND, so two real Stripe events for
--     one object in the same second carry an identical `provider_event_created_at` and the ordering
--     guard falls through to comparing `evt_...` ids -- random strings whose lexical order has
--     nothing to do with causal order. Reproduced on the local stack: subscription past_due as
--     `evt_zzz...` then active as `evt_aaa...`, delivered in that (correct) order; the second was
--     rejected as stale and the tenant was left in `grace` while Stripe said `active`. The receipt
--     table already records a real arrival instant per event (`signature_verified_at`, stamped with
--     `clock_timestamp()` at insert), and a redelivery never reaches this guard -- it is caught by
--     the `on conflict (event_id) do nothing` duplicate check above it -- so arrival order is a
--     sound and explainable tie-break where a random id was not.
--
-- L10. `monday-digest` was retired on 2026-08-02 (`is_active = false`, `cron_job_name = null`, cron
--     entry unscheduled) and `execute_registered_sql_job` kept an arm for it. The wrapper is the
--     claim path, so the arm was a live route to the retired duplicate digest for anything that
--     could name the key. The arm goes; `send_monday_digest()` itself is untouched, because the
--     retirement migration deliberately kept it for manual invocation and pgTAP.

-- ---------------------------------------------------------------------------
-- D1 -- the two exits a stranded import receipt never had
-- ---------------------------------------------------------------------------

create or replace function public.skip_data_import_rows(
  p_job_id uuid,
  p_row_numbers integer[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
  v_job public.data_import_jobs%rowtype;
  v_skipped integer;
  v_counts jsonb;
begin
  select * into v_job from public.data_import_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Import job not found' using errcode = 'P0002';
  end if;
  if v_job.status in ('finalized', 'rolled_back', 'canceled') then
    raise exception 'A closed import receipt cannot be changed' using errcode = '22023';
  end if;

  -- Only rows that did not land. An applied row is undone by rollback, not by skipping it.
  update public.data_import_rows r
  set status = 'skipped',
      warnings = r.warnings || to_jsonb(array['Skipped by an import manager; this row was never written.']),
      updated_at = now()
  where r.job_id = p_job_id
    and r.status in ('invalid', 'failed')
    and (p_row_numbers is null or r.row_number = any(p_row_numbers));
  get diagnostics v_skipped = row_count;

  if v_skipped = 0 then
    raise exception 'No failed or invalid rows on this import match that selection' using errcode = '22023';
  end if;

  v_counts := public.import_recount_job(p_job_id, false);

  insert into public.data_import_events(organization_id, job_id, event_type, actor_profile_id, details)
  values (
    v_org, p_job_id, 'rows_skipped', auth.uid(),
    jsonb_build_object('skippedNow', v_skipped, 'rowNumbers', to_jsonb(p_row_numbers))
  );

  return jsonb_build_object(
    'jobId', p_job_id,
    'skippedNow', v_skipped,
    'skippedRows', (v_counts ->> 'skippedRows')::integer,
    'errorRows', (v_counts ->> 'errorRows')::integer
  );
end;
$function$;

comment on function public.skip_data_import_rows(uuid, integer[]) is
  'Marks an import job''s failed/invalid rows as skipped and recounts the receipt, which is the '
  '"explicitly skip invalid rows" that finalize_data_import_job''s own refusal asks for. Nothing '
  'could perform it before, so one bad row blocked Apply and Finalize with no way forward '
  '(RELEASE_READINESS_PLAN 4.3, imports D1). Never touches an applied row -- that is rollback''s job.';

revoke all on function public.skip_data_import_rows(uuid, integer[]) from public, anon;
grant execute on function public.skip_data_import_rows(uuid, integer[]) to authenticated, service_role;

create or replace function public.cancel_data_import_job(
  p_job_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
  v_job public.data_import_jobs%rowtype;
begin
  select * into v_job from public.data_import_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Import job not found' using errcode = 'P0002';
  end if;
  if v_job.status in ('finalized', 'rolled_back', 'canceled') then
    raise exception 'This import receipt is already closed' using errcode = '22023';
  end if;
  -- Cancelling is for a receipt that wrote nothing. Once rows have landed the honest exits are
  -- rollback (undo the eligible creates) or finalize (keep them and close the receipt); silently
  -- marking such a job "canceled" would describe applied rows as never having happened.
  if v_job.applied_rows > 0 then
    raise exception 'This import has applied rows; roll it back or finalize it instead of cancelling'
      using errcode = '22023';
  end if;
  -- A worker holding a live claim is mid-flight. Let its lease expire rather than racing it.
  if v_job.claim_expires_at is not null and v_job.claim_expires_at > now() then
    raise exception 'A worker currently holds this import; try again once its claim expires'
      using errcode = '55000';
  end if;

  update public.data_import_jobs
  set status = 'canceled',
      canceled_at = now(),
      last_error = left(nullif(btrim(coalesce(p_reason, '')), ''), 2000),
      claimed_at = null,
      claimed_by = null,
      claim_expires_at = null,
      updated_at = now()
  where id = p_job_id;

  insert into public.data_import_events(organization_id, job_id, event_type, actor_profile_id, details)
  values (
    v_org, p_job_id, 'canceled', auth.uid(),
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''), 'statusBefore', v_job.status)
  );

  return jsonb_build_object('jobId', p_job_id, 'status', 'canceled', 'canceledAt', now());
end;
$function$;

comment on function public.cancel_data_import_job(uuid, text) is
  'Closes an import receipt from which nothing was applied, writing the `canceled` status and '
  'canceled_at column that data_import_jobs has always carried and nothing ever set. `canceled` is '
  'not in start_data_import_job''s reuse list, so cancelling also releases the file checksum a '
  'stranded receipt was holding (RELEASE_READINESS_PLAN 4.3, imports D1). Refused once rows have '
  'been applied: rollback or finalize are the honest exits then.';

revoke all on function public.cancel_data_import_job(uuid, text) from public, anon;
grant execute on function public.cancel_data_import_job(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D2 -- one invalid HRIS row must not strand the run
-- ---------------------------------------------------------------------------

do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.set_hris_import_row_decision(uuid,text,uuid,text)'::regprocedure);
  v_old := $old$  if v_row.validation_status <> 'valid' or p_decision not in ('create', 'link', 'skip', 'reject') then
    raise exception 'Invalid HRIS merge decision' using errcode = '22023';
  end if;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'set_hris_import_row_decision no longer contains the validation-status guard this migration patches';
  end if;
  v_new := $patch$  if p_decision not in ('create', 'link', 'skip', 'reject') then
    raise exception 'Invalid HRIS merge decision' using errcode = '22023';
  end if;
  -- A row that failed validation can still be disposed of, and only by being dropped: skip and
  -- reject write nothing to employees. Refusing every decision on it left the row undecided
  -- forever, and apply_hris_import_batch refuses a run while any row is undecided, so one invalid
  -- row stranded the whole import (RELEASE_READINESS_PLAN 4.3, imports D2).
  if v_row.validation_status <> 'valid' and p_decision not in ('skip', 'reject') then
    raise exception 'A row that failed validation may only be skipped or rejected' using errcode = '22023';
  end if;$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.apply_hris_import_batch(uuid,integer)'::regprocedure);
  v_old := $old$  if exists (
    select 1 from public.hris_import_rows
    where import_run_id = v_run.id and validation_status <> 'valid'
  ) or exists (
    select 1 from public.hris_import_rows
    where import_run_id = v_run.id and merge_decision is null
  ) then
    raise exception 'Every valid HRIS row requires a deterministic decision' using errcode = '55000';
  end if;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'apply_hris_import_batch no longer contains the all-rows-decided guard this migration patches';
  end if;
  v_new := $patch$  -- Every row needs a decision, and a row that failed validation may only carry one that writes
  -- nothing. The previous form refused the run outright while ANY row was not `valid` -- a state no
  -- decision could clear, because set_hris_import_row_decision refused invalid rows too -- so one
  -- bad row stranded the import permanently (RELEASE_READINESS_PLAN 4.3, imports D2).
  if exists (
    select 1 from public.hris_import_rows
    where import_run_id = v_run.id
      and (merge_decision is null
        or (validation_status <> 'valid' and merge_decision not in ('skip', 'reject')))
  ) then
    raise exception 'Every HRIS row requires a decision, and a row that failed validation may only be skipped or rejected'
      using errcode = '55000';
  end if;$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

-- ---------------------------------------------------------------------------
-- D5 -- a retryable failed export is not a finished one
-- ---------------------------------------------------------------------------

do $do$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.request_organization_export()'::regprocedure);
  v_old := $old$  if exists (
    select 1 from public.organization_export_jobs j
    where j.organization_id = v_org_id
      and j.status in ('pending','processing')
  ) then
    raise exception 'An organization export is already in progress' using errcode = '55000';
  end if;$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'request_organization_export no longer contains the in-progress guard this migration patches';
  end if;
  v_new := $patch$  -- claim_organization_export_jobs claims `status in ('pending','failed') and attempt_count <
  -- max_attempts`, so a failed job with attempts left is not finished: it is waiting out
  -- finish_organization_export_job's backoff and will run again. Admitting a second request during
  -- that window produced two complete archives of the same tenant
  -- (RELEASE_READINESS_PLAN 4.3, imports D5).
  if exists (
    select 1 from public.organization_export_jobs j
    where j.organization_id = v_org_id
      and (j.status in ('pending','processing')
        or (j.status = 'failed' and j.attempt_count < j.max_attempts))
  ) then
    raise exception 'An organization export is already in progress or queued for retry' using errcode = '55000';
  end if;$patch$;
  execute replace(v_def, v_old, v_new);
end
$do$;

-- ---------------------------------------------------------------------------
-- D7 -- an employee number is unique inside its organization
-- ---------------------------------------------------------------------------

do $do$
declare v_dupes text;
begin
  select string_agg(format('%s/%s (%s rows)', d.organization_id, d.employee_number, d.n), ', ')
  into v_dupes
  from (
    select e.organization_id, e.employee_number, count(*) as n
    from public.employees e
    where e.employee_number is not null and btrim(e.employee_number) <> ''
    group by 1, 2
    having count(*) > 1
    limit 20
  ) d;
  if v_dupes is not null then
    -- Deliberately loud. This is a uniqueness rule the CSV importer's duplicate matching already
    -- assumes; if real rows break it, a human has to decide which record survives before the index
    -- can exist. Failing here with the offending pairs named is more useful than a bare 23505 from
    -- the index build, and far more useful than skipping the index and pretending the rule holds.
    raise exception 'Cannot add the employee-number uniqueness index: duplicates exist (%)', v_dupes
      using errcode = '23505';
  end if;
end
$do$;

-- Partial: a blank or absent employee number means "not recorded", not a value, and many rows may
-- legitimately share that state.
create unique index if not exists employees_org_employee_number_key
  on public.employees (organization_id, employee_number)
  where employee_number is not null and btrim(employee_number) <> '';

comment on index public.employees_org_employee_number_key is
  'One employee number per organization. The CSV importer matches duplicates on exactly this pair, '
  'so without the index a number reused at a second facility silently changed what the "skip" and '
  '"update" duplicate strategies did (RELEASE_READINESS_PLAN 4.3, imports D7). Partial over '
  'non-null, non-empty numbers: an unrecorded number is not a value.';

-- ---------------------------------------------------------------------------
-- L6 -- the registration two immutable migrations failed to update
-- ---------------------------------------------------------------------------

do $do$
declare v_updated integer;
begin
  update app_private.system_job_definitions
  set description = 'Runs the four daily compliance-maintenance statements in one transaction: '
        || 'recurring compliance requirement occurrences, the 30-day workforce readiness forecast '
        || 'routed into the work queue, user-invitation expiry/acceptance reconciliation, and the '
        || 'OAPSA provisional-clearance clock.',
      updated_at = now()
  where job_key = 'compliance-requirement-maintenance';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'compliance-requirement-maintenance is not registered under that job key (% rows matched)', v_updated;
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- L7 -- two real Stripe events in the same second
-- ---------------------------------------------------------------------------

create or replace function app_private.stripe_event_received_at(p_event_id text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $function$
  -- When this webhook endpoint verified the signature on the event, from the durable receipt.
  -- `event.created` is a UNIX SECOND, so it cannot order two events Stripe emitted inside the same
  -- second, and the previous tie-break compared `evt_...` ids -- random strings. A redelivered event
  -- never reaches an ordering guard (process_stripe_billing_event returns early on the
  -- `on conflict (event_id) do nothing` duplicate check), so the only events being ordered are ones
  -- this endpoint saw for the first time, and the order it saw them in is the best signal available.
  -- '-infinity' for an id with no receipt keeps the comparison total rather than null.
  select coalesce(
    (select e.signature_verified_at
     from app_private.stripe_billing_events e
     where e.event_id = p_event_id),
    '-infinity'::timestamptz);
$function$;

comment on function app_private.stripe_event_received_at(text) is
  'Arrival instant of a signed Stripe event, used to break ties between two events carrying the same '
  'second-granular provider_event_created_at. Replaces a lexical comparison of random evt_ ids '
  '(RELEASE_READINESS_PLAN 4.3, platform L7).';

revoke all on function app_private.stripe_event_received_at(text) from public, anon, authenticated, service_role;

do $do$
declare v_def text; v_old text; v_new text; v_patched text;
begin
  v_def := pg_get_functiondef(
    'public.process_stripe_billing_event(text,text,timestamptz,jsonb,text,text)'::regprocedure);

  -- (1) billing_subscriptions
  v_old := $old$      where public.billing_subscriptions.is_provider_placeholder
        or (excluded.provider_event_created_at, excluded.provider_event_id)
        > (public.billing_subscriptions.provider_event_created_at,
           public.billing_subscriptions.provider_event_id)$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'process_stripe_billing_event no longer contains the subscription ordering guard this migration patches';
  end if;
  v_new := $patch$      where public.billing_subscriptions.is_provider_placeholder
        or (excluded.provider_event_created_at,
            app_private.stripe_event_received_at(excluded.provider_event_id))
        > (public.billing_subscriptions.provider_event_created_at,
           app_private.stripe_event_received_at(public.billing_subscriptions.provider_event_id))$patch$;
  v_patched := replace(v_def, v_old, v_new);

  -- (2) billing_invoices
  v_old := $old$      where (excluded.provider_event_created_at, excluded.provider_event_id)
        > (public.billing_invoices.provider_event_created_at,
           public.billing_invoices.provider_event_id);$old$;
  if position(v_old in v_patched) = 0 then
    raise exception 'process_stripe_billing_event no longer contains the invoice ordering guard this migration patches';
  end if;
  v_new := $patch$      where (excluded.provider_event_created_at,
             app_private.stripe_event_received_at(excluded.provider_event_id))
        > (public.billing_invoices.provider_event_created_at,
           app_private.stripe_event_received_at(public.billing_invoices.provider_event_id));$patch$;
  v_patched := replace(v_patched, v_old, v_new);

  -- (3) and (4) billing_accounts -- the same two lines appear in the subscription branch and the
  -- invoice-payment branch, and replace() rewrites both.
  v_old := $old$          and (a.provider_event_created_at is null
            or (p_event_created_at, p_event_id) > (a.provider_event_created_at, a.provider_event_id));$old$;
  if position(v_old in v_patched) = 0 then
    raise exception 'process_stripe_billing_event no longer contains the billing-account ordering guard this migration patches';
  end if;
  v_new := $patch$          and (a.provider_event_created_at is null
            or (p_event_created_at, app_private.stripe_event_received_at(p_event_id))
              > (a.provider_event_created_at, app_private.stripe_event_received_at(a.provider_event_id)));$patch$;
  v_patched := replace(v_patched, v_old, v_new);

  execute v_patched;
end
$do$;

-- ---------------------------------------------------------------------------
-- L10 -- the wrapper arm a retired job kept
-- ---------------------------------------------------------------------------

do $do$
declare v_def text; v_old text;
begin
  if exists (
    select 1 from app_private.system_job_definitions
    where job_key = 'monday-digest' and (is_active or cron_job_name is not null)
  ) then
    raise exception 'monday-digest is registered again; do not remove its wrapper arm';
  end if;

  v_def := pg_get_functiondef('public.execute_registered_sql_job(text,text,text)'::regprocedure);
  v_old := $old$      when 'monday-digest' then perform public.send_monday_digest();
$old$;
  if position(v_old in v_def) = 0 then
    raise exception 'execute_registered_sql_job no longer contains the monday-digest arm this migration removes';
  end if;
  -- Retired 2026-08-02 by 20260802080000: is_active = false, cron_job_name = null, cron entry
  -- unscheduled, its resident-compliance counts folded into queue_manager_weekly_digests. The
  -- wrapper is the claim path, so leaving the arm in place kept a live route to the retired
  -- duplicate digest for anything that could name the key (RELEASE_READINESS_PLAN 4.3, platform
  -- L10). send_monday_digest() itself stays -- the retirement migration kept it deliberately for
  -- manual invocation and pgTAP coverage.
  execute replace(v_def, v_old, '');
end
$do$;
