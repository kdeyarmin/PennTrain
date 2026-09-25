-- attach_file_to_support_ticket_message (20260905190000) checked "my own first message on my own
-- open ticket with no attachment yet" and then recorded whatever bucket and path the caller sent.
-- The only validation of attachment_path is stamp_support_ticket_message, a BEFORE INSERT trigger
-- (20260706174030 rated the forged-path condition HIGH for the insert path), so the definer's UPDATE
-- never met it. The storage read policy "support-ticket-attachments read" grants SELECT on any
-- object whose name equals a message's attachment_path when the caller is that message's sender --
-- so a caller could attach '<other org>/<other ticket>/<file>' to their own ticket and sign a URL for
-- another organization's support attachment. The insert-path rule is applied to the update too:
-- the support bucket only, and the path's first two folders must be this ticket's organization and
-- id. The browser already uploads under <org>/<ticket>/ (the storage write policy forces it).
create or replace function public.attach_file_to_support_ticket_message(
  p_ticket_id uuid,
  p_bucket text,
  p_path text,
  p_name text,
  p_type text,
  p_size integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_message_id uuid;
  v_org_id uuid;
  v_updated integer;
begin
  -- The caller's own first message on their own open ticket, and only while it has no attachment.
  -- Anything else is either someone else's thread or a second file on a message that already had
  -- one, and both are refused rather than silently ignored.
  select m.id, t.organization_id into v_message_id, v_org_id
  from public.support_ticket_messages m
  join public.support_tickets t on t.id = m.ticket_id
  where m.ticket_id = p_ticket_id
    and m.sender_id = (select auth.uid())
    and t.created_by = (select auth.uid())
    and t.status <> 'closed'
    and m.attachment_path is null
  order by m.created_at
  limit 1;

  if v_message_id is null then
    raise exception 'No message of yours on this ticket is waiting for an attachment'
      using errcode = 'P0002';
  end if;

  -- The rule stamp_support_ticket_message enforces on INSERT, applied to the UPDATE path: the read
  -- policy trusts attachment_path, so a path outside this ticket's own <organization>/<ticket>
  -- prefix in the support bucket is a signed URL for somebody else's file.
  if p_bucket is distinct from 'support-ticket-attachments'
     or (storage.foldername(p_path))[1] is distinct from v_org_id::text
     or (storage.foldername(p_path))[2] is distinct from p_ticket_id::text then
    raise exception 'attachment path does not belong to this ticket'
      using errcode = 'insufficient_privilege';
  end if;

  update public.support_ticket_messages set
    attachment_bucket = p_bucket,
    attachment_path = p_path,
    attachment_name = p_name,
    attachment_type = p_type,
    attachment_size = p_size
  where id = v_message_id;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Attachment could not be recorded' using errcode = '55000';
  end if;
end;
$function$;
