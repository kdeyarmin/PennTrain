begin;
select plan(25);

insert into public.organizations(id,name,slug,subscription_status) values
  ('26000000-0000-4000-8000-000000000001','Scheduled Reports Org','scheduled-reports-org','active'),
  ('26000000-0000-4000-8000-000000000002','Other Reports Org','other-reports-org','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('26000000-0000-4000-8000-000000000011','26000000-0000-4000-8000-000000000001','North House','PCH'),
  ('26000000-0000-4000-8000-000000000012','26000000-0000-4000-8000-000000000002','Other House','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',v.id,'authenticated','authenticated',v.email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values
  ('26000000-0000-4000-8000-000000000021'::uuid,'scheduled-admin@test.local'),
  ('26000000-0000-4000-8000-000000000022'::uuid,'scheduled-manager@test.local'),
  ('26000000-0000-4000-8000-000000000023'::uuid,'scheduled-auditor@test.local'),
  ('26000000-0000-4000-8000-000000000024'::uuid,'scheduled-employee@test.local'),
  ('26000000-0000-4000-8000-000000000025'::uuid,'other-admin@test.local')
) as v(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('26000000-0000-4000-8000-000000000021','26000000-0000-4000-8000-000000000001','scheduled-admin@test.local','Scheduled','Admin','org_admin',true),
  ('26000000-0000-4000-8000-000000000022','26000000-0000-4000-8000-000000000001','scheduled-manager@test.local','Scheduled','Manager','facility_manager',true),
  ('26000000-0000-4000-8000-000000000023','26000000-0000-4000-8000-000000000001','scheduled-auditor@test.local','Scheduled','Auditor','auditor',true),
  ('26000000-0000-4000-8000-000000000024','26000000-0000-4000-8000-000000000001','scheduled-employee@test.local','Scheduled','Employee','employee',true),
  ('26000000-0000-4000-8000-000000000025','26000000-0000-4000-8000-000000000002','other-admin@test.local','Other','Admin','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,email=excluded.email,
  first_name=excluded.first_name,last_name=excluded.last_name,role=excluded.role,is_active=excluded.is_active;
select set_config('app.privileged_write','off',true);
insert into public.facility_assignments(profile_id,facility_id) values
  ('26000000-0000-4000-8000-000000000022','26000000-0000-4000-8000-000000000011');

insert into public.incidents(
  id,organization_id,facility_id,incident_type,occurred_at,narrative,severity,status
) values (
  '26000000-0000-4000-8000-000000000101','26000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000011','other','2026-07-10 12:00:00+00','Open report fixture','moderate','reported'
);

create or replace function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
  set local role authenticated;
end $$;
create temp table sr_ids(key text primary key,id uuid) on commit drop;
grant all on sr_ids to authenticated;

select pg_temp.act_as('26000000-0000-4000-8000-000000000024');
select throws_ok(
  $$ select public.upsert_scheduled_report(
    null,'Open incidents','open_incidents','26000000-0000-4000-8000-000000000011','weekly','America/New_York',
    'rolling',30,null,null,null,array['in_app'],array['26000000-0000-4000-8000-000000000024'::uuid],2555,true,false
  ) $$,'42501',null,'employees cannot manage report schedules'
);

select pg_temp.act_as('26000000-0000-4000-8000-000000000022');
select throws_ok(
  $$ select public.upsert_scheduled_report(
    null,'Organization incidents','open_incidents',null,'weekly','America/New_York',
    'rolling',30,null,null,null,array['in_app'],array['26000000-0000-4000-8000-000000000022'::uuid],2555,true,false
  ) $$,'42501',null,'facility managers cannot schedule organization-wide reports'
);
select throws_ok(
  $$ select public.upsert_scheduled_report(
    null,'Cross tenant incidents','open_incidents','26000000-0000-4000-8000-000000000011','weekly','America/New_York',
    'rolling',30,null,null,null,array['in_app'],array['26000000-0000-4000-8000-000000000025'::uuid],2555,true,false
  ) $$,'22023',null,'cross-organization recipients are rejected'
);

insert into sr_ids(key,id)
select 'schedule',(public.upsert_scheduled_report(
  null,'Weekly open incidents','open_incidents','26000000-0000-4000-8000-000000000011','weekly','America/New_York',
  'rolling',30,null,null,null,array['in_app','email_link','evidence_room'],
  array['26000000-0000-4000-8000-000000000022'::uuid,'26000000-0000-4000-8000-000000000023'::uuid],
  365,true,true
)).id;

select results_eq(
  $$ select report_kind,frequency,retention_days,enabled,publish_to_evidence_room
     from public.report_schedules where id=(select id from sr_ids where key='schedule') $$,
  $$ values ('open_incidents'::text,'weekly'::text,365,true,true) $$,
  'a manager can save a complete facility-scoped schedule'
);
select results_eq(
  $$ select count(*)::int from public.report_schedule_recipients where schedule_id=(select id from sr_ids where key='schedule') $$,
  array[2],'authorized recipients are persisted'
);
select results_eq(
  $$ select v.version_number,v.state,(v.configuration_sha256 ~ '^[0-9a-f]{64}$')
     from public.saved_report_versions v join public.report_schedules s on s.report_version_id=v.id
     where s.id=(select id from sr_ids where key='schedule') $$,
  $$ values (1,'published'::text,true) $$,
  'schedule creation publishes a checksummed report definition version'
);

insert into sr_ids(key,id)
select 'run1',public.run_scheduled_report_now((select id from sr_ids where key='schedule'),'2026-07-13');
select results_eq(
  $$ select status from public.report_schedule_runs where id=(select id from sr_ids where key='run1') $$,
  array['succeeded'::text],'manual generation succeeds'
);
insert into sr_ids(key,id)
select 'snapshot1',snapshot_id from public.report_schedule_runs where id=(select id from sr_ids where key='run1');
select results_eq(
  $$ select reconciliation_status,(material_totals->>'total')::int,(trend_comparison->>'previousTotal') is null,
            retention_expires_at is not null,(snapshot_sha256 ~ '^[0-9a-f]{64}$')
     from public.report_snapshots where id=(select id from sr_ids where key='snapshot1') $$,
  $$ values ('reconciled'::text,1,true,true,true) $$,
  'the immutable snapshot is reconciled, retained, and checksummed'
);
select results_eq(
  $$ select delivery_method,status,count(*)::int from public.report_delivery_attempts
     where run_id=(select id from sr_ids where key='run1') group by delivery_method,status order by delivery_method,status $$,
  $$ values ('email_link'::text,'queued'::text,2),('evidence_room'::text,'published'::text,1),('in_app'::text,'delivered'::text,2) $$,
  'recipient delivery and evidence publication history is complete'
);
select results_eq(
  $$ select count(*)::int from public.report_snapshot_publications where snapshot_id=(select id from sr_ids where key='snapshot1') $$,
  array[1],'the snapshot is published into the evidence room'
);
reset role;
select throws_ok(
  $$ update public.report_snapshots set material_totals='{}' where id=(select id from sr_ids where key='snapshot1') $$,
  '55000',null,'snapshot facts are append-only'
);
select pg_temp.act_as('26000000-0000-4000-8000-000000000022');
insert into sr_ids(key,id)
select 'run_repeat',public.run_scheduled_report_now((select id from sr_ids where key='schedule'),'2026-07-13');
select results_eq(
  $$ select r.status,r.snapshot_id=(select id from sr_ids where key='snapshot1')
     from public.report_schedule_runs r
     where r.id=(select id from sr_ids where key='run_repeat') $$,
  $$ values ('succeeded'::text,true) $$,
  'repeating an as-of date reuses the immutable snapshot idempotently'
);

reset role;
insert into public.incidents(
  id,organization_id,facility_id,incident_type,occurred_at,narrative,severity,status
) values (
  '26000000-0000-4000-8000-000000000102','26000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000011','other','2026-07-14 12:00:00+00','Second report fixture','minor','investigating'
);
select pg_temp.act_as('26000000-0000-4000-8000-000000000022');
insert into sr_ids(key,id)
select 'run2',public.run_scheduled_report_now((select id from sr_ids where key='schedule'),'2026-07-14');
select results_eq(
  $$ select (s.trend_comparison->>'currentTotal')::int,(s.trend_comparison->>'previousTotal')::int,
            (s.trend_comparison->>'absoluteChange')::int,s.previous_snapshot_id=(select id from sr_ids where key='snapshot1')
     from public.report_snapshots s join public.report_schedule_runs r on r.snapshot_id=s.id
     where r.id=(select id from sr_ids where key='run2') $$,
  $$ values (2,1,1,true) $$,
  'subsequent snapshots compare against the prior period'
);

select results_eq(
  $$ select enabled,next_run_at is null from public.set_report_schedule_enabled((select id from sr_ids where key='schedule'),false) $$,
  $$ values (false,true) $$,'a manager can pause a schedule'
);
select results_eq(
  $$ select enabled,next_run_at is not null from public.set_report_schedule_enabled((select id from sr_ids where key='schedule'),true) $$,
  $$ values (true,true) $$,'a manager can resume a schedule'
);

insert into sr_ids(key,id)
select 'delivery',notification_delivery_id from public.report_delivery_attempts
where run_id=(select id from sr_ids where key='run1') and delivery_method='email_link' order by created_at limit 1;
insert into sr_ids(key,id)
select 'attempt',id from public.report_delivery_attempts
where notification_delivery_id=(select id from sr_ids where key='delivery');
reset role;
update public.notification_deliveries set status='failed',final_outcome='failed',finalized_at=now(),error_message='provider unavailable'
where id=(select id from sr_ids where key='delivery');
select pg_temp.act_as('26000000-0000-4000-8000-000000000022');
insert into sr_ids(key,id)
select 'retry_attempt',public.retry_report_delivery_attempt((select id from sr_ids where key='attempt'));
select results_eq(
  $$ select attempt_number,status,retry_of_attempt_id=(select id from sr_ids where key='attempt')
     from public.report_delivery_attempts where id=(select id from sr_ids where key='retry_attempt') $$,
  $$ values (2,'queued'::text,true) $$,'failed email delivery creates an append-only retry attempt'
);
select throws_ok(
  $$ select public.retry_report_delivery_attempt((select id from sr_ids where key='retry_attempt')) $$,
  '22023',null,'queued delivery cannot be retried'
);
reset role;
select throws_ok(
  $$ update public.report_delivery_attempts set status='failed' where id=(select id from sr_ids where key='retry_attempt') $$,
  '55000',null,'delivery attempt history is append-only'
);

select pg_temp.act_as('26000000-0000-4000-8000-000000000023');
select results_eq(
  $$ select count(*)::int from public.report_schedules where id=(select id from sr_ids where key='schedule') $$,
  array[1],'auditors can read schedules in their organization'
);
select throws_ok(
  $$ select public.set_report_schedule_enabled((select id from sr_ids where key='schedule'),false) $$,
  '42501',null,'auditors cannot mutate schedules'
);

select pg_temp.act_as('26000000-0000-4000-8000-000000000025');
select results_eq(
  $$ select count(*)::int from public.report_schedules $$,array[0],
  'schedules are invisible across organizations'
);
select results_eq(
  $$ select count(*)::int from public.report_schedule_runs $$,array[0],
  'run history is invisible across organizations'
);
select throws_ok(
  $$ select public.run_due_report_schedules(50) $$,'42501',null,
  'authenticated users cannot invoke the cron dispatcher'
);

reset role;
select results_eq(
  $$ select count(*)::int from cron.job where jobname='run-scheduled-historical-reports' $$,
  array[1],'one bounded cron dispatcher is registered'
);
select results_eq(
  $$ select count(*)::int from public.report_schedule_runs where schedule_id=(select id from sr_ids where key='schedule') $$,
  array[3],'manual history retains every successful run'
);

select * from finish();
rollback;
