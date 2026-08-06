-- Coworker evaluation of learning paths is closed (migration 20260805190000).
-- The learner may still evaluate their own assignment; another employee in the same org may not;
-- a completed assignment refuses reevaluation.

begin;
select plan(5);

insert into public.organizations(id, name, slug, subscription_status) values
  ('2b000000-0000-4000-8000-000000000001', 'Eval Scope Org', 'eval-scope-org', 'active');
insert into public.facilities(id, organization_id, name, facility_type) values
  ('2b000000-0000-4000-8000-000000000011', '2b000000-0000-4000-8000-000000000001', 'Eval Facility', 'PCH');
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, 'x', now(),
  '{}', '{}', now(), now(), '', '', '', '', '', '', false, false
from (values
  ('2b000000-0000-4000-8000-000000000101'::uuid, 'eval-admin@test.local'),
  ('2b000000-0000-4000-8000-000000000102'::uuid, 'eval-learner@test.local'),
  ('2b000000-0000-4000-8000-000000000103'::uuid, 'eval-coworker@test.local')) v(id, email);
select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('2b000000-0000-4000-8000-000000000101', '2b000000-0000-4000-8000-000000000001', 'eval-admin@test.local', 'Eva', 'Admin', 'org_admin', true),
  ('2b000000-0000-4000-8000-000000000102', '2b000000-0000-4000-8000-000000000001', 'eval-learner@test.local', 'Leo', 'Learner', 'employee', true),
  ('2b000000-0000-4000-8000-000000000103', '2b000000-0000-4000-8000-000000000001', 'eval-coworker@test.local', 'Cora', 'Coworker', 'employee', true)
on conflict(id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;
select set_config('app.privileged_write', 'off', true);
insert into public.employees(id, organization_id, facility_id, profile_id, first_name, last_name, job_title) values
  ('2b000000-0000-4000-8000-000000000201', '2b000000-0000-4000-8000-000000000001', '2b000000-0000-4000-8000-000000000011', '2b000000-0000-4000-8000-000000000102', 'Leo', 'Learner', 'Aide'),
  ('2b000000-0000-4000-8000-000000000202', '2b000000-0000-4000-8000-000000000001', '2b000000-0000-4000-8000-000000000011', '2b000000-0000-4000-8000-000000000103', 'Cora', 'Coworker', 'Aide');

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;

-- Direct insert as postgres (privileged write) so this suite does not depend on the authoring RPCs.
-- Must reset role before these inserts: authenticated has no INSERT on learning_path_definitions.
select set_config('app.privileged_write', 'on', true);
reset role;
insert into public.learning_path_definitions(id, organization_id, name, status)
values ('2b000000-0000-4000-8000-000000000601', '2b000000-0000-4000-8000-000000000001', 'Eval Path', 'published');
insert into public.learning_path_versions(
  id, path_definition_id, organization_id, version_number, state, definition, definition_sha256, published_by, published_at
) values (
  '2b000000-0000-4000-8000-000000000602',
  '2b000000-0000-4000-8000-000000000601',
  '2b000000-0000-4000-8000-000000000001',
  1,
  'published',
  '{"steps":[{"key":"foundation","prerequisites":[]},{"key":"assessment","prerequisites":["foundation"],"threshold":80}]}',
  repeat('e', 64),
  '2b000000-0000-4000-8000-000000000101',
  now()
);
update public.learning_path_definitions
   set current_version_id = '2b000000-0000-4000-8000-000000000602'
 where id = '2b000000-0000-4000-8000-000000000601';
insert into public.learning_path_assignments(
  id, organization_id, facility_id, employee_id, path_version_id, state, state_version, current_state
) values (
  '2b000000-0000-4000-8000-000000000603',
  '2b000000-0000-4000-8000-000000000001',
  '2b000000-0000-4000-8000-000000000011',
  '2b000000-0000-4000-8000-000000000201',
  '2b000000-0000-4000-8000-000000000602',
  'active',
  0,
  '{}'::jsonb
);
select set_config('app.privileged_write', 'off', true);

select pg_temp.act_as('2b000000-0000-4000-8000-000000000102');
select is(
  public.evaluate_learning_path('2b000000-0000-4000-8000-000000000603', 0, '{}'::jsonb)
    -> 'steps' -> 'assessment' ->> 'state',
  'locked',
  'the assignee can still evaluate their own path');

select pg_temp.act_as('2b000000-0000-4000-8000-000000000103');
select throws_ok(
  $$select public.evaluate_learning_path('2b000000-0000-4000-8000-000000000603', 1, '{}'::jsonb)$$,
  '42501',
  null,
  'a coworker in the same organization cannot evaluate another employee''s path');

select pg_temp.act_as('2b000000-0000-4000-8000-000000000101');
select is(
  public.evaluate_learning_path(
    '2b000000-0000-4000-8000-000000000603',
    1,
    '{"foundation":{"completed":true},"assessment":{"completed":true}}'::jsonb
  ) ->> 'stateVersion',
  '2',
  'an org admin can evaluate an assignment in their organization');

reset role;
update public.learning_path_assignments
   set state = 'completed', completed_at = now()
 where id = '2b000000-0000-4000-8000-000000000603';

select pg_temp.act_as('2b000000-0000-4000-8000-000000000101');
select throws_ok(
  $$select public.evaluate_learning_path(
    '2b000000-0000-4000-8000-000000000603',
    2,
    '{"foundation":{"completed":true}}'::jsonb)$$,
  '55000',
  null,
  'a completed assignment refuses reevaluation');

select has_function(
  'public',
  'publish_policy_document_version',
  array['uuid', 'uuid'],
  'policy publication is one transactional RPC');

select * from finish();
rollback;
