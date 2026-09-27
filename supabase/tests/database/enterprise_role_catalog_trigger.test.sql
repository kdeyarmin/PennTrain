begin;
select plan(27);

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e9271010-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(profile_id uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', profile_id, 'role', 'authenticated', 'aal', aal,
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end;
$$;
create temporary table catalog_fixture(label text primary key, value jsonb not null);
grant select, insert on catalog_fixture to authenticated;
create function pg_temp.rpc_template_id() returns uuid language sql stable as $$
  select (value #>> '{}')::uuid from pg_temp.catalog_fixture where label='rpc-template';
$$;

insert into public.organizations(id, name, slug, subscription_status) values
  (pg_temp.id(1), 'Role catalog fixture A', 'role-catalog-fixture-a', 'active'),
  (pg_temp.id(2), 'Role catalog fixture B', 'role-catalog-fixture-b', 'active');
insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token,
  recovery_token, email_change_token_new, email_change, email_change_token_current,
  reauthentication_token, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', pg_temp.id(n), 'authenticated', 'authenticated',
  'role-catalog-' || n || '@fixture.test', 'x', now(),
  jsonb_build_object('role', fixture_role, 'organization_id', pg_temp.id(1)), '{}'::jsonb,
  now(), now(), '', '', '', '', '', '', false, false
from (values (101, 'org_admin'), (102, 'employee')) v(n, fixture_role);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, first_name, last_name, email, role, is_active)
select pg_temp.id(n), pg_temp.id(1), 'Catalog', n::text, 'role-catalog-' || n || '@fixture.test', fixture_role, true
from (values (101, 'org_admin'), (102, 'employee')) v(n, fixture_role)
on conflict (id) do update set organization_id=excluded.organization_id, role=excluded.role, is_active=true;
select set_config('app.privileged_write', '', true);

insert into public.permission_definitions(permission_key, description) values
  ('fixture.catalog.read', 'Synthetic catalog reader'), ('fixture.catalog.write', 'Synthetic catalog writer');
insert into public.role_templates(id, organization_id, code, name) values
  (pg_temp.id(201), pg_temp.id(1), 'fixture.custom-a', 'Custom A'),
  (pg_temp.id(202), pg_temp.id(1), 'fixture.custom-b', 'Custom B');
insert into public.role_template_permissions(role_template_id, permission_key) values
  (pg_temp.id(201), 'fixture.catalog.read');
insert into catalog_fixture values ('builtins', jsonb_build_object(
  'templates', (select jsonb_agg(to_jsonb(rt) order by rt.id) from public.role_templates rt where is_system_managed),
  'permissions', (select jsonb_agg(to_jsonb(rtp) order by rtp.role_template_id,rtp.permission_key)
    from public.role_template_permissions rtp join public.role_templates rt on rt.id=rtp.role_template_id where rt.is_system_managed)));

-- Normal custom-row mutations must not access fields belonging to the other table.
select lives_ok($$update public.role_templates set name='Custom A edited',is_active=false where id=pg_temp.id(201)$$,
  'custom template metadata and activation can be updated');
select ok((select name='Custom A edited' and not is_active from public.role_templates where id=pg_temp.id(201)),
  'the custom template update persists');
select lives_ok($$update public.role_template_permissions set permission_key='fixture.catalog.write'
  where role_template_id=pg_temp.id(201) and permission_key='fixture.catalog.read'$$,
  'a custom permission row can change its permission');
select is((select permission_key from public.role_template_permissions where role_template_id=pg_temp.id(201)),
  'fixture.catalog.write', 'the custom permission edit persists');
select lives_ok($$update public.role_template_permissions set role_template_id=pg_temp.id(202)
  where role_template_id=pg_temp.id(201) and permission_key='fixture.catalog.write'$$,
  'a permission row may move between custom templates');
select lives_ok($$delete from public.role_template_permissions where role_template_id=pg_temp.id(202)$$,
  'custom permission rows can be deleted');
select is((select count(*)::integer from public.role_template_permissions where role_template_id in (pg_temp.id(201),pg_temp.id(202))),
  0, 'custom permission deletion removes the moved row');
select lives_ok($$delete from public.role_templates where id=pg_temp.id(202)$$,
  'an unreferenced custom template can be deleted');
select ok(not exists(select 1 from public.role_templates where id=pg_temp.id(202)), 'custom template deletion persists');

-- Assert the trigger error, not a later unique/FK constraint, for OLD and NEW protected identities.
select throws_ok($$update public.role_templates set name='Forbidden edit' where built_in_role='org_admin'$$,
  '42501', 'built-in role templates are immutable', 'existing built-in template metadata is immutable');
select throws_ok($$update public.role_templates set is_system_managed=false,built_in_role=null where built_in_role='org_admin'$$,
  '42501', 'built-in role templates are immutable', 'a built-in template cannot be demoted to bypass protection');
select throws_ok($$update public.role_templates set is_system_managed=true,built_in_role='employee',organization_id=null
  where id=pg_temp.id(201)$$, '42501', 'built-in role templates are immutable',
  'a custom template cannot become system managed through an update');
select throws_ok($$delete from public.role_templates where built_in_role='org_admin'$$,
  '42501', 'built-in role templates are immutable', 'built-in templates cannot be deleted');
select throws_ok($$update public.role_template_permissions set created_at=now()+interval '1 second'
  where role_template_id=(select id from public.role_templates where built_in_role='org_admin') and permission_key='enterprise.scope.read'$$,
  '42501', 'built-in role permissions are immutable', 'existing built-in permission rows cannot be edited');
select throws_ok($$update public.role_template_permissions set role_template_id=pg_temp.id(201)
  where role_template_id=(select id from public.role_templates where built_in_role='org_admin') and permission_key='enterprise.scope.read'$$,
  '42501', 'built-in role permissions are immutable', 'a built-in permission cannot be moved into a custom template');
insert into public.role_template_permissions(role_template_id,permission_key) values(pg_temp.id(201),'fixture.catalog.read');
select throws_ok($$update public.role_template_permissions
  set role_template_id=(select id from public.role_templates where built_in_role='employee')
  where role_template_id=pg_temp.id(201) and permission_key='fixture.catalog.read'$$,
  '42501', 'built-in role permissions are immutable',
  'a custom permission absent from the destination cannot be moved into a built-in template');
select throws_ok($$delete from public.role_template_permissions
  where role_template_id=(select id from public.role_templates where built_in_role='org_admin') and permission_key='enterprise.scope.read'$$,
  '42501', 'built-in role permissions are immutable', 'built-in permission rows cannot be deleted');
select is((select permission_key from public.role_template_permissions where role_template_id=pg_temp.id(201)),
  'fixture.catalog.read', 'denied permission moves leave the custom source row unchanged');
select is(jsonb_build_object(
  'templates', (select jsonb_agg(to_jsonb(rt) order by rt.id) from public.role_templates rt where is_system_managed),
  'permissions', (select jsonb_agg(to_jsonb(rtp) order by rtp.role_template_id,rtp.permission_key)
    from public.role_template_permissions rtp join public.role_templates rt on rt.id=rtp.role_template_id where rt.is_system_managed)),
  (select value from catalog_fixture where label='builtins'), 'all denied writes preserve the entire built-in catalog');

-- Exercise the actual application RPC: editing updates the template and replaces permission rows.
select pg_temp.act_as(pg_temp.id(101));
select lives_ok($$insert into catalog_fixture values('rpc-template',to_jsonb(public.upsert_enterprise_role_template(
  pg_temp.id(1),'fixture.rpc-role','RPC role','Created',array['enterprise.scope.read'],null)))$$,
  'an AAL2 organization admin can create a custom role through the public API');
select lives_ok($$select public.upsert_enterprise_role_template(pg_temp.id(1),'fixture.rpc-role-edited','RPC role edited',
  'Replaced permissions',array['workforce.lifecycle.read'],pg_temp.rpc_template_id())$$,
  'an AAL2 organization admin can edit a custom role and replace its permissions through the public API');
select is((select jsonb_build_object('code',rt.code,'name',rt.name,'description',rt.description,'permissions',
  (select jsonb_agg(permission_key order by permission_key) from public.role_template_permissions where role_template_id=rt.id))
  from public.role_templates rt where rt.id=pg_temp.rpc_template_id()),
  '{"code":"fixture.rpc-role-edited","name":"RPC role edited","description":"Replaced permissions","permissions":["workforce.lifecycle.read"]}'::jsonb,
  'API edit persists metadata and replaces rather than accumulates permissions');
reset role;
select pg_temp.act_as(pg_temp.id(101),'aal1');
select throws_ok($$select public.upsert_enterprise_role_template(pg_temp.id(1),'forbidden','Forbidden','',
  array['enterprise.scope.read'],pg_temp.rpc_template_id())$$, '42501', null, 'an AAL1 session cannot edit the custom role');
reset role;
select pg_temp.act_as(pg_temp.id(101));
select throws_ok($$select public.upsert_enterprise_role_template(pg_temp.id(2),'forbidden','Forbidden','',
  array['enterprise.scope.read'],null)$$, '42501', 'Not authorized to manage role templates',
  'the editable catalog does not authorize cross-organization role creation');
select throws_ok($$select public.upsert_enterprise_role_template(pg_temp.id(1),'forbidden','Forbidden','',
  array['fixture.catalog.read'],pg_temp.rpc_template_id())$$, '42501',
  'Cannot delegate permission fixture.catalog.read that the caller does not hold',
  'the caller cannot delegate a valid permission they do not hold');
reset role;
select pg_temp.act_as(pg_temp.id(102));
select throws_ok($$select public.upsert_enterprise_role_template(pg_temp.id(1),'forbidden','Forbidden','',
  array['enterprise.scope.read'],pg_temp.rpc_template_id())$$, '42501', 'Not authorized to manage role templates',
  'an employee without management permission cannot edit the custom role');
reset role;
select is((select jsonb_build_object('code',rt.code,'name',rt.name,'description',rt.description,'permissions',
  (select jsonb_agg(permission_key order by permission_key) from public.role_template_permissions where role_template_id=rt.id))
  from public.role_templates rt where rt.id=pg_temp.rpc_template_id()),
  '{"code":"fixture.rpc-role-edited","name":"RPC role edited","description":"Replaced permissions","permissions":["workforce.lifecycle.read"]}'::jsonb,
  'denied API edits preserve the last saved role and permission set');

select * from finish();
rollback;
