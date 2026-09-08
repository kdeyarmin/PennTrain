-- The support context's expiry must bound both refresh tokens and already-issued JWTs.
-- Normal sessions retain their existing lifetime. No existing permissive policy or grant changes.

create or replace function app_private.bound_impersonation_auth_lifetime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_session auth.sessions%rowtype;
  v_deadline timestamptz;
begin
  if tg_op = 'UPDATE' and old.target_session_id is not null then
    if new.target_session_id is distinct from old.target_session_id
       or new.target_profile_id is distinct from old.target_profile_id
       or new.actor_profile_id is distinct from old.actor_profile_id then
      raise exception 'A bound impersonation identity cannot be reassigned' using errcode = '42501';
    end if;
    if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
      raise exception 'An ended impersonation cannot be reopened' using errcode = '42501';
    end if;
    if new.expires_at > old.expires_at then
      raise exception 'A bound impersonation lifetime cannot be extended' using errcode = '42501';
    end if;
  end if;
  if new.target_session_id is null then return new; end if;
  begin
    v_session_id := new.target_session_id::uuid;
  exception when invalid_text_representation then
    raise exception 'Impersonation requires a valid Auth session' using errcode = '42501';
  end;
  select * into v_session from auth.sessions where id = v_session_id for update;
  if not found then
    -- The end handler revokes this session before finalizing its audit context.
    if tg_op = 'UPDATE' and old.target_session_id = new.target_session_id
       and new.ended_at is not null then return new; end if;
    raise exception 'Impersonation Auth session does not exist' using errcode = '42501';
  end if;
  if v_session.user_id is distinct from new.target_profile_id then
    raise exception 'Impersonation Auth session belongs to another user' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or old.target_session_id is null)
     and (new.ended_at is not null or new.expires_at <= statement_timestamp()) then
    raise exception 'Impersonation context is expired or ended' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or old.target_session_id is null)
     and v_session.not_after <= statement_timestamp() then
    raise exception 'Impersonation Auth session is expired' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or old.target_session_id is null)
     and not exists (select 1 from public.profiles p where p.id = new.actor_profile_id
                     and p.is_active and p.role = 'platform_admin') then
    raise exception 'Impersonation actor is no longer an active platform administrator' using errcode = '42501';
  end if;
  v_deadline := least(new.expires_at, new.ended_at, v_session.not_after);
  update auth.sessions set not_after = v_deadline where id = v_session_id;
  new.bound_at := coalesce(case when tg_op = 'UPDATE' then old.bound_at end, new.bound_at, statement_timestamp());
  return new;
end;
$$;
revoke all on function app_private.bound_impersonation_auth_lifetime() from public, anon, authenticated;
grant execute on function app_private.bound_impersonation_auth_lifetime() to service_role;

create trigger bound_impersonation_auth_lifetime
before insert or update on public.impersonation_sessions
for each row execute function app_private.bound_impersonation_auth_lifetime();

-- Previously bound sessions receive the same refresh ceiling without reopening an ended context.
update auth.sessions s
set not_after = least(s.not_after, i.expires_at, i.ended_at)
from public.impersonation_sessions i
where s.id::text = i.target_session_id
  and s.user_id = i.target_profile_id;

-- Ended rows remain authorization evidence, so the active-only unique index is insufficient.
create index impersonation_sessions_target_session_lifetime_idx
on public.impersonation_sessions(target_session_id) where target_session_id is not null;

create or replace function public.current_impersonation_session_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.impersonation_sessions i
    left join public.profiles actor on actor.id = i.actor_profile_id
    left join auth.sessions s on s.id = case
      when i.target_session_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then i.target_session_id::uuid end
    where i.target_session_id = nullif(auth.jwt() ->> 'session_id', '')
      and (
        i.target_profile_id is distinct from auth.uid()
        or actor.id is null
        or not actor.is_active
        or actor.role is distinct from 'platform_admin'
        or i.ended_at is not null
        or i.expires_at <= statement_timestamp()
        or s.id is null
        or s.user_id is distinct from i.target_profile_id
        or s.not_after <= statement_timestamp()
      )
  );
$$;
revoke all on function public.current_impersonation_session_live() from public, anon;
grant execute on function public.current_impersonation_session_live() to authenticated, service_role;

create or replace function public.current_session_unlocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_impersonation_session_live()
    and (auth.uid() is null or not exists (
      select 1 from public.session_lock_events e
      where e.profile_id = auth.uid()
        and e.unlocked_at is null
        and e.session_id is not distinct from nullif(auth.jwt() ->> 'session_id', '')
    ));
$$;
revoke all on function public.current_session_unlocked() from public, anon;
grant execute on function public.current_session_unlocked() to authenticated, service_role;

-- Direct owner policies and Realtime reads also enforce expiry. SECURITY DEFINER lookup avoids
-- recursion when this restrictive policy is evaluated on the lifecycle table itself.
do $$
declare v_table record;
begin
  for v_table in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relrowsecurity and c.relkind in ('r', 'p')
      and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format(
      'create policy impersonation_session_lifetime on %I.%I as restrictive for all to authenticated using ((select public.current_impersonation_session_live())) with check ((select public.current_impersonation_session_live()))',
      v_table.nspname, v_table.relname
    );
  end loop;
end;
$$;

-- PostgREST invokes this before table requests AND SECURITY DEFINER RPCs. Anonymous requests
-- are unchanged; the routine returns no data and permits only the caller's live support session.
-- This wrapper needs no owner privileges: its authenticated caller can execute the scoped helper.
create or replace function public.enforce_request_impersonation_lifetime()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.current_impersonation_session_live() then
    raise exception 'The impersonation session has expired or ended' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.enforce_request_impersonation_lifetime() from public;
grant execute on function public.enforce_request_impersonation_lifetime() to anon, authenticated, service_role;

do $$
declare v_existing text;
begin
  -- Refuse to replace an unrelated hook, including a database-specific role setting.
  select split_part(setting, '=', 2) into v_existing
  from pg_db_role_setting cfg
  cross join lateral unnest(cfg.setconfig) setting
  where cfg.setrole in (0, (select oid from pg_roles where rolname = 'authenticator'))
    and cfg.setdatabase in (0, (select oid from pg_database where datname = current_database()))
    and setting like 'pgrst.db_pre_request=%'
    and split_part(setting, '=', 2) not in ('', 'public.enforce_request_impersonation_lifetime')
  limit 1;
  if v_existing is not null then
    raise exception 'Existing PostgREST pre-request hook must be composed before installing impersonation expiry: %', v_existing;
  end if;
  alter role authenticator set pgrst.db_pre_request = 'public.enforce_request_impersonation_lifetime';
end;
$$;
notify pgrst, 'reload config';
