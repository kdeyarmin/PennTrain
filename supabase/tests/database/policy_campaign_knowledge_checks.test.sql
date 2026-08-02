begin;
select plan(16);

-- Knowledge checks for policy attestation campaigns (BACKLOG.md E4).
--
-- The property this file exists to protect: the answer key must have no path to an employee
-- session. Not "is filtered out by the client", not "is null for employees" -- absent from every
-- shape an employee can reach. Several assertions below therefore act AS the employee and prove a
-- direct read fails, rather than only checking the happy-path RPC.

insert into public.organizations (id, name, slug)
values ('92000000-0000-4000-8000-000000000001', 'Knowledge Check Org', 'knowledge-check-org');

insert into public.facilities (id, organization_id, name, facility_type)
values ('92000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000001', 'KC PCH', 'PCH');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated',
  'authenticated', fixture.email, 'x', now(), '{}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', '', '', '', false, false
from (values
  ('92000000-0000-4000-8000-000000000101'::uuid, 'kc-manager@test.local'),
  ('92000000-0000-4000-8000-000000000102'::uuid, 'kc-employee@test.local'),
  ('92000000-0000-4000-8000-000000000103'::uuid, 'kc-other-employee@test.local')
) as fixture(id, email);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles (id, organization_id, email, first_name, last_name, role, is_active)
values
  ('92000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000001',
   'kc-manager@test.local', 'KC', 'Manager', 'facility_manager', true),
  ('92000000-0000-4000-8000-000000000102', '92000000-0000-4000-8000-000000000001',
   'kc-employee@test.local', 'KC', 'Employee', 'employee', true),
  ('92000000-0000-4000-8000-000000000103', '92000000-0000-4000-8000-000000000001',
   'kc-other-employee@test.local', 'KC', 'Other', 'employee', true)
on conflict (id) do update set
  organization_id = excluded.organization_id, role = excluded.role, is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

insert into public.facility_assignments (profile_id, facility_id)
values ('92000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000011');

insert into public.employees (
  id, organization_id, facility_id, profile_id, first_name, last_name, job_title
)
values
  ('92000000-0000-4000-8000-000000000201', '92000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000102',
   'KC', 'Employee', 'Direct Care Worker'),
  ('92000000-0000-4000-8000-000000000202', '92000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000103',
   'KC', 'Other', 'Direct Care Worker');

insert into public.policy_documents (id, organization_id, title)
values ('92000000-0000-4000-8000-000000000301', '92000000-0000-4000-8000-000000000001', 'Infection Control');

insert into public.policy_document_versions (
  id, policy_document_id, organization_id, version_number, storage_path,
  file_name, file_type, content_hash, status, published_at
)
values (
  '92000000-0000-4000-8000-000000000311', '92000000-0000-4000-8000-000000000301',
  '92000000-0000-4000-8000-000000000001', 1,
  '92000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000301/v1.pdf',
  'infection-control.pdf', 'application/pdf', repeat('a', 64), 'published', now()
);

insert into public.policy_attestation_campaigns (
  id, organization_id, policy_document_id, policy_document_version_id, name, due_date
)
values (
  '92000000-0000-4000-8000-000000000401', '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000301', '92000000-0000-4000-8000-000000000311',
  'Infection Control 2026', date '2026-09-01'
);

-- Two attestations against the same campaign: the employee under test, and a second employee used
-- to prove get_policy_knowledge_check is scoped to the caller's own row.
insert into public.policy_attestations (
  id, organization_id, facility_id, employee_id, campaign_id, policy_document_version_id, due_date
)
values
  ('92000000-0000-4000-8000-000000000501', '92000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000201',
   '92000000-0000-4000-8000-000000000401', '92000000-0000-4000-8000-000000000311', date '2026-09-01'),
  ('92000000-0000-4000-8000-000000000502', '92000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000202',
   '92000000-0000-4000-8000-000000000401', '92000000-0000-4000-8000-000000000311', date '2026-09-01');

insert into public.policy_campaign_questions (
  id, organization_id, campaign_id, display_order, prompt, choices, correct_choice_index
)
values
  ('92000000-0000-4000-8000-000000000601', '92000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000401', 1, 'When must hands be washed?',
   '["Only after breaks", "Before and after resident contact", "Once per shift"]'::jsonb, 1),
  ('92000000-0000-4000-8000-000000000602', '92000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000401', 2, 'Who reports a suspected outbreak?',
   '["Any staff member", "Only the administrator"]'::jsonb, 0);

create or replace function pg_temp.act_as(p_profile_id uuid, p_aal text)
returns void
language plpgsql
as $function$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_profile_id, 'role', 'authenticated', 'aal', p_aal,
                       'iat', extract(epoch from now())::bigint)::text,
    true
  );
  set local role authenticated;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Shape / ratchets
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.policy_campaign_questions'::regclass),
  'policy_campaign_questions has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.policy_knowledge_check_attempts'::regclass),
  'policy_knowledge_check_attempts has RLS enabled'
);

