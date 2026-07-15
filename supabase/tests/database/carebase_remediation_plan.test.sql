begin;
select plan(59);

select has_table('public', 'medication_integration_sources', 'external medication sources are governed');
select has_table('public', 'medication_resident_mappings', 'external resident identifiers require explicit mapping');
select has_table('public', 'external_medication_orders', 'normalized external medication orders exist');
select has_table('public', 'external_medication_administration_events', 'external administration evidence exists');
select has_table('public', 'medication_integration_exceptions', 'medication synchronization has an exception queue');
select has_table('public', 'resident_portal_grants', 'designated-person grants are first-class records');
select has_table('public', 'resident_portal_shared_documents', 'portal documents require explicit sharing');
select has_table('public', 'resident_portal_messages', 'portal messages are scoped to a grant');
select has_table('public', 'resident_portal_access_events', 'portal access evidence is retained');
select has_table('public', 'facility_licenses', 'facility license lifecycle exists');
select has_table('public', 'facility_license_conditions', 'license conditions are structured');
select has_table('public', 'facility_regulatory_waivers', 'regulatory waivers are structured');
select has_table('public', 'facility_regulatory_filings', 'regulatory filings are structured');
select has_table('public', 'facility_license_history', 'license history is append-only evidence');
select has_function('public', 'create_incident_atomic', array['uuid','uuid','text','timestamp with time zone','uuid','text','text','text','text','jsonb','jsonb','text'], 'incident intake has one atomic command');
select has_function('public', 'triage_shift_report_entry', array['uuid','uuid','text','text'], 'shift handoffs have triage ownership');
select has_function('public', 'convert_shift_report_entry', array['uuid','text','text'], 'shift handoffs route into formal workflows');
select has_function('public', 'list_shift_swap_candidates', array['uuid'], 'shift swaps expose eligible candidates');
select has_function('public', 'get_resident_timeline', array['uuid','integer'], 'resident timeline composes operational evidence');
select has_function('public', 'create_resident_portal_grant', array['uuid','text','text','text','text[]','timestamp with time zone'], 'portal grant creation returns a one-time token');
select has_function('public', 'apply_medication_integration_command', array['uuid'], 'medication imports apply through the command inbox');
select ok(not has_table_privilege('anon', 'public.resident_portal_grants', 'SELECT'), 'anonymous callers cannot enumerate portal grants');
select ok(not has_table_privilege('anon', 'public.external_medication_orders', 'SELECT'), 'anonymous callers cannot read external medication records');
select ok(has_function_privilege('anon', 'public.get_resident_portal_snapshot(text,text)', 'EXECUTE'), 'anonymous portal access uses one narrow token RPC');
select ok(not has_function_privilege('anon', 'public.apply_medication_integration_command(uuid)', 'EXECUTE'), 'anonymous callers cannot apply medication imports');
select ok(not has_table_privilege('authenticated', 'public.external_medication_orders', 'INSERT'), 'browser roles cannot forge external medication orders');
select ok(not has_table_privilege('authenticated', 'public.resident_portal_grants', 'INSERT'), 'browser roles cannot bypass portal grant commands');
select ok(not exists(
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in (
    'medication_integration_sources','medication_resident_mappings','external_medication_orders',
    'external_medication_administration_events','medication_integration_exceptions',
    'resident_portal_grants','resident_portal_shared_documents','resident_portal_messages',
    'resident_portal_access_events','facility_licenses','facility_license_conditions',
    'facility_regulatory_waivers','facility_regulatory_filings','facility_license_history'
  ) and not c.relrowsecurity
), 'all new browser-visible records enable RLS');

insert into public.organizations(id, name, slug, subscription_status)
values ('88000000-0000-4000-8000-000000000001', 'Remediation Test Org', 'remediation-test-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type)
values ('88000000-0000-4000-8000-000000000011', '88000000-0000-4000-8000-000000000001', 'Remediation Facility', 'PCH');
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  email_change_token_current,reauthentication_token,is_sso_user,is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000','88000000-0000-4000-8000-000000000101',
  'authenticated','authenticated','remediation-admin@test.local','x',now(),
  '{}','{}',now(),now(),'','','','','','',false,false
);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values ('88000000-0000-4000-8000-000000000101','88000000-0000-4000-8000-000000000001',
  'remediation-admin@test.local','Remediation','Admin','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id, role=excluded.role, is_active=true;
select set_config('app.privileged_write', 'off', true);
insert into public.residents(id, organization_id, facility_id, first_name, last_name, room, admission_date)
values ('88000000-0000-4000-8000-000000000201','88000000-0000-4000-8000-000000000001',
  '88000000-0000-4000-8000-000000000011','Resident','Example','12A',current_date - 30);
insert into public.integration_api_credentials(
  id, organization_id, name, key_prefix, scopes, status, expires_at, rate_limit_per_minute, created_by
) values (
  '88000000-0000-4000-8000-000000000301','88000000-0000-4000-8000-000000000001',
  'Medication Test Credential','abc123def456',array['medications:write'],'active',now()+interval '30 days',120,
  '88000000-0000-4000-8000-000000000101'
);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',p_id,'role',p_role,'aal','aal2','iat',extract(epoch from now())::bigint
  )::text, true);
  if p_role = 'anon' then set local role anon;
  elsif p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;
