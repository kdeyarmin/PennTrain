-- SG-9. Two directions, because the register's original claim was wrong in one of them.
--
-- What was NOT true: that get_effective_entitlements evaluates a grant on a retired definition.
-- It ends with `where d.is_active`. That is asserted here so the correction cannot quietly rot
-- back into the wider claim.
--
-- What IS true: an INSERT naming a retired definition used to succeed, recording a contract term
-- that confers nothing. And the guard must not touch UPDATE, or an open term for a retired
-- feature could never be closed.
begin;
select plan(6);

insert into public.organizations (id, name, slug, subscription_status, trial_ends_at)
values ('3a000000-0000-4000-8000-0000000000a1', 'SG9 Org', 'sg9-org', 'active', now() + interval '30 days');

insert into public.feature_definitions (feature_key, display_name, description, value_type, default_value, is_active)
values ('sg9.retired_probe', 'SG9 Retired Probe', 'Fixture for SG-9.', 'boolean', 'false'::jsonb, true);

-- 1. While the definition is active it resolves like any other.
select is(
  (select count(*)::int from public.get_effective_entitlements('3a000000-0000-4000-8000-0000000000a1'::uuid, now()) e
    where e.feature_key = 'sg9.retired_probe'),
  1,
  'an active definition resolves through get_effective_entitlements'
);

-- 2. An active definition may be sold, and that open term is what test 5 later closes.
select lives_ok(
  $$ insert into public.package_entitlements (package_id, feature_key, entitlement_value, effective_from, source)
     values ((select id from public.packages order by id limit 1), 'sg9.retired_probe', 'true'::jsonb,
             now() - interval '1 day', 'sales_contract') $$,
  'a term may be recorded while the feature is live'
);

update public.feature_definitions set is_active = false where feature_key = 'sg9.retired_probe';

-- 3. THE CORRECTION. The read side does not evaluate a retired definition -- it never did.
select is(
  (select count(*)::int from public.get_effective_entitlements('3a000000-0000-4000-8000-0000000000a1'::uuid, now()) e
    where e.feature_key = 'sg9.retired_probe'),
  0,
  'a retired definition confers nothing: get_effective_entitlements already filters on is_active'
);

-- 4. THE FIX. A new term for a retired feature is refused, rather than recorded and inert.
select throws_ok(
  $$ insert into public.package_entitlements (package_id, feature_key, entitlement_value, effective_from, source)
     values ((select id from public.packages order by id limit 1), 'sg9.retired_probe', 'true'::jsonb, now() + interval '1 day', 'sales_contract') $$,
  '22023',
  'Feature sg9.retired_probe is retired and cannot be added to an entitlement',
  'a retired feature cannot be written into a new contract term'
);

-- 5. The guard is INSERT-only, so the term opened at test 2 can still be ended. Rejecting this
--    would strand every open term for a retired feature with no way to close it. The term above
--    starts a day back because package_entitlements_check requires effective_to > effective_from.
select lives_ok(
  $$ update public.package_entitlements set effective_to = now()
      where feature_key = 'sg9.retired_probe' and effective_to is null $$,
  'an existing term for a retired feature can still be closed out'
);

-- 6. An unknown key names its own problem instead of reporting a value-type mismatch.
select throws_ok(
  $$ insert into public.package_entitlements (package_id, feature_key, entitlement_value, effective_from, source)
     values ((select id from public.packages order by id limit 1), 'sg9.no_such_key', 'true'::jsonb, now(), 'sales_contract') $$,
  '23503',
  'Unknown feature key sg9.no_such_key',
  'an unknown feature key is reported as unknown, not as a type mismatch'
);

select * from finish();
rollback;
