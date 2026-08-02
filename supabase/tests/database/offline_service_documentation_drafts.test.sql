begin;
select plan(29);

-- E5 Tier 1: offline service documentation drafts + conflict rules
-- (20260802030000_offline_service_documentation_drafts.sql).

-- Schema -----------------------------------------------------------------------------------------
select has_table('public', 'offline_service_draft_receipts', 'offline service draft receipts exist');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.offline_service_draft_receipts'::regclass),
  'offline service draft receipts are row-level secured'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'offline_service_draft_receipts'
      and grantee in ('anon', 'public')
  ),
  'offline service draft receipts are not readable by anon or public'
);
select ok(
  not has_table_privilege('authenticated', 'public.offline_service_draft_receipts', 'INSERT'),
  'offline clients cannot forge sync receipts directly -- only the RPC may write them'
);
select has_function(
  'public', 'register_offline_service_device', array['text', 'text'],
  'offline service devices register explicitly'
);
select has_function(
  'public', 'revoke_offline_service_device', array['uuid'],
  'offline service devices can be remotely wiped'
);
select has_function(
  'public', 'sync_offline_service_task_draft',
  array['uuid', 'uuid', 'text', 'timestamp with time zone', 'text', 'jsonb'],
  'offline service sync is a server command that classifies record_service_task_response'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.offline_service_draft_receipts'::regclass
     and pg_get_constraintdef(oid) like '%outcome%' and pg_get_constraintdef(oid) like '%applied%')
  like '%duplicate%' and
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.offline_service_draft_receipts'::regclass
     and pg_get_constraintdef(oid) like '%outcome%' and pg_get_constraintdef(oid) like '%applied%')
  like '%conflict%' and
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.offline_service_draft_receipts'::regclass
     and pg_get_constraintdef(oid) like '%outcome%' and pg_get_constraintdef(oid) like '%applied%')
  like '%stale%' and
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.offline_service_draft_receipts'::regclass
     and pg_get_constraintdef(oid) like '%outcome%' and pg_get_constraintdef(oid) like '%applied%')
  like '%rejected%' and
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.offline_service_draft_receipts'::regclass
     and pg_get_constraintdef(oid) like '%outcome%' and pg_get_constraintdef(oid) like '%applied%')
  like '%wipe_required%',
  'the outcome vocabulary covers every classified branch: applied, duplicate, conflict, stale, rejected, wipe_required'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.offline_service_draft_receipts'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%device_id%'
      and pg_get_constraintdef(oid) like '%idempotency_key%'
  ),
  'device id and idempotency key are jointly unique, so a replayed sync cannot double-insert'
);

-- Fixtures -----------------------------------------------------------------------------------------

insert into public.organizations(id, name, slug, subscription_status)
values ('65000000-0000-4000-8000-000000000001', 'Offline Draft Org', 'offline-draft-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type)
values ('65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000001', 'Offline Draft Facility', 'PCH');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000101',
   'authenticated', 'authenticated', 'offline-worker-a@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', '65000000-0000-4000-8000-000000000102',
   'authenticated', 'authenticated', 'offline-worker-b@test.local', 'x', now(), '{}', '{}',
   now(), now(), '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active)
values
  ('65000000-0000-4000-8000-000000000101', '65000000-0000-4000-8000-000000000001',
   'offline-worker-a@test.local', 'Worker', 'A', 'employee', true),
  ('65000000-0000-4000-8000-000000000102', '65000000-0000-4000-8000-000000000001',
   'offline-worker-b@test.local', 'Worker', 'B', 'employee', true)
on conflict(id) do update
set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);

insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name,
  email, job_title, hire_date, status
) values
  ('65000000-0000-4000-8000-000000000111', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000101',
   'Worker', 'A', 'offline-worker-a@test.local', 'Direct Care Staff', public.pa_today(), 'active'),
  ('65000000-0000-4000-8000-000000000112', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000102',
   'Worker', 'B', 'offline-worker-b@test.local', 'Direct Care Staff', public.pa_today(), 'active');

insert into public.residents(
  id, organization_id, facility_id, first_name, last_name, admission_date
) values (
  '65000000-0000-4000-8000-000000000201', '65000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000011', 'Jamie', 'Resident', public.pa_today()
);

insert into public.resident_assessment_forms(
  id, organization_id, facility_id, resident_id, form_type, reason, status
) values (
  '65000000-0000-4000-8000-000000000301', '65000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
  'RASP', 'initial', 'draft'
);

