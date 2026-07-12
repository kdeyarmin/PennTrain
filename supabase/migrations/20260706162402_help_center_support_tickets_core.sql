-- Help Center support ticketing: a profile opens a ticket, the thread (support_ticket_messages)
-- carries the original request and every reply. FAQ/job-aide content itself lives in frontend
-- code (src/lib/helpCenterContent.ts) -- fixed reference material, not tenant data -- mirroring
-- the existing documentTemplates.ts precedent; only the genuinely dynamic, user-generated
-- ticketing data gets tables.

create table public.support_tickets (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  created_by        uuid not null references public.profiles(id) on delete cascade,
  subject           text not null,
  category          text not null default 'general'
                      constraint support_tickets_category_check
                      check (category in ('general','technical_issue','billing','training_content','account_access','feature_request')),
  priority          text not null default 'normal'
                      constraint support_tickets_priority_check
                      check (priority in ('low','normal','high','urgent')),
  status            text not null default 'open'
                      constraint support_tickets_status_check
                      check (status in ('open','in_progress','resolved','closed')),
  assigned_to       uuid references public.profiles(id) on delete set null,
  last_message_at   timestamptz not null default now(),
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index support_tickets_org_idx on public.support_tickets(organization_id);
create index support_tickets_created_by_idx on public.support_tickets(created_by);
create index support_tickets_status_idx on public.support_tickets(status);
create index support_tickets_assigned_to_idx on public.support_tickets(assigned_to);

create trigger set_updated_at before update on public.support_tickets
  for each row execute function public.set_updated_at();
create trigger audit_log after insert or update or delete on public.support_tickets
  for each row execute function public.audit_log_trigger();

create table public.support_ticket_messages (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null references public.support_tickets(id) on delete cascade,
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  sender_id         uuid not null references public.profiles(id) on delete cascade,
  is_admin_reply    boolean not null default false,
  body              text not null,
  created_at        timestamptz not null default now()
);
create index support_ticket_messages_ticket_idx on public.support_ticket_messages(ticket_id, created_at);

-- Stamps organization_id from the parent ticket and forces is_admin_reply from the sender's
-- *actual* role server-side -- a client can't spoof an "official" admin reply badge by passing
-- is_admin_reply=true in the insert payload (same "never trust client-asserted authority" model
-- as stamp_scope_from_employee_for_attestation elsewhere in this schema).
create or replace function public.stamp_support_ticket_message()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_sender_role text;
begin
  select organization_id into v_org from public.support_tickets where id = new.ticket_id;
  if v_org is null then
    raise exception 'support ticket % not found', new.ticket_id using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := v_org;
  select role into v_sender_role from public.profiles where id = new.sender_id;
  new.is_admin_reply := (v_sender_role = 'platform_admin');
  return new;
end;
$$;
create trigger stamp_scope before insert on public.support_ticket_messages
  for each row execute function public.stamp_support_ticket_message();

-- Keeps the ticket list sortable by recency and auto-promotes a fresh 'open' ticket to
-- 'in_progress' the moment an admin actually replies, without a separate client round-trip.
create or replace function public.touch_support_ticket_on_message()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.support_tickets
  set last_message_at = new.created_at,
      status = case when new.is_admin_reply and status = 'open' then 'in_progress' else status end
  where id = new.ticket_id;
  return new;
end;
$$;
create trigger touch_ticket after insert on public.support_ticket_messages
  for each row execute function public.touch_support_ticket_on_message();

-- Self-service close/reopen for the ticket's own creator, kept as narrow SECURITY DEFINER RPCs
-- (mirrors mark_notification_read) rather than a broad client UPDATE policy, so a requester can
-- only ever flip their own ticket between open/closed -- never touch priority, assignment, or
-- someone else's ticket.
create or replace function public.close_own_support_ticket(p_ticket_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.support_tickets
  set status = 'closed', resolved_at = coalesce(resolved_at, now())
  where id = p_ticket_id and created_by = auth.uid() and status <> 'closed';
end;
$$;
revoke all on function public.close_own_support_ticket(uuid) from public;
grant execute on function public.close_own_support_ticket(uuid) to authenticated;

create or replace function public.reopen_own_support_ticket(p_ticket_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.support_tickets
  set status = 'open', resolved_at = null
  where id = p_ticket_id and created_by = auth.uid() and status in ('resolved','closed');
end;
$$;
revoke all on function public.reopen_own_support_ticket(uuid) from public;
grant execute on function public.reopen_own_support_ticket(uuid) to authenticated;
