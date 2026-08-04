-- New orders coming back from hospital could be raised but never acknowledged.
--
-- `complete_hospital_return` writes `changed_order_ack_status`, and the only value the return dialog
-- can produce for an episode that brought orders back is `'pending_review'` -- it is also the column
-- default. `complete_hospital_return_reconciliation` then refuses to close:
--
--     if v.changed_order_ack_status not in ('acknowledged', 'not_applicable') then
--
-- and nothing anywhere writes `'acknowledged'` for a hospital episode. No RPC, no trigger, no job.
-- So every return recorded with new orders -- the clinically significant kind -- left a
-- reconciliation that could never be closed, and a resident record permanently mid-workflow.
--
-- This is the same gap `acknowledge_appointment_new_order` closes for appointments (20260804110000),
-- and it is closed the same way, deliberately: an order nobody acknowledged is an order nobody is
-- carrying out, so acknowledgement is a named act by a named person that says what changed.
--
-- The three columns are new. The appointment table already carries its equivalents
-- (`new_order_ack_at` / `_by` / `_note`); the episode table recorded only the status, which cannot
-- answer "who accepted these orders, when, and what did they change?" -- the question a surveyor
-- asks about exactly this record.

alter table public.hospital_transfer_episodes
  add column if not exists changed_order_ack_at timestamptz,
  add column if not exists changed_order_ack_by uuid references public.profiles(id),
  add column if not exists changed_order_ack_note text;

comment on column public.hospital_transfer_episodes.changed_order_ack_note is
  'What the returning orders were and what was changed to carry them out. Required by '
  'acknowledge_hospital_return_new_order; "acknowledged" with no account of the change is the '
  'endpoint this column exists to prevent.';

create or replace function public.acknowledge_hospital_return_new_order(
  p_episode_id uuid,
  p_note text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.hospital_transfer_episodes%rowtype;
begin
  select * into v from public.hospital_transfer_episodes where id = p_episode_id for update;
  if not found then raise exception 'Transfer episode not found' using errcode = 'P0002'; end if;
  perform app_private.assert_resident_care_manager(v.organization_id, v.facility_id);

  if v.changed_order_ack_status <> 'pending_review' then
    raise exception 'This episode has no new orders awaiting acknowledgement' using errcode = '22023';
  end if;
  -- The note is what the acknowledgement is for: which order, and what changed as a result.
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Say what the new orders were and what was changed to carry them out'
      using errcode = '22023';
  end if;

  update public.hospital_transfer_episodes set
    changed_order_ack_status = 'acknowledged',
    changed_order_ack_at = now(),
    changed_order_ack_by = auth.uid(),
    changed_order_ack_note = btrim(p_note),
    updated_at = now()
  where id = v.id;

  insert into public.audit_logs(
    organization_id, actor_profile_id, entity_type, entity_id, action, old_values, new_values)
  values (v.organization_id, auth.uid(), 'hospital_transfer_episode', v.id::text,
    'hospital_return.new_order_acknowledged',
    jsonb_build_object('status', v.changed_order_ack_status),
    jsonb_build_object('status', 'acknowledged', 'note', btrim(p_note)));
  return true;
end $$;

revoke all on function public.acknowledge_hospital_return_new_order(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_hospital_return_new_order(uuid, text)
  to authenticated;
