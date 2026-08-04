-- Adaptive learning paths have an entry point (migration 20260804140000).
--
-- `phase4_governed_learning.test.sql` exercises `evaluate_learning_path`, but only after inserting a
-- definition, a version and an assignment directly as superuser -- which is precisely what
-- production could not do: nothing anywhere wrote any of those three tables. This suite authors,
-- publishes and assigns as real authenticated users, and then confirms the evaluator runs from that
-- starting point.

begin;
select plan(22);

select has_function('public', 'save_learning_path_version', array['text', 'jsonb', 'text', 'uuid', 'uuid'],
  'a path version can be authored');
select has_function('public', 'publish_learning_path_version', array['uuid'],
  'a draft version can be published');
select has_function('public', 'assign_learning_path', array['uuid', 'uuid', 'timestamp with time zone'],
  'a published version can be assigned');
select ok(not has_function_privilege('anon', 'public.assign_learning_path(uuid,uuid,timestamptz)', 'EXECUTE'),
  'anonymous assignment is closed');

-- Fixtures --------------------------------------------------------------------------
insert into public.organizations(id, name, slug, subscription_status) values
  ('1a000000-0000-4000-8000-000000000001', 'Path Org', 'path-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('1a000000-0000-4000-8000-000000000011', '1a000000-0000-4000-8000-000000000001', 'Path Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, 'x', now(),
  '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
from (values
  ('1a000000-0000-4000-8000-000000000101'::uuid, 'path-admin@test.local'),
  ('1a000000-0000-4000-8000-000000000102'::uuid, 'path-learner@test.local')) v(id, email);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('1a000000-0000-4000-8000-000000000101', '1a000000-0000-4000-8000-000000000001', 'path-admin@test.local', 'Pia', 'Admin', 'org_admin', true),
  ('1a000000-0000-4000-8000-000000000102', '1a000000-0000-4000-8000-000000000001', 'path-learner@test.local', 'Leo', 'Learner', 'employee', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.employees(id, organization_id, facility_id, profile_id, first_name, last_name, job_title) values
  ('1a000000-0000-4000-8000-000000000201', '1a000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000011', '1a000000-0000-4000-8000-000000000102', 'Leo', 'Learner', 'Aide');

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create temporary table lp_ids(key text primary key, id uuid) on commit drop;
grant all on lp_ids to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Authoring: the definition checks that stop an unwalkable path being published
-- ---------------------------------------------------------------------------

select pg_temp.act_as('1a000000-0000-4000-8000-000000000101');

select throws_like($$select public.save_learning_path_version('Med', '{"steps":[]}'::jsonb)$$,
  '%assigns nobody anything%',
  'a path with no steps is refused');

select throws_like($$select public.save_learning_path_version('Medication path',
  '{"steps":[{"key":"foundation"},{"key":"foundation"}]}'::jsonb)$$,
  '%Duplicate step key%',
  'a duplicate step key is refused');

-- The reason this check exists: evaluate_learning_path reads a prerequisite's completion out of the
-- outcomes object and simply never finds one that is not a step, leaving the dependent step locked
-- forever with no way for anybody to tell why.
select throws_like($$select public.save_learning_path_version('Medication path',
  '{"steps":[{"key":"assessment","prerequisites":["orientation"]}]}'::jsonb)$$,
  '%not a step in this path%',
  'a prerequisite naming a step that does not exist is refused, not left permanently locked');

select throws_like($$select public.save_learning_path_version('Medication path',
  '{"steps":[{"key":"loop","prerequisites":["loop"]}]}'::jsonb)$$,
  '%cannot require itself%',
  'a step requiring itself is refused');

select throws_ok($$select public.save_learning_path_version('Medication path', '{"steps":{}}'::jsonb)$$,
  '22023', null,
  'a definition whose steps are not an array is refused');

insert into lp_ids values('version', public.save_learning_path_version(
  'Medication administration path',
  '{"steps":[{"key":"foundation","prerequisites":[]},{"key":"assessment","prerequisites":["foundation"],"threshold":80},{"key":"remediation","prerequisites":["assessment"]}]}'::jsonb,
  'Foundation, assessment, and a remedial branch'));

select is((select state from public.learning_path_versions where id = (select id from lp_ids where key = 'version')),
  'draft', 'a new version starts as a draft');

select is(
  (select definition_sha256 from public.learning_path_versions where id = (select id from lp_ids where key = 'version')),
  encode(extensions.digest(convert_to((select definition::text from public.learning_path_versions
    where id = (select id from lp_ids where key = 'version')), 'utf8'), 'sha256'), 'hex'),
  'and its checksum is derived from the stored definition rather than supplied');

-- ---------------------------------------------------------------------------
-- Publication is the freeze point
-- ---------------------------------------------------------------------------

select throws_like($$select public.assign_learning_path('1a000000-0000-4000-8000-000000000201',
  (select id from lp_ids where key = 'version'))$$,
  '%published path version%',
  'a draft cannot be assigned, because its steps can still change');

select lives_ok($$select public.publish_learning_path_version((select id from lp_ids where key = 'version'))$$,
  'the draft publishes');

select is((select state from public.learning_path_versions where id = (select id from lp_ids where key = 'version')),
  'published', 'and reaches published');

select throws_like($$select public.publish_learning_path_version((select id from lp_ids where key = 'version'))$$,
  '%Only a draft version%',
  'publishing twice is refused');

-- ---------------------------------------------------------------------------
-- Assignment: the step that makes evaluate_learning_path reachable at all
-- ---------------------------------------------------------------------------

select throws_ok($$select public.assign_learning_path('1a000000-0000-4000-8000-000000000201',
  (select id from lp_ids where key = 'version'), now() - interval '1 day')$$,
  '22023', null,
  'a due date in the past is refused');

insert into lp_ids values('assignment', public.assign_learning_path(
  '1a000000-0000-4000-8000-000000000201', (select id from lp_ids where key = 'version'),
  now() + interval '30 days'));

select isnt((select id from lp_ids where key = 'assignment'), null,
  'a published version assigns, and production can reach an assignment at all');

select is(
  public.assign_learning_path('1a000000-0000-4000-8000-000000000201', (select id from lp_ids where key = 'version')),
  (select id from lp_ids where key = 'assignment'),
  'assigning the same version twice returns the same assignment rather than raising');

reset role;

-- ---------------------------------------------------------------------------
-- The point of all of it: evaluate_learning_path becomes reachable
-- ---------------------------------------------------------------------------

select pg_temp.act_as('1a000000-0000-4000-8000-000000000102');

select is(
  public.evaluate_learning_path((select id from lp_ids where key = 'assignment'), 0, '{}'::jsonb)
    -> 'steps' -> 'assessment' ->> 'state',
  'locked',
  'the evaluator that had never been callable now runs, and locks a step whose prerequisite is incomplete');

select is(
  public.evaluate_learning_path((select id from lp_ids where key = 'assignment'), 1,
    '{"foundation":{"completed":true},"assessment":{"score":70}}'::jsonb)
    -> 'steps' -> 'assessment' ->> 'state',
  'remediated',
  'and a below-threshold score deterministically selects the remedial branch');

-- The conflict code is asserted by number, not by message, because the number is the whole point:
-- 40001 (serialization_failure) is what PostgREST retries, so a *deterministic* conflict reported
-- that way hangs the request instead of answering it. See 20260804150000.
select pg_temp.act_as('1a000000-0000-4000-8000-000000000102');
select throws_ok($$select public.evaluate_learning_path(
  (select id from lp_ids where key = 'assignment'), 0, '{}'::jsonb)$$,
  '55000', null,
  'a stale state version conflicts with 55000, which PostgREST answers rather than retries');

reset role;
select is(
  (select count(*)::integer from public.learning_path_transition_events
   where path_assignment_id = (select id from lp_ids where key = 'assignment')),
  6,
  'each evaluation writes one explainable transition event per step');

select * from finish();
rollback;
