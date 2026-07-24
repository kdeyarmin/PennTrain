begin;
select plan(13);

-- PT-066: access matrix for the public regulatory-update feed and newsletter
-- capture (20260723120000). Anon reads published rows ONLY through the
-- list_regulatory_updates RPC; the tables themselves are closed to anon, and
-- newsletter subscribers are readable by platform admins alone.

select has_table('public','regulatory_updates','regulatory update feed table exists');
select has_table('public','newsletter_subscribers','newsletter subscriber table exists');
select has_function('public','list_regulatory_updates','public feed RPC exists');
select ok(has_function_privilege('anon','public.list_regulatory_updates(text,text,integer)','EXECUTE'),
  'anonymous visitors may execute the published-feed RPC');
select ok(not has_table_privilege('anon','public.regulatory_updates','SELECT'),
  'anonymous role has no direct grant on regulatory_updates');
select ok(not has_table_privilege('anon','public.newsletter_subscribers','SELECT'),
  'anonymous role has no direct grant on newsletter_subscribers');
select ok(not has_table_privilege('anon','public.newsletter_subscribers','INSERT'),
  'anonymous role cannot insert newsletter subscribers directly');

insert into public.organizations(id,name,slug,subscription_status) values
  ('78000000-0000-4000-8000-000000000001','Feed Org','feed-org','active');
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,recovery_token,email_change_token_new,email_change,
  email_change_token_current,reauthentication_token,is_sso_user,is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000','78000000-0000-4000-8000-000000000101','authenticated','authenticated','feed-admin@test.local','x',now(),'{}','{}',now(),now(),'','','','','','',false,false);
select set_config('app.privileged_write','on',true);
insert into public.profiles(id,organization_id,email,first_name,last_name,role,is_active) values
  ('78000000-0000-4000-8000-000000000101','78000000-0000-4000-8000-000000000001','feed-admin@test.local','Feed','Admin','org_admin',true)
on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true;
select set_config('app.privileged_write','off',true);

-- One draft and one published entry (unique slugs so migration seed rows never collide).
insert into public.regulatory_updates(slug,title,summary,category,status,published_at) values
  ('pgtap-draft-entry-do-not-publish','Draft entry for pgTAP','A draft entry that must never surface publicly.','update','draft',null),
  ('pgtap-published-entry','Published entry for pgTAP','A published entry the public feed must return.','update','published',now());
insert into public.newsletter_subscribers(email,name,status) values
  ('pgtap-subscriber@test.local','PgTap Subscriber','subscribed');

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

-- Anonymous visitor: the RPC returns published rows and hides drafts; direct
-- table reads are denied outright.
select pg_temp.act_as('00000000-0000-0000-0000-000000000000','anon');
select is((select count(*)::integer from public.list_regulatory_updates(null,null,200) u where u.slug='pgtap-published-entry'),
  1,'anon sees the published entry through the feed RPC');
select is((select count(*)::integer from public.list_regulatory_updates(null,null,200) u where u.slug='pgtap-draft-entry-do-not-publish'),
  0,'anon never sees draft entries through the feed RPC');
select throws_ok($$select count(*) from public.regulatory_updates$$,
  '42501',null,'anon cannot select the regulatory_updates table directly');
select throws_ok($$select count(*) from public.newsletter_subscribers$$,
  '42501',null,'anon cannot select newsletter_subscribers');

-- A signed-in customer (org_admin, not platform admin) is not an editor and
-- cannot read the subscriber list: the platform-admin-only policies yield zero rows.
select pg_temp.act_as('78000000-0000-4000-8000-000000000101');
select is((select count(*)::integer from public.newsletter_subscribers),
  0,'non-platform authenticated users cannot read newsletter subscribers');
select is((select count(*)::integer from public.regulatory_updates where slug like 'pgtap-%'),
  0,'non-platform authenticated users cannot read the editorial table directly');

select * from finish();
rollback;