select is(
  (select count(*)::int from app_private.audit_entity_manifest
   where table_name in ('policy_campaign_questions', 'policy_knowledge_check_attempts')),
  2,
  'both new tables are classified in the audit manifest'
);

select is(
  (select count(*)::int from app_private.product_module_resources
   where resource_name in ('policy_campaign_questions', 'policy_knowledge_check_attempts')
     and module_key = 'modules.compliance'),
  2,
  'both new tables are gated by the compliance product module'
);

-- No INSERT policy for authenticated on attempts: the only writer is the SECURITY DEFINER RPC.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'policy_knowledge_check_attempts' and cmd = 'INSERT'),
  0,
  'attempts have no authenticated INSERT policy -- only submit_policy_knowledge_check writes them'
);

-- ---------------------------------------------------------------------------
-- The answer key is unreachable from an employee session
-- ---------------------------------------------------------------------------

select pg_temp.act_as('92000000-0000-4000-8000-000000000102', 'aal1');

select is(
  (select count(*)::int from public.policy_campaign_questions),
  0,
  'an employee reading policy_campaign_questions directly sees nothing at all'
);

select results_eq(
  $$ select question_id, display_order, prompt
     from public.get_policy_knowledge_check('92000000-0000-4000-8000-000000000501')
     order by display_order $$,
  $$ values
       ('92000000-0000-4000-8000-000000000601'::uuid, 1, 'When must hands be washed?'),
       ('92000000-0000-4000-8000-000000000602'::uuid, 2, 'Who reports a suspected outbreak?') $$,
  'the employee reads their own campaign questions through the RPC'
);

-- The RPC's return type is the guarantee here: correct_choice_index is not a column it can emit.
select is(
  (select count(*)::int
   from information_schema.routines r
   join information_schema.parameters p
     on p.specific_name = r.specific_name
   where r.routine_schema = 'public'
     and r.routine_name = 'get_policy_knowledge_check'
     and p.parameter_name = 'correct_choice_index'),
  0,
  'get_policy_knowledge_check cannot return correct_choice_index -- it is not in its signature'
);

select throws_ok(
  $$ select * from public.get_policy_knowledge_check('92000000-0000-4000-8000-000000000502') $$,
  '42501',
  'Attestation not found for this user',
  'an employee cannot read another employee''s knowledge check'
);

-- ---------------------------------------------------------------------------
-- Grading
-- ---------------------------------------------------------------------------

-- One right, one wrong -> fails, and the response does not say which one was wrong.
select is(
  (select public.submit_policy_knowledge_check(
     '92000000-0000-4000-8000-000000000501',
     jsonb_build_object('92000000-0000-4000-8000-000000000601', 1,
                        '92000000-0000-4000-8000-000000000602', 1)
   ) - 'attemptId'),
  jsonb_build_object('passed', false, 'correctCount', 1, 'totalCount', 2),
  'a partially correct submission fails and reports only the score'
);

-- A missing answer scores as wrong rather than erroring.
select is(
  (select public.submit_policy_knowledge_check(
     '92000000-0000-4000-8000-000000000501',
     jsonb_build_object('92000000-0000-4000-8000-000000000601', 1)
   ) - 'attemptId'),
  jsonb_build_object('passed', false, 'correctCount', 1, 'totalCount', 2),
  'an incomplete submission is a recorded failure, not an error'
);

select is(
  (select public.submit_policy_knowledge_check(
     '92000000-0000-4000-8000-000000000501',
     jsonb_build_object('92000000-0000-4000-8000-000000000601', 1,
                        '92000000-0000-4000-8000-000000000602', 0)
   ) - 'attemptId'),
  jsonb_build_object('passed', true, 'correctCount', 2, 'totalCount', 2),
  'every answer correct passes'
);

select is(
  (select count(*)::int from public.policy_knowledge_check_attempts
   where attestation_id = '92000000-0000-4000-8000-000000000501'),
  3,
  'every attempt is recorded, failures included'
);

select throws_ok(
  $$ select public.submit_policy_knowledge_check(
       '92000000-0000-4000-8000-000000000502',
       jsonb_build_object('92000000-0000-4000-8000-000000000601', 1)
     ) $$,
  '42501',
  'Attestation not found for this user',
  'an employee cannot submit against another employee''s attestation'
);

-- ---------------------------------------------------------------------------
-- Append-only attempts, frozen questions
-- ---------------------------------------------------------------------------

reset role;

select throws_ok(
  $$ update public.policy_knowledge_check_attempts set passed = true where passed = false $$,
  '55000',
  'Policy knowledge check attempts are append-only',
  'a failed attempt cannot be rewritten into a pass'
);

select throws_ok(
  $$ update public.policy_campaign_questions
     set correct_choice_index = 0
     where id = '92000000-0000-4000-8000-000000000601' $$,
  '23514',
  'Knowledge check questions cannot change after someone has passed this campaign''s check.',
  'questions freeze once an attempt has passed, so a signed record still describes what was asked'
);

rollback;
