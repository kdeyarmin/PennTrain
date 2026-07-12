-- Fixes from an adversarial review of the just-added support-ticketing feature (see
-- 20260706162402/162413/162427_help_center_support_ticket*.sql):
--
-- 1. stamp_support_ticket_message() previously raised a distinct "ticket not found" exception
--    (23503) purely from an unfiltered, security-definer existence check, before the
--    support_ticket_messages_insert RLS policy's own "is this actually your ticket" check ever
--    ran (which instead rejects with the generic 42501 "row violates row-level security policy").
--    A non-admin could tell the two errors apart, using an insert attempt as a 1-bit oracle for
--    "does this ticket id exist in some OTHER organization's queue" -- information RLS is
--    otherwise supposed to fully hide. Fixed by folding the same ownership check into the
--    trigger itself and raising the identical error for both "no such ticket" and "ticket exists
--    but you have no access to it" -- indistinguishable from the caller's side either way.
--
-- 2. touch_support_ticket_on_message()'s automatic open->in_progress promotion on an admin's
--    first reply fired notify_support_ticket_status_change as a side effect, which duplicated the
--    "new reply" notification notify_support_ticket_message had just sent for the exact same
--    event (its self-notification skip only covers the ticket owner's own close/reopen RPCs,
--    since auth.uid() during this cascade is still the *admin's* uid, not the requester's). Fixed
--    with a transaction-local GUC the promotion sets and the status-change notifier checks (and
--    clears), so only a genuine standalone admin status change still notifies.

create or replace function public.stamp_support_ticket_message()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_owner uuid; v_sender_role text;
begin
  select organization_id, created_by into v_org, v_owner from public.support_tickets where id = new.ticket_id;
  select role into v_sender_role from public.profiles where id = new.sender_id;

  if v_org is null or (coalesce(v_sender_role, '') <> 'platform_admin' and v_owner <> new.sender_id) then
    raise exception 'support ticket not found' using errcode = 'foreign_key_violation';
  end if;

  new.organization_id := v_org;
  new.is_admin_reply := (v_sender_role = 'platform_admin');
  return new;
end;
$$;

create or replace function public.touch_support_ticket_on_message()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform set_config('app.suppress_ticket_status_notification', 'true', true);
  update public.support_tickets
  set last_message_at = new.created_at,
      status = case when new.is_admin_reply and status = 'open' then 'in_progress' else status end
  where id = new.ticket_id;
  return new;
end;
$$;

create or replace function public.notify_support_ticket_status_change()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_creator_role text; v_suppress text;
begin
  if new.status = old.status or auth.uid() = new.created_by then return new; end if;

  v_suppress := current_setting('app.suppress_ticket_status_notification', true);
  perform set_config('app.suppress_ticket_status_notification', 'false', true);
  if v_suppress = 'true' then return new; end if;

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
