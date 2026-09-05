-- A way back in after an invitation is revoked (Codex review of PR #484).
--
-- 20260905030000 made "Revoke" actually revoke. It did not give the manager who revoked by mistake
-- a way to undo it, and the reason is one migration further along than it looks: this function is
-- redefined a THIRD time in 20260905150000, so a fix written into the revoke migration would have
-- been silently overwritten by a later copy. It lives at the end of the series instead, where
-- nothing follows it -- which is also how the defect it fixes got in.
--
-- The mechanics, measured against a local GoTrue rather than assumed: POST /auth/v1/invite for an
-- UNCONFIRMED address answers 200 and reuses the SAME user id; only a CONFIRMED address is refused
-- with 422 email_exists. So the second invitation reached record_user_invitation_sent carrying a
-- user id already in user_invitation_lifecycle, whose invited_user_id is UNIQUE, and the plain
-- insert raised 23505. invite-user reads that as a lifecycle-receipt failure: it detaches the
-- employee, deletes the identity, and answers "Invite provisioning failed" -- so the manager was
-- told the product was broken, and if that compensating delete ever failed the address was stuck.

CREATE OR REPLACE FUNCTION public.record_user_invitation_sent(p_invited_user_id uuid, p_email text, p_first_name text, p_last_name text, p_invited_role text, p_organization_id uuid, p_employee_id uuid, p_redirect_to text, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_invited_role not in ('platform_admin','org_admin','facility_manager','trainer','employee','auditor') then
    raise exception 'Unsupported invited role' using errcode = '22023';
  end if;
  if p_invited_role <> 'platform_admin' and p_organization_id is null then
    raise exception 'Organization is required for this invitation' using errcode = '22023';
  end if;
  if p_employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.organization_id = p_organization_id
  ) then
    raise exception 'Employee is outside invitation scope' using errcode = '42501';
  end if;
  if p_created_by is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_created_by
      and (p.role = 'platform_admin' or p.organization_id is not distinct from p_organization_id)
  ) then
    raise exception 'Invitation creator is outside scope' using errcode = '42501';
  end if;

  insert into public.user_invitation_lifecycle(
    organization_id, employee_id, invited_user_id, email, first_name, last_name,
    invited_role, redirect_to, created_by
  ) values (
    p_organization_id, p_employee_id, p_invited_user_id, lower(btrim(p_email)),
    btrim(p_first_name), btrim(p_last_name), p_invited_role,
    nullif(btrim(coalesce(p_redirect_to, '')), ''), p_created_by
  )
  -- Revoking an unopened invitation leaves the auth identity in place (nobody has ever signed in
  -- to it, so there is nothing to delete on the person's behalf), and GoTrue re-invites an
  -- UNCONFIRMED address by reusing THE SAME user id -- measured, not assumed: POST /invite returns
  -- 200 with the original id, and only a CONFIRMED address gets 422 email_exists. So the second
  -- invitation arrived here carrying a user id this table already held, the plain insert raised
  -- 23505, and invite-user read that as a lifecycle-receipt failure: it detached the employee,
  -- deleted the identity and answered "Invite provisioning failed". The manager who revoked by
  -- mistake was told the product was broken, and if that compensating delete ever failed the
  -- address was stuck for good.
  --
  -- A revoked or delivery-failed invitation is exactly the one that SHOULD be re-openable, so the
  -- receipt reopens it: same identity, fresh window, send_count carried forward because it counts
  -- how many times this person has been written to. An accepted row is refused instead -- that
  -- person has an account, and GoTrue would have answered 422 before we ever got here.
  on conflict (invited_user_id) do update set
    organization_id = excluded.organization_id,
    employee_id = excluded.employee_id,
    email = excluded.email,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    invited_role = excluded.invited_role,
    redirect_to = excluded.redirect_to,
    created_by = excluded.created_by,
    status = 'sent',
    send_count = public.user_invitation_lifecycle.send_count + 1,
    last_sent_at = now(),
    expires_at = now() + interval '7 days',
    revoked_at = null,
    delivery_failed_at = null,
    last_error = null,
    updated_at = now()
  where public.user_invitation_lifecycle.status <> 'accepted'
  returning id into v_id;

  if v_id is null then
    raise exception 'That address has already accepted an invitation' using errcode = '23505';
  end if;

  return v_id;
end;
$function$

;

comment on function public.record_user_invitation_sent(uuid, text, text, text, text, uuid, uuid, text, uuid) is
  'Records an invitation send. Reopens a revoked or delivery_failed lifecycle row for the same '
  'identity rather than raising 23505, so an invitation revoked by mistake can simply be sent '
  'again; an accepted one is refused. BACKLOG.md I7.';
