begin;
select no_plan();

select ok(not has_function_privilege('authenticated','public.platform_admin_training_invitation_reserve(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb)','EXECUTE'),'native sessions cannot mint delegated invitations');
select ok(not has_function_privilege('anon','public.platform_admin_training_invitation_finalize(uuid,uuid,uuid,uuid,uuid,uuid,text)','EXECUTE'),'anonymous callers cannot finalize invitations');
select ok(has_function_privilege('service_role','public.platform_admin_training_invitation_reserve(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb)','EXECUTE'),'verified adapter can reserve invitations');
select ok(not has_table_privilege('service_role','app_private.training_admin_invitations','UPDATE'),'adapter cannot edit durable invitation intent directly');

insert into public.organizations(id,name,slug,subscription_status) values
 ('9e100000-0000-4000-8000-000000000010','Invitation fixture','hub-training-invite-fixture','active'),
 ('9e100000-0000-4000-8000-000000000011','Other invitation fixture','hub-training-invite-other','active');
insert into public.facilities(id,organization_id,name,facility_type) values
 ('9e100000-0000-4000-8000-000000000020','9e100000-0000-4000-8000-000000000010','Invitation facility','PCH'),
 ('9e100000-0000-4000-8000-000000000021','9e100000-0000-4000-8000-000000000011','Other facility','ALR');
