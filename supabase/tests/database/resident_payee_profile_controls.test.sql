begin;
select plan(21);

-- PT-066: role/tenant matrix and audit-evidence coverage for
-- resident_personal_fund_payee_profiles + upsert_resident_personal_fund_payee_profile.
-- Mirrors resident_financial_operations.test.sql's seeding/act_as pattern.

select has_table('public','resident_personal_fund_payee_profiles','payee controls have a dedicated profile table');
select has_function('public','upsert_resident_personal_fund_payee_profile','payee profile upsert RPC exists');
select ok(not has_function_privilege('anon','public.upsert_resident_personal_fund_payee_profile(uuid,jsonb)','EXECUTE'),
  'anonymous role cannot execute the payee profile upsert');
select ok(not has_table_privilege('anon','public.resident_personal_fund_payee_profiles','SELECT'),
  'anonymous role cannot read payee profiles');

insert into public.organizations(id,name,slug,subscription_status) values
  ('76000000-0000-4000-8000-000000000001','Payee Org','payee-org','active'),
  ('76000000-0000-4000-8000-000000000002','Other Payee Org','other-payee-org','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('76000000-0000-4000-8000-000000000011','76000000-0000-4000-8000-000000000001','Payee Facility','PCH'),
  ('76000000-0000-4000-8000-000000000012','76000000-0000-4000-8000-000000000001','Second Payee Facility','ALR'),
  ('76000000-0000-4000-8000-000000000013','76000000-0000-4000-8000-000000000002','Other Payee Facility','PCH');
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  email_change_token_current,reauthentication_token,is_sso_user,is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000','76000000-0000-4000-8000-000000000101','authenticated','authenticated','payee-admin@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false),
  ('00000000-0000-0000-0000-000000000000','76000000-0000-4000-8000-000000000102','authenticated','authenticated','payee-employee@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false),
  ('00000000-0000-0000-0000-000000000000','76000000-0000-4000-8000-000000000104','authenticated','authenticated','other-payee-admin@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false),
  ('00000000-0000-0000-0000-000000000000','76000000-0000-4000-8000-000000000105','authenticated','authenticated','payee-manager@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000001','payee-admin@test.local','Payee','Admin','org_admin',true),
  ('76000000-0000-4000-8000-000000000102','76000000-0000-4000-8000-000000000001','payee-employee@test.local','Payee','Employee','employee',true),
  ('76000000-0000-4000-8000-000000000104','76000000-0000-4000-8000-000000000002','other-payee-admin@test.local','Other','Admin','org_admin',true),
  ('76000000-0000-4000-8000-000000000105','76000000-0000-4000-8000-000000000001','payee-manager@test.local','Payee','Manager','facility_manager',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);
-- The facility_manager is assigned ONLY to the second facility, so the resident's
-- facility (11) is outside their assignment scope.
insert into public.facility_assignments(profile_id,facility_id) values
  ('76000000-0000-4000-8000-000000000105','76000000-0000-4000-8000-000000000012'),
  ('76000000-0000-4000-8000-000000000102','76000000-0000-4000-8000-000000000011');
insert into public.residents(id,organization_id,facility_id,first_name,last_name,admission_date,status) values
  ('76000000-0000-4000-8000-000000000201','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000011','Payee','Resident',current_date-60,'active');

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

-- Cross-org caller is rejected before any row is touched.
select pg_temp.act_as('76000000-0000-4000-8000-000000000104');
select throws_ok($$
  select public.upsert_resident_personal_fund_payee_profile('76000000-0000-4000-8000-000000000201','{}'::jsonb)
$$,'42501',null,'cross-org admin cannot upsert another tenant''s payee profile');

-- In-org facility_manager without an assignment to the resident's facility is rejected.
select pg_temp.act_as('76000000-0000-4000-8000-000000000105');
select throws_ok($$
  select public.upsert_resident_personal_fund_payee_profile('76000000-0000-4000-8000-000000000201','{}'::jsonb)
$$,'42501',null,'unassigned facility_manager cannot upsert the payee profile');

-- The profile requires an open personal funds account first.
select pg_temp.act_as('76000000-0000-4000-8000-000000000101');
select throws_ok($$
  select public.upsert_resident_personal_fund_payee_profile('76000000-0000-4000-8000-000000000201','{}'::jsonb)
$$,'P0002',null,'payee profile cannot be configured before a personal funds account exists');

select lives_ok($$
  select public.open_resident_personal_fund_account('76000000-0000-4000-8000-000000000201',current_date,0,true,null)
$$,'manager opens the resident personal funds account');

-- Happy path: first configuration records a history event whose evidence diffs
-- every changed money-relevant field against null.
select lives_ok($$
  select public.upsert_resident_personal_fund_payee_profile('76000000-0000-4000-8000-000000000201',jsonb_build_object(
    'facilityIsRepresentativePayee',true,
    'payeeAuthorityStatus','approved',
    'benefitSource','Social Security retirement',
    'benefitAmount','1200.50',
    'personalNeedsAllowance','60',
    'collectiveAccountLast4','1234',
    'statementCadence','monthly'
  ))
$$,'manager records the initial payee profile');
select is((select benefit_amount from public.resident_personal_fund_payee_profiles where resident_id='76000000-0000-4000-8000-000000000201'),
  1200.50::numeric,'payee profile persists the benefit amount');
select is((select count(*)::integer from public.resident_financial_history
  where resident_id='76000000-0000-4000-8000-000000000201' and event_type='personal_fund_payee_profile_updated'),
  1,'first upsert appends one payee-profile history event');
select is((select evidence->'changes'->'benefitAmount'->'old' from public.resident_financial_history
  where resident_id='76000000-0000-4000-8000-000000000201' and event_type='personal_fund_payee_profile_updated'),
  'null'::jsonb,'initial configuration records a null old benefit amount');
select is((select evidence->'changes'->'benefitAmount'->'new' from public.resident_financial_history
  where resident_id='76000000-0000-4000-8000-000000000201' and event_type='personal_fund_payee_profile_updated'),
  to_jsonb(1200.50::numeric),'initial configuration records the new benefit amount');
select is((select evidence->'changes'->'payeeAuthorityStatus'->>'new' from public.resident_financial_history
  where resident_id='76000000-0000-4000-8000-000000000201' and event_type='personal_fund_payee_profile_updated'),
  'approved','initial configuration records the new authority status');

-- Second (full-replace) upsert: only fields that actually changed appear in
-- evidence.changes, with usable old/new values.
select lives_ok($$
  select public.upsert_resident_personal_fund_payee_profile('76000000-0000-4000-8000-000000000201',jsonb_build_object(
    'facilityIsRepresentativePayee',true,
    'payeeAuthorityStatus','approved',
    'benefitAmount','1300.00',
    'personalNeedsAllowance','60',
    'collectiveAccountLast4','4321',
    'statementCadence','monthly'
  ))
$$,'manager updates the payee profile with new money values');
select is((select count(*)::integer from public.resident_financial_history
  where resident_id='76000000-0000-4000-8000-000000000201' and event_type='personal_fund_payee_profile_updated'),
  2,'second upsert appends a second history event');
select ok(exists(
  select 1 from public.resident_financial_history
  where resident_id='76000000-0000-4000-8000-000000000201'
    and event_type='personal_fund_payee_profile_updated'
    and evidence->'changes'->'benefitAmount'->'old' = to_jsonb(1200.50::numeric)
    and evidence->'changes'->'benefitAmount'->'new' = to_jsonb(1300.00::numeric)
    and evidence->'changes'->'collectiveAccountLast4'->>'old' = '1234'
    and evidence->'changes'->'collectiveAccountLast4'->>'new' = '4321'
),'benefit amount and collective-account changes carry old and new values');
select ok(not exists(
  select 1 from public.resident_financial_history
  where resident_id='76000000-0000-4000-8000-000000000201'
    and event_type='personal_fund_payee_profile_updated'
    and evidence->'changes'->'benefitAmount'->'new' = to_jsonb(1300.00::numeric)
    and evidence->'changes' ? 'payeeAuthorityStatus'
),'unchanged authority status is not reported as a change');
-- Full-replace contract: benefitSource was omitted from the second payload, so it resets.
select is((select benefit_source from public.resident_personal_fund_payee_profiles where resident_id='76000000-0000-4000-8000-000000000201'),
  null::text,'full-replace upsert resets omitted fields instead of preserving them');

-- Read scope: employees and cross-tenant admins see nothing.
select pg_temp.act_as('76000000-0000-4000-8000-000000000102');
select is((select count(*)::integer from public.resident_personal_fund_payee_profiles),
  0,'employee cannot read payee profiles');
select pg_temp.act_as('76000000-0000-4000-8000-000000000104');
select is((select count(*)::integer from public.resident_personal_fund_payee_profiles),
  0,'cross-org admin cannot read payee profiles');

select * from finish();
rollback;
