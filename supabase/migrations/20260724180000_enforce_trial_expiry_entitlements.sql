-- Enforce the 30-day free trial at entitlement-resolution time (PT-052).
--
-- Root cause: signup-organization stamps organizations.trial_ends_at, but
-- nothing ever read it. get_effective_entitlements treated billing_state
-- 'trial' as entitled with no cutoff and ensure_organization_billing_account()
-- creates every account in 'trial', so a lapsed trial kept full module access
-- indefinitely.
--
-- Fix: when a billing account still sits in 'trial', the organization's
-- trial_ends_at has passed, and no live subscription exists, the effective
-- billing state resolves to 'past_due' -- the same read-time downgrade already
-- used for expired grace and comped windows. 'past_due' is outside the
-- entitled set, so non-core modules are denied while core/shared-shell access
-- (tables absent from app_private.product_module_resources) is untouched.
--
-- Deliberately preserved:
--   * comped/active/grace accounts: the new branch only fires on 'trial'.
--   * a live Stripe subscription in its own trialing period keeps the account
--     entitled (billing_subscriptions row in trial/active/grace) even if the
--     in-app signup trial window has passed.
--   * platform-admin bypass: module access for platform admins short-circuits
--     in app_private.has_product_module() before entitlements are consulted,
--     and the cross-org inspection guard below is unchanged.
--   * the downgrade is read-time and reversible: completing checkout (webhook
--     moves the account to 'active') or a manual comp restores access with no
--     data migration.

create or replace function public.get_effective_entitlements(
  p_organization_id uuid default null,
  p_as_of timestamptz default now()
)
returns table (
  feature_key text,
  value_type text,
  entitlement_value jsonb,
  entitlement_source text,
  effective_from timestamptz,
  effective_to timestamptz,
  billing_state text,
  is_entitled boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := coalesce(p_organization_id, public.current_org_id());
  v_billing_state text;
begin
  if v_org_id is null then
    raise exception 'organization_id is required' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not public.is_platform_admin()
     and v_org_id <> public.current_org_id() then
    raise exception 'Cannot inspect another organization entitlement'
      using errcode = '42501';
  end if;

  select case
      when a.billing_state = 'grace' and a.grace_ends_at is not null and a.grace_ends_at <= p_as_of
        then 'past_due'
      when a.billing_state = 'comped' and a.comped_until is not null and a.comped_until <= p_as_of
        then coalesce(a.provider_state, 'canceled')
      -- Lapsed in-app trial with no live subscription: the signup trial window
      -- (organizations.trial_ends_at) is the only thing granting access, and it
      -- has ended.
      when a.billing_state = 'trial'
        and o.trial_ends_at is not null
        and o.trial_ends_at <= p_as_of
        and not exists (
          select 1 from public.billing_subscriptions s
          where s.organization_id = a.organization_id
            and s.billing_state in ('trial', 'active', 'grace')
        )
        then 'past_due'
      else a.billing_state
    end
  into v_billing_state
  from public.billing_accounts a
  join public.organizations o on o.id = a.organization_id
  where a.organization_id = v_org_id;

  return query
  select
    d.feature_key,
    d.value_type,
    resolved.entitlement_value,
    (case when g.id is not null then 'organization_' || g.decision
      when pe.id is not null then 'package'
      else 'default' end)
      || case when resolved.seat_capped then '+stripe_seat_cap' else '' end,
    coalesce(g.effective_from, pe.effective_from, d.created_at),
    case when g.id is not null then g.effective_to else pe.effective_to end,
    coalesce(v_billing_state, 'trial'),
    coalesce(v_billing_state, 'trial') in ('trial', 'active', 'grace', 'comped')
      and coalesce(g.decision, '') <> 'deny'
      and case d.value_type
        when 'boolean' then resolved.entitlement_value = 'true'::jsonb
        when 'integer' then coalesce((resolved.entitlement_value #>> '{}')::numeric, 0) > 0
        when 'decimal' then coalesce((resolved.entitlement_value #>> '{}')::numeric, 0) > 0
        when 'string' then length(resolved.entitlement_value #>> '{}') > 0
        else resolved.entitlement_value is not null
      end
  from public.feature_definitions d
  join public.organizations o on o.id = v_org_id
  left join lateral (
    select x.* from public.organization_entitlement_grants x
    where x.organization_id = v_org_id
      and x.feature_key = d.feature_key
      and x.effective_from <= p_as_of
      and (x.effective_to is null or x.effective_to > p_as_of)
    order by x.effective_from desc, x.created_at desc limit 1
  ) g on true
  left join lateral (
    select x.* from public.package_entitlements x
    where x.package_id = o.package_id
      and x.feature_key = d.feature_key
      and x.effective_from <= p_as_of
      and (x.effective_to is null or x.effective_to > p_as_of)
    order by x.effective_from desc, x.created_at desc limit 1
  ) pe on true
  left join lateral (
    select max(i.quantity)::integer seat_quantity
    from public.billing_subscriptions s
    join public.billing_subscription_items i
      on i.subscription_id = s.id and i.organization_id = s.organization_id
    join public.package_billing_prices bp
      on bp.stripe_price_id = i.stripe_price_id
     and bp.billing_metric in ('active_learner', 'active_user')
    where s.organization_id = v_org_id
      and s.billing_state in ('trial', 'active', 'grace')
      and (s.current_period_end is null or s.current_period_end > p_as_of)
  ) seats on true
  cross join lateral (
    select
      case
        when g.decision = 'deny' then null
        when d.feature_key = 'limits.learners' and seats.seat_quantity is not null then
          to_jsonb(least(
            (coalesce(g.entitlement_value, pe.entitlement_value, d.default_value) #>> '{}')::integer,
            seats.seat_quantity
          ))
        else coalesce(g.entitlement_value, pe.entitlement_value, d.default_value)
      end entitlement_value,
      case when d.feature_key = 'limits.learners' and seats.seat_quantity is not null
        then seats.seat_quantity <
          (coalesce(g.entitlement_value, pe.entitlement_value, d.default_value) #>> '{}')::integer
        else false end as seat_capped
  ) resolved
  where d.is_active
  order by d.feature_key;
end;
$$;
