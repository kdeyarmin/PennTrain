-- Codex review finding (P2): current_role()/current_org_id()/is_platform_admin()/
-- is_assigned_to_facility()/owns_employee() all treat a deactivated profile (is_active=false) as
-- having no role/org/ownership at all (20260704164627_fix_codex_review_findings.sql), specifically
-- because deactivating a user does not revoke their existing Supabase Auth session/JWT -- so RLS,
-- not session expiry, is what's supposed to lock a deactivated user out immediately. The new
-- support_tickets/support_ticket_messages/support-ticket-attachments owner checks compare directly
-- against auth.uid() instead of going through one of those gated helpers, so a deactivated
-- requester with a still-valid session could keep reading (and messaging into, and downloading
-- attachments from) their own old tickets. Fixed by adding a small reusable
-- current_profile_active() helper (same pattern/grant as the existing helpers) and requiring it on
-- every non-admin owner branch. support_tickets_insert is untouched -- it already implicitly
-- requires current_org_id(), which itself already returns null for an inactive profile.

create or replace function public.current_profile_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;
revoke all on function public.current_profile_active() from public, anon, authenticated;
grant execute on function public.current_profile_active() to authenticated;

drop policy support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets
  for select to authenticated
  using (public.is_platform_admin() or (created_by = (select auth.uid()) and public.current_profile_active()));

drop policy support_ticket_messages_select on public.support_ticket_messages;
create policy support_ticket_messages_select on public.support_ticket_messages
  for select to authenticated
  using (
    public.is_platform_admin()
    or (
      public.current_profile_active()
      and exists (
        select 1 from public.support_tickets t
        where t.id = support_ticket_messages.ticket_id and t.created_by = (select auth.uid())
      )
    )
  );

drop policy support_ticket_messages_insert on public.support_ticket_messages;
create policy support_ticket_messages_insert on public.support_ticket_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (
      public.is_platform_admin()
      or (
        public.current_profile_active()
        and exists (
          select 1 from public.support_tickets t
          where t.id = support_ticket_messages.ticket_id
            and t.created_by = (select auth.uid())
            and t.status <> 'closed'
        )
      )
    )
  );

drop policy "support-ticket-attachments read" on storage.objects;
create policy "support-ticket-attachments read" on storage.objects for select to authenticated using (
  bucket_id = 'support-ticket-attachments'
  and exists (
    select 1 from public.support_ticket_messages m
    join public.support_tickets t on t.id = m.ticket_id
    where m.attachment_bucket = storage.objects.bucket_id
      and m.attachment_path = storage.objects.name
      and (
        public.is_platform_admin()
        or (public.current_profile_active() and (m.sender_id = (select auth.uid()) or t.created_by = (select auth.uid())))
      )
  )
);

drop policy "support-ticket-attachments write" on storage.objects;
create policy "support-ticket-attachments write" on storage.objects for insert to authenticated with check (
  bucket_id = 'support-ticket-attachments'
  and exists (
    select 1 from public.support_tickets t
    where t.id = ((storage.foldername(name))[2])::uuid
      and (storage.foldername(name))[1] = t.organization_id::text
      and (
        public.is_platform_admin()
        or (public.current_profile_active() and t.created_by = (select auth.uid()) and t.status <> 'closed')
      )
  )
);

create or replace function public.close_own_support_ticket(p_ticket_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.support_tickets
  set status = 'closed', resolved_at = coalesce(resolved_at, now())
  where id = p_ticket_id and created_by = auth.uid() and public.current_profile_active() and status <> 'closed';
end;
$$;

create or replace function public.reopen_own_support_ticket(p_ticket_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.support_tickets
  set status = 'open', resolved_at = null
  where id = p_ticket_id and created_by = auth.uid() and public.current_profile_active() and status in ('resolved','closed');
end;
$$;
