begin;
select plan(12);

-- PT-066: post_resident_monthly_charges must be idempotent per service period.
-- A double-click/retry of an identical posting run is rejected (23505); a
-- period whose charge was corrected with a linked adjustment may deliberately
-- be reposted (the supported correction flow). Mirrors
-- resident_financial_operations.test.sql's seeding/act_as pattern.

select has_function('public','post_resident_monthly_charges','atomic monthly charge posting RPC exists');
select ok(not has_function_privilege('anon','public.post_resident_monthly_charges(uuid,date,date,text,jsonb)','EXECUTE'),
  'anonymous role cannot execute monthly charge posting');

insert into public.organizations(id,name,slug,subscription_status) values
  ('77000000-0000-4000-8000-000000000001','Charge Org','charge-org','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('77000000-0000-4000-8000-000000000011','77000000-0000-4000-8000-000000000001','Charge Facility','PCH');
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  email_change_token_current,reauthentication_token,is_sso_user,is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000','77000000-0000-4000-8000-000000000101','authenticated','authenticated','charge-admin@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('77000000-0000-4000-8000-000000000101','77000000-0000-4000-8000-000000000001','charge-admin@test.local','Charge','Admin','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status) values
  ('77000000-0000-4000-8000-000000000201','77000000-0000-4000-8000-000000000001','77000000-0000-4000-8000-000000000011','Monthly','Resident',current_date-90,'active');

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

select pg_temp.act_as('77000000-0000-4000-8000-000000000101');

-- A reviewed batch may legitimately carry several ancillary rows with
-- different labels; the guard must not reject same-category rows inside one run.
select lives_ok($$
  select public.post_resident_monthly_charges(
    '77000000-0000-4000-8000-000000000201', date '2026-07-01', date '2026-07-31',
    'July 2026 monthly billing', jsonb_build_array(
      jsonb_build_object('category','base_monthly','label','Base monthly charge','amount',1000),
      jsonb_build_object('category','ancillary_service','label','Escort service','amount',25),
      jsonb_build_object('category','ancillary_service','label','Laundry','amount',30)
    )
  )
$$,'first monthly posting run posts the reviewed batch, including two ancillary rows');
select is((select count(*)::integer from public.resident_financial_transactions
  where resident_id='77000000-0000-4000-8000-000000000201' and transaction_kind='charge'
    and service_period_start=date '2026-07-01' and service_period_end=date '2026-07-31'),
  3,'first run posts all three period charges');

-- Idempotency: replaying the identical run (double-click/retry) is rejected.
select throws_ok($$
  select public.post_resident_monthly_charges(
    '77000000-0000-4000-8000-000000000201', date '2026-07-01', date '2026-07-31',
    'July 2026 monthly billing', jsonb_build_array(
      jsonb_build_object('category','base_monthly','label','Base monthly charge','amount',1000),
      jsonb_build_object('category','ancillary_service','label','Escort service','amount',25),
      jsonb_build_object('category','ancillary_service','label','Laundry','amount',30)
    )
  )
$$,'23505',null,'replaying the identical monthly run for the same period is rejected');
select throws_ok($$
  select public.post_resident_monthly_charges(
    '77000000-0000-4000-8000-000000000201', date '2026-07-01', date '2026-07-31',
    'July 2026 monthly billing corrected memo', jsonb_build_array(
      jsonb_build_object('category','base_monthly','label','Base monthly charge','amount',1200)
    )
  )
$$,'23505',null,'a different amount or memo does not bypass the same-period same-category guard');
select is((select count(*)::integer from public.resident_financial_transactions
  where resident_id='77000000-0000-4000-8000-000000000201' and transaction_kind='charge'
    and service_period_start=date '2026-07-01' and service_period_end=date '2026-07-31'),
  3,'rejected reposts leave the period ledger unchanged');

-- A different category for the same period, and the next period, both post normally.
select lives_ok($$
  select public.post_resident_monthly_charges(
    '77000000-0000-4000-8000-000000000201', date '2026-07-01', date '2026-07-31',
    'July 2026 room rate', jsonb_build_array(
      jsonb_build_object('category','room_rate','label','Room rate','amount',300)
    )
  )
$$,'a category not yet posted for the period is accepted');
select lives_ok($$
  select public.post_resident_monthly_charges(
    '77000000-0000-4000-8000-000000000201', date '2026-08-01', date '2026-08-31',
    'August 2026 monthly billing', jsonb_build_array(
      jsonb_build_object('category','base_monthly','label','Base monthly charge','amount',1000)
    )
  )
$$,'the next service period posts normally');

-- Correction flow: adjust the July base charge, then repost that category/period.
select lives_ok($$
  select public.post_resident_financial_transaction('77000000-0000-4000-8000-000000000201',jsonb_build_object(
    'transactionKind','adjustment','entrySide','credit','category','adjustment','amount',1000,
    'effectiveOn',date '2026-07-31','memo','Reverse duplicate July base charge',
    'adjustsTransactionId',(select id from public.resident_financial_transactions
      where resident_id='77000000-0000-4000-8000-000000000201' and transaction_kind='charge'
        and category='base_monthly' and service_period_start=date '2026-07-01' limit 1),
    'adjustmentReason','Posted at the wrong rate; reversing to repost'
  ))
$$,'manager reverses the July base charge with a linked adjustment');
select lives_ok($$
  select public.post_resident_monthly_charges(
    '77000000-0000-4000-8000-000000000201', date '2026-07-01', date '2026-07-31',
    'July 2026 monthly billing repost', jsonb_build_array(
      jsonb_build_object('category','base_monthly','label','Base monthly charge','amount',1100)
    )
  )
$$,'an adjusted period charge may deliberately be reposted');
select is((select count(*)::integer from public.resident_financial_transactions
  where resident_id='77000000-0000-4000-8000-000000000201' and transaction_kind='charge'
    and category='base_monthly' and service_period_start=date '2026-07-01'),
  2,'the repost appends a second July base charge alongside the adjusted original');

select * from finish();
rollback;
