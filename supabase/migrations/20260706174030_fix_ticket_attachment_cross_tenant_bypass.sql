-- Adversarial review finding (HIGH): the support-ticket-attachments storage READ policy reverse-joins
-- on support_ticket_messages.attachment_bucket/attachment_path -- columns a client can set to *any*
-- value on their own message row (support_ticket_messages_insert RLS never inspects them). A user could
-- insert a message on their own ticket with attachment_path forged to point at another org's/user's real
-- attachment, and the read policy would grant them a signed URL for it purely via their own
-- sender_id/ticket-ownership match, with zero verification the path was ever actually uploaded under that
-- ticket. Fixed by validating, in the same trigger that already stamps organization_id/is_admin_reply,
-- that a supplied attachment_path's ticket-id path segment (convention:
-- ${organizationId}/${ticketId}/${uuid}-${filename}) actually matches this row's own ticket_id -- a
-- message can now only ever reference an attachment uploaded under its own ticket.
--
-- Also closes a lower-severity companion finding: the write policy validated the ticket-id path segment
-- but never the organization-id segment, unlike every sibling bucket (policy-documents,
-- credential-documents) -- brought in line for consistency, though it granted no actual cross-tenant
-- access on its own (the read policy never trusted path segments to begin with).

create or replace function public.stamp_support_ticket_message()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_owner uuid; v_sender_role text;
begin
  select organization_id, created_by into v_org, v_owner from public.support_tickets where id = new.ticket_id;
  select role into v_sender_role from public.profiles where id = new.sender_id;

  if v_org is null or (coalesce(v_sender_role, '') <> 'platform_admin' and v_owner <> new.sender_id) then
    raise exception 'support ticket not found' using errcode = 'foreign_key_violation';
  end if;

  if new.attachment_path is not null
     and (storage.foldername(new.attachment_path))[2] is distinct from new.ticket_id::text then
    raise exception 'attachment path does not belong to this ticket' using errcode = 'insufficient_privilege';
  end if;

  new.organization_id := v_org;
  new.is_admin_reply := (v_sender_role = 'platform_admin');
  return new;
end;
$$;

drop policy "support-ticket-attachments write" on storage.objects;
create policy "support-ticket-attachments write" on storage.objects for insert to authenticated with check (
  bucket_id = 'support-ticket-attachments'
  and exists (
    select 1 from public.support_tickets t
    where t.id = ((storage.foldername(name))[2])::uuid
      and (storage.foldername(name))[1] = t.organization_id::text
      and (
        public.is_platform_admin()
        or (t.created_by = (select auth.uid()) and t.status <> 'closed')
      )
  )
);
