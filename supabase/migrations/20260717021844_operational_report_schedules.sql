-- Make saved-report subscriptions operationally configurable and observable.
-- This is forward-only: existing 7 AM schedules are backfilled into the explicit
-- frequency/time fields and remain behaviorally unchanged.

alter table public.report_schedules
  add column frequency text,
  add column delivery_hour integer,
  add column delivery_minute integer,
  add column delivery_day_of_week integer,
  add column delivery_day_of_month integer,
  add column updated_at timestamptz not null default now();

update public.report_schedules
set frequency = case cron_expression
      when '0 7 * * 1' then 'weekly'
      when '0 7 1 * *' then 'monthly'
      else 'daily'
    end,
    delivery_hour = 7,
    delivery_minute = 0,
    delivery_day_of_week = case when cron_expression = '0 7 * * 1' then 1 end,
    delivery_day_of_month = case when cron_expression = '0 7 1 * *' then 1 end;

alter table public.report_schedules
  alter column frequency set not null,
  alter column delivery_hour set not null,
  alter column delivery_minute set not null,
  add constraint report_schedules_frequency_check
    check (frequency in ('daily', 'weekly', 'monthly')),
  add constraint report_schedules_delivery_hour_check
    check (delivery_hour between 0 and 23),
  add constraint report_schedules_delivery_minute_check
    check (delivery_minute between 0 and 59),
  add constraint report_schedules_day_configuration_check check (
    (frequency = 'daily' and delivery_day_of_week is null and delivery_day_of_month is null)
    or (frequency = 'weekly' and delivery_day_of_week between 1 and 7 and delivery_day_of_month is null)
    or (frequency = 'monthly' and delivery_day_of_month between 1 and 28 and delivery_day_of_week is null)
  );

create trigger set_updated_at
before update on public.report_schedules
for each row execute function public.set_updated_at();

create table public.report_schedule_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid not null references public.report_schedules(id) on delete cascade,
  scheduled_for timestamptz not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  status text not null check (status in ('completed', 'partial', 'failed')),
  audience_count integer not null default 0 check (audience_count >= 0),
  in_app_count integer not null default 0 check (in_app_count >= 0),
  email_queued_count integer not null default 0 check (email_queued_count >= 0),
  email_skipped_count integer not null default 0 check (email_skipped_count >= 0),
  error_message text check (error_message is null or length(error_message) <= 1000),
  created_at timestamptz not null default now(),
  unique (schedule_id, scheduled_for)
);
create index report_schedule_runs_org_created_idx
  on public.report_schedule_runs(organization_id, created_at desc);
create index report_schedule_runs_schedule_created_idx
  on public.report_schedule_runs(schedule_id, created_at desc);

alter table public.report_schedule_runs enable row level security;
create policy report_schedule_runs_select
on public.report_schedule_runs for select to authenticated using (
  (select public.is_platform_admin())
  or organization_id = (select public.current_org_id())
    and (select public.current_role()) in ('org_admin', 'facility_manager', 'auditor')
);

create trigger prevent_report_schedule_run_mutation
before update or delete on public.report_schedule_runs
for each row execute function app_private.prevent_product_value_evidence_mutation();

revoke all on table public.report_schedule_runs from public, anon, authenticated, service_role;
grant select on table public.report_schedule_runs to authenticated;
grant all on table public.report_schedule_runs to service_role;

create or replace function app_private.next_configured_report_schedule_run(
  p_frequency text,
  p_time_zone text,
  p_after timestamptz,
  p_delivery_hour integer,
  p_delivery_minute integer,
  p_day_of_week integer,
  p_day_of_month integer
) returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local_after timestamp without time zone;
  v_local_next timestamp without time zone;
  v_days_ahead integer;
