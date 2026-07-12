-- profiles.phone already existed (general contact number, edited via Users.tsx) before this
-- session added a redundant phone_number column for SMS delivery -- consolidate onto the
-- existing column instead of carrying two phone fields per profile. sms_opt_in/sms_consent_at
-- stay as the dedicated consent-tracking columns paired with it.
alter table public.profiles drop column phone_number;

create or replace function public.queue_notification_delivery()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_settings record;
  v_profile record;
begin
  if new.notification_type not in ('training_due_soon', 'training_expired') then
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
revoke all on function public.queue_notification_delivery() from public, anon, authenticated;

create or replace function public.escalate_unactioned_alerts()
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_alert record; v_admin record;
begin
  for v_alert in
    select a.* from public.alerts a
    where a.status = 'open' and a.escalated_at is null
      and a.alert_type in ('due_7','overdue')
      and a.created_at < now() - interval '5 days'
  loop
    for v_admin in
      select p.id as profile_id, p.email, p.phone, p.sms_opt_in, os.email_notifications_enabled, os.sms_notifications_enabled
      from public.profiles p
      left join public.organization_settings os on os.organization_id = p.organization_id
      where p.organization_id = v_alert.organization_id
        and p.role in ('org_admin','facility_manager')
        and p.is_active
    loop
      insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
      values (
        v_alert.organization_id, v_admin.profile_id, 'training_expired',
        'Unresolved: ' || v_alert.title,
        'This alert has been open for 5+ days without resolution: ' || v_alert.message,
        '/app/alerts'
      );
      if coalesce(v_admin.email_notifications_enabled, false) and v_admin.email is not null then
        insert into public.notification_deliveries (organization_id, profile_id, channel, delivery_type, recipient)
        values (v_alert.organization_id, v_admin.profile_id, 'email', 'escalation', v_admin.email);
      end if;
      if coalesce(v_admin.sms_notifications_enabled, false) and v_admin.sms_opt_in and v_admin.phone is not null then
        insert into public.notification_deliveries (organization_id, profile_id, channel, delivery_type, recipient)
        values (v_alert.organization_id, v_admin.profile_id, 'sms', 'escalation', v_admin.phone);
      end if;
    end loop;
    update public.alerts set escalated_at = now() where id = v_alert.id;
  end loop;
end;
$function$;
revoke all on function public.escalate_unactioned_alerts() from public, anon, authenticated;

create or replace function public.send_monday_digest()
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_admin record; v_due_soon int; v_expired int; v_critical_alerts int;
begin
  for v_admin in
    select p.id as profile_id, p.organization_id, p.email, p.phone, p.sms_opt_in,
           os.email_notifications_enabled, os.sms_notifications_enabled
    from public.profiles p
    left join public.organization_settings os on os.organization_id = p.organization_id
    where p.role in ('org_admin','facility_manager') and p.is_active
  loop
    select count(*) filter (where r.status = 'due_soon'),
           count(*) filter (where r.status = 'expired')
      into v_due_soon, v_expired
      from public.employee_training_records r
      where r.organization_id = v_admin.organization_id;

    select count(*) into v_critical_alerts
      from public.alerts a
      where a.organization_id = v_admin.organization_id and a.status = 'open' and a.severity = 'critical';

    if v_due_soon = 0 and v_expired = 0 and v_critical_alerts = 0 then
      continue;
    end if;

    insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
    values (
      v_admin.organization_id, v_admin.profile_id, 'training_due_soon',
      'Weekly compliance digest',
      v_expired || ' expired, ' || v_due_soon || ' due soon, ' || v_critical_alerts || ' critical alert(s) open.',
      '/app'
    );
    if coalesce(v_admin.email_notifications_enabled, false) and v_admin.email is not null then
      insert into public.notification_deliveries (organization_id, profile_id, channel, delivery_type, recipient)
      values (v_admin.organization_id, v_admin.profile_id, 'email', 'digest', v_admin.email);
    end if;
    if coalesce(v_admin.sms_notifications_enabled, false) and v_admin.sms_opt_in and v_admin.phone is not null then
      insert into public.notification_deliveries (organization_id, profile_id, channel, delivery_type, recipient)
      values (v_admin.organization_id, v_admin.profile_id, 'sms', 'digest', v_admin.phone);
    end if;
  end loop;
end;
$function$;
revoke all on function public.send_monday_digest() from public, anon, authenticated;
