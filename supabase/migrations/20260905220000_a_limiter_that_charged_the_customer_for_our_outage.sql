-- A rate limiter that charged the customer for our outage, and a break-glass grant that granted
-- nothing (I22).
--
-- 1. THE DAILY SIGNUP CAP COUNTED OUR OWN FAILURES. `reserve_signup_attempt` counts every
--    signup_attempts row for an email address in the last day, whatever became of it, against a
--    cap of three. The failures that land in that table include `invite_failed` -- raised when the
--    invitation email cannot be sent, which is what happens while SMTP is misconfigured (see
--    BACKLOG.md B3/H11) -- along with `settings_unavailable`, `turnstile_not_configured` and every
--    unexpected error. So a first customer who tries three times during an outage of ours is
--    refused for the rest of the day by a limiter defending us against them, for a fault that was
--    never theirs. On a pilot, that customer is the whole pilot.
--
--    The attribution is now stamped when the attempt is finalized, and both caps read it. A
--    success still counts (a second organization for one email address is exactly what the cap is
--    for), an in-flight reservation still counts, a caller-side failure -- a failed Turnstile, an
--    invalid redirect -- still counts. A platform fault does not.
--
-- 2. BREAK-GLASS GRANTED NOTHING. `grant_identity_break_glass` requires a platform admin, a fresh
--    AAL2 session, a separate requester, a written reason, a ticket reference and an expiry, and
--    then writes one row into identity_break_glass_events and stops. Nothing reads that table for
--    authorization: not `has_effective_permission`, not `current_role()`, not one RLS policy --
--    only `get_identity_control_plane`, which lists it. The card in the admin console called it
--    "time-boxed elevated access" and said a profile was "receiving access", so an operator at 3am
--    could grant it, watch it succeed, and believe somebody could now do something they could not.
--
--    RELABELLED, not wired. Making this table confer permissions would add a live
--    privilege-escalation path -- a row that silently widens what a session can do -- and that is
--    not a change to make quietly in a P2 sweep on the way to a pilot. What the two-person rule,
--    the reason, the ticket and the expiry actually produce is an AUTHORIZATION RECORD, made at
--    the moment of the decision, which is worth having on its own. The access itself is granted the
--    way it always was: by changing the person's role, or through support impersonation, both of
--    which are separately audited. Every surface now says exactly that.

------------------------------------------------------------------------------------------------
-- 1. The limiter counts what the caller is answerable for
------------------------------------------------------------------------------------------------
alter table public.signup_attempts
  add column if not exists counts_toward_rate_limit boolean not null default true;

comment on column public.signup_attempts.counts_toward_rate_limit is
  'False when the attempt failed for a platform fault (unsent invitation, unreadable settings, '
  'unconfigured Turnstile). The per-email and per-IP caps count only rows where this is true, so '
  'an outage of ours cannot lock a prospective customer out for a day. BACKLOG.md I22.';

-- Historical rows, by the same rule the finalizer now applies.
update public.signup_attempts
set counts_toward_rate_limit = false
where not success
  and coalesce(error_code, '') in (
    'invite_failed', 'organization_create_failed', 'organization_slug_failed',
    'profile_update_failed', 'rate_limit_unavailable', 'settings_unavailable',
    'turnstile_not_configured', 'signup_disabled', 'unexpected_error', 'failed'
  );

