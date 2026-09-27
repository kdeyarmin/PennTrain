-- A lost successful response must not strand the preserved page behind its lock overlay.
-- Retry only the same caller's completed lock; every request still needs current MFA and
-- a different Auth session from the one that was locked. Replays do not duplicate audit rows.
create or replace function public.record_idle_session_unlock(p_lock_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_current_session_id text := nullif(auth.jwt()->>'session_id','');
  v_status jsonb;
begin
  v_status := public.get_my_mfa_status();
  if ((v_status->>'hasVerifiedFactor')::boolean or (v_status->>'smsRequired')::boolean)
    and not (v_status->>'verified')::boolean then
    raise exception 'Multi-factor verification is required to unlock' using errcode = '42501';
  end if;

  update public.session_lock_events e set unlocked_at = now()
    where e.id = p_lock_event_id and e.profile_id = auth.uid() and e.unlocked_at is null
      and e.session_id is distinct from v_current_session_id returning e.organization_id into v_org;
  if not found then
    if exists (
      select 1 from public.session_lock_events e
      where e.id = p_lock_event_id and e.profile_id = auth.uid() and e.unlocked_at is not null
        and e.session_id is distinct from v_current_session_id
    ) then
      return;
    end if;
    raise exception 'A fresh password session is required to unlock' using errcode = '42501';
  end if;

  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action)
    values(v_org,auth.uid(),'auth_session',p_lock_event_id::text,'soft_unlocked');
end;
$$;

revoke all on function public.record_idle_session_unlock(uuid) from public, anon;
grant execute on function public.record_idle_session_unlock(uuid) to authenticated;
