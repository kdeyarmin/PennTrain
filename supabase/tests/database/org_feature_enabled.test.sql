begin;
select plan(7);

-- PT-066: coverage for org_feature_enabled (20260721220000) -- the caller-scoped
-- UI wrapper over evaluate_feature_access. It must return false for unknown
-- feature keys, expose only the caller's own organization's entitlement, and
-- never be executable by anon.

select has_function('public','org_feature_enabled','org_feature_enabled RPC exists');
select ok(not has_function_privilege('anon','public.org_feature_enabled(text)','EXECUTE'),
  'anonymous role cannot execute org_feature_enabled');
select ok(has_function_privilege('authenticated','public.org_feature_enabled(text)','EXECUTE'),
  'authenticated users may execute org_feature_enabled');

insert into public.organizations(id,name,slug,subscription_status) values
  ('79000000-0000-4000-8000-000000000001','Flag Org A','flag-org-a','active'),
  ('79000000-0000-4000-8000-000000000002','Flag Org B','flag-org-b','active');
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  email_change_token_current,reauthentication_token,is_sso_user,is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000','79000000-0000-4000-8000-000000000101','authenticated','authenticated','flag-admin-a@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false),
  ('00000000-0000-0000-0000-000000000000','79000000-0000-4000-8000-000000000102','authenticated','authenticated','flag-admin-b@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('79000000-0000-4000-8000-000000000101','79000000-0000-4000-8000-000000000001','flag-admin-a@test.local','Flag','Admin A','org_admin',true),
  ('79000000-0000-4000-8000-000000000102','79000000-0000-4000-8000-000000000002','flag-admin-b@test.local','Flag','Admin B','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);

-- Entitle Org A (and only Org A) to survey_day_mode: an organization grant plus
-- a globally-enabled release flag. Org B stays on the feature's false default.
insert into public.organization_entitlement_grants(organization_id,feature_key,decision,entitlement_value,reason)
values ('79000000-0000-4000-8000-000000000001','survey_day_mode','grant','true'::jsonb,'pgTAP entitlement fixture');
insert into public.release_flags(feature_key,rollout_mode,is_enabled,owner,change_reason)
values ('survey_day_mode','global',true,'pgtap','pgTAP release fixture')
on conflict (feature_key) do update set rollout_mode='global',is_enabled=true;

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

select pg_temp.act_as('79000000-0000-4000-8000-000000000101');
select is(public.org_feature_enabled('survey_day_mode'),
  true,'an entitled organization''s member sees the flag enabled');
select is(public.org_feature_enabled('pgtap_no_such_feature_key'),
  false,'a missing/unknown feature key resolves to false, never an error');

select pg_temp.act_as('79000000-0000-4000-8000-000000000102');
select is(public.org_feature_enabled('survey_day_mode'),
  false,'another organization without the grant sees the flag disabled');
select is(public.org_feature_enabled('pgtap_no_such_feature_key'),
  false,'a missing feature key is false for every organization');

select * from finish();
rollback;
