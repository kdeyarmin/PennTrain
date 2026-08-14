-- Map live flat Stripe Price IDs onto the active primary package_billing_prices
-- rows for CareMetric Train and CareMetric CareBase (month + year).
--
-- These prices were created as simple per_unit recurring flats in livemode
-- acct_1SinLKB06O2UFlNz. See BILLING_MODEL.md, marketingPricing.ts, and
-- migration 20260731131807_flat_self_serve_pricing.sql (which left the draft
-- rows with stripe_price_id = null by design).
--
-- Idempotent: only updates rows that are active, primary, effective, flat,
-- and missing (or mismatched) the target stripe_price_id.

update public.package_billing_prices bp
set
  stripe_price_id = v.stripe_price_id,
  updated_at = now()
from public.packages p
cross join (values
  ('CareMetric Train'::text, 'month'::text, 'price_1U45VpB06O2UFlNzut6cm68i'::text),
  ('CareMetric Train', 'year', 'price_1U45VyB06O2UFlNzemp6VEok'),
  ('CareMetric CareBase', 'month', 'price_1U45VsB06O2UFlNzQzxDjtM6'),
  ('CareMetric CareBase', 'year', 'price_1U45VzB06O2UFlNzZfcisHhS')
) as v(package_name, recurring_interval, stripe_price_id)
where bp.package_id = p.id
  and p.name = v.package_name
  and bp.recurring_interval = v.recurring_interval
  and bp.is_active = true
  and bp.is_primary = true
  and bp.effective_to is null
  and bp.billing_metric = 'flat'
  and bp.pricing_model = 'flat'
  and (bp.stripe_price_id is distinct from v.stripe_price_id);
