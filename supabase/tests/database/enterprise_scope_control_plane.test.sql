begin;
select plan(36);

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e9270922-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(profile_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', profile_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end;
$$;
create temporary table scope_reads(label text primary key, result jsonb not null);
grant select, insert on scope_reads to authenticated;
create function pg_temp.observed(read_label text) returns jsonb language sql stable as $$
  select result from pg_temp.scope_reads where label = read_label;
$$;

select ok(has_function_privilege('authenticated', 'public.get_enterprise_scope_control_plane()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_enterprise_scope_control_plane()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_enterprise_scope_control_plane()', 'EXECUTE'),
  'control-plane execution remains authenticated-only');
select ok(not has_schema_privilege('authenticated', 'app_private', 'USAGE')
  and not has_function_privilege('authenticated', 'app_private.scope_contains(text,uuid,text,uuid,timestamptz)', 'EXECUTE'),
  'scope helpers remain inaccessible to authenticated callers');
set local role anon;
select throws_ok('select public.get_enterprise_scope_control_plane()', '42501', null,
  'anonymous callers cannot execute the control plane');
reset role;
select pg_temp.act_as(null);
select throws_ok('select public.get_enterprise_scope_control_plane()', '42501', 'An active authenticated profile is required',
  'an authenticated database role without a subject is rejected');
reset role;

insert into public.organizations(id, name, slug, subscription_status) values
  (pg_temp.id(1), 'Scope control fixture A', 'scope-control-fixture-a', 'active'),
  (pg_temp.id(2), 'Scope control fixture B', 'scope-control-fixture-b', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  (pg_temp.id(11), pg_temp.id(1), 'Scope control facility A', 'PCH');
insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token,
  recovery_token, email_change_token_new, email_change, email_change_token_current,
  reauthentication_token, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', pg_temp.id(n), 'authenticated', 'authenticated',
  'scope-control-' || n || '@fixture.test', 'x', now(),
  jsonb_build_object('role', fixture_role, 'organization_id', fixture_org), '{}'::jsonb,
  now(), now(), '', '', '', '', '', '', false, false
from (values (101, 'platform_admin', null::uuid), (102, 'org_admin', pg_temp.id(1)),
  (103, 'employee', pg_temp.id(1)), (104, 'org_admin', pg_temp.id(2))) v(n, fixture_role, fixture_org);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, first_name, last_name, email, role, is_active)
select pg_temp.id(n), fixture_org, 'Scope', n::text, 'scope-control-' || n || '@fixture.test', fixture_role, true
from (values (101, 'platform_admin', null::uuid), (102, 'org_admin', pg_temp.id(1)),
  (103, 'employee', pg_temp.id(1)), (104, 'org_admin', pg_temp.id(2))) v(n, fixture_role, fixture_org)
on conflict (id) do update set organization_id=excluded.organization_id, role=excluded.role, is_active=true;
select set_config('app.privileged_write', '', true);
insert into public.enterprise_scope_backfill_exceptions(id, profile_id, organization_id, exception_code, details, status, resolved_at, created_at) values
  (pg_temp.id(301), pg_temp.id(102), pg_temp.id(1), 'fixture_open_a', '{"fixture":"A"}', 'open', null, now()-interval '4 minutes'),
  (pg_temp.id(302), pg_temp.id(104), pg_temp.id(2), 'fixture_open_b', '{"fixture":"B"}', 'open', null, now()-interval '3 minutes'),
  (pg_temp.id(303), pg_temp.id(101), null, 'fixture_open_platform', '{"fixture":"platform"}', 'open', null, now()-interval '2 minutes'),
  (pg_temp.id(304), pg_temp.id(102), pg_temp.id(1), 'fixture_resolved_a', '{}', 'resolved', now(), now()-interval '1 minute');

select pg_temp.act_as(pg_temp.id(102));
insert into scope_reads values ('org-a', public.get_enterprise_scope_control_plane());
select is(pg_temp.observed('org-a')->'summary', '{"portfolios":0,"regions":0,"organizations":1,"activeGrants":2}'::jsonb,
  'organization admin sees its own hierarchy membership and grants, not parent or foreign scopes');
select is(pg_temp.observed('org-a')->'exceptions', jsonb_build_array(jsonb_build_object(
  'id', pg_temp.id(301), 'profileId', pg_temp.id(102), 'organizationId', pg_temp.id(1),
  'code', 'fixture_open_a', 'details', '{"fixture":"A"}'::jsonb, 'status', 'open', 'createdAt', now()-interval '4 minutes')),
  'organization management exposes only its open exception with all existing fields');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.observed('org-a')) k),
  array['effectiveAccess','exceptions','summary']::text[], 'response top-level shape is unchanged');
