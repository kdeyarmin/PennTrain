-- The import control plane trusted every caller, and refused the ones it was built for.
--
-- THE FINDING. `app_private.assert_import_manager` and `public.start_data_import_job` decide
-- whether a caller is a trusted worker with
--
--     if current_user in ('postgres', 'service_role', 'supabase_admin') then ...
--
-- Both are SECURITY DEFINER and owned by `postgres`. Inside a SECURITY DEFINER function
-- `current_user` is the function's OWNER, not the caller -- that is the definition of the
-- attribute -- so the test is true for every caller, including a browser session holding an
-- `employee` JWT. Reproduced on a clean replay of the chain on 2026-09-04, in a transaction that
-- was rolled back: an employee of organization A started an import job in organization A, started
-- one in organization B, and recorded ledger rows on a job that belonged to organization B. Every
-- function that delegates to `assert_import_manager` (`record_data_import_chunk`,
-- `record_data_import_row_receipt`, `finalize_data_import_job`, `rollback_data_import_job`,
-- `rollback_employee_import_job`, the import_apply_* family) inherited the same answer.
--
-- The same mistake breaks the product for its real users, which is the only reason it is not
-- worse: `start_data_import_job` takes the trusted branch for an org admin too, and that branch
-- uses `p_organization_id` verbatim -- which every bulk-import-* function passes as null for a
-- non-platform-admin caller -- so a customer's CSV import fails with "Organization is required".
-- The interactive branch that derives the organization from the session, the one written for
-- exactly these callers, was unreachable.
--
-- Neither half was caught. The pgTAP suites for the import ledger exercise same-organization
-- callers and the worker, and `data_import_apply_lease.test.sql` reads the superuser
-- convenience as intended behaviour ("assert_import_manager recognises the superuser test
-- connection the same way it recognises the worker's"). The `definer_predicates_are_tenant_scoped`
-- ratchet exempts any body that names an `assert_` helper, which is correct in general and is
-- why the helper itself has to be right.
--
-- WHAT THIS MIGRATION DOES.
--   1. `app_private.is_trusted_database_session()`: a caller is trusted when its JWT role is
--      `service_role` (the Edge Function workers), or when there is no JWT at all and the SESSION
--      user is `postgres` or `supabase_admin` (pg_cron, migrations, the dashboard, the pgTAP
--      runner). `session_user` survives SECURITY DEFINER; `current_user` does not. A PostgREST
--      request always carries a JWT role, so a browser session can never satisfy either clause.
--   2. `assert_import_manager` and `start_data_import_job` use it, and are otherwise unchanged.
--   3. The two rollback functions stop deleting child rows for a target outside the job's
--      organization. Their child deletes (`employee_facility_assignments`, `employee_credentials`,
--      `practicums`, ... and `facility_beds`) were keyed on the target id alone; only the final
--      parent delete checked the organization. With every caller trusted that was a
--      cross-tenant delete for anyone holding a uuid; with the trust fixed it is still a defence
--      a manager's own ledger row should not be able to disarm, so the guard is added regardless.
--
-- The invitation-lifecycle and digest functions that carry the mirror-image test
-- (`current_user not in (...)` as a guard that can never fire) are not touched here: each is
-- revoked from every browser role, so the grant is doing the work the guard claims to. They are
-- recorded in BACKLOG Tier I for the same treatment.
--
-- Rollback: restore the three definitions from 20260729223100, 20260729223400, 20260730040000
-- and 20260731240000. There is no reason to; the previous definitions are the vulnerability.

create or replace function app_private.is_trusted_database_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (auth.role() is null and session_user in ('postgres', 'supabase_admin'));
$$;

revoke all on function app_private.is_trusted_database_session() from public, anon, authenticated;

comment on function app_private.is_trusted_database_session() is
  'True for a service-role JWT or a JWT-less postgres/supabase_admin session (cron, migrations, '
  'the pgTAP runner). Use this, never current_user, to recognise a trusted worker inside a '
  'SECURITY DEFINER function: current_user there is the owner for every caller. See 20260904130000.';

-- ---------------------------------------------------------------------------
-- assert_import_manager: same contract, real caller
-- ---------------------------------------------------------------------------

create or replace function app_private.assert_import_manager(p_job_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_facility uuid;
begin
  if app_private.is_trusted_database_session() then
    if p_job_id is not null then
      select j.organization_id into v_org from public.data_import_jobs j where j.id = p_job_id;
    end if;
    return v_org;
  end if;

  if public.current_role() not in ('platform_admin','org_admin','facility_manager') then
    raise exception 'Import manager permission required' using errcode = '42501';
  end if;
  if p_job_id is null then
    return public.current_org_id();
  end if;

  select j.organization_id, j.facility_id into v_org, v_facility
  from public.data_import_jobs j where j.id = p_job_id;
  if v_org is null then raise exception 'Import job not found' using errcode = 'P0002'; end if;
  if not public.is_platform_admin()
     and (v_org <> public.current_org_id()
       or (public.current_role() = 'facility_manager'
         and v_facility is not null and not public.is_assigned_to_facility(v_facility))) then
    raise exception 'Import job is outside your scope' using errcode = '42501';
  end if;
  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- start_data_import_job: the interactive branch is reachable again
-- ---------------------------------------------------------------------------

create or replace function public.start_data_import_job(
  p_domain text,
  p_file_name text,
  p_file_sha256 text,
  p_total_rows integer,
  p_duplicate_strategy text default 'create',
  p_facility_id uuid default null,
  p_organization_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean := app_private.is_trusted_database_session();
  v_org uuid;
  v_id uuid;
begin
  if v_trusted then
    v_org := p_organization_id;
  else
    v_org := app_private.assert_import_manager(null);
    if public.is_platform_admin() then v_org := p_organization_id; end if;
  end if;

  if v_org is null then raise exception 'Organization is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    raise exception 'Organization was not found' using errcode = 'P0002';
  end if;
  if p_domain not in ('employees','training_records','credentials','residents','resident_contacts','rooms','assessments','incidents') then
    raise exception 'Unsupported import domain' using errcode = '22023';
  end if;
  if p_file_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid file checksum' using errcode = '22023'; end if;
  if p_total_rows < 1 or p_total_rows > 100000 then raise exception 'Import row count is outside limits' using errcode = '22023'; end if;
  if p_duplicate_strategy not in ('create','skip','update') then raise exception 'Invalid duplicate strategy' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_file_name, ''))) < 1 then raise exception 'File name is required' using errcode = '22023'; end if;
  if p_facility_id is not null and not exists (
    select 1 from public.facilities f where f.id = p_facility_id and f.organization_id = v_org
  ) then raise exception 'Facility is outside import scope' using errcode = '42501'; end if;

  select j.id into v_id
  from public.data_import_jobs j
  where j.organization_id = v_org
    and j.domain = p_domain
    and j.original_file_sha256 = p_file_sha256
    and (
      v_trusted
      or j.created_by is not distinct from auth.uid()
    )
    and j.status in ('uploaded','mapping','validated','ready','applying','failed')
  order by j.created_at desc
  limit 1;

  if v_id is null then
    insert into public.data_import_jobs(
      organization_id, facility_id, domain, original_file_name, original_file_sha256,
      total_rows, duplicate_strategy, status, created_by
    ) values (
      v_org, p_facility_id, p_domain, left(btrim(p_file_name), 255), p_file_sha256,
      p_total_rows, p_duplicate_strategy, 'uploaded', auth.uid()
    ) returning id into v_id;
    insert into public.data_import_events(organization_id, job_id, event_type, actor_profile_id, details)
    values (v_org, v_id, 'created', auth.uid(), jsonb_build_object('totalRows', p_total_rows));
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- rollback_employee_import_job: a target outside the job's organization is blocked, not deleted
-- ---------------------------------------------------------------------------