-- requirement1: ordinary scheduled care, all seven responses -- backs task1/task2/task3/task5/task6.
insert into public.resident_service_requirements(
  id, organization_id, facility_id, resident_id, source_assessment_form_id, source_plan_version,
  source_section, source_key, service_code, service_name, special_instructions, frequency,
  responsible_role, effective_from
) values (
  '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
  '65000000-0000-4000-8000-000000000301', 1, 'section1', 'bathing', 'bathe', 'Bathing assistance',
  'Provide bathing assistance', 'daily', 'employee', public.pa_today()
);
-- requirement2: documentation_requirement, narrower response set -- backs task4 (the rejected case:
-- a resident cannot "refuse" paperwork, so resident_refused is not accepted for it).
insert into public.resident_service_requirements(
  id, organization_id, facility_id, resident_id, source_assessment_form_id, source_plan_version,
  source_section, source_key, service_code, service_name, special_instructions, frequency,
  responsible_role, effective_from, task_kind, acceptable_completion_responses
) values (
  '65000000-0000-4000-8000-000000000402', '65000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
  '65000000-0000-4000-8000-000000000301', 1, 'section1', 'paperwork', 'chart-check', 'Chart review',
  'Confirm chart is current', 'daily', 'employee', public.pa_today(), 'documentation_requirement',
  array['completed_as_planned', 'partially_completed', 'not_completed']
);

insert into public.resident_service_task_instances(
  id, organization_id, facility_id, resident_id, requirement_id, source_assessment_form_id,
  source_plan_version, service_name, responsible_role, scheduled_start, scheduled_end, status
) values
  ('65000000-0000-4000-8000-000000000501', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '1 hour', now() + interval '2 hours', 'scheduled'),
  ('65000000-0000-4000-8000-000000000502', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '3 hours', now() + interval '4 hours', 'scheduled'),
  ('65000000-0000-4000-8000-000000000503', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '5 hours', now() + interval '6 hours', 'scheduled'),
  ('65000000-0000-4000-8000-000000000505', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '7 hours', now() + interval '8 hours', 'scheduled'),
  ('65000000-0000-4000-8000-000000000506', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000301', 1,
   'Bathing assistance', 'employee', now() + interval '9 hours', now() + interval '10 hours', 'scheduled'),
  ('65000000-0000-4000-8000-000000000504', '65000000-0000-4000-8000-000000000001',
   '65000000-0000-4000-8000-000000000011', '65000000-0000-4000-8000-000000000201',
   '65000000-0000-4000-8000-000000000402', '65000000-0000-4000-8000-000000000301', 1,
   'Chart review', 'employee', now() + interval '1 hour', now() + interval '2 hours', 'scheduled');

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_id, 'role', p_role, 'aal', 'aal2',
      'iat', extract(epoch from now())::bigint
    )::text,
    true
  );
  if p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;

create temporary table t_ids(key text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated, service_role;

-- Registration --------------------------------------------------------------------------------------
select pg_temp.act_as('65000000-0000-4000-8000-000000000101');
insert into t_ids values ('device-a', public.register_offline_service_device('device-a-public-key', repeat('a', 64)));
select ok((select id from t_ids where key = 'device-a') is not null, 'worker A can register an offline service device');

select pg_temp.act_as('65000000-0000-4000-8000-000000000102');
insert into t_ids values ('device-b', public.register_offline_service_device('device-b-public-key', repeat('b', 64)));
select ok((select id from t_ids where key = 'device-b') is not null, 'worker B can register an offline service device');

-- Device-ownership boundary ---------------------------------------------------------------------------
-- Still acting as B: B must not be able to sync using A's device id.
select throws_ok(
  $$select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000501',
    'boundary-key', now(), 'completed_as_planned', '{}'::jsonb
  )$$,
  '42501', null,
  'worker B cannot sync a draft using worker A''s device'
);

-- Applied ---------------------------------------------------------------------------------------------
select pg_temp.act_as('65000000-0000-4000-8000-000000000101');
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000501',
    'sync-key-1', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'applied',
  'A''s first offline draft applies cleanly'
);
select is(
  (select status from public.resident_service_task_instances where id = '65000000-0000-4000-8000-000000000501'),
  'completed',
  'the underlying task reflects the applied response, via record_service_task_response'
);

