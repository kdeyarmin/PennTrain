-- Governed content has an entry point (migration 20260804130000).
--
-- `phase4_governed_learning.test.sql` already walks the four-step publication control, but it does
-- so after inserting a `governed_content_assets` row directly as superuser -- which is precisely
-- what production could not do. This suite drives registration as a real authenticated user, and
-- then confirms the lifecycle the client now calls actually runs from that starting point.

begin;
select plan(15);

select has_function('public', 'register_governed_content_asset', array['text', 'uuid', 'text'],
  'a course can be brought under governance');
select ok(not has_function_privilege('anon', 'public.register_governed_content_asset(text,uuid,text)', 'EXECUTE'),
  'anonymous registration is closed');

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('cf000000-0000-4000-8000-000000000001'::uuid, 'Governed Org', 'governed-org', 'active');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, 'x', now(),
  '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
from (values
  ('cf000000-0000-4000-8000-000000000101'::uuid, 'gc-author@test.local'),
  ('cf000000-0000-4000-8000-000000000102'::uuid, 'gc-reviewer@test.local')) v(id, email);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('cf000000-0000-4000-8000-000000000101', 'cf000000-0000-4000-8000-000000000001', 'gc-author@test.local', 'Ann', 'Author', 'org_admin', true),
  ('cf000000-0000-4000-8000-000000000102', 'cf000000-0000-4000-8000-000000000001', 'gc-reviewer@test.local', 'Rex', 'Reviewer', 'org_admin', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;

insert into public.courses(id, organization_id, title, status, created_by) values
  ('cf000000-0000-4000-8000-000000000301', 'cf000000-0000-4000-8000-000000000001', 'Dementia care basics', 'draft', 'cf000000-0000-4000-8000-000000000101');
insert into public.course_versions(id, course_id, organization_id, version_number, title, status) values
  ('cf000000-0000-4000-8000-000000000302', 'cf000000-0000-4000-8000-000000000301', 'cf000000-0000-4000-8000-000000000001', 1, 'Dementia care basics v1', 'draft');
insert into public.course_blocks(course_version_id, organization_id, block_type, sort_order, title, body) values
  ('cf000000-0000-4000-8000-000000000302', 'cf000000-0000-4000-8000-000000000001', 'text', 0, 'Wandering response', '{"content":"Check the exit log first"}');
update public.course_versions set status = 'published', published_at = now()
where id = 'cf000000-0000-4000-8000-000000000302';
update public.courses set current_version_id = 'cf000000-0000-4000-8000-000000000302', status = 'published'
where id = 'cf000000-0000-4000-8000-000000000301';
-- A platform catalogue course: no organization, governed by the platform rather than a tenant.
insert into public.courses(id, organization_id, title, status) values
  ('cf000000-0000-4000-8000-000000000311', null, 'Platform catalogue course', 'draft');
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create temporary table gc_ids(key text primary key, id uuid) on commit drop;
grant all on gc_ids to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Registration: the step that did not exist
-- ---------------------------------------------------------------------------

select pg_temp.act_as('cf000000-0000-4000-8000-000000000101');

select throws_like($$select public.register_governed_content_asset('policy', 'cf000000-0000-4000-8000-000000000301')$$,
  '%Only course content%',
  'an asset type with no authoring surface is refused by name, not accepted and left unrevisable');

select throws_ok($$select public.register_governed_content_asset('course', 'cf000000-0000-4000-8000-000000000999')$$,
  'P0002', null,
  'a course that does not exist is refused');

select throws_like($$select public.register_governed_content_asset('course', 'cf000000-0000-4000-8000-000000000311')$$,
  '%governed by the platform%',
  'a tenant cannot bring a platform catalogue course under its own governance');

insert into gc_ids values('asset', public.register_governed_content_asset('course', 'cf000000-0000-4000-8000-000000000301'));
select isnt((select id from gc_ids where key = 'asset'), null,
  'a course registers, and production can now reach a governed asset at all');

select is(
  (select title from public.governed_content_assets where id = (select id from gc_ids where key = 'asset')),
  'Dementia care basics',
  'and it takes the course title when none is supplied');

-- Registering twice is a statement about the course, not a second event.
select is(
  public.register_governed_content_asset('course', 'cf000000-0000-4000-8000-000000000301', 'Dementia care basics (2026)'),
  (select id from gc_ids where key = 'asset'),
  'registering an already-governed course returns the same asset rather than raising');

select is((select count(*)::integer from public.governed_content_assets
  where source_id = 'cf000000-0000-4000-8000-000000000301'), 1,
  'and does not create a second asset for the same course');

select is(
  (select title from public.governed_content_assets where id = (select id from gc_ids where key = 'asset')),
  'Dementia care basics (2026)',
  'a supplied title replaces the inherited one');

-- ---------------------------------------------------------------------------
-- The lifecycle the client now drives, from that starting point
-- ---------------------------------------------------------------------------

insert into gc_ids values('revision', public.create_governed_content_revision(
  (select id from gc_ids where key = 'asset'),
  'cf000000-0000-4000-8000-000000000302',
  'Reworked the wandering-response section after the 2800 citation',
  true, 'reattest',
  '{"kind":"course_version","title":"Dementia care basics v1","blocks":[{"blockType":"text"}]}'::jsonb));

select is((select state from public.governed_content_revisions where id = (select id from gc_ids where key = 'revision')),
  'draft', 'a revision authors against the registered asset');

select lives_ok($$select public.submit_governed_content_revision(
  (select id from gc_ids where key = 'revision'), '[{"code":"no_assessment","severity":"warning","message":"No quiz block"}]'::jsonb)$$,
  'the author submits it with warnings attached, as the client sends them');

select throws_ok($$select public.submit_governed_content_revision(
  (select id from gc_ids where key = 'revision'), '[{"code":"no_blocks","severity":"error","message":"nothing to publish"}]'::jsonb)$$,
  '42501', null,
  'and a second submission of an in-review revision is refused');

reset role;
select pg_temp.act_as('cf000000-0000-4000-8000-000000000102');
select lives_ok($$select public.review_governed_content_revision(
  (select id from gc_ids where key = 'revision'), 'approve', 'Reviewed against 2800.104 wandering requirements')$$,
  'a second person approves it');

select is(
  public.publish_governed_content_revision((select id from gc_ids where key = 'revision'), 'Released for the August refresher'),
  (select id from gc_ids where key = 'revision'),
  'and publishes it -- the step that previously had no reachable input');

reset role;
select * from finish();
rollback;
