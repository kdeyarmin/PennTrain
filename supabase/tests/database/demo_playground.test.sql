begin;
select plan(21);

select has_column('public', 'organizations', 'is_demo', 'organizations identify public demo tenants');
select has_column('public', 'organizations', 'demo_seed_version', 'demo seed version is tracked');
select has_column('public', 'organizations', 'demo_reset_at', 'demo restore time is tracked');
select has_function('public', 'restore_demo_baseline', array[]::text[], 'demo administrators have a guarded restore command');
select has_function('app_private', 'seed_demo_organization', array['uuid'], 'the cross-module baseline seeder exists');
select has_function('app_private', 'restore_all_demo_baselines', array[]::text[], 'the scheduled restore worker exists');
select is((select count(*)::bigint from cron.job where jobname = 'restore-public-demo-baseline'), 1::bigint, 'daily demo baseline restore is scheduled once');

select ok(has_function_privilege('authenticated', 'public.restore_demo_baseline()', 'EXECUTE'), 'authenticated callers can reach the guarded restore command');
select ok(not has_function_privilege('anon', 'public.restore_demo_baseline()', 'EXECUTE'), 'anonymous callers cannot restore demo data');
select ok(not has_function_privilege('authenticated', 'app_private.seed_demo_organization(uuid)', 'EXECUTE'), 'authenticated callers cannot invoke the private seeder');
select ok(not has_function_privilege('authenticated', 'app_private.restore_all_demo_baselines()', 'EXECUTE'), 'authenticated callers cannot run the global restore worker');
select ok(exists(
  select 1 from pg_trigger
  where tgrelid = 'public.notification_deliveries'::regclass
    and tgname = 'suppress_demo_notification_delivery'
    and not tgisinternal
), 'demo provider-delivery suppression is installed');

insert into public.organizations (
  name, slug, subscription_status, is_demo, demo_seed_version
) values ('pgTAP Demo Organization', 'pgtap-demo-playground', 'active', true, 1);

select lives_ok(
  $$select app_private.seed_demo_organization((select id from public.organizations where slug = 'pgtap-demo-playground'))$$,
  'the demo baseline seeds a new isolated tenant'
);
select is((select count(*)::bigint from public.employees e join public.organizations o on o.id = e.organization_id where o.slug = 'pgtap-demo-playground'), 4::bigint, 'baseline includes synthetic employees');
select is((select count(*)::bigint from public.residents r join public.organizations o on o.id = r.organization_id where o.slug = 'pgtap-demo-playground'), 3::bigint, 'baseline includes synthetic residents');
select is((select count(*)::bigint from public.admission_prospects p join public.organizations o on o.id = p.organization_id where o.slug = 'pgtap-demo-playground'), 3::bigint, 'baseline includes an admissions pipeline');
select is((select count(*)::bigint from public.resident_service_task_instances t join public.organizations o on o.id = t.organization_id where o.slug = 'pgtap-demo-playground'), 15::bigint, 'baseline includes two weeks of resident service work');
select is((select count(*)::bigint from public.schedules s join public.organizations o on o.id = s.organization_id where o.slug = 'pgtap-demo-playground'), 1::bigint, 'baseline includes a published schedule');

insert into public.notification_deliveries (
  organization_id, profile_id, channel, delivery_type, recipient
) select id, gen_random_uuid(), 'email', 'alert', 'nobody@example.invalid'
from public.organizations where slug = 'pgtap-demo-playground';
select is((
  select count(*)::bigint from public.notification_deliveries d
  join public.organizations o on o.id = d.organization_id
  where o.slug = 'pgtap-demo-playground'
), 0::bigint, 'demo activity cannot enqueue external provider delivery');

select lives_ok(
  $$select app_private.seed_demo_organization((select id from public.organizations where slug = 'pgtap-demo-playground'))$$,
  'restoring the baseline is idempotent'
);
select is((select count(*)::bigint from public.work_orders w join public.organizations o on o.id = w.organization_id where o.slug = 'pgtap-demo-playground'), 1::bigint, 'idempotent restore does not duplicate work orders');

select * from finish();
rollback;
