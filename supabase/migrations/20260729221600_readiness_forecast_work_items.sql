-- Route the 30-day slice of the workforce forecast into the universal work queue.
--
-- A forecast that lives only on a dashboard still depends on a manager remembering to revisit it.
-- This maintenance function turns each current or near-term source record into one deduplicated work
-- item, reopens it if the condition returns, and closes it when the forecast no longer contains the
-- risk. It joins the existing daily compliance-maintenance cron rather than creating another narrowly
-- scoped job and control-plane row.

create or replace function public.run_workforce_readiness_forecast_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facility record;
  v_forecast jsonb;
  v_risk jsonb;
  v_reason jsonb;
  v_source_type text;
  v_source_id uuid;
  v_risk_date date;
  v_due_at timestamptz;
  v_key text;
  v_work_id uuid;
  v_seen_keys text[] := array[]::text[];
  v_created integer := 0;
  v_refreshed integer := 0;
  v_closed integer := 0;
begin
  if session_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;

  for v_facility in
    select f.id, f.organization_id
    from public.facilities f
    join public.organizations o on o.id = f.organization_id
    where f.is_active
      and coalesce(o.subscription_status, '') not in ('canceled', 'expired')
    order by f.id
  loop
    v_forecast := public.get_workforce_readiness_forecast(v_facility.id);

    for v_risk in
      select value from jsonb_array_elements(coalesce(v_forecast -> 'risks', '[]'::jsonb))
    loop
      for v_reason in
        select value from jsonb_array_elements(coalesce(v_risk -> 'reasons', '[]'::jsonb))
      loop
        v_risk_date := nullif(v_reason ->> 'riskDate', '')::date;
        if not coalesce((v_reason ->> 'currentBlocker')::boolean, false)
           and (v_risk_date is null or v_risk_date > public.pa_today() + 30) then
          continue;
        end if;

        v_source_type := case v_reason ->> 'type'
          when 'credential' then 'credential'
          when 'training' then 'training_gap'
          else 'staffing'
        end;
        v_source_id := (v_reason ->> 'sourceId')::uuid;
        v_key := concat('readiness-forecast:', v_reason ->> 'type', ':', v_source_id);
        v_seen_keys := array_append(v_seen_keys, v_key);
        v_due_at := case
          when coalesce((v_reason ->> 'currentBlocker')::boolean, false) or v_risk_date is null
            then now()
          else (v_risk_date::timestamp + time '12:00') at time zone 'America/New_York'
        end;

        select w.id into v_work_id
        from public.work_items w
        where w.organization_id = v_facility.organization_id
          and w.deduplication_key = v_key
        order by w.created_at desc
        limit 1;

        if v_work_id is null then
          insert into public.work_items(
            organization_id, facility_id, source_type, source_id, deduplication_key,
            title, description, priority, due_at, state
          ) values (
            v_facility.organization_id,
            v_facility.id,
            v_source_type,
            v_source_id,
            v_key,
            concat(v_risk ->> 'employeeName', ': ', v_reason ->> 'label'),
            concat(
              'Readiness forecast: ', replace(v_reason ->> 'reason', '_', ' '),
              case when v_risk_date is null then '' else concat(' on ', v_risk_date) end,
              '. Review the source record and restore eligibility before it affects coverage.'
            ),
            case
              when coalesce((v_reason ->> 'currentBlocker')::boolean, false) then 'urgent'
              else 'high'
            end,
            v_due_at,
            'open'
          ) returning id into v_work_id;
          v_created := v_created + 1;
        else
          update public.work_items
          set facility_id = v_facility.id,
              source_type = v_source_type,
              source_id = v_source_id,
              title = concat(v_risk ->> 'employeeName', ': ', v_reason ->> 'label'),
              description = concat(
                'Readiness forecast: ', replace(v_reason ->> 'reason', '_', ' '),
                case when v_risk_date is null then '' else concat(' on ', v_risk_date) end,
                '. Review the source record and restore eligibility before it affects coverage.'
              ),
              priority = case
                when coalesce((v_reason ->> 'currentBlocker')::boolean, false) then 'urgent'
                else 'high'
              end,
              due_at = v_due_at,
              state = case when state in ('closed', 'canceled') then 'open' else state end,
              closed_at = case when state in ('closed', 'canceled') then null else closed_at end,
              closure_reason = case when state in ('closed', 'canceled') then null else closure_reason end,
              updated_at = now()
          where id = v_work_id;
          v_refreshed := v_refreshed + 1;
        end if;
      end loop;
    end loop;
  end loop;

  update public.work_items w
  set state = 'closed',
      closed_at = now(),
      closure_reason = 'The credential, training, or duty-clearance forecast condition cleared.',
      updated_at = now()
  where w.deduplication_key like 'readiness-forecast:%'
    and w.state not in ('closed', 'canceled')
    and not (w.deduplication_key = any(v_seen_keys));
  get diagnostics v_closed = row_count;

  return jsonb_build_object(
    'created', v_created,
    'refreshed', v_refreshed,
    'closed', v_closed,
    'activeKeys', cardinality(v_seen_keys),
    'completedAt', now()
  );
end;
$$;

revoke all on function public.run_workforce_readiness_forecast_maintenance() from public, anon, authenticated;
grant execute on function public.run_workforce_readiness_forecast_maintenance() to service_role;

-- Keep one registered daily compliance maintenance job. The watchdog and operator console retain the
-- existing job key while its description and cron command now cover both recurring obligations and
-- forward-looking workforce readiness.
update app_private.system_job_definitions
set description = 'Generates recurring compliance occurrences, sends/escalates requirement reminders, and routes 30-day workforce readiness risks into the universal work queue.',
    updated_at = now()
where job_key = 'compliance-requirement-maintenance-daily';

do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'compliance-requirement-maintenance-daily';

    perform cron.schedule(
      'compliance-requirement-maintenance-daily',
      '15 6 * * *',
      'select public.run_compliance_requirement_maintenance(); select public.run_workforce_readiness_forecast_maintenance();'
    );
  end if;
end $$;
