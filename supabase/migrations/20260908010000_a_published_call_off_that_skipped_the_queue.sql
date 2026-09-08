-- A published shift marked Called Off from the grid skipped the only producer of the
-- open-shift queue. `record_shift_call_off` files the absence, opens the unfilled-shift
-- work item, and posts `open_shift_opportunities` (BACKLOG J73). The manager status
-- dropdown -- left open after publication as the post-publish control (J70) -- wrote
-- `shift_assignments.status` directly, so coverage vanished and the claim cards stayed
-- empty. A draft may still be marked called_off as a planning mark: nobody has been
-- shown those shifts, and the RPC would open a work item for a hole that is not live.
--
-- HOW A DIRECT WRITE IS TOLD APART FROM THE RPC. The same discriminator as
-- `protect_incident_workflow_columns`: inside the SECURITY DEFINER RPC `current_user`
-- is the owner, a PostgREST PATCH is `authenticated`. This trigger is INVOKER on
-- purpose -- a definer would rewrite current_user and the guard would never fire.

create or replace function public.protect_shift_assignment_call_off()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_schedule_status text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'called_off'
     and old.status is distinct from 'called_off'
     and not public.write_is_through_a_trusted_path() then
    select status into v_schedule_status
      from public.schedules
     where id = new.schedule_id;
    if coalesce(v_schedule_status, 'draft') = 'published' then
      raise exception 'A published shift is called off through record_shift_call_off, which posts the opening and opens coverage work.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.protect_shift_assignment_call_off() is
  'Refuses a direct status write to called_off on a published schedule. The grid''s Called Off '
  'control must go through record_shift_call_off so the absence, the unfilled-shift work item and '
  'the open-shift opportunity are created together. Drafts are a planning mark and stay writable. '
  'INVOKER is load-bearing: a definer would make write_is_through_a_trusted_path always true.';

drop trigger if exists protect_shift_assignment_call_off on public.shift_assignments;
create trigger protect_shift_assignment_call_off
before update of status on public.shift_assignments
for each row execute function public.protect_shift_assignment_call_off();

revoke all on function public.protect_shift_assignment_call_off() from public, anon, authenticated;
grant execute on function public.protect_shift_assignment_call_off() to authenticated, service_role;
