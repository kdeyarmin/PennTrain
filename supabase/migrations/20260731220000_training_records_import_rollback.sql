-- Training-records import rollback (mirrors employee import safety window).
-- Domain was already allowed on data_import_jobs; this makes applied creates reversible.

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
begin
  select * into v_job from public.data_import_jobs where id = p_job_id for update;
  if not found then
    raise exception 'Import job not found' using errcode = 'P0002';
  end if;

  if v_job.domain = 'employees' then
    return public.rollback_employee_import_job(p_job_id);
  end if;

  if v_job.domain <> 'training_records' then
    raise exception 'Rollback is only implemented for employees and training_records domains'
      using errcode = '22023';
  end if;
  if v_job.status <> 'applied' then
    raise exception 'Only an applied, unfinalized import may be rolled back' using errcode = '22023';
  end if;
  if v_job.applied_at is not null and v_job.applied_at < now() - interval '24 hours' then
    raise exception 'The 24-hour rollback window has closed' using errcode = '22023';
  end if;

  for v_row in
    select r.id as import_row_id, r.target_id, r.applied_at
    from public.data_import_rows r
    where r.job_id = p_job_id
      and r.status = 'applied'
      and r.proposed_action = 'create'
      and r.target_table = 'employee_training_records'
    order by r.row_number desc
  loop
    begin
      v_cutoff := coalesce(v_row.applied_at, now()) + interval '1 second';
      delete from public.employee_training_records t
      where t.id = v_row.target_id
        and t.organization_id = v_org
        and t.completion_method = 'csv_import'
        and t.created_at >= v_job.created_at
        and t.updated_at <= v_cutoff;
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
        when v_blocked > 0 then concat(v_blocked, ' training row(s) changed or gained dependents and were not removed.')
        else null
      end,
      updated_at = now()
  where id = p_job_id;

  insert into public.data_import_events (
    organization_id, job_id, event_type, actor_profile_id, details
  ) values (
    v_org, p_job_id, 'rollback_attempted', auth.uid(),
    jsonb_build_object('domain', 'training_records', 'reverted', v_reverted, 'blocked', v_blocked)
  );

  return jsonb_build_object(
    'jobId', p_job_id,
    'reverted', v_reverted,
    'blocked', v_blocked,
    'status', case when v_blocked = 0 then 'rolled_back' else 'partially_blocked' end
  );
end;
$$;

revoke all on function public.rollback_data_import_job(uuid) from public, anon;
grant execute on function public.rollback_data_import_job(uuid) to authenticated, service_role;
