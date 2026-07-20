begin;
select plan(18);

select results_eq(
  $$ select feature_key from public.feature_definitions where feature_key like 'modules.%' order by feature_key $$,
  $$ values ('modules.carebase'::text), ('modules.train'::text) $$,
  'both commercial modules have typed entitlement definitions'
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
  (select module_key from app_private.product_module_resources where resource_name = 'residents'),
  'modules.carebase',
  'resident data belongs to CareMetric CareBase'
);
select is(
  (select count(*)::integer from app_private.product_module_resources where resource_name = 'employees'),
  0,
  'the employee directory remains shared core'
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

select * from finish();
rollback;
