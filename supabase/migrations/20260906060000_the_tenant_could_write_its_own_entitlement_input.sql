-- The tenant could write its own entitlement input, and a suspension did not survive a webhook.
--
-- BACKLOG J76 (P0) and J77.
--
-- J76. `organizations_update` (20260704050042) admits an org_admin for their own row -- that is
-- the path Settings.tsx uses for `ai_features_enabled`, and it is deliberate. The only column
-- guard is this trigger, and it reverted four columns: subscription_status, package_id,
-- max_facilities, max_users. Everything else on the row was tenant-writable, and two of those
-- columns decide entitlement and identity posture:
--
--   * `trial_ends_at` is the whole trial-expiry branch of get_effective_entitlements
--     (20260724180000: `when a.billing_state = 'trial' and o.trial_ends_at <= p_as_of then
--     'past_due'`). One UPDATE to 2099 and every module resolves entitled for ever with no
--     subscription. H7 and H13 are about this column being NULL; neither noticed it was writable.
--   * `is_demo` (with `demo_seed_version`, which the check constraint requires alongside it)
--     turns OFF mandatory MFA for every privileged role in the tenant (get_my_mfa_policy,
--     20260729130000: "seeded / self-serve demo tenants stay password-only"), passes the BAA gate
--     for AI (app_private.org_ai_allowed: `coalesce(o.is_demo, false) or o.baa_version is not
--     null`), opens restore_demo_baseline(), makes the nightly restore_all_demo_baselines sweep
--     start inserting Sunrise fixtures into a real tenant, and makes
--     suppress_demo_notification_delivery drop every provider delivery.
--
-- `plan_name`, `slug` and `demo_reset_at` go with them: plan_name is what the admin console and
-- the billing page print, slug is what the demo seed keys on, demo_reset_at is the sweep's clock.
-- The escape hatches are unchanged -- a genuine platform_admin, or a trusted SECURITY DEFINER
-- writer that has set app.privileged_write.
--
-- What stays writable by an org_admin on their own row, and is meant to be: name, contact_*,
-- address/city/state/zip, ai_features_enabled. The BAA pair keeps its own trigger
-- (protect_organization_baa_fields, 20260725000000).
--
-- J77. "Suspend Organization" on /admin/organizations/:id wrote organizations.subscription_status
-- and nothing else. billing_accounts.state_source is stamped 'manual_suspension' only by the
-- AFTER INSERT trigger that creates the account row, so for every organization suspended through
-- the UI the webhook's preserve branch (`when a.billing_state = 'suspended' and a.state_source =
-- 'manual_suspension' then a.billing_state`) was false, and both the subscription and the invoice
-- branches of process_stripe_billing_event end by overwriting organizations.subscription_status
-- from billing_accounts. A tenant suspended for cause was reactivated by its own next invoice.paid
-- with no audit row that says "reactivated".
--
-- The fix is one RPC that owns both tables, so the state the webhook preserves is the state the
-- operator set. Reactivation restores the PROVIDER-derived state rather than a literal 'active':
-- writing 'active' to a lapsed trial made the admin list disagree with get_effective_entitlements,
-- which reads billing_accounts.

-- ---------------------------------------------------------------------------
-- J76 -- the column guard
-- ---------------------------------------------------------------------------

create or replace function public.protect_organization_subscription_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_platform_admin()
     or coalesce(current_setting('app.privileged_write', true), '') = 'on' then
    return new;
  end if;
  new.subscription_status := old.subscription_status;
  new.package_id := old.package_id;
  new.max_facilities := old.max_facilities;
  new.max_users := old.max_users;
  -- J76: the entitlement clock and the demo posture are not tenant-writable either.
  new.trial_ends_at := old.trial_ends_at;
  new.is_demo := old.is_demo;
  new.demo_seed_version := old.demo_seed_version;
  new.demo_reset_at := old.demo_reset_at;
  new.plan_name := old.plan_name;
  new.slug := old.slug;
  return new;
end;
$$;

comment on function public.protect_organization_subscription_fields() is
  'Reverts every commercially- or identity-load-bearing organizations column on a client UPDATE. '
  'organizations_update deliberately admits an org_admin for their own row (Settings writes '
  'ai_features_enabled through it), so this trigger is the only thing standing between a tenant '
  'and its own entitlement input: trial_ends_at drives get_effective_entitlements'' expiry branch, '
  'and is_demo/demo_seed_version switch off mandatory MFA, pass the AI BAA gate and arm the demo '
  'reseed. platform_admin and app.privileged_write remain the two escape hatches. BACKLOG J76.';

-- ---------------------------------------------------------------------------
-- J77 -- a suspension that survives the next webhook
-- ---------------------------------------------------------------------------

-- The Stripe status -> canonical billing_state mapping, lifted out of
-- process_stripe_billing_event so reactivation restores exactly the state the next webhook would
-- have written, instead of a literal 'active'.
create or replace function app_private.billing_state_for_provider_state(p_provider_state text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case coalesce(nullif(btrim(p_provider_state), ''), 'unknown')
    when 'trialing' then 'trial'
    when 'active' then 'active'
    when 'past_due' then 'past_due'
    when 'unpaid' then 'past_due'
    when 'canceled' then 'canceled'
    when 'incomplete_expired' then 'canceled'
    when 'paused' then 'suspended'
    when 'unknown' then 'trial'
    else 'past_due'
  end;
$$;

comment on function app_private.billing_state_for_provider_state(text) is
  'Canonical billing_state for a Stripe subscription status, matching the case expression in '
  'process_stripe_billing_event. A null/blank provider state means the tenant has never had a '
  'live subscription, which is ''trial'' -- the same default billing_accounts carries. Used by '
  'set_organization_suspension so lifting a suspension restores the provider-derived state rather '
  'than asserting ''active''. BACKLOG J77.';

revoke all on function app_private.billing_state_for_provider_state(text)
  from public, anon, authenticated;

create or replace function public.set_organization_suspension(
  p_organization_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations;
  v_account public.billing_accounts;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_restored text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform administrator may suspend or reactivate an organization'
      using errcode = '42501';
  end if;

  select * into v_org from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  if p_suspended and v_reason is null then
    -- billing_accounts already refuses a suspension with no reason
    -- (check (billing_state <> 'suspended' or suspension_reason is not null)); raise the readable
    -- error here rather than letting the constraint speak.
    raise exception 'A suspension reason is required' using errcode = '22023';
  end if;

  select * into v_account from public.billing_accounts where organization_id = p_organization_id for update;

  if p_suspended then
    update public.billing_accounts
    set billing_state = 'suspended',
        state_source = 'manual_suspension',
        suspension_reason = v_reason,
        updated_at = now()
    where organization_id = p_organization_id;
    v_restored := 'suspended';
  else
    -- Restore what the provider says, not 'active'. A tenant suspended while its trial had
    -- lapsed comes back past_due, which is what get_effective_entitlements already believes.
    v_restored := case
      when v_account.id is null then coalesce(v_org.subscription_status, 'trial')
      when v_account.state_source = 'manual_comp'
        and (v_account.comped_until is null or v_account.comped_until > now()) then 'comped'
      else app_private.billing_state_for_provider_state(v_account.provider_state)
    end;
    if v_restored = 'suspended' then
      -- The provider itself has the subscription paused; lifting the manual hold cannot
      -- contradict that, so hand it back to Stripe's own reason.
      update public.billing_accounts
      set state_source = 'stripe',
          suspension_reason = coalesce(suspension_reason, 'Stripe subscription paused'),
          updated_at = now()
      where organization_id = p_organization_id;
    else
      update public.billing_accounts
      set billing_state = v_restored,
          state_source = case when v_restored = 'comped' then 'manual_comp' else 'stripe' end,
          suspension_reason = null,
          updated_at = now()
      where organization_id = p_organization_id;
    end if;
  end if;

  perform set_config('app.privileged_write', 'on', true);
  update public.organizations
  set subscription_status = v_restored,
      updated_at = now()
  where id = p_organization_id
  returning * into v_org;
  perform set_config('app.privileged_write', '', true);

  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  values (
    p_organization_id,
    auth.uid(),
    case when p_suspended then 'organization_suspended' else 'organization_reactivated' end,
    'organizations',
    p_organization_id,
    jsonb_build_object(
      'reason', v_reason,
      'restoredState', v_restored,
      'previousState', v_account.billing_state
    )
  );

  return v_org;
end;
$$;

comment on function public.set_organization_suspension(uuid, boolean, text) is
  'Platform-admin suspension that survives the tenant''s next Stripe event. Writes '
  'billing_accounts (billing_state=suspended, state_source=manual_suspension, reason) as well as '
  'organizations.subscription_status, because process_stripe_billing_event preserves a suspension '
  'only when state_source says a human set it -- the admin page wrote organizations alone, so the '
  'next invoice.paid reactivated a tenant suspended for cause. Lifting the hold restores the '
  'provider-derived state (or a live comp), never a literal ''active''. BACKLOG J77.';

revoke all on function public.set_organization_suspension(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.set_organization_suspension(uuid, boolean, text) to authenticated;
