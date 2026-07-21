-- Configurable hybrid subscription catalog.
--
-- The commercial model is deliberately split into:
--   * packages: positioning, modules, trial, and annual discount
--   * package_billing_prices: one effective-dated Stripe Price configuration per cadence
--
-- A package can be flat rate, per active learner/user/resident/facility, or a
-- base fee with included units and overage. Stripe Prices remain the provider
-- source of truth; the amounts here power transparent admin/customer display.

alter table public.packages
  add column description text not null default '',
  add column pricing_strategy text not null default 'hybrid'
    check (pricing_strategy in ('flat_rate', 'per_unit', 'hybrid', 'custom')),
  add column is_recommended boolean not null default false,
  add column contact_sales boolean not null default false,
  add column trial_days integer not null default 14 check (trial_days between 0 and 90),
  add column annual_discount_percent numeric(5,2) not null default 0
    check (annual_discount_percent between 0 and 50);

alter table public.package_billing_prices
  alter column stripe_price_id drop not null,
  add column display_name text not null default 'Subscription',
  add column billing_metric text not null default 'active_user'
    check (billing_metric in ('flat', 'active_learner', 'active_user', 'active_resident', 'facility')),
  add column pricing_model text not null default 'per_unit'
    check (pricing_model in ('flat', 'per_unit', 'graduated', 'volume', 'flat_plus_overage', 'custom')),
  add column base_amount_cents integer not null default 0 check (base_amount_cents >= 0),
  add column unit_amount_cents integer check (unit_amount_cents is null or unit_amount_cents >= 0),
  add column included_quantity integer not null default 0 check (included_quantity >= 0),
  add column is_primary boolean not null default true,
  add column sort_order integer not null default 0;

alter table public.billing_subscriptions
  add column quantity_sync_checked_at timestamptz,
  add column quantity_sync_status text not null default 'pending'
    check (quantity_sync_status in ('pending', 'synced', 'unmapped', 'out_of_range', 'failed')),
  add column quantity_sync_error_code text;

create index billing_subscriptions_quantity_sync_idx
  on public.billing_subscriptions(quantity_sync_checked_at asc nulls first)
  where billing_state in ('trial', 'active', 'grace', 'past_due');

create or replace function app_private.mark_billing_quantity_sync_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.billing_subscriptions
  set quantity_sync_checked_at = null,
      quantity_sync_status = 'pending',
      quantity_sync_error_code = null,
      updated_at = now()
  where id = case when tg_op = 'DELETE' then old.subscription_id else new.subscription_id end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function app_private.mark_billing_quantity_sync_pending()
  from public, anon, authenticated;

create trigger mark_billing_quantity_sync_pending
after insert or update or delete on public.billing_subscription_items
for each row execute function app_private.mark_billing_quantity_sync_pending();

with ranked_primary_prices as (
  select id,
    row_number() over (
      partition by package_id, recurring_interval, interval_count
      order by effective_from desc, created_at desc, id desc
    ) as priority
  from public.package_billing_prices
  where is_active and is_primary and effective_to is null
)
update public.package_billing_prices bp
set is_primary = false
from ranked_primary_prices ranked
where bp.id = ranked.id and ranked.priority > 1;

create unique index package_billing_prices_primary_cadence_uidx
  on public.package_billing_prices(package_id, recurring_interval, interval_count)
  where is_active and is_primary and effective_to is null;

comment on column public.package_billing_prices.stripe_price_id is
  'Optional while a price is being drafted. Checkout requires an active primary row with a Stripe Price ID.';
comment on column public.package_billing_prices.base_amount_cents is
  'Display amount for the recurring base fee. Stripe remains authoritative for invoicing.';
comment on column public.package_billing_prices.unit_amount_cents is
  'Display amount for each billable unit or overage unit. Stripe remains authoritative for invoicing.';
comment on column public.package_billing_prices.included_quantity is
  'Units included in the base fee for flat-plus-overage and graduated pricing.';

create or replace function app_private.normalize_package_billing_price()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.is_seat_based := new.billing_metric <> 'flat';
  if new.billing_metric = 'flat' then
    new.minimum_quantity := 1;
    new.maximum_quantity := 1;
    new.included_quantity := 0;
    new.pricing_model := 'flat';
  end if;
  return new;
end;
$$;

revoke all on function app_private.normalize_package_billing_price()
  from public, anon, authenticated;

create trigger normalize_package_billing_price
before insert or update on public.package_billing_prices
for each row execute function app_private.normalize_package_billing_price();