select is(pg_temp.observed('org-a')->'effectiveAccess',
  (select jsonb_agg(to_jsonb(a) order by a.permission_key,a.scope_type) from public.get_effective_access(now()) a),
  'effectiveAccess preserves the complete public access read model');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.observed('org-a')->'effectiveAccess') a
  where (select array_agg(k order by k) from jsonb_object_keys(a) k)
    <> array['effective_from','effective_to','permission_key','role_template_code','scope_id','scope_type']::text[]),
  'every effective access row retains all six contract keys');
select ok(exists(select 1 from jsonb_array_elements(pg_temp.observed('org-a')->'effectiveAccess') a
  where a->>'permission_key'='workforce.lifecycle.read' and a->>'scope_id'=pg_temp.id(1)::text
    and a->>'scope_type'='organization' and a->>'role_template_code'='builtin.org_admin'),
  'effectiveAccess retains non-enterprise permissions and their scope/template identity');
reset role;

select pg_temp.act_as(pg_temp.id(103));
insert into scope_reads values ('employee', public.get_enterprise_scope_control_plane());
select is(pg_temp.observed('employee')->'summary', '{"portfolios":0,"regions":0,"organizations":0,"activeGrants":1}'::jsonb,
  'an employee without enterprise permissions still sees the count of their own active grant');
select is(pg_temp.observed('employee')->'exceptions', '[]'::jsonb, 'own grant visibility does not reveal management exceptions');
select is(pg_temp.observed('employee')->'effectiveAccess', '[]'::jsonb, 'a permissionless built-in employee grant confers no permission rows');
reset role;
select pg_temp.act_as(pg_temp.id(104));
insert into scope_reads values ('org-b', public.get_enterprise_scope_control_plane());
select is(pg_temp.observed('org-b')->'summary', '{"portfolios":0,"regions":0,"organizations":1,"activeGrants":1}'::jsonb,
  'the second tenant cannot count first-tenant grants');
select is(jsonb_path_query_array(pg_temp.observed('org-b'), '$.exceptions[*].id'), jsonb_build_array(pg_temp.id(302)),
  'the second tenant sees only its own open exception');
reset role;

select pg_temp.act_as(pg_temp.id(101));
insert into scope_reads values ('platform', public.get_enterprise_scope_control_plane());
select ok(jsonb_path_query_array(pg_temp.observed('platform'), '$.exceptions[*].id') @>
  jsonb_build_array(pg_temp.id(301),pg_temp.id(302),pg_temp.id(303)),
  'actual platform management permission reveals both tenant and NULL-organization exceptions');
select ok(not (jsonb_path_query_array(pg_temp.observed('platform'), '$.exceptions[*].id') @> jsonb_build_array(pg_temp.id(304))),
  'resolved exceptions remain hidden from platform managers');
reset role;
update public.enterprise_portfolios set status='inactive' where id=(
  select portfolio_id from public.enterprise_organization_memberships where organization_id=pg_temp.id(2) and effective_to is null);
