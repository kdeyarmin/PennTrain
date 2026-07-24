begin;
select plan(51);

select results_eq(
  $$ select feature_key from public.feature_definitions where feature_key like 'modules.%' order by feature_key $$,
  $$ values ('modules.billing'::text), ('modules.carebase'::text), ('modules.compliance'::text), ('modules.train'::text), ('modules.workforce'::text) $$,
  'every commercial pillar module has a typed entitlement definition'
);
select results_eq(
  $$ select name from public.packages where name in ('CareMetric Train', 'CareMetric CareBase') order by name $$,
  $$ values ('CareMetric CareBase'::text), ('CareMetric Train'::text) $$,
  'facilities can select either named CareMetric product package'
);
select is(
  (select features -> 'modules.carebase' from public.packages where name = 'CareMetric Train'),
  'false'::jsonb,
  'CareMetric Train excludes CareBase'
);
select is(
  (select features -> 'modules.train' from public.packages where name = 'CareMetric CareBase'),
  'true'::jsonb,
  'CareMetric CareBase includes Train'
);
select results_eq(
  $$ select name from public.packages where name like 'CareMetric %' order by sort_order $$,
  $$ values ('CareMetric Train'::text), ('CareMetric Essentials'::text), ('CareMetric Professional'::text), ('CareMetric CareBase'::text), ('CareMetric Portfolio'::text) $$,
  'the tier ladder runs training, essentials, professional, complete operations, and portfolio'
);
select is(
  (select pricing_strategy from public.packages where name = 'CareMetric Train'),
  'hybrid',
  'Train uses a base fee plus active-learner overage strategy'
);
select is(
  (select pricing_strategy from public.packages where name = 'CareMetric CareBase'),
  'hybrid',
  'CareBase uses a base fee plus active-resident overage strategy'
);
select is(
  (select contact_sales from public.packages where name = 'CareMetric Portfolio'),
  true,
  'portfolio pricing is contract-led'
);
select is(
  (select is_recommended from public.packages where name = 'CareMetric CareBase'),
  true,
  'the complete CareBase package is recommended'
);
select is(
  (select annual_discount_percent from public.packages where name = 'CareMetric CareBase'),
  16.67::numeric,
  'annual billing gives approximately two months free'
);
select is(
  (select billing_metric from public.package_billing_prices bp join public.packages p on p.id = bp.package_id
   where p.name = 'CareMetric Train' and bp.recurring_interval = 'month'),
  'active_learner',
  'Train prices scale by active learner'
);
select is(
  (select billing_metric from public.package_billing_prices bp join public.packages p on p.id = bp.package_id
   where p.name = 'CareMetric CareBase' and bp.recurring_interval = 'month'),
  'active_resident',
  'CareBase prices scale by active resident rather than staff user'
);
select is(
  (select included_quantity from public.package_billing_prices bp join public.packages p on p.id = bp.package_id
   where p.name = 'CareMetric Train' and bp.recurring_interval = 'month'),
  25,
  'Train includes the first 25 active learners'
);
select is(
  (select base_amount_cents from public.package_billing_prices bp join public.packages p on p.id = bp.package_id
   where p.name = 'CareMetric CareBase' and bp.recurring_interval = 'month'),
  49900,
  'CareBase has a transparent monthly base fee'
);
select is(
  (select count(*)::integer from public.package_billing_prices bp join public.packages p on p.id = bp.package_id
   where p.name in ('CareMetric Train', 'CareMetric CareBase') and bp.stripe_price_id is null),
  4,
  'draft prices require explicit Stripe Price mapping before checkout'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
    and indexname = 'package_billing_prices_primary_cadence_uidx'),
  'each package cadence has at most one active primary checkout price'
);
select lives_ok(
  $$ update public.package_billing_prices bp set base_amount_cents = 24000
     from public.packages p where p.id = bp.package_id and p.name = 'CareMetric Train'
       and bp.recurring_interval = 'month' and bp.is_primary $$,
  'platform price edits synchronize the package starting price'
);
select is(
  (select price_monthly_cents from public.packages where name = 'CareMetric Train'),
  24000,
  'the package catalog reflects the edited monthly base amount'
);

insert into public.package_billing_prices (
  package_id, stripe_price_id, display_name, recurring_interval, billing_metric,
  pricing_model, base_amount_cents, minimum_quantity, is_primary, is_active
)
select id, 'price_archiveguard', 'Archive guard test', 'month', 'active_learner',
  'per_unit', 0, 1, false, true
from public.packages where name = 'CareMetric Train';

select throws_ok(
  $$ delete from public.package_billing_prices where stripe_price_id = 'price_archiveguard' $$,
  '55000', null,
  'Stripe-mapped prices must be archived instead of deleted'
);
select has_function(
  'public',
  'get_organization_billing_usage',
  array['uuid'],
  'checkout and customer previews share one canonical billing-usage measurement'
);
select ok(
  exists (
    select 1 from app_private.system_job_definitions
    where job_key = 'billing-quantity-sync'
      and execution_kind = 'edge_cron'
      and is_critical
  ),
  'billing quantity synchronization is registered as a monitored critical job'
);

