begin;
select plan(32);

select results_eq(
  $$ select count(*)::integer from pg_policies
     where schemaname = 'public'
       and tablename = any(array[
         'certificates','competency_records','competency_record_items','course_assignments',
         'course_progress','employees','practicums','quiz_attempts','quiz_attempt_answers',
         'training_documents','employee_training_records','employee_training_hour_buckets'
       ])
       and cmd = 'SELECT' and qual like '%can_read_employee_peer_data%' $$,
  $$ values (12) $$,
  'all employee peer-data policies use the role-aware reader boundary'
);
select ok(
  (select qual like '%can_read_employee_peer_data%' from pg_policies
   where schemaname = 'storage' and policyname = 'certificates read'),
  'certificate objects use the same role-aware reader boundary'
);
select results_eq(
  $$ select count(*)::integer from pg_policies
     where schemaname = 'storage' and policyname like 'external-uploads %'
       and cmd in ('SELECT','UPDATE','DELETE') and (qual || coalesce(with_check, '')) like '%owner_id%' $$,
  $$ values (0) $$,
  'external-upload ownership metadata is no longer an authorization bypass'
);
select results_eq(
  $$ select count(*)::integer from pg_policies
     where schemaname = 'storage' and policyname like 'external-uploads %'
       and cmd in ('SELECT','UPDATE','DELETE') and qual like '%training_documents%' $$,
  $$ values (3) $$,
  'external-upload reads and mutations are bound to authoritative document metadata'
);
select ok(
  (select qual like '%status = ''pending''%' from pg_policies
   where schemaname = 'public' and policyname = 'policy_attestations_delete'),
  'only pending policy attestations can be deleted'
);
select ok(
  (select qual like '%pa.status <> ''pending''%' from pg_policies
   where schemaname = 'public' and policyname = 'policy_attestation_campaigns_delete'),
  'campaign deletion refuses to cascade through completed attestations'
);

insert into public.organizations(id, name, slug, subscription_status) values
  ('71000000-0000-4000-8000-000000000001','Security Boundary A','security-boundary-a','active'),
  ('71000000-0000-4000-8000-000000000002','Security Boundary B','security-boundary-b','active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('71000000-0000-4000-8000-000000000011','71000000-0000-4000-8000-000000000001','A Facility','PCH'),
  ('71000000-0000-4000-8000-000000000012','71000000-0000-4000-8000-000000000002','B Facility','PCH');
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,
  recovery_token,email_change_token_new,email_change,email_change_token_current,
  reauthentication_token,is_sso_user,is_anonymous
)
select '00000000-0000-0000-0000-000000000000',v.id,'authenticated','authenticated',v.email,
  'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values
  ('71000000-0000-4000-8000-000000000021'::uuid,'security-manager@test.local'),
  ('71000000-0000-4000-8000-000000000022'::uuid,'security-demoted@test.local'),
  ('71000000-0000-4000-8000-000000000023'::uuid,'security-worker-a@test.local'),
  ('71000000-0000-4000-8000-000000000024'::uuid,'security-worker-b@test.local')
) v(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('71000000-0000-4000-8000-000000000021','71000000-0000-4000-8000-000000000001','security-manager@test.local','Security','Manager','facility_manager',true),
  ('71000000-0000-4000-8000-000000000022','71000000-0000-4000-8000-000000000001','security-demoted@test.local','Security','Demoted','facility_manager',true),
  ('71000000-0000-4000-8000-000000000023','71000000-0000-4000-8000-000000000001','security-worker-a@test.local','Worker','A','employee',true),
  ('71000000-0000-4000-8000-000000000024','71000000-0000-4000-8000-000000000002','security-worker-b@test.local','Worker','B','employee',true)
on conflict(id) do update set
  organization_id=excluded.organization_id,email=excluded.email,first_name=excluded.first_name,
  last_name=excluded.last_name,role=excluded.role,is_active=excluded.is_active;
select set_config('app.privileged_write','off',true);
insert into public.facility_assignments(profile_id, facility_id) values
  ('71000000-0000-4000-8000-000000000021','71000000-0000-4000-8000-000000000011'),
  ('71000000-0000-4000-8000-000000000022','71000000-0000-4000-8000-000000000011');
insert into public.employees(
  id,organization_id,facility_id,profile_id,first_name,last_name,email,job_title,status
) values
  ('71000000-0000-4000-8000-000000000031','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000011','71000000-0000-4000-8000-000000000023','Worker','A','security-worker-a@test.local','Aide','active'),
  ('71000000-0000-4000-8000-000000000032','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000012','71000000-0000-4000-8000-000000000024','Worker','B','security-worker-b@test.local','Aide','active');

create or replace function pg_temp.act_as(p_id uuid, p_session text default 'session-1')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',p_id,'role','authenticated','aal','aal2','session_id',p_session,
    'iat',extract(epoch from now())::bigint
  )::text, true);
  set local role authenticated;
