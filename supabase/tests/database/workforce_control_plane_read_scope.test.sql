begin;
select plan(30);

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e9271557-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.act_as(actor uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated',
    'aal','aal2','iat',extract(epoch from now())::bigint)::text,true);
  set local role authenticated;
end;
$$;
create temporary table workforce_reads(label text primary key, result jsonb not null);
grant select,insert on workforce_reads to authenticated;
create function pg_temp.observed(read_label text) returns jsonb language sql stable as $$
  select result from pg_temp.workforce_reads where label=read_label;
$$;

select ok(has_function_privilege('authenticated','public.get_workforce_compliance_control_plane()','EXECUTE')
  and not has_function_privilege('anon','public.get_workforce_compliance_control_plane()','EXECUTE')
  and not has_function_privilege('service_role','public.get_workforce_compliance_control_plane()','EXECUTE'),
  'workforce read remains an authenticated-only RPC');
set local role anon;
select throws_ok('select public.get_workforce_compliance_control_plane()','42501',null,'anonymous callers remain denied');
reset role;
select pg_temp.act_as(null);
select throws_ok('select public.get_workforce_compliance_control_plane()','42501','An active authenticated profile is required',
  'a database authenticated role without a subject is rejected');
reset role;
select set_config('request.jwt.claims','{}',true);

insert into public.organizations(id,name,slug,subscription_status) values
  (pg_temp.id(1),'Workforce read A','workforce-read-fixture-a','active'),
  (pg_temp.id(2),'Workforce read B','workforce-read-fixture-b','active');
insert into public.facilities(id,organization_id,name,facility_type) values
  (pg_temp.id(11),pg_temp.id(1),'Workforce read facility A','PCH'),
  (pg_temp.id(12),pg_temp.id(2),'Workforce read facility B','PCH');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,
  email_change_token_new,email_change,email_change_token_current,reauthentication_token,is_sso_user,is_anonymous)
select '00000000-0000-0000-0000-000000000000',pg_temp.id(n),'authenticated','authenticated',
  'workforce-read-'||n||'@fixture.test','x',now(),jsonb_build_object('role',fixture_role,'organization_id',fixture_org),
  '{}',now(),now(),'','','','','','',false,false
from (values(101,'platform_admin',null::uuid),(102,'org_admin',pg_temp.id(1)),
  (103,'employee',pg_temp.id(1)),(104,'org_admin',pg_temp.id(2))) v(n,fixture_role,fixture_org);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,first_name,last_name,email,role,is_active)
select pg_temp.id(n),fixture_org,'Workforce',n::text,'workforce-read-'||n||'@fixture.test',fixture_role,true
from (values(101,'platform_admin',null::uuid),(102,'org_admin',pg_temp.id(1)),
  (103,'employee',pg_temp.id(1)),(104,'org_admin',pg_temp.id(2))) v(n,fixture_role,fixture_org)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','',true);
insert into public.employees(id,organization_id,facility_id,profile_id,first_name,last_name,job_title,status,hire_date) values
  (pg_temp.id(201),pg_temp.id(1),pg_temp.id(11),pg_temp.id(103),'Worker','One','Aide','active',public.pa_today()-60),
  (pg_temp.id(202),pg_temp.id(1),pg_temp.id(11),null,'Worker','Two','Aide','active',public.pa_today()-60),
  (pg_temp.id(203),pg_temp.id(2),pg_temp.id(12),null,'Worker','Other tenant','Aide','active',public.pa_today()-60);

-- More than fifty uniquely ordered events prove the retained recent-history limit.
insert into public.employment_lifecycle_events(id,organization_id,facility_id,person_id,employee_id,
  event_type,from_status,to_status,effective_on,reason,created_at)
select pg_temp.id(300+n),pg_temp.id(1),pg_temp.id(11),l.person_id,pg_temp.id(201),
  'hired',null,'active',public.pa_today(),'Fixture transition '||n,now()+n*interval '1 minute'