begin
  if p_frequency is null
     or p_after is null
     or p_delivery_hour is null
     or p_delivery_minute is null
     or p_frequency not in ('daily', 'weekly', 'monthly')
     or p_delivery_hour not between 0 and 23
     or p_delivery_minute not between 0 and 59
     or (p_frequency = 'daily' and (p_day_of_week is not null or p_day_of_month is not null))
     or (p_frequency = 'weekly' and (p_day_of_week is null or p_day_of_week not between 1 and 7 or p_day_of_month is not null))
     or (p_frequency = 'monthly' and (p_day_of_month is null or p_day_of_month not between 1 and 28 or p_day_of_week is not null)) then
    raise exception 'Report schedule configuration is invalid' using errcode = '22023';
  end if;
  if length(coalesce(p_time_zone, '')) not between 1 and 100 then
    raise exception 'Report time zone is invalid' using errcode = '22023';
  end if;
  begin
    v_local_after := p_after at time zone p_time_zone;
  exception when invalid_parameter_value then
    raise exception 'Report time zone is invalid' using errcode = '22023';
  end;

  if p_frequency = 'daily' then
    v_local_next := date_trunc('day', v_local_after)
      + make_interval(hours => p_delivery_hour, mins => p_delivery_minute);
    if v_local_next <= v_local_after then v_local_next := v_local_next + interval '1 day'; end if;
  elsif p_frequency = 'weekly' then
    v_days_ahead := (p_day_of_week - extract(isodow from v_local_after)::integer + 7) % 7;
    v_local_next := date_trunc('day', v_local_after)
      + make_interval(days => v_days_ahead, hours => p_delivery_hour, mins => p_delivery_minute);
    if v_local_next <= v_local_after then v_local_next := v_local_next + interval '7 days'; end if;
  else
    v_local_next := date_trunc('month', v_local_after)
      + make_interval(days => p_day_of_month - 1, hours => p_delivery_hour, mins => p_delivery_minute);
    if v_local_next <= v_local_after then
      v_local_next := date_trunc('month', v_local_after) + interval '1 month'
        + make_interval(days => p_day_of_month - 1, hours => p_delivery_hour, mins => p_delivery_minute);
    end if;
  end if;

  return v_local_next at time zone p_time_zone;
end;
$$;
revoke all on function app_private.next_configured_report_schedule_run(
  text, text, timestamptz, integer, integer, integer, integer
) from public, anon, authenticated, service_role;

