begin;
select no_plan();
select ok(not has_function_privilege('authenticated','public.platform_admin_training_invitation_provision(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,uuid)','EXECUTE'),'native authenticated sessions cannot call delegated profile binding');
select ok(not has_function_privilege('anon','public.platform_admin_training_invitation_provision(uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,uuid,uuid)','EXECUTE'),'anonymous sessions cannot call delegated profile binding');
insert into public.organizations(id,name,slug,subscription_status) values
 ('9e200000-0000-4000-8000-000000000010','Binding North','binding-north','active'),
 ('9e200000-0000-4000-8000-000000000011','Binding South','binding-south','active');
insert into public.facilities(id,organization_id,name,facility_type) values
 ('9e200000-0000-4000-8000-000000000020','9e200000-0000-4000-8000-000000000010','Binding North Facility','PCH');
insert into public.employees(id,organization_id,facility_id,first_name,last_name,email,job_title,hire_date,status) values
 ('9e200000-0000-4000-8000-000000000030','9e200000-0000-4000-8000-000000000010','9e200000-0000-4000-8000-000000000020','Shared','Identity','binding-shared@test.invalid','Direct care',current_date,'active'),
 ('9e200000-0000-4000-8000-000000000031','9e200000-0000-4000-8000-000000000010','9e200000-0000-4000-8000-000000000020','New','Student','binding-student@test.invalid','Direct care',current_date,'active');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values ('00000000-0000-0000-0000-000000000000','9e200000-0000-4000-8000-000000000001','authenticated','authenticated','binding-owner@test.invalid','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
update public.profiles set role='platform_admin',is_active=true where id='9e200000-0000-4000-8000-000000000001';
select set_config('app.privileged_write','',true);

create temporary table binding_fixture(label text primary key,request_id uuid,operation jsonb,reservation jsonb);
grant all on binding_fixture to service_role;
create function pg_temp.binding_operation(p_request uuid,p_org uuid,p_email text,p_employee uuid default null) returns jsonb language sql as $$
 select jsonb_build_object('domain','training.v1','operation','apply','action','invitations.create','requestId',p_request,
  'organizationId',p_org,'reason','Verify invitation identity binding',
  'parameters',jsonb_build_object('role',case when p_employee is null then 'org_admin' else 'employee' end,'firstName','Synthetic','lastName','Invitee',
   'email',p_email,'facilityId',case when p_employee is null then null else '9e200000-0000-4000-8000-000000000020'::uuid end,'employeeId',p_employee));
$$;
create function pg_temp.binding_reserve(p_operation jsonb) returns jsonb language sql as $$
 select public.platform_admin_training_invitation_reserve('9e200000-0000-4000-8000-000000000001','9e200000-0000-4000-8000-000000000002',
  '9e200000-0000-4000-8000-000000000003',now()-interval '1 hour',now()+interval '7 hours','app_sms',p_operation);
$$;
create function pg_temp.binding_provision(p_label text,p_identity uuid,p_token uuid default null) returns jsonb language sql as $$
 select public.platform_admin_training_invitation_provision('9e200000-0000-4000-8000-000000000001','9e200000-0000-4000-8000-000000000002',
  '9e200000-0000-4000-8000-000000000003',now()-interval '1 hour',now()+interval '7 hours','app_sms',
  f.request_id,coalesce(p_token,(f.reservation->>'dispatchToken')::uuid),p_identity) from binding_fixture f where label=p_label;
$$;
insert into binding_fixture(label,request_id,operation) select label,request_id,
 pg_temp.binding_operation(request_id,org,email,employee) from (values
 ('north','9e200000-0000-4000-8000-000000000100'::uuid,'9e200000-0000-4000-8000-000000000010'::uuid,'binding-shared@test.invalid',null::uuid),
 ('south','9e200000-0000-4000-8000-000000000101'::uuid,'9e200000-0000-4000-8000-000000000011'::uuid,'binding-shared@test.invalid',null::uuid),
 ('role','9e200000-0000-4000-8000-000000000102'::uuid,'9e200000-0000-4000-8000-000000000010'::uuid,'binding-shared@test.invalid','9e200000-0000-4000-8000-000000000030'::uuid),
 ('student','9e200000-0000-4000-8000-000000000103'::uuid,'9e200000-0000-4000-8000-000000000010'::uuid,'binding-student@test.invalid','9e200000-0000-4000-8000-000000000031'::uuid),
 ('old','9e200000-0000-4000-8000-000000000104'::uuid,'9e200000-0000-4000-8000-000000000010'::uuid,'binding-old@test.invalid',null::uuid)
 ) f(label,request_id,org,email,employee);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update binding_fixture set reservation=pg_temp.binding_reserve(operation);
select is((select count(*)::integer from binding_fixture where reservation->>'execute'='true'),5,
 'all competing requests pass preflight before GoTrue creates the shared identity');
reset role;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',null,'{}','{}',created_at,now(),'','','','','','',false,false
from (values
 ('9e200000-0000-4000-8000-000000000050'::uuid,'binding-shared@test.invalid',clock_timestamp()),
 ('9e200000-0000-4000-8000-000000000051'::uuid,'binding-student@test.invalid',clock_timestamp()),
 ('9e200000-0000-4000-8000-000000000052'::uuid,'binding-old@test.invalid',now()-interval '1 day')
 ) identities(id,email,created_at);
set local role service_role;
select is(pg_temp.binding_provision('north','9e200000-0000-4000-8000-000000000050')->>'organization_id','9e200000-0000-4000-8000-000000000010',
 'the first locked provision claims the new identity for its original organization');
select throws_ok($$select pg_temp.binding_provision('south','9e200000-0000-4000-8000-000000000050')$$,
 '40001','Invited identity is outside invitation scope','a competing organization cannot move the returned Auth identity');
select throws_ok($$select pg_temp.binding_provision('role','9e200000-0000-4000-8000-000000000050')$$,
 '40001','Invited identity is outside invitation scope','a competing invitation cannot change the winning identity role');
select throws_ok($$select pg_temp.binding_provision('old','9e200000-0000-4000-8000-000000000052')$$,
 '40001','Invited identity is outside invitation scope','a pre-existing unscoped identity is not mistaken for a new Auth insert');
select throws_ok($$select pg_temp.binding_provision('student','9e200000-0000-4000-8000-000000000051','9e200000-0000-4000-8000-000000000099')$$,
 '42501','Invitation reservation unavailable','the profile writer needs the private reservation token');
select throws_ok($$select pg_temp.binding_provision('student','9e200000-0000-4000-8000-000000000050')$$,
 '40001','Invited identity is outside invitation scope','the Auth identity email must equal the stored recipient');
select is(pg_temp.binding_provision('student','9e200000-0000-4000-8000-000000000051')->>'role','employee',
 'a valid student invite uses the existing employee provisioning path');
select is(pg_temp.binding_provision('student','9e200000-0000-4000-8000-000000000051')->>'id','9e200000-0000-4000-8000-000000000051',
 'same-reservation provisioning recovery does not detach or recreate the employee link');
reset role;
select is((select organization_id from public.profiles where id='9e200000-0000-4000-8000-000000000050'),'9e200000-0000-4000-8000-000000000010'::uuid,
 'the losing request preserves the winning organization');
select is((select role from public.profiles where id='9e200000-0000-4000-8000-000000000050'),'org_admin','the losing request preserves the winning role');
select is((select profile_id from public.employees where id='9e200000-0000-4000-8000-000000000030'),null::uuid,'a losing role request does not claim the employee');
select is((select profile_id from public.employees where id='9e200000-0000-4000-8000-000000000031'),'9e200000-0000-4000-8000-000000000051'::uuid,'valid provisioning links exactly the intended student');
select is((select count(*)::integer from auth.users where id in ('9e200000-0000-4000-8000-000000000050','9e200000-0000-4000-8000-000000000051')),2,'competing invitation refusals do not delete either Auth identity');
select * from finish();
rollback;
