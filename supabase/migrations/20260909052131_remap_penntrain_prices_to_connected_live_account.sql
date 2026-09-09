-- The owner connected live account acct_19pJ0MCEZXcVOdjd for PennTrain.
-- The previous four IDs belong to a different account and cannot be used here.
-- New prices were created and read back through Stripe on 2026-09-09: USD,
-- per_unit/licensed, interval_count=1, one flat subscription quantity.
-- This only remaps the four verified launch rows before any provider billing
-- exists. Unexpected catalog or billing state aborts the transaction.
do $remap$
declare
  v_mapping record;
  v_actual record;
  v_count integer;
  v_old_count integer := 0;
  v_new_count integer := 0;
  v_updated integer;
  v_row_ids uuid[] := '{}';
  v_new_price_ids text[] := '{}';
begin
  lock table public.packages, public.package_billing_prices,
    public.billing_accounts, public.billing_subscriptions,
    public.billing_invoices, public.billing_provider_operations,
    public.audit_logs, app_private.stripe_billing_events in share row exclusive mode;

  for v_mapping in
    select * from (values
      ('CareMetric Train'::text, 'month'::text, 23900,
        'price_1U45VpB06O2UFlNzut6cm68i'::text, 'price_1UDdvDCEZXcVOdjdznrMHQt4'::text),
      ('CareMetric Train', 'year', 239000,
        'price_1U45VyB06O2UFlNzemp6VEok', 'price_1UDdvICEZXcVOdjdvcbLyuFa'),
      ('CareMetric CareBase', 'month', 49900,
        'price_1U45VsB06O2UFlNzQzxDjtM6', 'price_1UDdvOCEZXcVOdjd6rdSYEDT'),
      ('CareMetric CareBase', 'year', 499000,
        'price_1U45VzB06O2UFlNzZfcisHhS', 'price_1UDdvVCEZXcVOdjdfzqBmbFo')
    ) as mappings(package_name, recurring_interval, amount_cents, old_price_id, new_price_id)
  loop
    select count(*) into v_count
    from public.package_billing_prices bp
    join public.packages p on p.id = bp.package_id
    where p.name = v_mapping.package_name and p.is_active
      and bp.recurring_interval = v_mapping.recurring_interval
      and bp.is_active and bp.is_primary and bp.effective_to is null;
    if v_count <> 1 then
      raise exception 'PennTrain Stripe remap refused: expected one active primary row for % %',
        v_mapping.package_name, v_mapping.recurring_interval;
    end if;

    select bp.* into v_actual
    from public.package_billing_prices bp
    join public.packages p on p.id = bp.package_id
    where p.name = v_mapping.package_name and p.is_active
      and bp.recurring_interval = v_mapping.recurring_interval
      and bp.is_active and bp.is_primary and bp.effective_to is null;
    if v_actual.billing_metric is distinct from 'flat'
      or v_actual.pricing_model is distinct from 'flat'
      or v_actual.currency is distinct from 'usd'
      or v_actual.interval_count is distinct from 1
      or v_actual.base_amount_cents is distinct from v_mapping.amount_cents
      or v_actual.minimum_quantity is distinct from 1
      or v_actual.maximum_quantity is distinct from 1
      or v_actual.effective_from > now() then
      raise exception 'PennTrain Stripe remap refused: catalog changed for % %',
        v_mapping.package_name, v_mapping.recurring_interval;
    end if;
    if v_actual.stripe_price_id = v_mapping.old_price_id then
      v_old_count := v_old_count + 1;
    elsif v_actual.stripe_price_id = v_mapping.new_price_id then
      v_new_count := v_new_count + 1;
    else
      raise exception 'PennTrain Stripe remap refused: unexpected price ID for % %',
        v_mapping.package_name, v_mapping.recurring_interval;
    end if;
    v_row_ids := array_append(v_row_ids, v_actual.id);
    v_new_price_ids := array_append(v_new_price_ids, v_mapping.new_price_id);
  end loop;

  -- A completed remap is a no-op, including after billing subsequently starts.
  if v_new_count = 4 then return; end if;
  if v_old_count <> 4 then
    raise exception 'PennTrain Stripe remap refused: partially changed catalog';
  end if;
  if exists (
    select 1 from public.billing_accounts
    where stripe_customer_id is not null or state_source = 'stripe'
      or provider_event_id is not null or provider_event_created_at is not null
      or (provider_state is not null and provider_state <> 'legacy')
  ) or exists (select 1 from public.billing_subscriptions)
    or exists (select 1 from public.billing_invoices)
    or exists (select 1 from public.billing_provider_operations)
    or exists (select 1 from app_private.stripe_billing_events)
    -- Checkout can exist at Stripe before its customer/subscription webhook.
    -- Its audit receipt is sufficient to require an operator reconciliation.
    or exists (select 1 from public.audit_logs where action = 'billing_checkout_created') then
    raise exception 'PennTrain Stripe remap refused: provider billing already exists';
  end if;

  update public.package_billing_prices bp
  set stripe_price_id = mapped.price_id, updated_at = now()
  from unnest(v_row_ids, v_new_price_ids) as mapped(row_id, price_id)
  where bp.id = mapped.row_id;
  get diagnostics v_updated = row_count;
  if v_updated <> 4 then
    raise exception 'PennTrain Stripe remap refused: expected four updated rows, got %', v_updated;
  end if;
end
$remap$;
