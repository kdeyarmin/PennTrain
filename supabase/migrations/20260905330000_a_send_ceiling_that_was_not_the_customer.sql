-- One more signup failure that is ours, not the customer's (I23, extending 20260905220000).
--
-- signup-organization used to answer every invite failure with the same sentence: "We could not
-- send an invitation to THAT EMAIL ADDRESS. If you already have an account, sign in or reset your
-- password instead." A mail hook down, SendGrid unreachable, our own send rate limit -- all of them
-- told a prospective customer their address was wrong and sent them to reset a password they had
-- never set. It now separates the three causes, which adds one error code the signup limiter has to
-- classify.
--
-- `invite_rate_limited` is OUR provider's send ceiling, so it joins the platform faults that do not
-- count against the caller's cap -- the whole point of 20260905220000. `invite_email_in_use` is
-- deliberately NOT on that list: a real person typing an address that already has an account is the
-- ordinary case the cap exists to bound, and making it free would make the signup form an
-- account-enumeration oracle with no budget.

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
            'invite_failed', 'invite_rate_limited', 'organization_create_failed',
            'organization_slug_failed', 'profile_update_failed', 'rate_limit_unavailable',
            'settings_unavailable', 'turnstile_not_configured', 'signup_disabled',
            'unexpected_error', 'failed'
          )
    where id = p_attempt_id and error_code = 'reserved'
    returning 1
  )
  select exists(select 1 from changed);
$function$;