create or replace function public.rollback_employee_import_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $body$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
  v_job public.data_import_jobs%rowtype;
  v_row record;
  v_reverted integer := 0;
  v_blocked integer := 0;
  v_cutoff timestamptz;
begin
  select * into v_job from public.data_import_jobs where id = p_job_id for update;
  if v_job.domain <> 'employees' then raise exception 'This rollback supports employee imports only' using errcode = '22023'; end if;
  if v_job.status <> 'applied' then raise exception 'Only an applied, unfinalized import may be rolled back' using errcode = '22023'; end if;
  if v_job.applied_at < now() - interval '24 hours' then
    raise exception 'The 24-hour rollback window has closed' using errcode = '22023';
  end if;

  perform set_config('app.allow_employee_import_rollback', 'on', true);

  for v_row in
    select r.id as import_row_id, r.target_id, r.applied_at
    from public.data_import_rows r
    where r.job_id = p_job_id and r.status = 'applied'
      and r.proposed_action = 'create' and r.target_table = 'employees'
    order by r.row_number desc
  loop
    -- The child deletes below are keyed on the employee id alone. A ledger row can only point at
    -- an employee of the job's own organization; anything else is blocked before a single child
    -- row is touched.
    if not exists (
      select 1 from public.employees e
      where e.id = v_row.target_id and e.organization_id = v_org
    ) then
      v_blocked := v_blocked + 1;
      continue;
    end if;

    begin
      v_cutoff := v_row.applied_at + interval '1 second';
      delete from public.employment_lifecycle_events
      where employee_id = v_row.target_id
        and evidence ->> 'source' = 'employee_insert'
        and created_at <= v_cutoff;
      delete from public.employment_episodes
      where employee_id = v_row.target_id
        and source = 'api'
        and created_at <= v_cutoff;
      delete from public.workforce_employee_links
      where employee_id = v_row.target_id
        and source = 'api'
        and created_at <= v_cutoff;
      delete from public.employee_compliance_profile_assignments
      where employee_id = v_row.target_id
        and source = 'api'
        and reason = 'Mandatory baseline assigned at employee creation'
        and created_at <= v_cutoff;
      delete from public.workforce_backfill_exceptions
      where employee_id = v_row.target_id
        and exception_code = 'missing_hire_date'
        and created_at <= v_cutoff;
      delete from public.employee_onboarding_items
      where employee_id = v_row.target_id
        and status = 'pending'
        and created_at <= v_cutoff;
      delete from public.employee_training_records
      where employee_id = v_row.target_id
        and status = 'missing'
        and created_at <= v_cutoff;
      delete from public.practicums
      where employee_id = v_row.target_id
        and status = 'missing'
        and created_at <= v_cutoff;
      delete from public.employee_credentials
      where employee_id = v_row.target_id
        and status = 'missing'
        and created_at <= v_cutoff;
      delete from public.employee_facility_assignments
      where employee_id = v_row.target_id
        and created_at <= v_cutoff;
      delete from public.employees e
      where e.id = v_row.target_id
        and e.organization_id = v_org
        and e.profile_id is null
        and e.created_at >= v_job.created_at
        and e.updated_at <= v_cutoff;
      if found then
        delete from public.workforce_people p
        where p.external_ref = concat('employee:', v_row.target_id::text)
          and not exists (
            select 1 from public.workforce_employee_links l
            where l.person_id = p.id
          );
        update public.data_import_rows set status = 'reverted', reverted_at = now(), updated_at = now()
        where id = v_row.import_row_id;
        v_reverted := v_reverted + 1;
      else
        v_blocked := v_blocked + 1;
      end if;
    exception
      when foreign_key_violation then
        v_blocked := v_blocked + 1;
      when sqlstate '55000' then
        v_blocked := v_blocked + 1;
    end;
  end loop;

  update public.data_import_jobs
  set status = case when v_blocked = 0 then 'rolled_back' else 'applied' end,
      reverted_rows = v_reverted,
      rolled_back_at = case when v_blocked = 0 then now() else null end,
      last_error = case when v_blocked > 0 then concat(v_blocked, ' row(s) changed or gained dependent records and were not removed.') else null end,
      updated_at = now()
  where id = p_job_id;
  insert into public.data_import_events(organization_id, job_id, event_type, actor_profile_id, details)
  values (v_org, p_job_id, 'rollback_attempted', auth.uid(), jsonb_build_object('reverted', v_reverted, 'blocked', v_blocked));

  return jsonb_build_object('jobId', p_job_id, 'reverted', v_reverted, 'blocked', v_blocked,
    'status', case when v_blocked = 0 then 'rolled_back' else 'partially_blocked' end);
