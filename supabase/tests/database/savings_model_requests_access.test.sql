begin;
select plan(9);

-- PT-066: access matrix for savings_model_requests (20260723010000). Rows are
-- written only by the email-savings-model Edge Function's service-role client;
-- anon must have no path at all, and authenticated customers must see nothing --
-- only platform admins triage the warm-lead list.

select has_table('public','savings_model_requests','savings model intake table exists');
select ok(not has_table_privilege('anon','public.savings_model_requests','SELECT'),
  'anonymous role has no select grant on savings_model_requests');
select ok(not has_table_privilege('anon','public.savings_model_requests','INSERT'),
  'anonymous role cannot insert savings model requests');
select ok(not has_table_privilege('authenticated','public.savings_model_requests','INSERT'),
  'authenticated role cannot insert savings model requests (service role only)');
select ok(not has_table_privilege('authenticated','public.savings_model_requests','UPDATE'),
  'authenticated role cannot update the append-only intake');

insert into public.organizations(id,name,slug,subscription_status) values
  ('7a000000-0000-4000-8000-000000000001','Savings Org','savings-org','active');
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  email_change_token_current,reauthentication_token,is_sso_user,is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000','7a000000-0000-4000-8000-000000000101','authenticated','authenticated','savings-admin@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false),
  ('00000000-0000-0000-0000-000000000000','7a000000-0000-4000-8000-000000000102','authenticated','authenticated','savings-platform@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('7a000000-0000-4000-8000-000000000101','7a000000-0000-4000-8000-000000000001','savings-admin@test.local','Savings','Admin','org_admin',true),
  ('7a000000-0000-4000-8000-000000000102',null,'savings-platform@test.local','Savings','Platform','platform_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);

insert into public.savings_model_requests(email,weekly_admin_hours,loaded_hourly_rate,facility_count) values
  ('pgtap-savings-lead@test.local',10,35,2);

create or replace function pg_temp.act_as(p_id uuid,p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_id,'role',p_role,'aal','aal2','iat',extract(epoch from now())::bigint
  )::text,true);
  if p_role='anon' then set local role anon;
  elsif p_role='service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;

select pg_temp.act_as('00000000-0000-0000-0000-000000000000','anon');
select throws_ok($$select count(*) from public.savings_model_requests$$,
  '42501',null,'anon cannot read savings model requests');

select pg_temp.act_as('7a000000-0000-4000-8000-000000000101');
select is((select count(*)::integer from public.savings_model_requests),
  0,'a customer org admin sees no savings model requests');

select pg_temp.act_as('7a000000-0000-4000-8000-000000000102');
select is((select count(*)::integer from public.savings_model_requests where email='pgtap-savings-lead@test.local'),
  1,'a platform admin can triage the intake');
select throws_ok($$insert into public.savings_model_requests(email) values ('pgtap-client-write@test.local')$$,
  '42501',null,'even a platform admin cannot insert from the client role');

select * from finish();
rollback;
