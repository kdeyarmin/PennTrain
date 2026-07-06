-- Forward-fix (review finding): escalate_unactioned_alerts() fans out its 5-day unactioned-alert
-- escalation notification to EVERY org_admin/facility_manager in the whole organization, with no
-- facility filter at all -- unlike notify_resident_compliance_alert() (added later, in
-- 20260706090200_resident_compliance_alerts.sql), which correctly scopes its facility_manager
-- fan-out via a facility_assignments join.
--
-- Since resident_compliance_items alerts reuse the pre-existing 'overdue' alert_type for expired
-- RASP/ASP items specifically so they'd ride this same escalation path "for free"
-- (20260706090200's own comment), an overdue compliance item for a Facility-B resident now
-- escalates -- after 5 unactioned days -- to a `notifications` row visible to a facility_manager
-- assigned ONLY to Facility A, with the resident's full name and overdue item baked into the
-- title/body. notifications_select only checks profile_id = auth.uid(), so that manager can read it
-- directly -- learning PII that resident_compliance_items_select/alerts_select explicitly block them
-- from ever querying directly (both require is_assigned_to_facility(facility_id) for
-- facility_manager). The same facility-blind fan-out applies to every other alert type this function
-- escalates (training, practicum, credential, corrective-action, etc.) whenever facility_id is set,
-- not just resident compliance.
--
-- Fix: scope the facility_manager branch to managers actually assigned to the alert's facility_id
-- (org_admin keeps full-org visibility, matching every other alert-visibility policy's shape in this
-- schema); an alert with no facility_id (org-wide) simply reaches no facility_manager, which is the
-- conservative/safe default -- org_admin still gets it either way.
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
        and p.is_active
        and (
          p.role = 'org_admin'
          or (
            p.role = 'facility_manager'
            and v_alert.facility_id is not null
            and exists (
              select 1 from public.facility_assignments fa
              where fa.profile_id = p.id and fa.facility_id = v_alert.facility_id
            )
          )
        )
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
