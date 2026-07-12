alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

-- Every profile sees only tickets they opened; platform_admin (the "super admin portal" ticket
-- queue) sees everything cross-org. There is no org_admin/facility_manager cross-employee
-- visibility here -- unlike alerts/incidents, a support ticket is a conversation between one
-- requester and the platform, not an org-management artifact.
create policy support_tickets_select on public.support_tickets
  for select to authenticated
  using (public.is_platform_admin() or created_by = (select auth.uid()));

create policy support_tickets_insert on public.support_tickets
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and organization_id = (select public.current_org_id())
  );

-- Status/priority/assignment changes are platform_admin-only via direct UPDATE; the ticket
-- owner's own close/reopen goes through the narrow RPCs above instead (see core migration).
create policy support_tickets_update on public.support_tickets
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy support_ticket_messages_select on public.support_ticket_messages
  for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.support_tickets t
      where t.id = support_ticket_messages.ticket_id and t.created_by = (select auth.uid())
    )
  );

-- A non-admin can only post into their own ticket, and only while it isn't closed (reopen first
-- via reopen_own_support_ticket). platform_admin can always reply, including to close it out.
create policy support_ticket_messages_insert on public.support_ticket_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (
      public.is_platform_admin()
      or exists (
        select 1 from public.support_tickets t
        where t.id = support_ticket_messages.ticket_id
          and t.created_by = (select auth.uid())
          and t.status <> 'closed'
      )
    )
  );
