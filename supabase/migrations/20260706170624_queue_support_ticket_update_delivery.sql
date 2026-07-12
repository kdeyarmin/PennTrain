-- Opts 'support_ticket_update' into the existing email/SMS delivery pipeline (notification_deliveries
-- + dispatch-notifications, cron-polled every 15 minutes) -- same pattern as every prior addition to
-- this allowlist (policy_attestation_due_soon, course_continuation_reminder, resident_compliance_due):
-- a full create-or-replace body copy with one more type added to the "not in (...)" gate. Both the
-- "new reply" and "status changed" triggers insert this same notification_type, so both now get
-- emailed identically -- there's no finer-grained sub-type to gate on separately.
create or replace function public.queue_notification_delivery()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_settings record;
  v_profile record;
begin
  if new.notification_type not in (
    'training_due_soon', 'training_expired', 'policy_attestation_due_soon', 'course_continuation_reminder',
    'resident_compliance_due', 'support_ticket_update'
  ) then
    return new;
  end if;

  select email_notifications_enabled, sms_notifications_enabled
    into v_settings
    from public.organization_settings where organization_id = new.organization_id;

  select email, phone, sms_opt_in, is_active into v_profile
    from public.profiles where id = new.profile_id;

  if v_profile is null or not v_profile.is_active then
    return new;
  end if;

  if coalesce(v_settings.email_notifications_enabled, false) and v_profile.email is not null then
    insert into public.notification_deliveries (organization_id, profile_id, notification_id, channel, delivery_type, recipient)
    values (new.organization_id, new.profile_id, new.id, 'email', 'alert', v_profile.email);
  end if;

  if coalesce(v_settings.sms_notifications_enabled, false) and v_profile.sms_opt_in and v_profile.phone is not null then
    insert into public.notification_deliveries (organization_id, profile_id, notification_id, channel, delivery_type, recipient)
    values (new.organization_id, new.profile_id, new.id, 'sms', 'alert', v_profile.phone);
  end if;

  return new;
end;
$function$;