create or replace function public.preview_report_schedule(
  p_frequency text,
  p_time_zone text,
  p_delivery_hour integer,
  p_delivery_minute integer,
  p_day_of_week integer,
  p_day_of_month integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_next timestamptz;
  v_cron text;
begin
  perform app_private.assert_product_value_manager(null);
  v_next := app_private.next_configured_report_schedule_run(
    p_frequency, p_time_zone, now(), p_delivery_hour, p_delivery_minute,
    p_day_of_week, p_day_of_month
  );
  v_cron := case p_frequency
    when 'daily' then format('%s %s * * *', p_delivery_minute, p_delivery_hour)
    when 'weekly' then format(
      '%s %s * * %s', p_delivery_minute, p_delivery_hour,
      case when p_day_of_week = 7 then 0 else p_day_of_week end
    )
    when 'monthly' then format('%s %s %s * *', p_delivery_minute, p_delivery_hour, p_day_of_month)
  end;
  return jsonb_build_object('nextRunAt', v_next, 'cronExpression', v_cron);
end;
$$;

create or replace function public.save_report_schedule_configuration(
  p_schedule_id uuid,
  p_report_definition_id uuid,
  p_frequency text,
  p_delivery_mode text,
  p_audience jsonb,
  p_time_zone text,
  p_delivery_hour integer,
  p_delivery_minute integer,
  p_day_of_week integer,
  p_day_of_month integer
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_product_value_manager(null);
  v_definition public.saved_report_definitions%rowtype;
  v_schedule public.report_schedules%rowtype;
  v_cron text;
  v_next timestamptz;
  v_id uuid;
begin
  select * into v_definition
  from public.saved_report_definitions
  where id = p_report_definition_id and organization_id = v_org;
  if not found or v_definition.current_version_id is null then
    raise exception 'A published saved report is required' using errcode = 'P0002';
  end if;
  if p_delivery_mode is null or p_delivery_mode not in ('in_app', 'email_link') then
    raise exception 'Unsupported report delivery mode' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_audience, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_audience->'roles', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_audience->'roles', '[]'::jsonb)) not between 1 and 5 then
    raise exception 'Report audience is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_audience->'roles') role_name
    where role_name not in ('org_admin', 'facility_manager', 'trainer', 'employee', 'auditor')
  ) or (
    select count(*) from jsonb_array_elements_text(p_audience->'roles')
  ) <> (
    select count(distinct role_name) from jsonb_array_elements_text(p_audience->'roles') role_name
  ) then
    raise exception 'Report audience role is invalid' using errcode = '22023';
  end if;

  v_next := app_private.next_configured_report_schedule_run(
    p_frequency, p_time_zone, now(), p_delivery_hour, p_delivery_minute,
    p_day_of_week, p_day_of_month
  );
  v_cron := case p_frequency
    when 'daily' then format('%s %s * * *', p_delivery_minute, p_delivery_hour)
    when 'weekly' then format(
      '%s %s * * %s', p_delivery_minute, p_delivery_hour,
      case when p_day_of_week = 7 then 0 else p_day_of_week end
    )
    when 'monthly' then format('%s %s %s * *', p_delivery_minute, p_delivery_hour, p_day_of_month)
  end;

  if p_schedule_id is null then
    insert into public.report_schedules(
      organization_id, report_definition_id, report_version_id, cron_expression,
      time_zone, delivery_mode, audience, retention_days, enabled, next_run_at,
      created_by, frequency, delivery_hour, delivery_minute,
      delivery_day_of_week, delivery_day_of_month
    ) values (
      v_org, v_definition.id, v_definition.current_version_id, v_cron,
      p_time_zone, p_delivery_mode, p_audience, v_definition.retention_days,
      true, v_next, auth.uid(), p_frequency, p_delivery_hour,
      p_delivery_minute, p_day_of_week, p_day_of_month
    ) returning id into v_id;
  else
    select * into v_schedule from public.report_schedules
    where id = p_schedule_id
      and (organization_id = v_org or public.is_platform_admin())
    for update;
    if not found then raise exception 'Report schedule not found' using errcode = 'P0002'; end if;
    update public.report_schedules set
      report_definition_id = v_definition.id,
      report_version_id = v_definition.current_version_id,
      cron_expression = v_cron,
      time_zone = p_time_zone,
      delivery_mode = p_delivery_mode,
      audience = p_audience,
      retention_days = v_definition.retention_days,
      next_run_at = v_next,
      frequency = p_frequency,
      delivery_hour = p_delivery_hour,
      delivery_minute = p_delivery_minute,
      delivery_day_of_week = p_day_of_week,
      delivery_day_of_month = p_day_of_month
    where id = v_schedule.id
    returning id into v_id;
  end if;

  update public.saved_report_definitions
  set schedule_enabled = true, updated_at = now()
  where id = v_definition.id;
  return v_id;
end;
$$;

