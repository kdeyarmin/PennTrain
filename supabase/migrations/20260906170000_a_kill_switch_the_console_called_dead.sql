-- A kill switch the console called dead, a Run now that could only fail, and two compliance scores
-- that disagreed by construction.
--
-- BACKLOG J78, J82 and J80.
--
-- J78. `kill_switch_can_stop_job` answers "does the switch actually stop this job" by asking
-- whether the cron entry routes through `execute_registered_sql_job` -- which is where I17 found
-- the switch being checked. That reasoning is one layer short. The switch is read inside
-- `claim_system_job_execution`, and EVERY Edge worker claims before it works; a raised claim comes
-- back as a 500 and the job does not run. So the switch stops all forty-three claiming jobs, and
-- the predicate says it stops thirty-one.
--
-- Both consequences are live. The console prints "Disable will not stop this job" on notification
-- dispatch and certificate rendering, which it does stop. And the watchdog keeps monitoring
-- anything whose switch supposedly cannot act -- so an operator who disables a critical Edge job
-- during a provider outage is paged every five minutes about the job they just turned off. That is
-- the problem I17 fixed, facing the other way.
--
-- The honest predicate is "does this job's worker claim", which is a property of the definition,
-- not something to infer from a cron command string. It becomes a column, so a future no-claim
-- worker is recorded rather than guessed at.
--
-- J82. The watchdog is the one job deliberately exempt from the switch, and it is registered
-- `retry_mode = 'automatic'`. `request_system_job_rerun` refuses only `retry_mode = 'none'`, so
-- "Run now" on the watchdog creates a queued run, the wrapper has no arm for its key, it raises
-- 22023, and a durable FAILED run is written against the one job that cannot be switched off --
-- which then makes the job look broken in the console. `retry_mode = 'none'` is the true statement
-- about it: it runs on its own cron and a manual re-run of a watchdog is not a meaningful action.
--
-- J80. The Dashboard's "Overall compliance" dedupes to the CURRENT record per employee and
-- training type; the Reports "Compliance Summary" counts every row. So a facility that renewed
-- everything scores worse than one that let its records lapse -- the renewed employee contributes
-- the old expired row AND the new compliant one. Neither excludes terminated employees. The report
-- gets the dashboard's own current-record ordering and the active-employee predicate, and states
-- its filters where the reader can see them.

-- ---------------------------------------------------------------------------
-- J78 -- the switch stops what it actually stops
-- ---------------------------------------------------------------------------

alter table app_private.system_job_definitions
  add column if not exists claims_before_running boolean not null default true;

comment on column app_private.system_job_definitions.claims_before_running is
  'Whether this job''s worker calls claim_system_job_execution before doing its work. That claim is '
  'where the kill switch is read, so it is exactly the set of jobs the switch can stop -- every '
  'SQL-cron job through execute_registered_sql_job, and every Edge worker, which claims first and '
  'returns 500 when the claim raises. False only for the watchdog, which is deliberately exempt so '
  'that disabling a job does not also blind the thing that notices jobs have stopped. Before '
  'BACKLOG J78 this was inferred from the cron command string, which saw the SQL path and missed '
  'the fourteen Edge workers.';

update app_private.system_job_definitions
set claims_before_running = false, updated_at = now()
where job_key = 'system-job-watchdog' and claims_before_running;

