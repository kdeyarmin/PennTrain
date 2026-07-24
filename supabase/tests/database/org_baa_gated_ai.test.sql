begin;
select plan(39);

-- PT-019: per-organization BAA-gated AI (20260725000000).
--
-- Covers: the org gate truth table (demo allowed, BAA allowed, no-BAA denied,
-- toggle-off denied), the caller-scoped public wrapper, the protect_baa_fields
-- write guard, the platform-admin BAA acceptance RPC (auth + stamping + audit),
-- and BAA stamping through the signup RPC.

-- ---------------------------------------------------------------------------------
-- Schema and privilege surface.
-- ---------------------------------------------------------------------------------
select has_column('public','organizations','baa_version','organizations.baa_version exists');
select has_column('public','organizations','baa_accepted_at','organizations.baa_accepted_at exists');
select has_column('public','organizations','ai_features_enabled','organizations.ai_features_enabled exists');
select has_function('app_private','org_ai_allowed', array['uuid'], 'app_private.org_ai_allowed exists');
select has_trigger('public','organizations','protect_baa_fields','BAA columns carry a write-guard trigger');

select ok(not has_function_privilege('anon','public.org_ai_allowed(uuid)','EXECUTE'),
  'anon cannot execute org_ai_allowed');
select ok(has_function_privilege('authenticated','public.org_ai_allowed(uuid)','EXECUTE'),
  'authenticated may execute org_ai_allowed');
select ok(not has_function_privilege('anon','public.record_organization_signup(text,text,timestamptz,text)','EXECUTE'),
  'anon cannot execute record_organization_signup');
select ok(not has_function_privilege('authenticated','public.record_organization_signup(text,text,timestamptz,text)','EXECUTE'),
  'authenticated cannot execute record_organization_signup');
select ok(has_function_privilege('service_role','public.record_organization_signup(text,text,timestamptz,text)','EXECUTE'),
  'service_role may execute record_organization_signup');
select ok(not has_function_privilege('anon','public.set_organization_baa_acceptance(uuid,text)','EXECUTE'),
  'anon cannot execute set_organization_baa_acceptance');

-- ---------------------------------------------------------------------------------
-- Fixtures. BAA columns can be seeded by INSERT here because the write guard is
-- (deliberately, like protect_subscription_fields) an UPDATE-only trigger and
-- INSERT is already restricted to platform admins / the signup RPC.
-- ---------------------------------------------------------------------------------
insert into public.organizations(id,name,slug,subscription_status,is_demo,demo_seed_version) values
  ('7ba00000-0000-4000-8000-000000000001','BAA Demo Org','baa-demo-org','active',true,1);
insert into public.organizations(id,name,slug,subscription_status,baa_version,baa_accepted_at) values
  ('7ba00000-0000-4000-8000-000000000002','BAA Signed Org','baa-signed-org','active',
   'CareMetric-HIPAA-BAA-v2026-07-14','2026-07-14 00:00:00+00');
insert into public.organizations(id,name,slug,subscription_status) values
  ('7ba00000-0000-4000-8000-000000000003','BAA Missing Org','baa-missing-org','active');
insert into public.organizations(id,name,slug,subscription_status,baa_version,baa_accepted_at,ai_features_enabled) values
  ('7ba00000-0000-4000-8000-000000000004','BAA Opted Out Org','baa-opted-out-org','active',
   'CareMetric-HIPAA-BAA-v2026-07-14','2026-07-14 00:00:00+00',false);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  email_change_token_current,reauthentication_token,is_sso_user,is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000','7ba00000-0000-4000-8000-000000000101','authenticated','authenticated','baa-platform@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false),
  ('00000000-0000-0000-0000-000000000000','7ba00000-0000-4000-8000-000000000102','authenticated','authenticated','baa-orgadmin@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('7ba00000-0000-4000-8000-000000000101',null,'baa-platform@test.local','Baa','Platform','platform_admin',true),
  ('7ba00000-0000-4000-8000-000000000102','7ba00000-0000-4000-8000-000000000002',
   'baa-orgadmin@test.local','Baa','OrgAdmin','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);

create or replace function pg_temp.act_as(p_id uuid, p_role text default 'authenticated', p_aal text default 'aal2')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_id, 'role', p_role, 'aal', p_aal,
    'iat', extract(epoch from now())::bigint
  )::text, true);
  if p_role = 'service_role' then set local role service_role;
  else set local role authenticated;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------
