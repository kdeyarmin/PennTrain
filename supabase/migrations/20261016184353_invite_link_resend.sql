-- Public "send me a new link" for an expired invitation.
--
-- The invitee has no session, so this cannot be an authenticated resend. Two service-role
-- functions back the edge function:
--
--   reserve_invite_resend records the attempt and refuses once an IP has asked  (default) 5
--   times in an hour or an email has asked 3 times in a day. The edge function calls it
--   before any lookup, including when the address is unknown, so a missing account still
--   spends the limit. The refusal is one exception for both caps: the HTTP response is the
--   same sentence either way, and a distinct error would say which cap fired.
--
--   pending_invite_user_id returns a user id only when that email belongs to an unconfirmed
--   auth user whose profile is still active. Confirmed accounts, revoked invitations
--   (profiles.is_active = false), and unknown addresses all return null. The edge function
--   then calls inviteUserByEmail only for a returned id, so this path cannot create an account.

create table app_private.invite_link_resends (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip_hash text not null,
  created_at timestamptz not null default now(),
  constraint invite_link_resends_email_hash_hex check (email_hash ~ '^[0-9a-f]{64}$'),
  constraint invite_link_resends_ip_hash_hex check (ip_hash ~ '^[0-9a-f]{64}$')
);

create index invite_link_resends_ip_created_idx
  on app_private.invite_link_resends (ip_hash, created_at);
create index invite_link_resends_email_created_idx
  on app_private.invite_link_resends (email_hash, created_at);

revoke all on table app_private.invite_link_resends from public, anon, authenticated;

comment on table app_private.invite_link_resends is
  'Hashed attempts to request a fresh invitation link. No email address is stored. '
  'Service role only, through reserve_invite_resend.';

create or replace function public.reserve_invite_resend(
  p_email_hash text,
  p_ip_hash text,
  p_max_ip_per_hour integer,
  p_max_email_per_day integer
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_email_hash !~ '^[0-9a-f]{64}$' or p_ip_hash !~ '^[0-9a-f]{64}$'
     or least(p_max_ip_per_hour, p_max_email_per_day) < 1 then
    raise exception 'invalid invite resend reservation' using errcode = '22023';
  end if;

  -- Fixed lock order. IP first, then email.
  perform pg_advisory_xact_lock(hashtextextended('invite-resend:ip:' || p_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('invite-resend:email:' || p_email_hash, 0));

  if (select count(*) from app_private.invite_link_resends
      where ip_hash = p_ip_hash and created_at >= now() - interval '1 hour')
     >= p_max_ip_per_hour then
    raise exception 'invite_resend_rate_limited' using errcode = 'P0001';
  end if;

  if (select count(*) from app_private.invite_link_resends
      where email_hash = p_email_hash and created_at >= now() - interval '1 day')
     >= p_max_email_per_day then
    raise exception 'invite_resend_rate_limited' using errcode = 'P0001';
  end if;

  insert into app_private.invite_link_resends (email_hash, ip_hash)
  values (p_email_hash, p_ip_hash);
end;
$function$;

create or replace function public.pending_invite_user_id(p_email text)
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select u.id
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.email is not null
    and lower(u.email) = lower(btrim(p_email))
    and u.email_confirmed_at is null
    and u.deleted_at is null
    and p.is_active
  limit 1;
$function$;

revoke all on function public.reserve_invite_resend(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_invite_resend(text, text, integer, integer)
  to service_role;

revoke all on function public.pending_invite_user_id(text)
  from public, anon, authenticated;
grant execute on function public.pending_invite_user_id(text)
  to service_role;

comment on function public.reserve_invite_resend(text, text, integer, integer) is
  'Records one public invite-link resend and raises invite_resend_rate_limited when the IP hourly cap or the email daily cap is already spent.';

comment on function public.pending_invite_user_id(text) is
  'User id of an unconfirmed, still-active invitation for this email. Null for unknown, confirmed, and revoked addresses. Does not create an account.';
