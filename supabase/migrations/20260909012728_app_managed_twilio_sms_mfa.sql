-- SMS is a CareBase second factor delivered and verified by Twilio Verify. It never
-- changes auth.users, auth.sessions.aal, an Auth factor, or an Auth JWT claim.
-- Only the authenticated SMS edge function may write provider verification evidence.

-- SMS remains the account's chosen trust method after an administrator reset.
-- Otherwise a native factor enrolled by a password-only attacker could become
-- trusted as soon as the SMS factor is removed during recovery.
create table app_private.sms_mfa_accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  enabled_at timestamptz not null default now()
);

create table app_private.sms_mfa_factors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now(),
  verified_at timestamptz not null default now()
);

-- Keep consumed provider SIDs as tombstones. A Twilio resend can return the same
-- SID; it must never become proof for a second local challenge or Auth session.
create table app_private.sms_mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  purpose text not null check (purpose in ('enroll', 'verify')),
  previous_factor_id uuid,
  native_authorized boolean not null default false,
  verification_sid text unique check (verification_sid ~ '^VE[0-9a-fA-F]{32}$'),
  state text not null default 'sending' check (state in ('sending', 'pending', 'consumed', 'canceled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  last_sent_at timestamptz not null default now(),
  send_count integer not null default 1 check (send_count between 1 and 20),
  check_attempts integer not null default 0 check (check_attempts between 0 and 5),
  attempt_id uuid,
  attempt_expires_at timestamptz,
  consumed_at timestamptz,
  check (expires_at <= created_at + interval '10 minutes')
);
create index sms_mfa_challenges_profile_created_idx on app_private.sms_mfa_challenges(profile_id, created_at);
create index sms_mfa_challenges_phone_created_idx on app_private.sms_mfa_challenges(phone, created_at);

create table app_private.sms_mfa_session_assurance (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  factor_id uuid not null references app_private.sms_mfa_factors(id) on delete cascade,
  challenge_id uuid not null unique references app_private.sms_mfa_challenges(id),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > verified_at and expires_at <= verified_at + interval '8 hours')
);
create index sms_mfa_session_assurance_profile_idx on app_private.sms_mfa_session_assurance(profile_id);

alter table app_private.sms_mfa_accounts enable row level security;
alter table app_private.sms_mfa_factors enable row level security;
alter table app_private.sms_mfa_challenges enable row level security;
alter table app_private.sms_mfa_session_assurance enable row level security;
revoke all on app_private.sms_mfa_accounts, app_private.sms_mfa_factors, app_private.sms_mfa_challenges,
  app_private.sms_mfa_session_assurance from public, anon, authenticated, service_role;

create function app_private.sms_mfa_session_is_live(p_profile_id uuid, p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s
    join public.profiles p on p.id = s.user_id
    left join public.organizations o on o.id = p.organization_id
    where s.id = p_session_id and s.user_id = p_profile_id and p.is_active
      and s.created_at <= statement_timestamp() + interval '5 minutes'
      and (s.not_after is null or s.not_after > statement_timestamp())
      and (p.role = 'platform_admin' or (o.id is not null and o.subscription_status not in ('suspended','canceled')))
      and not exists (select 1 from public.session_lock_events e
        where e.profile_id = p_profile_id and e.session_id = p_session_id::text and e.unlocked_at is null)
      and not exists (select 1 from public.impersonation_sessions i where i.target_session_id = p_session_id::text)
  );
$$;