end;
$body$;

-- ---------------------------------------------------------------------------
-- rollback_data_import_job: beds are removed only for a room of the job's organization
-- ---------------------------------------------------------------------------

create or replace function public.rollback_data_import_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_import_manager(p_job_id);
  v_job public.data_import_jobs%rowtype;
  v_row record;
  v_reverted integer := 0;
  v_blocked integer := 0;
  v_cutoff timestamptz;
  v_target text;
begin
  select * into v_job from public.data_import_jobs where id = p_job_id for update;
  if not found then
    raise exception 'Import job not found' using errcode = 'P0002';
  end if;

  if v_job.domain = 'employees' then
    return public.rollback_employee_import_job(p_job_id);
  end if;

  if v_job.domain not in (
    'training_records', 'credentials', 'rooms', 'residents', 'resident_contacts', 'assessments'
  ) then
    raise exception 'Rollback is not implemented for domain %', v_job.domain
      using errcode = '22023';
  end if;
  if v_job.status <> 'applied' then
    raise exception 'Only an applied, unfinalized import may be rolled back' using errcode = '22023';
  end if;
  if v_job.applied_at is not null and v_job.applied_at < now() - interval '24 hours' then
    raise exception 'The 24-hour rollback window has closed' using errcode = '22023';
  end if;

  v_target := case v_job.domain
    when 'training_records' then 'employee_training_records'
    when 'credentials' then 'employee_credentials'
    when 'rooms' then 'facility_rooms'
    when 'residents' then 'residents'
    when 'resident_contacts' then 'resident_contacts'
    when 'assessments' then 'resident_assessment_forms'
  end;

  for v_row in
    select r.id as import_row_id, r.target_id, r.applied_at, r.target_table
    from public.data_import_rows r
    where r.job_id = p_job_id
      and r.status = 'applied'
      and r.proposed_action = 'create'
      and r.target_table = v_target
    order by r.row_number desc
  loop
    begin
      v_cutoff := coalesce(v_row.applied_at, now()) + interval '1 second';
      if v_job.domain = 'training_records' then
        delete from public.employee_training_records t
        where t.id = v_row.target_id and t.organization_id = v_org
          and t.completion_method = 'csv_import'
          and t.created_at >= v_job.created_at and t.updated_at <= v_cutoff;
      elsif v_job.domain = 'credentials' then
        delete from public.employee_credentials c
        where c.id = v_row.target_id and c.organization_id = v_org
          and c.verification_method = 'csv_import'
          and c.created_at >= v_job.created_at and c.updated_at <= v_cutoff;
      elsif v_job.domain = 'rooms' then
        -- Beds go only with a room of this organization; the bare `room_id = target` form removed
        -- another tenant's beds for anyone who could name the room.
        delete from public.facility_beds b
        using public.facility_rooms r
        where b.room_id = r.id
          and r.id = v_row.target_id
          and r.organization_id = v_org;
        delete from public.facility_rooms r
        where r.id = v_row.target_id and r.organization_id = v_org
          and r.created_at >= v_job.created_at and r.updated_at <= v_cutoff;
      elsif v_job.domain = 'residents' then
        delete from public.residents r
        where r.id = v_row.target_id and r.organization_id = v_org
          and r.created_at >= v_job.created_at and r.updated_at <= v_cutoff
          and r.status = 'active';
      elsif v_job.domain = 'resident_contacts' then
        delete from public.resident_contacts c
        where c.id = v_row.target_id and c.organization_id = v_org
          and c.created_at >= v_job.created_at and c.updated_at <= v_cutoff;
      elsif v_job.domain = 'assessments' then
        -- Only roll back draft import shells that still carry the import provenance marker.
        delete from public.resident_assessment_forms f
        where f.id = v_row.target_id and f.organization_id = v_org
          and f.status = 'draft'
          and f.content ? 'csv_import'
          and f.created_at >= v_job.created_at and f.updated_at <= v_cutoff;
      end if;

      if found then
        update public.data_import_rows
        set status = 'reverted', reverted_at = now(), updated_at = now()
        where id = v_row.import_row_id;
        v_reverted := v_reverted + 1;
      else
        v_blocked := v_blocked + 1;
      end if;
    exception when foreign_key_violation then
      v_blocked := v_blocked + 1;
    end;
  end loop;

  update public.data_import_jobs
  set status = case when v_blocked = 0 then 'rolled_back' else 'applied' end,
      reverted_rows = v_reverted,
      rolled_back_at = case when v_blocked = 0 then now() else null end,
      last_error = case
        when v_blocked > 0 then concat(v_blocked, ' row(s) changed or gained dependents and were not removed.')
        else null
      end,
      updated_at = now()
  where id = p_job_id;

  insert into public.data_import_events (
    organization_id, job_id, event_type, actor_profile_id, details
  ) values (
    v_org, p_job_id, 'rollback_attempted', auth.uid(),
    jsonb_build_object('domain', v_job.domain, 'reverted', v_reverted, 'blocked', v_blocked)
  );

  return jsonb_build_object(
    'jobId', p_job_id,
    'reverted', v_reverted,
    'blocked', v_blocked,
    'status', case when v_blocked = 0 then 'rolled_back' else 'partially_blocked' end
  );
end;
$$;