select pg_temp.act_as(pg_temp.id(101));
insert into scope_reads values ('inactive-target', public.get_enterprise_scope_control_plane());
select is((pg_temp.observed('inactive-target')#>>'{summary,portfolios}')::integer,
  (pg_temp.observed('platform')#>>'{summary,portfolios}')::integer-1, 'an inactive target portfolio is not counted');
select is((pg_temp.observed('inactive-target')#>>'{summary,regions}')::integer,
  (pg_temp.observed('platform')#>>'{summary,regions}')::integer-1, 'an inactive parent removes its region from the authorized summary');
select is((pg_temp.observed('inactive-target')#>>'{summary,organizations}')::integer,
  (pg_temp.observed('platform')#>>'{summary,organizations}')::integer-1, 'target operationality excludes its organization membership');
select ok(jsonb_path_query_array(pg_temp.observed('inactive-target'), '$.exceptions[*].id') @> jsonb_build_array(pg_temp.id(302)),
  'platform management still sees open remediation exceptions for inactive targets');
reset role;
select pg_temp.act_as(pg_temp.id(104));
insert into scope_reads values ('inactive-own-scope', public.get_enterprise_scope_control_plane());
select is(pg_temp.observed('inactive-own-scope')->'summary', '{"portfolios":0,"regions":0,"organizations":0,"activeGrants":1}'::jsonb,
  'inactive scope blocks delegated authority but does not hide the callers own current grant');
select is(pg_temp.observed('inactive-own-scope')->'effectiveAccess', pg_temp.observed('org-b')->'effectiveAccess',
  'effectiveAccess retains current grant rows even when their target becomes nonoperational');
reset role;
update public.enterprise_portfolios set status='active' where id=(
  select portfolio_id from public.enterprise_organization_memberships where organization_id=pg_temp.id(2) and effective_to is null);
update public.enterprise_organization_memberships set effective_to=now() where organization_id=pg_temp.id(2) and effective_to is null;
select pg_temp.act_as(pg_temp.id(101));
insert into scope_reads values ('expired-hierarchy', public.get_enterprise_scope_control_plane());
select is((pg_temp.observed('expired-hierarchy')#>>'{summary,organizations}')::integer,
  (pg_temp.observed('platform')#>>'{summary,organizations}')::integer-1, 'expired organization memberships are not counted');
reset role;
update public.enterprise_access_grants set effective_to=now() where membership_id in (
  select id from public.enterprise_scope_memberships where profile_id=pg_temp.id(101)) and effective_to is null;
select pg_temp.act_as(pg_temp.id(101));
insert into scope_reads values ('platform-without-grant', public.get_enterprise_scope_control_plane());
select is(pg_temp.observed('platform-without-grant')->'summary', '{"portfolios":0,"regions":0,"organizations":0,"activeGrants":0}'::jsonb,
  'a raw platform role cannot replace an expired enterprise permission grant');
select is(pg_temp.observed('platform-without-grant')->'exceptions', '[]'::jsonb, 'expired platform management cannot read NULL or tenant exceptions');
select is(pg_temp.observed('platform-without-grant')->'effectiveAccess', '[]'::jsonb, 'expired grants are absent from effectiveAccess');
reset role;

-- A custom current grant exercises template and permission activation separately.
insert into public.role_templates(id,code,name) values(pg_temp.id(201),'fixture.control-plane','Fixture enterprise reader');
insert into public.role_template_permissions(role_template_id,permission_key) values
  (pg_temp.id(201),'enterprise.scope.read'),(pg_temp.id(201),'enterprise.scope.manage');
insert into public.enterprise_access_grants(id,membership_id,role_template_id,effective_from)
select pg_temp.id(211),id,pg_temp.id(201),now() from public.enterprise_scope_memberships
where profile_id=pg_temp.id(103) and scope_type='organization' and effective_to is null;
select pg_temp.act_as(pg_temp.id(103));
insert into scope_reads values ('custom-current', public.get_enterprise_scope_control_plane());
select is(pg_temp.observed('custom-current')->'summary', '{"portfolios":0,"regions":0,"organizations":1,"activeGrants":3}'::jsonb,
  'a current custom grant confers the scoped permission regardless of legacy employee role');
reset role;
update public.role_templates set is_active=false where id=pg_temp.id(201);
select pg_temp.act_as(pg_temp.id(103));
insert into scope_reads values ('disabled-template', public.get_enterprise_scope_control_plane());
select is(pg_temp.observed('disabled-template')->'summary', '{"portfolios":0,"regions":0,"organizations":0,"activeGrants":2}'::jsonb,
  'disabled templates confer no authority while own active grant counts remain intact');
select is(pg_temp.observed('disabled-template')->'effectiveAccess', '[]'::jsonb, 'disabled templates contribute no effective permission rows');
reset role;
update public.role_templates set is_active=true where id=pg_temp.id(201);
update public.permission_definitions set is_active=false where permission_key in ('enterprise.scope.read','enterprise.scope.manage');
select pg_temp.act_as(pg_temp.id(103));
insert into scope_reads values ('disabled-permissions', public.get_enterprise_scope_control_plane());
select is(pg_temp.observed('disabled-permissions')->'summary', '{"portfolios":0,"regions":0,"organizations":0,"activeGrants":2}'::jsonb,
  'inactive permission definitions cannot authorize summaries through an active template');
select is(pg_temp.observed('disabled-permissions')->'exceptions', '[]'::jsonb, 'inactive management permission cannot reveal exceptions');
reset role;
update public.permission_definitions set is_active=true where permission_key in ('enterprise.scope.read','enterprise.scope.manage');
update public.enterprise_scope_memberships set effective_to=now() where profile_id=pg_temp.id(103) and effective_to is null;
select pg_temp.act_as(pg_temp.id(103));
insert into scope_reads values ('expired-membership', public.get_enterprise_scope_control_plane());
select is(pg_temp.observed('expired-membership')->'summary', '{"portfolios":0,"regions":0,"organizations":0,"activeGrants":0}'::jsonb,
  'an expired membership hides its grants even if their individual windows remain open');
select is(pg_temp.observed('expired-membership')->'effectiveAccess', '[]'::jsonb, 'expired memberships contribute no effective permission rows');
reset role;
select set_config('app.privileged_write', 'on', true);
update public.profiles set is_active=false where id=pg_temp.id(103);
select set_config('app.privileged_write', '', true);
select pg_temp.act_as(pg_temp.id(103));
select throws_ok('select public.get_enterprise_scope_control_plane()', '42501', 'An active authenticated profile is required',
  'a disabled profile cannot inspect the control plane with an old subject claim');
reset role;
update public.organizations set subscription_status='suspended' where id=pg_temp.id(1);
select pg_temp.act_as(pg_temp.id(102));
select throws_ok('select public.get_enterprise_scope_control_plane()', '42501', 'An active authenticated profile is required',
  'a suspended caller organization cannot inspect the control plane');
reset role;

select * from finish();
rollback;