-- Gate truth table (bare truth function, as postgres).
-- ---------------------------------------------------------------------------------
select is(app_private.org_ai_allowed('7ba00000-0000-4000-8000-000000000001'),
  true,'demo org is allowed without a BAA (synthetic data only)');
select is(app_private.org_ai_allowed('7ba00000-0000-4000-8000-000000000002'),
  true,'org with a recorded BAA is allowed');
select is(app_private.org_ai_allowed('7ba00000-0000-4000-8000-000000000003'),
  false,'org without a BAA is denied');
select is(app_private.org_ai_allowed('7ba00000-0000-4000-8000-000000000004'),
  false,'org that toggled AI features off is denied despite its BAA');
select is(app_private.org_ai_allowed('7ba00000-0000-4000-8000-00000000dead'),
  false,'unknown organization id is denied');

-- ---------------------------------------------------------------------------------
-- Caller-scoped public wrapper.
-- ---------------------------------------------------------------------------------
select pg_temp.act_as('7ba00000-0000-4000-8000-000000000102');
select is(public.org_ai_allowed('7ba00000-0000-4000-8000-000000000002'),
  true,'an org member sees their own organization''s gate state');
select is(public.org_ai_allowed('7ba00000-0000-4000-8000-000000000001'),
  false,'an org member asking about another organization gets false, even though that org itself passes');
select pg_temp.act_as('7ba00000-0000-4000-8000-000000000102','service_role');
select is(public.org_ai_allowed('7ba00000-0000-4000-8000-000000000001'),
  true,'service_role (edge functions) may evaluate any organization');
reset role;

-- ---------------------------------------------------------------------------------
-- Write guard: an org_admin cannot self-attest a BAA, but owns the AI toggle.
-- ---------------------------------------------------------------------------------
select pg_temp.act_as('7ba00000-0000-4000-8000-000000000102');
update public.organizations
set baa_version = 'self-attested-v1',
    baa_accepted_at = now(),
    ai_features_enabled = false
where id = '7ba00000-0000-4000-8000-000000000002';
reset role;
select is((select baa_version from public.organizations where id='7ba00000-0000-4000-8000-000000000002'),
  'CareMetric-HIPAA-BAA-v2026-07-14','protect_baa_fields reverts an org_admin''s baa_version write');
select is((select baa_accepted_at from public.organizations where id='7ba00000-0000-4000-8000-000000000002'),
  '2026-07-14 00:00:00+00'::timestamptz,'protect_baa_fields reverts an org_admin''s baa_accepted_at write');
select is((select ai_features_enabled from public.organizations where id='7ba00000-0000-4000-8000-000000000002'),
  false,'the same UPDATE still lands the org_admin''s own ai_features_enabled toggle');
select is(app_private.org_ai_allowed('7ba00000-0000-4000-8000-000000000002'),
  false,'toggling AI features off closes the gate for a BAA org');
update public.organizations set ai_features_enabled = true
where id = '7ba00000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------------
-- set_organization_baa_acceptance: auth, stamping, audit, clearing.
-- ---------------------------------------------------------------------------------
select pg_temp.act_as('7ba00000-0000-4000-8000-000000000102');
select throws_ok(
  $$ select public.set_organization_baa_acceptance(
       '7ba00000-0000-4000-8000-000000000003','CareMetric-HIPAA-BAA-v2026-07-14') $$,
  '42501', null, 'a non-platform-admin cannot record BAA acceptance');
