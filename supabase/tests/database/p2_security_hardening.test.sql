begin;
select plan(27);

insert into public.organizations(id, name, slug, subscription_status) values
  ('92000000-0000-4000-8000-000000000001', 'P2 Org A', 'p2-org-a', 'active'),
  ('92000000-0000-4000-8000-000000000002', 'P2 Org B', 'p2-org-b', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('92000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000001', 'P2 Facility A', 'PCH'),
  ('92000000-0000-4000-8000-000000000012', '92000000-0000-4000-8000-000000000002', 'P2 Facility B', 'ALR');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
  email, 'x', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
from (values
  ('92000000-0000-4000-8000-000000000101'::uuid, 'p2-admin@test.local'),
  ('92000000-0000-4000-8000-000000000102'::uuid, 'p2-trainer@test.local'),
  ('92000000-0000-4000-8000-000000000103'::uuid, 'p2-employee@test.local'),
  ('92000000-0000-4000-8000-000000000104'::uuid, 'p2-auditor@test.local'),
  ('92000000-0000-4000-8000-000000000105'::uuid, 'p2-other-tenant@test.local')
) users(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('92000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000001', 'p2-admin@test.local', 'P2', 'Admin', 'org_admin', true),
  ('92000000-0000-4000-8000-000000000102', '92000000-0000-4000-8000-000000000001', 'p2-trainer@test.local', 'P2', 'Trainer', 'trainer', true),
  ('92000000-0000-4000-8000-000000000103', '92000000-0000-4000-8000-000000000001', 'p2-employee@test.local', 'P2', 'Employee', 'employee', true),
  ('92000000-0000-4000-8000-000000000104', '92000000-0000-4000-8000-000000000001', 'p2-auditor@test.local', 'P2', 'Auditor', 'auditor', true),
  ('92000000-0000-4000-8000-000000000105', '92000000-0000-4000-8000-000000000002', 'p2-other-tenant@test.local', 'P2', 'Other Tenant', 'employee', true)
on conflict(id) do update set organization_id=excluded.organization_id, role=excluded.role, is_active=excluded.is_active;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments(profile_id, facility_id) values
  ('92000000-0000-4000-8000-000000000102', '92000000-0000-4000-8000-000000000011');
insert into public.employees(
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title, status
) values (
  '92000000-0000-4000-8000-000000000201', '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000103',
  'P2', 'Employee', 'Aide', 'active'
);
insert into public.training_types(
  id, organization_id, code, name, category, renewal_interval_days, warning_days_default, is_system_default
) values (
  '92000000-0000-4000-8000-000000000301', '92000000-0000-4000-8000-000000000001',
  'P2-TRAIN', 'P2 Training', 'other', 365, 30, false
);
insert into public.training_classes(
  id, organization_id, facility_id, trainer_profile_id, training_type_id,
  class_name, class_date, duration_hours, status
) values
  ('92000000-0000-4000-8000-000000000401', '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000102', '92000000-0000-4000-8000-000000000301', 'Completed P2 class', current_date, 1, 'draft'),
  ('92000000-0000-4000-8000-000000000402', '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000102', '92000000-0000-4000-8000-000000000301', 'Future P2 class', current_date + 1, 1, 'draft');
insert into public.training_class_attendees(id, class_id, employee_id, attended)
values ('92000000-0000-4000-8000-000000000411', '92000000-0000-4000-8000-000000000401', '92000000-0000-4000-8000-000000000201', true);
update public.training_classes set status='completed'
where id='92000000-0000-4000-8000-000000000401';

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_id, 'role', p_role, 'aal', 'aal2', 'iat', extract(epoch from now())::bigint
  )::text, true);
  if p_role='service_role' then set local role service_role; else set local role authenticated; end if;
end $$;

select throws_ok($$
  insert into public.work_items(
    organization_id, facility_id, source_type, source_id, deduplication_key,
    title, priority, due_at
  ) values (
    '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000012',
    'manual', gen_random_uuid(), 'p2-cross-tenant', 'Cross tenant', 'normal', now()+interval '1 day'
  )
$$, '23514', null, 'work items reject a cross-tenant facility');

select pg_temp.act_as('92000000-0000-4000-8000-000000000102');
select throws_ok($$
  insert into public.employee_training_records(
    organization_id, facility_id, employee_id, training_type_id, status, verified_by_profile_id, verified_at
  ) values (
    '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000011',
    '92000000-0000-4000-8000-000000000201', '92000000-0000-4000-8000-000000000301',
    'compliant', '92000000-0000-4000-8000-000000000102', now()
  )
$$, '42501', null, 'direct training evidence writes are revoked');
select lives_ok($$
  select public.save_training_record(null, jsonb_build_object(
    'employee_id','92000000-0000-4000-8000-000000000201',
    'training_type_id','92000000-0000-4000-8000-000000000301',
    'status','compliant','approval_status','approved','completion_date',current_date
  ))
$$, 'authorized controlled training evidence write succeeds');
select is((select verified_by_profile_id from public.employee_training_records
  where employee_id='92000000-0000-4000-8000-000000000201'
    and approval_status='approved' limit 1),
  '92000000-0000-4000-8000-000000000102'::uuid, 'controlled training write stamps the verifier');
