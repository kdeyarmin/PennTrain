-- Revoking an invitation revoked nothing.
--
-- THE FINDING. `invite-user` provisions the account up front: it creates the auth user, writes the
-- profile with its target role and organization, and links `employees.profile_id` -- all before
-- the invitee has done anything. `revoke_user_invitation` then only wrote `status = 'revoked'` on
-- `user_invitation_lifecycle`, and nothing in Auth or RLS reads that ledger. So after a manager
-- clicked Revoke and saw "revoked", the invitee could still:
--
--   * open the original invitation link within its OTP window and set a password, or
--   * at any later time use /forgot-password -- GoTrue's recovery verify confirms an unconfirmed
--     user and mints a session -- set a password, and sign in
--
-- as an active `facility_manager` (or whatever role the invitation named), in the tenant. For an
-- employee invitation `employees.profile_id` also stayed linked, so the employee page kept
-- reporting "already has portal access" and offered no way to re-invite.
--
-- WHAT REVOCATION NOW DOES. Everything that makes the account unusable, in the same transaction:
-- the ledger row, `profiles.is_active = false`, every `auth.sessions` row for that user, and the
-- `employees.profile_id` link. Deactivation is the load-bearing part -- `current_profile_active()`
-- is consulted by RLS, so the account is refused on its next request no matter how it authenticates
-- -- and detaching the employee is what lets the same person be invited again later.
--
-- THE CASE THIS HAD TO GET RIGHT: an invitation that was already accepted. The ledger cannot be
-- trusted to know. `reconcile_user_invitation_lifecycle` runs on a daily cron (06:15), so an
-- invitation accepted an hour ago still reads `pending`, and deactivating that person would take a
-- working account away from someone who did nothing wrong -- turning a stale-ledger problem into
-- an outage for a real user. Auth knows, though: an invitee who has never signed in and never
-- confirmed their email has not accepted. So this function asks Auth rather than the ledger, and
-- when Auth says the invitation WAS accepted it reconciles the ledger to `accepted` and refuses
-- with a message naming the action that actually applies (deactivate the user). That is a
-- deliberate refusal, not a silent success: revoking an invitation and deactivating a working
-- account are different decisions and should not share a button.
--
-- Not addressed here, and recorded on BACKLOG I7 instead: the ledger advertises a 7-day expiry
-- while the emailed link dies at the project's `otp_expiry` (hosted default one hour). That is an
-- Auth dashboard setting plus copy, not something a migration can fix.
--
-- Rollback: restore the function from 20260731052300. That restores a revoke that leaves a usable
-- account behind.

create or replace function public.revoke_user_invitation(
  p_invitation_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.user_invitation_lifecycle%rowtype;
  v_role text := public.current_role();
  v_org uuid := public.current_org_id();
  v_signed_in_at timestamptz;
  v_confirmed_at timestamptz;
  v_user_exists boolean := false;
  v_deactivated boolean := false;
  v_employees_detached integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A revocation reason is required' using errcode = '22023';
  end if;

  select * into v_invitation
  from public.user_invitation_lifecycle
  where id = p_invitation_id
  for update;
  if v_invitation.id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if v_invitation.status in ('accepted', 'revoked') then
    raise exception 'Only pending invitations can be revoked' using errcode = '22023';
  end if;

  if not public.is_platform_admin() then
    if v_role not in ('org_admin', 'facility_manager') then
      raise exception 'Not authorized to revoke invitations' using errcode = '42501';
    end if;
    if v_invitation.organization_id is distinct from v_org then
      raise exception 'Invitation is outside your organization' using errcode = '42501';
    end if;
    if v_role = 'facility_manager' and v_invitation.invited_role not in ('trainer', 'employee') then
      raise exception 'Facility managers may only revoke trainer or employee invitations' using errcode = '42501';
    end if;
  end if;

  -- Ask Auth, not the ledger. The ledger's `accepted` status is reconciled by a daily cron, so a
  -- pending row is not evidence that the invitation is still outstanding.
  if v_invitation.invited_user_id is not null then
    select u.last_sign_in_at, u.email_confirmed_at, true
    into v_signed_in_at, v_confirmed_at, v_user_exists
    from auth.users u
    where u.id = v_invitation.invited_user_id;
  end if;

  if v_user_exists and (v_signed_in_at is not null or v_confirmed_at is not null) then
    -- Already accepted, whatever the ledger says. Refuse: taking a working account away is a
    -- different decision from withdrawing an unopened invitation, and it should not share a button.
    --
    -- The stale `sent` row is deliberately left alone rather than corrected here. A draft of this
    -- function updated it to `accepted` first and then raised, which reads well and does nothing:
    -- the raise rolls the function's own writes back, so the correction never survived the call.
    -- The pgTAP file caught it. Rather than trade the refusal for a success-shaped return value so
    -- a bookkeeping fix can commit -- which would risk the UI reporting "revoked" for an
    -- invitation it did not revoke -- the ledger is left to the daily reconcile that owns it.
    raise exception 'This invitation has already been accepted; deactivate the user instead'
      using errcode = '22023';
  end if;

  update public.user_invitation_lifecycle
  set status = 'revoked',
      revoked_at = now(),
      delivery_failed_at = null,
      accepted_at = null,
      last_error = left(btrim(p_reason), 2000),
      updated_at = now()
  where id = p_invitation_id;

  if v_user_exists then
    perform set_config('app.privileged_write', 'on', true);

    update public.profiles
    set is_active = false
    where id = v_invitation.invited_user_id
      and is_active;
    v_deactivated := found;

    -- Free the employee so the same person can be invited again; the employee record itself, and
    -- everything hanging off it, is untouched.
    update public.employees e
    set profile_id = null, updated_at = now()
    where e.profile_id = v_invitation.invited_user_id;
    get diagnostics v_employees_detached = row_count;

    perform set_config('app.privileged_write', 'off', true);

    -- Whatever it authenticated with, it stops here.
    delete from auth.sessions where user_id = v_invitation.invited_user_id;
  end if;

  return jsonb_build_object(
    'invitationId', p_invitation_id,
    'status', 'revoked',
    'revokedAt', now(),
    'invitedUserId', v_invitation.invited_user_id,
    'email', v_invitation.email,
    'profileDeactivated', v_deactivated,
    'employeeLinksCleared', v_employees_detached
  );
end;
$$;
