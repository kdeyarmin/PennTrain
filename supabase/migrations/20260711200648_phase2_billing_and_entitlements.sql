-- Phase 2 / recommendation #30: contractual billing and entitlement controls.
--
-- The legacy packages.features document remains as a rolling-deploy input, but
-- all authorization decisions below use typed, effective-dated rows. Release
-- flags, cohorts, and kill switches are intentionally independent tables: a
-- commercial entitlement can never turn code on, and a Stripe event can never
-- override an emergency disable.

create extension if not exists pgcrypto with schema extensions;

create or replace function app_private.feature_value_matches_type(
  p_value jsonb,
  p_value_type text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_value_type
    when 'boolean' then jsonb_typeof(p_value) = 'boolean'
    when 'integer' then jsonb_typeof(p_value) = 'number'
      and (p_value #>> '{}') ~ '^-?[0-9]+$'
    when 'decimal' then jsonb_typeof(p_value) = 'number'
    when 'string' then jsonb_typeof(p_value) = 'string'
    when 'json' then p_value is not null
    else false
  end;
$$;

revoke all on function app_private.feature_value_matches_type(jsonb, text)
  from public, anon, authenticated;

create or replace function app_private.try_uuid(p_value text)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when coalesce(p_value, '') ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      then p_value::uuid
    else null
  end;
$$;

create or replace function app_private.stripe_epoch(p_value text)
returns timestamptz
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when coalesce(p_value, '') ~ '^[0-9]+([.][0-9]+)?$'
      then pg_catalog.to_timestamp(p_value::double precision)
    else null
  end;
$$;

revoke all on function app_private.try_uuid(text),
  app_private.stripe_epoch(text)
  from public, anon, authenticated;

alter table public.organizations
  drop constraint if exists organizations_subscription_status_check;
alter table public.organizations
  add constraint organizations_subscription_status_check
  check (subscription_status in (
    'trial', 'active', 'grace', 'past_due', 'canceled', 'comped', 'suspended'
  ));

create table public.feature_definitions (
  feature_key text primary key
    check (feature_key ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  description text not null default '',
  value_type text not null
    check (value_type in ('boolean', 'integer', 'decimal', 'string', 'json')),
  default_value jsonb not null,
  limit_unit text,
  schema_version integer not null default 1 check (schema_version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_definitions_default_type_check
    check (app_private.feature_value_matches_type(default_value, value_type))
);

create table public.package_billing_prices (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  stripe_price_id text not null unique check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  recurring_interval text not null check (recurring_interval in ('month', 'year')),
  interval_count integer not null default 1 check (interval_count between 1 and 36),
  is_seat_based boolean not null default true,
  minimum_quantity integer not null default 1 check (minimum_quantity > 0),
  maximum_quantity integer check (maximum_quantity is null or maximum_quantity >= minimum_quantity),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index package_billing_prices_lookup_idx
  on public.package_billing_prices(package_id, is_active, effective_from desc);

create table public.package_entitlements (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  feature_key text not null references public.feature_definitions(feature_key) on delete restrict,
  entitlement_value jsonb not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  contract_reference text,
  source text not null default 'package'
    check (source in ('package', 'legacy_backfill', 'sales_contract', 'migration')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create unique index package_entitlements_current_uidx
  on public.package_entitlements(package_id, feature_key)
  where effective_to is null;
create index package_entitlements_effective_idx
  on public.package_entitlements(package_id, feature_key, effective_from desc);

create table public.organization_entitlement_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_key text not null references public.feature_definitions(feature_key) on delete restrict,
  decision text not null check (decision in ('grant', 'override', 'deny')),
  entitlement_value jsonb,
  reason text not null check (length(trim(reason)) between 1 and 500),
  contract_reference text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  check (
    (decision = 'deny' and entitlement_value is null)
    or (decision <> 'deny' and entitlement_value is not null)
  ),
  check (created_by is null or approved_by is null or created_by <> approved_by)
);
create unique index organization_entitlement_grants_current_uidx
  on public.organization_entitlement_grants(organization_id, feature_key)
  where effective_to is null;
create index organization_entitlement_grants_effective_idx
  on public.organization_entitlement_grants(organization_id, feature_key, effective_from desc);

create table public.release_flags (
  feature_key text primary key references public.feature_definitions(feature_key) on delete cascade,
  rollout_mode text not null default 'off' check (rollout_mode in ('off', 'cohort', 'global')),
  is_enabled boolean not null default false,
  owner text not null,
  expires_at timestamptz,
  change_reason text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_enabled or rollout_mode = 'off')
);

create table public.release_cohorts (
  id uuid primary key default gen_random_uuid(),
  cohort_key text not null unique check (cohort_key ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.organization_release_cohorts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cohort_id uuid not null references public.release_cohorts(id) on delete cascade,
  feature_key text not null references public.release_flags(feature_key) on delete cascade,
  assigned_at timestamptz not null default now(),
  expires_at timestamptz,
  assigned_by uuid references public.profiles(id),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, cohort_id, feature_key),
  check (expires_at is null or expires_at > assigned_at)
);
create index organization_release_cohorts_lookup_idx
  on public.organization_release_cohorts(organization_id, feature_key, expires_at);

create table public.feature_kill_switches (
  id uuid primary key default gen_random_uuid(),
  feature_key text not null references public.feature_definitions(feature_key) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  is_disabled boolean not null default true,
  reason text not null check (length(trim(reason)) between 1 and 500),
  activated_at timestamptz not null default now(),
  expires_at timestamptz,
  activated_by uuid references public.profiles(id),
  deactivated_at timestamptz,
  deactivated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > activated_at),
  check ((is_disabled and deactivated_at is null) or not is_disabled)
);
create unique index feature_kill_switches_global_current_uidx
  on public.feature_kill_switches(feature_key)
  where organization_id is null and is_disabled;
create unique index feature_kill_switches_org_current_uidx
  on public.feature_kill_switches(feature_key, organization_id)
  where organization_id is not null and is_disabled;

create table public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  stripe_customer_id text unique check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  billing_state text not null default 'trial'
    check (billing_state in ('trial', 'active', 'grace', 'past_due', 'canceled', 'comped', 'suspended')),
  provider_state text,
  state_source text not null default 'legacy'
    check (state_source in ('legacy', 'stripe', 'manual_comp', 'manual_suspension')),
  grace_ends_at timestamptz,
  comped_until timestamptz,
  suspension_reason text,
  provider_event_created_at timestamptz,
  provider_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (billing_state <> 'comped' or state_source = 'manual_comp'),
  check (billing_state <> 'suspended' or suspension_reason is not null)
);

create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  billing_account_id uuid not null references public.billing_accounts(id) on delete cascade,
  package_id uuid references public.packages(id) on delete restrict,
  stripe_subscription_id text not null unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  provider_status text not null,
  billing_state text not null
    check (billing_state in ('trial', 'active', 'grace', 'past_due', 'canceled', 'comped', 'suspended')),
  seat_quantity integer not null default 1 check (seat_quantity > 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  provider_event_created_at timestamptz not null,
  provider_event_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index billing_subscriptions_org_status_idx
  on public.billing_subscriptions(organization_id, billing_state, current_period_end desc);

create table public.billing_subscription_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null,
  stripe_subscription_item_id text not null unique,
  stripe_price_id text not null,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (subscription_id, organization_id)
    references public.billing_subscriptions(id, organization_id) on delete cascade
);
create index billing_subscription_items_org_idx
  on public.billing_subscription_items(organization_id, subscription_id);

create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid,
  stripe_subscription_id text,
  stripe_invoice_id text not null unique check (stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'),
  provider_status text not null,
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  amount_due bigint not null default 0 check (amount_due >= 0),
  amount_paid bigint not null default 0 check (amount_paid >= 0),
  amount_remaining bigint not null default 0 check (amount_remaining >= 0),
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  hosted_invoice_url text,
  provider_event_created_at timestamptz not null,
  provider_event_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (subscription_id, organization_id)
    references public.billing_subscriptions(id, organization_id) on delete restrict
);
create index billing_invoices_org_status_idx
  on public.billing_invoices(organization_id, provider_status, due_at desc);

insert into public.permission_definitions(permission_key, description, risk_level)
values
  ('billing.entitlements.read', 'Read typed contractual entitlements', 'sensitive'),
  ('billing.entitlements.manage', 'Manage package and tenant contractual entitlements', 'privileged'),
  ('billing.account.read', 'Read subscription, invoice, and reconciliation state', 'sensitive'),
  ('billing.account.manage', 'Create Checkout and Customer Portal sessions', 'privileged')
on conflict (permission_key) do nothing;

insert into public.role_template_permissions(role_template_id, permission_key)
select rt.id, p.permission_key
from public.role_templates rt
cross join lateral (
  select unnest(case rt.built_in_role
    when 'platform_admin' then array[
      'billing.entitlements.read', 'billing.entitlements.manage',
      'billing.account.read', 'billing.account.manage'
    ]::text[]
    when 'org_admin' then array[
      'billing.entitlements.read', 'billing.account.read', 'billing.account.manage'
    ]::text[]
    else array[]::text[]
  end) permission_key
) p
where rt.built_in_role in ('platform_admin', 'org_admin')
on conflict (role_template_id, permission_key) do nothing;

create table app_private.stripe_billing_events (
  event_id text primary key,
  event_type text not null,
  event_created_at timestamptz not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  organization_id uuid references public.organizations(id) on delete set null,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'applied', 'stale', 'ignored', 'failed')),
  correlation_id text not null,
  signature_verified_at timestamptz not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now()
);
create index stripe_billing_events_org_created_idx
  on app_private.stripe_billing_events(organization_id, event_created_at desc);
alter table app_private.stripe_billing_events enable row level security;
revoke all on table app_private.stripe_billing_events from public, anon, authenticated;
grant select, insert, update on table app_private.stripe_billing_events to service_role;

create or replace function app_private.validate_entitlement_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_value jsonb;
  v_row jsonb;
begin
  select d.value_type into v_type
  from public.feature_definitions d
  where d.feature_key = new.feature_key;

  v_row := to_jsonb(new);
  v_value := case
    when tg_table_name = 'package_entitlements' then v_row -> 'entitlement_value'
    when v_row ->> 'decision' = 'deny' then null
    else v_row -> 'entitlement_value'
  end;
  if v_value is not null and not app_private.feature_value_matches_type(v_value, v_type) then
    raise exception 'Entitlement value does not match feature type for %', new.feature_key
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app_private.validate_entitlement_value()
  from public, anon, authenticated;

create trigger validate_package_entitlement_value
before insert or update on public.package_entitlements
for each row execute function app_private.validate_entitlement_value();
create trigger validate_organization_entitlement_value
before insert or update on public.organization_entitlement_grants
for each row execute function app_private.validate_entitlement_value();

-- Seed typed definitions from every currently sold legacy feature, then add
-- first-class capacity limits. A compatibility trigger below handles packages
-- inserted by seed.sql after the migration chain has completed.
insert into public.feature_definitions (
  feature_key, display_name, description, value_type, default_value
)
select distinct on (j.key)
  j.key,
  initcap(replace(replace(j.key, '_', ' '), '.', ' ')),
  'Imported from the legacy package catalog',
  case jsonb_typeof(j.value)
    when 'boolean' then 'boolean'
    when 'number' then case when (j.value #>> '{}') ~ '^-?[0-9]+$' then 'integer' else 'decimal' end
    when 'string' then 'string'
    else 'json'
  end,
  case jsonb_typeof(j.value)
    when 'boolean' then 'false'::jsonb
    when 'number' then '0'::jsonb
    when 'string' then '""'::jsonb
    else '{}'::jsonb
  end
from public.packages p
cross join lateral jsonb_each(coalesce(p.features, '{}'::jsonb)) j
where j.key ~ '^[a-z][a-z0-9_.-]{1,99}$'
order by j.key, p.sort_order desc
on conflict (feature_key) do nothing;

insert into public.feature_definitions (
  feature_key, display_name, description, value_type, default_value, limit_unit
)
values
  ('limits.learners', 'Employee seat limit', 'Maximum active employee seats', 'integer', '0'::jsonb, 'employees'),
  ('limits.facilities', 'Facility limit', 'Maximum active facilities', 'integer', '0'::jsonb, 'facilities'),
  ('integrations.api', 'Integration API', 'Tenant-scoped versioned API access', 'boolean', 'false'::jsonb, null),
  ('integrations.webhooks', 'Integration webhooks', 'Signed outbound event delivery', 'boolean', 'false'::jsonb, null),
  ('billing.customer_portal', 'Billing portal', 'Stripe Customer Portal access', 'boolean', 'false'::jsonb, null)
on conflict (feature_key) do nothing;

insert into public.package_entitlements (
  package_id, feature_key, entitlement_value, effective_from, source
)
select p.id, j.key, j.value, p.created_at, 'legacy_backfill'
from public.packages p
cross join lateral jsonb_each(coalesce(p.features, '{}'::jsonb)) j
join public.feature_definitions d on d.feature_key = j.key
on conflict (package_id, feature_key) where effective_to is null do nothing;

insert into public.package_entitlements (
  package_id, feature_key, entitlement_value, effective_from, source
)
select p.id, v.feature_key, to_jsonb(v.limit_value), p.created_at, 'legacy_backfill'
from public.packages p
cross join lateral (values
  ('limits.learners'::text, coalesce(p.learner_limit, 2147483647)),
  ('limits.facilities'::text, coalesce(p.facility_limit, 2147483647))
) v(feature_key, limit_value)
on conflict (package_id, feature_key) where effective_to is null do nothing;

create or replace function app_private.ingest_legacy_package_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_type text;
  v_now timestamptz := statement_timestamp();
begin
  if auth.uid() is not null then
    if not public.is_platform_admin()
       or not public.identity_assurance_is_current('billing_admin') then
      raise exception 'AAL2 platform administration is required for legacy package contract changes'
        using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE'
     and new.features is not distinct from old.features
     and new.learner_limit is not distinct from old.learner_limit
     and new.facility_limit is not distinct from old.facility_limit then
    return new;
  end if;

  for v_item in select key, value from jsonb_each(coalesce(new.features, '{}'::jsonb)) loop
    if v_item.key !~ '^[a-z][a-z0-9_.-]{1,99}$' then
      raise exception 'Invalid legacy feature key: %', v_item.key using errcode = '22023';
    end if;
    v_type := case jsonb_typeof(v_item.value)
      when 'boolean' then 'boolean'
      when 'number' then case when (v_item.value #>> '{}') ~ '^-?[0-9]+$' then 'integer' else 'decimal' end
      when 'string' then 'string'
      else 'json'
    end;
    insert into public.feature_definitions (
      feature_key, display_name, description, value_type, default_value
    ) values (
      v_item.key,
      initcap(replace(replace(v_item.key, '_', ' '), '.', ' ')),
      'Imported from the legacy package catalog',
      v_type,
      case v_type when 'boolean' then 'false'::jsonb when 'integer' then '0'::jsonb
        when 'decimal' then '0'::jsonb when 'string' then '""'::jsonb else '{}'::jsonb end
    ) on conflict (feature_key) do nothing;

    update public.package_entitlements
    set effective_to = v_now, updated_at = v_now
    where package_id = new.id and feature_key = v_item.key and effective_to is null;
    insert into public.package_entitlements (
      package_id, feature_key, entitlement_value, effective_from, source
    ) values (new.id, v_item.key, v_item.value, v_now, 'legacy_backfill');
  end loop;

  for v_item in select * from (values
    ('limits.learners'::text, coalesce(new.learner_limit, 2147483647)),
    ('limits.facilities'::text, coalesce(new.facility_limit, 2147483647))
  ) q(key, limit_value) loop
    update public.package_entitlements
    set effective_to = v_now, updated_at = v_now
    where package_id = new.id and feature_key = v_item.key and effective_to is null;
    insert into public.package_entitlements (
      package_id, feature_key, entitlement_value, effective_from, source
    ) values (new.id, v_item.key, to_jsonb(v_item.limit_value), v_now, 'legacy_backfill');
  end loop;
  return new;
end;
$$;
revoke all on function app_private.ingest_legacy_package_contract()
  from public, anon, authenticated;
create trigger ingest_legacy_package_contract
after insert or update of features, learner_limit, facility_limit on public.packages
for each row execute function app_private.ingest_legacy_package_contract();

create or replace function app_private.protect_organization_billing_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and (
    new.package_id is distinct from old.package_id
    or new.subscription_status is distinct from old.subscription_status
    or new.plan_name is distinct from old.plan_name
    or new.max_facilities is distinct from old.max_facilities
    or new.max_users is distinct from old.max_users
  ) then
    if not public.is_platform_admin()
       or not public.identity_assurance_is_current('billing_admin') then
      raise exception 'AAL2 platform administration is required for organization billing contract changes'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.protect_organization_billing_contract()
  from public, anon, authenticated;
create trigger protect_organization_billing_contract
before update of package_id, subscription_status, plan_name, max_facilities, max_users
on public.organizations
for each row execute function app_private.protect_organization_billing_contract();

insert into public.billing_accounts (
  organization_id, billing_state, provider_state, state_source, suspension_reason
)
select
  o.id,
  case o.subscription_status
    when 'trial' then 'trial'
    when 'active' then 'active'
    when 'grace' then 'grace'
    when 'past_due' then 'past_due'
    when 'canceled' then 'canceled'
    when 'comped' then 'comped'
    when 'suspended' then 'suspended'
    else 'trial'
  end,
  'legacy',
  case when o.subscription_status = 'comped' then 'manual_comp'
    when o.subscription_status = 'suspended' then 'manual_suspension'
    else 'legacy' end,
  case when o.subscription_status = 'suspended'
    then 'Imported legacy tenant suspension' else null end
from public.organizations o
on conflict (organization_id) do nothing;

create or replace function app_private.ensure_organization_billing_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.billing_accounts (
    organization_id, billing_state, provider_state, state_source, suspension_reason
  ) values (
    new.id, new.subscription_status, 'legacy',
    case when new.subscription_status = 'comped' then 'manual_comp'
      when new.subscription_status = 'suspended' then 'manual_suspension'
      else 'legacy' end,
    case when new.subscription_status = 'suspended' then 'New tenant suspension' else null end
  ) on conflict (organization_id) do nothing;
  return new;
end;
$$;
revoke all on function app_private.ensure_organization_billing_account()
  from public, anon, authenticated;
create trigger ensure_organization_billing_account
after insert on public.organizations
for each row execute function app_private.ensure_organization_billing_account();

-- Typed contractual evaluation. Organization grants override package terms,
-- while release and operational controls are evaluated only by the separate
-- evaluate_feature_access() command below.
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
    select max(s.seat_quantity)::integer seat_quantity
    from public.billing_subscriptions s
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

create or replace function public.has_effective_entitlement(
  p_organization_id uuid,
  p_feature_key text,
  p_required_quantity bigint default 1,
  p_as_of timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_or(
    e.is_entitled and case e.value_type
      when 'integer' then (e.entitlement_value #>> '{}')::numeric >= p_required_quantity
      when 'decimal' then (e.entitlement_value #>> '{}')::numeric >= p_required_quantity
      else true
    end
  ), false)
  from public.get_effective_entitlements(p_organization_id, p_as_of) e
  where e.feature_key = p_feature_key;
$$;

create or replace function public.evaluate_feature_access(
  p_organization_id uuid,
  p_feature_key text,
  p_required_quantity bigint default 1,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entitled boolean;
  v_release boolean := false;
  v_killed boolean := false;
  v_mode text := 'off';
begin
  v_entitled := public.has_effective_entitlement(
    p_organization_id, p_feature_key, p_required_quantity, p_as_of
  );
  select r.rollout_mode,
    r.is_enabled and (r.expires_at is null or r.expires_at > p_as_of)
  into v_mode, v_release
  from public.release_flags r where r.feature_key = p_feature_key;

  if coalesce(v_release, false) and v_mode = 'cohort' then
    select exists (
      select 1
      from public.organization_release_cohorts a
      join public.release_cohorts c on c.id = a.cohort_id
      where a.organization_id = p_organization_id
        and a.feature_key = p_feature_key
        and c.is_active
        and (c.starts_at is null or c.starts_at <= p_as_of)
        and (c.ends_at is null or c.ends_at > p_as_of)
        and (a.expires_at is null or a.expires_at > p_as_of)
    ) into v_release;
  elsif v_mode <> 'global' then
    v_release := false;
  end if;

  select exists (
    select 1 from public.feature_kill_switches k
    where k.feature_key = p_feature_key
      and k.is_disabled
      and (k.organization_id is null or k.organization_id = p_organization_id)
      and (k.expires_at is null or k.expires_at > p_as_of)
  ) into v_killed;

  return jsonb_build_object(
    'schemaVersion', 1,
    'organizationId', p_organization_id,
    'featureKey', p_feature_key,
    'entitled', v_entitled,
    'releaseMode', coalesce(v_mode, 'off'),
    'released', coalesce(v_release, false),
    'killed', v_killed,
    'allowed', v_entitled and coalesce(v_release, false) and not v_killed,
    'evaluatedAt', p_as_of
  );
end;
$$;

create or replace function public.process_stripe_billing_event(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_payload jsonb,
  p_payload_sha256 text,
  p_correlation_id text
)
returns table (
  was_duplicate boolean,
  was_applied boolean,
  was_stale boolean,
  resolved_organization_id uuid,
  canonical_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object jsonb := p_payload #> '{data,object}';
  v_org_id uuid;
  v_customer_id text;
  v_subscription_id text;
  v_package_id uuid;
  v_account_id uuid;
  v_subscription_pk uuid;
  v_provider_status text;
  v_state text;
  v_count integer := 0;
  v_applied boolean := false;
  v_stale boolean := false;
  v_existing app_private.stripe_billing_events%rowtype;
begin
  if nullif(trim(p_event_id), '') is null
     or nullif(trim(p_event_type), '') is null
     or p_event_created_at is null
     or p_payload is null
     or p_payload_sha256 !~ '^[0-9a-f]{64}$'
     or nullif(trim(p_correlation_id), '') is null then
    raise exception 'Invalid signed Stripe event envelope' using errcode = '22023';
  end if;

  insert into app_private.stripe_billing_events (
    event_id, event_type, event_created_at, payload_sha256, payload,
    correlation_id, signature_verified_at
  ) values (
    p_event_id, p_event_type, p_event_created_at, p_payload_sha256, p_payload,
    left(p_correlation_id, 200), clock_timestamp()
  ) on conflict (event_id) do nothing;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    select * into v_existing
    from app_private.stripe_billing_events e where e.event_id = p_event_id;
    if v_existing.payload_sha256 <> p_payload_sha256 then
      raise exception 'Stripe event id was reused with different content'
        using errcode = '23505';
    end if;
    return query select true, false,
      v_existing.processing_status = 'stale',
      v_existing.organization_id,
      (select a.billing_state from public.billing_accounts a
       where a.organization_id = v_existing.organization_id);
    return;
  end if;

  v_customer_id := nullif(v_object->>'customer', '');
  v_subscription_id := nullif(coalesce(v_object->>'subscription',
    case when p_event_type like 'customer.subscription.%' then v_object->>'id' end), '');
  v_org_id := app_private.try_uuid(v_object #>> '{metadata,organization_id}');
  if v_org_id is null then
    v_org_id := app_private.try_uuid(v_object->>'client_reference_id');
  end if;
  if v_org_id is null and v_customer_id is not null then
    select a.organization_id into v_org_id
    from public.billing_accounts a where a.stripe_customer_id = v_customer_id;
  end if;
  if v_org_id is null and v_subscription_id is not null then
    select s.organization_id into v_org_id
    from public.billing_subscriptions s
    where s.stripe_subscription_id = v_subscription_id;
  end if;

  update app_private.stripe_billing_events
  set organization_id = v_org_id
  where event_id = p_event_id;

  if v_org_id is null then
    update app_private.stripe_billing_events
    set processing_status = 'ignored', processed_at = now(),
        processing_error = 'No tenant mapping in signed event'
    where event_id = p_event_id;
    return query select false, false, false, null::uuid, null::text;
    return;
  end if;

  insert into public.billing_accounts (
    organization_id, stripe_customer_id, billing_state, provider_state,
    state_source, provider_event_created_at, provider_event_id
  ) values (
    v_org_id, v_customer_id, 'trial', 'uninitialized', 'stripe',
    null, null
  )
  on conflict (organization_id) do update set
    stripe_customer_id = coalesce(excluded.stripe_customer_id, public.billing_accounts.stripe_customer_id),
    updated_at = now()
  where public.billing_accounts.stripe_customer_id is null
     or public.billing_accounts.stripe_customer_id = excluded.stripe_customer_id;

  select a.id into v_account_id
  from public.billing_accounts a where a.organization_id = v_org_id;
  if v_customer_id is not null and exists (
    select 1 from public.billing_accounts a
    where a.id = v_account_id and a.stripe_customer_id is not null
      and a.stripe_customer_id <> v_customer_id
  ) then
    raise exception 'Stripe customer is already bound to a different tenant account'
      using errcode = '42501';
  end if;

  if p_event_type = 'checkout.session.completed' then
    v_applied := true;
  elsif p_event_type like 'customer.subscription.%' then
    v_provider_status := coalesce(v_object->>'status',
      case when p_event_type = 'customer.subscription.deleted' then 'canceled' else 'unknown' end);
    v_state := case v_provider_status
      when 'trialing' then 'trial'
      when 'active' then 'active'
      when 'past_due' then case
        when p_event_created_at + interval '7 days' > now() then 'grace'
        else 'past_due' end
      when 'unpaid' then 'past_due'
      when 'canceled' then 'canceled'
      when 'incomplete_expired' then 'canceled'
      when 'paused' then 'suspended'
      else 'past_due'
    end;
    v_package_id := app_private.try_uuid(v_object #>> '{metadata,package_id}');
    if exists (
      select 1 from public.billing_subscriptions s
      where s.stripe_subscription_id = v_object->>'id'
        and s.organization_id <> v_org_id
    ) then
      raise exception 'Stripe subscription is already bound to another tenant'
        using errcode = '42501';
    end if;

    insert into public.billing_subscriptions (
      organization_id, billing_account_id, package_id, stripe_subscription_id,
      provider_status, billing_state, seat_quantity, current_period_start,
      current_period_end, trial_ends_at, cancel_at_period_end, canceled_at,
      provider_event_created_at, provider_event_id
    ) values (
      v_org_id, v_account_id, v_package_id, v_object->>'id',
      v_provider_status, v_state,
      greatest(coalesce((v_object #>> '{items,data,0,quantity}')::integer, 1), 1),
      app_private.stripe_epoch(v_object->>'current_period_start'),
      app_private.stripe_epoch(v_object->>'current_period_end'),
      app_private.stripe_epoch(v_object->>'trial_end'),
      coalesce((v_object->>'cancel_at_period_end')::boolean, false),
      app_private.stripe_epoch(v_object->>'canceled_at'),
      p_event_created_at, p_event_id
    )
    on conflict (stripe_subscription_id) do update set
      package_id = coalesce(excluded.package_id, public.billing_subscriptions.package_id),
      provider_status = excluded.provider_status,
      billing_state = excluded.billing_state,
      seat_quantity = excluded.seat_quantity,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      trial_ends_at = excluded.trial_ends_at,
      cancel_at_period_end = excluded.cancel_at_period_end,
      canceled_at = excluded.canceled_at,
      provider_event_created_at = excluded.provider_event_created_at,
      provider_event_id = excluded.provider_event_id,
      updated_at = now()
    where (excluded.provider_event_created_at, excluded.provider_event_id)
      > (public.billing_subscriptions.provider_event_created_at,
         public.billing_subscriptions.provider_event_id)
    returning id into v_subscription_pk;
    get diagnostics v_count = row_count;
    v_applied := v_count > 0;
    v_stale := not v_applied;

    if v_applied then
      delete from public.billing_subscription_items
      where subscription_id = v_subscription_pk;
      insert into public.billing_subscription_items (
        organization_id, subscription_id, stripe_subscription_item_id,
        stripe_price_id, quantity
      )
      select
        v_org_id, v_subscription_pk, item->>'id', item #>> '{price,id}',
        greatest(coalesce((item->>'quantity')::integer, 1), 1)
      from jsonb_array_elements(coalesce(v_object #> '{items,data}', '[]'::jsonb)) item
      where nullif(item->>'id', '') is not null
        and nullif(item #>> '{price,id}', '') is not null;

      update public.billing_accounts a
      set
        stripe_customer_id = coalesce(v_customer_id, a.stripe_customer_id),
        provider_state = v_provider_status,
        billing_state = case
          when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.billing_state
          when a.billing_state = 'comped' and (a.comped_until is null or a.comped_until > now()) then a.billing_state
          else v_state end,
        state_source = case
          when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.state_source
          when a.billing_state = 'comped' and (a.comped_until is null or a.comped_until > now()) then a.state_source
          else 'stripe' end,
        grace_ends_at = case when v_state = 'grace' then p_event_created_at + interval '7 days' else null end,
        comped_until = case
          when a.billing_state = 'comped' and a.state_source = 'manual_comp'
            and (a.comped_until is null or a.comped_until > now()) then a.comped_until
          else null end,
        suspension_reason = case
          when a.billing_state = 'suspended' and a.state_source = 'manual_suspension'
            then a.suspension_reason
          when v_state = 'suspended' then 'Stripe subscription paused'
          else null end,
        provider_event_created_at = p_event_created_at,
        provider_event_id = p_event_id,
        updated_at = now()
      where a.id = v_account_id
        and (a.provider_event_created_at is null
          or (p_event_created_at, p_event_id) > (a.provider_event_created_at, a.provider_event_id));

      update public.organizations o
      set package_id = coalesce(v_package_id, o.package_id),
          plan_name = coalesce((select p.name from public.packages p where p.id = v_package_id), o.plan_name),
          subscription_status = (select a.billing_state from public.billing_accounts a where a.id = v_account_id),
          updated_at = now()
      where o.id = v_org_id;
    end if;
  elsif p_event_type like 'invoice.%' then
    v_subscription_id := nullif(v_object->>'subscription', '');
    select s.id into v_subscription_pk
    from public.billing_subscriptions s
    where s.stripe_subscription_id = v_subscription_id;
    v_provider_status := coalesce(v_object->>'status', replace(p_event_type, 'invoice.', ''));
    if exists (
      select 1 from public.billing_invoices i
      where i.stripe_invoice_id = v_object->>'id'
        and i.organization_id <> v_org_id
    ) then
      raise exception 'Stripe invoice is already bound to another tenant'
        using errcode = '42501';
    end if;

    insert into public.billing_invoices (
      organization_id, subscription_id, stripe_subscription_id, stripe_invoice_id,
      provider_status, currency, amount_due, amount_paid, amount_remaining,
      issued_at, due_at, paid_at, hosted_invoice_url,
      provider_event_created_at, provider_event_id
    ) values (
      v_org_id, v_subscription_pk, v_subscription_id, v_object->>'id',
      v_provider_status, lower(coalesce(v_object->>'currency', 'usd')),
      greatest(coalesce((v_object->>'amount_due')::bigint, 0), 0),
      greatest(coalesce((v_object->>'amount_paid')::bigint, 0), 0),
      greatest(coalesce((v_object->>'amount_remaining')::bigint, 0), 0),
      app_private.stripe_epoch(v_object->>'created'),
      app_private.stripe_epoch(v_object->>'due_date'),
      app_private.stripe_epoch(v_object #>> '{status_transitions,paid_at}'),
      nullif(v_object->>'hosted_invoice_url', ''),
      p_event_created_at, p_event_id
    )
    on conflict (stripe_invoice_id) do update set
      subscription_id = coalesce(excluded.subscription_id, public.billing_invoices.subscription_id),
      provider_status = excluded.provider_status,
      amount_due = excluded.amount_due,
      amount_paid = excluded.amount_paid,
      amount_remaining = excluded.amount_remaining,
      due_at = excluded.due_at,
      paid_at = excluded.paid_at,
      hosted_invoice_url = excluded.hosted_invoice_url,
      provider_event_created_at = excluded.provider_event_created_at,
      provider_event_id = excluded.provider_event_id,
      updated_at = now()
    where (excluded.provider_event_created_at, excluded.provider_event_id)
      > (public.billing_invoices.provider_event_created_at,
         public.billing_invoices.provider_event_id);
    get diagnostics v_count = row_count;
    v_applied := v_count > 0;
    v_stale := not v_applied;

    if v_applied and p_event_type in ('invoice.payment_failed', 'invoice.payment_succeeded', 'invoice.paid') then
      v_state := case when p_event_type = 'invoice.payment_failed' then 'grace' else 'active' end;
      update public.billing_accounts a
      set
        provider_state = case when v_state = 'grace' then 'past_due' else 'active' end,
        billing_state = case
          when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.billing_state
          when a.billing_state = 'comped' and (a.comped_until is null or a.comped_until > now()) then a.billing_state
          else v_state end,
        state_source = case
          when a.billing_state = 'suspended' and a.state_source = 'manual_suspension' then a.state_source
          when a.billing_state = 'comped' and a.state_source = 'manual_comp'
            and (a.comped_until is null or a.comped_until > now()) then a.state_source
          else 'stripe' end,
        grace_ends_at = case when v_state = 'grace' then p_event_created_at + interval '7 days' else null end,
        comped_until = case
          when a.billing_state = 'comped' and a.state_source = 'manual_comp'
            and (a.comped_until is null or a.comped_until > now()) then a.comped_until
          else null end,
        suspension_reason = case
          when a.billing_state = 'suspended' and a.state_source = 'manual_suspension'
            then a.suspension_reason
          else null end,
        provider_event_created_at = p_event_created_at,
        provider_event_id = p_event_id,
        updated_at = now()
      where a.id = v_account_id
        and (a.provider_event_created_at is null
          or (p_event_created_at, p_event_id) > (a.provider_event_created_at, a.provider_event_id));
      update public.organizations o
      set subscription_status = (select a.billing_state from public.billing_accounts a where a.id = v_account_id),
          updated_at = now()
      where o.id = v_org_id;
    end if;
  else
    v_applied := false;
  end if;

  update app_private.stripe_billing_events
  set processing_status = case
        when v_stale then 'stale'
        when v_applied then 'applied'
        else 'ignored' end,
      processed_at = now()
  where event_id = p_event_id;

  return query select false, v_applied, v_stale, v_org_id,
    (select a.billing_state from public.billing_accounts a where a.organization_id = v_org_id);
end;
$$;

create or replace function public.reconcile_billing_states(p_as_of timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.billing_accounts
  set billing_state = 'past_due', state_source = 'stripe', updated_at = now()
  where billing_state = 'grace' and grace_ends_at <= p_as_of;
  get diagnostics v_count = row_count;
  update public.organizations o
  set subscription_status = a.billing_state, updated_at = now()
  from public.billing_accounts a
  where a.organization_id = o.id
    and o.subscription_status is distinct from a.billing_state;
  return v_count;
end;
$$;

create or replace function public.get_billing_reconciliation(
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_result jsonb;
begin
  if public.is_platform_admin() then
    v_org_id := p_organization_id;
  elsif public.current_role() = 'org_admin'
     or public.has_effective_permission(
       'billing.account.read', 'organization', public.current_org_id(), now()
     ) then
    v_org_id := public.current_org_id();
    if p_organization_id is not null and p_organization_id <> v_org_id then
      raise exception 'Cannot reconcile another organization' using errcode = '42501';
    end if;
  else
    raise exception 'Billing reconciliation requires an administrator' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'schemaVersion', 1,
    'organizationId', v_org_id,
    'generatedAt', now(),
    'accounts', coalesce(jsonb_agg(jsonb_build_object(
      'organizationId', o.id,
      'billingState', a.billing_state,
      'providerState', a.provider_state,
      'stripeCustomerId', a.stripe_customer_id,
      'activeSeats', (select count(*) from public.profiles p where p.organization_id = o.id and p.is_active),
      'purchasedSeats', coalesce((select max(s.seat_quantity) from public.billing_subscriptions s
        where s.organization_id = o.id and s.billing_state in ('trial','active','grace')), 0),
      'subscriptionCount', (select count(*) from public.billing_subscriptions s where s.organization_id = o.id),
      'openInvoiceCount', (select count(*) from public.billing_invoices i
        where i.organization_id = o.id and i.provider_status in ('open','uncollectible')),
      'stateMatchesLegacy', o.subscription_status = a.billing_state,
      'seatLimitExceeded', (select count(*) from public.profiles p where p.organization_id = o.id and p.is_active)
        > coalesce((select max(s.seat_quantity) from public.billing_subscriptions s
          where s.organization_id = o.id and s.billing_state in ('trial','active','grace')), 0)
    ) order by o.id), '[]'::jsonb)
  ) into v_result
  from public.organizations o
  join public.billing_accounts a on a.organization_id = o.id
  where v_org_id is null or o.id = v_org_id;
  return v_result;
end;
$$;

create or replace function app_private.assert_billing_aal2()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    if coalesce(auth.jwt()->>'role', '') = 'service_role' then return; end if;
    raise exception 'An authenticated administrator is required' using errcode = '42501';
  end if;
  perform public.assert_identity_assurance('billing_admin');
end;
$$;
revoke all on function app_private.assert_billing_aal2()
  from public, anon, authenticated;

create or replace function public.set_package_entitlement(
  p_package_id uuid,
  p_feature_key text,
  p_entitlement_value jsonb,
  p_reason text,
  p_effective_from timestamptz default now(),
  p_effective_to timestamptz default null,
  p_contract_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may change package entitlements'
      using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Change reason required'; end if;
  if exists (
    select 1 from public.package_entitlements e
    where e.package_id = p_package_id and e.feature_key = p_feature_key
      and e.effective_to is null and e.effective_from >= p_effective_from
  ) then
    raise exception 'New package term must start after the current term' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', left(trim(p_reason), 500), true);
  update public.package_entitlements
  set effective_to = p_effective_from,
      updated_at = now()
  where package_id = p_package_id and feature_key = p_feature_key
    and effective_to is null;
  insert into public.package_entitlements (
    package_id, feature_key, entitlement_value, effective_from, effective_to,
    contract_reference, source, created_by
  ) values (
    p_package_id, p_feature_key, p_entitlement_value, p_effective_from,
    p_effective_to, p_contract_reference, 'sales_contract', auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_billing_account_override(
  p_organization_id uuid,
  p_override_state text,
  p_reason text,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.billing_accounts%rowtype;
  v_state text;
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may override billing state'
      using errcode = '42501';
  end if;
  if p_override_state not in ('comped', 'suspended', 'provider')
     or nullif(trim(p_reason), '') is null then
    raise exception 'A valid override state and reason are required' using errcode = '22023';
  end if;
  if p_override_state = 'comped' and p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Comped access expiry must be in the future' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', left(trim(p_reason), 500), true);
  select * into v_account from public.billing_accounts
  where organization_id = p_organization_id for update;
  if not found then raise exception 'Billing account not found' using errcode = 'P0002'; end if;
  v_state := case when p_override_state <> 'provider' then p_override_state
    when v_account.provider_state = 'trialing' then 'trial'
    when v_account.provider_state = 'active' then 'active'
    when v_account.provider_state = 'past_due' then 'past_due'
    when v_account.provider_state in ('canceled', 'incomplete_expired') then 'canceled'
    when v_account.provider_state = 'paused' then 'suspended'
    else 'past_due' end;
  update public.billing_accounts
  set billing_state = v_state,
      state_source = case p_override_state
        when 'comped' then 'manual_comp'
        when 'suspended' then 'manual_suspension'
        else 'stripe' end,
      comped_until = case when p_override_state = 'comped' then p_expires_at else null end,
      suspension_reason = case
        when v_state = 'suspended' then trim(p_reason) else null end,
      updated_at = now()
  where id = v_account.id;
  update public.organizations
  set subscription_status = v_state, updated_at = now()
  where id = p_organization_id;
end;
$$;

create or replace function public.set_organization_entitlement_grant(
  p_organization_id uuid,
  p_feature_key text,
  p_decision text,
  p_entitlement_value jsonb,
  p_reason text,
  p_effective_from timestamptz default now(),
  p_effective_to timestamptz default null,
  p_contract_reference text default null,
  p_approved_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may change contractual grants'
      using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Grant reason required'; end if;
  if exists (
    select 1 from public.organization_entitlement_grants g
    where g.organization_id = p_organization_id and g.feature_key = p_feature_key
      and g.effective_to is null and g.effective_from >= p_effective_from
  ) then
    raise exception 'New organization grant must start after the current grant' using errcode = '22023';
  end if;
  update public.organization_entitlement_grants
  set effective_to = p_effective_from,
      updated_at = now()
  where organization_id = p_organization_id and feature_key = p_feature_key
    and effective_to is null;
  insert into public.organization_entitlement_grants (
    organization_id, feature_key, decision, entitlement_value, reason,
    contract_reference, effective_from, effective_to, created_by, approved_by
  ) values (
    p_organization_id, p_feature_key, p_decision,
    case when p_decision = 'deny' then null else p_entitlement_value end,
    trim(p_reason), p_contract_reference, p_effective_from, p_effective_to,
    auth.uid(), p_approved_by
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_release_flag(
  p_feature_key text,
  p_rollout_mode text,
  p_is_enabled boolean,
  p_owner text,
  p_reason text,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may change release flags'
      using errcode = '42501';
  end if;
  insert into public.release_flags (
    feature_key, rollout_mode, is_enabled, owner, expires_at,
    change_reason, created_by
  ) values (
    p_feature_key, case when p_is_enabled then p_rollout_mode else 'off' end,
    p_is_enabled, trim(p_owner), p_expires_at, trim(p_reason), auth.uid()
  ) on conflict (feature_key) do update set
    rollout_mode = excluded.rollout_mode,
    is_enabled = excluded.is_enabled,
    owner = excluded.owner,
    expires_at = excluded.expires_at,
    change_reason = excluded.change_reason,
    updated_at = now();
end;
$$;

create or replace function public.set_feature_kill_switch(
  p_feature_key text,
  p_organization_id uuid default null,
  p_is_disabled boolean default true,
  p_reason text default 'Operator action',
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may change kill switches'
      using errcode = '42501';
  end if;
  select k.id into v_id from public.feature_kill_switches k
  where k.feature_key = p_feature_key
    and k.organization_id is not distinct from p_organization_id
    and k.is_disabled for update;
  if p_is_disabled then
    if v_id is null then
      insert into public.feature_kill_switches (
        feature_key, organization_id, is_disabled, reason, expires_at, activated_by
      ) values (
        p_feature_key, p_organization_id, true, trim(p_reason), p_expires_at, auth.uid()
      ) returning id into v_id;
    else
      update public.feature_kill_switches
      set reason = trim(p_reason), expires_at = p_expires_at,
          activated_at = now(), activated_by = auth.uid(), updated_at = now()
      where id = v_id;
    end if;
  else
    if v_id is null then
      insert into public.feature_kill_switches (
        feature_key, organization_id, is_disabled, reason, expires_at,
        activated_by, deactivated_at, deactivated_by
      ) values (
        p_feature_key, p_organization_id, false, trim(p_reason), p_expires_at,
        auth.uid(), now(), auth.uid()
      ) returning id into v_id;
    else
      update public.feature_kill_switches
      set is_disabled = false, deactivated_at = now(), deactivated_by = auth.uid(),
          reason = trim(p_reason), updated_at = now()
      where id = v_id;
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.assign_organization_release_cohort(
  p_organization_id uuid,
  p_cohort_id uuid,
  p_feature_key text,
  p_reason text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform app_private.assert_billing_aal2();
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may assign release cohorts'
      using errcode = '42501';
  end if;
  insert into public.organization_release_cohorts (
    organization_id, cohort_id, feature_key, expires_at, assigned_by, reason
  ) values (
    p_organization_id, p_cohort_id, p_feature_key, p_expires_at,
    auth.uid(), trim(p_reason)
  ) on conflict (organization_id, cohort_id, feature_key) do update set
    expires_at = excluded.expires_at,
    assigned_by = excluded.assigned_by,
    reason = excluded.reason
  returning id into v_id;
  return v_id;
end;
$$;

-- RLS and explicit Data API grants. Stripe writes remain service-only.
alter table public.feature_definitions enable row level security;
alter table public.package_billing_prices enable row level security;
alter table public.package_entitlements enable row level security;
alter table public.organization_entitlement_grants enable row level security;
alter table public.release_flags enable row level security;
alter table public.release_cohorts enable row level security;
alter table public.organization_release_cohorts enable row level security;
alter table public.feature_kill_switches enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_subscription_items enable row level security;
alter table public.billing_invoices enable row level security;

create policy feature_definitions_read on public.feature_definitions for select to authenticated using (true);
create policy package_billing_prices_read on public.package_billing_prices for select to authenticated
  using (is_active or (select public.is_platform_admin()));
create policy package_entitlements_read on public.package_entitlements for select to authenticated using (true);
create policy organization_entitlement_grants_read on public.organization_entitlement_grants for select to authenticated
  using ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id()) and (
      (select public.current_role()) = 'org_admin'
      or public.has_effective_permission('billing.entitlements.read', 'organization', organization_id, now()))));
create policy release_flags_read on public.release_flags for select to authenticated using (true);
create policy release_cohorts_read on public.release_cohorts for select to authenticated using (true);
create policy organization_release_cohorts_read on public.organization_release_cohorts for select to authenticated
  using ((select public.is_platform_admin()) or organization_id = (select public.current_org_id()));
create policy feature_kill_switches_read on public.feature_kill_switches for select to authenticated
  using ((select public.is_platform_admin()) or organization_id is null or organization_id = (select public.current_org_id()));
create policy billing_accounts_read on public.billing_accounts for select to authenticated
  using ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id()) and (
      (select public.current_role()) = 'org_admin'
      or public.has_effective_permission('billing.account.read', 'organization', organization_id, now()))));
create policy billing_subscriptions_read on public.billing_subscriptions for select to authenticated
  using ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id()) and (
      (select public.current_role()) = 'org_admin'
      or public.has_effective_permission('billing.account.read', 'organization', organization_id, now()))));
create policy billing_subscription_items_read on public.billing_subscription_items for select to authenticated
  using ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id()) and (
      (select public.current_role()) = 'org_admin'
      or public.has_effective_permission('billing.account.read', 'organization', organization_id, now()))));
create policy billing_invoices_read on public.billing_invoices for select to authenticated
  using ((select public.is_platform_admin()) or (
    organization_id = (select public.current_org_id()) and (
      (select public.current_role()) = 'org_admin'
      or public.has_effective_permission('billing.account.read', 'organization', organization_id, now()))));

revoke all on table public.feature_definitions, public.package_billing_prices,
  public.package_entitlements, public.organization_entitlement_grants,
  public.release_flags, public.release_cohorts, public.organization_release_cohorts,
  public.feature_kill_switches, public.billing_accounts,
  public.billing_subscriptions, public.billing_subscription_items,
  public.billing_invoices from public, anon, authenticated;
grant select on table public.feature_definitions,
  public.package_billing_prices, public.package_entitlements,
  public.organization_entitlement_grants, public.release_flags,
  public.release_cohorts, public.organization_release_cohorts,
  public.feature_kill_switches to authenticated;
grant select on table public.billing_accounts, public.billing_subscriptions,
  public.billing_subscription_items, public.billing_invoices to authenticated;
grant select, insert, update, delete on table public.feature_definitions, public.package_billing_prices,
  public.package_entitlements, public.organization_entitlement_grants,
  public.release_flags, public.release_cohorts, public.organization_release_cohorts,
  public.feature_kill_switches, public.billing_accounts,
  public.billing_subscriptions, public.billing_subscription_items,
  public.billing_invoices to service_role;

revoke all on function public.get_effective_entitlements(uuid, timestamptz),
  public.has_effective_entitlement(uuid, text, bigint, timestamptz),
  public.evaluate_feature_access(uuid, text, bigint, timestamptz),
  public.get_billing_reconciliation(uuid)
  from public, anon;
grant execute on function public.get_effective_entitlements(uuid, timestamptz),
  public.has_effective_entitlement(uuid, text, bigint, timestamptz),
  public.evaluate_feature_access(uuid, text, bigint, timestamptz),
  public.get_billing_reconciliation(uuid)
  to authenticated, service_role;
revoke all on function public.set_package_entitlement(uuid, text, jsonb, text, timestamptz, timestamptz, text),
  public.set_billing_account_override(uuid, text, text, timestamptz),
  public.set_organization_entitlement_grant(uuid, text, text, jsonb, text, timestamptz, timestamptz, text, uuid),
  public.set_release_flag(text, text, boolean, text, text, timestamptz),
  public.set_feature_kill_switch(text, uuid, boolean, text, timestamptz),
  public.assign_organization_release_cohort(uuid, uuid, text, text, timestamptz)
  from public, anon;
grant execute on function public.set_package_entitlement(uuid, text, jsonb, text, timestamptz, timestamptz, text),
  public.set_billing_account_override(uuid, text, text, timestamptz),
  public.set_organization_entitlement_grant(uuid, text, text, jsonb, text, timestamptz, timestamptz, text, uuid),
  public.set_release_flag(text, text, boolean, text, text, timestamptz),
  public.set_feature_kill_switch(text, uuid, boolean, text, timestamptz),
  public.assign_organization_release_cohort(uuid, uuid, text, text, timestamptz)
  to authenticated;
revoke all on function public.process_stripe_billing_event(text, text, timestamptz, jsonb, text, text),
  public.reconcile_billing_states(timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_stripe_billing_event(text, text, timestamptz, jsonb, text, text),
  public.reconcile_billing_states(timestamptz)
  to service_role;

-- Audit every commercial or operational control mutation. Provider payloads
-- remain in app_private; public audit rows contain only normalized state.
insert into app_private.audit_entity_manifest (
  table_name, audit_mode, contains_regulated_data, rationale
)
values
  ('feature_definitions', 'row_trigger', false, 'Typed commercial feature contract'),
  ('package_billing_prices', 'row_trigger', false, 'Approved Stripe Price mapping'),
  ('package_entitlements', 'row_trigger', false, 'Effective package entitlement history'),
  ('organization_entitlement_grants', 'row_trigger', false, 'Tenant contractual override history'),
  ('release_flags', 'row_trigger', false, 'Operational release state independent of billing'),
  ('release_cohorts', 'row_trigger', false, 'Governed release cohort definitions'),
  ('organization_release_cohorts', 'row_trigger', false, 'Tenant rollout assignments'),
  ('feature_kill_switches', 'row_trigger', false, 'Emergency operational disable evidence'),
  ('billing_accounts', 'row_trigger', false, 'Canonical tenant billing state'),
  ('billing_subscriptions', 'row_trigger', false, 'Signed subscription reconciliation state'),
  ('billing_subscription_items', 'row_trigger', false, 'Signed seat and Price reconciliation state'),
  ('billing_invoices', 'row_trigger', false, 'Signed invoice reconciliation state')
on conflict (table_name) do update set
  audit_mode = excluded.audit_mode,
  contains_regulated_data = excluded.contains_regulated_data,
  rationale = excluded.rationale,
  updated_at = now();

create trigger set_updated_at before update on public.feature_definitions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.package_billing_prices
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.package_entitlements
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.organization_entitlement_grants
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.release_flags
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.release_cohorts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.feature_kill_switches
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.billing_accounts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.billing_subscriptions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.billing_subscription_items
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.billing_invoices
  for each row execute function public.set_updated_at();

create trigger audit_log after insert or update or delete on public.feature_definitions
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.package_billing_prices
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.package_entitlements
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.organization_entitlement_grants
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.release_flags
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.release_cohorts
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.organization_release_cohorts
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.feature_kill_switches
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.billing_accounts
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.billing_subscriptions
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.billing_subscription_items
  for each row execute function public.audit_log_trigger();
create trigger audit_log after insert or update or delete on public.billing_invoices
  for each row execute function public.audit_log_trigger();

comment on column public.packages.features is
  'Deprecated rolling-deploy input. feature_definitions and package_entitlements are authoritative.';
