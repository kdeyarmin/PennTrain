-- A1-C3 platform intelligence, notification, regulatory, analytics, and
-- lifecycle program. High-risk actions remain dark or draft-only until an
-- administrator explicitly enables/approves them.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- A1. Web push as a fourth notification channel
-- ---------------------------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://'),
  endpoint_hash text not null unique check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  p256dh_key text not null check (length(p256dh_key) between 40 and 255),
  auth_key text not null check (length(auth_key) between 8 and 255),
  expiration_time timestamptz,
  user_agent_hash text check (user_agent_hash is null or user_agent_hash ~ '^[0-9a-f]{64}$'),
  last_used_at timestamptz,
  disabled_at timestamptz,
  disabled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((disabled_at is null) = (disabled_reason is null))
);

create index push_subscriptions_profile_active_idx
  on public.push_subscriptions(profile_id, updated_at desc)
  where disabled_at is null;
create index push_subscriptions_org_active_idx
  on public.push_subscriptions(organization_id, updated_at desc)
  where disabled_at is null;
create trigger set_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

alter table public.organization_settings
  add column web_push_notifications_enabled boolean not null default true;

alter table public.profiles
  drop constraint profiles_preferred_notification_channel_check;
alter table public.profiles
  add constraint profiles_preferred_notification_channel_check
  check (preferred_notification_channel in ('email', 'sms', 'web_push'));

alter table public.notification_deliveries
  drop constraint notification_deliveries_channel_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_channel_check
  check (channel in ('email', 'sms', 'web_push'));

alter table public.notification_deliveries
  drop constraint notification_deliveries_provider_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_provider_check
  check (provider is null or provider in ('twilio', 'sendgrid', 'web_push'));

alter table public.notification_delivery_attempts
  drop constraint notification_delivery_attempts_provider_check;
alter table public.notification_delivery_attempts
  add constraint notification_delivery_attempts_provider_check
  check (provider in ('twilio', 'sendgrid', 'web_push'));

alter table public.notification_templates
  drop constraint notification_templates_channel_check;
alter table public.notification_templates
  add constraint notification_templates_channel_check
  check (channel in ('email', 'sms', 'web_push'));

alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (
  notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued',
    'training_due_soon', 'training_expired', 'competency_recorded',
    'missing_document', 'certificate_expiring', 'practicum_due_soon', 'practicum_expired',
    'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
    'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due',
    'support_ticket_update', 'workforce_lifecycle_changed', 'training_registration_changed',
    'open_shift_claim_changed', 'shift_swap_changed', 'credential_renewal_changed',
    'qualification_changed', 'course_assignment_due_soon',
    'shift_handoff_assigned', 'shift_handoff_escalated', 'shift_handoff_resolved',
    'time_off_request_changed', 'portal_message_received', 'schedule_published'
  )
);

insert into public.notification_templates (
  organization_id, template_key, channel, version, status,
  subject_template, body_template, allowed_variables, activated_at
) values
  (null, 'default', 'web_push', 1, 'active',
   'CareMetric CareBase',
   'A training or compliance item requires attention. Open CareMetric CareBase to review it.',
   '{}'::text[], now()),
  (null, 'course_assigned', 'web_push', 1, 'active',
   'New training assignment',
   'A new course was assigned to you. Open CareMetric CareBase to review the due date.',
   '{}'::text[], now()),
  (null, 'schedule_published', 'web_push', 1, 'active',
   'Your schedule is available',
   'A work schedule containing one or more of your shifts was published.',
   '{}'::text[], now()),
  (null, 'shift_handoff_assigned', 'web_push', 1, 'active',
   'Shift handoff assigned',
   'A shift handoff needs your review in CareMetric CareBase.',
   '{}'::text[], now()),
  (null, 'shift_handoff_escalated', 'web_push', 1, 'active',
   'Overdue shift handoff',
   'A shift handoff is overdue and requires attention.',
   '{}'::text[], now())
on conflict do nothing;

