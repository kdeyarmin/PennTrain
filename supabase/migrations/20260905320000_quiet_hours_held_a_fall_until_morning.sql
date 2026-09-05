-- Quiet hours held a fall until eight in the morning (I23).
--
-- prepare_notification_delivery carries the comment "These are non-emergency compliance/training
-- messages. SMS is deferred to the next 08:00-21:00 window" -- and then deferred EVERY SMS, with no
-- test of what the message was. A resident falls at 2 AM, the manager's phone stays silent until
-- 08:00, and the reportable-incident notification clock in 55 Pa. Code has been running for six
-- hours by the time anyone reads it. The comment described a rule nobody had written.
--
-- Quiet hours is right for what it was built for: a training-due reminder at 3 AM is how a facility
-- ends up turning SMS off entirely, and then hearing nothing. So this is a narrow exemption rather
-- than a weakening:
--
--   * `incident_reported` -- the notification a state deadline runs from.
--   * `shift_handoff_escalated` -- a handoff nobody acknowledged, escalated. Waiting is the
--     failure it exists to report.
--   * anything whose delivery_type is 'escalation' -- the generic form of the same statement: a
--     first attempt was not acted on, so deferring the second defeats the purpose.
--
-- Everything else stays deferred, including the overdue ones: plan_of_correction_overdue and
-- compliance_requirement_overdue are measured in days, and a day does not turn at 3 AM.
--
-- Deferring is the default when the message cannot be identified (no notification_id): an unknown
-- SMS at 3 AM to every recipient in a facility is the failure mode that gets the channel switched
-- off, and every urgent sender here does set one.

create or replace function public.notification_bypasses_quiet_hours(
  p_notification_id uuid,
  p_delivery_type text
)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select coalesce(p_delivery_type = 'escalation', false)
    or coalesce((
      select n.notification_type in ('incident_reported', 'shift_handoff_escalated')
      from public.notifications n
      where n.id = p_notification_id
    ), false);
$function$;

comment on function public.notification_bypasses_quiet_hours(uuid, text) is
  'True for the few messages that must reach a phone at any hour: a reported incident, an escalated '
  'shift handoff, and any escalation delivery. One definition for all three places quiet hours is '
  'applied, which is what stopped them agreeing before.';

revoke all on function public.notification_bypasses_quiet_hours(uuid, text) from public, anon;
grant execute on function public.notification_bypasses_quiet_hours(uuid, text)
  to authenticated, service_role;

------------------------------------------------------------------------------------------------
-- All three places quiet hours is applied
------------------------------------------------------------------------------------------------
-- Bodies extracted from the live catalog with pg_get_functiondef and patched at the condition.

CREATE OR REPLACE FUNCTION public.prepare_notification_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_profile public.profiles%rowtype;
  v_permitted_at timestamptz;
begin
  select * into v_profile from public.profiles where id = new.profile_id;

  if v_profile.id is null or not v_profile.is_active then
    new.status := 'skipped';
    new.skip_reason := 'Recipient profile is inactive or unavailable';
    new.finalized_at := now();
    return new;
  end if;

  if new.channel = 'sms' and (
    not v_profile.sms_opt_in
    or v_profile.sms_consent_at is null
    or v_profile.phone is distinct from new.recipient
  ) then
    new.status := 'skipped';
    new.skip_reason := 'SMS consent is not active for this recipient';
    new.finalized_at := now();
    return new;
  end if;

  if new.channel = 'email' and (
    v_profile.email_opt_out
    or v_profile.email is distinct from new.recipient
  ) then
    new.status := 'skipped';
    new.skip_reason := 'Email preference is not active for this recipient';
    new.finalized_at := now();
    return new;
  end if;

  -- Non-emergency compliance and training messages are deferred to the next 08:00-21:00 window in
  -- the recipient's IANA time zone. The comment used to say that and the code did not check it: it
  -- deferred every SMS, including the one telling a manager a resident had a fall. See
  -- public.notification_bypasses_quiet_hours.
  if new.channel = 'sms' and new.status = 'pending'
     and not public.notification_bypasses_quiet_hours(new.notification_id, new.delivery_type) then
    v_permitted_at := public.notification_next_permitted_at(
      greatest(coalesce(new.next_attempt_at, now()), now()),
      v_profile.notification_timezone
    );
    if v_permitted_at > coalesce(new.next_attempt_at, now()) then
      new.quiet_hours_deferred_count := coalesce(new.quiet_hours_deferred_count, 0) + 1;
    end if;
    new.next_attempt_at := v_permitted_at;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.retry_notification_delivery(p_delivery_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform_admin may retry notification deliveries' using errcode = '42501';
  end if;

  update public.notification_deliveries d
  set status = 'pending', provider = null, provider_message_id = null,
      error_message = null, error_code = null, skip_reason = null,
      sent_at = null, accepted_at = null, delivered_at = null,
      finalized_at = null, final_outcome = null,
      next_attempt_at = case
        when d.channel = 'sms'
          and not public.notification_bypasses_quiet_hours(d.notification_id, d.delivery_type)
          then public.notification_next_permitted_at(
            now(), (select p.notification_timezone from public.profiles p where p.id = d.profile_id)
          )
        else now()
      end
  where id = p_delivery_id
    and status = 'failed'
    and final_outcome = 'failed'
    and attempt_count < 5;

  if not found then
    raise exception 'Delivery % is not a safely retryable failure or its retry budget is exhausted', p_delivery_id
      using errcode = 'P0002';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.begin_notification_delivery_attempt(p_delivery_id uuid, p_provider text, p_content_sha256 text)
 RETURNS SETOF notification_delivery_attempts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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

  -- The third place quiet hours is applied, and the one that would otherwise re-defer an urgent
  -- message the trigger had already let through.
  if v_delivery.channel = 'sms'
     and not public.notification_bypasses_quiet_hours(v_delivery.notification_id, v_delivery.delivery_type) then
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