end $$;

select lives_ok(
  $$ select public.admin_update_profile('71000000-0000-4000-8000-000000000022', p_role => 'employee') $$,
  'profile demotion completes'
);
select results_eq(
  $$ select count(*)::integer from public.facility_assignments
     where profile_id = '71000000-0000-4000-8000-000000000022' $$,
  $$ values (0) $$,
  'profile demotion removes stale facility assignments'
);
select results_eq(
  $$ select has_table_privilege('authenticated','public.employee_credentials','INSERT,UPDATE') $$,
  $$ values (false) $$,
  'authenticated clients cannot write credential compliance state directly'
);

select pg_temp.act_as('71000000-0000-4000-8000-000000000021');
select lives_ok($$
  create temporary table saved_security_credential as
  select (public.save_employee_credential(null, jsonb_build_object(
    'employee_id','71000000-0000-4000-8000-000000000031',
    'credential_type','act34_criminal_history',
    'credential_label','Criminal history clearance',
    'status','compliant',
    'verified_by_profile_id','71000000-0000-4000-8000-000000000024'
  ))).*;
$$, 'credential command accepts an authorized manager');
select results_eq(
  $$ select status, verified_by_profile_id, last_verified_date is not null, verified_at is not null
     from saved_security_credential $$,
  $$ values ('compliant'::text,'71000000-0000-4000-8000-000000000021'::uuid,true,true) $$,
  'credential verification identity and time are server stamped'
);
select lives_ok($$
  insert into public.employee_credential_documents(
    organization_id,facility_id,employee_id,credential_id,storage_path,file_name,file_type
  ) select
    '71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000012',
    '71000000-0000-4000-8000-000000000032',id,
    '71000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000011/clearance.pdf',
    'clearance.pdf','application/pdf'
  from saved_security_credential;
$$, 'canonical credential document metadata is accepted');
select throws_ok($$
  insert into public.employee_credential_documents(
    organization_id,facility_id,employee_id,credential_id,storage_path,file_name,file_type
  ) select
    organization_id,facility_id,employee_id,id,
    '71000000-0000-4000-8000-000000000002/71000000-0000-4000-8000-000000000012/foreign.pdf',
    'foreign.pdf','application/pdf'
  from saved_security_credential;
$$, '23514', null, 'credential metadata cannot alias a foreign tenant object');

select lives_ok($$
  insert into public.employee_background_check_profiles(
    organization_id,facility_id,employee_id
  ) values (
    '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000011',
    '71000000-0000-4000-8000-000000000031'
  );
$$, 'background-check profile is created for its authoritative employee');
select throws_ok($$
  update public.employee_background_check_profiles
  set employee_id = '71000000-0000-4000-8000-000000000032'
  where employee_id = '71000000-0000-4000-8000-000000000031';
$$, '23514', null, 'background-check profile cannot be repointed');

