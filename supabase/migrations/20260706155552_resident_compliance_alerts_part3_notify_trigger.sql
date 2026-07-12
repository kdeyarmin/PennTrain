create or replace function public.notify_resident_compliance_alert()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_profile_id uuid;
begin
  for v_profile_id in
    select p.id
    from public.profiles p
    where p.organization_id = new.organization_id
      and p.is_active
      and p.role = 'org_admin'
    union
    select fa.profile_id
    from public.facility_assignments fa
    join public.profiles p on p.id = fa.profile_id
    where fa.facility_id = new.facility_id
      and p.is_active
      and p.role = 'facility_manager'
  loop
    insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
    values (
      new.organization_id, v_profile_id, 'resident_compliance_due',
      new.title,
      new.message,
      '/app/resident-compliance'
    );
  end loop;
  return new;
end;
$function$;
revoke all on function public.notify_resident_compliance_alert() from public, anon, authenticated;

create trigger notify_resident_compliance_alert after insert on public.alerts
  for each row when (new.resident_compliance_item_id is not null)
  execute function public.notify_resident_compliance_alert();
