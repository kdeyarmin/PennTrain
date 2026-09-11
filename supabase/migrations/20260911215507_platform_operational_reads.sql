-- Share the existing job-health query with native and delegated administrator reads.
-- Only authorization moves to each caller; the execution-kind freshness rules stay exact.
CREATE OR REPLACE FUNCTION app_private.system_job_control_plane_rows()
 RETURNS TABLE(job_key text, display_name text, description text, schedule text, execution_kind text, is_critical boolean, retry_mode text, operator_route text, last_status text, last_attempt_at timestamp with time zone, last_success_at timestamp with time zone, next_expected_at timestamp with time zone, last_duration_ms bigint, attempted_count bigint, succeeded_count bigint, failed_count bigint, error_message text, is_stale boolean, kill_switch_enabled boolean, kill_switch_can_stop boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin

  return query
  with job_state as (
    select
      d.*,
      c.schedule,
      own.status as own_status,
      own.started_at as own_started_at,
      own.finished_at as own_finished_at,
      own.attempted_count as own_attempted_count,
      own.succeeded_count as own_succeeded_count,
      own.failed_count as own_failed_count,
      own.error_message as own_error_message,
      own_success.started_at as own_success_at,
      cron_run.status as cron_status,
      cron_run.start_time as cron_started_at,
      cron_run.end_time as cron_finished_at,
      cron_run.return_message as cron_error_message,
      cron_success.start_time as cron_success_at
    from app_private.system_job_definitions as d
    left join cron.job as c
      on c.jobname = d.cron_job_name
    left join lateral (
      select r.*
      from app_private.system_job_runs as r
      where r.job_key = d.job_key
      order by r.started_at desc
      limit 1
    ) as own on true
    left join lateral (
      select r.started_at
      from app_private.system_job_runs as r
      where r.job_key = d.job_key
        and r.status = 'succeeded'
      order by r.started_at desc
      limit 1
    ) as own_success on true
    left join lateral (
      select cr.status, cr.start_time, cr.end_time, cr.return_message
      from cron.job_run_details as cr
      where cr.jobid = c.jobid
      order by cr.runid desc
      limit 1
    ) as cron_run on true
    left join lateral (
      select cr.start_time
      from cron.job_run_details as cr
      where cr.jobid = c.jobid
        and cr.status = 'succeeded'
      order by cr.runid desc
      limit 1
    ) as cron_success on true
    where d.is_active
  ),
  resolved as (
    select
      s.*,
      -- Every one of these is narrowed by execution_kind for the same reason resolved_success_at
      -- is, below. Picking "whichever side started later" is right only when the cron row IS the
      -- work. For edge_cron and worker definitions the cron row records that a net.http_post was
      -- enqueued: an Edge Function that answers 503 before claiming a run leaves a cron row that
      -- is both NEWER than the last real run and marked 'succeeded'. Reading status off that row
      -- puts "succeeded", a cron duration and no error on /admin/system-jobs for an invocation
      -- that never executed -- while resolved_success_at, correctly, calls the job stale. A
      -- surface that contradicts itself in adjacent columns is worse than one that is simply
      -- wrong, because the reader cannot tell which half to believe.
      case
        when s.execution_kind <> 'sql_cron' then s.own_status
        when coalesce(s.own_started_at, '-infinity'::timestamptz)
           >= coalesce(s.cron_started_at, '-infinity'::timestamptz)
          then s.own_status
        else s.cron_status
      end as resolved_status,
      case
        when s.execution_kind <> 'sql_cron' then s.own_started_at
        else greatest(s.own_started_at, s.cron_started_at)
      end as resolved_started_at,
      case
        when s.execution_kind <> 'sql_cron' then s.own_finished_at
        when coalesce(s.own_started_at, '-infinity'::timestamptz)
           >= coalesce(s.cron_started_at, '-infinity'::timestamptz)
          then s.own_finished_at
        else s.cron_finished_at
      end as resolved_finished_at,
      -- Narrowed by execution_kind, exactly as run_system_job_watchdog is (20260814010000).
      -- For edge_cron and worker definitions the cron row proves delivery at most: an Edge
      -- Function that answers 503 on every invocation still leaves a trail of 'succeeded' cron
      -- rows, and `greatest` ignores NULLs, so before this change a definition that had never
      -- recorded a run of its own read as fresh off pg_cron alone. That is the billing-sync
      -- failure mode (20260814010000) surviving on the human-facing reader after the pager was
      -- fixed -- and 20260904050000 made it reachable for four more jobs by moving their cron
      -- names onto the rows that record completion.
      case
        when s.execution_kind <> 'sql_cron' then s.own_success_at
        else greatest(s.own_success_at, s.cron_success_at)
      end as resolved_success_at,
      case
        when s.execution_kind <> 'sql_cron' then s.own_error_message
        when coalesce(s.own_started_at, '-infinity'::timestamptz)
           >= coalesce(s.cron_started_at, '-infinity'::timestamptz)
          then s.own_error_message
        when s.cron_status <> 'succeeded' then s.cron_error_message
        else null
      end as resolved_error_message
    from job_state as s
  )
  select
    r.job_key,
    r.display_name,
    r.description,
    r.schedule,
    r.execution_kind,
    r.is_critical,
    r.retry_mode,
    r.operator_route,
    coalesce(r.resolved_status, 'never') as last_status,
    r.resolved_started_at as last_attempt_at,
    r.resolved_success_at as last_success_at,
    case
      when r.cron_job_name is not null
        then r.resolved_success_at + r.expected_interval
      else null
    end as next_expected_at,
    case
      when r.resolved_started_at is not null and r.resolved_finished_at is not null
        then (extract(epoch from (r.resolved_finished_at - r.resolved_started_at)) * 1000)::bigint
      else null
    end as last_duration_ms,
    -- Same narrowing as resolved_status: for a non-sql_cron kind the ledger is the only source
    -- of counts, so a newer cron row must not blank them. Leaving these on the "newer side" rule
    -- while status reads the ledger would print a failed run with empty counts.
    case
      when r.execution_kind <> 'sql_cron' then r.own_attempted_count
      when coalesce(r.own_started_at, '-infinity'::timestamptz)
         >= coalesce(r.cron_started_at, '-infinity'::timestamptz)
        then r.own_attempted_count
      else null
    end as attempted_count,
    case
      when r.execution_kind <> 'sql_cron' then r.own_succeeded_count
      when coalesce(r.own_started_at, '-infinity'::timestamptz)
         >= coalesce(r.cron_started_at, '-infinity'::timestamptz)
        then r.own_succeeded_count
      else null
    end as succeeded_count,
    case
      when r.execution_kind <> 'sql_cron' then r.own_failed_count
      when coalesce(r.own_started_at, '-infinity'::timestamptz)
         >= coalesce(r.cron_started_at, '-infinity'::timestamptz)
        then r.own_failed_count
      else null
    end as failed_count,
    r.resolved_error_message as error_message,
    case
      when r.cron_job_name is null then
        r.resolved_status in ('queued', 'running')
        and r.resolved_started_at + r.freshness_sla < now()
      else
        r.resolved_success_at is null
        or r.resolved_success_at + r.freshness_sla < now()
    end as is_stale,
    r.kill_switch_enabled,
    -- Whether flipping that switch would actually stop the job. It is read in exactly one place,
    -- claim_system_job_execution, which SQL reaches only through execute_registered_sql_job -- so
    -- for a definition whose cron entry posts to an Edge Function the control is decorative.
    -- 20260905150000 stopped a dead switch from silencing the watchdog; this is the other half,
    -- which is telling the operator BEFORE they flip it. BACKLOG.md I17.
    app_private.kill_switch_can_stop_job(r.job_key) as kill_switch_can_stop
  from resolved as r
  order by
    case
      when r.cron_job_name is null then
        r.resolved_status in ('queued', 'running')
        and r.resolved_started_at + r.freshness_sla < now()
      else
        r.resolved_success_at is null
        or r.resolved_success_at + r.freshness_sla < now()
    end desc,
    r.is_critical desc,
    r.display_name;
end;
$function$;
revoke all on function app_private.system_job_control_plane_rows() from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_system_job_control_plane()
 RETURNS TABLE(job_key text, display_name text, description text, schedule text, execution_kind text, is_critical boolean, retry_mode text, operator_route text, last_status text, last_attempt_at timestamp with time zone, last_success_at timestamp with time zone, next_expected_at timestamp with time zone, last_duration_ms bigint, attempted_count bigint, succeeded_count bigint, failed_count bigint, error_message text, is_stale boolean, kill_switch_enabled boolean, kill_switch_can_stop boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may inspect system jobs'
      using errcode = '42501';
  end if;

  return query select * from app_private.system_job_control_plane_rows();
end;
$function$;
revoke all on function public.get_system_job_control_plane() from public,anon;
grant execute on function public.get_system_job_control_plane() to authenticated,service_role;

create function public.platform_admin_read_operations(
  p_actor uuid,p_hub_user uuid,p_hub_session uuid,p_session_started_at timestamptz,p_assurance_expires_at timestamptz,p_authentication_method text,
  p_operation text,p_limit integer,p_offset integer,p_search text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb;
begin
  perform app_private.assert_platform_admin_delegate(p_actor,p_hub_user,p_hub_session,p_session_started_at,p_assurance_expires_at,p_authentication_method);
  if p_operation is null or p_operation not in ('operations.jobs.list','operations.releases.list','operations.audit.list')
    or p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 10000
    or p_search is null or length(p_search)>100 or p_search ~ '[[:cntrl:]]' then
    raise exception 'Invalid operational read' using errcode='22023'; end if;
  if p_operation='operations.jobs.list' then
    with records as materialized (
      select r.job_key as key,r.display_name as name,jsonb_build_object(
        'jobKey',r.job_key,'displayName',r.display_name,'description',r.description,'schedule',r.schedule,
        'executionKind',r.execution_kind,'isCritical',r.is_critical,'retryMode',r.retry_mode,'lastStatus',r.last_status,
        'lastAttemptAt',r.last_attempt_at,'lastSuccessAt',r.last_success_at,'nextExpectedAt',r.next_expected_at,
        'lastDurationMs',r.last_duration_ms::text,'attemptedCount',r.attempted_count::text,'succeededCount',r.succeeded_count::text,
        'failedCount',r.failed_count::text,'hasError',r.error_message is not null,'isStale',r.is_stale,
        'killSwitchEnabled',r.kill_switch_enabled,'killSwitchCanStop',r.kill_switch_can_stop) as value
      from app_private.system_job_control_plane_rows() r where position(lower(p_search) in lower(r.job_key||' '||r.display_name))>0
    ), page as (select * from records order by name,key limit p_limit offset p_offset)
    select jsonb_build_object('items',coalesce((select jsonb_agg(value order by name,key) from page),'[]'::jsonb),
      'total',(select count(*) from records),'limit',p_limit,'offset',p_offset) into payload;
  elsif p_operation='operations.releases.list' then
    with records as materialized (
      select d.feature_key as key,jsonb_build_object('featureKey',d.feature_key,'displayName',d.display_name,'description',d.description,
        'isActive',d.is_active,'rolloutMode',coalesce(f.rollout_mode,'unconfigured'),'isEnabled',f.is_enabled,'owner',f.owner,
        'expiresAt',f.expires_at,'updatedAt',f.updated_at,
        'globalKillSwitch',exists(select 1 from public.feature_kill_switches k where k.feature_key=d.feature_key and k.organization_id is null
          and k.is_disabled and (k.expires_at is null or k.expires_at>now())),
        'organizationKillSwitchCount',(select count(*)::text from public.feature_kill_switches k where k.feature_key=d.feature_key and k.organization_id is not null
          and k.is_disabled and (k.expires_at is null or k.expires_at>now()))) as value
      from public.feature_definitions d left join public.release_flags f on f.feature_key=d.feature_key
      where position(lower(p_search) in lower(d.feature_key||' '||d.display_name))>0
    ),page as (select * from records order by key limit p_limit offset p_offset)
    select jsonb_build_object('items',coalesce((select jsonb_agg(value order by key) from page),'[]'::jsonb),
      'total',(select count(*) from records),'limit',p_limit,'offset',p_offset) into payload;
  else
    with records as not materialized (
      select a.id,a.created_at,jsonb_build_object('id',a.id,'action',a.action,'entityType',a.entity_type,'entityId',a.entity_id,
        'organizationId',a.organization_id,'actorProfileId',a.actor_profile_id,'actorSubjectId',a.actor_subject_id,'createdAt',a.created_at) as value
      from public.audit_logs a where position(lower(p_search) in lower(a.action||' '||a.entity_type))>0
    ),page as (select * from records order by created_at desc,id desc limit p_limit offset p_offset)
    select jsonb_build_object('items',coalesce((select jsonb_agg(value order by created_at desc,id desc) from page),'[]'::jsonb),
      'total',(select count(*) from records),'limit',p_limit,'offset',p_offset) into payload;
  end if;
  return payload;
end; $$;
revoke all on function public.platform_admin_read_operations(uuid,uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.platform_admin_read_operations(uuid,uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text) to service_role;