-- finalize_signup_attempt, spliced from the deployed body: it stamps the attribution.
CREATE OR REPLACE FUNCTION public.finalize_signup_attempt(p_attempt_id uuid, p_success boolean, p_error_code text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with changed as (
    update public.signup_attempts
    set success = p_success,
        error_code = case when p_success then null else left(coalesce(p_error_code, 'failed'), 100) end,
        -- Who the failure belongs to. A platform fault must not spend the caller's daily quota;
        -- everything else -- success included -- does, because a second organization for one email
        -- address is exactly what the cap is for.
        counts_toward_rate_limit = p_success
          or coalesce(p_error_code, '') not in (
            'invite_failed', 'organization_create_failed', 'organization_slug_failed',
            'profile_update_failed', 'rate_limit_unavailable', 'settings_unavailable',
            'turnstile_not_configured', 'signup_disabled', 'unexpected_error', 'failed'
          )
    where id = p_attempt_id and error_code = 'reserved'
    returning 1
  )
  select exists(select 1 from changed);
$function$

;

-- reserve_signup_attempt, spliced from the deployed body: both caps read the attribution.
CREATE OR REPLACE FUNCTION public.reserve_signup_attempt(p_email_hash text, p_ip_hash text, p_max_ip_per_hour integer, p_max_email_per_day integer, p_max_orgs_per_day integer, p_legal_accepted boolean, p_service_agreement_version text, p_baa_version text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if p_email_hash !~ '^[0-9a-f]{64}$' or p_ip_hash !~ '^[0-9a-f]{64}$'
     or least(p_max_ip_per_hour, p_max_email_per_day, p_max_orgs_per_day) < 1 then
    raise exception 'invalid signup reservation' using errcode = '22023';
  end if;

  -- Fixed lock order serializes every quota dimension, including the global org cap.
  perform pg_advisory_xact_lock(hashtextextended('signup:global', 0));
  perform pg_advisory_xact_lock(hashtextextended('signup:ip:' || p_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('signup:email:' || p_email_hash, 0));

  if (select count(*) from public.signup_attempts
      where ip_hash = p_ip_hash and created_at >= now() - interval '1 hour'
        and counts_toward_rate_limit)
     >= p_max_ip_per_hour then
    raise exception 'signup_ip_rate_limited' using errcode = 'P0001';
  end if;
  -- Only attempts the CALLER is answerable for. This counted every row, including the ones that
  -- failed because the platform failed -- an unsent invitation while SMTP is misconfigured, a
  -- settings read that errored, a Turnstile secret that is not set. A first customer who tries
  -- three times during our outage was then refused for a day, by a limiter defending us against
  -- them for a fault that was ours. counts_toward_rate_limit carries the attribution, stamped
  -- when the attempt is finalized rather than re-derived here.
  if (select count(*) from public.signup_attempts
      where email_hash = p_email_hash and created_at >= now() - interval '1 day'
        and counts_toward_rate_limit)
     >= p_max_email_per_day then
    raise exception 'signup_email_rate_limited' using errcode = 'P0001';
  end if;
  if (
    (select count(*) from public.organizations where created_at >= now() - interval '1 day')
    + (select count(*) from public.signup_attempts
       where error_code = 'reserved' and created_at >= now() - interval '1 day')
  ) >= p_max_orgs_per_day then
    raise exception 'signup_organization_quota_reached' using errcode = 'P0001';
  end if;

  insert into public.signup_attempts(
    email_hash, ip_hash, success, error_code, legal_accepted,
    service_agreement_version, baa_version
  ) values (
    p_email_hash, p_ip_hash, false, 'reserved', p_legal_accepted,
    p_service_agreement_version, p_baa_version
  ) returning id into v_id;
  return v_id;
end;
$function$

;

revoke all on function public.finalize_signup_attempt(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.finalize_signup_attempt(uuid, boolean, text) to service_role;
revoke all on function public.reserve_signup_attempt(text, text, integer, integer, integer, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_signup_attempt(text, text, integer, integer, integer, boolean, text, text)
  to service_role;

------------------------------------------------------------------------------------------------
-- 2. Break-glass is an authorization record, and says so
------------------------------------------------------------------------------------------------
comment on table public.identity_break_glass_events is
  'Two-person authorization RECORD for emergency access: who asked, who approved, why, against '
  'which ticket, and until when, hashed at the moment of the decision. It confers no permissions '
  'and nothing reads it for authorization -- has_effective_permission, current_role() and every '
  'RLS policy are unaware of it. The access itself is granted separately (a role change, or '
  'support impersonation), each audited on its own. Wiring this table into authorization would '
  'create a row that silently widens a session, which is a deliberate decision nobody has taken. '
  'BACKLOG.md I22.';

comment on function public.grant_identity_break_glass(uuid, uuid, text, text, timestamptz) is
  'Records a two-person authorization for emergency access -- requester, approver, reason, ticket '
  'and expiry -- and returns its id. It does NOT change anyone''s permissions; see the comment on '
  'identity_break_glass_events. BACKLOG.md I22.';