-- Duplicate: exact idempotency-key replay -------------------------------------------------------------
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000501',
    'sync-key-1', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'duplicate',
  'replaying the same idempotency key returns duplicate rather than re-applying'
);
select is(
  (select count(*)::int from public.offline_service_draft_receipts
   where device_id = (select id from t_ids where key = 'device-a') and idempotency_key = 'sync-key-1'),
  1,
  'the replay does not insert a second receipt row'
);

-- Duplicate: same task, new idempotency key, but this profile already recorded it ----------------------
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000501',
    'sync-key-2', now(), 'completed_with_more_assistance',
    '{"assistance_level":"one_person","persistence":"temporary"}'::jsonb
  )->>'outcome'),
  'duplicate',
  'a second draft for a task this same profile already recorded is also classified duplicate, not conflict'
);

-- Conflict: someone else documented the task while this device was offline ------------------------------
select pg_temp.act_as('65000000-0000-4000-8000-000000000102');
select lives_ok(
  $$select public.record_service_task_response('65000000-0000-4000-8000-000000000502', 'completed_as_planned', '{}'::jsonb, null)$$,
  'worker B documents task2 online directly, ahead of A''s queued offline draft'
);
select pg_temp.act_as('65000000-0000-4000-8000-000000000101');
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000502',
    'sync-key-3', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'conflict',
  'A''s offline draft for a task someone else already documented is a conflict, not applied or duplicate'
);

-- Stale: the task was superseded (plan changed) while this device was offline ----------------------------
reset role;
update public.resident_service_task_instances set status = 'superseded'
where id = '65000000-0000-4000-8000-000000000503';
select pg_temp.act_as('65000000-0000-4000-8000-000000000101');
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000503',
    'sync-key-4', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'stale',
  'a superseded task is reported stale, distinct from a conflict with another person''s documentation'
);

-- Rejected: the plan does not accept this response for this service ---------------------------------------
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000504',
    'sync-key-5', now(), 'resident_refused', '{}'::jsonb
  )->>'outcome'),
  'rejected',
  'a response the service does not accept is rejected rather than silently coerced or applied'
);
select ok(
  (select error_message from public.offline_service_draft_receipts
   where device_id = (select id from t_ids where key = 'device-a') and idempotency_key = 'sync-key-5')
  ilike '%not accepted%',
  'the server message explaining the rejection is preserved on the receipt'
);

-- Wipe required: the device was revoked -------------------------------------------------------------------
select ok(
  public.revoke_offline_service_device((select id from t_ids where key = 'device-a')),
  'worker A can revoke her own device'
);
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-a'), '65000000-0000-4000-8000-000000000505',
    'sync-key-6', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'wipe_required',
  'a revoked device receives wipe_required on its next sync attempt'
);
select is(
  (select status from public.resident_service_task_instances where id = '65000000-0000-4000-8000-000000000505'),
  'scheduled',
  'wipe_required never touches the underlying task -- nothing was attempted against it'
);

-- RLS: a profile sees only its own device's receipts --------------------------------------------------------
select pg_temp.act_as('65000000-0000-4000-8000-000000000102');
select is(
  (select public.sync_offline_service_task_draft(
    (select id from t_ids where key = 'device-b'), '65000000-0000-4000-8000-000000000506',
    'sync-key-b1', now(), 'completed_as_planned', '{}'::jsonb
  )->>'outcome'),
  'applied',
  'worker B can sync her own device independently of worker A''s device history'
);

select pg_temp.act_as('65000000-0000-4000-8000-000000000101');
select is(
  (select count(*)::int from public.offline_service_draft_receipts
   where device_id = (select id from t_ids where key = 'device-b')),
  0,
  'worker A cannot see worker B''s device receipts under RLS'
);

select pg_temp.act_as('65000000-0000-4000-8000-000000000102');
select ok(
  (select count(*)::int from public.offline_service_draft_receipts
   where device_id = (select id from t_ids where key = 'device-b')) >= 1,
  'worker B can see her own device''s receipts'
);

-- Append-only -------------------------------------------------------------------------------------------------
reset role;
select throws_ok(
  $$update public.offline_service_draft_receipts set outcome = 'applied'
    where id = (select id from public.offline_service_draft_receipts limit 1)$$,
  '55000', null,
  'offline service draft receipts cannot be mutated after the fact'
);

select * from finish();
rollback;