create or replace function public.update_profile_contact_preferences(
  p_profile_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_sms_opt_in boolean,
  p_preferred_notification_channel text
)
returns setof public.profiles
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_target public.profiles%rowtype;
  v_phone text := nullif(btrim(p_phone), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_target from public.profiles where id = p_profile_id for update;
  if v_target.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if not (
    auth.uid() = v_target.id
    or public.is_platform_admin()
    or (
      public.current_role() = 'org_admin'
      and public.current_org_id() = v_target.organization_id
    )
    or (
      public.current_role() = 'facility_manager'
      and public.current_org_id() = v_target.organization_id
      and exists (
        select 1 from public.employees e
        where e.profile_id = v_target.id
          and e.organization_id = v_target.organization_id
          and public.is_assigned_to_facility(e.facility_id)
      )
    )
  ) then
    raise exception 'Profile is outside the caller scope' using errcode = '42501';
  end if;
  if nullif(btrim(p_first_name), '') is null
     or nullif(btrim(p_last_name), '') is null
     or p_sms_opt_in is null
     or p_preferred_notification_channel is null
     or p_preferred_notification_channel not in ('email', 'sms', 'web_push')
     or (p_sms_opt_in and v_phone is null)
     or (p_preferred_notification_channel = 'sms' and (not p_sms_opt_in or v_phone is null))
     or (p_preferred_notification_channel = 'web_push' and not exists (
       select 1 from public.push_subscriptions s
       where s.profile_id = v_target.id and s.organization_id = v_target.organization_id
         and s.disabled_at is null
         and (s.expiration_time is null or s.expiration_time > now())
     )) then
    raise exception 'Invalid profile contact or notification preference' using errcode = '22023';
  end if;

  return query
  update public.profiles
  set first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      phone = v_phone,
      sms_opt_in = p_sms_opt_in,
      sms_consent_at = case
        when p_sms_opt_in and (
          not v_target.sms_opt_in
          or public.notification_phone_key(v_target.phone)
            is distinct from public.notification_phone_key(v_phone)
        ) then now()
        else v_target.sms_consent_at
      end,
      sms_opt_out_at = case
        when p_sms_opt_in then null
        when v_target.sms_opt_in and not p_sms_opt_in then now()
        else v_target.sms_opt_out_at
      end,
      preferred_notification_channel = p_preferred_notification_channel
  where id = p_profile_id
  returning *;
end;
$function$;
revoke all on function public.update_profile_contact_preferences(
  uuid, text, text, text, boolean, text
) from public, anon;
grant execute on function public.update_profile_contact_preferences(
  uuid, text, text, text, boolean, text
) to authenticated;

create or replace function public.enqueue_push_first_notification_delivery(
  p_organization_id uuid,
  p_profile_id uuid,
  p_notification_id uuid,
  p_delivery_type text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_subscription_id uuid;
  v_delivery_id uuid;
begin
  select s.id into v_subscription_id
  from public.push_subscriptions s
  join public.profiles p on p.id = s.profile_id
  join public.organization_settings os on os.organization_id = s.organization_id
  where s.organization_id = p_organization_id
    and s.profile_id = p_profile_id
    and p.is_active
    and os.web_push_notifications_enabled
    and s.disabled_at is null
    and (s.expiration_time is null or s.expiration_time > now())
  order by s.last_used_at desc nulls last, s.updated_at desc
  limit 1;

  if v_subscription_id is null then
    return public.enqueue_preferred_notification_delivery(
      p_organization_id, p_profile_id, p_notification_id, p_delivery_type
    );
  end if;

  insert into public.notification_deliveries (
    organization_id, profile_id, notification_id, channel, delivery_type, recipient
  ) values (
    p_organization_id, p_profile_id, p_notification_id, 'web_push',
    p_delivery_type, v_subscription_id::text
  ) returning id into v_delivery_id;
  return v_delivery_id;
end;
$function$;
revoke all on function public.enqueue_push_first_notification_delivery(uuid, uuid, uuid, text)
  from public, anon, authenticated;

create or replace function public.enqueue_preferred_notification_delivery(
  p_organization_id uuid,
  p_profile_id uuid,
  p_notification_id uuid,
  p_delivery_type text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_profile public.profiles%rowtype;
  v_settings public.organization_settings%rowtype;
  v_channel text;
  v_recipient text;
  v_subscription_id uuid;
  v_delivery_id uuid;
  v_email_ok boolean;
  v_sms_ok boolean;
begin
  select * into v_profile from public.profiles
  where id = p_profile_id and organization_id = p_organization_id and is_active;
  select * into v_settings from public.organization_settings
  where organization_id = p_organization_id;
  if v_profile.id is null then return null; end if;

  v_email_ok := coalesce(v_settings.email_notifications_enabled, false)
    and not v_profile.email_opt_out and v_profile.email is not null;
  v_sms_ok := coalesce(v_settings.sms_notifications_enabled, false)
    and v_profile.sms_opt_in and v_profile.sms_consent_at is not null
    and v_profile.phone is not null;
  select s.id into v_subscription_id from public.push_subscriptions s
  where s.organization_id = p_organization_id and s.profile_id = p_profile_id
    and coalesce(v_settings.web_push_notifications_enabled, true)
    and s.disabled_at is null
    and (s.expiration_time is null or s.expiration_time > now())
  order by s.last_used_at desc nulls last, s.updated_at desc limit 1;

  v_channel := v_profile.preferred_notification_channel;
  if v_channel = 'web_push' and v_subscription_id is null then
    v_channel := case when v_email_ok then 'email' when v_sms_ok then 'sms' else null end;
  elsif v_channel = 'sms' and not v_sms_ok then
    v_channel := case when v_email_ok then 'email' when v_subscription_id is not null then 'web_push' else null end;
  elsif v_channel = 'email' and not v_email_ok then
    v_channel := case when v_sms_ok then 'sms' when v_subscription_id is not null then 'web_push' else null end;
  end if;
  if v_channel is null then return null; end if;

  v_recipient := case v_channel
    when 'sms' then v_profile.phone
    when 'email' then v_profile.email
    else v_subscription_id::text
  end;
  insert into public.notification_deliveries (
    organization_id, profile_id, notification_id, channel, delivery_type, recipient
  ) values (
    p_organization_id, p_profile_id, p_notification_id, v_channel,
    p_delivery_type, v_recipient
  ) returning id into v_delivery_id;
  return v_delivery_id;
end;
$function$;
revoke all on function public.enqueue_preferred_notification_delivery(uuid, uuid, uuid, text)
  from public, anon, authenticated;

create or replace function public.queue_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_eligible boolean := false;
  v_critical boolean;
  v_push_first boolean;
begin
  v_push_first := new.notification_type in (
    'course_assigned', 'schedule_published', 'open_shift_claim_changed',
    'shift_swap_changed', 'shift_handoff_assigned', 'shift_handoff_escalated',
    'time_off_request_changed'
  );
  if new.notification_type in (
    'training_due_soon', 'training_expired', 'policy_attestation_due_soon',
    'course_continuation_reminder', 'resident_compliance_due', 'support_ticket_update',
    'schedule_published', 'open_shift_claim_changed', 'shift_swap_changed',
    'shift_handoff_assigned', 'shift_handoff_escalated', 'time_off_request_changed'
  ) then
    v_eligible := true;
  elsif new.notification_type in (
    'credential_expiring', 'certificate_expiring', 'practicum_due_soon',
    'practicum_expired', 'policy_attestation_assigned', 'incident_reported',
    'course_assignment_due_soon', 'course_assigned'
  ) and app_private.is_feature_release_active(
    new.organization_id, 'notifications.expanded_delivery_types'
  ) then
    v_eligible := true;
  end if;
  if not v_eligible then return new; end if;

  v_critical := new.notification_type in (
    'training_expired', 'credential_expiring', 'certificate_expiring',
    'practicum_expired', 'incident_reported'
  );
  if v_critical and app_private.is_feature_release_active(
    new.organization_id, 'notifications.critical_multichannel'
  ) then
    perform public.enqueue_critical_notification_delivery(
      new.organization_id, new.profile_id, new.id, 'alert'
    );
  elsif v_push_first then
    perform public.enqueue_push_first_notification_delivery(
      new.organization_id, new.profile_id, new.id, 'alert'
    );
  else
    perform public.enqueue_preferred_notification_delivery(
      new.organization_id, new.profile_id, new.id, 'alert'
    );
  end if;
  return new;
end;
$function$;
revoke all on function public.queue_notification_delivery()
  from public, anon, authenticated;

create or replace function public.publish_schedule(p_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_schedule public.schedules%rowtype;
begin
  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule.id is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
  if not (
    public.is_platform_admin()
    or (
      v_schedule.organization_id = public.current_org_id()
      and public.current_role() in ('org_admin', 'facility_manager')
      and public.is_assigned_to_facility(v_schedule.facility_id)
    )
  ) then
    raise exception 'Not authorized to publish this schedule' using errcode = '42501';
  end if;
  if v_schedule.status = 'published' then return; end if;

  update public.schedules set status = 'published', published_at = now()
  where id = p_schedule_id;

  insert into public.notifications (
    organization_id, profile_id, notification_type, title, body, link
  )
  select distinct
    v_schedule.organization_id, e.profile_id, 'schedule_published',
    'Your schedule is available',
    'A work schedule containing one or more of your shifts was published.',
    '/me/schedule'
  from public.shift_assignments sa
  join public.employees e on e.id = sa.employee_id
  where sa.schedule_id = p_schedule_id
    and e.profile_id is not null
    and e.status = 'active';
end;
$function$;
revoke all on function public.publish_schedule(uuid) from public, anon;
grant execute on function public.publish_schedule(uuid) to authenticated;

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

create or replace function public.enqueue_notification_fallback()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_policy public.notification_channel_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_settings public.organization_settings%rowtype;
  v_channel text;
  v_recipient text;
begin
  if new.status <> 'failed' or new.final_outcome <> 'failed'
     or (old.status is not distinct from new.status
       and old.final_outcome is not distinct from new.final_outcome) then
    return new;
  end if;
  select * into v_policy from public.notification_channel_policies
  where organization_id = new.organization_id;
  if not coalesce(v_policy.fallback_enabled, false)
     or new.fallback_sequence >= coalesce(v_policy.max_fallback_depth, 1) then
    return new;
  end if;
  select * into v_profile from public.profiles
  where id = new.profile_id and organization_id = new.organization_id and is_active;
  select * into v_settings from public.organization_settings
  where organization_id = new.organization_id;
  if v_profile.id is null then return new; end if;

  if new.channel = 'web_push' then
    if coalesce(v_settings.email_notifications_enabled, false)
       and not v_profile.email_opt_out and v_profile.email is not null then
      v_channel := 'email'; v_recipient := v_profile.email;
    elsif coalesce(v_settings.sms_notifications_enabled, false)
       and v_profile.sms_opt_in and v_profile.sms_consent_at is not null
       and v_profile.phone is not null then
      v_channel := 'sms'; v_recipient := v_profile.phone;
    else return new;
    end if;
  elsif new.channel = 'email' then
    if not (coalesce(v_settings.sms_notifications_enabled, false)
      and v_profile.sms_opt_in and v_profile.sms_consent_at is not null
      and v_profile.phone is not null) then return new; end if;
    v_channel := 'sms'; v_recipient := v_profile.phone;
  else
    if not (coalesce(v_settings.email_notifications_enabled, false)
      and not v_profile.email_opt_out and v_profile.email is not null) then return new; end if;
    v_channel := 'email'; v_recipient := v_profile.email;
  end if;

  if exists (
    select 1 from public.notification_deliveries d
    where d.organization_id = new.organization_id
      and d.profile_id = new.profile_id and d.channel = v_channel
      and d.delivery_type = new.delivery_type
      and (d.fallback_group_id = new.fallback_group_id
        or (new.notification_id is not null and d.notification_id = new.notification_id))
  ) then return new; end if;

  insert into public.notification_deliveries (
    organization_id, profile_id, notification_id, channel, delivery_type,
    recipient, status, next_attempt_at, parent_delivery_id, fallback_group_id,
    fallback_sequence, escalation_reason
  ) values (
    new.organization_id, new.profile_id, new.notification_id, v_channel,
    new.delivery_type, v_recipient, 'pending',
    now() + make_interval(mins => coalesce(v_policy.fallback_delay_minutes, 15)),
    new.id, new.fallback_group_id, new.fallback_sequence + 1,
    'alternate_channel_after_permanent_failure'
  );
  return new;
end;
$function$;
revoke all on function public.enqueue_notification_fallback()
  from public, anon, authenticated;

create or replace function public.estimate_notification_attempt_cost()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_channel text;
begin
  select d.channel into v_channel from public.notification_deliveries d
  where d.id = new.delivery_id;
  if v_channel = 'web_push' then
    new.estimated_cost_micros := 0;
    return new;
  end if;
  select case v_channel
      when 'sms' then p.sms_estimate_micros
      else p.email_estimate_micros
    end into new.estimated_cost_micros
  from public.notification_spend_policies p
  where p.organization_id = new.organization_id;
  new.estimated_cost_micros := coalesce(new.estimated_cost_micros, 0);
  return new;
end;
$function$;
revoke all on function public.estimate_notification_attempt_cost()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A2. Installable, governed rule-pack templates (Ohio is the first non-PA pack)
-- ---------------------------------------------------------------------------

create table public.regulatory_rule_pack_templates (
  template_key text primary key check (template_key ~ '^[a-z0-9][a-z0-9_.-]{2,99}$'),
  name text not null,
  description text not null,
  jurisdiction_code text not null,
  authority_name text not null,
  citation text not null,
  source_uri text not null,
  source_checksum_sha256 text not null check (source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  applicability jsonb not null check (jsonb_typeof(applicability) = 'object'),
  calculation_parameters jsonb not null check (jsonb_typeof(calculation_parameters) = 'object'),
  effective_from date not null,
  golden_fixtures jsonb not null check (jsonb_typeof(golden_fixtures) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.regulatory_rule_pack_templates
  for each row execute function public.set_updated_at();
alter table public.regulatory_rule_pack_templates enable row level security;
create policy regulatory_rule_pack_templates_select
  on public.regulatory_rule_pack_templates for select to authenticated
  using ((select public.is_platform_admin()));
revoke all on table public.regulatory_rule_pack_templates from public, anon, authenticated, service_role;
grant select on table public.regulatory_rule_pack_templates to authenticated;
grant all on table public.regulatory_rule_pack_templates to service_role;

insert into public.regulatory_rule_pack_templates (
  template_key, name, description, jurisdiction_code, authority_name, citation,
  source_uri, source_checksum_sha256, applicability, calculation_parameters,
  effective_from, golden_fixtures
) values (
  'oh.rcf.3701-16.personnel',
  'Ohio Residential Care Facility Personnel Training',
  'Draftable Ohio residential-care personnel training rules. Installation creates a draft that must pass the existing independent review, fixture, shadow, and activation gates.',
  'US-OH',
  'Ohio Department of Health',
  'Ohio Admin. Code 3701-16-06',
  'https://codes.ohio.gov/ohio-administrative-code/rule-3701-16-06',
  encode(extensions.digest(convert_to('Ohio Admin. Code 3701-16-06 effective 2024-07-12', 'utf8'), 'sha256'), 'hex'),
  '{"stateCodes":["OH"],"facilityTypes":["ALR"],"workerTypes":["regular","agency","substitute"]}'::jsonb,
  '{"annualBasis":"calendar_year","prorateFromHire":true,"generalAnnualHours":8,"administratorAnnualHours":9,"firstAidDueDays":60,"orientationDueWorkingDays":3,"specialPopulationInitialHours":2,"specialPopulationInitialDueDays":14,"specialPopulationAnnualHours":4,"combinedSpecialPopulationAnnualHours":8,"sourceEffectiveDate":"2024-07-12"}'::jsonb,
  date '2024-07-12',
  '[
    {"fixtureKey":"oh.first_aid.day_60","facilityType":"ALR","profile":"direct_care","boundaryDate":"2026-03-02","input":{"hireDate":"2026-01-02","firstAidHours":0},"expected":{"firstAidDue":true,"dueDays":60}},
    {"fixtureKey":"oh.special_population.initial","facilityType":"ALR","profile":"special_population","boundaryDate":"2026-01-16","input":{"hireDate":"2026-01-02","specialPopulationInitialHours":2},"expected":{"compliant":true,"requiredHours":2,"dueDays":14}},
    {"fixtureKey":"oh.annual.general","facilityType":"ALR","profile":"direct_care","boundaryDate":"2026-12-31","input":{"eligibleAnnualHours":8},"expected":{"compliant":true,"requiredHours":8}},
    {"fixtureKey":"oh.annual.combined_populations","facilityType":"ALR","profile":"combined_special_populations","boundaryDate":"2026-12-31","input":{"eligibleAnnualHours":8},"expected":{"compliant":true,"requiredHours":8}},
    {"fixtureKey":"oh.annual.administrator","facilityType":"ALR","profile":"administrator","boundaryDate":"2026-12-31","input":{"eligibleAnnualHours":9},"expected":{"compliant":true,"requiredHours":9}}
  ]'::jsonb
);

create or replace function public.install_regulatory_rule_pack_template(p_template_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_template public.regulatory_rule_pack_templates%rowtype;
  v_pack_id uuid;
  v_version_id uuid;
  v_fixture jsonb;
  v_payload jsonb;
begin
  if not public.is_platform_admin()
     or not public.identity_assurance_is_current('regulatory_governance') then
    raise exception 'AAL2 platform administration is required to install a rule pack'
      using errcode = '42501';
  end if;
  select * into v_template from public.regulatory_rule_pack_templates
  where template_key = p_template_key;
  if not found then raise exception 'Rule-pack template not found' using errcode = 'P0002'; end if;

  insert into public.regulatory_rule_packs (
    rule_key, name, description, owner_profile_id
  ) values (
    v_template.template_key, v_template.name, v_template.description, auth.uid()
  ) on conflict (rule_key) do update set updated_at = now()
  returning id into v_pack_id;

  if exists (select 1 from public.regulatory_rule_versions where rule_pack_id = v_pack_id) then
    raise exception 'The rule pack is already installed; author a new governed version instead'
      using errcode = '23505';
  end if;
  v_payload := jsonb_build_object(
    'applicability', v_template.applicability,
    'calculationParameters', v_template.calculation_parameters,
    'effectiveFrom', v_template.effective_from,
    'sourceChecksum', v_template.source_checksum_sha256
  );
  insert into public.regulatory_rule_versions (
    rule_pack_id, version_number, state, jurisdiction_code, authority_name,
    citation, source_uri, source_checksum_sha256, applicability,
    calculation_parameters, effective_from, content_checksum_sha256,
    release_notes, authored_by
  ) values (
    v_pack_id, 1, 'draft', v_template.jurisdiction_code, v_template.authority_name,
    v_template.citation, v_template.source_uri, v_template.source_checksum_sha256,
    v_template.applicability, v_template.calculation_parameters, v_template.effective_from,
    encode(extensions.digest(convert_to(v_payload::text, 'utf8'), 'sha256'), 'hex'),
    'Installed from the platform Ohio template; requires legal review, fixture execution, independent approval, shadow evaluation, and explicit activation.',
    auth.uid()
  ) returning id into v_version_id;

  for v_fixture in select value from jsonb_array_elements(v_template.golden_fixtures) loop
    v_payload := jsonb_build_object('input', v_fixture->'input', 'expected', v_fixture->'expected');
    insert into public.regulatory_rule_golden_fixtures (
      rule_version_id, fixture_key, facility_type, workforce_profile_key,
      boundary_date, input_payload, expected_result, fixture_checksum_sha256, created_by
    ) values (
      v_version_id, v_fixture->>'fixtureKey', v_fixture->>'facilityType',
      v_fixture->>'profile', (v_fixture->>'boundaryDate')::date,
      v_fixture->'input', v_fixture->'expected',
      encode(extensions.digest(convert_to(v_payload::text, 'utf8'), 'sha256'), 'hex'), auth.uid()
    );
  end loop;
  return v_version_id;
end;
$function$;
revoke all on function public.install_regulatory_rule_pack_template(text)
  from public, anon, authenticated, service_role;
grant execute on function public.install_regulatory_rule_pack_template(text) to authenticated;

-- ---------------------------------------------------------------------------
-- A3. Official-source polling and draft-only regulatory change proposals
-- ---------------------------------------------------------------------------

create table public.regulatory_update_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique check (source_key ~ '^[a-z0-9][a-z0-9_.-]{2,99}$'),
  rule_key text not null,
  jurisdiction_code text not null,
  authority_name text not null,
  source_uri text not null check (source_uri ~ '^https://'),
  source_kind text not null check (source_kind in ('code','bulletin','agency_guidance')),
  is_active boolean not null default true,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.regulatory_update_sources
  for each row execute function public.set_updated_at();

create table public.regulatory_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.regulatory_update_sources(id) on delete restrict,
  fetched_at timestamptz not null default now(),
  http_status integer not null,
  source_checksum_sha256 text check (source_checksum_sha256 is null or source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_content text,
  response_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(response_metadata) = 'object'),
  fetch_succeeded boolean not null,
  changed_from_previous boolean not null default false,
  unique (source_id, source_checksum_sha256)
);
create index regulatory_source_snapshots_latest_idx
  on public.regulatory_source_snapshots(source_id, fetched_at desc);

create table public.regulatory_change_proposals (
  id uuid primary key default gen_random_uuid(),
  source_snapshot_id uuid not null unique references public.regulatory_source_snapshots(id) on delete restrict,
  rule_pack_id uuid references public.regulatory_rule_packs(id) on delete restrict,
  drafted_rule_version_id uuid references public.regulatory_rule_versions(id) on delete restrict,
  state text not null default 'detected' check (state in ('detected','drafted','dismissed','incorporated')),
  change_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(change_summary) = 'object'),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  review_notes text
);

alter table public.regulatory_update_sources enable row level security;
alter table public.regulatory_source_snapshots enable row level security;
alter table public.regulatory_change_proposals enable row level security;
create policy regulatory_update_sources_admin_select on public.regulatory_update_sources
  for select to authenticated using ((select public.is_platform_admin()));
create policy regulatory_source_snapshots_admin_select on public.regulatory_source_snapshots
  for select to authenticated using ((select public.is_platform_admin()));
create policy regulatory_change_proposals_admin_select on public.regulatory_change_proposals
  for select to authenticated using ((select public.is_platform_admin()));
revoke all on table public.regulatory_update_sources, public.regulatory_source_snapshots,
  public.regulatory_change_proposals from public, anon, authenticated, service_role;
grant select on table public.regulatory_update_sources, public.regulatory_source_snapshots,
  public.regulatory_change_proposals to authenticated;
grant all on table public.regulatory_update_sources, public.regulatory_source_snapshots,
  public.regulatory_change_proposals to service_role;

insert into public.regulatory_update_sources (
  source_key, rule_key, jurisdiction_code, authority_name, source_uri, source_kind
) values
  ('pa.code.2600', 'pa.pch.2600', 'US-PA', 'Pennsylvania Department of Human Services',
   'https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2600/chap2600toc.html', 'code'),
  ('pa.code.2800', 'pa.alr.2800', 'US-PA', 'Pennsylvania Department of Human Services',
   'https://www.pacodeandbulletin.gov/secure/pacode/data/055/chapter2800/chap2800toc.html', 'code'),
  ('pa.dhs.pch-alr-guides', 'pa.pch-alr.guidance', 'US-PA', 'Pennsylvania Department of Human Services',
   'https://www.pa.gov/agencies/dhs/resources/licensing/pch-alr-licensing/pch-alr-compliance-guides', 'agency_guidance')
on conflict (source_key) do update set source_uri = excluded.source_uri, is_active = true;

alter table public.regulatory_rule_versions
  add column automation_source_snapshot_id uuid references public.regulatory_source_snapshots(id) on delete restrict,
  add column authored_by_automation boolean not null default false;

create or replace function public.record_regulatory_source_snapshot(
  p_source_key text,
  p_http_status integer,
  p_source_checksum_sha256 text,
  p_normalized_content text,
  p_response_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source public.regulatory_update_sources%rowtype;
  v_previous_checksum text;
  v_snapshot_id uuid;
  v_pack public.regulatory_rule_packs%rowtype;
  v_active public.regulatory_rule_versions%rowtype;
  v_version_id uuid;
  v_changed boolean := false;
  v_content_hash text;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only the regulatory update worker may record source snapshots'
      using errcode = '42501';
  end if;
  select * into v_source from public.regulatory_update_sources
  where source_key = p_source_key and is_active for update;
  if not found then raise exception 'Regulatory source not found' using errcode = 'P0002'; end if;
  if p_http_status between 200 and 299 then
    if p_source_checksum_sha256 !~ '^[0-9a-f]{64}$' or length(coalesce(p_normalized_content, '')) < 40 then
      raise exception 'Successful regulatory snapshots require validated content and SHA-256'
        using errcode = '22023';
    end if;
    select source_checksum_sha256 into v_previous_checksum
    from public.regulatory_source_snapshots
    where source_id = v_source.id and fetch_succeeded
    order by fetched_at desc limit 1;
    v_changed := v_previous_checksum is not null and v_previous_checksum <> p_source_checksum_sha256;
  end if;
  insert into public.regulatory_source_snapshots (
    source_id, http_status, source_checksum_sha256, normalized_content,
    response_metadata, fetch_succeeded, changed_from_previous
  ) values (
    v_source.id, p_http_status, p_source_checksum_sha256,
    left(p_normalized_content, 500000), coalesce(p_response_metadata, '{}'::jsonb),
    p_http_status between 200 and 299, v_changed
  ) on conflict (source_id, source_checksum_sha256) do update
    set fetched_at = now(), http_status = excluded.http_status,
        response_metadata = excluded.response_metadata
  returning id into v_snapshot_id;
  update public.regulatory_update_sources set
    last_checked_at = now(),
    last_changed_at = case when v_changed then now() else last_changed_at end,
    consecutive_failures = case when p_http_status between 200 and 299 then 0 else consecutive_failures + 1 end
  where id = v_source.id;

  if v_changed then
    select * into v_pack from public.regulatory_rule_packs where rule_key = v_source.rule_key;
    if v_pack.id is not null then
      select * into v_active from public.regulatory_rule_versions
      where rule_pack_id = v_pack.id and state = 'active';
    end if;
    insert into public.regulatory_change_proposals (
      source_snapshot_id, rule_pack_id, state, change_summary
    ) values (
      v_snapshot_id, v_pack.id, 'detected',
      jsonb_build_object('sourceKey', v_source.source_key, 'previousChecksum', v_previous_checksum,
        'newChecksum', p_source_checksum_sha256, 'detectedAt', now(),
        'requiresHumanLegalReview', true)
    ) on conflict (source_snapshot_id) do nothing;

    -- Automation is intentionally permitted to create only a draft. The existing
    -- submit/review/fixture/shadow/activation functions remain the sole release path.
    if v_active.id is not null and not exists (
      select 1 from public.regulatory_rule_versions
      where automation_source_snapshot_id = v_snapshot_id
    ) then
      v_content_hash := encode(extensions.digest(convert_to(
        jsonb_build_object('baseline', v_active.content_checksum_sha256,
          'source', p_source_checksum_sha256, 'parameters', v_active.calculation_parameters)::text,
        'utf8'), 'sha256'), 'hex');
      insert into public.regulatory_rule_versions (
        rule_pack_id, version_number, state, jurisdiction_code, authority_name,
        citation, source_uri, source_checksum_sha256, applicability,
        calculation_parameters, effective_from, supersedes_version_id,
        content_checksum_sha256, release_notes, authored_by,
        automation_source_snapshot_id, authored_by_automation
      ) values (
        v_pack.id,
        (select coalesce(max(version_number), 0) + 1 from public.regulatory_rule_versions where rule_pack_id = v_pack.id),
        'draft', v_active.jurisdiction_code, v_active.authority_name, v_active.citation,
        v_source.source_uri, p_source_checksum_sha256, v_active.applicability,
        v_active.calculation_parameters, current_date, v_active.id, v_content_hash,
        'AUTOMATED DRAFT: an official source changed. Calculation parameters are copied from the active baseline and must be reconciled by a platform administrator before submission.',
        v_pack.owner_profile_id, v_snapshot_id, true
      ) returning id into v_version_id;
      update public.regulatory_change_proposals
      set state = 'drafted', drafted_rule_version_id = v_version_id
      where source_snapshot_id = v_snapshot_id;
    end if;
  end if;
  return jsonb_build_object('snapshotId', v_snapshot_id, 'changed', v_changed,
    'draftedRuleVersionId', v_version_id);
end;
$function$;
revoke all on function public.record_regulatory_source_snapshot(text,integer,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_regulatory_source_snapshot(text,integer,text,text,jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- B1. Mock inspection receipts and grounded survey-style findings
-- ---------------------------------------------------------------------------

create table public.mock_inspection_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  status text not null default 'running' check (status in ('running','completed','failed')),
  as_of_date date not null default current_date,
  checklist_version_sha256 text not null check (checklist_version_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_snapshot) = 'object'),
  findings jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),
  passed_count integer not null default 0 check (passed_count >= 0),
  attention_count integer not null default 0 check (attention_count >= 0),
  indeterminate_count integer not null default 0 check (indeterminate_count >= 0),
  model text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
create index mock_inspection_runs_facility_idx
  on public.mock_inspection_runs(organization_id, facility_id, created_at desc);
alter table public.mock_inspection_runs enable row level security;
create policy mock_inspection_runs_select on public.mock_inspection_runs
  for select to authenticated using (
    (select public.is_platform_admin())
    or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('org_admin','auditor'))
    or (organization_id = (select public.current_org_id())
      and (select public.current_role()) in ('facility_manager','trainer')
      and public.is_assigned_to_facility(facility_id))
  );
revoke all on table public.mock_inspection_runs from public, anon, authenticated, service_role;
grant select on table public.mock_inspection_runs to authenticated;
grant all on table public.mock_inspection_runs to service_role;

create or replace function public.record_mock_inspection_run(
  p_facility_id uuid,
  p_as_of_date date,
  p_checklist_version_sha256 text,
  p_evidence_snapshot jsonb,
  p_findings jsonb,
  p_model text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_facility public.facilities%rowtype;
  v_actor uuid;
  v_id uuid;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only the mock-inspection worker may record a run' using errcode = '42501';
  end if;
  v_actor := nullif(auth.jwt()->>'sub', '')::uuid;
  if v_actor is null then
    v_actor := nullif(p_evidence_snapshot->>'requestedBy', '')::uuid;
  end if;
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found or v_actor is null then raise exception 'Facility or requesting actor is invalid' using errcode = '22023'; end if;
  if p_checklist_version_sha256 !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_evidence_snapshot) <> 'object'
     or jsonb_typeof(p_findings) <> 'array' then
    raise exception 'Mock inspection evidence is invalid' using errcode = '22023';
  end if;
  insert into public.mock_inspection_runs (
    organization_id, facility_id, status, as_of_date, checklist_version_sha256,
    evidence_snapshot, findings, passed_count, attention_count,
    indeterminate_count, model, created_by, completed_at
  ) values (
    v_facility.organization_id, v_facility.id, 'completed', coalesce(p_as_of_date, current_date),
    p_checklist_version_sha256, p_evidence_snapshot, p_findings,
    (select count(*) from jsonb_array_elements(p_findings) f where f->>'determination' = 'pass'),
    (select count(*) from jsonb_array_elements(p_findings) f where f->>'determination' = 'attention'),
    (select count(*) from jsonb_array_elements(p_findings) f where f->>'determination' = 'indeterminate'),
    p_model, v_actor, now()
  ) returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.record_mock_inspection_run(uuid,date,text,jsonb,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_mock_inspection_run(uuid,date,text,jsonb,jsonb,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- B2. K-anonymous cross-tenant benchmark snapshots
-- ---------------------------------------------------------------------------

insert into public.feature_definitions (
  feature_key, display_name, description, value_type, default_value
) values (
  'analytics.cross_tenant_benchmarks', 'Cross-tenant benchmarks',
  'K-anonymous aggregate peer benchmarks; no tenant or row-level records are exposed.',
  'boolean', 'false'::jsonb
) on conflict (feature_key) do nothing;
insert into public.release_flags (
  feature_key, rollout_mode, is_enabled, owner, change_reason
) values (
  'analytics.cross_tenant_benchmarks', 'off', false, 'platform_analytics',
  'Platform-admin validation required before cohort or global release.'
) on conflict (feature_key) do nothing;

create table public.benchmark_snapshots (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_code text not null,
  facility_type text not null check (facility_type in ('PCH','ALR')),
  period_start date not null,
  period_end date not null,
  organization_count integer not null check (organization_count >= 10),
  facility_count integer not null check (facility_count >= organization_count),
  k_threshold integer not null default 10 check (k_threshold >= 10),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  cohort_checksum_sha256 text not null check (cohort_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  generated_at timestamptz not null default now(),
  unique (jurisdiction_code, facility_type, period_start, period_end)
);
create index benchmark_snapshots_latest_idx
  on public.benchmark_snapshots(jurisdiction_code, facility_type, generated_at desc);
alter table public.benchmark_snapshots enable row level security;
create policy benchmark_snapshots_platform_admin_select on public.benchmark_snapshots
  for select to authenticated using ((select public.is_platform_admin()));
revoke all on table public.benchmark_snapshots from public, anon, authenticated, service_role;
grant select on table public.benchmark_snapshots to authenticated;
grant all on table public.benchmark_snapshots to service_role;

create or replace function public.refresh_benchmark_snapshots(
  p_period_end date default current_date,
  p_k_threshold integer default 10
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare v_inserted integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only the trusted analytics worker may refresh benchmarks' using errcode = '42501';
  end if;
  if p_k_threshold < 10 then raise exception 'Benchmark k threshold cannot be below 10' using errcode = '22023'; end if;
  with facility_metrics as (
    select f.id, f.organization_id, 'US-' || upper(coalesce(nullif(f.state,''), 'PA')) as jurisdiction_code,
      f.facility_type,
      coalesce((select 100.0 * count(*) filter (where r.status = 'compliant') / nullif(count(*),0)
        from public.employee_training_records r where r.facility_id = f.id), 0)::numeric as training_rate,
      coalesce((select percentile_cont(0.5) within group (order by greatest(0, c.expiration_date - p_period_end))
        from public.employee_credentials c where c.facility_id = f.id and c.status in ('compliant','due_soon')
          and c.expiration_date is not null), 0)::numeric as median_renewal_days,
      coalesce((select 100.0 * count(*) / nullif((select count(*) from public.residents r
        where r.facility_id = f.id and r.status = 'active'),0)
        from public.incidents i where i.facility_id = f.id
          and i.occurred_at >= p_period_end - interval '1 year'
          and i.occurred_at < p_period_end + interval '1 day'), 0)::numeric as incidents_per_100_beds
    from public.facilities f where f.is_active
  ), cohorts as (
    select jurisdiction_code, facility_type, count(distinct organization_id)::integer as organization_count,
      count(*)::integer as facility_count,
      jsonb_build_object(
        'trainingComplianceRate', jsonb_build_object(
          'p25', percentile_cont(0.25) within group (order by training_rate),
          'p50', percentile_cont(0.50) within group (order by training_rate),
          'p75', percentile_cont(0.75) within group (order by training_rate)),
        'medianCredentialRenewalDays', jsonb_build_object(
          'p25', percentile_cont(0.25) within group (order by median_renewal_days),
          'p50', percentile_cont(0.50) within group (order by median_renewal_days),
          'p75', percentile_cont(0.75) within group (order by median_renewal_days)),
        'incidentsPer100OccupiedBeds', jsonb_build_object(
          'p25', percentile_cont(0.25) within group (order by incidents_per_100_beds),
          'p50', percentile_cont(0.50) within group (order by incidents_per_100_beds),
          'p75', percentile_cont(0.75) within group (order by incidents_per_100_beds))
      ) as metrics
    from facility_metrics group by jurisdiction_code, facility_type
    having count(distinct organization_id) >= p_k_threshold
  ), written as (
    insert into public.benchmark_snapshots (
      jurisdiction_code, facility_type, period_start, period_end,
      organization_count, facility_count, k_threshold, metrics, cohort_checksum_sha256
    ) select jurisdiction_code, facility_type, p_period_end - 364, p_period_end,
      organization_count, facility_count, p_k_threshold, metrics,
      encode(extensions.digest(convert_to(jsonb_build_object(
        'jurisdiction', jurisdiction_code, 'facilityType', facility_type,
        'periodEnd', p_period_end, 'organizationCount', organization_count,
        'facilityCount', facility_count, 'metrics', metrics)::text, 'utf8'), 'sha256'), 'hex')
    from cohorts
    on conflict (jurisdiction_code, facility_type, period_start, period_end) do update
      set organization_count = excluded.organization_count,
          facility_count = excluded.facility_count, k_threshold = excluded.k_threshold,
          metrics = excluded.metrics, cohort_checksum_sha256 = excluded.cohort_checksum_sha256,
          generated_at = now()
    returning 1
  ) select count(*) into v_inserted from written;
  return v_inserted;
end;
$function$;
revoke all on function public.refresh_benchmark_snapshots(date,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.refresh_benchmark_snapshots(date,integer) to service_role;

create or replace function public.get_facility_benchmark_comparison(p_facility_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_facility public.facilities%rowtype; v_access jsonb; v_snapshot public.benchmark_snapshots%rowtype;
begin
  select * into v_facility from public.facilities where id = p_facility_id;
  if not found then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  if not (public.is_platform_admin() or (
    v_facility.organization_id = public.current_org_id()
    and public.current_role() in ('org_admin','facility_manager','auditor')
    and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(v_facility.id)))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not public.is_platform_admin() then
    v_access := public.evaluate_feature_access(v_facility.organization_id, 'analytics.cross_tenant_benchmarks');
    if coalesce((v_access->>'allowed')::boolean, false) is not true then
      raise exception 'Cross-tenant benchmarks are not released for this organization' using errcode = '42501';
    end if;
  end if;
  select * into v_snapshot from public.benchmark_snapshots
  where jurisdiction_code = 'US-' || upper(coalesce(nullif(v_facility.state,''), 'PA'))
    and facility_type = v_facility.facility_type
  order by period_end desc, generated_at desc limit 1;
  if not found then return jsonb_build_object('available', false, 'reason', 'cohort_below_k_or_not_generated'); end if;
  return jsonb_build_object('available', true, 'facilityId', v_facility.id,
    'cohort', jsonb_build_object('jurisdictionCode', v_snapshot.jurisdiction_code,
      'facilityType', v_snapshot.facility_type, 'organizationCount', v_snapshot.organization_count,
      'facilityCount', v_snapshot.facility_count, 'kThreshold', v_snapshot.k_threshold,
      'periodStart', v_snapshot.period_start, 'periodEnd', v_snapshot.period_end),
    'metrics', v_snapshot.metrics, 'generatedAt', v_snapshot.generated_at);
end;
$function$;
revoke all on function public.get_facility_benchmark_comparison(uuid) from public, anon;
grant execute on function public.get_facility_benchmark_comparison(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- B3/B4. Workforce retention analytics and paid-training payroll export
-- ---------------------------------------------------------------------------

create or replace function public.get_workforce_retention_metrics(p_facility_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_org uuid := public.current_org_id(); v_result jsonb;
begin
  if not (public.is_platform_admin() or public.current_role() in ('org_admin','facility_manager','auditor')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_facility_id is not null and not exists (
    select 1 from public.facilities f where f.id = p_facility_id
      and (public.is_platform_admin() or f.organization_id = v_org)
      and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(f.id))
  ) then raise exception 'Facility not found or outside scope' using errcode = '42501'; end if;
  with scoped as (
    select ep.*, e.job_title
    from public.employment_episodes ep join public.employees e on e.id = ep.employee_id
    where (public.is_platform_admin() or ep.organization_id = v_org)
      and (p_facility_id is null or ep.facility_id = p_facility_id)
      and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(ep.facility_id))
  ), roles as (
    select coalesce(job_title, 'Unspecified') as role,
      count(*) filter (where ended_on >= current_date - 364)::integer as separations,
      count(*) filter (where started_on <= current_date and (ended_on is null or ended_on >= current_date))::integer as current_headcount,
      count(*) filter (where started_on <= current_date - 364 and (ended_on is null or ended_on >= current_date - 364))::integer as starting_headcount,
      count(*) filter (where started_on between current_date - 455 and current_date - 90)::integer as ninety_day_cohort,
      count(*) filter (where started_on between current_date - 455 and current_date - 90
        and (ended_on is null or ended_on >= started_on + 90))::integer as ninety_day_retained,
      avg((coalesce(ended_on, current_date) - started_on)::numeric) as average_tenure_days
    from scoped group by coalesce(job_title, 'Unspecified')
  ), total as (
    select 'All roles'::text as role,
      count(*) filter (where ended_on >= current_date - 364)::integer as separations,
      count(*) filter (where started_on <= current_date and (ended_on is null or ended_on >= current_date))::integer as current_headcount,
      count(*) filter (where started_on <= current_date - 364 and (ended_on is null or ended_on >= current_date - 364))::integer as starting_headcount,
      count(*) filter (where started_on between current_date - 455 and current_date - 90)::integer as ninety_day_cohort,
      count(*) filter (where started_on between current_date - 455 and current_date - 90
        and (ended_on is null or ended_on >= started_on + 90))::integer as ninety_day_retained,
      avg((coalesce(ended_on, current_date) - started_on)::numeric) as average_tenure_days
    from scoped
  ), combined as (select * from total union all select * from roles)
  select jsonb_build_object('asOf', current_date, 'facilityId', p_facility_id,
    'methodology', jsonb_build_object('turnoverWindowDays',365,'retentionWindowDays',90,
      'turnoverDenominator','average of starting and current headcount'),
    'segments', coalesce(jsonb_agg(jsonb_build_object(
      'role', role, 'separations', separations, 'currentHeadcount', current_headcount,
      'annualizedTurnoverRate', round(100 * separations / nullif((starting_headcount + current_headcount)::numeric / 2, 0), 1),
      'ninetyDayCohort', ninety_day_cohort,
      'ninetyDayRetentionRate', round(100 * ninety_day_retained / nullif(ninety_day_cohort,0)::numeric, 1),
      'averageTenureDays', round(average_tenure_days, 0)
    ) order by case when role = 'All roles' then 0 else 1 end, role), '[]'::jsonb)) into v_result
  from combined;
  return v_result;
end;
$function$;
revoke all on function public.get_workforce_retention_metrics(uuid) from public, anon;
grant execute on function public.get_workforce_retention_metrics(uuid) to authenticated;

create or replace function public.get_paid_training_payroll_export(
  p_facility_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  employee_number text,
  employee_name text,
  work_date date,
  course_or_class text,
  training_code text,
  verified_hours numeric,
  source text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_period_end < p_period_start or p_period_end - p_period_start > 366 then
    raise exception 'Payroll period must be between 1 and 367 days' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.facilities f where f.id = p_facility_id
      and (public.is_platform_admin() or (f.organization_id = public.current_org_id()
        and public.current_role() in ('org_admin','facility_manager')
        and (public.current_role() <> 'facility_manager' or public.is_assigned_to_facility(f.id))))
  ) then raise exception 'Facility not found or outside payroll scope' using errcode = '42501'; end if;
  return query
  select e.employee_number, concat_ws(', ', e.last_name, e.first_name), r.completion_date,
    coalesce(tc.class_name, tt.name), tt.code, r.hours,
    case when tc.id is null then 'verified_training_record' else 'verified_class_attendance' end
  from public.employee_training_records r
  join public.employees e on e.id = r.employee_id
  join public.training_types tt on tt.id = r.training_type_id
  left join public.training_class_attendees a on a.training_record_id = r.id and a.attended
  left join public.training_classes tc on tc.id = a.class_id
  where r.facility_id = p_facility_id and r.completion_date between p_period_start and p_period_end
    and r.status = 'compliant' and r.hours is not null and r.hours > 0
    and r.verified_at is not null
  order by r.completion_date, e.last_name, e.first_name, tt.name;
end;
$function$;
revoke all on function public.get_paid_training_payroll_export(uuid,date,date) from public, anon;
grant execute on function public.get_paid_training_payroll_export(uuid,date,date) to authenticated;

-- ---------------------------------------------------------------------------
-- C2. Privacy-conscious first-party product telemetry
-- ---------------------------------------------------------------------------

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_role text not null check (actor_role in ('platform_admin','org_admin','facility_manager','trainer','employee','auditor')),
  event_name text not null check (event_name in (
    'route_viewed','course_assigned','course_started','course_completed','report_exported',
    'mock_inspection_started','mock_inspection_completed','payroll_exported',
    'benchmark_viewed','regulatory_draft_reviewed','push_permission_changed'
  )),
  route_template text check (route_template is null or (route_template ~ '^/[-a-z0-9_/:?=]+$' and length(route_template) <= 160)),
  properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
  session_hash text check (session_hash is null or session_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);
create index product_events_analysis_idx
  on public.product_events(organization_id, event_name, occurred_at desc);
create index product_events_route_idx
  on public.product_events(route_template, occurred_at desc);
alter table public.product_events enable row level security;
revoke all on table public.product_events from public, anon, authenticated, service_role;
grant all on table public.product_events to service_role;

create or replace function app_private.reject_sensitive_product_event_properties()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare v_key text;
begin
  if pg_column_size(new.properties) > 8192 then
    raise exception 'Product event properties exceed the 8 KB privacy budget' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(new.properties) loop
    if lower(v_key) ~ '(name|email|phone|address|birth|dob|ssn|resident|employee|patient|medical|clinical|narrative|note|description|token|secret|password)' then
      raise exception 'Sensitive or identifying telemetry property is not allowed: %', v_key using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$function$;
create trigger reject_sensitive_product_event_properties
before insert or update on public.product_events
for each row execute function app_private.reject_sensitive_product_event_properties();
revoke all on function app_private.reject_sensitive_product_event_properties()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- C3. Verified lifecycle policies, native time-partitioned archive, and holds
-- ---------------------------------------------------------------------------

alter table public.course_ai_generations add column organization_id uuid references public.organizations(id) on delete set null;
update public.course_ai_generations g set organization_id = p.organization_id
from public.profiles p where p.id = g.requested_by and g.organization_id is null;
create index course_ai_generations_lifecycle_idx
  on public.course_ai_generations(organization_id, created_at);
create index notification_deliveries_lifecycle_idx
  on public.notification_deliveries(organization_id, created_at);
create index report_snapshots_lifecycle_idx
  on public.report_snapshots(organization_id, generated_at);
create index historical_metric_snapshots_lifecycle_idx
  on public.historical_metric_snapshots(organization_id, created_at);

create table public.data_lifecycle_policies (
  policy_key text primary key check (policy_key ~ '^[a-z][a-z0-9_.-]{2,99}$'),
  source_schema text not null default 'public' check (source_schema = 'public'),
  source_table text not null unique,
  time_column text not null,
  organization_column text,
  archive_after_days integer not null check (archive_after_days between 30 and 36500),
  delete_after_days integer check (delete_after_days is null or delete_after_days >= archive_after_days),
  disposition text not null check (disposition in ('archive_only','archive_then_delete')),
  evidence_class text not null,
  policy_rationale text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.data_lifecycle_policies
  for each row execute function public.set_updated_at();

create table public.data_lifecycle_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  source_table text,
  starts_at timestamptz not null default '-infinity',
  ends_at timestamptz not null default 'infinity',
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  placed_by uuid not null references public.profiles(id) on delete restrict,
  released_at timestamptz,
  released_by uuid references public.profiles(id),
  release_reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((released_at is null and released_by is null) or
    (released_at is not null and released_by is not null and length(btrim(release_reason)) >= 10))
);
create index data_lifecycle_holds_active_idx
  on public.data_lifecycle_holds(organization_id, source_table, starts_at, ends_at)
  where released_at is null;

create table public.data_lifecycle_runs (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null references public.data_lifecycle_policies(policy_key) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','failed')),
  cutoff_at timestamptz not null,
  rows_examined integer not null default 0,
  rows_archived integer not null default 0,
  rows_deleted integer not null default 0,
  rows_held integer not null default 0,
  error_message text,
  request_id text not null unique
);

create table app_private.retained_records_archive (
  archive_id uuid not null default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  source_schema text not null,
  source_table text not null,
  source_record_id text not null,
  organization_id uuid,
  source_occurred_at timestamptz not null,
  retention_policy_key text not null,
  record_payload jsonb not null,
  record_checksum_sha256 text not null check (record_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  primary key (archive_id, archived_at),
  unique (source_table, source_record_id, archived_at)
) partition by range (archived_at);
create table app_private.retained_records_archive_2026 partition of app_private.retained_records_archive
  for values from ('2026-01-01') to ('2027-01-01');
create table app_private.retained_records_archive_2027 partition of app_private.retained_records_archive
  for values from ('2027-01-01') to ('2028-01-01');
create table app_private.retained_records_archive_default partition of app_private.retained_records_archive default;
create index retained_records_archive_source_idx
  on app_private.retained_records_archive(source_table, source_occurred_at, organization_id);

alter table public.data_lifecycle_policies enable row level security;
alter table public.data_lifecycle_holds enable row level security;
alter table public.data_lifecycle_runs enable row level security;
alter table app_private.retained_records_archive enable row level security;
create policy data_lifecycle_policies_admin_select on public.data_lifecycle_policies
  for select to authenticated using ((select public.is_platform_admin()));
create policy data_lifecycle_holds_admin_select on public.data_lifecycle_holds
  for select to authenticated using ((select public.is_platform_admin()));
create policy data_lifecycle_runs_admin_select on public.data_lifecycle_runs
  for select to authenticated using ((select public.is_platform_admin()));
revoke all on table public.data_lifecycle_policies, public.data_lifecycle_holds,
  public.data_lifecycle_runs from public, anon, authenticated, service_role;
revoke all on table app_private.retained_records_archive from public, anon, authenticated, service_role;
grant select on table public.data_lifecycle_policies, public.data_lifecycle_holds,
  public.data_lifecycle_runs to authenticated;
grant all on table public.data_lifecycle_policies, public.data_lifecycle_holds,
  public.data_lifecycle_runs to service_role;
grant all on table app_private.retained_records_archive to service_role;

insert into public.data_lifecycle_policies (
  policy_key, source_table, time_column, organization_column, archive_after_days,
  delete_after_days, disposition, evidence_class, policy_rationale
) values
  ('lifecycle.audit_logs', 'audit_logs', 'created_at', 'organization_id', 365, 2555, 'archive_only',
    'regulated_audit_evidence', 'The existing audit manifest and legal-hold controls remain authoritative; lifecycle archiving is additive and never deletes audit evidence.'),
  ('lifecycle.notification_deliveries', 'notification_deliveries', 'created_at', 'organization_id', 90, 730, 'archive_then_delete',
    'notification_operational_evidence', 'Keep two years of delivery evidence while moving aged operational rows out of the hot table.'),
  ('lifecycle.course_ai_generations', 'course_ai_generations', 'created_at', 'organization_id', 365, 2555, 'archive_only',
    'ai_governance_evidence', 'AI generation receipts are governance records and remain in the source table after archival.'),
  ('lifecycle.report_snapshots', 'report_snapshots', 'generated_at', 'organization_id', 365, 2555, 'archive_only',
    'evidence_room_report', 'Report snapshots are append-only and may be referenced by evidence-room artifacts; archival never deletes them.'),
  ('lifecycle.historical_metric_snapshots', 'historical_metric_snapshots', 'created_at', 'organization_id', 365, 2555, 'archive_only',
    'historical_metric_evidence', 'Historical metric snapshots are immutable report evidence and are never deleted by lifecycle automation.'),
  ('lifecycle.product_events', 'product_events', 'occurred_at', 'organization_id', 90, 395, 'archive_then_delete',
    'deidentified_product_analytics', 'Raw first-party telemetry has a short hot window and a thirteen-month maximum retention period.')
on conflict (policy_key) do update set
  archive_after_days = excluded.archive_after_days,
  delete_after_days = excluded.delete_after_days,
  disposition = excluded.disposition,
  policy_rationale = excluded.policy_rationale,
  is_active = true;

create or replace function public.run_data_lifecycle_policy(
  p_policy_key text,
  p_limit integer default 5000,
  p_request_id text default gen_random_uuid()::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_policy public.data_lifecycle_policies%rowtype;
  v_run_id uuid;
  v_cutoff timestamptz;
  v_archived integer := 0;
  v_deleted integer := 0;
  v_held integer := 0;
  v_sql text;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Only the trusted lifecycle worker may run retention policies' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 25000 then raise exception 'Lifecycle batch limit is invalid' using errcode = '22023'; end if;
  select * into v_policy from public.data_lifecycle_policies
  where policy_key = p_policy_key and is_active;
  if not found then raise exception 'Lifecycle policy not found' using errcode = 'P0002'; end if;
  v_cutoff := now() - make_interval(days => v_policy.archive_after_days);
  insert into public.data_lifecycle_runs(policy_key, cutoff_at, request_id)
  values (v_policy.policy_key, v_cutoff, p_request_id) returning id into v_run_id;

  v_sql := format($sql$
    with candidates as (
      select t.*, to_jsonb(t) as payload
      from %I.%I t
      where t.%I < $1
        and not exists (
          select 1 from public.data_lifecycle_holds h
          where h.released_at is null
            and (h.source_table is null or h.source_table = $2)
            and (h.organization_id is null or h.organization_id = %s)
            and t.%I between h.starts_at and h.ends_at
        )
        %s
      order by t.%I
      limit $3
    ), written as (
      insert into app_private.retained_records_archive (
        source_schema, source_table, source_record_id, organization_id,
        source_occurred_at, retention_policy_key, record_payload, record_checksum_sha256
      ) select $4, $2, id::text, %s, %I, $5, payload,
        encode(extensions.digest(convert_to(payload::text, 'utf8'), 'sha256'), 'hex')
      from candidates
      where not exists (
        select 1 from app_private.retained_records_archive a
        where a.source_table = $2 and a.source_record_id = candidates.id::text
      )
      returning 1
    ) select count(*) from written
  $sql$,
    v_policy.source_schema, v_policy.source_table, v_policy.time_column,
    case when v_policy.organization_column is null then 'null::uuid' else format('t.%I', v_policy.organization_column) end,
    v_policy.time_column,
    case when v_policy.source_table = 'audit_logs' then
      'and not exists (select 1 from app_private.audit_legal_holds ah where ah.released_at is null and (ah.organization_id is null or ah.organization_id = t.organization_id))'
    else '' end,
    v_policy.time_column,
    case when v_policy.organization_column is null then 'null::uuid' else format('%I', v_policy.organization_column) end,
    v_policy.time_column
  );
  execute v_sql into v_archived using v_cutoff, v_policy.source_table, p_limit,
    v_policy.source_schema, v_policy.policy_key;

  if v_policy.disposition = 'archive_then_delete' and v_policy.delete_after_days is not null then
    v_cutoff := now() - make_interval(days => v_policy.delete_after_days);
    v_sql := format($sql$
      delete from %I.%I t where t.id in (
        select t2.id from %I.%I t2
        where t2.%I < $1
          and exists (select 1 from app_private.retained_records_archive a
            where a.source_table = $2 and a.source_record_id = t2.id::text)
          and not exists (select 1 from public.data_lifecycle_holds h
            where h.released_at is null and (h.source_table is null or h.source_table = $2)
              and (h.organization_id is null or h.organization_id = %s)
              and t2.%I between h.starts_at and h.ends_at)
        order by t2.%I limit $3
      )
    $sql$, v_policy.source_schema, v_policy.source_table,
      v_policy.source_schema, v_policy.source_table, v_policy.time_column,
      case when v_policy.organization_column is null then 'null::uuid' else format('t2.%I', v_policy.organization_column) end,
      v_policy.time_column, v_policy.time_column);
    execute v_sql using v_cutoff, v_policy.source_table, p_limit;
    get diagnostics v_deleted = row_count;
  end if;
  update public.data_lifecycle_runs set status = 'completed', completed_at = now(),
    rows_examined = v_archived, rows_archived = v_archived,
    rows_deleted = v_deleted, rows_held = v_held where id = v_run_id;
  return jsonb_build_object('runId', v_run_id, 'policyKey', v_policy.policy_key,
    'archived', v_archived, 'deleted', v_deleted, 'held', v_held);
exception when others then
  if v_run_id is not null then
    update public.data_lifecycle_runs set status = 'failed', completed_at = now(),
      error_message = left(sqlerrm, 2000) where id = v_run_id;
  end if;
  raise;
end;
$function$;
revoke all on function public.run_data_lifecycle_policy(text,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.run_data_lifecycle_policy(text,integer,text) to service_role;

create or replace function public.get_data_lifecycle_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator required' using errcode = '42501'; end if;
  select jsonb_build_object(
    'policies', coalesce(jsonb_agg(jsonb_build_object(
      'policyKey', p.policy_key, 'table', p.source_table,
      'archiveAfterDays', p.archive_after_days, 'deleteAfterDays', p.delete_after_days,
      'disposition', p.disposition, 'evidenceClass', p.evidence_class,
      'lastRun', (select jsonb_build_object('status', r.status, 'startedAt', r.started_at,
        'completedAt', r.completed_at, 'archived', r.rows_archived, 'deleted', r.rows_deleted)
        from public.data_lifecycle_runs r where r.policy_key = p.policy_key
        order by r.started_at desc limit 1)
    ) order by p.policy_key), '[]'::jsonb),
    'activeHolds', (select count(*) from public.data_lifecycle_holds where released_at is null),
    'archiveRows', (select count(*) from app_private.retained_records_archive),
    'generatedAt', now()
  ) into v_result from public.data_lifecycle_policies p where p.is_active;
  return v_result;
end;
$function$;
revoke all on function public.get_data_lifecycle_status() from public, anon;
grant execute on function public.get_data_lifecycle_status() to authenticated;

select cron.unschedule('poll-regulatory-updates-weekly')
where exists (select 1 from cron.job where jobname = 'poll-regulatory-updates-weekly');
select cron.schedule(
  'poll-regulatory-updates-weekly', '17 9 * * 1',
  $$ select net.http_post(
    url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/poll-regulatory-updates',
    headers := jsonb_build_object('Content-Type','application/json','X-Correlation-Id',gen_random_uuid()::text,
      'X-CareMetric-Cron-Secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='cron_shared_secret' limit 1),'')),
    body := '{}'::jsonb
  ); $$
);

select cron.unschedule('run-data-lifecycle-nightly')
where exists (select 1 from cron.job where jobname = 'run-data-lifecycle-nightly');
select cron.schedule(
  'run-data-lifecycle-nightly', '35 7 * * *',
  $$ select net.http_post(
    url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/run-data-lifecycle',
    headers := jsonb_build_object('Content-Type','application/json','X-Correlation-Id',gen_random_uuid()::text,
      'X-CareMetric-Cron-Secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='cron_shared_secret' limit 1),'')),
    body := '{}'::jsonb
  ); $$
);
