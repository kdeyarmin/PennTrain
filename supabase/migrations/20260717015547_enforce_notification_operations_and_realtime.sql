-- Close the operational gaps that remained after notification spend alerts and
-- system-job freshness tracking landed:
--   * a configured monthly notification budget is now a concurrency-safe hard cap;
--   * critical scheduled jobs emit deduplicated watchdog log events when their
--     last successful run exceeds the registered freshness SLA;
--   * caller-scoped in-app notifications are available through Realtime.

do $migration$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$migration$;

create or replace function public.begin_notification_delivery_attempt(
  p_delivery_id uuid,
  p_provider text,
  p_content_sha256 text
)
returns setof public.notification_delivery_attempts
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_delivery public.notification_deliveries%rowtype;
  v_profile public.profiles%rowtype;
  v_email_enabled boolean;
  v_sms_enabled boolean;
  v_push_enabled boolean;
  v_permitted_at timestamptz;
  v_attempt_id uuid;
  v_spend_policy public.notification_spend_policies%rowtype;
  v_period_start timestamptz;
  v_spend_micros bigint;
  v_attempt_estimate_micros bigint;
begin
  if p_provider not in ('twilio', 'sendgrid', 'web_push') then
    raise exception 'Unsupported notification provider' using errcode = '22023';
  end if;
  if p_content_sha256 is not null and p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid content SHA-256' using errcode = '22023';
  end if;

  select * into v_delivery from public.notification_deliveries
  where id = p_delivery_id for update;
  if v_delivery.id is null or v_delivery.status <> 'processing' then return; end if;
  if (v_delivery.channel = 'sms' and p_provider <> 'twilio')
     or (v_delivery.channel = 'email' and p_provider <> 'sendgrid')
     or (v_delivery.channel = 'web_push' and p_provider <> 'web_push') then
    raise exception 'Provider does not match delivery channel' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where id = v_delivery.profile_id;
  select email_notifications_enabled, sms_notifications_enabled,
         web_push_notifications_enabled
    into v_email_enabled, v_sms_enabled, v_push_enabled
  from public.organization_settings where organization_id = v_delivery.organization_id;

  if v_profile.id is null or not v_profile.is_active then
    update public.notification_deliveries
    set status = 'skipped', skip_reason = 'Recipient profile is inactive or unavailable',
        finalized_at = now()
    where id = p_delivery_id;
    return;
  end if;
  if v_delivery.channel = 'sms' and (
    not coalesce(v_sms_enabled, false) or not v_profile.sms_opt_in
    or v_profile.sms_consent_at is null or v_profile.phone is distinct from v_delivery.recipient
  ) then
    update public.notification_deliveries
    set status = 'skipped', skip_reason = 'SMS consent or channel preference is not active',
        finalized_at = now()
    where id = p_delivery_id;
    return;
  end if;
  if v_delivery.channel = 'email' and (
    not coalesce(v_email_enabled, false) or v_profile.email_opt_out
    or v_profile.email is distinct from v_delivery.recipient
  ) then
    update public.notification_deliveries
    set status = 'skipped', skip_reason = 'Email channel preference is not active',
        finalized_at = now()
    where id = p_delivery_id;
    return;
  end if;
  if v_delivery.channel = 'web_push' and (
    not coalesce(v_push_enabled, false)
    or not exists (
      select 1 from public.push_subscriptions s
      where s.id = v_delivery.recipient::uuid
        and s.profile_id = v_delivery.profile_id
        and s.organization_id = v_delivery.organization_id
        and s.disabled_at is null
        and (s.expiration_time is null or s.expiration_time > now())
    )
  ) then
    update public.notification_deliveries
    set status = 'skipped', skip_reason = 'Web push subscription is not active',
        finalized_at = now()
    where id = p_delivery_id;
    return;
  end if;

  if v_delivery.channel = 'sms' then
    v_permitted_at := public.notification_next_permitted_at(now(), v_profile.notification_timezone);
    if v_permitted_at > now() + interval '1 second' then
      update public.notification_deliveries
      set status = 'pending', next_attempt_at = v_permitted_at,
          quiet_hours_deferred_count = quiet_hours_deferred_count + 1
      where id = p_delivery_id;
      return;
    end if;
  end if;
  if v_delivery.attempt_count >= 5 then
    update public.notification_deliveries
    set status = 'failed', final_outcome = 'failed', finalized_at = now(),
        error_code = 'retry_budget_exhausted',
        error_message = 'Notification provider retry budget exhausted'
    where id = p_delivery_id;
    return;
  end if;

  -- Serialize spend decisions per organization. The advisory lock is held until
  -- this transaction commits, so two dispatch workers cannot both spend the
  -- final remaining budget based on the same stale aggregate.
  select * into v_spend_policy
  from public.notification_spend_policies
  where organization_id = v_delivery.organization_id;
  if v_spend_policy.monthly_budget_micros is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'notification-spend-cap:' || v_delivery.organization_id::text,
      0
    ));
    v_period_start := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
    select coalesce(sum(a.estimated_cost_micros), 0)::bigint
      into v_spend_micros
    from public.notification_delivery_attempts a
    where a.organization_id = v_delivery.organization_id
      and a.started_at >= v_period_start
      and a.started_at < v_period_start + interval '1 month';
    v_attempt_estimate_micros := case v_delivery.channel
      when 'sms' then v_spend_policy.sms_estimate_micros
      when 'email' then v_spend_policy.email_estimate_micros
      else 0
    end;

    if v_attempt_estimate_micros > 0
       and v_spend_micros + v_attempt_estimate_micros
         > v_spend_policy.monthly_budget_micros then
      update public.notification_deliveries
      set status = 'skipped',
          skip_reason = 'Monthly notification spend cap reached',
          error_code = 'spend_cap_reached',
          error_message = 'Provider call blocked before dispatch because the monthly notification budget was exhausted',
          finalized_at = now()
      where id = p_delivery_id;

      insert into public.notification_spend_alerts (
        organization_id, period_start, threshold_percent,
        estimated_spend_micros, budget_micros
      ) values (
        v_delivery.organization_id, v_period_start::date, 100,
        v_spend_micros + v_attempt_estimate_micros,
        v_spend_policy.monthly_budget_micros
      ) on conflict (organization_id, period_start, threshold_percent) do update
        set estimated_spend_micros = greatest(
          public.notification_spend_alerts.estimated_spend_micros,
          excluded.estimated_spend_micros
        ),
        status = 'open',
        acknowledged_at = null,
        acknowledged_by = null;
      return;
    end if;
  end if;

  insert into public.notification_delivery_attempts (
    delivery_id, organization_id, profile_id, attempt_number, provider, content_sha256
  ) values (
    v_delivery.id, v_delivery.organization_id, v_delivery.profile_id,
    v_delivery.attempt_count + 1, p_provider, p_content_sha256
  ) returning id into v_attempt_id;

  update public.notification_deliveries
  set provider = p_provider, attempt_count = attempt_count + 1,
      error_code = null, error_message = null, skip_reason = null
  where id = p_delivery_id;
  return query select * from public.notification_delivery_attempts where id = v_attempt_id;