create or replace function app_private.kill_switch_can_stop_job(p_job_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  -- The switch is read inside claim_system_job_execution. Every job whose worker claims is
  -- therefore stoppable by it -- the SQL-cron jobs through execute_registered_sql_job, and the
  -- Edge workers, which claim first and return 500 when the claim raises. The one exemption is
  -- recorded on the definition rather than inferred from a cron command string.
  select coalesce((
    select d.claims_before_running
    from app_private.system_job_definitions d
    where d.job_key = p_job_key
  ), false);
$function$;

comment on function app_private.kill_switch_can_stop_job(text) is
  'Whether disabling this job''s kill switch actually stops it running. Reads '
  'system_job_definitions.claims_before_running, because the switch is checked inside '
  'claim_system_job_execution and every claiming worker -- SQL cron and Edge alike -- is stopped '
  'by it. The previous definition tested the cron command for execute_registered_sql_job, which is '
  'true of the SQL jobs only, so the console told operators the switch was dead on fourteen Edge '
  'jobs it does stop, and the watchdog kept paging about jobs an operator had deliberately turned '
  'off (BACKLOG J78).';

-- ---------------------------------------------------------------------------
-- J82 -- the watchdog stops offering a Run now that cannot work
-- ---------------------------------------------------------------------------

update app_private.system_job_definitions
set retry_mode = 'none', updated_at = now()
where job_key = 'system-job-watchdog' and retry_mode <> 'none';

-- ---------------------------------------------------------------------------
-- J80 -- one definition of "compliant"
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'generate_paged_compliance_report';
  if v_def is null then raise exception 'public.generate_paged_compliance_report is missing'; end if;

  if position('current_training_records' in v_def) > 0 then
    raise notice 'generate_paged_compliance_report already reads the current-record set';
  else
    v_old := $q$    select
      count(*) filter (where r.status in ('compliant', 'due_soon', 'expired', 'missing')),
      count(*) filter (where r.status = 'compliant'),
      count(*) filter (where r.status = 'expired'),
      count(*) filter (where r.status = 'due_soon')
      into v_total, v_compliant, v_expired, v_due_soon
    from public.employee_training_records r
    join public.facilities f on f.id = r.facility_id and not f.is_sandbox
    where (p_facility_id is null or r.facility_id = p_facility_id)
      and (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);$q$;
    v_new := $q$    -- BACKLOG J80. The CURRENT record per employee and training type, which is what
    -- get_org_dashboard_summary counts and what the app's selectCurrentTrainingRecords picks.
    -- Counting every row made a facility that renewed everything score WORSE than one that let
    -- its records lapse: the renewed employee contributes last cycle's expired row and this
    -- cycle's compliant one, and only one of those is an obligation. Terminated employees are
    -- excluded here too, which the dashboard's denominator already did.
    with current_training_records as (
      select distinct on (r.employee_id, r.training_type_id)
        r.id, r.facility_id, r.status, r.due_date
      from public.employee_training_records r
      join public.employees e on e.id = r.employee_id and e.status = 'active' and not e.is_synthetic
      join public.facilities f on f.id = r.facility_id and not f.is_sandbox
      where (p_facility_id is null or r.facility_id = p_facility_id)
      order by r.employee_id, r.training_type_id,
        r.due_date desc nulls last, r.completion_date desc nulls last, r.created_at desc,
        (r.status = 'missing'), r.id
    )
    select
      count(*) filter (where r.status in ('compliant', 'due_soon', 'expired', 'missing')),
      count(*) filter (where r.status = 'compliant'),
      count(*) filter (where r.status = 'expired'),
      count(*) filter (where r.status = 'due_soon')
      into v_total, v_compliant, v_expired, v_due_soon
    from current_training_records r
    where (p_date_from is null or r.due_date >= p_date_from)
      and (p_date_to is null or r.due_date <= p_date_to);$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'generate_paged_compliance_report no longer contains the summary count this migration replaces';
    end if;
    v_def := replace(v_def, v_old, v_new);

    -- The per-facility table below it counts the same way, so it moves with it.
    v_old := $q$      from public.facilities f
      left join public.employee_training_records r
        on r.facility_id = f.id
       and (p_date_from is null or r.due_date >= p_date_from)
       and (p_date_to is null or r.due_date <= p_date_to)$q$;
    v_new := $q$      from public.facilities f
      left join (
        -- Same current-record set as the summary above, for the same reason.
        select distinct on (cr.employee_id, cr.training_type_id)
          cr.id, cr.facility_id, cr.status, cr.due_date
        from public.employee_training_records cr
        join public.employees ce on ce.id = cr.employee_id and ce.status = 'active' and not ce.is_synthetic
        order by cr.employee_id, cr.training_type_id,
          cr.due_date desc nulls last, cr.completion_date desc nulls last, cr.created_at desc,
          (cr.status = 'missing'), cr.id
      ) r
        on r.facility_id = f.id
       and (p_date_from is null or r.due_date >= p_date_from)
       and (p_date_to is null or r.due_date <= p_date_to)$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'generate_paged_compliance_report no longer contains the facility join this migration replaces';
    end if;
    v_def := replace(v_def, v_old, v_new);

    execute v_def;
  end if;
end;
$do$;

comment on function public.generate_paged_compliance_report(text, uuid, uuid, date, date, integer, integer) is
  'Paged compliance reporting. The compliance summary and the per-facility table both count the '
  'CURRENT record per employee and training type, for active non-synthetic employees at '
  'non-sandbox facilities -- the same set get_org_dashboard_summary counts, so the two surfaces '
  'stop disagreeing by construction and a facility that renewed everything no longer scores worse '
  'than one that did not (BACKLOG J80).';

-- Platform tiles stop counting demo tenants.
do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_platform_health';
  if v_def is null then raise exception 'public.get_platform_health is missing'; end if;

  if position('is_demo, false)' in v_def) > 0 then
    raise notice 'get_platform_health already excludes demo organizations';
  else
    v_old := $q$        select subscription_status, count(*) as cnt
        from public.organizations
        group by subscription_status$q$;
    v_new := $q$        select subscription_status, count(*) as cnt
        from public.organizations
        -- BACKLOG J80. The seeded Sunrise demo tenant is not a customer, and counting it inflated
        -- "Trial Accounts" and every readiness counter on the platform console.
        where not coalesce(is_demo, false)
        group by subscription_status$q$;
    if position(v_old in v_def) = 0 then
      raise exception 'get_platform_health no longer counts organizations the way this migration patches';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

comment on function public.get_platform_health() is
  'Platform-admin health tiles. Organization counts exclude demo tenants, which are fixtures '
  'rather than customers -- the seeded Sunrise tenant was being counted as a trial account '
  '(BACKLOG J80).';
