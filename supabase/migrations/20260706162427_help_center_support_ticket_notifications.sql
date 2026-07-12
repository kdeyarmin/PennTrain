alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in (
    'course_assigned', 'quiz_graded', 'certificate_issued',
    'training_due_soon', 'training_expired', 'competency_recorded',
    'missing_document', 'certificate_expiring', 'practicum_due_soon', 'practicum_expired',
    'credential_expiring', 'incident_reported', 'policy_attestation_assigned',
    'policy_attestation_due_soon', 'course_continuation_reminder', 'resident_compliance_due',
    'support_ticket_update'
  ));

-- Only the admin -> requester direction is notified (a requester's own message to their own
-- ticket needs no notification). Link is role-aware since the requester's Help Center lives at
-- /app/help for org/trainer/auditor roles but /me/help for employees.
create or replace function public.notify_support_ticket_message()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_org uuid; v_creator uuid; v_creator_role text;
begin
  if not new.is_admin_reply then
    return new;
  end if;
  select organization_id, created_by into v_org, v_creator
    from public.support_tickets where id = new.ticket_id;
  if v_creator is null then return new; end if;
  select role into v_creator_role from public.profiles where id = v_creator;
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  values (
    v_org, v_creator, 'support_ticket_update',
    'New reply on your support ticket',
    left(new.body, 140),
    (case when v_creator_role = 'employee' then '/me/help/tickets/' else '/app/help/tickets/' end) || new.ticket_id
  );
  return new;
end;
$function$;
create trigger notify_support_ticket_message after insert on public.support_ticket_messages
  for each row execute function public.notify_support_ticket_message();

-- Skips self-notification: the requester's own close/reopen call (or, in principle, any future
-- requester-initiated status change) shouldn't notify them about their own action -- only a
-- status change made by someone else (platform_admin) is news to them.
create or replace function public.notify_support_ticket_status_change()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_creator_role text;
begin
  if new.status = old.status or auth.uid() = new.created_by then return new; end if;
  select role into v_creator_role from public.profiles where id = new.created_by;
  insert into public.notifications (organization_id, profile_id, notification_type, title, body, link)
  values (
    new.organization_id, new.created_by, 'support_ticket_update',
    'Your support ticket status changed',
    new.subject || ' is now ' || replace(new.status, '_', ' '),
    (case when v_creator_role = 'employee' then '/me/help/tickets/' else '/app/help/tickets/' end) || new.id
  );
  return new;
end;
$function$;
create trigger notify_support_ticket_status_change after update on public.support_tickets
  for each row
  when (old.status is distinct from new.status)
  execute function public.notify_support_ticket_status_change();
