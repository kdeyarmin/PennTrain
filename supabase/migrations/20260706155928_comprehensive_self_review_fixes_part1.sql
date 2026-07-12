alter policy alerts_select on public.alerts using (
  public.is_platform_admin()
  or (organization_id = (select public.current_org_id())
      and (
        (select public.current_role()) in ('org_admin','auditor')
        or ((select public.current_role()) = 'facility_manager' and public.is_assigned_to_facility(facility_id))
        or (
          (select public.current_role()) = 'trainer'
          and public.is_assigned_to_facility(facility_id)
          and employee_credential_id is null
          and incident_notification_id is null
          and resident_compliance_item_id is null
          and not exists (
            select 1 from public.corrective_actions ca
            where ca.id = alerts.corrective_action_id and ca.incident_id is not null
          )
        )
      ))
);

create or replace function public.queue_notification_delivery()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_settings record;
  v_profile record;
begin
  if new.notification_type not in (
    'training_due_soon', 'training_expired', 'policy_attestation_due_soon', 'course_continuation_reminder',
    'resident_compliance_due'
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

create or replace function public.instantiate_resident_compliance_items(p_resident_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_res record; v_facility_type text; v_admission_track text; v_rule record;
begin
  select id, organization_id, facility_id, admission_date, admission_track into v_res
  from public.residents where id = p_resident_id;
  if v_res.id is null then
    return;
  end if;

  select facility_type into v_facility_type from public.facilities where id = v_res.facility_id;
  v_admission_track := case when v_facility_type = 'ALR' then v_res.admission_track else 'standard' end;

  for v_rule in
    select distinct on (item_type) *
    from public.resident_compliance_rule_packs
    where facility_type = v_facility_type
      and admission_track = v_admission_track
      and state = 'PA'
      and is_active
      and (organization_id = v_res.organization_id or organization_id is null)
    order by item_type, organization_id nulls last
  loop
    insert into public.resident_compliance_items
      (organization_id, facility_id, resident_id, item_type, due_date, renewal_interval_days, warning_days, grace_period_days, citation_topic_id)
    values (
      v_res.organization_id, v_res.facility_id, v_res.id, v_rule.item_type,
      case when v_rule.offset_basis = 'before_admission'
        then v_res.admission_date - v_rule.offset_days
        else v_res.admission_date + v_rule.offset_days
      end,
      v_rule.renewal_interval_days, v_rule.warning_days, v_rule.grace_period_days,
      (select id from public.dhs_citation_topics where citation_ref = v_rule.citation_ref)
    );
  end loop;
end;
$$;
revoke all on function public.instantiate_resident_compliance_items(uuid) from public, anon, authenticated;