select has_table('public', 'billing_provider_operations', 'billing quantity sync has a durable provider-operation ledger');
select ok(
  not has_table_privilege('authenticated', 'public.billing_provider_operations', 'select')
  and not has_table_privilege('authenticated', 'public.billing_provider_operations', 'insert')
  and not has_table_privilege('authenticated', 'public.billing_provider_operations', 'update')
  and has_table_privilege('service_role', 'public.billing_provider_operations', 'insert')
  and has_table_privilege('service_role', 'public.billing_provider_operations', 'update'),
  'billing provider-operation ledger is service-role only'
);
select has_table('app_private', 'product_module_resources', 'module resources have one private registry');
select has_table('app_private', 'product_module_storage_buckets', 'storage buckets have one private registry');
select has_function('app_private', 'has_product_module', array['text'], 'RLS has a caller-scoped entitlement helper');
select ok(
  not has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  'module internals remain outside the Data API schema surface'
);
select is(
  (select module_key from app_private.product_module_resources where resource_name = 'courses'),
  'modules.train',
  'course data belongs to CareMetric Train'
);
select is(
  (select count(*)::integer from app_private.product_module_resources where resource_name = 'residents'),
  0,
  'the resident directory is shared core so compliance and billing tiers can identify residents'
);
select is(
  (select count(*)::integer from app_private.product_module_resources where resource_name = 'employees'),
  0,
  'the employee directory remains shared core'
);
select is(
  (select module_key from app_private.product_module_resources where resource_name = 'resident_financial_accounts'),
  'modules.billing',
  'resident financial data belongs to CareMetric Billing'
);
select is(
  (select module_key from app_private.product_module_resources where resource_name = 'competency_records'),
  'modules.workforce',
  'competency data belongs to CareMetric Workforce'
);
select is(
  (select count(*)::integer from app_private.product_module_resources where resource_name = 'employee_credentials'),
  0,
  'the credential record backbone is shared core so compliance and workforce pages both render it'
);
select is(
  (select module_key from app_private.product_module_resources where resource_name = 'inspection_items'),
  'modules.compliance',
  'inspection data belongs to CareMetric Compliance'
);
select is(
  (select module_key from app_private.product_module_resources where resource_name = 'incidents'),
  'modules.carebase',
  'incident data remains CareMetric Care Operations'
);
select is(
  (select features -> 'modules.compliance' from public.packages where name = 'CareMetric Essentials'),
  'true'::jsonb,
  'the Essentials tier bundles Compliance'
);
select is(
  (select features -> 'modules.carebase' from public.packages where name = 'CareMetric Essentials'),
  'false'::jsonb,
  'the Essentials tier excludes full Care Operations'
);
select is(
  (select features -> 'modules.billing' from public.packages where name = 'CareMetric Professional'),
  'true'::jsonb,
  'the Professional tier bundles Billing'
);
select is(
  (select features -> 'modules.workforce' from public.packages where name = 'CareMetric Professional'),
  'true'::jsonb,
  'the Professional tier bundles Workforce'
);
select is(
  (select features -> 'modules.workforce' from public.packages where name = 'CareMetric CareBase'),
  'true'::jsonb,
  'CareBase remains the all-inclusive bundle across every pillar'
);
select is(
  (select billing_metric from public.package_billing_prices bp join public.packages p on p.id = bp.package_id
   where p.name = 'CareMetric Professional' and bp.recurring_interval = 'month'),
  'active_resident',
  'Professional prices scale by active resident'
);
select is(
  (select module_key from app_private.product_module_storage_buckets where bucket_id = 'course-documents'),
  'modules.train',
  'course files belong to CareMetric Train'
);
select is(
  (select module_key from app_private.product_module_storage_buckets where bucket_id = 'resident-documents'),
  'modules.carebase',
  'resident files belong to CareMetric CareBase'
);
select is(
  (select module_key from app_private.product_module_storage_buckets where bucket_id = 'org-branding'),
  'core',
  'organization branding remains shared core'
);
select is(
  (select permissive from pg_policies where schemaname = 'public' and tablename = 'courses' and policyname = 'product_module_entitlement'),
  'RESTRICTIVE',
  'Train data composes module access with existing course RLS'
);
select is(
  (select permissive from pg_policies where schemaname = 'public' and tablename = 'residents' and policyname = 'product_module_entitlement'),
  'RESTRICTIVE',
  'CareBase data composes module access with existing resident RLS'
);
select is(
  (select permissive from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'product_module_entitlement'),
  'RESTRICTIVE',
  'private files compose module access with existing bucket RLS'
);
select ok(
  not exists (
    select 1 from app_private.product_module_resources r
    left join pg_catalog.pg_class c on c.relname = r.resource_name
    left join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = r.resource_schema
    where c.oid is null
  ),
  'every classified resource resolves to a real table'
);

select ok(
  not exists (
    select 1
    from app_private.product_module_resources r
    left join pg_policies p
      on p.schemaname = r.resource_schema
     and p.tablename = r.resource_name
     and p.policyname = 'product_module_entitlement'
    where p.policyname is null
       or p.permissive <> 'RESTRICTIVE'
       or coalesce(p.qual, '') not like '%has_product_module%'
       or coalesce(p.with_check, '') not like '%has_product_module%'
  ),
  'every classified table has a restrictive module policy with USING and WITH CHECK guards'
);
select ok(
  exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'product_module_entitlement'
      and p.permissive = 'RESTRICTIVE'
      and coalesce(p.qual, '') like '%has_product_module_for_bucket%'
      and coalesce(p.with_check, '') like '%has_product_module_for_bucket%'
  ),
  'classified storage buckets have a restrictive module policy with read and write guards'
);
select ok(
  not exists (
    select 1
    from app_private.product_module_storage_buckets b
    where b.module_key <> 'core'
      and not exists (
        select 1
        from storage.buckets sb
        where sb.id = b.bucket_id
      )
  ),
  'every non-core classified storage bucket resolves to a real bucket'
);

select * from finish();
rollback;
