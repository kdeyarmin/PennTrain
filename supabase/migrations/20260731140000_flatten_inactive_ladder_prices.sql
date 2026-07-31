-- Flatten inactive Essentials/Professional billing prices so reactivating a
-- mid-tier cannot resurrect base+overage checkout. Packages were already set to
-- flat_rate in 20260731131807; their inactive price rows still carried
-- active_resident / flat_plus_overage from the modular seed.

update public.package_billing_prices bp
set
  display_name = case
    when bp.recurring_interval = 'year' then 'Annual subscription'
    else 'Monthly subscription'
  end,
  billing_metric = 'flat',
  pricing_model = 'flat',
  base_amount_cents = case
    when p.name = 'CareMetric Essentials' and bp.recurring_interval = 'month' then 29900
    when p.name = 'CareMetric Essentials' and bp.recurring_interval = 'year' then 299000
    when p.name = 'CareMetric Professional' and bp.recurring_interval = 'month' then 39900
    when p.name = 'CareMetric Professional' and bp.recurring_interval = 'year' then 399000
    else bp.base_amount_cents
  end,
  unit_amount_cents = null,
  included_quantity = 0,
  minimum_quantity = 1,
  maximum_quantity = 1,
  is_seat_based = false,
  sort_order = case when bp.recurring_interval = 'year' then 20 else 10 end,
  updated_at = now()
from public.packages p
where p.id = bp.package_id
  and p.name in ('CareMetric Essentials', 'CareMetric Professional')
  and bp.recurring_interval in ('month', 'year')
  and bp.effective_to is null
  and (
    bp.billing_metric <> 'flat'
    or bp.pricing_model <> 'flat'
    or bp.unit_amount_cents is not null
    or bp.included_quantity <> 0
  );

-- Package descriptions still said "priced by active resident" from modular seed.
update public.packages
set
  description = case name
    when 'CareMetric Essentials' then
      'Training plus compliance operations for a single facility — flat monthly fee, unlimited residents and staff.'
    when 'CareMetric Professional' then
      'Training, compliance, workforce, and billing modules — flat monthly fee, unlimited residents and staff.'
    when 'CareMetric Train' then
      'Staff training, AI course creation, live classes, and training compliance — flat monthly fee, unlimited active learners.'
    when 'CareMetric CareBase' then
      'Complete care operations: training, clinical, workforce, facility, and survey readiness — flat monthly fee, unlimited residents and staff.'
    else description
  end,
  updated_at = now()
where name in (
  'CareMetric Train',
  'CareMetric Essentials',
  'CareMetric Professional',
  'CareMetric CareBase'
);
