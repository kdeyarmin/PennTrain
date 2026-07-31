-- Flat self-serve pricing: remove per-person overages and included-quantity caps.
-- Aligns product billing (packages + package_billing_prices) with published marketing
-- list prices: CareMetric Train $239/mo flat, CareMetric CareBase $499/mo flat.
--
-- Stripe Price IDs are never mutated here. Draft rows (stripe_price_id is null) are
-- updated in place. Rows already mapped to a Stripe Price are archived and replaced
-- with a new draft flat configuration so ops can attach a new flat Stripe Price.

-- ---------------------------------------------------------------------------
-- Packages: strategy + display monthly amount
-- ---------------------------------------------------------------------------
update public.packages
set
  pricing_strategy = 'flat_rate',
  price_monthly_cents = case name
    when 'CareMetric Train' then 23900
    when 'CareMetric Essentials' then 29900
    when 'CareMetric Professional' then 39900
    when 'CareMetric CareBase' then 49900
    else price_monthly_cents
  end,
  updated_at = now()
where name in (
  'CareMetric Train',
  'CareMetric Essentials',
  'CareMetric Professional',
  'CareMetric CareBase'
);

-- ---------------------------------------------------------------------------
-- Convert active primary monthly/annual prices to flat; archive Stripe-mapped
-- graduated rows and replace them with draft flat configurations.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_base integer;
  v_display text;
  v_interval text;
  v_sort integer;
begin
  for r in
    select
      p.id as package_id,
      p.name as package_name,
      bp.id as price_id,
      bp.recurring_interval,
      bp.stripe_price_id,
      bp.base_amount_cents
    from public.packages p
    join public.package_billing_prices bp on bp.package_id = p.id
    where p.name in (
      'CareMetric Train',
      'CareMetric Essentials',
      'CareMetric Professional',
      'CareMetric CareBase'
    )
      and bp.effective_to is null
      and bp.recurring_interval in ('month', 'year')
      and bp.is_active = true
      and bp.is_primary = true
  loop
    v_interval := r.recurring_interval;
    v_base := case
      when r.package_name = 'CareMetric Train' and v_interval = 'month' then 23900
      when r.package_name = 'CareMetric Train' and v_interval = 'year' then 239000
      when r.package_name = 'CareMetric Essentials' and v_interval = 'month' then 29900
      when r.package_name = 'CareMetric Essentials' and v_interval = 'year' then 299000
      when r.package_name = 'CareMetric Professional' and v_interval = 'month' then 39900
      when r.package_name = 'CareMetric Professional' and v_interval = 'year' then 399000
      when r.package_name = 'CareMetric CareBase' and v_interval = 'month' then 49900
      when r.package_name = 'CareMetric CareBase' and v_interval = 'year' then 499000
      else r.base_amount_cents
    end;
    v_display := case
      when v_interval = 'year' then 'Annual subscription'
      else 'Monthly subscription'
    end;
    v_sort := case when v_interval = 'year' then 20 else 10 end;

    if r.stripe_price_id is null then
      update public.package_billing_prices
      set
        display_name = v_display,
        billing_metric = 'flat',
        pricing_model = 'flat',
        base_amount_cents = v_base,
        unit_amount_cents = null,
        included_quantity = 0,
        minimum_quantity = 1,
        maximum_quantity = 1,
        is_seat_based = false,
        is_primary = true,
        is_active = true,
        sort_order = v_sort,
        updated_at = now()
      where id = r.price_id;
    else
      -- Archive the graduated Stripe-mapped configuration; do not delete.
      update public.package_billing_prices
      set
        is_active = false,
        is_primary = false,
        effective_to = now(),
        updated_at = now()
      where id = r.price_id;

      insert into public.package_billing_prices (
        package_id,
        stripe_price_id,
        display_name,
        currency,
        recurring_interval,
        interval_count,
        billing_metric,
        pricing_model,
        base_amount_cents,
        unit_amount_cents,
        included_quantity,
        minimum_quantity,
        maximum_quantity,
        is_seat_based,
        is_primary,
        is_active,
        sort_order
      )
      values (
        r.package_id,
        null,
        v_display,
        'usd',
        v_interval,
        1,
        'flat',
        'flat',
        v_base,
        null,
        0,
        1,
        1,
        false,
        true,
        true,
        v_sort
      );
    end if;
  end loop;

  -- Deactivate any leftover non-primary active overage-style prices for the
  -- launch packages so they cannot be selected accidentally.
  update public.package_billing_prices bp
  set
    is_active = false,
    is_primary = false,
    effective_to = coalesce(bp.effective_to, now()),
    updated_at = now()
  from public.packages p
  where p.id = bp.package_id
    and p.name in (
      'CareMetric Train',
      'CareMetric Essentials',
      'CareMetric Professional',
      'CareMetric CareBase'
    )
    and bp.effective_to is null
    and bp.is_active = true
    and (
      bp.pricing_model = 'flat_plus_overage'
      or bp.billing_metric in ('active_learner', 'active_resident')
      or (bp.included_quantity > 0 and bp.unit_amount_cents is not null)
    )
    and not (bp.billing_metric = 'flat' and bp.pricing_model = 'flat');

  -- Ensure Train/CareBase still have active primary draft flats if a cadence
  -- was missing after conversion.
  insert into public.package_billing_prices (
    package_id, stripe_price_id, display_name, currency, recurring_interval,
    interval_count, billing_metric, pricing_model, base_amount_cents,
    unit_amount_cents, included_quantity, minimum_quantity, maximum_quantity,
    is_seat_based, is_primary, is_active, sort_order
  )
  select
    p.id,
    null,
    case when v.recurring_interval = 'year' then 'Annual subscription' else 'Monthly subscription' end,
    'usd',
    v.recurring_interval,
    1,
    'flat',
    'flat',
    v.base_amount_cents,
    null,
    0,
    1,
    1,
    false,
    true,
    true,
    v.sort_order
  from public.packages p
  cross join (values
    ('CareMetric Train'::text, 'month'::text, 23900, 10),
    ('CareMetric Train', 'year', 239000, 20),
    ('CareMetric CareBase', 'month', 49900, 10),
    ('CareMetric CareBase', 'year', 499000, 20)
  ) v(package_name, recurring_interval, base_amount_cents, sort_order)
  where p.name = v.package_name
    and not exists (
      select 1
      from public.package_billing_prices bp
      where bp.package_id = p.id
        and bp.recurring_interval = v.recurring_interval
        and bp.is_active
        and bp.is_primary
        and bp.effective_to is null
    );
end $$;

comment on column public.package_billing_prices.pricing_model is
  'flat = single subscription fee; flat_plus_overage / per_unit / graduated / volume remain supported for custom contracts but launch self-serve Train/CareBase use flat.';
