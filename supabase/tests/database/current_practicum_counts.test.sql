begin;
select plan(4);

-- A completed practicum is stored beside the rulepack missing shell for the same
-- employee and Pennsylvania year. The trainer dashboard must count the person once.

insert into public.organizations(id,name,slug,subscription_status) values
  ('19000000-0000-4000-8000-000000000001','Practicum Count Org','practicum-count-org','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('19000000-0000-4000-8000-000000000011','19000000-0000-4000-8000-000000000001','Practicum Count Home','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
values (
  '00000000-0000-0000-0000-000000000000',
  '19000000-0000-4000-8000-000000000021',
  'authenticated','authenticated','practicum-count-admin@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false
);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('19000000-0000-4000-8000-000000000021','19000000-0000-4000-8000-000000000001','practicum-count-admin@test.local','Count','Admin','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);

insert into public.employees(id,organization_id,facility_id,first_name,last_name,job_title,status,trainer_status,administers_medications) values
  ('19000000-0000-4000-8000-000000000031','19000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000011','Med','Aide','Aide','active',false,true);

select set_config('app.privileged_write','on',true);
insert into public.practicums(
  organization_id, facility_id, employee_id, practicum_year, status, completion_date, due_date
) values (
  '19000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000011',
  '19000000-0000-4000-8000-000000000031',
  extract(year from public.pa_today())::int,
  'compliant',
  public.pa_today(),
  public.pa_today() + 365
);
select set_config('app.privileged_write','off',true);

create or replace function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end
$$;

select pg_temp.act_as('19000000-0000-4000-8000-000000000021');

select is(
  (select count(*) from public.practicums
    where employee_id = '19000000-0000-4000-8000-000000000031'
      and practicum_year = extract(year from public.pa_today())::int),
  2::bigint,
  'the completed row sits beside the missing shell'
);

select is(
  (public.get_trainer_dashboard_summary()->'staff'->>'practicumsCompliant')::int,
  1,
  'the completed practicum counts once'
);

select is(
  (public.get_trainer_dashboard_summary()->'staff'->>'practicumsPending')::int,
  0,
  'the leftover missing shell is not a second pending practicum'
);

select is(
  jsonb_array_length(public.get_trainer_dashboard_summary()->'facilitiesNeedingAttention'),
  0,
  'the facility is not flagged because of the leftover shell'
);

select * from finish();
rollback;
