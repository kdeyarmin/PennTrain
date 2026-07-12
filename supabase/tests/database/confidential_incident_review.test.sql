begin;
select plan(23);

-- Confidential incident review commands: purpose-stamped audited detail reads, guarded
-- status transitions, and reporter-identity reveal -- plus closure of the unaudited
-- direct-SELECT path on protected narratives.

select ok(
  not has_table_privilege('authenticated','public.confidential_incident_details','SELECT'),
  'protected narratives are no longer directly selectable by browser roles'
);
select ok(
  not has_function_privilege('authenticated','app_private.assert_confidential_reviewer(uuid,boolean)','EXECUTE'),
  'the reviewer guard is not callable by clients'
);

insert into public.organizations(id,name,slug,subscription_status) values
  ('13000000-0000-4000-8000-000000000001','Confidential Review E','confidential-review-e','active'),
  ('13000000-0000-4000-8000-000000000002','Confidential Review F','confidential-review-f','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  ('13000000-0000-4000-8000-000000000011','13000000-0000-4000-8000-000000000001','Review Facility E','PCH');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',v.id,'authenticated','authenticated',v.email,'x',now(),'{}','{}',now(),now(),'','','','','','',false,false
from (values
  ('13000000-0000-4000-8000-000000000021'::uuid,'cr-admin-e@test.local'),
  ('13000000-0000-4000-8000-000000000022'::uuid,'cr-auditor-e@test.local'),
  ('13000000-0000-4000-8000-000000000023'::uuid,'cr-manager-e@test.local'),
  ('13000000-0000-4000-8000-000000000024'::uuid,'cr-admin-f@test.local')
) as v(id,email);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('13000000-0000-4000-8000-000000000021','13000000-0000-4000-8000-000000000001','cr-admin-e@test.local','Review','Admin E','org_admin',true),
  ('13000000-0000-4000-8000-000000000022','13000000-0000-4000-8000-000000000001','cr-auditor-e@test.local','Review','Auditor E','auditor',true),
  ('13000000-0000-4000-8000-000000000023','13000000-0000-4000-8000-000000000001','cr-manager-e@test.local','Review','Manager E','facility_manager',true),
  ('13000000-0000-4000-8000-000000000024','13000000-0000-4000-8000-000000000002','cr-admin-f@test.local','Review','Admin F','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);

-- Identified intake (reporter identity on file) and an anonymous intake.
insert into public.confidential_incident_intakes(id,organization_id,facility_id,report_type,severity,reporter_mode,public_summary,resume_secret_sha256,confirmation_token_sha256) values
  ('13000000-0000-4000-8000-000000000101','13000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000011','incident','moderate','identified','Identified staffing concern',repeat('c',64),repeat('d',64)),
  ('13000000-0000-4000-8000-000000000102','13000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000011','safety_concern','low','anonymous','Anonymous supply concern',repeat('e',64),repeat('f',64));
insert into public.confidential_incident_details(intake_id,organization_id,narrative) values
  ('13000000-0000-4000-8000-000000000101','13000000-0000-4000-8000-000000000001','Protected narrative for the identified intake'),
  ('13000000-0000-4000-8000-000000000102','13000000-0000-4000-8000-000000000001','Protected narrative for the anonymous intake');
insert into public.confidential_reporter_identities(intake_id,organization_id,reporter_profile_id,encrypted_contact,consent_to_contact) values
  ('13000000-0000-4000-8000-000000000101','13000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000023','{"ciphertext":"opaque"}',true);

create or replace function pg_temp.act_as(p_id uuid,p_role text default 'authenticated') returns void language plpgsql as $$begin reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role',p_role,'aal','aal2','iat',extract(epoch from now())::bigint)::text,true);if p_role='service_role' then set local role service_role;else set local role authenticated;end if;end$$;

-- Audited detail read.
select pg_temp.act_as('13000000-0000-4000-8000-000000000021');
select results_eq(
  $$ select count(*)::int from public.open_confidential_intake_details(
       '13000000-0000-4000-8000-000000000101','Investigating staffing complaint') $$,
  array[1],
  'an organization admin can open protected details through the audited command'
);
reset role;
select results_eq(
  $$ select count(*)::int from public.confidential_incident_access_events
     where intake_id='13000000-0000-4000-8000-000000000101' and event_type='view_details'
       and actor_profile_id='13000000-0000-4000-8000-000000000021' $$,
  array[1],
  'opening details stamps a view_details access event for the actor'
);
select pg_temp.act_as('13000000-0000-4000-8000-000000000022');
select results_eq(
  $$ select count(*)::int from public.open_confidential_intake_details(
       '13000000-0000-4000-8000-000000000101','Survey evidence review') $$,
  array[1],
  'an auditor can open protected details through the audited command'
);
select pg_temp.act_as('13000000-0000-4000-8000-000000000023');
select throws_ok(
  $$ select * from public.open_confidential_intake_details(
       '13000000-0000-4000-8000-000000000101','Facility manager curiosity') $$,
  '42501', null,
  'a facility manager cannot open protected details'
);
select pg_temp.act_as('13000000-0000-4000-8000-000000000024');
select throws_ok(
  $$ select * from public.open_confidential_intake_details(
       '13000000-0000-4000-8000-000000000101','Cross-tenant read') $$,
  '42501', null,
  'an admin of another organization cannot open protected details'
);
select pg_temp.act_as('13000000-0000-4000-8000-000000000021');
select throws_ok(
  $$ select * from public.open_confidential_intake_details(
       '13000000-0000-4000-8000-000000000101','why') $$,
  '22023', null,
  'a review purpose of at least five characters is required'
);

-- Status transitions.
select lives_ok(
  $$ select public.set_confidential_intake_status(
       '13000000-0000-4000-8000-000000000101','triage','Beginning triage review') $$,
  'an organization admin can move a submitted intake into triage'
);
reset role;
select results_eq(
  $$ select status from public.confidential_incident_intakes
     where id='13000000-0000-4000-8000-000000000101' $$,
  array['triage'::text],
  'the transition persists the target status'
);
select results_eq(
  $$ select count(*)::int from public.confidential_incident_access_events
     where intake_id='13000000-0000-4000-8000-000000000101' and event_type='status_change'
       and purpose='submitted -> triage: Beginning triage review' $$,
  array[1],
  'status changes stamp an access event recording old state, new state, and reason'
);
select pg_temp.act_as('13000000-0000-4000-8000-000000000022');
select throws_ok(
  $$ select public.set_confidential_intake_status(
       '13000000-0000-4000-8000-000000000101','investigating','Auditor attempting change') $$,
  '42501', null,
  'an auditor cannot change intake status'
);
select pg_temp.act_as('13000000-0000-4000-8000-000000000021');
select throws_ok(
  $$ select public.set_confidential_intake_status(
       '13000000-0000-4000-8000-000000000101','draft','Trying to re-enter draft') $$,
  '22023', null,
  'intake-side states cannot be re-entered'
);
select throws_ok(
  $$ select public.set_confidential_intake_status(
       '13000000-0000-4000-8000-000000000101','triage','Same status again') $$,
  '22023', null,
  'no-op transitions are rejected'
);
select lives_ok(
  $$ select public.set_confidential_intake_status(
       '13000000-0000-4000-8000-000000000101','closed','Investigation concluded') $$,
  'a triaged intake can be closed'
);
select throws_ok(
  $$ select public.set_confidential_intake_status(
       '13000000-0000-4000-8000-000000000101','investigating','Reopening closed intake') $$,
  '22023', null,
  'a closed intake cannot be reopened'
);
select lives_ok(
  $$ select public.set_confidential_intake_status(
       '13000000-0000-4000-8000-000000000101','retained','Placing under retention hold') $$,
  'a closed intake can be placed under a retention hold'
);
select throws_ok(
  $$ select public.set_confidential_intake_status(
       '13000000-0000-4000-8000-000000000101','closed','Leaving retention') $$,
  '22023', null,
  'retained is terminal'
);

-- Reporter identity reveal.
select results_eq(
  $$ select public.reveal_confidential_reporter_identity(
       '13000000-0000-4000-8000-000000000101','Regulatory follow-up contact')->>'identityOnFile' $$,
  array['true'::text],
  'an organization admin can reveal an identified reporter'
);
reset role;
select results_eq(
  $$ select count(*)::int from public.confidential_incident_access_events
     where intake_id='13000000-0000-4000-8000-000000000101' and event_type='view_identity' $$,
  array[1],
  'identity reveals stamp a view_identity access event'
);
select pg_temp.act_as('13000000-0000-4000-8000-000000000021');
select results_eq(
  $$ select public.reveal_confidential_reporter_identity(
       '13000000-0000-4000-8000-000000000102','Checking for reporter contact')->>'identityOnFile' $$,
  array['false'::text],
  'revealing an anonymous intake reports no identity on file'
);
select pg_temp.act_as('13000000-0000-4000-8000-000000000022');
select throws_ok(
  $$ select public.reveal_confidential_reporter_identity(
       '13000000-0000-4000-8000-000000000101','Auditor attempting reveal') $$,
  '42501', null,
  'an auditor cannot reveal reporter identity'
);
reset role;
select results_eq(
  $$ select count(*)::int from public.confidential_incident_access_events
     where intake_id='13000000-0000-4000-8000-000000000102' and event_type='view_identity' $$,
  array[1],
  'even no-identity reveals are part of the access ledger'
);

select * from finish();
rollback;