create function app_private.sms_mfa_max_minutes(p_profile_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select least(480, greatest(1, coalesce((select case when p.role = 'platform_admin' then 480
    else policy.max_privileged_session_minutes end
    from public.profiles p left join public.identity_security_policies policy
      on policy.organization_id = p.organization_id where p.id = p_profile_id), 480)));
$$;

create function app_private.sms_mfa_is_current(p_profile_id uuid, p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.sms_mfa_session_is_live(p_profile_id, p_session_id) and exists (
    select 1 from app_private.sms_mfa_session_assurance a
    join app_private.sms_mfa_factors f on f.id = a.factor_id and f.profile_id = a.profile_id
    join auth.sessions s on s.id = a.session_id and s.user_id = a.profile_id
    where a.profile_id = p_profile_id and a.session_id = p_session_id
      and a.verified_at <= statement_timestamp()
      and a.expires_at > statement_timestamp()
      and s.created_at > statement_timestamp() - make_interval(mins => app_private.sms_mfa_max_minutes(p_profile_id))
  );
$$;

create function app_private.sms_mfa_native_is_current(p_profile_id uuid, p_session_id uuid, p_native_aal2 boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_native_aal2, false)
    and app_private.sms_mfa_session_is_live(p_profile_id, p_session_id)
    -- Supabase permits first native factor enrollment at AAL1. Once SMS is enrolled,
    -- a newly enrolled native factor must never become an alternative way past it.
    and not exists (select 1 from app_private.sms_mfa_accounts sms where sms.profile_id = p_profile_id)
    and exists (select 1 from auth.sessions s
      where s.id = p_session_id and s.user_id = p_profile_id and s.aal = 'aal2'
        and s.created_at > statement_timestamp() - make_interval(mins => app_private.sms_mfa_max_minutes(p_profile_id)))
    and exists (select 1 from auth.mfa_factors f where f.user_id = p_profile_id and f.status = 'verified');
$$;

create function app_private.sms_mfa_require_service()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'SMS verification is a server operation' using errcode = '42501';
  end if;
end;
$$;

create function app_private.sms_mfa_require_session(p_profile_id uuid, p_session_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.sms_mfa_session_is_live(p_profile_id, p_session_id) then
    raise exception 'sms_mfa_session_unavailable' using errcode = '42501', hint = 'sms_mfa_session_unavailable';
  end if;
end;
$$;

create function app_private.sms_mfa_require_password(p_profile_id uuid, p_session_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.sessions s join auth.mfa_amr_claims amr on amr.session_id = s.id
    where s.id = p_session_id and s.user_id = p_profile_id
      and s.created_at >= statement_timestamp() - interval '10 minutes'
      and amr.authentication_method = 'password'
      and greatest(amr.created_at, amr.updated_at) >= statement_timestamp() - interval '10 minutes'
      and greatest(amr.created_at, amr.updated_at) <= statement_timestamp() + interval '5 minutes') then
    raise exception 'fresh_password_required' using errcode = '42501', hint = 'fresh_password_required';
  end if;
end;
$$;

create function public.prepare_sms_mfa_challenge(
  p_profile_id uuid, p_session_id uuid, p_phone text default null, p_native_aal2 boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_factor app_private.sms_mfa_factors%rowtype;
  v_challenge app_private.sms_mfa_challenges%rowtype;
  v_phone text;
  v_purpose text;
  v_native boolean;
begin
  perform app_private.sms_mfa_require_service();
  perform app_private.sms_mfa_require_session(p_profile_id, p_session_id);
  perform pg_advisory_xact_lock(hashtextextended('sms-mfa-user:' || p_profile_id::text, 0));
  perform app_private.sms_mfa_require_session(p_profile_id, p_session_id);
  select * into v_factor from app_private.sms_mfa_factors where profile_id = p_profile_id;
  if p_phone is null then
    if v_factor.id is null then raise exception 'sms_factor_not_enrolled' using errcode = '22023', hint = 'sms_factor_not_enrolled'; end if;
    v_phone := v_factor.phone;
    v_purpose := 'verify';
  else
    if p_phone !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'sms_phone_invalid' using errcode = '22023', hint = 'sms_phone_invalid';
    end if;
    perform app_private.sms_mfa_require_password(p_profile_id, p_session_id);
    v_native := app_private.sms_mfa_native_is_current(p_profile_id, p_session_id, p_native_aal2);
    if (v_factor.id is not null or (not exists (select 1 from app_private.sms_mfa_accounts a where a.profile_id = p_profile_id)
      and exists (select 1 from auth.mfa_factors f where f.user_id = p_profile_id and f.status = 'verified')))
      and not (v_native or app_private.sms_mfa_is_current(p_profile_id, p_session_id)) then
      raise exception 'mfa_required' using errcode = '42501', hint = 'mfa_required';
    end if;
    v_phone := p_phone;
    v_purpose := 'enroll';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sms-mfa-phone:' || v_phone, 0));
  if exists (select 1 from app_private.sms_mfa_challenges c where c.profile_id = p_profile_id
    and c.last_sent_at > statement_timestamp() - interval '60 seconds')
    or (select coalesce(sum(c.send_count), 0) from app_private.sms_mfa_challenges c
      where c.profile_id = p_profile_id and c.created_at > statement_timestamp() - interval '10 minutes') >= 5
    or (select coalesce(sum(c.send_count), 0) from app_private.sms_mfa_challenges c
      where c.profile_id = p_profile_id and c.created_at > statement_timestamp() - interval '1 day') >= 20
    or (select coalesce(sum(c.send_count), 0) from app_private.sms_mfa_challenges c
      where c.phone = v_phone and c.created_at > statement_timestamp() - interval '10 minutes') >= 5 then
    raise exception 'sms_send_rate_limited' using errcode = 'P0001', hint = 'sms_send_rate_limited';
  end if;
  -- Resends retain the local challenge, attempt budget, provider SID and original expiry.
  select * into v_challenge from app_private.sms_mfa_challenges c
    where c.profile_id = p_profile_id and c.session_id = p_session_id and c.phone = v_phone
      and c.purpose = v_purpose and c.previous_factor_id is not distinct from v_factor.id
      and c.state in ('sending','pending') and c.expires_at > statement_timestamp() + interval '30 seconds'
      and c.check_attempts < 5 order by c.created_at desc limit 1 for update;
  if v_challenge.id is not null and v_challenge.attempt_expires_at > statement_timestamp() then
    raise exception 'sms_verification_in_progress' using errcode = 'P0001', hint = 'sms_verification_in_progress';
  end if;
  update app_private.sms_mfa_challenges set state = 'canceled', attempt_id = null, attempt_expires_at = null
    where profile_id = p_profile_id and session_id = p_session_id and state in ('sending','pending')
      and id is distinct from v_challenge.id;
  if v_challenge.id is null then
    insert into app_private.sms_mfa_challenges(profile_id,session_id,phone,purpose,previous_factor_id,native_authorized)
      values(p_profile_id,p_session_id,v_phone,v_purpose,v_factor.id,coalesce(v_native,false)) returning * into v_challenge;
  else
    update app_private.sms_mfa_challenges set state = 'sending', last_sent_at = statement_timestamp(),
      send_count = send_count + 1, native_authorized = coalesce(v_native,false), attempt_id = null, attempt_expires_at = null
      where id = v_challenge.id returning * into v_challenge;
  end if;
  return jsonb_build_object('challengeId',v_challenge.id,'phone',v_phone,'expiresAt',v_challenge.expires_at);
end;
$$;

create function public.activate_sms_mfa_challenge(
  p_profile_id uuid, p_session_id uuid, p_challenge_id uuid, p_verification_sid text
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.sms_mfa_require_service();
  perform app_private.sms_mfa_require_session(p_profile_id,p_session_id);
  if p_verification_sid is null or p_verification_sid !~ '^VE[0-9a-fA-F]{32}$' then
    raise exception 'sms_provider_response_invalid' using errcode = '22023', hint = 'sms_provider_response_invalid';
  end if;
  update app_private.sms_mfa_challenges c set verification_sid = p_verification_sid, state = 'pending'
    where c.id = p_challenge_id and c.profile_id = p_profile_id and c.session_id = p_session_id
      and c.state = 'sending' and c.expires_at > statement_timestamp()
      and (c.verification_sid is null or c.verification_sid = p_verification_sid);
  if not found then raise exception 'sms_challenge_unavailable' using errcode = '42501', hint = 'sms_challenge_unavailable'; end if;
exception when unique_violation then
  raise exception 'sms_provider_challenge_reused' using errcode = '42501', hint = 'sms_provider_challenge_reused';
end;
$$;

create function public.reserve_sms_mfa_check(p_profile_id uuid, p_session_id uuid, p_challenge_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_challenge app_private.sms_mfa_challenges%rowtype;
begin
  perform app_private.sms_mfa_require_service();
  perform app_private.sms_mfa_require_session(p_profile_id,p_session_id);
  perform pg_advisory_xact_lock(hashtextextended('sms-mfa-user:' || p_profile_id::text,0));
  perform app_private.sms_mfa_require_session(p_profile_id,p_session_id);
  if (select coalesce(sum(c.check_attempts),0) from app_private.sms_mfa_challenges c
    where c.profile_id = p_profile_id and c.created_at > statement_timestamp() - interval '10 minutes') >= 5 then
    raise exception 'sms_check_rate_limited' using errcode = 'P0001', hint = 'sms_check_rate_limited';
  end if;
  update app_private.sms_mfa_challenges c set check_attempts = check_attempts + 1,
    attempt_id = gen_random_uuid(), attempt_expires_at = statement_timestamp() + interval '45 seconds'
    where c.id = p_challenge_id and c.profile_id = p_profile_id and c.session_id = p_session_id
      and c.state = 'pending' and c.verification_sid is not null and c.expires_at > statement_timestamp()
      and c.check_attempts < 5 and (c.attempt_expires_at is null or c.attempt_expires_at <= statement_timestamp())
    returning * into v_challenge;
  if v_challenge.id is null then raise exception 'sms_challenge_unavailable' using errcode = '42501', hint = 'sms_challenge_unavailable'; end if;
  return jsonb_build_object('verificationSid',v_challenge.verification_sid,'phone',v_challenge.phone,
    'attemptId',v_challenge.attempt_id,'expiresAt',v_challenge.expires_at);
end;
$$;

create function public.complete_sms_mfa_check(
  p_profile_id uuid, p_session_id uuid, p_challenge_id uuid, p_attempt_id uuid, p_approved boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_challenge app_private.sms_mfa_challenges%rowtype;
  v_factor app_private.sms_mfa_factors%rowtype;
  v_expires_at timestamptz;
  v_org_id uuid;
begin
  perform app_private.sms_mfa_require_service();
  perform app_private.sms_mfa_require_session(p_profile_id,p_session_id);
  perform pg_advisory_xact_lock(hashtextextended('sms-mfa-user:' || p_profile_id::text, 0));
  perform app_private.sms_mfa_require_session(p_profile_id,p_session_id);
  select * into v_challenge from app_private.sms_mfa_challenges c
    where c.id = p_challenge_id and c.profile_id = p_profile_id and c.session_id = p_session_id
      and c.state = 'pending' and c.attempt_id = p_attempt_id
      and c.attempt_expires_at > statement_timestamp() and c.expires_at > statement_timestamp() for update;
  if v_challenge.id is null then raise exception 'sms_challenge_unavailable' using errcode = '42501', hint = 'sms_challenge_unavailable'; end if;
  if p_approved is distinct from true then
    update app_private.sms_mfa_challenges set attempt_id = null, attempt_expires_at = null where id = v_challenge.id;
    return jsonb_build_object('verified',false);
  end if;
  select * into v_factor from app_private.sms_mfa_factors where profile_id = p_profile_id for update;
  if v_factor.id is distinct from v_challenge.previous_factor_id then
    raise exception 'sms_factor_changed' using errcode = '42501', hint = 'sms_factor_changed';
  end if;
  if v_challenge.purpose = 'enroll' then
    perform app_private.sms_mfa_require_password(p_profile_id,p_session_id);
    if (v_factor.id is not null or (not exists (select 1 from app_private.sms_mfa_accounts a where a.profile_id = p_profile_id)
      and exists (select 1 from auth.mfa_factors f where f.user_id = p_profile_id and f.status = 'verified')))
      and not (app_private.sms_mfa_native_is_current(p_profile_id,p_session_id,v_challenge.native_authorized)
        or app_private.sms_mfa_is_current(p_profile_id,p_session_id)) then
      raise exception 'mfa_required' using errcode = '42501', hint = 'mfa_required';
    end if;
    -- Replacing a number changes its factor identity and revokes every old attestation.
    delete from app_private.sms_mfa_factors where profile_id = p_profile_id;
    insert into app_private.sms_mfa_accounts(profile_id) values(p_profile_id) on conflict(profile_id) do nothing;
    insert into app_private.sms_mfa_factors(profile_id,phone) values(p_profile_id,v_challenge.phone)
      returning * into v_factor;
    update app_private.sms_mfa_challenges set state = 'canceled', attempt_id = null, attempt_expires_at = null
      where profile_id = p_profile_id and id <> v_challenge.id and state in ('sending','pending');
  elsif v_factor.id is null or v_factor.phone <> v_challenge.phone then
    raise exception 'sms_factor_changed' using errcode = '42501', hint = 'sms_factor_changed';
  end if;
  select least(statement_timestamp() + interval '8 hours', s.not_after,
    s.created_at + make_interval(mins => app_private.sms_mfa_max_minutes(p_profile_id))) into v_expires_at
    from auth.sessions s where s.id = p_session_id and s.user_id = p_profile_id;
  if v_expires_at is null or v_expires_at <= statement_timestamp() then
    raise exception 'fresh_password_required' using errcode = '42501', hint = 'fresh_password_required';
  end if;
  update app_private.sms_mfa_challenges set state = 'consumed', consumed_at = statement_timestamp(),
    attempt_id = null, attempt_expires_at = null where id = v_challenge.id;
  insert into app_private.sms_mfa_session_assurance(session_id,profile_id,factor_id,challenge_id,verified_at,expires_at)
    values(p_session_id,p_profile_id,v_factor.id,v_challenge.id,statement_timestamp(),v_expires_at)
    on conflict(session_id) do update set profile_id = excluded.profile_id, factor_id = excluded.factor_id,
      challenge_id = excluded.challenge_id, verified_at = excluded.verified_at, expires_at = excluded.expires_at;
  select organization_id into v_org_id from public.profiles where id = p_profile_id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,new_values)
    values(v_org_id,p_profile_id,'identity',p_profile_id::text,
      case when v_challenge.purpose = 'enroll' then 'sms_mfa_enrolled' else 'sms_mfa_verified' end,
      jsonb_build_object('method','twilio_sms','factorId',v_factor.id,'sessionId',p_session_id));
  return jsonb_build_object('verified',true);
end;
$$;

create function public.reset_sms_mfa_factor(p_profile_id uuid, p_actor_profile_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_org_id uuid;
begin
  perform app_private.sms_mfa_require_service();
  if p_actor_profile_id = p_profile_id or length(btrim(coalesce(p_reason,''))) < 10
    or not exists (select 1 from public.profiles p where p.id = p_actor_profile_id and p.is_active and p.role = 'platform_admin') then
    raise exception 'sms_mfa_reset_denied' using errcode = '42501', hint = 'sms_mfa_reset_denied';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sms-mfa-user:' || p_profile_id::text,0));
  delete from app_private.sms_mfa_factors where profile_id = p_profile_id;
  get diagnostics v_count = row_count;
  update app_private.sms_mfa_challenges set state = 'canceled', attempt_id = null, attempt_expires_at = null
    where profile_id = p_profile_id and state in ('sending','pending');
  select organization_id into v_org_id from public.profiles where id = p_profile_id;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action,reason,new_values)
    values(v_org_id,p_actor_profile_id,'identity',p_profile_id::text,'sms_mfa_reset',btrim(p_reason),
      jsonb_build_object('method','twilio_sms','factorCount',v_count));
  return v_count;
end;
$$;

-- These are backend-only RPCs; private tables have no API grants, even to service_role.
revoke all on function public.prepare_sms_mfa_challenge(uuid,uuid,text,boolean),
  public.activate_sms_mfa_challenge(uuid,uuid,uuid,text), public.reserve_sms_mfa_check(uuid,uuid,uuid),
  public.complete_sms_mfa_check(uuid,uuid,uuid,uuid,boolean),
  public.reset_sms_mfa_factor(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.prepare_sms_mfa_challenge(uuid,uuid,text,boolean),
  public.activate_sms_mfa_challenge(uuid,uuid,uuid,text), public.reserve_sms_mfa_check(uuid,uuid,uuid),
  public.complete_sms_mfa_check(uuid,uuid,uuid,uuid,boolean),
  public.reset_sms_mfa_factor(uuid,uuid,text) to service_role;

-- Shared identity checks retain real Supabase AAL2 and its existing age limit,
-- and additionally accept a server-recorded, live SMS proof for this exact session.
create or replace function public.identity_assurance_is_current(p_operation text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_claims jsonb := coalesce(auth.jwt(),'{}'::jsonb);
  v_max_minutes integer := 480;
  v_issued_at timestamptz;
  v_session_started_at timestamptz;
  v_session_id text;
  v_session_uuid uuid;
  v_sms boolean := false;
begin
  if coalesce(v_claims->>'role','') = 'service_role' then return true; end if;
  if auth.uid() is null or not public.current_session_unlocked() then return false; end if;
  if not public.identity_operation_requires_aal2(p_operation) then return true; end if;
  if coalesce(v_claims->>'iat','') !~ '^[0-9]+([.][0-9]+)?$' then return false; end if;
  if public.current_role() <> 'platform_admin' then
    select p.max_privileged_session_minutes into v_max_minutes from public.identity_security_policies p
      where p.organization_id = public.current_org_id();
    v_max_minutes := coalesce(v_max_minutes,480);
  end if;
  v_issued_at := to_timestamp((v_claims->>'iat')::double precision);
  v_session_id := nullif(v_claims->>'session_id','');
  if v_session_id is not null then
    if v_session_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
    v_session_uuid := v_session_id::uuid;
    select s.created_at into v_session_started_at from auth.sessions s where s.id = v_session_uuid and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > statement_timestamp());
    if not found then return false; end if;
    v_sms := app_private.sms_mfa_is_current(auth.uid(),v_session_uuid);
  end if;
  if exists (select 1 from app_private.sms_mfa_accounts f where f.profile_id = auth.uid()) then
    if not v_sms then return false; end if;
  elsif coalesce(v_claims->>'aal','aal1') <> 'aal2' then return false;
  end if;
  return coalesce(v_session_started_at,v_issued_at) >= now() - make_interval(mins => v_max_minutes)
    and v_issued_at <= now() + interval '5 minutes';
exception when others then return false;
end;
$$;

create function public.get_my_mfa_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_sms boolean := false;
  v_native boolean := false;
  v_verified_at timestamptz;
  v_expires_at timestamptz;
  v_factors jsonb;
  v_has_native boolean;
  v_sms_required boolean;
  v_account_accessible boolean;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  -- Account availability must remain visible during MFA bootstrap. The normal
  -- organization query is correctly blocked until SMS succeeds, while suspended
  -- accounts cannot obtain SMS assurance in the first place.
  select p.is_active and (p.role = 'platform_admin' or
    (o.id is not null and o.subscription_status not in ('suspended','canceled')))
    into v_account_accessible from public.profiles p
    left join public.organizations o on o.id = p.organization_id where p.id = v_uid;
  if coalesce(auth.jwt()->>'session_id','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    v_session_id := (auth.jwt()->>'session_id')::uuid;
    v_sms := app_private.sms_mfa_is_current(v_uid,v_session_id);
    v_native := app_private.sms_mfa_native_is_current(v_uid,v_session_id,coalesce(auth.jwt()->>'aal','') = 'aal2');
  end if;
  if v_sms then
    select a.verified_at,least(a.expires_at,s.not_after,
      s.created_at + make_interval(mins => app_private.sms_mfa_max_minutes(v_uid)))
      into v_verified_at,v_expires_at from app_private.sms_mfa_session_assurance a
      join auth.sessions s on s.id = a.session_id and s.user_id = a.profile_id
      where a.profile_id = v_uid and a.session_id = v_session_id;
  elsif v_native then
    select s.created_at,least(s.not_after,s.created_at + make_interval(mins => app_private.sms_mfa_max_minutes(v_uid)))
      into v_verified_at,v_expires_at from auth.sessions s where s.id = v_session_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'maskedPhone','••• ••• ' || right(f.phone,4),
    'createdAt',f.created_at) order by f.created_at),'[]'::jsonb) into v_factors
    from app_private.sms_mfa_factors f where f.profile_id = v_uid;
  select exists(select 1 from auth.mfa_factors f where f.user_id = v_uid and f.status = 'verified') into v_has_native;
  select exists(select 1 from app_private.sms_mfa_accounts a where a.profile_id = v_uid) into v_sms_required;
  return jsonb_build_object('verified',v_sms or v_native,'method',case when v_sms then 'sms' when v_native then 'totp' end,
    'verifiedAt',v_verified_at,'expiresAt',v_expires_at,'hasVerifiedFactor',(v_has_native and not v_sms_required) or jsonb_array_length(v_factors)>0,
    'accountAccessible',coalesce(v_account_accessible,false),
    'smsRequired',v_sms_required,
    'smsFactors',v_factors);
end;
$$;
revoke all on function public.get_my_mfa_status() from public, anon;
grant execute on function public.get_my_mfa_status() to authenticated;

-- An opted-in account must satisfy SMS for all app data, including ordinary
-- owner reads and SECURITY DEFINER RPCs, not only privileged buttons in the UI.
create function public.current_sms_mfa_satisfied()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_session_id text := nullif(auth.jwt()->>'session_id','');
begin
  if coalesce(auth.jwt()->>'role','') = 'service_role' then return true; end if;
  if v_uid is null then return true; end if;
  if not exists (select 1 from app_private.sms_mfa_accounts a where a.profile_id = v_uid) then return true; end if;
  if v_session_id is null or v_session_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  return app_private.sms_mfa_is_current(v_uid,v_session_id::uuid);
end;
$$;
revoke all on function public.current_sms_mfa_satisfied() from public, anon;
grant execute on function public.current_sms_mfa_satisfied() to authenticated, service_role;

create or replace function public.current_session_unlocked()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_impersonation_session_live() and public.current_sms_mfa_satisfied()
    and (auth.uid() is null or not exists (select 1 from public.session_lock_events e
      where e.profile_id = auth.uid() and e.unlocked_at is null
        and e.session_id is not distinct from nullif(auth.jwt()->>'session_id','')));
$$;

-- Policy discovery is bootstrap: a missing SMS proof must not hide the user's
-- role and turn the required policy into an optional policy.
create or replace function public.get_my_mfa_policy()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_policy public.identity_security_policies%rowtype;
  v_role text;
  v_org uuid;
  v_is_demo boolean;
begin
  select p.role,p.organization_id,coalesce(o.is_demo,false) into v_role,v_org,v_is_demo
    from public.profiles p left join public.organizations o on o.id = p.organization_id
    where p.id = auth.uid() and p.is_active;
  if v_role is null then return jsonb_build_object('required',false); end if;
  if v_role = 'platform_admin' then
    return jsonb_build_object('required',true,'role',v_role,'maxSessionMinutes',480);
  end if;
  if v_is_demo then return jsonb_build_object('required',false,'role',v_role,'maxSessionMinutes',480); end if;
  select * into v_policy from public.identity_security_policies where organization_id = v_org;
  return jsonb_build_object('required',coalesce(v_policy.require_aal2, true)
    and v_role = any(coalesce(v_policy.privileged_roles,array['org_admin','facility_manager']::text[])),
    'role',v_role,'maxSessionMinutes',coalesce(v_policy.max_privileged_session_minutes,480));
end;
$$;

do $$
declare v_table record;
begin
  for v_table in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relrowsecurity and c.relkind in ('r','p')
      and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
  loop
    if v_table.nspname = 'public' and v_table.relname = 'profiles' then
      -- The auth provider must resolve its own profile before it can render MFA.
      execute 'create policy sms_mfa_bootstrap_profile on public.profiles as restrictive for select to authenticated
        using ((id = (select auth.uid())) or (select public.current_sms_mfa_satisfied()))';
      execute 'create policy sms_mfa_profile_insert on public.profiles as restrictive for insert to authenticated
        with check ((select public.current_sms_mfa_satisfied()))';
      execute 'create policy sms_mfa_profile_update on public.profiles as restrictive for update to authenticated
        using ((select public.current_sms_mfa_satisfied())) with check ((select public.current_sms_mfa_satisfied()))';
      execute 'create policy sms_mfa_profile_delete on public.profiles as restrictive for delete to authenticated
        using ((select public.current_sms_mfa_satisfied()))';
    else
      execute format('create policy sms_mfa_session_required on %I.%I as restrictive for all to authenticated
        using ((select public.current_sms_mfa_satisfied())) with check ((select public.current_sms_mfa_satisfied()))',
        v_table.nspname,v_table.relname);
    end if;
  end loop;
end;
$$;

-- Extend the already configured hook; do not replace its impersonation ceiling.
-- PostgREST supplies request.path and request.method independently of user headers.
create or replace function public.enforce_request_impersonation_lifetime()
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_path text := current_setting('request.path',true);
  v_method text := current_setting('request.method',true);
begin
  if auth.uid() is null then return; end if;
  if not public.current_impersonation_session_live() then
    raise exception 'The impersonation session has expired or ended' using errcode = '42501';
  end if;
  if public.current_sms_mfa_satisfied() then return; end if;
  if v_path = '/profiles' and v_method in ('GET','HEAD') then return; end if;
  if v_path = any(array['/rpc/get_my_mfa_status','/rpc/get_my_mfa_policy',
      '/rpc/get_current_idle_session_lock','/rpc/record_idle_session_lock',
      '/rpc/record_idle_session_unlock','/rpc/identity_assurance_is_current']::text[])
    and v_method in ('GET','HEAD','POST') then return; end if;
  raise exception 'SMS verification is required for this account' using errcode = '42501', hint = 'mfa_required';
end;
$$;

-- An old JWT must not regain SMS assurance after a new password session clears
-- the old lock record. Locking permanently retires that session's SMS proof.
create function app_private.revoke_locked_sms_mfa_assurance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.unlocked_at is null then
    perform pg_advisory_xact_lock(hashtextextended('sms-mfa-user:' || new.profile_id::text,0));
    delete from app_private.sms_mfa_session_assurance where profile_id = new.profile_id and session_id::text = new.session_id;
    update app_private.sms_mfa_challenges set state = 'canceled', attempt_id = null, attempt_expires_at = null
      where profile_id = new.profile_id and session_id::text = new.session_id and state in ('sending','pending');
  end if;
  return new;
end;
$$;
create trigger revoke_locked_sms_mfa_assurance after insert or update on public.session_lock_events
  for each row execute function app_private.revoke_locked_sms_mfa_assurance();

create or replace function public.record_idle_session_unlock(p_lock_event_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
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
  if not found then raise exception 'A fresh password session is required to unlock' using errcode = '42501'; end if;
  insert into public.audit_logs(organization_id,actor_profile_id,entity_type,entity_id,action)
    values(v_org,auth.uid(),'auth_session',p_lock_event_id::text,'soft_unlocked');
end;
$$;

-- Count actual enrolled SMS factors in the identity console, without exposing numbers.
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.get_identity_control_plane()'::regprocedure) into v_def;
  if position('where factor.user_id = p.id and factor.status = ''verified''' in v_def) = 0 then
    raise exception 'Identity control plane MFA count changed; review the SMS extension';
  end if;
  v_def := replace(v_def,'where factor.user_id = p.id and factor.status = ''verified''',
    'where factor.user_id = p.id and factor.status = ''verified''
          and not exists (select 1 from app_private.sms_mfa_accounts sms_account where sms_account.profile_id = p.id)
          union all select 1 from app_private.sms_mfa_factors sms where sms.profile_id = p.id');
  execute v_def;
end;
$$;

revoke all on function app_private.sms_mfa_session_is_live(uuid,uuid), app_private.sms_mfa_max_minutes(uuid),
  app_private.sms_mfa_is_current(uuid,uuid), app_private.sms_mfa_native_is_current(uuid,uuid,boolean),
  app_private.sms_mfa_require_service(), app_private.sms_mfa_require_session(uuid,uuid),
  app_private.sms_mfa_require_password(uuid,uuid), app_private.revoke_locked_sms_mfa_assurance()
  from public, anon, authenticated, service_role;