create or replace function app_private.protect_and_sync_package_billing_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.stripe_price_id is not null then
      raise exception 'Stripe-mapped billing prices must be archived, not deleted'
        using errcode = '55000';
    end if;
    return old;
  end if;
  if new.recurring_interval = 'month'
     and new.interval_count = 1
     and new.is_primary
     and new.is_active
     and new.effective_to is null then
    update public.packages
    set price_monthly_cents = new.base_amount_cents,
        updated_at = now()
    where id = new.package_id;
  end if;
  return new;
end;
$$;

revoke all on function app_private.protect_and_sync_package_billing_price()
  from public, anon, authenticated;

create trigger protect_and_sync_package_billing_price
after insert or update on public.package_billing_prices
for each row execute function app_private.protect_and_sync_package_billing_price();

create trigger protect_mapped_package_billing_price_delete
before delete on public.package_billing_prices
for each row execute function app_private.protect_and_sync_package_billing_price();

drop policy if exists package_billing_prices_write on public.package_billing_prices;
create policy package_billing_prices_write
on public.package_billing_prices
for all
to authenticated
using (
  (select public.is_platform_admin())
  and public.identity_assurance_is_current('billing_admin')
)
with check (
  (select public.is_platform_admin())
  and public.identity_assurance_is_current('billing_admin')
);

grant insert, update, delete on table public.package_billing_prices to authenticated;

-- Recommended launch catalog. The platform admin can revise every commercial
-- value later without a deploy. Learner/facility limits stay unlimited because
-- included quantities are a pricing concept, not a hard authorization limit.
update public.packages
set description = 'Compliance-first LMS with assignments, governed content, certificates, live sessions, and audit-ready training records.',
    pricing_strategy = 'hybrid',
    price_monthly_cents = 23900,
    learner_limit = null,
    facility_limit = null,
    is_recommended = false,
    contact_sales = false,
    trial_days = 14,
    annual_discount_percent = 16.67,
    sort_order = 10,
    updated_at = now()
where name = 'CareMetric Train';

update public.packages
set description = 'Complete care operations platform with CareMetric Train, resident records, workforce, compliance, incidents, evidence, and reporting.',
    pricing_strategy = 'hybrid',
    price_monthly_cents = 49900,
    learner_limit = null,
    facility_limit = null,
    is_recommended = true,
    contact_sales = false,
    trial_days = 14,
    annual_discount_percent = 16.67,
    sort_order = 20,
    updated_at = now()
where name = 'CareMetric CareBase';

insert into public.packages (
  name, description, pricing_strategy, price_monthly_cents, features,
  is_recommended, contact_sales, trial_days, annual_discount_percent,
  learner_limit, facility_limit, sort_order, is_active
)
values (
  'CareMetric Portfolio',
  'Multi-facility deployment with portfolio reporting, contract pricing, rollout support, and tailored commercial terms.',
  'custom', null, '{"modules.train":true,"modules.carebase":true}'::jsonb,
  false, true, 0, 0, null, null, 30, true
)
on conflict (name) do update set
  description = excluded.description,
  pricing_strategy = excluded.pricing_strategy,
  features = coalesce(public.packages.features, '{}'::jsonb) || excluded.features,
  contact_sales = true,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

-- Draft display prices intentionally omit Stripe IDs. A platform admin connects
-- each row to an immutable Stripe Price after the Product/Price is created.
insert into public.package_billing_prices (
  package_id, stripe_price_id, display_name, currency, recurring_interval,
  interval_count, billing_metric, pricing_model, base_amount_cents,
  unit_amount_cents, included_quantity, minimum_quantity, maximum_quantity,
  is_primary, is_active, sort_order
)
select p.id, null, v.display_name, 'usd', v.recurring_interval, 1,
  v.billing_metric, 'flat_plus_overage', v.base_amount_cents,
  v.unit_amount_cents, v.included_quantity, 1, null, true, true, v.sort_order
from public.packages p
cross join (values
  ('Monthly active learners'::text, 'month'::text, 'active_learner'::text, 23900, 400, 25, 10),
  ('Annual active learners'::text, 'year'::text, 'active_learner'::text, 239000, 4000, 25, 20)
) v(display_name, recurring_interval, billing_metric, base_amount_cents, unit_amount_cents, included_quantity, sort_order)
where p.name = 'CareMetric Train'
  and not exists (
    select 1 from public.package_billing_prices x
    where x.package_id = p.id
      and x.recurring_interval = v.recurring_interval
      and x.billing_metric = v.billing_metric
      and x.effective_to is null
  );