-- Preserve the original command contract for older clients while routing it
-- through the explicit configuration model.
create or replace function public.save_report_schedule(
  p_report_definition_id uuid,
  p_frequency text,
  p_delivery_mode text,
  p_audience jsonb,
  p_time_zone text default 'America/New_York'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.save_report_schedule_configuration(
    null,
    p_report_definition_id,
    p_frequency,
    p_delivery_mode,
    p_audience,
    p_time_zone,
    7,
    0,
    case when p_frequency = 'weekly' then 1 else null end,
    case when p_frequency = 'monthly' then 1 else null end
  );
end;
$$;

create or replace function public.set_report_schedule_enabled(p_schedule_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.assert_product_value_manager(null);
  v_schedule public.report_schedules%rowtype;
begin
  select * into v_schedule from public.report_schedules
  where id = p_schedule_id
    and (organization_id = v_org or public.is_platform_admin())
  for update;
  if not found then raise exception 'Report schedule not found' using errcode = 'P0002'; end if;
  update public.report_schedules set
    enabled = p_enabled,
    next_run_at = case when p_enabled then app_private.next_configured_report_schedule_run(
      v_schedule.frequency, v_schedule.time_zone, now(), v_schedule.delivery_hour,
      v_schedule.delivery_minute, v_schedule.delivery_day_of_week,
      v_schedule.delivery_day_of_month
    ) else v_schedule.next_run_at end
  where id = p_schedule_id;
  return true;
end;
$$;

create or replace function public.process_due_report_schedules()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.report_schedules%rowtype;
  v_definition public.saved_report_definitions%rowtype;
  v_recipient record;
  v_roles text[];
  v_notification_id uuid;
  v_scheduled_for timestamptz;
  v_started_at timestamptz;
  v_next timestamptz;
  v_audience_count integer;
  v_in_app_count integer;
  v_email_queued_count integer;
  v_email_skipped_count integer;
  v_org_email_enabled boolean;
  v_processed integer := 0;
begin
  for v_schedule in
    select * from public.report_schedules s
    where s.enabled and s.next_run_at is not null and s.next_run_at <= now()
    order by s.next_run_at
    for update skip locked
  loop
    v_scheduled_for := v_schedule.next_run_at;
    v_started_at := clock_timestamp();
    begin
      select * into strict v_definition
      from public.saved_report_definitions where id = v_schedule.report_definition_id;
      select coalesce(array_agg(value), array['org_admin', 'facility_manager']::text[])
        into v_roles
      from jsonb_array_elements_text(
        coalesce(v_schedule.audience->'roles', '["org_admin","facility_manager"]'::jsonb)
      ) value;
      select coalesce(email_notifications_enabled, false) into v_org_email_enabled
      from public.organization_settings where organization_id = v_schedule.organization_id;
      v_org_email_enabled := coalesce(v_org_email_enabled, false);
      v_audience_count := 0;
      v_in_app_count := 0;
      v_email_queued_count := 0;
      v_email_skipped_count := 0;

      for v_recipient in
        select p.id, p.email, p.email_opt_out
        from public.profiles p
        where p.organization_id = v_schedule.organization_id
          and p.is_active and p.role = any(v_roles)
        order by p.id
      loop
        v_audience_count := v_audience_count + 1;
        insert into public.notifications(
          organization_id, profile_id, notification_type, title, body, link
        ) values (
          v_schedule.organization_id, v_recipient.id, 'report_subscription_ready',
          left(concat('Scheduled report ready: ', v_definition.name), 300),
          'Open the saved CareBase report with your current permissions. The link contains no exported resident or employee data.',
          concat('/app/reports?saved=', v_definition.id)
        ) returning id into v_notification_id;
        v_in_app_count := v_in_app_count + 1;

        if v_schedule.delivery_mode = 'email_link' then
          if v_org_email_enabled and not v_recipient.email_opt_out and v_recipient.email is not null then
            insert into public.notification_deliveries(
              organization_id, profile_id, notification_id, channel, delivery_type, recipient
            ) values (
              v_schedule.organization_id, v_recipient.id, v_notification_id,
              'email', 'digest', v_recipient.email
            );
            v_email_queued_count := v_email_queued_count + 1;
          else
            v_email_skipped_count := v_email_skipped_count + 1;
          end if;
        end if;
      end loop;

      insert into public.report_schedule_runs(
        organization_id, schedule_id, scheduled_for, started_at, completed_at,
        status, audience_count, in_app_count, email_queued_count, email_skipped_count
      ) values (
        v_schedule.organization_id, v_schedule.id, v_scheduled_for, v_started_at,
        clock_timestamp(),
        case when v_email_skipped_count > 0 then 'partial' else 'completed' end,
        v_audience_count, v_in_app_count, v_email_queued_count, v_email_skipped_count
      );
      v_next := app_private.next_configured_report_schedule_run(
        v_schedule.frequency, v_schedule.time_zone, greatest(now(), v_scheduled_for),
        v_schedule.delivery_hour, v_schedule.delivery_minute,
        v_schedule.delivery_day_of_week, v_schedule.delivery_day_of_month
      );
      update public.report_schedules
      set last_run_at = clock_timestamp(), next_run_at = v_next
      where id = v_schedule.id;
      v_processed := v_processed + 1;
    exception when others then
      insert into public.report_schedule_runs(
        organization_id, schedule_id, scheduled_for, started_at, completed_at,
        status, error_message
      ) values (
        v_schedule.organization_id, v_schedule.id, v_scheduled_for, v_started_at,
        clock_timestamp(), 'failed', left(sqlerrm, 1000)
      ) on conflict (schedule_id, scheduled_for) do nothing;
      v_next := app_private.next_configured_report_schedule_run(
        v_schedule.frequency, v_schedule.time_zone, greatest(now(), v_scheduled_for),
        v_schedule.delivery_hour, v_schedule.delivery_minute,
        v_schedule.delivery_day_of_week, v_schedule.delivery_day_of_month
      );
      update public.report_schedules
      set last_run_at = clock_timestamp(), next_run_at = v_next
      where id = v_schedule.id;
      v_processed := v_processed + 1;
    end;
  end loop;
  return v_processed;
end;
$$;

create or replace function public.get_report_schedule_operations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if not public.is_platform_admin()
     and (v_org is null or public.current_role() not in ('org_admin', 'facility_manager', 'auditor')) then
    raise exception 'Report schedule access denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'schedules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'reportDefinitionId', s.report_definition_id,
        'name', d.name,
        'frequency', s.frequency,
        'deliveryHour', s.delivery_hour,
        'deliveryMinute', s.delivery_minute,
        'dayOfWeek', s.delivery_day_of_week,
        'dayOfMonth', s.delivery_day_of_month,
        'cronExpression', s.cron_expression,
        'timeZone', s.time_zone,
        'deliveryMode', s.delivery_mode,
        'audience', s.audience,
        'enabled', s.enabled,
        'nextRunAt', s.next_run_at,
        'lastRunAt', s.last_run_at,
        'runs', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', recent.id,
            'scheduledFor', recent.scheduled_for,
            'startedAt', recent.started_at,
            'completedAt', recent.completed_at,
            'status', recent.status,
            'audienceCount', recent.audience_count,
            'inAppCount', recent.in_app_count,
            'emailQueuedCount', recent.email_queued_count,
            'emailSkippedCount', recent.email_skipped_count,
            'errorMessage', recent.error_message
          ) order by recent.scheduled_for desc)
          from (
            select r.* from public.report_schedule_runs r
            where r.schedule_id = s.id
            order by r.scheduled_for desc limit 10
          ) recent
        ), '[]'::jsonb)
      ) order by s.created_at desc)
      from public.report_schedules s
      join public.saved_report_definitions d on d.id = s.report_definition_id
      where s.organization_id = v_org
    ), '[]'::jsonb),
    'generatedAt', now()
  );
end;
$$;

revoke all on function public.preview_report_schedule(
  text, text, integer, integer, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.save_report_schedule_configuration(
  uuid, uuid, text, text, jsonb, text, integer, integer, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.save_report_schedule(uuid, text, text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.set_report_schedule_enabled(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.process_due_report_schedules()
  from public, anon, authenticated, service_role;
revoke all on function public.get_report_schedule_operations()
  from public, anon, authenticated, service_role;

grant execute on function public.preview_report_schedule(
  text, text, integer, integer, integer, integer
) to authenticated, service_role;
grant execute on function public.save_report_schedule_configuration(
  uuid, uuid, text, text, jsonb, text, integer, integer, integer, integer
) to authenticated, service_role;
grant execute on function public.save_report_schedule(uuid, text, text, jsonb, text)
  to authenticated, service_role;
grant execute on function public.set_report_schedule_enabled(uuid, boolean)
  to authenticated, service_role;
grant execute on function public.process_due_report_schedules() to service_role;
grant execute on function public.get_report_schedule_operations()
  to authenticated, service_role;
