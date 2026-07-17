begin;
select plan(55);

select has_table('public','workflow_automation_rules','configurable automation rules exist');
select has_table('public','workflow_automation_runs','automation execution receipts exist');
select has_table('public','inspection_war_rooms','inspection war rooms exist');
select has_table('public','inspection_war_room_requests','inspection evidence requests exist');
select has_table('public','implementation_projects','implementation projects exist');
select has_table('public','implementation_tasks','implementation tasks exist');
select has_table('public','customer_value_baselines','customer-controlled value assumptions exist');
select has_table('public','resident_portal_requests','designated-person requests exist');
select has_table('public','resident_portal_schedule_responses','designated-person schedule responses exist');
select has_table('public','resident_payment_links','external payment links exist');
select has_table('public','copilot_action_drafts','governed assistant drafts exist');

select has_column('public','medication_integration_exceptions','owner_profile_id','medication exceptions have accountable owners');
select has_column('public','medication_integration_exceptions','due_at','medication exceptions have due dates');
select has_column('public','medication_integration_exceptions','service_level_minutes','medication exceptions have explicit SLAs');
select has_column('public','medication_integration_exceptions','escalated_at','medication exception escalation is recorded');
select has_column('public','medication_integration_exceptions','linked_work_item_id','medication exceptions link to operational work');

select has_function('public','save_workflow_automation_rule',array['uuid','uuid','text','text','text','jsonb','jsonb','text'],'automation rules save through a scoped command');
select has_function('public','run_workflow_automation_now',array['uuid','uuid','text','uuid','jsonb'],'automation has an explicit manual execution command');
select has_function('public','create_inspection_war_room',array['uuid','text','text','timestamp with time zone','uuid','text'],'inspection rooms use a scoped command');
select has_function('public','add_inspection_war_room_request',array['uuid','text','text','text','uuid','text','timestamp with time zone'],'inspection requests create linked work');
select has_function('public','update_inspection_war_room_request',array['uuid','text','text'],'inspection requests have a governed lifecycle');
select has_function('public','initialize_implementation_project',array['text','date','uuid','jsonb'],'implementation projects initialize from a standard checklist');
select has_function('public','update_implementation_task',array['uuid','text','uuid','date','text'],'implementation tasks capture ownership and evidence');
select has_function('public','save_report_schedule',array['uuid','text','text','jsonb','text'],'saved reports can be subscribed');
select has_function('public','set_report_schedule_enabled',array['uuid','boolean'],'report subscriptions can be paused');
select has_function('public','process_due_report_schedules',array[]::text[],'scheduled report worker exists');
select has_function('app_private','next_report_schedule_run',array['text','text','timestamp with time zone'],'report schedules honor the configured time zone');
select has_function('public','save_customer_value_baseline',array['numeric','numeric','jsonb','jsonb','text'],'customer-entered savings assumptions are explicit');
select has_function('public','get_customer_value_dashboard',array[]::text[],'recorded outcomes can be valued');
select has_function('public','get_staffing_optimization_snapshot',array['uuid','date','date'],'staffing optimizer read model exists');
select has_function('public','get_admissions_intelligence_snapshot',array['uuid'],'admissions intelligence read model exists');
select has_function('public','register_offline_learning_device',array['text','text'],'offline devices register explicitly');
select has_function('public','prepare_offline_course_bundle',array['uuid','uuid','text'],'offline bundles are assignment scoped');
select has_function('public','revoke_offline_learning_device',array['uuid'],'offline devices can be remotely wiped');
select has_function('public','post_resident_portal_request',array['text','text','text','text','text'],'portal requests use the grant token boundary');
select has_function('public','respond_resident_portal_schedule_event',array['text','uuid','text','text'],'portal schedule responses are scoped to shared events');
select has_function('public','save_resident_payment_link',array['uuid','text','text','numeric','timestamp with time zone'],'payment links use a manager command');
select has_function('public','authorize_resident_portal_document_download',array['text','uuid','text'],'portal downloads are reauthorized and audited');
select has_function('public','get_resident_portal_experience',array['text'],'portal 2.0 returns only permissioned experience data');
select has_function('public','assign_medication_integration_exception',array['uuid','uuid','timestamp with time zone','integer','boolean'],'medication exceptions can create owned work');
select has_function('public','create_copilot_action_draft',array['uuid','text','text','uuid','jsonb'],'assistant can only propose governed action drafts');
select has_function('public','review_copilot_action_draft',array['uuid','text','text'],'assistant drafts require explicit human review');
select has_function('public','get_product_value_workspace',array['uuid'],'Value Center uses one tenant-scoped read model');

select ok(not exists(
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in(
    'workflow_automation_rules','workflow_automation_runs','inspection_war_rooms','inspection_war_room_requests',
    'implementation_projects','implementation_tasks','customer_value_baselines','resident_portal_requests',
    'resident_portal_schedule_responses','resident_payment_links','copilot_action_drafts'
  ) and not c.relrowsecurity
),'all product-value caller-facing tables enable RLS');
select ok(not exists(
  select 1 from pg_policies
  where schemaname = 'public'
    and tablename in (
      'workflow_automation_rules','workflow_automation_runs','inspection_war_rooms','inspection_war_room_requests',
      'implementation_projects','implementation_tasks','customer_value_baselines','resident_portal_requests',
      'resident_portal_schedule_responses','resident_payment_links','copilot_action_drafts'
    )
    and roles @> array['authenticated']::name[]
    and coalesce(qual, '') not like '%current_role%'
),'product-value read policies require a privileged operating role');
select is((select count(*)::bigint from cron.job where jobname='process-carebase-report-subscriptions'),1::bigint,'scheduled report worker is registered once');
select ok(not has_function_privilege('anon','public.save_workflow_automation_rule(uuid,uuid,text,text,text,jsonb,jsonb,text)','EXECUTE'),'anonymous callers cannot configure automations');
select ok(not has_function_privilege('anon','public.save_customer_value_baseline(numeric,numeric,jsonb,jsonb,text)','EXECUTE'),'anonymous callers cannot change savings assumptions');
select ok(not has_function_privilege('anon','public.assign_medication_integration_exception(uuid,uuid,timestamp with time zone,integer,boolean)','EXECUTE'),'anonymous callers cannot assign medication work');
select ok(not has_function_privilege('authenticated','public.process_due_report_schedules()','EXECUTE'),'only the report worker can process due schedules');
select ok(not has_function_privilege('authenticated','app_private.next_report_schedule_run(text,text,timestamp with time zone)','EXECUTE'),'schedule calculation helper is not a caller API');
select is(
  app_private.next_report_schedule_run('daily','America/New_York','2026-03-07 14:00:00+00'::timestamptz),
  '2026-03-08 11:00:00+00'::timestamptz,
  'daily report delivery remains at 7 AM across daylight-saving time'
);
select ok(has_function_privilege('anon','public.authorize_resident_portal_document_download(text,uuid,text)','EXECUTE'),'portal document authorization is a narrow anonymous API');
select ok(exists(select 1 from pg_constraint c where c.conrelid='public.notifications'::regclass and pg_get_constraintdef(c.oid) like '%report_subscription_ready%' and pg_get_constraintdef(c.oid) like '%automation_action_due%'),'notifications admit product-value workflow events');
select ok(exists(select 1 from pg_constraint c where c.conrelid='public.resident_portal_grants'::regclass and pg_get_constraintdef(c.oid) like '%requests%' and pg_get_constraintdef(c.oid) like '%payments%'),'portal grants can explicitly authorize requests and payments');

select * from finish();
rollback;
