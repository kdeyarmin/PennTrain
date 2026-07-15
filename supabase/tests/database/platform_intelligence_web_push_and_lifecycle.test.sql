begin;
select plan(43);

select has_table('public', 'push_subscriptions', 'web-push subscriptions are first-class records');
select has_table('public', 'regulatory_rule_pack_templates', 'regulatory templates are governed data');
select has_table('public', 'regulatory_update_sources', 'official regulatory sources are tracked');
select has_table('public', 'regulatory_source_snapshots', 'regulatory source snapshots are retained');
select has_table('public', 'regulatory_change_proposals', 'regulatory changes require proposals');
select has_table('public', 'mock_inspection_runs', 'mock inspection receipts are retained');
select has_table('public', 'benchmark_snapshots', 'cross-tenant benchmark snapshots are retained');
select has_table('public', 'product_events', 'allow-listed product telemetry is retained');
select has_table('public', 'data_lifecycle_policies', 'lifecycle policy definitions exist');
select has_table('public', 'data_lifecycle_holds', 'legal holds are first-class records');
select has_table('public', 'data_lifecycle_runs', 'lifecycle executions are auditable');
select has_table('app_private', 'retained_records_archive', 'retained records use a private archive');

select has_column('public', 'organization_settings', 'web_push_notifications_enabled',
  'organizations can govern web-push delivery');
select has_column('public', 'course_ai_generations', 'organization_id',
  'course AI generations are lifecycle-scopeable');
select has_column('public', 'push_subscriptions', 'user_agent_hash',
  'push subscriptions retain only a hashed browser identifier');
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'push_subscriptions'
      and column_name = 'user_agent_sha256'
  ),
  'push subscription writers must use the canonical user-agent hash column'
);

select has_function('public', 'install_regulatory_rule_pack_template',
  'platform administrators can install a draft rule-pack template');
select has_function('public', 'record_regulatory_source_snapshot',
  'the regulatory worker can record official-source snapshots');
select has_function('public', 'record_mock_inspection_run',
  'the mock-inspection worker can retain evidence receipts');
select has_function('public', 'refresh_benchmark_snapshots',
  'the trusted worker can refresh anonymous cohorts');
select has_function('public', 'get_facility_benchmark_comparison',
  'facilities can retrieve gated benchmark comparisons');
select has_function('public', 'get_workforce_retention_metrics',
  'workforce retention analytics are available');
select has_function('public', 'get_paid_training_payroll_export',
  'verified training time can be exported for payroll');
select has_function('public', 'run_data_lifecycle_policy',
  'the trusted lifecycle worker has a bounded policy command');
select ok(
  pg_get_functiondef('public.refresh_benchmark_snapshots(date,integer)'::regprocedure)
    like '%topCitationTopics%',
  'benchmark refreshes include k-anonymous citation-topic aggregates'
);
select ok(
  pg_get_functiondef('public.get_facility_benchmark_comparison(uuid)'::regprocedure)
    like '%facilityMetrics%',
  'benchmark comparisons include the facility values shown beside peer medians'
);
select ok(
  pg_get_functiondef('public.get_workforce_retention_metrics(uuid)'::regprocedure)
    like '%ended_on between current_date - 364 and current_date%',
  'future termination dates are excluded from historical turnover'
);
select ok(
  pg_get_functiondef('public.refresh_benchmark_snapshots(date,integer)'::regprocedure)
    like '%delete from public.benchmark_snapshots%',
  'benchmark refreshes remove stale cohorts that no longer meet k-anonymity'
);
select ok(
  pg_get_functiondef('public.update_profile_contact_preferences(uuid,text,text,text,boolean,text)'::regprocedure)
    like '%preferred_notification_channel is distinct from ''web_push''%',
  'existing web-push preferences survive unrelated cross-browser profile edits'
);

select ok(
  not has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT'),
  'browser roles cannot forge push subscriptions outside the function boundary'
);
select ok(
  not has_table_privilege('authenticated', 'public.regulatory_source_snapshots', 'INSERT'),
  'browser roles cannot forge regulatory snapshots'
);
select ok(
  not has_table_privilege('authenticated', 'public.product_events', 'INSERT'),
  'browser roles cannot bypass the telemetry allow-list function'
);
select ok(
  has_table_privilege('service_role', 'public.push_subscriptions', 'INSERT'),
  'the trusted push-subscription worker can persist subscriptions'
);

select is(
  (select count(*)::bigint from public.regulatory_rule_pack_templates where template_key = 'oh.rcf.3701-16.personnel'),
  1::bigint,
  'the Ohio assisted-living training template is seeded once'
);
select is(
  (select jurisdiction_code from public.regulatory_rule_pack_templates where template_key = 'oh.rcf.3701-16.personnel'),
  'US-OH'::text,
  'the Ohio template is explicitly jurisdiction-scoped'
);
select is(
  (select is_enabled from public.release_flags where feature_key = 'analytics.cross_tenant_benchmarks'),
  false,
  'cross-tenant benchmarks remain release-gated by default'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.benchmark_snapshots'::regclass
      and pg_get_constraintdef(oid) ilike '%organization_count >= 10%'
  ),
  'benchmark cohorts enforce k-anonymity at the database boundary'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.notification_deliveries'::regclass
      and pg_get_constraintdef(oid) ilike '%web_push%'
  ),
  'notification delivery constraints include web push'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.notification_delivery_attempts'::regclass
      and pg_get_constraintdef(oid) ilike '%web_push%'
  ),
  'provider attempt evidence recognizes the web-push provider'
);
select is(
  (select source_uri from public.regulatory_rule_pack_templates where template_key = 'oh.rcf.3701-16.personnel'),
  'https://codes.ohio.gov/ohio-administrative-code/rule-3701-16-06'::text,
  'the Ohio template records its official source'
);
select is(
  (select relkind::text from pg_class where oid = 'app_private.retained_records_archive'::regclass),
  'p'::text,
  'the retained-record archive is natively partitioned'
);
select is(
  (select count(*)::bigint from cron.job where jobname = 'poll-regulatory-updates-weekly'),
  1::bigint,
  'official regulatory sources are scheduled for weekly polling'
);
select is(
  (select count(*)::bigint from cron.job where jobname = 'run-data-lifecycle-nightly'),
  1::bigint,
  'lifecycle enforcement is scheduled nightly'
);

select * from finish();
rollback;