end;
$function$;
revoke all on function public.begin_notification_delivery_attempt(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_notification_delivery_attempt(uuid, text, text)
  to service_role;

create table app_private.system_job_watchdog_state (
  job_key text primary key
    references app_private.system_job_definitions(job_key) on delete cascade,
  stale_since timestamptz not null,
  last_success_at timestamptz,
  last_observed_at timestamptz not null,
  last_emitted_at timestamptz not null,
  recovered_at timestamptz
);
alter table app_private.system_job_watchdog_state enable row level security;
revoke all on table app_private.system_job_watchdog_state
  from public, anon, authenticated;
grant select, insert, update, delete on table app_private.system_job_watchdog_state
  to service_role;

create or replace function public.run_system_job_watchdog()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job record;
  v_state app_private.system_job_watchdog_state%rowtype;
  v_stale_keys text[] := '{}'::text[];
  v_emitted integer := 0;
  v_now timestamptz := now();
begin
  for v_job in
    with resolved as (
      select d.job_key, d.display_name, d.freshness_sla,
        greatest(own_success.started_at, cron_success.start_time) as last_success_at
      from app_private.system_job_definitions d
      left join cron.job c on c.jobname = d.cron_job_name
      left join lateral (
        select r.started_at
        from app_private.system_job_runs r
        where r.job_key = d.job_key and r.status = 'succeeded'
        order by r.started_at desc limit 1
      ) own_success on true
      left join lateral (
        select cr.start_time
        from cron.job_run_details cr
        where cr.jobid = c.jobid and cr.status = 'succeeded'
        order by cr.runid desc limit 1
      ) cron_success on true
      where d.is_active and d.is_critical and d.cron_job_name is not null
        and not d.kill_switch_enabled
    )
    select * from resolved
    where last_success_at is null or last_success_at + freshness_sla < v_now
  loop
    v_stale_keys := array_append(v_stale_keys, v_job.job_key);
    select * into v_state
    from app_private.system_job_watchdog_state
    where job_key = v_job.job_key for update;

    if v_state.job_key is null then
      insert into app_private.system_job_watchdog_state (
        job_key, stale_since, last_success_at, last_observed_at, last_emitted_at
      ) values (
        v_job.job_key, v_now, v_job.last_success_at, v_now, v_now
      );
      raise warning 'system_job_watchdog stale job=% display_name=% last_success_at=%',
        v_job.job_key, v_job.display_name, v_job.last_success_at;
      v_emitted := v_emitted + 1;
    elsif v_state.recovered_at is not null or v_state.last_emitted_at < v_now - interval '1 hour' then
      update app_private.system_job_watchdog_state
      set stale_since = case when recovered_at is null then stale_since else v_now end,
          last_success_at = v_job.last_success_at,
          last_observed_at = v_now,
          last_emitted_at = v_now,
          recovered_at = null
      where job_key = v_job.job_key;
      raise warning 'system_job_watchdog stale job=% display_name=% last_success_at=%',
        v_job.job_key, v_job.display_name, v_job.last_success_at;
      v_emitted := v_emitted + 1;
    else
      update app_private.system_job_watchdog_state
      set last_success_at = v_job.last_success_at, last_observed_at = v_now
      where job_key = v_job.job_key;
    end if;
  end loop;

  for v_state in
    select * from app_private.system_job_watchdog_state s
    where s.recovered_at is null
      and not (s.job_key = any(v_stale_keys))
  loop
    update app_private.system_job_watchdog_state
    set recovered_at = v_now, last_observed_at = v_now
    where job_key = v_state.job_key;
    raise log 'system_job_watchdog recovered job=%', v_state.job_key;
  end loop;
  return v_emitted;
end;
$function$;
revoke all on function public.run_system_job_watchdog()
  from public, anon, authenticated;
grant execute on function public.run_system_job_watchdog() to service_role;

select cron.unschedule('system-job-last-success-watchdog')
where exists (select 1 from cron.job where jobname = 'system-job-last-success-watchdog');
select cron.schedule(
  'system-job-last-success-watchdog',
  '*/5 * * * *',
  $$select public.run_system_job_watchdog();$$
);
