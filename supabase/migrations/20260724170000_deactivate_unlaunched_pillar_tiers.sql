-- PT-055: the Essentials/Professional pillar tiers were seeded active by
-- 20260724130000_modular_pillar_packages.sql, but they are not marketed
-- anywhere (the pricing page sells Train/CareBase/Portfolio only, and until
-- this branch it explicitly claimed "no per-module upsells"), and they are not
-- checkoutable (their prices are seeded without Stripe price mappings, so the
-- plan selector shows "Checkout is being configured"). Showing unlaunched,
-- un-buyable tiers in the customer-facing plan picker contradicts the
-- marketing site and erodes trust. Deactivate both packages and their display
-- prices until they are deliberately launched: marketed on the pricing page,
-- mapped to live Stripe prices, and re-activated in one reviewed change.
do $deactivate$
declare
  v_packages integer;
  v_prices integer;
begin
  update public.packages
  set is_active = false
  where name in ('CareMetric Essentials', 'CareMetric Professional')
    and is_active;
  get diagnostics v_packages = row_count;
  if v_packages <> 2 then
    raise exception 'Expected to deactivate exactly 2 unlaunched pillar tiers, updated %', v_packages;
  end if;

  update public.package_billing_prices pbp
  set is_active = false
  from public.packages p
  where pbp.package_id = p.id
    and p.name in ('CareMetric Essentials', 'CareMetric Professional')
    and pbp.is_active;
  get diagnostics v_prices = row_count;
  if v_prices <> 4 then
    raise exception 'Expected to deactivate exactly 4 unlaunched tier prices, updated %', v_prices;
  end if;
end;
$deactivate$;
