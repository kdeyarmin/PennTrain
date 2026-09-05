-- pgTAP coverage for 20260905190000: a rollback that could not delete anything (I19).
--
-- Creating a ticket was two inserts with a client-side compensating delete between them, against a
-- table with no DELETE policy and no DELETE grant. The rollback had never removed a row, so a
-- failed first message left an empty ticket in the platform support queue and the obvious retry
-- made a second one. Run with: supabase test db.

begin;
select plan(14);

insert into public.organizations(id, name, slug) values
  ('c4000000-0000-4000-8000-000000000001', 'Ticket Org', 'ticket-org'),
  ('c4000000-0000-4000-8000-000000000002', 'Other Org', 'ticket-other-org');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, is_sso_user, is_anonymous
) values
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-000000000021', 'authenticated',
   'authenticated', 'ticket-admin@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
   '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-000000000022', 'authenticated',
   'authenticated', 'ticket-inactive@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
   '', '', '', '', '', '', false, false),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-000000000023', 'authenticated',
   'authenticated', 'ticket-outsider@test.local', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now(),
   '', '', '', '', '', '', false, false);

select set_config('app.privileged_write', 'on', true);
insert into public.profiles(id, organization_id, email, first_name, last_name, role, is_active) values
  ('c4000000-0000-4000-8000-000000000021', 'c4000000-0000-4000-8000-000000000001',
   'ticket-admin@test.local', 'Avery', 'Admin', 'org_admin', true),
  ('c4000000-0000-4000-8000-000000000022', 'c4000000-0000-4000-8000-000000000001',
   'ticket-inactive@test.local', 'Dana', 'Deactivated', 'facility_manager', false),
  ('c4000000-0000-4000-8000-000000000023', 'c4000000-0000-4000-8000-000000000002',
   'ticket-outsider@test.local', 'Sam', 'Outsider', 'org_admin', true)
on conflict (id) do update set organization_id = excluded.organization_id,
  role = excluded.role, is_active = excluded.is_active;
select set_config('app.privileged_write', 'off', true);

create or replace function pg_temp.act_as(p_profile_id uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated', 'aal', 'aal2'
  )::text, true);
  execute 'set local role authenticated';
end;
$$;

------------------------------------------------------------------------------------------------
-- 1-2. The rollback the client relied on never existed
------------------------------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'public.support_tickets', 'DELETE'),
  'authenticated holds no DELETE grant on support_tickets -- the compensating delete was a no-op'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and tablename = 'support_tickets' and cmd = 'DELETE'),
  0,
  'and there is no DELETE policy either, so the grant was not the only thing missing'
);

------------------------------------------------------------------------------------------------
-- 3-6. One call, both rows, the caller's own organization
------------------------------------------------------------------------------------------------
select pg_temp.act_as('c4000000-0000-4000-8000-000000000021');
select lives_ok(
  $$select public.create_support_ticket_with_message(
      'Cannot print the fire drill tracker', 'technical_issue', 'high',
      'The tracker download returns an error for September.')$$,
  'a ticket and its first message are created in one call'
);
select is(
  (select count(*)::integer from public.support_tickets
   where organization_id = 'c4000000-0000-4000-8000-000000000001'),
  1,
  'exactly one ticket exists'
);
select is(
  (select count(*)::integer from public.support_ticket_messages m
   join public.support_tickets t on t.id = m.ticket_id
   where t.organization_id = 'c4000000-0000-4000-8000-000000000001'),
  1,
  'and it has its message -- the pair that used to be able to come apart'
);
select is(
  (select created_by from public.support_tickets
   where organization_id = 'c4000000-0000-4000-8000-000000000001'),
  'c4000000-0000-4000-8000-000000000021'::uuid,
  'created_by comes from the session, not from an argument the caller could set'
);

------------------------------------------------------------------------------------------------
-- 7-9. A ticket with no message cannot be created at all
------------------------------------------------------------------------------------------------
select throws_ok(
  $$select public.create_support_ticket_with_message('Subject only', 'general', 'normal', '   ')$$,
  '22023',
  null,
  'a blank message is refused before any row is written -- there is nothing to roll back'
);
select is(
  (select count(*)::integer from public.support_tickets
   where organization_id = 'c4000000-0000-4000-8000-000000000001'),
  1,
  'and no empty shell is left behind by the refusal'
);
select throws_ok(
  $$select public.create_support_ticket_with_message('x', 'general', 'normal', 'A real message.')$$,
  '22023',
  null,
  'a subject too short to route is refused too'
);

------------------------------------------------------------------------------------------------
-- 10-12. The attachment step stands alone, and only for your own message
------------------------------------------------------------------------------------------------
select lives_ok(
  $$select public.attach_file_to_support_ticket_message(
      (select id from public.support_tickets where organization_id = 'c4000000-0000-4000-8000-000000000001'),
      'support-ticket-attachments', 'c4000000/ticket/screenshot.png', 'screenshot.png', 'image/png', 4096)$$,
  'the uploaded file is recorded on the message after the fact'
);
select throws_ok(
  $$select public.attach_file_to_support_ticket_message(
      (select id from public.support_tickets where organization_id = 'c4000000-0000-4000-8000-000000000001'),
      'support-ticket-attachments', 'c4000000/ticket/second.png', 'second.png', 'image/png', 4096)$$,
  'P0002',
  null,
  'a second file on the same message is refused rather than overwriting the first'
);

-- Handing the id over rather than looking it up as the outsider: a subquery would come back null
-- under support_tickets_select and the refusal would prove nothing about the function.
create temporary table pg_temp_ticket on commit drop as
select id from public.support_tickets where organization_id = 'c4000000-0000-4000-8000-000000000001';

select pg_temp.act_as('c4000000-0000-4000-8000-000000000023');
select throws_ok(
  $$select public.attach_file_to_support_ticket_message(
      (select id from pg_temp_ticket),
      'support-ticket-attachments', 'c4000000/ticket/theirs.png', 'theirs.png', 'image/png', 4096)$$,
  'P0002',
  null,
  'and another organization''s administrator, holding the ticket id, still cannot attach anything to it'
);
-- They can of course open a ticket -- in their own organization. The point is that there is no
-- argument for whose it is: it comes from their profile.
select is(
  (select (public.create_support_ticket_with_message(
      'Filed from the other tenant', 'general', 'normal', 'Lands in my own organization.')).organization_id),
  'c4000000-0000-4000-8000-000000000002'::uuid,
  'their own ticket lands in their own organization -- the scope is the profile, not an argument'
);

-- A deactivated profile keeps its rows and its session until it expires; it does not keep the
-- ability to open work for the support team.
select pg_temp.act_as('c4000000-0000-4000-8000-000000000022');
select throws_ok(
  $$select public.create_support_ticket_with_message(
      'Filed after deactivation', 'general', 'normal', 'Should not reach the queue.')$$,
  '42501',
  null,
  'a deactivated profile cannot open a ticket'
);

select * from finish();
rollback;
