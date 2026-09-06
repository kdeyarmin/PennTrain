-- I33. Two directions, because the register's original claim was wrong in one of them, and then
-- three more because the first version of the fix broke things review had to find.
--
-- What was NOT true: that get_effective_entitlements evaluates a grant on a retired definition.
-- It ends with `where d.is_active`. Test 3 asserts that, and PASSES against the unpatched code,
-- which is what makes it a correction rather than another claim.
--
-- What IS true: a retired definition could be INTRODUCED into a package that did not carry it.
--
-- What the first fix got wrong, all three verified before being fixed: it refused every INSERT
-- naming a retired key, which broke the legacy package-contract ingestion (so no package could be
-- edited at all once any of its features was retired), left no way to close an existing term
-- through the RPCs (they close then re-insert), and still let an UPDATE switch a live term onto a
-- retired key.
begin;
select plan(9);

insert into public.organizations (id, name, slug, subscription_status, trial_ends_at)
values ('3a000000-0000-4000-8000-0000000000a1', 'SG9 Org', 'sg9-org', 'active', now() + interval '30 days');

insert into public.feature_definitions (feature_key, display_name, description, value_type, default_value, is_active)
values ('sg9.retired_probe', 'SG9 Retired Probe', 'Fixture for I33.', 'boolean', 'false'::jsonb, true),
       ('sg9.other_live', 'SG9 Other Live', 'Fixture for I33.', 'boolean', 'false'::jsonb, true);

-- A package whose LEGACY document carries the feature. ingest_legacy_package_contract() rewrites a
-- term for every key in `features` on any edit, which is what test 6 exercises.
insert into public.packages (id, name, features, learner_limit, facility_limit)
values ('3b000000-0000-4000-8000-0000000000b1', 'I33 Legacy Package',
        '{"sg9.retired_probe": true}'::jsonb, 10, 2);

-- 1. While the definition is active it resolves like any other.
select is(
  (select count(*)::int from public.get_effective_entitlements('3a000000-0000-4000-8000-0000000000a1'::uuid, now()) e
    where e.feature_key = 'sg9.retired_probe'),
  1,
  'an active definition resolves through get_effective_entitlements'
);

-- 2. An active definition may be sold onto a package that does not carry it yet.
select lives_ok(
  $$ insert into public.package_entitlements (package_id, feature_key, entitlement_value, effective_from, source)
     values ((select id from public.packages where name = 'I33 Legacy Package'), 'sg9.other_live', 'true'::jsonb,
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

-- 4. THE FIX. A retired feature cannot be INTRODUCED to a package that does not carry it.
insert into public.packages (id, name, features, learner_limit, facility_limit)
values ('3b000000-0000-4000-8000-0000000000b3', 'I33 Fresh Package', '{}'::jsonb, 10, 2);
select throws_ok(
  $$ insert into public.package_entitlements (package_id, feature_key, entitlement_value, effective_from, source)
     values ('3b000000-0000-4000-8000-0000000000b3', 'sg9.retired_probe', 'true'::jsonb, now(), 'sales_contract') $$,
  '22023',
  'Feature sg9.retired_probe is retired and cannot be added where it is not already carried',
  'a retired feature cannot be introduced to a package that does not carry it'
);

-- 5. But a package that ALREADY carries it can still have that term re-issued -- which is how both
--    entitlement RPCs close one out: they set effective_to and then insert the replacement.
-- 5. The legacy ingestion path. Refusing this is what the first version of the fix did, and it
--    would have made every package carrying a retired feature in its document uneditable.
select lives_ok(
  $$ update public.packages set learner_limit = 11 where id = '3b000000-0000-4000-8000-0000000000b1' $$,
  'a package carrying a retired feature in its legacy document can still be edited'
);

-- 6. A package that ALREADY carries the retired feature can still have that term closed and
--    re-issued, which is how both entitlement RPCs work: set effective_to, then insert the
--    replacement. The offsets clear package_entitlements_check (effective_to > effective_from),
--    since ingestion stamps its rows at statement_timestamp() rather than now().
update public.package_entitlements set effective_to = now() + interval '1 hour'
 where package_id = '3b000000-0000-4000-8000-0000000000b1'
   and feature_key = 'sg9.retired_probe' and effective_to is null;
select lives_ok(
  $$ insert into public.package_entitlements (package_id, feature_key, entitlement_value, effective_from, source)
     values ('3b000000-0000-4000-8000-0000000000b1', 'sg9.retired_probe', 'false'::jsonb,
             now() + interval '2 hours', 'sales_contract') $$,
  'an existing term for a retired feature can still be closed and re-issued (the RPC close path)'
);

-- 7. An UPDATE may not switch a live term onto a retired key the package does not carry. Verified
--    to have succeeded before this guard covered key-changing updates.
insert into public.packages (id, name, features, learner_limit, facility_limit)
values ('3b000000-0000-4000-8000-0000000000b2', 'I33 Second Package', '{}'::jsonb, 10, 2);
insert into public.package_entitlements (package_id, feature_key, entitlement_value, effective_from, source)
values ('3b000000-0000-4000-8000-0000000000b2', 'sg9.other_live', 'true'::jsonb, now() - interval '2 days', 'sales_contract');
select throws_ok(
  $$ update public.package_entitlements set feature_key = 'sg9.retired_probe'
      where package_id = '3b000000-0000-4000-8000-0000000000b2' and feature_key = 'sg9.other_live' $$,
  '22023',
  'Feature sg9.retired_probe is retired and cannot be added where it is not already carried',
  'an update cannot switch a live term onto a retired feature the package does not carry'
);

-- 8. A plain re-dating UPDATE that does not change the key is untouched.
select lives_ok(
  $$ update public.package_entitlements set effective_to = now() + interval '30 days'
      where package_id = '3b000000-0000-4000-8000-0000000000b2' and feature_key = 'sg9.other_live' $$,
  'an update that does not change the feature key is unaffected by the guard'
);

-- 9. An unknown key names its own problem instead of reporting a value-type mismatch.
select throws_ok(
  $$ insert into public.package_entitlements (package_id, feature_key, entitlement_value, effective_from, source)
     values ('3b000000-0000-4000-8000-0000000000b2', 'sg9.no_such_key', 'true'::jsonb, now(), 'sales_contract') $$,
  '23503',
  'Unknown feature key sg9.no_such_key',
  'an unknown feature key is reported as unknown, not as a type mismatch'
);

select * from finish();
rollback;
