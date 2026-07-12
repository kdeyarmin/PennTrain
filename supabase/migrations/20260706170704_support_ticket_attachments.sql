-- Optional single attachment per support_ticket_messages row. Nullable/all-or-none rather than a
-- separate attachments table -- a ticket reply carries at most one file, so this mirrors how
-- policy_document_versions embeds its storage_* columns directly on the row rather than through a
-- join table.
alter table public.support_ticket_messages
  add column attachment_bucket text,
  add column attachment_path text,
  add column attachment_name text,
  add column attachment_type text,
  add column attachment_size integer;

insert into storage.buckets (id, name, public) values ('support-ticket-attachments', 'support-ticket-attachments', false)
on conflict (id) do nothing;

-- Path convention: `${organizationId}/${ticketId}/${uuid}-${filename}` -- tickets aren't
-- facility-scoped (no facility_id column), so this is the org-documents-bucket shape
-- (policy-documents), not the org/facility two-segment shape incident-/credential-documents use.
--
-- READ reverse-joins to support_ticket_messages + support_tickets (ownership here is "you're the
-- sender or the ticket's creator or platform_admin", not an org-role rule expressible from the
-- path alone -- the same reason credential-documents' read policy reverse-joins instead of using
-- the plain foldername convention).
create policy "support-ticket-attachments read" on storage.objects for select to authenticated using (
  bucket_id = 'support-ticket-attachments'
  and exists (
    select 1 from public.support_ticket_messages m
    join public.support_tickets t on t.id = m.ticket_id
    where m.attachment_bucket = storage.objects.bucket_id
      and m.attachment_path = storage.objects.name
      and (
        public.is_platform_admin()
        or m.sender_id = (select auth.uid())
        or t.created_by = (select auth.uid())
      )
  )
);

-- WRITE happens before the support_ticket_messages row exists (the file uploads first, then the
-- message insert references its path), so there's nothing to reverse-join to yet -- same problem
-- credential-documents' write policy has, solved the same way: fall back to a foldername check
-- against the *ticket* (which does already exist), mirroring exactly who support_ticket_messages
-- itself lets post right now (ticket owner on a non-closed ticket, or platform_admin anytime).
create policy "support-ticket-attachments write" on storage.objects for insert to authenticated with check (
  bucket_id = 'support-ticket-attachments'
  and exists (
    select 1 from public.support_tickets t
    where t.id = ((storage.foldername(name))[2])::uuid
      and (
        public.is_platform_admin()
        or (t.created_by = (select auth.uid()) and t.status <> 'closed')
      )
  )
);
