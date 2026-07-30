-- Employee-import rollback must be able to reverse the bootstrap employment
-- episode created by shadow_new_employee_lifecycle. 20260730010000 already
-- enables a transaction-local GUC for employment_lifecycle_events; this extends
-- the same narrow bypass to employment_episodes so the controlled rollback path
-- can complete when the episode source is the API bootstrap ('api').

begin;

do $do$
begin
  if to_regprocedure('app_private.protect_employment_episode_mutation()') is null
    or to_regclass('public.employment_episodes') is null then
    return;
  end if;

  execute $fn$
create or replace function app_private.protect_employment_episode_mutation()
returns trigger
language plpgsql
set search_path = ''
as $body$
begin
  if tg_op = 'DELETE' then
    if current_setting('app.allow_employee_import_rollback', true) = 'on'
       and coalesce(old.source, '') = 'api' then
      return old;
    end if;
    raise exception 'employment episodes are retained evidence and cannot be deleted'
      using errcode = '55000';
  end if;

  if coalesce(current_setting('app.lifecycle_transition', true), '') <> 'on' then
    raise exception 'employment episodes may only be closed by the lifecycle transition RPC'
      using errcode = '42501';
  end if;
  return new;
end;
$body$;
$fn$;

  execute 'revoke all on function app_private.protect_employment_episode_mutation() from public, anon, authenticated, service_role';
end;
$do$;

-- Treat append-only guard failures as a blocked row instead of aborting the whole
-- rollback command. The GUC bypass above covers the intended path; other 55000
-- cases remain blocked and surface as a partial rollback.
do $do$
begin
  if to_regprocedure('public.rollback_employee_import_job(uuid)') is null
    or to_regclass('public.data_import_jobs') is null then
    return;
  end if;

  execute $fn$
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
$fn$;

  execute 'revoke all on function public.rollback_employee_import_job(uuid) from public, anon';
  execute 'grant execute on function public.rollback_employee_import_job(uuid) to authenticated, service_role';
end;
$do$;

commit;