select throws_ok($$
  insert into public.practicums(organization_id, facility_id, employee_id, practicum_year, status, verified_at)
  values ('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000011',
    '92000000-0000-4000-8000-000000000201', extract(year from current_date)::int, 'compliant', now())
$$, '42501', null, 'direct practicum verification writes are revoked');
select lives_ok($$
  select public.save_practicum(null, jsonb_build_object(
    'employee_id','92000000-0000-4000-8000-000000000201',
    'practicum_year',extract(year from current_date)::int,'status','compliant'
  ))
$$, 'authorized controlled practicum write succeeds');
select is_empty($$
  update public.employee_training_hour_buckets set completed_hours=999 returning 1
$$, 'computed compliance totals are not directly writable');

select pg_temp.act_as('92000000-0000-4000-8000-000000000101');
select throws_ok($$
  update public.training_classes set notes='silent rewrite'
  where id='92000000-0000-4000-8000-000000000401'
$$, '55000', null, 'completed class metadata is immutable');
select throws_ok($$
  insert into public.training_class_attendees(class_id, employee_id)
  values ('92000000-0000-4000-8000-000000000401','92000000-0000-4000-8000-000000000201')
$$, '55000', null, 'completed class attendees cannot be added directly');
select is_empty($$
  delete from public.training_class_attendees where id='92000000-0000-4000-8000-000000000411'
  returning 1
$$, 'completed class attendees cannot be removed directly');
select lives_ok($$
  select public.correct_completed_training_class(
    '92000000-0000-4000-8000-000000000401', '{"notes":"audited correction"}',
    'Correcting an identified records entry error'
  )
$$, 'AAL2 audited completed-class correction remains available');
select ok(exists(select 1 from public.audit_logs where action='completed_class_correction'),
  'completed-class correction creates audit evidence');

select lives_ok($$ select public.generate_class_checkin_token('92000000-0000-4000-8000-000000000402', true) $$,
  'authorized trainer workflow can mint a printed class token');
reset role;
select ok((select not_before > now() from public.class_checkin_tokens where class_id='92000000-0000-4000-8000-000000000402' order by created_at desc limit 1),
  'printed check-in token is inactive before the class window');
select pg_temp.act_as('92000000-0000-4000-8000-000000000101');
select lives_ok($$ select public.revoke_class_checkin_tokens('92000000-0000-4000-8000-000000000402', 'Printed notice was replaced before class') $$,
  'authorized workflow can revoke outstanding tokens');
reset role;
select ok((select bool_and(revoked_at is not null) from public.class_checkin_tokens where class_id='92000000-0000-4000-8000-000000000402'),
  'revoked tokens carry server-side revocation state');

reset role;
insert into auth.sessions(id, user_id, created_at, updated_at, aal)
values ('92000000-0000-4000-8000-000000000501','92000000-0000-4000-8000-000000000103',now(),now(),'aal1');
select pg_temp.act_as('92000000-0000-4000-8000-000000000103', 'service_role');
select lives_ok($$ select public.admin_update_profile(
  '92000000-0000-4000-8000-000000000103',null,null,null,null,false,null
) $$, 'trusted deactivation RPC succeeds');
reset role;
select is((select count(*)::integer from auth.sessions where user_id='92000000-0000-4000-8000-000000000103'), 0,
  'deactivation atomically revokes refreshable sessions');

select lives_ok($$ select public.reserve_signup_attempt(
  repeat('a',64),repeat('b',64),1,1,100,true,'terms','baa'
) $$, 'first signup quota reservation succeeds');
select throws_ok($$ select public.reserve_signup_attempt(
  repeat('a',64),repeat('b',64),1,1,100,true,'terms','baa'
) $$, 'P0001', null, 'concurrent signup quota capacity cannot be overbooked');
select lives_ok($$ select public.reserve_confidential_intake_attempt(repeat('c',64),null,1) $$,
  'first confidential intake reservation succeeds');
select throws_ok($$ select public.reserve_confidential_intake_attempt(repeat('c',64),null,1) $$,
  'P0001', null, 'confidential intake quota capacity cannot be overbooked');
select is((select public from storage.buckets where id='course-videos'), false,
  'draft and tenant course videos are stored in a private bucket');

insert into storage.objects(bucket_id, name, owner_id)
values ('incident-reports', '92000000-0000-4000-8000-000000000001/incident.pdf',
        '92000000-0000-4000-8000-000000000101');
select pg_temp.act_as('92000000-0000-4000-8000-000000000104');
select is_empty($$
  update storage.objects set metadata='{"tampered":true}'
  where bucket_id='incident-reports' returning 1
$$, 'auditors retain read-only access to incident artifacts');

reset role;
update public.profiles set phone='+12155550199', sms_opt_in=true
where id in ('92000000-0000-4000-8000-000000000101','92000000-0000-4000-8000-000000000105');
insert into public.notification_deliveries(
  id, organization_id, profile_id, channel, recipient, status
) values (
  '92000000-0000-4000-8000-000000000601', '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000101', 'sms', '+12155550199', 'delivered'
);
select pg_temp.act_as('92000000-0000-4000-8000-000000000101', 'service_role');
select lives_ok($$ select public.record_notification_consent_event(
  'sms','opt_out','twilio','p2-stop-event',repeat('d',64),now(),'inbound_message',null,'+12155550199'
) $$, 'signed Twilio consent processing succeeds with tenant evidence');
reset role;
select is((select sms_opt_in from public.profiles where id='92000000-0000-4000-8000-000000000101'), false,
  'Twilio STOP updates the uniquely evidenced tenant profile');
select is((select sms_opt_in from public.profiles where id='92000000-0000-4000-8000-000000000105'), true,
  'same phone number in another tenant remains unchanged');

select * from finish();
rollback;