select lives_ok($$
  create temporary table inserted_security_incident(id uuid);
  with inserted as (
    insert into public.incidents(
      organization_id,facility_id,incident_type,occurred_at,narrative,severity,status,
      closed_at,closed_by_profile_id,final_report_submitted_at
    ) values (
      '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000011',
      'other',now(),'A sufficiently detailed incident narrative','moderate','closed',
      now(),'71000000-0000-4000-8000-000000000024',now()
    ) returning id
  ) insert into inserted_security_incident select id from inserted;
$$, 'incident creation accepts ordinary report fields');
select results_eq(
  $$ select i.status,i.reported_by_profile_id,i.closed_at is null,i.closed_by_profile_id is null,
            i.final_report_submitted_at is null
     from public.incidents i join inserted_security_incident x on x.id=i.id $$,
  $$ values ('reported'::text,'71000000-0000-4000-8000-000000000021'::uuid,true,true,true) $$,
  'incident creation normalizes workflow state and actor attribution'
);
select throws_ok($$
  insert into public.incident_staff_involved(
    organization_id,facility_id,incident_id,employee_id,involvement_type
  ) select
    '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000011',
    id,'71000000-0000-4000-8000-000000000032','witness'
  from inserted_security_incident;
$$, '23514', null, 'incident staff cannot link to a foreign tenant employee');
select lives_ok($$
  insert into public.incident_notifications(
    id,organization_id,facility_id,incident_id,notification_type,due_at,status,
    completed_at,completed_by_profile_id
  ) select
    '71000000-0000-4000-8000-000000000041','71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000011',id,'other',now() + interval '1 day',
    'completed',now(),'71000000-0000-4000-8000-000000000024'
  from inserted_security_incident;
$$, 'new incident notification is accepted');
select results_eq(
  $$ select status,completed_at is null,completed_by_profile_id is null
     from public.incident_notifications where id='71000000-0000-4000-8000-000000000041' $$,
  $$ values ('pending'::text,true,true) $$,
  'notification creation cannot forge completion evidence'
);
select lives_ok($$
  update public.incident_notifications set status='completed'
  where id='71000000-0000-4000-8000-000000000041';
$$, 'authorized notification completion succeeds');
select results_eq(
  $$ select status,completed_by_profile_id,completed_at is not null
     from public.incident_notifications where id='71000000-0000-4000-8000-000000000041' $$,
  $$ values ('completed'::text,'71000000-0000-4000-8000-000000000021'::uuid,true) $$,
  'notification completion evidence is server stamped'
);
select throws_ok($$
  update public.incident_notifications
  set completed_by_profile_id='71000000-0000-4000-8000-000000000024'
  where id='71000000-0000-4000-8000-000000000041';
$$, '23514', null, 'completed notification evidence is immutable');

select lives_ok($$
  create temporary table recorded_security_lock as
  select public.record_idle_session_lock('/app/dashboard','idle_timeout') as id;
$$, 'the current Auth session can be locked');
select results_eq(
  $$ select public.current_role() $$,
  $$ values (null::text) $$,
  'a locked Auth session loses its authorization role at the database boundary'
);
select throws_ok(
  $$ select public.record_idle_session_unlock((select id from recorded_security_lock)) $$,
  '42501', null, 'the locked bearer session cannot unlock itself'
);
select pg_temp.act_as('71000000-0000-4000-8000-000000000021','session-2');
select lives_ok(
  $$ select public.record_idle_session_unlock((select id from recorded_security_lock)) $$,
  'a fresh password Auth session can unlock the prior session lock'
);
select results_eq(
  $$ select public.current_role() $$,
  $$ values ('facility_manager'::text) $$,
  'authorization resumes after a fresh-session unlock'
);

reset role;
select ok(
  pg_get_functiondef('public.checkin_via_token(text)'::regprocedure) like '%current_profile_active%'
  and pg_get_functiondef('public.checkin_via_token(text)'::regprocedure) like '%status = ''active''%',
  'QR check-in rechecks active profile and employee lifecycle state'
);
select ok(
  pg_get_functiondef('public.sign_move_in_guest_task(text,uuid,text,text,text)'::regprocedure)
    like '%signature_evidence is not null%'
  and pg_get_functiondef('public.sign_move_in_guest_task(text,uuid,text,text,text)'::regprocedure)
    like '%state not in (''open'', ''in_progress'')%',
  'move-in guest signatures are append-only and state-gated'
);
select results_eq(
  $$ select has_table_privilege('authenticated','public.impersonation_sessions','SELECT,INSERT,UPDATE,DELETE') $$,
  $$ values (false) $$,
  'impersonation lifecycle records are service-role only'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='employee_credential_documents'
      and indexname='employee_credential_documents_storage_object_key'
      and indexdef like 'CREATE UNIQUE INDEX%'
  ),
  'credential document metadata has one authoritative row per storage object'
);

select * from finish();
rollback;