insert into public.employees(id,organization_id,facility_id,first_name,last_name,email,job_title,hire_date,status) values
 ('9e100000-0000-4000-8000-000000000030','9e100000-0000-4000-8000-000000000010','9e100000-0000-4000-8000-000000000020','Synthetic','Student','student@test.invalid','Direct care',current_date,'active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values ('00000000-0000-0000-0000-000000000000','9e100000-0000-4000-8000-000000000001','authenticated','authenticated','hub-invitation-actor@test.invalid','x',now(),'{}','{}',now(),now(),'','','','','','',false,false),
 ('00000000-0000-0000-0000-000000000000','9e100000-0000-4000-8000-000000000050','authenticated','authenticated','administrator@test.invalid','x',null,'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id='9e100000-0000-4000-8000-000000000001';
update public.profiles set role='org_admin',organization_id='9e100000-0000-4000-8000-000000000010',is_active=true where id='9e100000-0000-4000-8000-000000000050';
select set_config('app.privileged_write','',true);

create temporary table invite_fixture(label text primary key,operation jsonb,reservation jsonb);
grant all on invite_fixture to service_role;
create function pg_temp.invite_operation(p_request uuid,p_parameters jsonb default null) returns jsonb language sql as $$
 select jsonb_build_object('domain','training.v1','operation','apply','action','invitations.create','requestId',p_request,
  'organizationId','9e100000-0000-4000-8000-000000000010','reason','Set up a synthetic facility administrator',
  'parameters',coalesce(p_parameters,'{"role":"org_admin","firstName":"Synthetic","lastName":"Administrator","email":"administrator@test.invalid","facilityId":null,"employeeId":null}'::jsonb));
$$;
create function pg_temp.reserve(p_operation jsonb) returns jsonb language sql as $$
 select public.platform_admin_training_invitation_reserve('9e100000-0000-4000-8000-000000000001','9e100000-0000-4000-8000-000000000002',
  '9e100000-0000-4000-8000-000000000003',now()-interval '1 hour',now()+interval '7 hours','app_sms',p_operation);
$$;
create function pg_temp.authorize(p_operation jsonb,p_token uuid,p_session uuid default '9e100000-0000-4000-8000-000000000003') returns boolean language sql as $$
 select public.platform_admin_training_invitation_authorize('9e100000-0000-4000-8000-000000000001','9e100000-0000-4000-8000-000000000002',
  p_session,now()-interval '1 hour',now()+interval '7 hours','app_sms',p_operation,p_token);
$$;
create function pg_temp.finalize(p_request uuid,p_token uuid,p_invitation uuid default null,p_status text default 'unknown') returns jsonb language sql as $$
 select public.platform_admin_training_invitation_finalize('9e100000-0000-4000-8000-000000000001','9e100000-0000-4000-8000-000000000002',
  '9e100000-0000-4000-8000-000000000003',p_request,p_token,p_invitation,p_status);
$$;
create function pg_temp.record(p_request uuid,p_token uuid) returns jsonb language sql as $$
 select public.platform_admin_training_invitation_record('9e100000-0000-4000-8000-000000000001','9e100000-0000-4000-8000-000000000002',
  '9e100000-0000-4000-8000-000000000003',p_request,p_token,'9e100000-0000-4000-8000-000000000050','https://cmcarebase.com/reset-password');
$$;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('app.privileged_write','on',true);
update public.profiles set organization_id='9e100000-0000-4000-8000-000000000011' where id='9e100000-0000-4000-8000-000000000050';
select set_config('app.privileged_write','',true);
set local role service_role;
select throws_ok($$select pg_temp.reserve(pg_temp.invite_operation('9e100000-0000-4000-8000-000000000090'))$$,
 '40001','Existing identity is outside invitation scope','unconfirmed identity in another organization cannot be reassigned by an invite');
reset role;
select is((select organization_id from public.profiles where id='9e100000-0000-4000-8000-000000000050'),'9e100000-0000-4000-8000-000000000011'::uuid,'rejected invite preserves the previous organization');
select set_config('app.privileged_write','on',true);
update public.profiles set organization_id='9e100000-0000-4000-8000-000000000010',role='platform_admin' where id='9e100000-0000-4000-8000-000000000050';
select set_config('app.privileged_write','',true);
set local role service_role;
select throws_ok($$select pg_temp.reserve(pg_temp.invite_operation('9e100000-0000-4000-8000-000000000091'))$$,
 '40001','Existing identity is outside invitation scope','training invite cannot repurpose an unconfirmed platform administrator');
reset role;
select set_config('app.privileged_write','on',true);
update public.profiles set role='employee' where id='9e100000-0000-4000-8000-000000000050';
select set_config('app.privileged_write','',true);
set local role service_role;
select throws_ok($$select pg_temp.reserve(pg_temp.invite_operation('9e100000-0000-4000-8000-000000000092'))$$,
 '40001','Existing identity is outside invitation scope','training invite cannot silently change an existing account role');
reset role;
select set_config('app.privileged_write','on',true);
update public.profiles set role='org_admin' where id='9e100000-0000-4000-8000-000000000050';
select set_config('app.privileged_write','',true);
set local role service_role;
insert into invite_fixture(label,operation) values('admin',pg_temp.invite_operation('9e100000-0000-4000-8000-000000000100'));
update invite_fixture set reservation=pg_temp.reserve(operation) where label='admin';
select is((select reservation->>'execute' from invite_fixture where label='admin'),'true','first request alone receives dispatch authority');
select is((select reservation->'receipt'->'result'->>'deliveryStatus' from invite_fixture where label='admin'),'unknown','uncertain outcome is persisted before any external email');
select is((pg_temp.reserve((select operation from invite_fixture where label='admin'))->>'execute'),'false','concurrent or interrupted retry cannot send again');
select is(pg_temp.reserve((select operation from invite_fixture where label='admin'))->'dispatchToken','null'::jsonb,'replay never releases the dispatch token');
select throws_ok($$select pg_temp.reserve(jsonb_set((select operation from invite_fixture where label='admin'),'{parameters,email}','"changed@test.invalid"'))$$,
 '40001','Request ID already used','request id cannot change recipient');
select is((select pg_temp.authorize(operation,(reservation->>'dispatchToken')::uuid) from invite_fixture where label='admin'),true,'original reservation permits the exact verified request');
select throws_ok($$select pg_temp.authorize(operation,(reservation->>'dispatchToken')::uuid,'9e100000-0000-4000-8000-000000000099') from invite_fixture where label='admin'$$,
 '42501','Invitation reservation unavailable','dispatch is bound to the originating session');
select throws_ok($$select pg_temp.finalize('9e100000-0000-4000-8000-000000000100','9e100000-0000-4000-8000-000000000099')$$,
 '42501','Invitation reservation unavailable','finalization needs its private reservation token');
select throws_ok($$select pg_temp.finalize('9e100000-0000-4000-8000-000000000100',(select (reservation->>'dispatchToken')::uuid from invite_fixture where label='admin'),'9e100000-0000-4000-8000-000000000099','sent')$$,
 '42501','Invitation receipt does not match reservation','cannot claim sent without the matching lifecycle receipt');

select is((pg_temp.record('9e100000-0000-4000-8000-000000000100',
 (select (reservation->>'dispatchToken')::uuid from invite_fixture where label='admin'))->'result'->>'deliveryStatus'),'sent','lifecycle and exact command outcome commit together');
select is((pg_temp.record('9e100000-0000-4000-8000-000000000100',
 (select (reservation->>'dispatchToken')::uuid from invite_fixture where label='admin'))->>'replayed'),'true','atomic lifecycle retry returns the existing result');
select is((select send_count from public.user_invitation_lifecycle where invited_user_id='9e100000-0000-4000-8000-000000000050'),1,'atomic replay does not record a second send');
select is(pg_temp.reserve((select operation from invite_fixture where label='admin'))->'receipt'->'result'->>'deliveryStatus','sent','retry observes the saved sent result');
select throws_ok($$select pg_temp.authorize(operation,(reservation->>'dispatchToken')::uuid) from invite_fixture where label='admin'$$,
 '42501','Invitation reservation unavailable','completed receipt cannot dispatch again');

select throws_ok($$select pg_temp.reserve(pg_temp.invite_operation('9e100000-0000-4000-8000-000000000101','{"role":"platform_admin","firstName":"Synthetic","lastName":"Administrator","email":"administrator@test.invalid","facilityId":null,"employeeId":null}'))$$,
 '22023','Invalid training invitation','training invitations cannot grant platform access');
select throws_ok($$select pg_temp.reserve(pg_temp.invite_operation('9e100000-0000-4000-8000-000000000102','{"role":"employee","firstName":"Synthetic","lastName":"Student","email":"student@test.invalid","facilityId":"9e100000-0000-4000-8000-000000000021","employeeId":"9e100000-0000-4000-8000-000000000030"}'))$$,
 '42501','Student unavailable for invitation','employee must belong to the exact selected facility');
insert into invite_fixture(label,operation) values('student',pg_temp.invite_operation('9e100000-0000-4000-8000-000000000103',
 '{"role":"employee","firstName":"Synthetic","lastName":"Student","email":"student@test.invalid","facilityId":"9e100000-0000-4000-8000-000000000020","employeeId":"9e100000-0000-4000-8000-000000000030"}'));
update invite_fixture set reservation=pg_temp.reserve(operation) where label='student';
select is((select pg_temp.authorize(operation,(reservation->>'dispatchToken')::uuid) from invite_fixture where label='student'),true,'linked student scope is authorized before sending');
insert into invite_fixture(label,operation) values('failed',pg_temp.invite_operation('9e100000-0000-4000-8000-000000000104'));
update invite_fixture set reservation=pg_temp.reserve(operation) where label='failed';
select is((pg_temp.finalize('9e100000-0000-4000-8000-000000000104',
 (select (reservation->>'dispatchToken')::uuid from invite_fixture where label='failed'),null,'failed')->'result'->>'deliveryStatus'),'failed','definitive no-send outcome is recorded separately from uncertain delivery');
select is(pg_temp.reserve((select operation from invite_fixture where label='failed'))->'receipt'->'result'->>'deliveryStatus','failed','retry observes confirmed failure without dispatching again');
select is(pg_temp.reserve((select operation from invite_fixture where label='failed'))->>'execute','false','confirmed failure never automatically resends');
reset role;
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id='9e100000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);
set local role service_role;
select throws_ok($$select pg_temp.authorize(operation,(reservation->>'dispatchToken')::uuid) from invite_fixture where label='student'$$,
 '42501','Delegation forbidden','deactivated operator cannot start external delivery');
select is((pg_temp.finalize('9e100000-0000-4000-8000-000000000103',
 (select (reservation->>'dispatchToken')::uuid from invite_fixture where label='student'))->'result'->>'deliveryStatus'),'unknown','deactivation does not erase the result of an already attempted effect');
reset role;
select throws_ok($$update app_private.training_admin_invitations set operation='{}'$$,'42501','Invitation receipts retain their original intent and outcome','receipt intent cannot be rewritten');
select throws_ok($$delete from app_private.training_admin_invitations$$,'42501','Invitation receipts retain their original intent and outcome','receipt cannot be deleted');
select is((select count(*) from app_private.training_admin_invitations),3::bigint,'retries and rejected scopes create no additional reservations');
select is((select count(*) from public.audit_logs where action='hub.training.invitation_reserved'),3::bigint,'reservation audit records each intent once');
select is((select count(*) from public.audit_logs where action='hub.training.invitation_result'),3::bigint,'result audit records each finalized outcome once');

select * from finish();
rollback;
