begin;
select plan(41);

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e9271740-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(profile_id uuid, session_id uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', profile_id, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session_id,
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end;
$$;

insert into public.organizations(id,name,slug,subscription_status) values
  (pg_temp.id(1),'Grant read A','grant-read-scope-a','active'),
  (pg_temp.id(2),'Grant read B','grant-read-scope-b','active');
insert into app_private.module_access_terms(organization_id,module_key,source,reason) values
  (pg_temp.id(1),'modules.carebase','complimentary','Disposable enterprise grant read fixture'),
  (pg_temp.id(2),'modules.carebase','complimentary','Disposable enterprise grant read fixture');
insert into public.facilities(id,organization_id,name,facility_type) values
  (pg_temp.id(11),pg_temp.id(1),'Grant read facility A','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,
  email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',pg_temp.id(n),'authenticated','authenticated',
  'grant-read-' || n || '@fixture.test','x',now(),
  jsonb_build_object('role',fixture_role,'organization_id',fixture_org),'{}'::jsonb,
  now(),now(),'','','','','','',false,false
from (values (101,'platform_admin',null::uuid),(102,'org_admin',pg_temp.id(1)),
  (103,'employee',pg_temp.id(1)),(104,'employee',pg_temp.id(2)),(105,'employee',pg_temp.id(1)))
  v(n,fixture_role,fixture_org);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,first_name,last_name,email,role,is_active)
select pg_temp.id(n),fixture_org,'Grant',n::text,'grant-read-' || n || '@fixture.test',fixture_role,true
from (values (101,'platform_admin',null::uuid),(102,'org_admin',pg_temp.id(1)),
  (103,'employee',pg_temp.id(1)),(104,'employee',pg_temp.id(2)),(105,'employee',pg_temp.id(1)))
  v(n,fixture_role,fixture_org)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','',true);

-- Read authority is current; the rows being inspected need not be. These real
-- historical/future records obey the membership and grant containment triggers.
insert into public.enterprise_scope_memberships(id,profile_id,scope_type,organization_id,facility_id,effective_from,effective_to)
values (pg_temp.id(301),pg_temp.id(103),'organization',pg_temp.id(1),null,now()-interval '2 days',now()-interval '1 day'),
  (pg_temp.id(302),pg_temp.id(103),'facility',null,pg_temp.id(11),now()+interval '1 day',null);
insert into public.enterprise_access_grants(id,membership_id,role_template_id,effective_from,effective_to)
select pg_temp.id(n),pg_temp.id(membership),rt.id,starts,ends
from (values (401,301,now()-interval '2 days',now()-interval '1 day'),
  (402,302,now()+interval '1 day',null::timestamptz)) v(n,membership,starts,ends)
cross join public.role_templates rt where rt.built_in_role='employee';

select ok(not has_schema_privilege('authenticated','app_private','USAGE'),
  'the policy helper does not expose the private schema to authenticated callers');
set local role anon;
select throws_ok('select id from public.enterprise_access_grants','42501',null,
  'anonymous callers still cannot read enterprise grants');
reset role;
select pg_temp.act_as(pg_temp.id(103));
select is((select count(*)::integer from public.enterprise_scope_memberships),3,
  'a permissionless employee sees all three of their own memberships');
select is((select count(*)::integer from public.enterprise_access_grants),3,
  'own grants remain visible without current enterprise permission');
select ok(exists(select 1 from public.enterprise_access_grants where id=pg_temp.id(401)),
  'own expired membership and grant remain inspectable');
select ok(exists(select 1 from public.enterprise_access_grants where id=pg_temp.id(402)),
  'own future membership and grant remain inspectable');
select is((select count(*)::integer from public.enterprise_scope_memberships where profile_id<>pg_temp.id(103)),0,
  'own visibility does not reveal same-tenant or foreign peer memberships');
reset role;

select pg_temp.act_as(pg_temp.id(102));
select is((select count(*)::integer from public.enterprise_scope_memberships),5,
  'organization authority covers its three current members plus historical and future rows');
select is((select count(*)::integer from public.enterprise_access_grants),5,
  'grant read scope matches membership scope without hiding historical or future grants');
select is((select count(*)::integer from public.enterprise_scope_memberships where profile_id=pg_temp.id(104)),0,
  'organization authority cannot read another tenant');
select is((select count(*)::integer from public.enterprise_access_grants g
  left join public.role_templates rt on rt.id=g.role_template_id
  left join public.enterprise_scope_memberships m on m.id=g.membership_id
  left join public.profiles p on p.id=m.profile_id
  where rt.name is not null and p.email like 'grant-read-%@fixture.test' and m.scope_type is not null),5,
  'authenticated embedded template membership and holder joins retain visible data');
select is((select array_agg(id order by effective_from desc,id) from (
    (select id,effective_from from public.enterprise_access_grants order by effective_from desc,id limit 2 offset 0)
    union all (select id,effective_from from public.enterprise_access_grants order by effective_from desc,id limit 2 offset 2)
    union all (select id,effective_from from public.enterprise_access_grants order by effective_from desc,id limit 2 offset 4)
  ) pages),
  (select array_agg(id order by effective_from desc,id) from public.enterprise_access_grants),
  'successive authenticated pages exhaust all visible grants exactly once');
select is((select count(*)::integer from (select id from public.enterprise_access_grants
  order by effective_from desc,id limit 2 offset 5) exhausted),0,
  'the required final empty page returns no rows under the same policies');
reset role;

-- A legacy employee can receive an explicit region-scoped read grant. Preserve
-- exact permission matching and containment, not an implicit role bypass.
insert into public.role_templates(id,code,name) values(pg_temp.id(201),'fixture.grant-reader','Fixture grant reader');
insert into public.role_template_permissions(role_template_id,permission_key)
values(pg_temp.id(201),'enterprise.scope.read');
insert into public.enterprise_scope_memberships(id,profile_id,scope_type,region_id,effective_from)
select pg_temp.id(303),pg_temp.id(105),'region',region_id,now()
from public.enterprise_organization_memberships where organization_id=pg_temp.id(2) and effective_to is null;
insert into public.enterprise_access_grants(id,membership_id,role_template_id,effective_from)
values(pg_temp.id(403),pg_temp.id(303),pg_temp.id(201),now());

select pg_temp.act_as(pg_temp.id(105));
select is((select count(*)::integer from public.enterprise_scope_memberships),3,
  'a delegated region reader sees their own two scopes and the descendant tenant member');
select is((select count(*)::integer from public.enterprise_access_grants),3,
  'a delegated reader sees descendant grants plus their own grants');
select is((select count(*)::integer from public.enterprise_scope_memberships where profile_id=pg_temp.id(102)),0,
  'delegation does not reveal unrelated scopes in the callers home organization');
select is((select p.email from public.enterprise_access_grants g
  join public.enterprise_scope_memberships m on m.id=g.membership_id
  left join public.profiles p on p.id=m.profile_id where m.profile_id=pg_temp.id(104)),null::text,
  'grant visibility does not bypass the foreign holder profiles independent RLS');
reset role;

update public.enterprise_access_grants set effective_to=now() where id=pg_temp.id(403);
select pg_temp.act_as(pg_temp.id(105));
select is((select count(*)::integer from public.enterprise_access_grants),2,
  'an expired caller grant removes inherited authority but preserves own history');
reset role;
update public.enterprise_access_grants set effective_to=null,effective_from=now()+interval '1 day' where id=pg_temp.id(403);
select pg_temp.act_as(pg_temp.id(105));
select is((select count(*)::integer from public.enterprise_scope_memberships),2,
  'a future caller grant confers no current inherited authority');
reset role;
update public.enterprise_access_grants set effective_from=now() where id=pg_temp.id(403);
update public.enterprise_scope_memberships set effective_to=now() where id=pg_temp.id(303);
select pg_temp.act_as(pg_temp.id(105));
select is((select count(*)::integer from public.enterprise_access_grants),2,
  'an expired caller membership confers no authority even if its grant remains open');
reset role;
update public.enterprise_scope_memberships set effective_to=null,effective_from=now()+interval '1 day' where id=pg_temp.id(303);
select pg_temp.act_as(pg_temp.id(105));
select is((select count(*)::integer from public.enterprise_access_grants),2,
  'a future caller membership confers no current inherited authority');
reset role;
update public.enterprise_scope_memberships set effective_from=now() where id=pg_temp.id(303);
update public.role_templates set is_active=false where id=pg_temp.id(201);
select pg_temp.act_as(pg_temp.id(105));
select is((select count(*)::integer from public.enterprise_access_grants),2,
  'an inactive caller template cannot authorize peer grant reads');
reset role;
update public.role_templates set is_active=true where id=pg_temp.id(201);
update public.permission_definitions set is_active=false where permission_key='enterprise.scope.read';
select pg_temp.act_as(pg_temp.id(105));
select is((select count(*)::integer from public.enterprise_access_grants),2,
  'an inactive permission definition cannot authorize peer grant reads');
reset role;
update public.permission_definitions set is_active=true where permission_key='enterprise.scope.read';
update public.role_template_permissions set permission_key='enterprise.scope.manage' where role_template_id=pg_temp.id(201);
select pg_temp.act_as(pg_temp.id(105));
select is((select count(*)::integer from public.enterprise_access_grants),2,
  'management permission does not wildcard-match the separate read permission');
reset role;
update public.role_template_permissions set permission_key='enterprise.scope.read' where role_template_id=pg_temp.id(201);

update public.facilities set is_active=false where id=pg_temp.id(11);
select pg_temp.act_as(pg_temp.id(102));
select ok(not exists(select 1 from public.enterprise_access_grants where id=pg_temp.id(402)),
  'an inactive target facility is hidden from organization permission authority');
reset role;
select pg_temp.act_as(pg_temp.id(103));
select ok(exists(select 1 from public.enterprise_access_grants where id=pg_temp.id(402)),
  'an inactive target does not hide its holders own future grant');
reset role;
update public.facilities set is_active=true where id=pg_temp.id(11);
update public.enterprise_regions set status='inactive' where id=(
  select region_id from public.enterprise_scope_memberships where id=pg_temp.id(303));
select pg_temp.act_as(pg_temp.id(105));
select is((select count(*)::integer from public.enterprise_access_grants),2,
  'an inactive parent scope removes delegated authority while retaining own rows');
reset role;
update public.enterprise_regions set status='active' where id=(
  select region_id from public.enterprise_scope_memberships where id=pg_temp.id(303));
-- The column guard intentionally ignores a subjectless service-role JWT.
-- Use the real AAL2 platform fixture, then verify setup before testing denial.
select pg_temp.act_as(pg_temp.id(101));
update public.organizations set subscription_status='suspended' where id=pg_temp.id(1);
reset role;
select is((select subscription_status from public.organizations where id=pg_temp.id(1)),'suspended',
  'the authorized setup persists the suspended caller subscription');
select pg_temp.act_as(pg_temp.id(105));
select is((select count(*)::integer from public.enterprise_access_grants),0,
  'a suspended caller cannot read grants through the module gate or foreign-region delegation');
reset role;
select pg_temp.act_as(pg_temp.id(101));
update public.organizations set subscription_status='active' where id=pg_temp.id(1);
reset role;
select is((select subscription_status from public.organizations where id=pg_temp.id(1)),'active',
  'the authorized restoration persists the active caller subscription');
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id=pg_temp.id(105);
select set_config('app.privileged_write','',true);
select pg_temp.act_as(pg_temp.id(105));
select is((select count(*)::integer from public.enterprise_scope_memberships where profile_id<>pg_temp.id(105)),0,
  'a disabled profile cannot use delegated authority with an old token');
select is((select count(*)::integer from public.enterprise_access_grants),0,
  'the existing module gate also hides a disabled profiles own grants');
reset role;
update public.enterprise_access_grants set effective_to=now() where membership_id in (
  select id from public.enterprise_scope_memberships where profile_id=pg_temp.id(101)) and effective_to is null;
select pg_temp.act_as(pg_temp.id(101));
select is((select count(*)::integer from public.enterprise_access_grants),1,
  'a raw platform role without a current permission grant sees only its own historical grant');
reset role;

-- Both direct readers carry identical restrictive module and session policies.
-- A definer membership-ID lookup must not let grants escape those outer gates.
insert into public.organization_entitlement_grants(id,organization_id,feature_key,decision,reason,effective_from)
values(pg_temp.id(701),pg_temp.id(1),'modules.carebase','deny','Fixture explicit CareBase denial',now()-interval '1 minute');
select pg_temp.act_as(pg_temp.id(103));
select is((select count(*)::integer from public.enterprise_scope_memberships),0,
  'an explicit module denial hides owner memberships despite independent access terms');
select is((select count(*)::integer from public.enterprise_access_grants),0,
  'an explicit module denial hides grants despite the definer membership lookup');
reset role;
update public.organization_entitlement_grants set effective_to=now() where id=pg_temp.id(701);
insert into app_private.sms_mfa_accounts(profile_id) values(pg_temp.id(103));
select pg_temp.act_as(pg_temp.id(103));
select is((select count(*)::integer from public.enterprise_scope_memberships),0,
  'missing required SMS assurance hides even direct owner memberships');
select is((select count(*)::integer from public.enterprise_access_grants),0,
  'missing required SMS assurance hides grants despite the definer membership lookup');
reset role;
delete from app_private.sms_mfa_accounts where profile_id=pg_temp.id(103);
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after)
values(pg_temp.id(501),pg_temp.id(103),now(),now(),'aal1',null);
insert into public.impersonation_sessions(id,actor_profile_id,target_profile_id,target_organization_id,
  target_session_id,context_secret_sha256,reason,expires_at)
values(pg_temp.id(601),pg_temp.id(101),pg_temp.id(103),pg_temp.id(1),pg_temp.id(501)::text,
  repeat('a',64),'Grant read fixture',now()+interval '30 minutes');
select pg_temp.act_as(pg_temp.id(103),pg_temp.id(501));
select is((select count(*)::integer from public.enterprise_access_grants),3,
  'a live impersonation preserves the target employees own visible grants');
reset role;
update public.impersonation_sessions set expires_at=now()-interval '1 second' where id=pg_temp.id(601);
select pg_temp.act_as(pg_temp.id(103),pg_temp.id(501));
select is((select count(*)::integer from public.enterprise_scope_memberships),0,
  'expired impersonation hides owner memberships under restrictive RLS');
select is((select count(*)::integer from public.enterprise_access_grants),0,
  'expired impersonation hides grants despite the definer membership lookup');
reset role;
select pg_temp.act_as(pg_temp.id(103));
select is((select count(*)::integer from public.enterprise_access_grants),3,
  'an independent ordinary session does not inherit another sessions expiry');
reset role;

select * from finish();
rollback;