create temporary table remediation_ids(key text primary key, id uuid, value text) on commit drop;
grant all on remediation_ids to authenticated, anon, service_role;

select pg_temp.act_as('88000000-0000-4000-8000-000000000101');
select lives_ok($$
  insert into remediation_ids(key,id)
  select 'license', id from public.save_facility_license(
    '88000000-0000-4000-8000-000000000011',
    jsonb_build_object(
      'licenseType','personal_care_home','licenseNumber','PCH-TEST-001','status','active',
      'effectiveFrom',current_date,'expiresOn',current_date+365,'licensedCapacity',20,
      'issuingAuthority','Pennsylvania Department of Human Services'
    ),'Initial verified certificate record'
  )
$$, 'manager creates a structured facility license record');
select is((select count(*)::integer from public.facility_license_history where entity_id=(select id from remediation_ids where key='license')),
  1, 'facility license save appends immutable history');
select lives_ok($$
  insert into remediation_ids(key,id)
  select 'incident', id from public.create_incident_atomic(
    '88000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000011',
    'medication_error',now(),'88000000-0000-4000-8000-000000000201','Resident Example',
    'Medication room','A complete incident narrative for atomic intake.','major','[]'::jsonb,
    jsonb_build_array(jsonb_build_object('notification_type','family_guardian','due_at',now()+interval '1 hour','notes','Notify designated person')),
    'incident-remediation-001'
  )
$$, 'atomic incident creation succeeds');
select is((select id from public.create_incident_atomic(
  '88000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000011',
  'medication_error',now(),'88000000-0000-4000-8000-000000000201','Resident Example',
  'Medication room','A complete incident narrative for atomic intake.','major','[]'::jsonb,
  '[]'::jsonb,'incident-remediation-001')),
  (select id from remediation_ids where key='incident'), 'incident idempotency returns the canonical record');
select is((select resident_id from public.incidents where id=(select id from remediation_ids where key='incident')),
  '88000000-0000-4000-8000-000000000201'::uuid, 'incident retains a real resident foreign key');

select lives_ok($$
  insert into remediation_ids(key,id,value)
  select 'portal', grant_id, access_token from public.create_resident_portal_grant(
    '88000000-0000-4000-8000-000000000201','Jordan Representative','Designated person',
    'jordan@example.test',array['schedule','finance','documents','messages'],now()+interval '30 days'
  )
$$, 'manager creates a scoped designated-person grant');
select isnt((select token_sha256 from public.resident_portal_grants where id=(select id from remediation_ids where key='portal')),
  (select value from remediation_ids where key='portal'), 'the raw portal token is never stored');

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'anon');
select is((public.get_resident_portal_snapshot((select value from remediation_ids where key='portal'),null)->>'accessStatus'),
  'terms_required', 'portal fails closed until current terms are accepted');
select ok(public.accept_resident_portal_terms((select value from remediation_ids where key='portal'),'resident-portal-v1',null),
  'valid token can accept the exact current terms');
select is((public.get_resident_portal_snapshot((select value from remediation_ids where key='portal'),null)->>'accessStatus'),
  'active', 'accepted grant returns the narrow portal snapshot');
select ok(public.post_resident_portal_message((select value from remediation_ids where key='portal'),'Routine question for the facility.',null),
  'designated person can send a routine scoped message');

select pg_temp.act_as('88000000-0000-4000-8000-000000000101');
select is((select count(*)::integer from public.notifications where notification_type='portal_message_received'),
  1, 'portal message notifies facility leadership without copying message content');
select lives_ok($$select public.reply_resident_portal_message((select id from remediation_ids where key='portal'),'Facility response')$$,
  'manager can reply through the same scoped grant');
