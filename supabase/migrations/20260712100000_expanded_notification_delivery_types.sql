-- Expanded notification delivery types (default-off).
--
-- Extends email/SMS provider fan-out beyond the six legacy notification types to the
-- assignment/expiry/incident types that previously only ever reached the in-app feed:
-- credential_expiring, certificate_expiring, practicum_due_soon, practicum_expired,
-- course_assigned, policy_attestation_assigned, incident_reported.
--
-- The new types are gated behind the release flag 'notifications.expanded_delivery_types'
-- (default off, per the delivery contract in IMPLEMENTATION_PLAN.md) with an independent
-- kill switch via feature_kill_switches; operate both through the existing platform-admin
-- AAL2 RPCs set_release_flag / set_feature_kill_switch. The six legacy types keep flowing
-- unconditionally exactly as before.
--
-- No retro-delivery: the gate lives in the AFTER INSERT trigger on public.notifications,
-- so notifications inserted before the flag is enabled are never delivered retroactively.

-- ---------------------------------------------------------------------------
-- Feature registration (explicit default-off flag row so operators can see it)
-- ---------------------------------------------------------------------------

insert into public.feature_definitions (
  feature_key, display_name, description, value_type, default_value
) values (
  'notifications.expanded_delivery_types',
  'Expanded notification delivery types',
  'Email/SMS provider delivery for assignment, credential, certificate, practicum, and incident notifications',
  'boolean', 'false'::jsonb
)
on conflict (feature_key) do nothing;

insert into public.release_flags (
  feature_key, rollout_mode, is_enabled, owner, change_reason
) values (
  'notifications.expanded_delivery_types', 'off', false, 'notifications',
  'Initial registration; default off per the phased delivery contract'
)
on conflict (feature_key) do nothing;

-- ---------------------------------------------------------------------------
-- Lightweight release gate for per-row trigger use
-- ---------------------------------------------------------------------------

-- evaluate_feature_access() also resolves billable entitlements and builds jsonb, which is
-- both too heavy for an AFTER INSERT trigger fired by nightly recalc bursts and semantically
-- wrong here (this capability is not entitlement-gated). This helper checks only: release
-- flag enabled and unexpired, rollout global or the org is in an active cohort for the
-- feature, and no unexpired global/org kill switch. Lives in app_private because it is only
-- callable from security-definer trigger functions, never from clients.
create or replace function app_private.is_feature_release_active(
  p_organization_id uuid,
  p_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.release_flags r
    where r.feature_key = p_feature_key
      and r.is_enabled
      and (r.expires_at is null or r.expires_at > now())
      and (
        r.rollout_mode = 'global'
        or (
          r.rollout_mode = 'cohort'
          and exists (
            select 1
            from public.organization_release_cohorts a
            join public.release_cohorts c on c.id = a.cohort_id
            where a.organization_id = p_organization_id
              and a.feature_key = p_feature_key
              and c.is_active
              and (c.starts_at is null or c.starts_at <= now())
              and (c.ends_at is null or c.ends_at > now())
              and (a.expires_at is null or a.expires_at > now())
          )
        )
      )
  )
  and not exists (
    select 1
    from public.feature_kill_switches k
    where k.feature_key = p_feature_key
      and k.is_disabled
      and (k.organization_id is null or k.organization_id = p_organization_id)
      and (k.expires_at is null or k.expires_at > now())
  );
$$;
revoke all on function app_private.is_feature_release_active(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fan-out trigger: legacy list unchanged and checked first (the release gate
-- is never evaluated for legacy types), new types behind the flag
-- ---------------------------------------------------------------------------

create or replace function public.queue_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.notification_type in (
    'training_due_soon', 'training_expired', 'policy_attestation_due_soon',
    'course_continuation_reminder', 'resident_compliance_due', 'support_ticket_update'
  ) then
    perform public.enqueue_preferred_notification_delivery(
      new.organization_id, new.profile_id, new.id, 'alert'
    );
  elsif new.notification_type in (
    'credential_expiring', 'certificate_expiring', 'practicum_due_soon',
    'practicum_expired', 'course_assigned', 'policy_attestation_assigned',
    'incident_reported'
  ) and app_private.is_feature_release_active(
    new.organization_id, 'notifications.expanded_delivery_types'
  ) then
    perform public.enqueue_preferred_notification_delivery(
      new.organization_id, new.profile_id, new.id, 'alert'
    );
  end if;
  return new;
end;
$function$;
revoke all on function public.queue_notification_delivery()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Global templates for the new types that warrant specific copy.
--
-- Like the existing global defaults, these deliberately interpolate no notification
-- free text (allowed_variables stays empty). incident_reported gets both channels so
-- incident details never leave the app; course_assigned / policy_attestation_assigned
-- get an actionable email subject and fall back to the generic default for SMS. The
-- credential/certificate/practicum expiry types intentionally resolve to the seeded
-- 'default' templates.
-- ---------------------------------------------------------------------------

insert into public.notification_templates (
  organization_id, template_key, channel, version, status,
  subject_template, body_template, allowed_variables, activated_at
) values
  (null, 'incident_reported', 'email', 1, 'active',
   'A new incident report requires review',
   'A new incident report was submitted. Sign in to CareMetric Train to review it securely.',
   '{}'::text[], now()),
  (null, 'incident_reported', 'sms', 1, 'active',
   'CareMetric Train',
   'A new incident report requires review. Sign in to review it securely.',
   '{}'::text[], now()),
  (null, 'course_assigned', 'email', 1, 'active',
   'You have a new training assignment',
   'A new training course was assigned to you. Sign in to CareMetric Train to see your assignment and its due date.',
   '{}'::text[], now()),
  (null, 'policy_attestation_assigned', 'email', 1, 'active',
   'A policy requires your attestation',
   'A policy attestation was assigned to you. Sign in to CareMetric Train to review and sign it securely.',
   '{}'::text[], now());
