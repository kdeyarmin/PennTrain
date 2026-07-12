-- Copilot review finding: v_settings is declared as a bare `record`, and `select ... into v_settings`
-- leaves it genuinely unassigned (not just NULL-valued) when an organization has no
-- organization_settings row -- any later reference to v_settings.<field> then raises "record
-- \"v_settings\" is not assigned yet". Confirmed exploitable today: 2 existing organizations have no
-- organization_settings row, so any notification for those orgs (of any of the six allow-listed
-- types, not just support_ticket_update) would currently crash this trigger instead of just skipping
-- delivery. Fixed by selecting into two plain boolean variables instead of a record -- a no-rows
-- SELECT INTO leaves plain scalar variables at their default (null), which coalesce(..., false)
-- handles correctly, unlike a bare record.
create or replace function public.queue_notification_delivery()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_email_enabled boolean;
  v_sms_enabled boolean;
  v_profile record;
begin
  if new.notification_type not in (
    'training_due_soon', 'training_expired', 'policy_attestation_due_soon', 'course_continuation_reminder',
    'resident_compliance_due', 'support_ticket_update'
  ) then
    return new;
  end if;

  select email_notifications_enabled, sms_notifications_enabled
    into v_email_enabled, v_sms_enabled
    from public.organization_settings where organization_id = new.organization_id;

  select email, phone, sms_opt_in, is_active into v_profile
    from public.profiles where id = new.profile_id;

  if v_profile is null or not v_profile.is_active then
    return new;
  end if;

  if coalesce(v_email_enabled, false) and v_profile.email is not null then
    insert into public.notification_deliveries (organization_id, profile_id, notification_id, channel, delivery_type, recipient)
    values (new.organization_id, new.profile_id, new.id, 'email', 'alert', v_profile.email);
  end if;

  if coalesce(v_sms_enabled, false) and v_profile.sms_opt_in and v_profile.phone is not null then
    insert into public.notification_deliveries (organization_id, profile_id, notification_id, channel, delivery_type, recipient)
    values (new.organization_id, new.profile_id, new.id, 'sms', 'alert', v_profile.phone);
  end if;

  return new;
end;
$function$;