select lives_ok($$select public.revoke_resident_portal_grant((select id from remediation_ids where key='portal'),'Access no longer required')$$,
  'manager can revoke portal access immediately');
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'anon');
select is((public.get_resident_portal_snapshot((select value from remediation_ids where key='portal'),null)->>'accessStatus'),
  'invalid', 'revoked portal token fails closed');
reset role;
select cmp_ok((select count(*)::integer from public.resident_portal_access_events where grant_id=(select id from remediation_ids where key='portal')),
  '>=', 4, 'portal terms, views, message, and revocation leave access evidence');

select pg_temp.act_as('88000000-0000-4000-8000-000000000101');
select lives_ok($$
  insert into remediation_ids(key,id)
  values ('med-source', public.save_medication_integration_source(
    '88000000-0000-4000-8000-000000000011','Primary eMAR','Example eMAR','facility-external-1',
    '88000000-0000-4000-8000-000000000301',60,'active',null
  ))
$$, 'manager configures a medication source bound to a least-privilege credential');
select lives_ok($$select public.map_medication_resident(
  (select id from remediation_ids where key='med-source'),'88000000-0000-4000-8000-000000000201','external-resident-1'
)$$, 'manager explicitly maps the external resident identifier');

select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'service_role');
select lives_ok($$
  insert into remediation_ids(key,id)
  select 'med-command', command_id from public.accept_integration_command(
    '88000000-0000-4000-8000-000000000301','medsync-001',repeat('a',64),
    'medication.snapshot.import','2026-07-14',
    jsonb_build_object(
      'sourceId',(select id from remediation_ids where key='med-source'),
      'orders',jsonb_build_array(jsonb_build_object(
        'externalResidentId','external-resident-1','externalOrderId','order-1',
        'medicationDisplay','External test medication','directions','Per external order',
        'scheduleDisplay','Daily','status','active','sourceUpdatedAt',now()
      )),
      'administrations',jsonb_build_array(jsonb_build_object(
        'externalResidentId','external-resident-1','externalOrderId','order-1',
        'externalEventId','event-1','status','refused','occurredAt',now(),
        'administeredByDisplay','External staff','note','Recorded in source eMAR'
      ))
    ),'remediation-medication-sync'
  )
$$, 'medication snapshot enters the existing idempotent command inbox');
select is((public.apply_medication_integration_command((select id from remediation_ids where key='med-command'))->>'exceptions')::integer,
  0, 'valid medication snapshot applies without exceptions');
select is((select count(*)::integer from public.external_medication_orders where external_order_id='order-1'),
  1, 'normalized external order is imported once');
select is((select count(*)::integer from public.external_medication_administration_events where external_event_id='event-1'),
  1, 'external administration evidence is imported once');
select is((select status from app_private.integration_command_receipts where id=(select id from remediation_ids where key='med-command')),
  'applied', 'command receipt records successful application');
reset role;
select throws_ok($$update public.external_medication_administration_events set source_note='rewritten' where external_event_id='event-1'$$,
  '55000', null, 'external medication administration evidence is append-only');
update public.medication_integration_sources set last_sync_completed_at=now()-interval '2 hours'
where id=(select id from remediation_ids where key='med-source');
select pg_temp.act_as('00000000-0000-0000-0000-000000000000', 'service_role');
select is(public.run_medication_integration_freshness_evaluator(now()), 1, 'freshness evaluator detects an overdue medication source');
select is((select exception_type from public.medication_integration_exceptions where source_id=(select id from remediation_ids where key='med-source') and exception_key='stale:source'),
  'stale_source', 'stale synchronization creates an owned exception');
select pg_temp.act_as('88000000-0000-4000-8000-000000000101');
select is((select count(*)::integer from public.get_resident_timeline('88000000-0000-4000-8000-000000000201',100) where event_type='external_medication'),
  1, 'resident timeline includes authorized external medication evidence');

reset role;
insert into public.facility_license_history(
  organization_id,facility_id,entity_type,entity_id,event_type,summary
) values (
  '88000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000011',
  'license','88000000-0000-4000-8000-000000000901','created','Initial license evidence'
);
select throws_ok($$update public.facility_license_history set summary='rewritten' where entity_id='88000000-0000-4000-8000-000000000901'$$,
  '55000', null, 'facility license history is append-only');
select ok(exists(select 1 from cron.job where jobname='medication-integration-freshness'),
  'medication freshness evaluation is scheduled');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='incidents_org_idempotency_key_uk'),
  'incident idempotency has a supporting unique index');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='resident_service_calendar_events_resident_idx'),
  'resident timeline source has a supporting resident index');

select * from finish();
rollback;