from public.workforce_employee_links l cross join generate_series(1,52) n
where l.employee_id=pg_temp.id(201) and l.effective_to is null;
insert into public.employment_episodes(id,organization_id,facility_id,person_id,employee_id,
  started_on,ended_on,episode_status,end_reason)
select pg_temp.id(390),pg_temp.id(1),pg_temp.id(11),person_id,pg_temp.id(201),
  public.pa_today()-100,public.pa_today()-80,'closed','Prior fixture episode'
from public.workforce_employee_links where employee_id=pg_temp.id(201) and effective_to is null;
insert into public.employee_access_suspensions(id,organization_id,facility_id,employee_id,profile_id,
  suspension_type,effective_from,effective_to,reason,profile_was_active,created_by_event_id,released_by_event_id) values
  (pg_temp.id(401),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),pg_temp.id(103),'manual',
    now()+interval '1 day',null,'Scheduled fixture suspension',true,pg_temp.id(301),null),
  (pg_temp.id(402),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),pg_temp.id(103),'leave',
    now()-interval '2 days',now()-interval '1 day','Closed fixture suspension',true,pg_temp.id(301),pg_temp.id(302));
insert into public.workforce_backfill_exceptions(id,organization_id,employee_id,exception_code,status,resolved_at,created_at) values
  (pg_temp.id(411),pg_temp.id(1),pg_temp.id(201),'fixture_a_open','open',null,now()-interval '3 minutes'),
  (pg_temp.id(412),pg_temp.id(2),pg_temp.id(203),'fixture_b_open','open',null,now()-interval '2 minutes'),
  (pg_temp.id(413),pg_temp.id(1),pg_temp.id(201),'fixture_a_closed','resolved',now(),now()-interval '1 minute');
insert into public.compliance_profile_resolution_exceptions(id,organization_id,facility_id,employee_id,
  exception_code,status,resolved_at,created_at) values
  (pg_temp.id(421),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'fixture_a_open','open',null,now()-interval '3 minutes'),
  (pg_temp.id(422),pg_temp.id(2),pg_temp.id(12),pg_temp.id(203),'fixture_b_open','open',null,now()-interval '2 minutes'),
  (pg_temp.id(423),pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),'fixture_a_closed','resolved',now(),now()-interval '1 minute');

-- Force SQL current_date to differ from the Pennsylvania day at any execution time.
-- Two future and two expired assignments make either wrong-day direction observable.
do $$
begin
  perform set_config('TimeZone',case when (now() at time zone 'Pacific/Kiritimati')::date<>public.pa_today()
    then 'Pacific/Kiritimati' else 'Etc/GMT+12' end,true);
end;
$$;
insert into public.compliance_profile_definitions(id,organization_id,code,name,profile_kind)
select pg_temp.id(n),pg_temp.id(1),'fixture.workforce.'||n,'Fixture extension '||n,'extension'
from generate_series(501,505) n;
insert into public.employee_compliance_profile_assignments(organization_id,facility_id,employee_id,
  profile_definition_id,effective_from,effective_to)
select pg_temp.id(1),pg_temp.id(11),pg_temp.id(201),pg_temp.id(n),
  case when n=501 then public.pa_today() when n<504 then public.pa_today()+1 else public.pa_today()-2 end,
  case when n=501 then public.pa_today()+1 when n<504 then null else public.pa_today() end
from generate_series(501,505) n;

select pg_temp.act_as(pg_temp.id(102));
insert into workforce_reads values('org-a',public.get_workforce_compliance_control_plane());
select isnt(current_date,public.pa_today(),'fixture database day differs from the governing facility day');
select is(pg_temp.observed('org-a')->'summary',
  '{"people":2,"activeEpisodes":2,"openAccessSuspensions":1,"activeComplianceAssignments":3}'::jsonb,
  'tenant summary preserves active episodes, open suspension semantics and local-day assignment boundaries');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.observed('org-a')) k),
  array['complianceExceptions','recentTransitions','summary','workforceExceptions']::text[],'all four response sections remain present');
