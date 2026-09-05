-- A compensating delete against a table with no delete grant (I19).
--
-- Creating a support ticket is two inserts: the ticket, then its first message. Each carries its
-- own RLS, and the client wrapped them in a try/catch whose catch does
-- `supabase.from("support_tickets").delete().eq("id", ticket.id)` -- a compensating rollback, with
-- the return value not read.
--
-- `support_tickets` has no DELETE policy and no DELETE grant to `authenticated`. That statement has
-- never removed a row and never could. So a failed first message -- a rejected attachment upload,
-- a dropped connection between the two calls, a message that trips its own insert policy -- left a
-- subject-only ticket sitting in the platform support queue with nothing in it, the UI reported a
-- failure, and the obvious retry created a second one. Support sees two empty tickets and one
-- customer who says they could not file anything.
--
-- Fixed by not needing a rollback: one SECURITY DEFINER function inserts both rows in one
-- transaction, so either the ticket and its message exist together or neither does. It restates
-- the two RLS policies it stands in for rather than assuming them -- created_by is the caller,
-- organization_id is the caller's own, and the profile must be active -- because a definer that
-- takes its scope from its arguments is how tenant boundaries get crossed.
--
-- The attachment stays a separate step, and has to: the storage write policy for
-- support-ticket-attachments reverse-joins to support_tickets on the second path segment, so the
-- ticket must already exist before the file can be uploaded. What changes is what a failure there
-- costs. Before, it took the whole ticket down (or rather, failed to). Now the ticket and its
-- message are already saved, and only the file is missing -- which the client can report, and the
-- reader can see, without anything being orphaned.

create or replace function public.create_support_ticket_with_message(
  p_subject text,
  p_category text,
  p_priority text,
  p_body text
)
returns public.support_tickets
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_ticket public.support_tickets%rowtype;
begin
  select * into v_profile from public.profiles where id = (select auth.uid());
  if not found or not v_profile.is_active or v_profile.organization_id is null then
    raise exception 'An active profile in an organization is required to open a support ticket'
      using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_subject, ''))) < 3 then
    raise exception 'A subject is required' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_body, ''))) < 1 then
    raise exception 'A message is required -- a ticket with no description cannot be worked'
      using errcode = '22023';
  end if;

  -- Both defaults match the column defaults; the CHECK constraints reject anything else, which is
  -- the same answer the direct insert used to give.
  insert into public.support_tickets (organization_id, created_by, subject, category, priority)
  values (
    v_profile.organization_id, v_profile.id, btrim(p_subject),
    coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'general'),
    coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'normal')
  )
  returning * into v_ticket;

  -- stamp_support_ticket_message overwrites organization_id and sender_id from the ticket and the
  -- caller, and touch_support_ticket_on_message advances last_message_at; both still fire here.
  insert into public.support_ticket_messages (ticket_id, organization_id, sender_id, body)
  values (v_ticket.id, v_ticket.organization_id, v_profile.id, p_body);

  return v_ticket;
end;
$function$;

comment on function public.create_support_ticket_with_message(text, text, text, text) is
  'Opens a support ticket and its first message in one transaction. Replaces a client-side '
  'compensating delete that could never run: support_tickets has no DELETE policy or grant, so a '
  'failed first message left an empty ticket in the platform queue. BACKLOG.md I19.';

revoke all on function public.create_support_ticket_with_message(text, text, text, text)
  from public, anon;
grant execute on function public.create_support_ticket_with_message(text, text, text, text)
  to authenticated;

-- The attachment, once the file is in storage. Separate because the bucket's write policy needs
-- the ticket to exist first; narrow because this is the only way a message row is ever updated
-- (support_ticket_messages has no UPDATE policy at all, deliberately -- a support thread is a
-- record of what was said).
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
  v_updated integer;
begin
  -- The caller's own first message on their own open ticket, and only while it has no attachment.
  -- Anything else is either someone else's thread or a second file on a message that already had
  -- one, and both are refused rather than silently ignored.
  select m.id into v_message_id
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

comment on function public.attach_file_to_support_ticket_message(uuid, text, text, text, text, integer) is
  'Records an uploaded attachment on the caller''s first message of their own open ticket. The '
  'file has to be uploaded after the ticket exists (the bucket policy reverse-joins to it), so '
  'this is the second half of that sequence. BACKLOG.md I19.';

revoke all on function public.attach_file_to_support_ticket_message(uuid, text, text, text, text, integer)
  from public, anon;
grant execute on function public.attach_file_to_support_ticket_message(uuid, text, text, text, text, integer)
  to authenticated;
