-- Multi-channel delivery for critical notifications (END_USER_REVIEW.md recommendation
-- #10 / finding A3).
--
-- Every provider notification funnels through enqueue_preferred_notification_delivery,
-- which picks exactly ONE channel from the recipient's preferred_notification_channel
-- (falling back to the other only when the preferred one is undeliverable) and inserts a
-- single notification_deliveries row. So even a lapsed-clearance or reported-incident
-- alert reaches an aide on only one channel -- if they miss the email, nothing else fires.
--
-- This adds a second, default-off release flag 'notifications.critical_multichannel'. When
-- it is active for an organization, a defined set of CRITICAL notification types fan out to
-- BOTH email and SMS whenever both are deliverable for the recipient (consent and contact
-- details permitting), instead of one. Non-critical types, and every type while the flag is
-- off, keep the existing single-channel behavior exactly -- this ships dark.
--
-- The two deliveries are independent rows (each keeps its own default fallback_group_id),
-- so the existing dispatcher sends both immediately and the fallback/escalation machinery
-- treats them separately. The unique (fallback_group_id, channel) index is unaffected.

insert into public.feature_definitions (feature_key, display_name, description, value_type, default_value)
values (
  'notifications.critical_multichannel',
  'Critical notifications delivered on every channel',
  'When active, critical notification types (lapsed training/credential/certificate/'
    || 'practicum and reported incidents) are delivered on both email and SMS to recipients '
    || 'who have both channels enabled, instead of only their preferred channel.',
  'boolean', 'false'::jsonb
)
on conflict (feature_key) do nothing;

insert into public.release_flags (feature_key, rollout_mode, is_enabled, owner, change_reason)
values (
  'notifications.critical_multichannel', 'off', false, 'notifications',
  'Initial registration; default off per the phased delivery contract'
)
on conflict (feature_key) do nothing;

-- Fan a single notification out to every channel the recipient can actually receive.
-- Mirrors enqueue_preferred_notification_delivery's per-channel deliverability rules, but
-- evaluates email and SMS independently and inserts one row per deliverable channel.
-- Returns the number of deliveries created (0 when the recipient can receive nothing).
create or replace function public.enqueue_critical_notification_delivery(
  p_organization_id uuid,
  p_profile_id uuid,
  p_notification_id uuid,
  p_delivery_type text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_profile public.profiles%rowtype;
  v_settings public.organization_settings%rowtype;
  v_email_ok boolean;
  v_sms_ok boolean;
  v_count integer := 0;
begin
  select * into v_profile from public.profiles
  where id = p_profile_id and organization_id = p_organization_id and is_active;
  select * into v_settings from public.organization_settings
  where organization_id = p_organization_id;
  if v_profile.id is null then return 0; end if;

  v_email_ok := coalesce(v_settings.email_notifications_enabled, false)
    and not v_profile.email_opt_out and v_profile.email is not null;
  v_sms_ok := coalesce(v_settings.sms_notifications_enabled, false)
    and v_profile.sms_opt_in and v_profile.sms_consent_at is not null
    and v_profile.phone is not null;

  -- Neither channel deliverable by the rules above: fall back to the single-channel path,
  -- which applies the same deliverability rules and so also creates nothing here -- but
  -- return its actual result rather than a hard-coded 0, so the documented "number of
  -- deliveries created" contract holds even if the two rule sets ever diverge.
  if not v_email_ok and not v_sms_ok then
    if public.enqueue_preferred_notification_delivery(
      p_organization_id, p_profile_id, p_notification_id, p_delivery_type
    ) is not null then
      return 1;
    end if;
    return 0;
  end if;

  if v_email_ok then
    insert into public.notification_deliveries (
      organization_id, profile_id, notification_id, channel, delivery_type, recipient
    ) values (
      p_organization_id, p_profile_id, p_notification_id, 'email',
      p_delivery_type, v_profile.email
    );
    v_count := v_count + 1;
  end if;
  if v_sms_ok then
    insert into public.notification_deliveries (
      organization_id, profile_id, notification_id, channel, delivery_type, recipient
    ) values (
      p_organization_id, p_profile_id, p_notification_id, 'sms',
      p_delivery_type, v_profile.phone
    );
    v_count := v_count + 1;
  end if;
  return v_count;
end;
$function$;
revoke all on function public.enqueue_critical_notification_delivery(uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- Route critical types through the multi-channel path when the flag is active; everything
-- else (and every type while the flag is off) keeps the exact single-channel behavior.
-- Eligibility is unchanged: legacy types always enqueue; expanded types enqueue only while
-- 'notifications.expanded_delivery_types' is active.
create or replace function public.queue_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_eligible boolean := false;
  v_critical boolean;
begin
  if new.notification_type in (
    'training_due_soon', 'training_expired', 'policy_attestation_due_soon',
    'course_continuation_reminder', 'resident_compliance_due', 'support_ticket_update'
  ) then
    v_eligible := true;
  elsif new.notification_type in (
    'credential_expiring', 'certificate_expiring', 'practicum_due_soon',
    'practicum_expired', 'course_assigned', 'policy_attestation_assigned',
    'incident_reported', 'course_assignment_due_soon'
  ) and app_private.is_feature_release_active(
    new.organization_id, 'notifications.expanded_delivery_types'
  ) then
    v_eligible := true;
  end if;

  if not v_eligible then return new; end if;

  -- Lapsed-obligation and safety-event types: a missed single channel is the real risk.
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