select is(jsonb_path_query_array(pg_temp.observed('org-a'),'$.workforceExceptions[*].id'),jsonb_build_array(pg_temp.id(411)),
  'only current tenant open workforce exceptions are exposed');
select is(jsonb_path_query_array(pg_temp.observed('org-a'),'$.complianceExceptions[*].id'),jsonb_build_array(pg_temp.id(421)),
  'only current tenant open compliance exceptions are exposed');
select is(jsonb_array_length(pg_temp.observed('org-a')->'recentTransitions'),50,'recent evidence keeps the existing fifty-row limit');
select is(jsonb_path_query_array(pg_temp.observed('org-a'),'$.recentTransitions[*].id'),
  (select jsonb_agg(pg_temp.id(300+n) order by n desc) from generate_series(3,52) n),'recent evidence retains newest-first ordering');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.observed('org-a')->'recentTransitions'->0) k),
  array['created_at','effective_on','employee_id','event_type','from_status','id','reason','to_status']::text[],
  'transition projection retains its complete public contract');
reset role;
select pg_temp.act_as(pg_temp.id(104));
insert into workforce_reads values('org-b',public.get_workforce_compliance_control_plane());
select is(pg_temp.observed('org-b')->'summary',
  '{"people":1,"activeEpisodes":1,"openAccessSuspensions":0,"activeComplianceAssignments":1}'::jsonb,'the other tenant cannot count first-tenant evidence');
select is(jsonb_path_query_array(pg_temp.observed('org-b'),'$.workforceExceptions[*].id'),jsonb_build_array(pg_temp.id(412)),
  'second-tenant management sees only its own workforce exception');
reset role;
select pg_temp.act_as(pg_temp.id(103));
insert into workforce_reads values('own-person',public.get_workforce_compliance_control_plane());
select is(pg_temp.observed('own-person')->'summary',
  '{"people":1,"activeEpisodes":0,"openAccessSuspensions":0,"activeComplianceAssignments":0}'::jsonb,
  'an employee without scoped permissions retains only the own-person count');
select is(pg_temp.observed('own-person')-'summary',
  '{"workforceExceptions":[],"complianceExceptions":[],"recentTransitions":[]}'::jsonb,'own-person access reveals no management or evidence rows');
reset role;

insert into public.role_templates(id,code,name) values(pg_temp.id(601),'fixture.workforce-reader','Fixture workforce reader');
insert into public.role_template_permissions(role_template_id,permission_key) values
  (pg_temp.id(601),'workforce.lifecycle.read'),(pg_temp.id(601),'workforce.compliance.read'),(pg_temp.id(601),'workforce.evidence.read');