insert into public.package_billing_prices (
  package_id, stripe_price_id, display_name, currency, recurring_interval,
  interval_count, billing_metric, pricing_model, base_amount_cents,
  unit_amount_cents, included_quantity, minimum_quantity, maximum_quantity,
  is_primary, is_active, sort_order
)
select p.id, null, v.display_name, 'usd', v.recurring_interval, 1,
  v.billing_metric, 'flat_plus_overage', v.base_amount_cents,
  v.unit_amount_cents, v.included_quantity, 1, null, true, true, v.sort_order
from public.packages p
cross join (values
  ('Monthly active residents'::text, 'month'::text, 'active_resident'::text, 49900, 400, 25, 10),
  ('Annual active residents'::text, 'year'::text, 'active_resident'::text, 499000, 4000, 25, 20)
) v(display_name, recurring_interval, billing_metric, base_amount_cents, unit_amount_cents, included_quantity, sort_order)
where p.name = 'CareMetric CareBase'
  and not exists (
    select 1 from public.package_billing_prices x
    where x.package_id = p.id
      and x.recurring_interval = v.recurring_interval
      and x.billing_metric = v.billing_metric
      and x.effective_to is null
  );

-- One canonical, tenant-authorized measurement powers both the customer plan
-- preview and Checkout. Synthetic demo records and sandbox facilities are not
-- billable. The Edge Function calls this as service_role; authenticated callers
-- may inspect only their own organization unless they are platform admins.
create or replace function public.get_organization_billing_usage(
  p_organization_id uuid default null
)
returns table (
  active_learners bigint,
  active_users bigint,
  active_residents bigint,
  facilities bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := coalesce(p_organization_id, public.current_org_id());
begin
  if v_org_id is null then
    raise exception 'organization_id is required' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not public.is_platform_admin()
     and v_org_id <> public.current_org_id() then
    raise exception 'Cannot inspect another organization billing usage'
      using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.employees e
      where e.organization_id = v_org_id
        and e.status = 'active'
        and not e.is_synthetic) as active_learners,
    (select count(*) from public.profiles p
      where p.organization_id = v_org_id
        and p.is_active) as active_users,
    (select count(*) from public.residents r
      where r.organization_id = v_org_id
        and r.status = 'active'
        and not r.is_synthetic) as active_residents,
    (select count(*) from public.facilities f
      where f.organization_id = v_org_id
        and f.is_active
        and not f.is_sandbox) as facilities;
end;
$$;

revoke all on function public.get_organization_billing_usage(uuid) from public;
grant execute on function public.get_organization_billing_usage(uuid)
  to authenticated, service_role;

comment on function public.get_organization_billing_usage(uuid) is
  'Canonical billable quantities for an organization. Excludes synthetic records and sandbox facilities.';

-- Keep licensed Stripe subscription quantities aligned after checkout. The
-- worker changes only quantities that actually drifted and uses no proration,
-- so the latest measured snapshot applies to the next recurring invoice rather
-- than producing surprise mid-cycle credits or charges.
insert into app_private.system_job_definitions (
  job_key, display_name, description, execution_kind, expected_interval,
  freshness_sla, is_critical, retry_mode, operator_route
)
values (
  'billing-quantity-sync', 'Billing quantity synchronization',
  'Measures configured value metrics and synchronizes Stripe subscription item quantities',
  'edge_cron', interval '1 hour', interval '3 hours', true, 'automatic',
  '/admin/enterprise'
)
on conflict (job_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  execution_kind = excluded.execution_kind,
  expected_interval = excluded.expected_interval,
  freshness_sla = excluded.freshness_sla,
  is_critical = excluded.is_critical,
  retry_mode = excluded.retry_mode,
  operator_route = excluded.operator_route,
  updated_at = now();

select cron.unschedule('billing-quantity-sync')
where exists (
  select 1 from cron.job where jobname = 'billing-quantity-sync'
);

select cron.schedule(
  'billing-quantity-sync',
  '17 * * * *',
  $$ select net.http_post(
       url := 'https://xsqobvvreaovwibxwyvv.supabase.co/functions/v1/sync-billing-quantities',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Correlation-Id', gen_random_uuid()::text,
         'X-CareMetric-Cron-Secret', coalesce(
           (
             select decrypted_secret
             from vault.decrypted_secrets
             where name = 'cron_shared_secret'
             limit 1
           ),
           ''
         )
       ),
       body := jsonb_build_object('batchSize', 250)
     ); $$
);

-- Learner entitlements are capped only by learner/user-priced subscription
-- items. Resident- and facility-priced CareBase subscriptions never
-- accidentally turn the resident quantity into a learner-seat limit.
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
      else a.billing_state
    end
  into v_billing_state
  from public.billing_accounts a
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