select pg_temp.act_as('7ba00000-0000-4000-8000-000000000101','authenticated','aal1');
select throws_ok(
  $$ select public.set_organization_baa_acceptance(
       '7ba00000-0000-4000-8000-000000000003','CareMetric-HIPAA-BAA-v2026-07-14') $$,
  '42501', null, 'a platform admin without a fresh AAL2 session is refused');
select pg_temp.act_as('7ba00000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.set_organization_baa_acceptance(
       '7ba00000-0000-4000-8000-000000000003','CareMetric-HIPAA-BAA-v2026-07-14') $$,
  'an AAL2 platform admin records BAA acceptance');
reset role;
select is((select baa_version from public.organizations where id='7ba00000-0000-4000-8000-000000000003'),
  'CareMetric-HIPAA-BAA-v2026-07-14','the RPC stamps baa_version');
select ok((select baa_accepted_at is not null from public.organizations where id='7ba00000-0000-4000-8000-000000000003'),
  'the RPC stamps baa_accepted_at');
select is(app_private.org_ai_allowed('7ba00000-0000-4000-8000-000000000003'),
  true,'recording the BAA opens the gate for the previously denied org');
select ok(exists(
  select 1 from public.audit_logs
  where entity_type = 'organizations'
    and entity_id = '7ba00000-0000-4000-8000-000000000003'
    and action = 'organizations_updated'
    and reason like '%BAA acceptance%'),
  'the BAA acceptance update lands in audit_logs with the admin reason');

select pg_temp.act_as('7ba00000-0000-4000-8000-000000000101');
select lives_ok(
  $$ select public.set_organization_baa_acceptance('7ba00000-0000-4000-8000-000000000003', null) $$,
  'an AAL2 platform admin can clear a recorded BAA');
reset role;
select ok((select baa_version is null and baa_accepted_at is null
           from public.organizations where id='7ba00000-0000-4000-8000-000000000003'),
  'clearing removes both the version and the acceptance timestamp');
select is(app_private.org_ai_allowed('7ba00000-0000-4000-8000-000000000003'),
  false,'clearing the BAA closes the gate again');

-- ---------------------------------------------------------------------------------
-- record_organization_signup: the signup path stamps the accepted BAA.
-- ---------------------------------------------------------------------------------
select pg_temp.act_as('7ba00000-0000-4000-8000-000000000102','service_role');
select lives_ok(
  $$ select public.record_organization_signup(
       'PgTap Signup Org','pgtap-signup-org', now() + interval '30 days',
       'CareMetric-HIPAA-BAA-v2026-07-14') $$,
  'the signup RPC creates an organization as service_role');
select throws_ok(
  $$ select public.record_organization_signup(
       'PgTap Signup Org Again','pgtap-signup-org', now() + interval '30 days',
       'CareMetric-HIPAA-BAA-v2026-07-14') $$,
  '23505', null, 'a duplicate slug surfaces as 23505 so the caller''s retry loop still works');
select throws_ok(
  $$ select public.record_organization_signup(
       'PgTap Signup Org Blank','pgtap-signup-org-blank', now() + interval '30 days', '  ') $$,
  '22023', null, 'a blank BAA version is rejected outright');
reset role;
select is((select baa_version from public.organizations where slug='pgtap-signup-org'),
  'CareMetric-HIPAA-BAA-v2026-07-14','signup stamps the accepted BAA version onto the organization');
select ok((select baa_accepted_at is not null and ai_features_enabled
           from public.organizations where slug='pgtap-signup-org'),
  'signup stamps the acceptance time and leaves the AI toggle at its enabled default');
select is(app_private.org_ai_allowed((select id from public.organizations where slug='pgtap-signup-org')),
  true,'a fresh self-service signup passes the gate from day one');

select * from finish();
rollback;