insert into public.enterprise_access_grants(id,membership_id,role_template_id,effective_from)
select pg_temp.id(611),id,pg_temp.id(601),now() from public.enterprise_scope_memberships
where profile_id=pg_temp.id(103) and scope_type='organization' and effective_to is null;
select pg_temp.act_as(pg_temp.id(103));
insert into workforce_reads values('read-only',public.get_workforce_compliance_control_plane());
select is(pg_temp.observed('read-only')->'summary',pg_temp.observed('org-a')->'summary','explicit scoped permission works independently of the legacy employee role');
select is(pg_temp.observed('read-only')->'recentTransitions',pg_temp.observed('org-a')->'recentTransitions','evidence permission exposes exactly the authorized transition projection');
select is(pg_temp.observed('read-only')->'workforceExceptions','[]'::jsonb,'lifecycle read permission cannot reveal lifecycle management exceptions');
select is(pg_temp.observed('read-only')->'complianceExceptions','[]'::jsonb,'compliance read permission cannot reveal compliance management exceptions');
reset role;
update public.role_templates set is_active=false where id=pg_temp.id(601);
select pg_temp.act_as(pg_temp.id(103));
select is(public.get_workforce_compliance_control_plane(),pg_temp.observed('own-person'),'disabling the authorizing template retires all delegated results');
reset role;
update public.role_templates set is_active=true where id=pg_temp.id(601);
update public.permission_definitions set is_active=false where permission_key in('workforce.lifecycle.read','workforce.compliance.read','workforce.evidence.read');
select pg_temp.act_as(pg_temp.id(103));
select is(public.get_workforce_compliance_control_plane(),pg_temp.observed('own-person'),'disabled permission definitions confer no authority');
reset role;
update public.permission_definitions set is_active=true where permission_key in('workforce.lifecycle.read','workforce.compliance.read','workforce.evidence.read');
update public.enterprise_access_grants set effective_from=now()+interval '1 day' where id=pg_temp.id(611);
select pg_temp.act_as(pg_temp.id(103));
select is(public.get_workforce_compliance_control_plane(),pg_temp.observed('own-person'),'a future permission grant cannot authorize current results');
reset role;
update public.enterprise_access_grants set effective_from=now(),effective_to=now() where id=pg_temp.id(611);
select pg_temp.act_as(pg_temp.id(103));
select is(public.get_workforce_compliance_control_plane(),pg_temp.observed('own-person'),'a grant ending now no longer authorizes results');
reset role;
update public.enterprise_access_grants set effective_to=null where id=pg_temp.id(611);
update public.facilities set is_active=false where id=pg_temp.id(11);
select pg_temp.act_as(pg_temp.id(103));
select is(public.get_workforce_compliance_control_plane()->'summary',
  '{"people":2,"activeEpisodes":0,"openAccessSuspensions":0,"activeComplianceAssignments":0}'::jsonb,
  'an inactive facility hides facility-scoped aggregates while organization person authority remains');
reset role;
update public.facilities set is_active=true where id=pg_temp.id(11);
update public.enterprise_portfolios set status='inactive' where id=(select portfolio_id from public.enterprise_organization_memberships
  where organization_id=pg_temp.id(1) and effective_to is null);
select pg_temp.act_as(pg_temp.id(103));
select is(public.get_workforce_compliance_control_plane(),pg_temp.observed('own-person'),'an inactive parent hierarchy removes scoped authority without removing the own person');
reset role;
update public.enterprise_portfolios set status='active' where id=(select portfolio_id from public.enterprise_organization_memberships
  where organization_id=pg_temp.id(1) and effective_to is null);
update public.enterprise_scope_memberships set effective_to=now() where profile_id=pg_temp.id(103) and effective_to is null;
select pg_temp.act_as(pg_temp.id(103));
select is(public.get_workforce_compliance_control_plane(),pg_temp.observed('own-person'),'an expired membership invalidates its still-open grant');
reset role;
select pg_temp.act_as(pg_temp.id(101));
select ok(jsonb_path_query_array(public.get_workforce_compliance_control_plane(),'$.workforceExceptions[*].id')
  @>jsonb_build_array(pg_temp.id(411),pg_temp.id(412)),'actual platform permissions include both tenants');
reset role;
update public.enterprise_access_grants set effective_to=now() where membership_id in(
  select id from public.enterprise_scope_memberships where profile_id=pg_temp.id(101)) and effective_to is null;
select pg_temp.act_as(pg_temp.id(101));
select is(public.get_workforce_compliance_control_plane()->'summary',
  '{"people":0,"activeEpisodes":0,"openAccessSuspensions":0,"activeComplianceAssignments":0}'::jsonb,
  'a raw platform role cannot replace expired authorizing grants');
reset role;
select set_config('app.privileged_write','on',true);
update public.profiles set is_active=false where id=pg_temp.id(103);
select set_config('app.privileged_write','',true);
select pg_temp.act_as(pg_temp.id(103));
select throws_ok('select public.get_workforce_compliance_control_plane()','42501','An active authenticated profile is required','a disabled profile remains rejected');
reset role;
select pg_temp.act_as(pg_temp.id(101));
update public.organizations set subscription_status='suspended' where id=pg_temp.id(1);
reset role;
select pg_temp.act_as(pg_temp.id(102));
select throws_ok('select public.get_workforce_compliance_control_plane()','42501','An active authenticated profile is required','a suspended caller organization remains rejected');
reset role;

select * from finish();
rollback;
